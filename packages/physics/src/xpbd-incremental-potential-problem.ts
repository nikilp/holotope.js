import { VecN } from '@holotope/core';
import {
  evaluateXpbdIncrementalPotentialN,
  type XpbdIncrementalPotentialEvaluationN
} from './xpbd-incremental-potential.js';
import {
  SimplexConstitutiveDomainErrorN,
  type SimplexConstitutiveDomainReasonN
} from './simplex-constitutive.js';
import {
  XpbdParticleN,
  type XpbdConservativeForceProviderN
} from './xpbd-world.js';

export interface CompileXpbdIncrementalPotentialProblemNOptions {
  readonly dimension: number;
  readonly particles: readonly XpbdParticleN[];
  readonly predictedPositions: readonly VecN[];
  readonly deltaTime: number;
  readonly providers: readonly XpbdConservativeForceProviderN[];
}

/** Packed free-coordinate evaluation with the complete particle-space evidence. */
export interface XpbdPackedIncrementalPotentialEvaluationN {
  readonly coordinates: Float64Array;
  readonly positions: readonly VecN[];
  readonly objective: number;
  readonly gradient: Float64Array;
  readonly gradientNorm: number;
  readonly evaluation: XpbdIncrementalPotentialEvaluationN;
}

/** Defensive live-particle snapshot captured with one compiled step problem. */
export interface XpbdIncrementalPotentialParticleStateN {
  readonly index: number;
  readonly particle: XpbdParticleN;
  readonly particleId: string;
  readonly position: VecN;
  readonly velocity: VecN;
  readonly force: VecN;
  readonly inverseMass: number;
  readonly gravityScale: number;
}

/**
 * Deterministic solver view over one particle-identity incremental objective.
 *
 * Dynamic particles are packed in authored particle order, with all RN axes
 * contiguous. Fixed particles occupy no coordinates and are restored from
 * the compiled inertial prediction.
 */
export class XpbdIncrementalPotentialProblemN {
  readonly dimension: number;
  readonly particles: readonly XpbdParticleN[];
  readonly predictedPositions: readonly VecN[];
  readonly deltaTime: number;
  readonly providers: readonly XpbdConservativeForceProviderN[];
  readonly freeParticleIndices: readonly number[];
  readonly variableCount: number;
  private readonly compiledInverseMasses: readonly number[];
  private readonly compiledParticleStates:
    readonly XpbdIncrementalPotentialParticleStateN[];

