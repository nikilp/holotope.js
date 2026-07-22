import { VecN } from '@holotope/core';
import {
  XpbdParticleN,
  type XpbdConservativeForceProviderEvaluationN,
  type XpbdConservativeForceProviderN,
  type XpbdParticlePositionQueryN
} from './xpbd-world.js';

export interface EvaluateXpbdPotentialStateNOptions {
  readonly dimension: number;
  /** Particle identities defining the result order. */
  readonly particles: readonly XpbdParticleN[];
  /** Candidate positions paired one-to-one with `particles`. */
  readonly positions: readonly VecN[];
  readonly providers: readonly XpbdConservativeForceProviderN[];
}

export interface XpbdPotentialStateProviderResultN {
  readonly provider: XpbdConservativeForceProviderN;
  readonly evaluation: XpbdConservativeForceProviderEvaluationN;
}

/** Immutable Float64 potential and gradient assembly at one trial RN state. */
export interface XpbdPotentialStateEvaluationN {
  readonly dimension: number;
  readonly potentialEnergy: number;
  /** Mathematical gradients, `dU/dx`, in authored particle order. */
  readonly gradients: readonly VecN[];
  readonly providers: readonly XpbdPotentialStateProviderResultN[];
  readonly gradientNorm: number;
  readonly maximumParticleGradientNorm: number;
}

/**
 * Evaluates conservative providers at a candidate state without writing the
 * live particles. Provider forces are assembled by particle identity and
 * negated into mathematical potential gradients.
 */
export function evaluateXpbdPotentialStateN(
  options: EvaluateXpbdPotentialStateNOptions
): XpbdPotentialStateEvaluationN {
  const caller = 'evaluateXpbdPotentialStateN';
  if (typeof options !== 'object' || options === null) {
    throw new Error(`${caller}: options must be an object`);
  }
  const dimension = options.dimension;
  if (!Number.isSafeInteger(dimension) || dimension < 1) {
    throw new Error(`${caller}: dimension must be a positive integer`);
  }
  if (!Array.isArray(options.particles) || options.particles.length === 0) {
    throw new Error(`${caller}: particles must be a non-empty array`);
  }
  if (!Array.isArray(options.positions) ||
    options.positions.length !== options.particles.length) {
    throw new Error(`${caller}: positions must match the particle count`);
  }
  if (!Array.isArray(options.providers)) {
    throw new Error(`${caller}: providers must be an array`);
  }

  const particleIndices = new Map<XpbdParticleN, number>();
  const particleIds = new Set<string>();
  const candidates: VecN[] = [];
  for (let index = 0; index < options.particles.length; index++) {
    const particle = options.particles[index];
    if (!(particle instanceof XpbdParticleN)) {
      throw new Error(`${caller}: particle ${index} must be an XpbdParticleN`);
    }
    if (particle.dimension !== dimension) {
      throw new Error(
        `${caller}: particle ${index} is R${particle.dimension}, expected R${dimension}`
      );
    }
    if (particleIndices.has(particle)) {
      throw new Error(`${caller}: particle identities must be unique`);
    }
    if (particleIds.has(particle.id)) {
      throw new Error(`${caller}: duplicate particle id "${particle.id}"`);
    }
    particleIndices.set(particle, index);
    particleIds.add(particle.id);

    const position = options.positions[index];
    if (!(position instanceof VecN) || position.dim !== dimension) {
      throw new Error(`${caller}: position ${index} must be R${dimension}`);
    }
    for (const coordinate of position.data) {
      if (!Number.isFinite(coordinate)) {
        throw new Error(`${caller}: position ${index} must be finite`);
      }
    }
    candidates.push(position);
  }

  const providerIds = new Set<string>();
  for (let index = 0; index < options.providers.length; index++) {
    validateProvider(
      options.providers[index],
      index,
      dimension,
      particleIndices,
      providerIds,
      caller
    );
  }

  const gradients = options.particles.map(() => new VecN(dimension));
  const providerResults: XpbdPotentialStateProviderResultN[] = [];
  const positionOf: XpbdParticlePositionQueryN = (particle) => {
    const index = particleIndices.get(particle);
    if (index === undefined) {
      throw new Error(`${caller}: provider requested a foreign particle`);
    }
    // A defensive copy prevents one provider from mutating the caller's trial
    // state or changing the state observed by a later provider.
    return candidates[index]!.clone();
  };

  let potentialEnergy = 0;
  for (const provider of options.providers) {
    const evaluation = provider.evaluateAt(positionOf);
    const immutableEvaluation = validateEvaluation(
      evaluation,
      provider,
      dimension,
      caller
    );
    potentialEnergy += immutableEvaluation.potentialEnergy;
    if (!Number.isFinite(potentialEnergy)) {
      throw new Error(`${caller}: assembled potential energy is outside Float64`);
    }
    for (let local = 0; local < provider.particles.length; local++) {
      const worldIndex = particleIndices.get(provider.particles[local]!)!;
      const force = immutableEvaluation.forces[local]!;
      const gradient = gradients[worldIndex]!;
      for (let axis = 0; axis < dimension; axis++) {
        gradient.data[axis] = gradient.data[axis]! - force.data[axis]!;
        if (!Number.isFinite(gradient.data[axis])) {
          throw new Error(`${caller}: assembled gradient is outside Float64`);
        }
      }
    }
    providerResults.push(Object.freeze({
      provider,
      evaluation: immutableEvaluation
    }));
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
    potentialEnergy,
    gradients: Object.freeze(gradients),
    providers: Object.freeze(providerResults),
    gradientNorm,
    maximumParticleGradientNorm
  });
}

