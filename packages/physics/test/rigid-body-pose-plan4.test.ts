import { BivectorN, Rotor4 } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  PhysicsWorld4,
  RigidBody4,
  applyRigidBodyPosePlan4,
  planRigidBodyPose4
} from '../src/index.js';

function rotationError(left: Rotor4, right: Rotor4): number {
  const a = left.toMatrix().data;
  const b = right.toMatrix().data;
  let error = 0;
  for (let index = 0; index < 16; index++) {
    error = Math.max(error, Math.abs(a[index]! - b[index]!));
  }
  return error;
}

function body(): RigidBody4 {
  return new RigidBody4({
    mass: 2.5,
    inertiaDiagonal: [0.8, 1.1, 1.7, 2.3, 3.1, 4.2],
    position: [0.4, -0.7, 0.3, 1.1],
    rotation: Rotor4.fromBivector(
      new BivectorN(4, [0.35, -0.2, 0.15, 0.41, -0.28, 0.19])
    ),
    linearVelocity: [1.2, -0.5, 0.8, 0.3],
    angularMomentumWorld: [0.7, -0.4, 0.9, 0.2, -0.6, 0.5],
    gravityScale: 0
  });
}

describe('frozen R4 rigid-body pose plans', () => {
  it('reproduces the independent Lie-midpoint endpoint for an anisotropic body', () => {
    const value = body();
    const duration = 0.037;
    const startPosition = value.position.clone();
    const startRotation = value.rotation.clone();
    const initialVelocity = value.angularVelocityWorld();
    const midpointRotation = Rotor4.fromBivector(
      initialVelocity.clone().scale(duration / 2)
    ).multiply(startRotation).normalize();
    const midpointVelocity = value.angularVelocityWorld(midpointRotation);
    const expectedRotation = Rotor4.fromBivector(
      midpointVelocity.clone().scale(duration)
    ).multiply(startRotation).normalize();
    const expectedPosition = startPosition.clone().add(
      value.linearVelocity.clone().multiplyScalar(duration)
    );

    const plan = planRigidBodyPose4(value, duration);
    expect(plan.duration).toBe(duration);
    expect(rotationError(
      plan.trajectory.poseAt(1).rotation as Rotor4,
      expectedRotation
    )).toBeLessThan(2e-14);
    expect(plan.trajectory.poseAt(1).position.distanceTo(expectedPosition))
      .toBeLessThan(2e-15);
  });

  it('is the exact pose path used by PhysicsWorld4 and supports absolute partial application', () => {
    const planned = body();
    const integrated = body();
    const duration = 0.08;
    const plan = planRigidBodyPose4(planned, duration);
    const half = plan.trajectory.poseAt(0.5);
    applyRigidBodyPosePlan4(plan, 0.5);
    expect(planned.position.distanceTo(half.position)).toBe(0);
    expect(rotationError(planned.rotation, half.rotation as Rotor4)).toBeLessThan(1e-15);
    applyRigidBodyPosePlan4(plan, 1);

    new PhysicsWorld4({ gravity: [0, 0, 0, 0] })
      .addBody(integrated)
      .integratePoses(duration);
    expect(planned.position.distanceTo(integrated.position)).toBe(0);
    expect(rotationError(planned.rotation, integrated.rotation)).toBeLessThan(1e-15);
  });

  it('freezes sampled momentum and velocity and refuses invalid domains', () => {
    const value = body();
    const plan = planRigidBodyPose4(value, 0.1);
    const endpoint = plan.trajectory.poseAt(1);
    value.linearVelocity.data.fill(20);
    value.angularMomentumWorld.coeffs.fill(-30);
    applyRigidBodyPosePlan4(plan, 1);
    expect(value.position.distanceTo(endpoint.position)).toBe(0);
    expect(rotationError(value.rotation, endpoint.rotation as Rotor4)).toBeLessThan(1e-15);
    expect(() => planRigidBodyPose4(value, 0)).toThrow(/positive/);
    expect(() => applyRigidBodyPosePlan4(plan, 1.1)).toThrow(/\[0, 1\]/);
  });
});