  constructor(options: CompileXpbdIncrementalPotentialProblemNOptions) {
    const caller = 'XpbdIncrementalPotentialProblemN';
    if (typeof options !== 'object' || options === null) {
      throw new Error(`${caller}: options must be an object`);
    }
    if (!Number.isSafeInteger(options.dimension) || options.dimension < 1) {
      throw new Error(`${caller}: dimension must be a positive integer`);
    }
    if (!Number.isFinite(options.deltaTime) || options.deltaTime <= 0) {
      throw new Error(`${caller}: deltaTime must be finite and positive`);
    }
    if (!Array.isArray(options.particles) || options.particles.length === 0) {
      throw new Error(`${caller}: particles must be a non-empty array`);
    }
    if (!Array.isArray(options.predictedPositions) ||
      options.predictedPositions.length !== options.particles.length) {
      throw new Error(
        `${caller}: predictedPositions must match the particle count`
      );
    }
    if (!Array.isArray(options.providers)) {
      throw new Error(`${caller}: providers must be an array`);
    }

    const identities = new Set<XpbdParticleN>();
    const particleIds = new Set<string>();
    const freeParticleIndices: number[] = [];
    const predictedPositions: VecN[] = [];
    const compiledInverseMasses: number[] = [];
    const compiledParticleStates: XpbdIncrementalPotentialParticleStateN[] = [];
    for (let index = 0; index < options.particles.length; index++) {
      const particle = options.particles[index];
      if (!(particle instanceof XpbdParticleN)) {
        throw new Error(`${caller}: particle ${index} must be an XpbdParticleN`);
      }
      if (particle.dimension !== options.dimension) {
        throw new Error(
          `${caller}: particle ${index} is R${particle.dimension}, expected R${options.dimension}`
        );
      }
      if (identities.has(particle)) {
        throw new Error(`${caller}: particle identities must be unique`);
      }
      if (particleIds.has(particle.id)) {
        throw new Error(`${caller}: duplicate particle id "${particle.id}"`);
      }
      if (!Number.isFinite(particle.inverseMass) ||
        particle.inverseMass < 0) {
        throw new Error(
          `${caller}: particle ${index} inverseMass must be finite and non-negative`
        );
      }
      if (particle.inverseMass > 0 &&
        !Number.isFinite(1 / particle.inverseMass)) {
        throw new Error(`${caller}: particle ${index} mass is outside Float64`);
      }
      if (!Number.isFinite(particle.gravityScale)) {
        throw new Error(
          `${caller}: particle ${index} gravityScale must be finite`
        );
      }
      const position = finiteVector(
        particle.position,
        options.dimension,
        `${caller}: particle ${index} position`
      );
      const velocity = finiteVector(
        particle.velocity,
        options.dimension,
        `${caller}: particle ${index} velocity`
      );
      const force = finiteVector(
        particle.force,
        options.dimension,
        `${caller}: particle ${index} force`
      );
      identities.add(particle);
      particleIds.add(particle.id);
      compiledInverseMasses.push(particle.inverseMass);
      compiledParticleStates.push(Object.freeze({
        index,
        particle,
        particleId: particle.id,
        position,
        velocity,
        force,
        inverseMass: particle.inverseMass,
        gravityScale: particle.gravityScale
      }));
      if (particle.inverseMass > 0) freeParticleIndices.push(index);
      predictedPositions.push(finiteVector(
        options.predictedPositions[index]!,
        options.dimension,
        `${caller}: predicted position ${index}`
      ));
    }

    const providerIds = new Set<string>();
    for (let index = 0; index < options.providers.length; index++) {
      const provider = options.providers[index];
      if (typeof provider !== 'object' || provider === null) {
        throw new Error(`${caller}: provider ${index} must be an object`);
      }
      if (typeof provider.id !== 'string' || provider.id.trim().length === 0) {
        throw new Error(`${caller}: provider ${index} id must be non-empty`);
      }
      if (providerIds.has(provider.id)) {
        throw new Error(`${caller}: duplicate provider id "${provider.id}"`);
      }
      if (provider.dimension !== options.dimension) {
        throw new Error(
          `${caller}: provider "${provider.id}" is R${provider.dimension}, expected R${options.dimension}`
        );
      }
      if (!Array.isArray(provider.particles) ||
        provider.particles.length === 0) {
        throw new Error(`${caller}: provider "${provider.id}" has no particles`);
      }
      if (typeof provider.evaluateAt !== 'function') {
        throw new Error(
          `${caller}: provider "${provider.id}" must define evaluateAt()`
        );
      }
      const local = new Set<XpbdParticleN>();
      for (const particle of provider.particles) {
        if (!(particle instanceof XpbdParticleN) || !identities.has(particle)) {
          throw new Error(
            `${caller}: provider "${provider.id}" contains a foreign particle`
          );
        }
        if (local.has(particle)) {
          throw new Error(
            `${caller}: provider "${provider.id}" repeats a particle`
          );
        }
        local.add(particle);
      }
      providerIds.add(provider.id);
    }

    this.dimension = options.dimension;
    this.particles = Object.freeze(options.particles.slice());
    this.predictedPositions = Object.freeze(predictedPositions);
    this.deltaTime = options.deltaTime;
    this.providers = Object.freeze(options.providers.slice());
    this.freeParticleIndices = Object.freeze(freeParticleIndices);
    this.variableCount = freeParticleIndices.length * options.dimension;
    this.compiledInverseMasses = Object.freeze(compiledInverseMasses);
    this.compiledParticleStates = Object.freeze(compiledParticleStates);
  }