function validateProvider(
  provider: XpbdConservativeForceProviderN | undefined,
  index: number,
  dimension: number,
  particleIndices: ReadonlyMap<XpbdParticleN, number>,
  providerIds: Set<string>,
  caller: string
): void {
  if (typeof provider !== 'object' || provider === null) {
    throw new Error(`${caller}: provider ${index} must be an object`);
  }
  if (typeof provider.id !== 'string' || provider.id.trim().length === 0) {
    throw new Error(`${caller}: provider ${index} id must be non-empty`);
  }
  if (providerIds.has(provider.id)) {
    throw new Error(`${caller}: duplicate provider id "${provider.id}"`);
  }
  providerIds.add(provider.id);
  if (provider.dimension !== dimension) {
    throw new Error(
      `${caller}: provider "${provider.id}" is R${provider.dimension}, expected R${dimension}`
    );
  }
  if (!Array.isArray(provider.particles) || provider.particles.length === 0) {
    throw new Error(`${caller}: provider "${provider.id}" has no particles`);
  }
  if (typeof provider.evaluateAt !== 'function') {
    throw new Error(`${caller}: provider "${provider.id}" must define evaluateAt()`);
  }
  const localParticles = new Set<XpbdParticleN>();
  for (const particle of provider.particles) {
    if (!(particle instanceof XpbdParticleN)) {
      throw new Error(
        `${caller}: provider "${provider.id}" particles must be XpbdParticleN values`
      );
    }
    if (localParticles.has(particle)) {
      throw new Error(`${caller}: provider "${provider.id}" repeats a particle`);
    }
    localParticles.add(particle);
    if (!particleIndices.has(particle)) {
      throw new Error(`${caller}: provider "${provider.id}" contains a foreign particle`);
    }
  }
}

function validateEvaluation(
  evaluation: XpbdConservativeForceProviderEvaluationN,
  provider: XpbdConservativeForceProviderN,
  dimension: number,
  caller: string
): XpbdConservativeForceProviderEvaluationN {
  if (typeof evaluation !== 'object' || evaluation === null) {
    throw new Error(`${caller}: provider "${provider.id}" returned no evaluation`);
  }
  if (!Number.isFinite(evaluation.potentialEnergy)) {
    throw new Error(
      `${caller}: provider "${provider.id}" potentialEnergy must be finite`
    );
  }
  if (!Array.isArray(evaluation.forces) ||
    evaluation.forces.length !== provider.particles.length) {
    throw new Error(`${caller}: provider "${provider.id}" force count mismatch`);
  }
  const forces = evaluation.forces.map((force, index) => {
    if (!(force instanceof VecN) || force.dim !== dimension) {
      throw new Error(
        `${caller}: provider "${provider.id}" force ${index} must be R${dimension}`
      );
    }
    for (const coordinate of force.data) {
      if (!Number.isFinite(coordinate)) {
        throw new Error(
          `${caller}: provider "${provider.id}" force ${index} must be finite`
        );
      }
    }
    return force.clone();
  });
  return Object.freeze({
    ...evaluation,
    forces: Object.freeze(forces)
  });
}
