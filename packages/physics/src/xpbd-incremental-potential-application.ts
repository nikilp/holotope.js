import { VecN } from '@holotope/core';
import {
  XpbdIncrementalPotentialProblemN,
  type XpbdIncrementalPotentialParticleStateN,
  type XpbdPackedIncrementalPotentialEvaluationN
} from './xpbd-incremental-potential-problem.js';
import {
  type XpbdIncrementalPotentialMinimizationResultN
} from './xpbd-incremental-potential-minimizer.js';
import { XpbdParticleN } from './xpbd-world.js';

export type XpbdIncrementalPotentialVelocityUpdateN =
  | 'backward-euler'
  | 'preserve';

export interface ApplyXpbdIncrementalPotentialResultNOptions {
  readonly result: XpbdIncrementalPotentialMinimizationResultN;
  /** Default `backward-euler`. */
  readonly velocityUpdate?: XpbdIncrementalPotentialVelocityUpdateN;
  /** Matches a successful `XpbdWorldN` outer step by default. */
  readonly clearForces?: boolean;
}

export type XpbdIncrementalPotentialParticleStateFieldN =
  | 'particle-id'
  | 'dimension'
  | 'position'
  | 'velocity'
  | 'force'
  | 'inverse-mass'
  | 'gravity-scale';

export interface XpbdIncrementalPotentialParticleStateMismatchN {
  readonly particleIndex: number;
  readonly particleId: string;
  readonly field: XpbdIncrementalPotentialParticleStateFieldN;
  readonly axis?: number;
  readonly expected: number | string;
  readonly actual: number | string;
}

export type XpbdIncrementalPotentialEvidenceFieldN =
  | 'position'
  | 'objective'
  | 'gradient'
  | 'gradient-norm';

export interface XpbdIncrementalPotentialEvidenceMismatchN {
  readonly field: XpbdIncrementalPotentialEvidenceFieldN;
  readonly particleIndex?: number;
  readonly coordinateIndex?: number;
  readonly axis?: number;
  readonly stored: number;
  readonly verified: number;
}

export interface XpbdIncrementalPotentialAppliedParticleN {
  readonly particleIndex: number;
  readonly particleId: string;
  readonly dynamic: boolean;
  readonly positionBefore: VecN;
  readonly positionAfter: VecN;
  readonly velocityBefore: VecN;
  readonly velocityAfter: VecN;
  readonly forceBefore: VecN;
  readonly forceAfter: VecN;
}

interface XpbdIncrementalPotentialApplicationBaseN {
  readonly problem: XpbdIncrementalPotentialProblemN;
  readonly result: XpbdIncrementalPotentialMinimizationResultN;
  readonly velocityUpdate: XpbdIncrementalPotentialVelocityUpdateN;
  readonly clearForces: boolean;
}

export interface XpbdIncrementalPotentialAppliedN
  extends XpbdIncrementalPotentialApplicationBaseN {
  readonly status: 'applied';
  readonly verifiedFinal: XpbdPackedIncrementalPotentialEvaluationN;
  readonly particles: readonly XpbdIncrementalPotentialAppliedParticleN[];
}

export interface XpbdIncrementalPotentialNotConvergedN
  extends XpbdIncrementalPotentialApplicationBaseN {
  readonly status: 'refused';
  readonly reason: 'not-converged';
  readonly minimizationStatus:
    Exclude<XpbdIncrementalPotentialMinimizationResultN['status'], 'converged'>;
}

export interface XpbdIncrementalPotentialStaleParticleStateN
  extends XpbdIncrementalPotentialApplicationBaseN {
  readonly status: 'refused';
  readonly reason:
    | 'stale-particle-state'
    | 'verification-mutated-particle-state';
  readonly mismatch: XpbdIncrementalPotentialParticleStateMismatchN;
}

export interface XpbdIncrementalPotentialStaleEvidenceN
  extends XpbdIncrementalPotentialApplicationBaseN {
  readonly status: 'refused';
  readonly reason: 'stale-result-evidence';
  readonly mismatch: XpbdIncrementalPotentialEvidenceMismatchN;
  readonly verifiedFinal: XpbdPackedIncrementalPotentialEvaluationN;
}