  /** Returns defensive copies of the exact live state captured at compilation. */
  particleStatesBeforeStep():
    readonly XpbdIncrementalPotentialParticleStateN[] {
    return Object.freeze(this.compiledParticleStates.map((state) =>
      Object.freeze({
        ...state,
        position: state.position.clone(),
        velocity: state.velocity.clone(),
        force: state.force.clone()
      })
    ));
  }

  /** Flattens only dynamic particles and verifies prescribed coordinates. */
  packPositions(positions: readonly VecN[]): Float64Array {
    const caller = 'XpbdIncrementalPotentialProblemN.packPositions';
    this.assertCurrentMasses(caller);
    if (!Array.isArray(positions) || positions.length !== this.particles.length) {
      throw new Error(`${caller}: positions must match the particle count`);
    }
    const packed = new Float64Array(this.variableCount);
    let offset = 0;
    for (let index = 0; index < positions.length; index++) {
      const position = finiteVector(
        positions[index]!,
        this.dimension,
        `${caller}: position ${index}`
      );
      if (this.compiledInverseMasses[index] === 0) {
        assertSameCoordinates(
          position,
          this.predictedPositions[index]!,
          `${caller}: fixed particle ${index} position must equal its prediction`
        );
        continue;
      }
      packed.set(position.data, offset);
      offset += this.dimension;
    }
    return packed;
  }

  /** Restores particle-space positions from packed free coordinates. */
  unpackPositions(coordinates: ArrayLike<number>): readonly VecN[] {
    const caller = 'XpbdIncrementalPotentialProblemN.unpackPositions';
    this.assertCurrentMasses(caller);
    const packed = finiteCoordinates(coordinates, this.variableCount, caller);
    const positions: VecN[] = [];
    let offset = 0;
    for (let index = 0; index < this.particles.length; index++) {
      if (this.compiledInverseMasses[index] === 0) {
        positions.push(this.predictedPositions[index]!.clone());
        continue;
      }
      positions.push(new VecN(
        packed.subarray(offset, offset + this.dimension)
      ));
      offset += this.dimension;
    }
    return Object.freeze(positions);
  }

  /** Evaluates objective and gradient without applying the candidate state. */
  evaluate(
    coordinates: ArrayLike<number>
  ): XpbdPackedIncrementalPotentialEvaluationN {
    const caller = 'XpbdIncrementalPotentialProblemN.evaluate';
    this.assertCurrentMasses(caller);
    const packed = finiteCoordinates(coordinates, this.variableCount, caller);
    const positions = this.unpackPositions(packed);
    const evaluation = evaluateXpbdIncrementalPotentialN({
      dimension: this.dimension,
      particles: this.particles,
      positions,
      predictedPositions: this.predictedPositions,
      deltaTime: this.deltaTime,
      providers: this.providers
    });
    const gradient = new Float64Array(this.variableCount);
    let offset = 0;
    for (const particleIndex of this.freeParticleIndices) {
      gradient.set(evaluation.gradients[particleIndex]!.data, offset);
      offset += this.dimension;
    }
    return Object.freeze({
      coordinates: packed,
      positions,
      objective: evaluation.objective,
      gradient,
      gradientNorm: evaluation.gradientNorm,
      evaluation
    });
  }

  private assertCurrentMasses(caller: string): void {
    for (let index = 0; index < this.particles.length; index++) {
      if (this.particles[index]!.inverseMass !==
        this.compiledInverseMasses[index]) {
        throw new Error(
          `${caller}: particle ${index} inverseMass changed after compilation`
        );
      }
    }
  }
}

export function compileXpbdIncrementalPotentialProblemN(
  options: CompileXpbdIncrementalPotentialProblemNOptions
): XpbdIncrementalPotentialProblemN {
  return new XpbdIncrementalPotentialProblemN(options);
}

