import { VecN } from '@holotope/core';
import {
  applyXpbdIncrementalPotentialResultN,
  type XpbdIncrementalPotentialApplicationRefusedN,
  type XpbdIncrementalPotentialAppliedN,
  type XpbdIncrementalPotentialVelocityUpdateN
} from './xpbd-incremental-potential-application.js';
import {
  predictXpbdInertialStateN,
  type XpbdInertialPredictionN
} from './xpbd-incremental-potential.js';
import {
  minimizeXpbdIncrementalPotentialN,
  type XpbdIncrementalPotentialMinimizationResultN
} from './xpbd-incremental-potential-minimizer.js';
import {
  compileXpbdIncrementalPotentialProblemN,
  type XpbdIncrementalPotentialProblemN
} from './xpbd-incremental-potential-problem.js';
import {
  XpbdParticleN,
  type XpbdConservativeForceProviderN
} from './xpbd-world.js';

export interface XpbdIncrementalPotentialMinimizationPolicyN {
  /** Absolute packed-gradient norm tolerance; default `1e-8`. */
  readonly gradientTolerance?: number;
  /** Accepted-step budget; default 128. Zero performs evaluation only. */
  readonly maximumIterations?: number;
  /** Initial Armijo step; default one. */
  readonly initialStep?: number;
  /** Armijo contraction in `(0, 1)`; default `0.5`. */
  readonly contractionFactor?: number;
  /** Armijo sufficient-decrease coefficient in `(0, 1)`; default `1e-4`. */
  readonly sufficientDecrease?: number;
  /** Trial budget for each Armijo search; default 32. */
  readonly maximumLineSearchTrials?: number;
}

export interface XpbdIncrementalPotentialApplicationPolicyN {
  /** Default `backward-euler`. */
  readonly velocityUpdate?: XpbdIncrementalPotentialVelocityUpdateN;
  /** Default true, matching a successful `XpbdWorldN` outer step. */
  readonly clearForces?: boolean;
}

export interface StepXpbdIncrementalPotentialNOptions {
  readonly dimension: number;
  readonly particles: readonly XpbdParticleN[];
  readonly providers: readonly XpbdConservativeForceProviderN[];
  readonly deltaTime: number;
  /** Constant RN gravity; defaults to zero. */
  readonly gravity?: VecN | ArrayLike<number>;
  /**
   * Optional warm start in particle order. Fixed entries must equal their
   * inertial prediction. The default is the complete inertial prediction.
   */
  readonly initialPositions?: readonly VecN[];
  readonly minimization?: XpbdIncrementalPotentialMinimizationPolicyN;
  readonly application?: XpbdIncrementalPotentialApplicationPolicyN;
}

interface XpbdIncrementalPotentialStepBaseN {
  readonly prediction: XpbdInertialPredictionN;
  readonly problem: XpbdIncrementalPotentialProblemN;
  readonly minimization: XpbdIncrementalPotentialMinimizationResultN;
}

export interface XpbdIncrementalPotentialStepAppliedN
  extends XpbdIncrementalPotentialStepBaseN {
  readonly status: 'applied';
  readonly application: XpbdIncrementalPotentialAppliedN;
}

export interface XpbdIncrementalPotentialStepMinimizationRefusedN
  extends XpbdIncrementalPotentialStepBaseN {
  readonly status: 'refused';
  readonly stage: 'minimization';
  readonly reason: 'not-converged';
}

export interface XpbdIncrementalPotentialStepApplicationRefusedN
  extends XpbdIncrementalPotentialStepBaseN {
  readonly status: 'refused';
  readonly stage: 'application';
  readonly reason: Exclude<
    XpbdIncrementalPotentialApplicationRefusedN['reason'],
    'not-converged'
  >;
  readonly application: Exclude<
    XpbdIncrementalPotentialApplicationRefusedN,
    { readonly reason: 'not-converged' }
  >;
}

export type XpbdIncrementalPotentialStepRefusedN =
  | XpbdIncrementalPotentialStepMinimizationRefusedN
  | XpbdIncrementalPotentialStepApplicationRefusedN;

