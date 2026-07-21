import { BivectorN, Rotor4, TransformN, VecN } from '@holotope/core';
import type { RigidMotion4 } from './contact-kinematics4.js';
import {
  RigidTrajectory4,
  rigidTrajectoryFromTransforms4
} from './rigid-trajectory4.js';

export interface KinematicBody4Options {
  readonly trajectory: RigidTrajectory4;
  readonly duration: number;
}

interface KinematicBodyState4 {
  trajectory: RigidTrajectory4;
  duration: number;
  elapsedTime: number;
  revision: number;
  linearVelocity: VecN;
  angularVelocityWorld: BivectorN;
}

const states = new WeakMap<KinematicBody4, KinematicBodyState4>();

/**
 * Non-dynamic R4 pose owner driven by one explicit rigid trajectory segment.
 * It supplies prescribed contact velocity but never receives solver impulses.
 */
export class KinematicBody4 implements RigidMotion4 {
  readonly position: VecN;
  rotation: Rotor4;

  constructor(options: KinematicBody4Options) {
    const duration = positiveDuration(options.duration, 'KinematicBody4');
    const trajectory = snapshotTrajectory(options.trajectory);
    const start = trajectory.poseAt(0);
    this.position = start.position.clone();
    this.rotation = (start.rotation as Rotor4).clone();
    states.set(this, {
      trajectory,
      duration,
      elapsedTime: 0,
      revision: 0,
      linearVelocity: trajectory.linearDisplacement
        .clone()
        .multiplyScalar(1 / duration),
      angularVelocityWorld: trajectory.angularDisplacementWorld
        .clone()
        .scale(1 / duration)
    });
  }

  static fromTransforms(
    start: TransformN,
    end: TransformN,
    duration: number
  ): KinematicBody4 {
    return new KinematicBody4({
      trajectory: rigidTrajectoryFromTransforms4(start, end),
      duration
    });
  }

  /** Alias required by the prescribed rigid-motion response contract. */
  get center(): VecN {
    return this.position;
  }

  /** Snapshot of the prescribed physical translation rate. */
  get linearVelocity(): VecN {
    return stateOf(this).linearVelocity.clone();
  }

  /** Snapshot of the prescribed physical world-left angular rate. */
  get angularVelocityWorld(): BivectorN {
    return stateOf(this).angularVelocityWorld.clone();
  }

  get duration(): number {
    return stateOf(this).duration;
  }

  get elapsedTime(): number {
    return stateOf(this).elapsedTime;
  }

  get remainingTime(): number {
    const state = stateOf(this);
    return Math.max(0, state.duration - state.elapsedTime);
  }

  pose(): TransformN {
    return new TransformN(4, this.rotation.clone(), this.position.clone());
  }

  /**
   * Starts a new continuous segment at the current pose. Discontinuous
   * replacement is refused rather than being mislabeled as continuous motion.
   */
  setTrajectory(trajectory: RigidTrajectory4, duration: number): this {
    const nextDuration = positiveDuration(duration, 'KinematicBody4.setTrajectory');
    const nextTrajectory = snapshotTrajectory(trajectory);
    const nextStart = nextTrajectory.poseAt(0);
    if (!samePose4(this.pose(), nextStart, 1e-10)) {
      throw new Error(
        'KinematicBody4.setTrajectory: trajectory must start at the current pose'
      );
    }
    const state = stateOf(this);
    state.trajectory = nextTrajectory;
    state.duration = nextDuration;
    state.elapsedTime = 0;
    state.revision++;
    state.linearVelocity = nextTrajectory.linearDisplacement
      .clone()
      .multiplyScalar(1 / nextDuration);
    state.angularVelocityWorld = nextTrajectory.angularDisplacementWorld
      .clone()
      .scale(1 / nextDuration);
    return this;
  }
}