export interface SearchXpbdIncrementalPotentialArmijoNOptions {
  readonly problem: XpbdIncrementalPotentialProblemN;
  readonly coordinates: ArrayLike<number>;
  readonly direction: ArrayLike<number>;
  /** Default one. */
  readonly initialStep?: number;
  /** Open interval `(0, 1)`; default `0.5`. */
  readonly contractionFactor?: number;
  /** Armijo coefficient in `(0, 1)`; default `1e-4`. */
  readonly sufficientDecrease?: number;
  /** Default 32. */
  readonly maximumTrials?: number;
}

export type XpbdArmijoTrialStatusN =
  | 'accepted'
  | 'insufficient-decrease'
  | 'domain-refused';

export interface XpbdArmijoDomainRefusalN {
  readonly lawId: string;
  readonly reason: SimplexConstitutiveDomainReasonN;
  readonly message: string;
}

export interface XpbdArmijoTrialN {
  readonly index: number;
  readonly stepLength: number;
  readonly coordinates: Float64Array;
  readonly armijoUpperBound: number;
  readonly status: XpbdArmijoTrialStatusN;
  readonly objective?: number;
  readonly refusal?: XpbdArmijoDomainRefusalN;
}

interface XpbdArmijoSearchBaseN {
  readonly base: XpbdPackedIncrementalPotentialEvaluationN;
  readonly directionalDerivative: number;
  readonly trials: readonly XpbdArmijoTrialN[];
}

export interface XpbdArmijoAcceptedN extends XpbdArmijoSearchBaseN {
  readonly status: 'accepted';
  readonly stepLength: number;
  readonly accepted: XpbdPackedIncrementalPotentialEvaluationN;
}

export interface XpbdArmijoNotDescentN extends XpbdArmijoSearchBaseN {
  readonly status: 'not-descent';
}

export interface XpbdArmijoExhaustedN extends XpbdArmijoSearchBaseN {
  readonly status: 'exhausted';
}

export type XpbdArmijoSearchResultN =
  | XpbdArmijoAcceptedN
  | XpbdArmijoNotDescentN
  | XpbdArmijoExhaustedN;

/**
 * Deterministic Armijo backtracking over a compiled free-coordinate problem.
 *
 * Only typed constitutive-domain refusals are recoverable. Every malformed,
 * arithmetic, lineage, and generic provider error is rethrown.
 */
