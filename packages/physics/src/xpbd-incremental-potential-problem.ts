import { VecN } from '@holotope/core';
import {
  evaluateXpbdIncrementalPotentialN,
  type XpbdIncrementalPotentialEvaluationN
} from './xpbd-incremental-potential.js';
import {
  XpbdPotentialDomainErrorN
} from './xpbd-potential-domain.js';
import {
  type XpbdIncrementalPotentialStepFilterEvaluationN,
  type XpbdIncrementalPotentialStepFilterN,
  type XpbdIncrementalPotentialStepFilterResultN
} from './xpbd-incremental-potential-step-filter.js';
import {
  XpbdParticleN,
  type XpbdConservativeForceProviderN
} from './xpbd-world.js';

export interface CompileXpbdIncrementalPotentialProblemNOptions {
  /** Ambient Euclidean dimension. */
  readonly dimension: number;
  /** Complete authored particle identity list. */
  readonly particles: readonly XpbdParticleN[];
  /** Inertial prediction in particle order. */
  readonly predictedPositions: readonly VecN[];
  /** Positive outer-step duration in seconds. */
  readonly deltaTime: number;
  /** Conservative candidate-state force providers. */
  readonly providers: readonly XpbdConservativeForceProviderN[];
  /** Optional ordered particle-space admissible-step filters. */
  readonly stepFilters?: readonly XpbdIncrementalPotentialStepFilterN[];
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
  /** Ordered particle-space filters evaluated before Armijo trials. */
  readonly stepFilters: readonly XpbdIncrementalPotentialStepFilterN[];
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
    if (options.stepFilters !== undefined &&
      !Array.isArray(options.stepFilters)) {
      throw new Error(`${caller}: stepFilters must be an array`);
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

    const stepFilters = options.stepFilters ?? [];
    const stepFilterIds = new Set<string>();
    for (let index = 0; index < stepFilters.length; index++) {
      const filter = stepFilters[index];
      if (typeof filter !== 'object' || filter === null) {
        throw new Error(`${caller}: step filter ${index} must be an object`);
      }
      if (typeof filter.id !== 'string' || filter.id.trim().length === 0) {
        throw new Error(
          `${caller}: step filter ${index} id must be non-empty`
        );
      }
      if (stepFilterIds.has(filter.id)) {
        throw new Error(
          `${caller}: duplicate step filter id "${filter.id}"`
        );
      }
      if (filter.dimension !== options.dimension) {
        throw new Error(
          `${caller}: step filter "${filter.id}" is R${filter.dimension}, expected R${options.dimension}`
        );
      }
      if (!Array.isArray(filter.particles) || filter.particles.length === 0) {
        throw new Error(
          `${caller}: step filter "${filter.id}" has no particles`
        );
      }
      if (typeof filter.evaluate !== 'function') {
        throw new Error(
          `${caller}: step filter "${filter.id}" must define evaluate()`
        );
      }
      const local = new Set<XpbdParticleN>();
      for (const particle of filter.particles) {
        if (!(particle instanceof XpbdParticleN) || !identities.has(particle)) {
          throw new Error(
            `${caller}: step filter "${filter.id}" contains a foreign particle`
          );
        }
        if (local.has(particle)) {
          throw new Error(
            `${caller}: step filter "${filter.id}" repeats a particle`
          );
        }
        local.add(particle);
      }
      stepFilterIds.add(filter.id);
    }

    this.dimension = options.dimension;
    this.particles = Object.freeze(options.particles.slice());
    this.predictedPositions = Object.freeze(predictedPositions);
    this.deltaTime = options.deltaTime;
    this.providers = Object.freeze(options.providers.slice());
    this.stepFilters = Object.freeze(stepFilters.slice());
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
  readonly reason: string;
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
  /** Ordered admissible-step evidence evaluated for the initial segment. */
  readonly stepFilters: readonly XpbdIncrementalPotentialStepFilterResultN[];
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

/** Why Armijo could not begin from a certified positive step. */
export type XpbdArmijoStepFilterRefusalReasonN =
  | 'indeterminate'
  | 'no-positive-step';

/** Explicit pre-trial refusal from an admissible-step filter. */
export interface XpbdArmijoStepFilterRefusedN
  extends XpbdArmijoSearchBaseN {
  /** Evaluated valid state from which the search direction begins. */
  readonly base: XpbdPackedIncrementalPotentialEvaluationN;
  /** Dot product of the base gradient and proposed direction. */
  readonly directionalDerivative: number;
  /** Empty because refusal occurs before an objective trial. */
  readonly trials: readonly XpbdArmijoTrialN[];
  /** Ordered certifications including the blocking filter result. */
  readonly stepFilters: readonly XpbdIncrementalPotentialStepFilterResultN[];
  /** Distinct refusal rather than search exhaustion. */
  readonly status: 'step-filter-refused';
  /** Whether certification failed or yielded no positive Float64 step. */
  readonly reason: XpbdArmijoStepFilterRefusalReasonN;
  /** First authored filter that prevented a trial. */
  readonly blockingFilter: XpbdIncrementalPotentialStepFilterResultN;
}

export type XpbdArmijoSearchResultN =
  | XpbdArmijoAcceptedN
  | XpbdArmijoNotDescentN
  | XpbdArmijoExhaustedN
  | XpbdArmijoStepFilterRefusedN;

/**
 * Deterministic Armijo backtracking over a compiled free-coordinate problem.
 *
 * Only typed potential-domain refusals are recoverable. Every malformed,
 * arithmetic, lineage, and generic provider error is rethrown.
 */
export function searchXpbdIncrementalPotentialArmijoN(
  options: SearchXpbdIncrementalPotentialArmijoNOptions
): XpbdArmijoSearchResultN {
  const caller = 'searchXpbdIncrementalPotentialArmijoN';
  const resolved = resolveArmijoOptionsN(options, caller);
  // A base-state domain refusal is not recoverable: the search has no valid
  // point from which to establish sufficient decrease.
  const base = options.problem.evaluate(options.coordinates);
  return armijoSearchFromBaseN(options, resolved, base, caller);
}

/** Validated Armijo controls, resolved once for either entry point. */
interface ResolvedArmijoOptionsN {
  readonly initialStep: number;
  readonly contractionFactor: number;
  readonly sufficientDecrease: number;
  readonly maximumTrials: number;
}

function resolveArmijoOptionsN(
  options: SearchXpbdIncrementalPotentialArmijoNOptions,
  caller: string
): ResolvedArmijoOptionsN {
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
  return { initialStep, contractionFactor, sufficientDecrease, maximumTrials };
}

/**
 * The same search, from a base state the caller has already evaluated.
 *
 * The minimizer holds the evaluation of its current iterate — that is what
 * `current` *is* — so letting the search re-derive it costs one full pass over
 * every registered provider per accepted iteration, for a value already in
 * hand. On a contact-dense scene that is the largest single duplication in the
 * step.
 *
 * This is deliberately not a public option. A caller who supplies a base that
 * is not the evaluation of `options.coordinates` gets a silently wrong search,
 * and that invariant is not expressible in the signature. Inside this package
 * it is guaranteed: the minimizer only ever passes an evaluation it obtained
 * from these exact coordinates.
 *
 * `caller` is reported as the public entry point on both paths, so an error
 * message never names an internal a caller did not invoke.
 *
 * @internal
 */
export function searchXpbdIncrementalPotentialArmijoFromBaseN(
  options: SearchXpbdIncrementalPotentialArmijoNOptions,
  base: XpbdPackedIncrementalPotentialEvaluationN
): XpbdArmijoSearchResultN {
  const caller = 'searchXpbdIncrementalPotentialArmijoN';
  const resolved = resolveArmijoOptionsN(options, caller);
  return armijoSearchFromBaseN(options, resolved, base, caller);
}

function armijoSearchFromBaseN(
  options: SearchXpbdIncrementalPotentialArmijoNOptions,
  resolved: ResolvedArmijoOptionsN,
  base: XpbdPackedIncrementalPotentialEvaluationN,
  caller: string
): XpbdArmijoSearchResultN {
  const { initialStep, contractionFactor, sufficientDecrease, maximumTrials } =
    resolved;
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
      trials: EMPTY_ARMIJO_TRIALS,
      stepFilters: EMPTY_STEP_FILTER_RESULTS
    });
  }

  const stepFilterResults = evaluateStepFilters(
    options.problem,
    base,
    direction,
    initialStep,
    caller
  );
  const indeterminate = stepFilterResults.find(
    (result) => result.evaluation.status === 'indeterminate'
  );
  if (indeterminate !== undefined) {
    return Object.freeze({
      status: 'step-filter-refused',
      reason: 'indeterminate',
      blockingFilter: indeterminate,
      base,
      directionalDerivative,
      trials: EMPTY_ARMIJO_TRIALS,
      stepFilters: stepFilterResults
    });
  }

  const trials: XpbdArmijoTrialN[] = [];
  let stepLength = initialStep;
  let limitingFilter: XpbdIncrementalPotentialStepFilterResultN | undefined;
  for (const result of stepFilterResults) {
    const evaluation = result.evaluation;
    if (evaluation.status === 'indeterminate') continue;
    if (evaluation.maximumStepLength < stepLength) {
      stepLength = evaluation.maximumStepLength;
      limitingFilter = result;
    }
  }
  if (!(stepLength > 0)) {
    if (limitingFilter === undefined) {
      throw new Error(`${caller}: no-positive-step has no limiting filter`);
    }
    return Object.freeze({
      status: 'step-filter-refused',
      reason: 'no-positive-step',
      blockingFilter: limitingFilter,
      base,
      directionalDerivative,
      trials: EMPTY_ARMIJO_TRIALS,
      stepFilters: stepFilterResults
    });
  }
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
      if (!(error instanceof XpbdPotentialDomainErrorN)) throw error;
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
        stepFilters: stepFilterResults,
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
    trials: Object.freeze(trials),
    stepFilters: stepFilterResults
  });
}