export interface KinematicBodyPosePlan4 {
  readonly body: KinematicBody4;
  readonly duration: number;
  readonly startElapsedTime: number;
  readonly trajectory: RigidTrajectory4;
  /** Opaque segment identity used to refuse stale plans after replacement. */
  readonly revision: number;
}

/** Freezes the exact next suffix of a prescribed kinematic segment. */
export function planKinematicBodyPose4(
  body: KinematicBody4,
  duration: number
): KinematicBodyPosePlan4 {
  positiveDuration(duration, 'planKinematicBodyPose4');
  const state = stateOf(body);
  const expectedPose = state.trajectory.poseAt(
    state.elapsedTime / state.duration
  );
  if (!samePose4(body.pose(), expectedPose, 1e-10)) {
    throw new Error(
      'planKinematicBodyPose4: body pose diverged from its authored trajectory'
    );
  }
  const remaining = Math.max(0, state.duration - state.elapsedTime);
  const tolerance = 1e-12 * Math.max(1, state.duration);
  if (!(remaining > 0)) {
    throw new Error('planKinematicBodyPose4: trajectory segment is exhausted');
  }
  if (duration > remaining + tolerance) {
    throw new Error(
      `planKinematicBodyPose4: duration ${duration} exceeds remaining trajectory time ${remaining}`
    );
  }
  const boundedDuration = Math.min(duration, remaining);
  const startTime = state.elapsedTime / state.duration;
  const fraction = boundedDuration / state.duration;
  return Object.freeze({
    body,
    duration: boundedDuration,
    startElapsedTime: state.elapsedTime,
    trajectory: new RigidTrajectory4({
      start: state.trajectory.poseAt(startTime),
      linearDisplacement: state.trajectory.linearDisplacement
        .clone()
        .multiplyScalar(fraction),
      angularDisplacementWorld: state.trajectory.angularDisplacementWorld
        .clone()
        .scale(fraction)
    }),
    revision: state.revision
  });
}

/** Applies an absolute normalized sample of a frozen kinematic pose plan. */
export function applyKinematicBodyPosePlan4(
  plan: KinematicBodyPosePlan4,
  time: number
): KinematicBody4 {
  if (!Number.isFinite(time) || time < 0 || time > 1) {
    throw new Error(
      'applyKinematicBodyPosePlan4: time must be finite and in [0, 1]'
    );
  }
  const state = stateOf(plan.body);
  if (state.revision !== plan.revision) {
    throw new Error(
      'applyKinematicBodyPosePlan4: plan belongs to a replaced trajectory'
    );
  }
  const pose = plan.trajectory.poseAt(time);
  plan.body.position.data.set(pose.position.data);
  plan.body.rotation = (pose.rotation as Rotor4).clone().normalize();
  state.elapsedTime = Math.min(
    state.duration,
    plan.startElapsedTime + plan.duration * time
  );
  return plan.body;
}

function snapshotTrajectory(trajectory: RigidTrajectory4): RigidTrajectory4 {
  return new RigidTrajectory4({
    start: trajectory.start,
    linearDisplacement: trajectory.linearDisplacement,
    angularDisplacementWorld: trajectory.angularDisplacementWorld
  });
}

function stateOf(body: KinematicBody4): KinematicBodyState4 {
  const state = states.get(body);
  if (!state) throw new Error('KinematicBody4: uninitialized body');
  return state;
}

function positiveDuration(value: number, owner: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${owner}: duration must be finite and positive`);
  }
  return value;
}

function samePose4(left: TransformN, right: TransformN, tolerance: number): boolean {
  if (left.position.distanceTo(right.position) > tolerance) return false;
  const leftMatrix = left.rotation instanceof Rotor4
    ? left.rotation.toMatrix()
    : left.rotation;
  const rightMatrix = right.rotation instanceof Rotor4
    ? right.rotation.toMatrix()
    : right.rotation;
  for (let index = 0; index < 16; index++) {
    if (Math.abs(leftMatrix.data[index]! - rightMatrix.data[index]!) > tolerance) {
      return false;
    }
  }
  return true;
}