export function searchXpbdIncrementalPotentialArmijoN(
  options: SearchXpbdIncrementalPotentialArmijoNOptions
): XpbdArmijoSearchResultN {
  const caller = 'searchXpbdIncrementalPotentialArmijoN';
  if (typeof options !== 'object' || options === null) {
    throw new Error(`${caller}: options must be an object`);
  }
  if (!(options.problem instanceof XpbdIncrementalPotentialProblemN)) {
    throw new Error(`${caller}: problem must be an XpbdIncrementalPotentialProblemN`);
  }
  const initialStep = options.initialStep ?? 1;
  const contractionFactor = options.contractionFactor ?? 0.5;
  const sufficientDecrease = options.sufficientDecrease ?? 1e-4;
  const maximumTrials = options.maximumTrials ?? 32;
  if (!(initialStep > 0) || !Number.isFinite(initialStep)) {
    throw new Error(`${caller}: initialStep must be finite and positive`);
  }
  if (!(contractionFactor > 0 && contractionFactor < 1) ||
    !Number.isFinite(contractionFactor)) {
    throw new Error(`${caller}: contractionFactor must be in (0, 1)`);
  }
  if (!(sufficientDecrease > 0 && sufficientDecrease < 1) ||
    !Number.isFinite(sufficientDecrease)) {
    throw new Error(`${caller}: sufficientDecrease must be in (0, 1)`);
  }
  if (!Number.isSafeInteger(maximumTrials) || maximumTrials < 1) {
    throw new Error(`${caller}: maximumTrials must be a positive integer`);
  }

  // A base-state domain refusal is not recoverable: the search has no valid
  // point from which to establish sufficient decrease.
  const base = options.problem.evaluate(options.coordinates);
  const direction = finiteCoordinates(
    options.direction,
    options.problem.variableCount,
    `${caller}: direction`
  );
  let directionalDerivative = 0;
  for (let index = 0; index < direction.length; index++) {
    directionalDerivative += base.gradient[index]! * direction[index]!;
  }
  if (!Number.isFinite(directionalDerivative)) {
    throw new Error(`${caller}: directional derivative is outside Float64`);
  }
  if (!(directionalDerivative < 0)) {
    return Object.freeze({
      status: 'not-descent',
      base,
      directionalDerivative,
      trials: EMPTY_ARMIJO_TRIALS
    });
  }

  const trials: XpbdArmijoTrialN[] = [];
  let stepLength = initialStep;
  for (let trialIndex = 0; trialIndex < maximumTrials; trialIndex++) {
    const coordinates = new Float64Array(options.problem.variableCount);
    for (let index = 0; index < coordinates.length; index++) {
      const coordinate =
        base.coordinates[index]! + stepLength * direction[index]!;
      if (!Number.isFinite(coordinate)) {
        throw new Error(`${caller}: trial coordinate is outside Float64`);
      }
      coordinates[index] = coordinate;
    }
    const armijoUpperBound =
      base.objective +
      sufficientDecrease * stepLength * directionalDerivative;
    if (!Number.isFinite(armijoUpperBound)) {
      throw new Error(`${caller}: Armijo upper bound is outside Float64`);
    }

    let evaluated: XpbdPackedIncrementalPotentialEvaluationN;
    try {
      evaluated = options.problem.evaluate(coordinates);
    } catch (error) {
      if (!(error instanceof SimplexConstitutiveDomainErrorN)) throw error;
      trials.push(Object.freeze({
        index: trialIndex,
        stepLength,
        coordinates,
        armijoUpperBound,
        status: 'domain-refused',
        refusal: Object.freeze({
          lawId: error.lawId,
          reason: error.reason,
          message: error.message
        })
      }));
      stepLength *= contractionFactor;
      if (stepLength === 0) break;
      continue;
    }

    if (evaluated.objective <= armijoUpperBound) {
      trials.push(Object.freeze({
        index: trialIndex,
        stepLength,
        coordinates,
        armijoUpperBound,
        status: 'accepted',
        objective: evaluated.objective
      }));
      return Object.freeze({
        status: 'accepted',
        base,
        directionalDerivative,
        trials: Object.freeze(trials),
        stepLength,
        accepted: evaluated
      });
    }

    trials.push(Object.freeze({
      index: trialIndex,
      stepLength,
      coordinates,
      armijoUpperBound,
      status: 'insufficient-decrease',
      objective: evaluated.objective
    }));
    stepLength *= contractionFactor;
    if (stepLength === 0) break;
  }

  return Object.freeze({
    status: 'exhausted',
    base,
    directionalDerivative,
    trials: Object.freeze(trials)
  });
}

const EMPTY_ARMIJO_TRIALS: readonly XpbdArmijoTrialN[] = Object.freeze([]);

function finiteCoordinates(
  value: ArrayLike<number>,
  expectedLength: number,
  caller: string
): Float64Array {
  if ((typeof value !== 'object' && typeof value !== 'function') ||
    value === null ||
    typeof value.length !== 'number' ||
    value.length !== expectedLength) {
    throw new Error(`${caller}: expected ${expectedLength} coordinates`);
  }
  const coordinates = Float64Array.from(value);
  for (const coordinate of coordinates) {
    if (!Number.isFinite(coordinate)) {
      throw new Error(`${caller}: coordinates must be finite`);
    }
  }
  return coordinates;
}

function finiteVector(
  value: VecN,
  dimension: number,
  label: string
): VecN {
  if (!(value instanceof VecN) || value.dim !== dimension) {
    throw new Error(`${label} must be R${dimension}`);
  }
  for (const coordinate of value.data) {
    if (!Number.isFinite(coordinate)) {
      throw new Error(`${label} must be finite`);
    }
  }
  return value.clone();
}

function assertSameCoordinates(
  left: VecN,
  right: VecN,
  message: string
): void {
  for (let axis = 0; axis < left.dim; axis++) {
    if (left.data[axis] !== right.data[axis]) {
      throw new Error(message);
    }
  }
}