const EMPTY_ARMIJO_TRIALS: readonly XpbdArmijoTrialN[] = Object.freeze([]);
const EMPTY_STEP_FILTER_RESULTS:
readonly XpbdIncrementalPotentialStepFilterResultN[] = Object.freeze([]);

function evaluateStepFilters(
  problem: XpbdIncrementalPotentialProblemN,
  base: XpbdPackedIncrementalPotentialEvaluationN,
  direction: Float64Array,
  requestedStepLength: number,
  caller: string
): readonly XpbdIncrementalPotentialStepFilterResultN[] {
  if (problem.stepFilters.length === 0) return EMPTY_STEP_FILTER_RESULTS;
  const endpointCoordinates = coordinatesAtStep(
    base.coordinates,
    direction,
    requestedStepLength,
    `${caller}: step-filter endpoint`
  );
  const before = base.positions;
  const after = problem.unpackPositions(endpointCoordinates);
  const indices = new Map<XpbdParticleN, number>();
  for (let index = 0; index < problem.particles.length; index++) {
    indices.set(problem.particles[index]!, index);
  }
  const position = (
    values: readonly VecN[],
    particle: XpbdParticleN,
    label: string
  ): VecN => {
    const index = indices.get(particle);
    if (index === undefined) {
      throw new Error(`${caller}: ${label} requested a foreign particle`);
    }
    return values[index]!.clone();
  };
  const context = Object.freeze({
    dimension: problem.dimension,
    requestedStepLength,
    positionBefore: (particle: XpbdParticleN) =>
      position(before, particle, 'positionBefore'),
    positionAfter: (particle: XpbdParticleN) =>
      position(after, particle, 'positionAfter')
  });
  const results: XpbdIncrementalPotentialStepFilterResultN[] = [];
  for (const filter of problem.stepFilters) {
    const evaluation = normalizeStepFilterEvaluation(
      filter.evaluate(context),
      requestedStepLength,
      `${caller}: step filter "${filter.id}"`
    );
    results.push(Object.freeze({
      filterId: filter.id,
      evaluation
    }));
  }
  return Object.freeze(results);
}