export type XpbdIncrementalPotentialApplicationRefusedN =
  | XpbdIncrementalPotentialNotConvergedN
  | XpbdIncrementalPotentialStaleParticleStateN
  | XpbdIncrementalPotentialStaleEvidenceN;

export type XpbdIncrementalPotentialApplicationResultN =
  | XpbdIncrementalPotentialAppliedN
  | XpbdIncrementalPotentialApplicationRefusedN;

interface RuntimeParticleSnapshotN {
  readonly particle: XpbdParticleN;
  readonly id: string;
  readonly dimension: number;
  readonly position: VecN;
  readonly positionCoordinates: Float64Array;
  readonly velocity: VecN;
  readonly velocityCoordinates: Float64Array;
  readonly force: VecN;
  readonly forceCoordinates: Float64Array;
  readonly inverseMass: number;
  readonly gravityScale: number;
}

/**
 * Atomically applies one converged minimization result to its compiled particles.
 *
 * Expected non-application states return typed refusal evidence. Malformed
 * policy, arithmetic, and provider failures throw after particle rollback.
 */
export function applyXpbdIncrementalPotentialResultN(
  options: ApplyXpbdIncrementalPotentialResultNOptions
): XpbdIncrementalPotentialApplicationResultN {
  const caller = 'applyXpbdIncrementalPotentialResultN';
  if (typeof options !== 'object' || options === null) {
    throw new Error(`${caller}: options must be an object`);
  }
  const velocityUpdate = options.velocityUpdate ?? 'backward-euler';
  const clearForces = options.clearForces ?? true;
  if (velocityUpdate !== 'backward-euler' && velocityUpdate !== 'preserve') {
    throw new Error(
      `${caller}: velocityUpdate must be "backward-euler" or "preserve"`
    );
  }
  if (typeof clearForces !== 'boolean') {
    throw new Error(`${caller}: clearForces must be boolean`);
  }
  const result = options.result;
  if (typeof result !== 'object' || result === null ||
    !(result.problem instanceof XpbdIncrementalPotentialProblemN)) {
    throw new Error(`${caller}: result must be a minimization result`);
  }
  const problem = result.problem;
  const base = { problem, result, velocityUpdate, clearForces } as const;
  if (result.status !== 'converged') {
    if (!isNonConvergedStatus(result.status)) {
      throw new Error(`${caller}: result has an unknown terminal status`);
    }
    return Object.freeze({
      ...base,
      status: 'refused',
      reason: 'not-converged',
      minimizationStatus: result.status
    });
  }

  const statesBeforeStep = problem.particleStatesBeforeStep();
  const stale = firstParticleStateMismatch(
    problem.particles,
    statesBeforeStep
  );
  if (stale !== null) {
    return Object.freeze({
      ...base,
      status: 'refused',
      reason: 'stale-particle-state',
      mismatch: stale
    });
  }

  const rollback = problem.particles.map(snapshotRuntimeParticle);
  let verifiedFinal: XpbdPackedIncrementalPotentialEvaluationN;
  try {
    verifiedFinal = problem.evaluate(result.final.coordinates);
  } catch (error) {
    restoreRuntimeParticles(rollback);
    throw error;
  }
  const verificationMutation = firstParticleStateMismatch(
    problem.particles,
    statesBeforeStep
  );
  if (verificationMutation !== null) {
    restoreRuntimeParticles(rollback);
    return Object.freeze({
      ...base,
      status: 'refused',
      reason: 'verification-mutated-particle-state',
      mismatch: verificationMutation
    });
  }

  const evidenceMismatch = firstEvidenceMismatch(
    result.final,
    verifiedFinal
  );
  if (evidenceMismatch !== null) {
    return Object.freeze({
      ...base,
      status: 'refused',
      reason: 'stale-result-evidence',
      mismatch: evidenceMismatch,
      verifiedFinal
    });
  }

  const particleEvidence: XpbdIncrementalPotentialAppliedParticleN[] = [];
  for (let index = 0; index < problem.particles.length; index++) {
    const before = statesBeforeStep[index]!;
    const positionAfter = verifiedFinal.positions[index]!.clone();
    const velocityAfter = before.velocity.clone();
    if (before.inverseMass > 0 && velocityUpdate === 'backward-euler') {
      for (let axis = 0; axis < problem.dimension; axis++) {
        const displacement =
          positionAfter.data[axis]! - before.position.data[axis]!;
        const velocity = displacement / problem.deltaTime;
        if (!Number.isFinite(displacement) || !Number.isFinite(velocity)) {
          throw new Error(
            `${caller}: particle ${index} reconstructed velocity is outside Float64`
          );
        }
        velocityAfter.data[axis] = velocity;
      }
    }
    const forceAfter = clearForces
      ? new VecN(problem.dimension)
      : before.force.clone();
    particleEvidence.push(Object.freeze({
      particleIndex: index,
      particleId: before.particleId,
      dynamic: before.inverseMass > 0,
      positionBefore: before.position.clone(),
      positionAfter,
      velocityBefore: before.velocity.clone(),
      velocityAfter,
      forceBefore: before.force.clone(),
      forceAfter
    }));
  }

  try {
    for (const evidence of particleEvidence) {
      const particle = problem.particles[evidence.particleIndex]!;
      particle.position.data.set(evidence.positionAfter.data);
      particle.velocity.data.set(evidence.velocityAfter.data);
      particle.force.data.set(evidence.forceAfter.data);
    }
  } catch (error) {
    restoreRuntimeParticles(rollback);
    throw error;
  }

  return Object.freeze({
    ...base,
    status: 'applied',
    verifiedFinal,
    particles: Object.freeze(particleEvidence)
  });
}

