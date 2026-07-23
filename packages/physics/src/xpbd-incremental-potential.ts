import { VecN } from '@holotope/core';
import {
  evaluateXpbdPotentialStateN,
  type EvaluateXpbdPotentialStateNOptions,
  type XpbdPotentialStateEvaluationN
} from './xpbd-potential-state.js';
import { XpbdParticleN } from './xpbd-world.js';

export interface PredictXpbdInertialStateNOptions {
  readonly dimension: number;
  readonly particles: readonly XpbdParticleN[];
  readonly deltaTime: number;
  /** Constant RN gravity; defaults to zero. */
  readonly gravity?: VecN | ArrayLike<number>;
}

/** Non-mutating explicit prediction used as an optimization-time-step center. */
export interface XpbdInertialPredictionN {
  readonly dimension: number;
  readonly deltaTime: number;
  readonly positions: readonly VecN[];
  readonly accelerations: readonly VecN[];
}

export interface EvaluateXpbdIncrementalPotentialNOptions
  extends EvaluateXpbdPotentialStateNOptions {
  readonly deltaTime: number;
  /** Prescribed inertial centers paired one-to-one with `particles`. */
  readonly predictedPositions: readonly VecN[];
}

/**
 * Scaled Backward-Euler objective evidence at one RN candidate state.
 *
 * `objective = inertialObjective + deltaTime^2 * potentialEnergy`.
 * Gradients are restricted to free particles; fixed entries are zero.
 */
export interface XpbdIncrementalPotentialEvaluationN {
  readonly dimension: number;
  readonly deltaTime: number;
  readonly objective: number;
  readonly inertialObjective: number;
  readonly scaledConservativeObjective: number;
  readonly conservativePotentialEnergy: number;
  readonly gradients: readonly VecN[];
  readonly inertialGradients: readonly VecN[];
  readonly freeParticleMask: readonly boolean[];
  readonly freeParticleCount: number;
  readonly gradientNorm: number;
  readonly maximumParticleGradientNorm: number;
  /** Full conservative evidence, including gradients at prescribed particles. */
  readonly potential: XpbdPotentialStateEvaluationN;
}

/**
 * Predicts inertial centers from the current particle state without mutation.
 *
 * Registered conservative providers are intentionally absent: their energies
 * belong in the candidate objective. `particle.force` and gravity are treated
 * as explicit external accelerations, matching `XpbdWorldN` prediction.
 */
export function predictXpbdInertialStateN(
  options: PredictXpbdInertialStateNOptions
): XpbdInertialPredictionN {
  const caller = 'predictXpbdInertialStateN';
  validateOptionsObject(options, caller);
  const dimension = validateDimension(options.dimension, caller);
  const deltaTime = validateDeltaTime(options.deltaTime, caller);
  const particles = validateParticles(options.particles, dimension, caller);
  const gravity = options.gravity === undefined
    ? new VecN(dimension)
    : finiteVector(options.gravity, dimension, `${caller}: gravity`);
  const positions: VecN[] = [];
  const accelerations: VecN[] = [];
  for (let index = 0; index < particles.length; index++) {
    const particle = particles[index]!;
    const position = finiteVector(
      particle.position,
      dimension,
      `${caller}: particle ${index} position`
    );
    finiteVector(
      particle.velocity,
      dimension,
      `${caller}: particle ${index} velocity`
    );
    finiteVector(
      particle.force,
      dimension,
      `${caller}: particle ${index} force`
    );
    validateParticleMass(particle, index, caller);
    if (!Number.isFinite(particle.gravityScale)) {
      throw new Error(`${caller}: particle ${index} gravityScale must be finite`);
    }

    const acceleration = new VecN(dimension);
    const predicted = position.clone();
    if (particle.inverseMass !== 0) {
      for (let axis = 0; axis < dimension; axis++) {
        const value =
          particle.gravityScale * gravity.data[axis]! +
          particle.inverseMass * particle.force.data[axis]!;
        if (!Number.isFinite(value)) {
          throw new Error(
            `${caller}: particle ${index} acceleration is outside Float64`
          );
        }
        acceleration.data[axis] = value;
        const predictedVelocity =
          particle.velocity.data[axis]! + deltaTime * value;
        const coordinate =
          position.data[axis]! + deltaTime * predictedVelocity;
        if (!Number.isFinite(coordinate)) {
          throw new Error(
            `${caller}: particle ${index} prediction is outside Float64`
          );
        }
        predicted.data[axis] = coordinate;
      }
    }
    positions.push(predicted);
    accelerations.push(acceleration);
  }

  return Object.freeze({
    dimension,
    deltaTime,
    positions: Object.freeze(positions),
    accelerations: Object.freeze(accelerations)
  });
}