export type XpbdIncrementalPotentialStepResultN =
  | XpbdIncrementalPotentialStepAppliedN
  | XpbdIncrementalPotentialStepRefusedN;

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
 * Transactionally composes prediction, objective compilation, bounded
 * minimization, verification, and application for one conservative RN step.
 *
 * Typed refusal and thrown failure paths restore the complete pre-step
 * particle state. Only an `applied` result advances live particles.
 */
export function stepXpbdIncrementalPotentialN(
  options: StepXpbdIncrementalPotentialNOptions
): XpbdIncrementalPotentialStepResultN {
  const caller = 'stepXpbdIncrementalPotentialN';
  if (typeof options !== 'object' || options === null) {
    throw new Error(`${caller}: options must be an object`);
  }
  if (!Array.isArray(options.particles) || options.particles.length === 0) {
    throw new Error(`${caller}: particles must be a non-empty array`);
  }
  for (let index = 0; index < options.particles.length; index++) {
    if (!(options.particles[index] instanceof XpbdParticleN)) {
      throw new Error(`${caller}: particle ${index} must be an XpbdParticleN`);
    }
  }
  validatePolicyObject(options.minimization, 'minimization', caller);
  validatePolicyObject(options.application, 'application', caller);

  const rollback = options.particles.map(snapshotRuntimeParticle);
  try {
    const prediction = predictXpbdInertialStateN({
      dimension: options.dimension,
      particles: options.particles,
      deltaTime: options.deltaTime,
      ...(options.gravity === undefined ? {} : { gravity: options.gravity })
    });
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: options.dimension,
      particles: options.particles,
      predictedPositions: prediction.positions,
      deltaTime: options.deltaTime,
      providers: options.providers
    });
    const initialCoordinates = problem.packPositions(
      options.initialPositions ?? prediction.positions
    );
    const policy = options.minimization;
    const minimization = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates,
      ...(policy?.gradientTolerance === undefined
        ? {}
        : { gradientTolerance: policy.gradientTolerance }),
      ...(policy?.maximumIterations === undefined
        ? {}
        : { maximumIterations: policy.maximumIterations }),
      ...(policy?.initialStep === undefined
        ? {}
        : { initialStep: policy.initialStep }),
      ...(policy?.contractionFactor === undefined
        ? {}
        : { contractionFactor: policy.contractionFactor }),
      ...(policy?.sufficientDecrease === undefined
        ? {}
        : { sufficientDecrease: policy.sufficientDecrease }),
      ...(policy?.maximumLineSearchTrials === undefined
        ? {}
        : { maximumLineSearchTrials: policy.maximumLineSearchTrials })
    });
    const base = { prediction, problem, minimization } as const;

    if (minimization.status !== 'converged') {
      restoreRuntimeParticles(rollback);
      return Object.freeze({
        ...base,
        status: 'refused',
        stage: 'minimization',
        reason: 'not-converged'
      });
    }

    const applicationPolicy = options.application;
    const application = applyXpbdIncrementalPotentialResultN({
      result: minimization,
      ...(applicationPolicy?.velocityUpdate === undefined
        ? {}
        : { velocityUpdate: applicationPolicy.velocityUpdate }),
      ...(applicationPolicy?.clearForces === undefined
        ? {}
        : { clearForces: applicationPolicy.clearForces })
    });
    if (application.status === 'refused') {
      if (application.reason === 'not-converged') {
        throw new Error(
          `${caller}: converged minimization was refused as not-converged`
        );
      }
      restoreRuntimeParticles(rollback);
      return Object.freeze({
        ...base,
        status: 'refused',
        stage: 'application',
        reason: application.reason,
        application
      });
    }

    return Object.freeze({
      ...base,
      status: 'applied',
      application
    });
  } catch (error) {
    restoreRuntimeParticles(rollback);
    throw error;
  }
}

function validatePolicyObject(
  value: unknown,
  name: string,
  caller: string
): void {
  if (value !== undefined && (typeof value !== 'object' || value === null)) {
    throw new Error(`${caller}: ${name} must be an object`);
  }
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
