import { BivectorN, MatN, Rotor4, TransformN, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  KinematicBody4,
  applyKinematicBodyPosePlan4,
  planKinematicBodyPose4,
  rigidMotionFromTransforms4,
  rigidTrajectoryFromTransforms4
} from '../src/index.js';

function expectArrayClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  tolerance = 1e-12
): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < actual.length; index++) {
    expect(Math.abs(actual[index]! - expected[index]!)).toBeLessThan(tolerance);
  }
}

function expectPoseClose(
  actual: TransformN,
  expected: TransformN,
  tolerance = 1e-12
): void {
  expectArrayClose(actual.position.data, expected.position.data, tolerance);
  const actualRotation = actual.rotation instanceof Rotor4
    ? actual.rotation.toMatrix()
    : actual.rotation;
  const expectedRotation = expected.rotation instanceof Rotor4
    ? expected.rotation.toMatrix()
    : expected.rotation;
  expectArrayClose(actualRotation.data, expectedRotation.data, tolerance);
}

function fixture(): { start: TransformN; end: TransformN; generator: BivectorN } {
  const start = new TransformN(
    4,
    Rotor4.fromBivector(
      new BivectorN(4, [0.21, -0.14, 0.31, 0.08, -0.19, 0.17])
    ),
    new VecN([-1.2, 0.4, 2.1, -0.7])
  );
  const generator = new BivectorN(
    4,
    [0.42, -0.25, 0.18, 0.37, -0.29, 0.33]
  );
  const end = new TransformN(
    4,
    Rotor4.fromBivector(generator).multiply(start.rotation as Rotor4),
    start.position.clone().add(new VecN([1.4, -0.8, 0.3, 0.9]))
  );
  return { start, end, generator };
}

describe('prescribed R4 kinematic trajectories', () => {
  it('constructs the principal screw path and matches pose-difference rates', () => {
    const { start, end } = fixture();
    const duration = 0.125;
    const trajectory = rigidTrajectoryFromTransforms4(start, end);
    expectPoseClose(trajectory.poseAt(0), start, 2e-14);
    expectPoseClose(trajectory.poseAt(1), end, 2e-14);

    const body = KinematicBody4.fromTransforms(start, end, duration);
    const motion = rigidMotionFromTransforms4(start, end, duration);
    expectArrayClose(body.center.data, start.position.data, 1e-15);
    expectArrayClose(body.linearVelocity.data, motion.linearVelocity.data, 1e-14);
    expectArrayClose(
      body.angularVelocityWorld.coeffs,
      motion.angularVelocityWorld.coeffs,
      2e-13
    );

    const coveredRotation = (end.rotation as Rotor4).clone();
    for (const factor of [coveredRotation.left, coveredRotation.right]) {
      for (let index = 0; index < 4; index++) factor[index]! *= -1;
    }
    const covered = rigidTrajectoryFromTransforms4(
      start,
      new TransformN(4, coveredRotation, end.position)
    );
    expectArrayClose(
      covered.angularDisplacementWorld.coeffs,
      trajectory.angularDisplacementWorld.coeffs,
      2e-14
    );
  });

  it('applies absolute suffix plans and chains continuously at an endpoint', () => {
    const { start, end } = fixture();
    const body = KinematicBody4.fromTransforms(start, end, 0.2);
    const first = planKinematicBodyPose4(body, 0.07);
    const half = first.trajectory.poseAt(0.5);
    applyKinematicBodyPosePlan4(first, 0.5);
    expectPoseClose(body.pose(), half, 1e-15);
    expect(body.elapsedTime).toBeCloseTo(0.035, 15);
    applyKinematicBodyPosePlan4(first, 1);
    expect(body.elapsedTime).toBeCloseTo(0.07, 15);

    const second = planKinematicBodyPose4(body, 0.13);
    applyKinematicBodyPosePlan4(second, 1);
    expectPoseClose(body.pose(), end, 3e-14);
    expect(body.remainingTime).toBeLessThan(2e-16);

    const nextEnd = new TransformN(
      4,
      Rotor4.fromBivector(new BivectorN(4, [0, 0.2, 0, -0.1, 0, 0]))
        .multiply(body.rotation),
      body.position.clone().add(new VecN([0, 0.5, -0.25, 0]))
    );
    body.setTrajectory(
      rigidTrajectoryFromTransforms4(body.pose(), nextEnd),
      0.1
    );
    applyKinematicBodyPosePlan4(planKinematicBodyPose4(body, 0.1), 1);
    expectPoseClose(body.pose(), nextEnd, 3e-14);
  });

  it('refuses ambiguous, malformed, discontinuous, stale, and overrun plans', () => {
    const identity = TransformN.identity(4);
    const centralInversion = new TransformN(
      4,
      Rotor4.fromPlanes([
        { i: 0, j: 1, angle: Math.PI },
        { i: 2, j: 3, angle: Math.PI }
      ])
    );
    expect(() => rigidTrajectoryFromTransforms4(identity, centralInversion))
      .toThrow(/no unique logarithm/);
    expect(() => rigidTrajectoryFromTransforms4(
      identity,
      new TransformN(4, MatN.identity(4).set(0, 0, 2))
    )).toThrow(/orthonormal/);
    const invalidRotor = Rotor4.identity();
    invalidRotor.left.fill(0);
    expect(() => rigidTrajectoryFromTransforms4(
      new TransformN(4, invalidRotor),
      identity
    )).toThrow(/finite nonzero/);

    const { start, end } = fixture();
    const body = KinematicBody4.fromTransforms(start, end, 0.1);
    const before = body.pose();
    const exposedVelocity = body.linearVelocity;
    exposedVelocity.data.fill(99);
    expectArrayClose(
      body.linearVelocity.data,
      end.position.clone().sub(start.position).multiplyScalar(10).data,
      1e-13
    );
    expect(() => planKinematicBodyPose4(body, 0.2)).toThrow(/exceeds/);
    expectPoseClose(body.pose(), before, 1e-15);
    expect(() => body.setTrajectory(
      rigidTrajectoryFromTransforms4(TransformN.identity(4), end),
      0.1
    )).toThrow(/current pose/);
    expect(() => new KinematicBody4({
      trajectory: rigidTrajectoryFromTransforms4(start, end),
      duration: 0
    })).toThrow(/positive/);

    const stale = planKinematicBodyPose4(body, 0.04);
    body.setTrajectory(
      rigidTrajectoryFromTransforms4(body.pose(), end),
      0.1
    );
    expect(() => applyKinematicBodyPosePlan4(stale, 1)).toThrow(/replaced/);
    expect(() => applyKinematicBodyPosePlan4(
      planKinematicBodyPose4(body, 0.04),
      1.1
    )).toThrow(/\[0, 1\]/);

    const diverged = KinematicBody4.fromTransforms(start, end, 0.1);
    diverged.position.data[0]! += 0.01;
    expect(() => planKinematicBodyPose4(diverged, 0.02)).toThrow(/diverged/);
    expect(diverged.elapsedTime).toBe(0);
  });
});