/**
 * Evaluates the scaled mass-plus-potential objective without writing live
 * particles or caller-owned prediction and candidate-position buffers.
 */
export function evaluateXpbdIncrementalPotentialN(
  options: EvaluateXpbdIncrementalPotentialNOptions
): XpbdIncrementalPotentialEvaluationN {
  const caller = 'evaluateXpbdIncrementalPotentialN';
  validateOptionsObject(options, caller);
  const dimension = validateDimension(options.dimension, caller);
  const deltaTime = validateDeltaTime(options.deltaTime, caller);
  if (!Array.isArray(options.predictedPositions) ||
    options.predictedPositions.length !== options.particles?.length) {
    throw new Error(
      `${caller}: predictedPositions must match the particle count`
    );
  }

  const potential = evaluateXpbdPotentialStateN(options);
  const deltaTimeSquared = deltaTime * deltaTime;
  if (!Number.isFinite(deltaTimeSquared)) {
    throw new Error(`${caller}: squared deltaTime is outside Float64`);
  }
  const scaledConservativeObjective =
    deltaTimeSquared * potential.potentialEnergy;
  if (!Number.isFinite(scaledConservativeObjective)) {
    throw new Error(
      `${caller}: scaled conservative objective is outside Float64`
    );
  }

  const gradients: VecN[] = [];
  const inertialGradients: VecN[] = [];
  const freeParticleMask: boolean[] = [];
  let freeParticleCount = 0;
  let inertialObjective = 0;

  for (let index = 0; index < options.particles.length; index++) {
    const particle = options.particles[index]!;
    validateParticleMass(particle, index, caller);
    const predicted = finiteVector(
      options.predictedPositions[index]!,
      dimension,
      `${caller}: predicted position ${index}`
    );
    const candidate = options.positions[index]!;
    const inertialGradient = new VecN(dimension);
    const gradient = new VecN(dimension);
    const free = particle.inverseMass !== 0;
    freeParticleMask.push(free);

    if (!free) {
      for (let axis = 0; axis < dimension; axis++) {
        if (candidate.data[axis] !== predicted.data[axis]) {
          throw new Error(
            `${caller}: fixed particle ${index} candidate must equal its prediction`
          );
        }
      }
      inertialGradients.push(inertialGradient);
      gradients.push(gradient);
      continue;
    }

    freeParticleCount++;
    const mass = 1 / particle.inverseMass;
    if (!Number.isFinite(mass)) {
      throw new Error(`${caller}: particle ${index} mass is outside Float64`);
    }
    let squaredDisplacement = 0;
    for (let axis = 0; axis < dimension; axis++) {
      const displacement = candidate.data[axis]! - predicted.data[axis]!;
      squaredDisplacement += displacement * displacement;
      const inertialValue = mass * displacement;
      const gradientValue =
        inertialValue +
        deltaTimeSquared * potential.gradients[index]!.data[axis]!;
      if (!Number.isFinite(squaredDisplacement) ||
        !Number.isFinite(inertialValue) ||
        !Number.isFinite(gradientValue)) {
        throw new Error(
          `${caller}: particle ${index} objective evidence is outside Float64`
        );
      }
      inertialGradient.data[axis] = inertialValue;
      gradient.data[axis] = gradientValue;
    }
    inertialObjective += 0.5 * mass * squaredDisplacement;
    if (!Number.isFinite(inertialObjective)) {
      throw new Error(`${caller}: inertial objective is outside Float64`);
    }
    inertialGradients.push(inertialGradient);
    gradients.push(gradient);
  }

  const objective = inertialObjective + scaledConservativeObjective;
  if (!Number.isFinite(objective)) {
    throw new Error(`${caller}: objective is outside Float64`);
  }
  let gradientNorm = 0;
  let maximumParticleGradientNorm = 0;
  for (const gradient of gradients) {
    const particleNorm = gradient.length();
    gradientNorm = Math.hypot(gradientNorm, particleNorm);
    maximumParticleGradientNorm = Math.max(
      maximumParticleGradientNorm,
      particleNorm
    );
  }

  return Object.freeze({
    dimension,
    deltaTime,
    objective,
    inertialObjective,
    scaledConservativeObjective,
    conservativePotentialEnergy: potential.potentialEnergy,
    gradients: Object.freeze(gradients),
    inertialGradients: Object.freeze(inertialGradients),
    freeParticleMask: Object.freeze(freeParticleMask),
    freeParticleCount,
    gradientNorm,
    maximumParticleGradientNorm,
    potential
  });
}