function isNonConvergedStatus(
  status: string
): status is Exclude<
  XpbdIncrementalPotentialMinimizationResultN['status'],
  'converged'
> {
  return status === 'iteration-limit' ||
    status === 'line-search-exhausted' ||
    status === 'stalled';
}

function firstParticleStateMismatch(
  particles: readonly XpbdParticleN[],
  expected: readonly XpbdIncrementalPotentialParticleStateN[]
): XpbdIncrementalPotentialParticleStateMismatchN | null {
  for (let index = 0; index < particles.length; index++) {
    const particle = particles[index]!;
    const state = expected[index]!;
    if (particle.id !== state.particleId) {
      return stateMismatch(
        state,
        'particle-id',
        state.particleId,
        particle.id
      );
    }
    if (particle.dimension !== state.position.dim) {
      return stateMismatch(
        state,
        'dimension',
        state.position.dim,
        particle.dimension
      );
    }
    const position = firstVectorMismatch(
      particle.position,
      state.position,
      state,
      'position'
    );
    if (position !== null) return position;
    const velocity = firstVectorMismatch(
      particle.velocity,
      state.velocity,
      state,
      'velocity'
    );
    if (velocity !== null) return velocity;
    const force = firstVectorMismatch(
      particle.force,
      state.force,
      state,
      'force'
    );
    if (force !== null) return force;
    if (particle.inverseMass !== state.inverseMass) {
      return stateMismatch(
        state,
        'inverse-mass',
        state.inverseMass,
        particle.inverseMass
      );
    }
    if (particle.gravityScale !== state.gravityScale) {
      return stateMismatch(
        state,
        'gravity-scale',
        state.gravityScale,
        particle.gravityScale
      );
    }
  }
  return null;
}

function firstVectorMismatch(
  actual: VecN,
  expected: VecN,
  state: XpbdIncrementalPotentialParticleStateN,
  field: 'position' | 'velocity' | 'force'
): XpbdIncrementalPotentialParticleStateMismatchN | null {
  if (!(actual instanceof VecN) || actual.dim !== expected.dim) {
    return stateMismatch(
      state,
      field,
      `R${expected.dim}`,
      actual instanceof VecN ? `R${actual.dim}` : 'not-VecN'
    );
  }
  for (let axis = 0; axis < expected.dim; axis++) {
    if (actual.data[axis] !== expected.data[axis]) {
      return stateMismatch(
        state,
        field,
        expected.data[axis]!,
        actual.data[axis]!,
        axis
      );
    }
  }
  return null;
}