function normalizeStepFilterEvaluation(
  value: XpbdIncrementalPotentialStepFilterEvaluationN,
  requestedStepLength: number,
  caller: string
): XpbdIncrementalPotentialStepFilterEvaluationN {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${caller}: evaluation must be an object`);
  }
  if (value.status === 'indeterminate') {
    if (typeof value.reason !== 'string' || value.reason.trim().length === 0) {
      throw new Error(
        `${caller}: indeterminate reason must be a non-empty string`
      );
    }
    return Object.freeze({ ...value });
  }
  if (value.status !== 'safe' && value.status !== 'limited') {
    throw new Error(`${caller}: unknown evaluation status`);
  }
  if (!Number.isFinite(value.maximumStepLength) ||
    value.maximumStepLength < 0) {
    throw new Error(
      `${caller}: maximumStepLength must be finite and non-negative`
    );
  }
  if (value.status === 'safe' &&
    value.maximumStepLength !== requestedStepLength) {
    throw new Error(
      `${caller}: a safe evaluation must preserve requestedStepLength`
    );
  }
  if (value.status === 'limited' &&
    !(value.maximumStepLength < requestedStepLength)) {
    throw new Error(
      `${caller}: a limited evaluation must shorten requestedStepLength`
    );
  }
  return Object.freeze({ ...value });
}

function coordinatesAtStep(
  base: Float64Array,
  direction: Float64Array,
  stepLength: number,
  caller: string
): Float64Array {
  const coordinates = new Float64Array(base.length);
  for (let index = 0; index < coordinates.length; index++) {
    const coordinate = base[index]! + stepLength * direction[index]!;
    if (!Number.isFinite(coordinate)) {
      throw new Error(`${caller}: coordinate is outside Float64`);
    }
    coordinates[index] = coordinate;
  }
  return coordinates;
}

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