function validateOptionsObject(
  options: unknown,
  caller: string
): asserts options is object {
  if (typeof options !== 'object' || options === null) {
    throw new Error(`${caller}: options must be an object`);
  }
}

function validateDimension(dimension: number, caller: string): number {
  if (!Number.isSafeInteger(dimension) || dimension < 1) {
    throw new Error(`${caller}: dimension must be a positive integer`);
  }
  return dimension;
}

function validateDeltaTime(deltaTime: number, caller: string): number {
  if (!Number.isFinite(deltaTime) || deltaTime <= 0) {
    throw new Error(`${caller}: deltaTime must be finite and positive`);
  }
  return deltaTime;
}

function validateParticles(
  particles: readonly XpbdParticleN[],
  dimension: number,
  caller: string
): readonly XpbdParticleN[] {
  if (!Array.isArray(particles) || particles.length === 0) {
    throw new Error(`${caller}: particles must be a non-empty array`);
  }
  const identities = new Set<XpbdParticleN>();
  const ids = new Set<string>();
  for (let index = 0; index < particles.length; index++) {
    const particle = particles[index];
    if (!(particle instanceof XpbdParticleN)) {
      throw new Error(`${caller}: particle ${index} must be an XpbdParticleN`);
    }
    if (particle.dimension !== dimension) {
      throw new Error(
        `${caller}: particle ${index} is R${particle.dimension}, expected R${dimension}`
      );
    }
    if (identities.has(particle)) {
      throw new Error(`${caller}: particle identities must be unique`);
    }
    if (ids.has(particle.id)) {
      throw new Error(`${caller}: duplicate particle id "${particle.id}"`);
    }
    identities.add(particle);
    ids.add(particle.id);
  }
  return particles;
}

function validateParticleMass(
  particle: XpbdParticleN,
  index: number,
  caller: string
): void {
  if (!Number.isFinite(particle.inverseMass) || particle.inverseMass < 0) {
    throw new Error(
      `${caller}: particle ${index} inverseMass must be finite and non-negative`
    );
  }
}

function finiteVector(
  value: VecN | ArrayLike<number>,
  dimension: number,
  label: string
): VecN {
  if (value === null || value === undefined) {
    throw new Error(`${label} must be R${dimension}`);
  }
  const vector = value instanceof VecN ? value.clone() : new VecN(value);
  if (vector.dim !== dimension) {
    throw new Error(`${label} must be R${dimension}`);
  }
  for (const coordinate of vector.data) {
    if (!Number.isFinite(coordinate)) {
      throw new Error(`${label} must be finite`);
    }
  }
  return vector;
}