function stateMismatch(
  state: XpbdIncrementalPotentialParticleStateN,
  field: XpbdIncrementalPotentialParticleStateFieldN,
  expected: number | string,
  actual: number | string,
  axis?: number
): XpbdIncrementalPotentialParticleStateMismatchN {
  return Object.freeze({
    particleIndex: state.index,
    particleId: state.particleId,
    field,
    ...(axis === undefined ? {} : { axis }),
    expected,
    actual
  });
}

function firstEvidenceMismatch(
  stored: XpbdPackedIncrementalPotentialEvaluationN,
  verified: XpbdPackedIncrementalPotentialEvaluationN
): XpbdIncrementalPotentialEvidenceMismatchN | null {
  for (let particle = 0; particle < verified.positions.length; particle++) {
    const storedPosition = stored.positions[particle];
    const verifiedPosition = verified.positions[particle]!;
    if (!(storedPosition instanceof VecN) ||
      storedPosition.dim !== verifiedPosition.dim) {
      return evidenceMismatch(
        'position',
        Number.NaN,
        verifiedPosition.dim,
        { particleIndex: particle }
      );
    }
    for (let axis = 0; axis < verifiedPosition.dim; axis++) {
      if (storedPosition.data[axis] !== verifiedPosition.data[axis]) {
        return evidenceMismatch(
          'position',
          storedPosition.data[axis]!,
          verifiedPosition.data[axis]!,
          { particleIndex: particle, axis }
        );
      }
    }
  }
  if (stored.objective !== verified.objective) {
    return evidenceMismatch(
      'objective',
      stored.objective,
      verified.objective
    );
  }
  if (stored.gradient.length !== verified.gradient.length) {
    return evidenceMismatch(
      'gradient',
      stored.gradient.length,
      verified.gradient.length
    );
  }
  for (let coordinate = 0; coordinate < verified.gradient.length; coordinate++) {
    if (stored.gradient[coordinate] !== verified.gradient[coordinate]) {
      return evidenceMismatch(
        'gradient',
        stored.gradient[coordinate]!,
        verified.gradient[coordinate]!,
        { coordinateIndex: coordinate }
      );
    }
  }
  if (stored.gradientNorm !== verified.gradientNorm) {
    return evidenceMismatch(
      'gradient-norm',
      stored.gradientNorm,
      verified.gradientNorm
    );
  }
  return null;
}

function evidenceMismatch(
  field: XpbdIncrementalPotentialEvidenceFieldN,
  stored: number,
  verified: number,
  indices: {
    readonly particleIndex?: number;
    readonly coordinateIndex?: number;
    readonly axis?: number;
  } = {}
): XpbdIncrementalPotentialEvidenceMismatchN {
  return Object.freeze({ field, ...indices, stored, verified });
}

function snapshotRuntimeParticle(
  particle: XpbdParticleN
): RuntimeParticleSnapshotN {
  return {
    particle,
    id: particle.id,
    dimension: particle.dimension,
    position: particle.position,
    positionCoordinates: particle.position.data.slice(),
    velocity: particle.velocity,
    velocityCoordinates: particle.velocity.data.slice(),
    force: particle.force,
    forceCoordinates: particle.force.data.slice(),
    inverseMass: particle.inverseMass,
    gravityScale: particle.gravityScale
  };
}

function restoreRuntimeParticles(
  snapshots: readonly RuntimeParticleSnapshotN[]
): void {
  for (const snapshot of snapshots) {
    const mutable = snapshot.particle as unknown as {
      id: string;
      dimension: number;
      position: VecN;
      velocity: VecN;
      force: VecN;
      inverseMass: number;
      gravityScale: number;
    };
    mutable.id = snapshot.id;
    mutable.dimension = snapshot.dimension;
    mutable.position = snapshot.position;
    mutable.velocity = snapshot.velocity;
    mutable.force = snapshot.force;
    mutable.inverseMass = snapshot.inverseMass;
    mutable.gravityScale = snapshot.gravityScale;
    mutable.position.data.set(snapshot.positionCoordinates);
    mutable.velocity.data.set(snapshot.velocityCoordinates);
    mutable.force.data.set(snapshot.forceCoordinates);
  }
}
