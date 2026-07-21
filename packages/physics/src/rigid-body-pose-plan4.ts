import { BivectorN, Rotor4, TransformN } from '@holotope/core';
import { RigidBody4 } from './rigid-body4.js';
import { RigidTrajectory4 } from './rigid-trajectory4.js';

/** One frozen Lie-midpoint pose segment for a dynamic R4 body. */
export interface RigidBodyPosePlan4 {
  readonly body: RigidBody4;
  readonly duration: number;
  readonly trajectory: RigidTrajectory4;
}

/**
 * Plans the exact constant-generator segment used by ordinary pose advancement.
 * Momentum and velocity are sampled now; applying the plan never recomputes them.
 */
export function planRigidBodyPose4(
  body: RigidBody4,
  duration: number
): RigidBodyPosePlan4 {
  assertPositiveDuration(duration, 'planRigidBodyPose4');
  const angularVelocityWorld = body.angularVelocityWorld();
  let angularDisplacementWorld = new BivectorN(4);
  if (hasNonzeroCoefficient(angularVelocityWorld)) {
    const halfIncrement = angularVelocityWorld.clone().scale(duration / 2);
    const midpointRotation = Rotor4.fromBivector(halfIncrement)
      .multiply(body.rotation)
      .normalize();
    angularDisplacementWorld = body.angularVelocityWorld(midpointRotation)
      .scale(duration);
  }
  return {
    body,
    duration,
    trajectory: new RigidTrajectory4({
      start: new TransformN(
        4,
        body.rotation.clone(),
        body.position.clone()
      ),
      linearDisplacement: body.linearVelocity.clone().multiplyScalar(duration),
      angularDisplacementWorld
    })
  };
}

/** Applies an absolute normalized sample of a previously frozen pose plan. */
export function applyRigidBodyPosePlan4(
  plan: RigidBodyPosePlan4,
  time: number
): RigidBody4 {
  const pose = plan.trajectory.poseAt(time);
  plan.body.position.data.set(pose.position.data);
  plan.body.rotation = (pose.rotation as Rotor4).clone().normalize();
  return plan.body;
}

function hasNonzeroCoefficient(bivector: BivectorN): boolean {
  for (const coefficient of bivector.coeffs) {
    if (coefficient !== 0) return true;
  }
  return false;
}

function assertPositiveDuration(duration: number, owner: string): void {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`${owner}: duration must be finite and positive`);
  }
}
