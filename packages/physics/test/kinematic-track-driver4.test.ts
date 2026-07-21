import { Rotor4, Rotor4Track, TransformN, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  ContactPipeline4,
  GlomeCollider4,
  KinematicTrackDriver4,
  PhysicsWorld4,
  RigidBody4,
  applyKinematicBodyPosePlan4,
  planKinematicBodyPose4,
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
  const actualMatrix = actual.rotation instanceof Rotor4
    ? actual.rotation.toMatrix()
    : actual.rotation;
  const expectedMatrix = expected.rotation instanceof Rotor4
    ? expected.rotation.toMatrix()
    : expected.rotation;
  expectArrayClose(actualMatrix.data, expectedMatrix.data, tolerance);
}

function poseAt(time: number): TransformN {
  return new TransformN(
    4,
    Rotor4.fromPlane(0, 3, 0.8 * time),
    new VecN([2 * time, -time, 0.5 * time, 0])
  );
}

function track(): Rotor4Track {
  return new Rotor4Track(
    [0, 2],
    [poseAt(0).rotation as Rotor4, poseAt(2).rotation as Rotor4],
    'linear'
  );
}

describe('KinematicTrackDriver4', () => {
  it('turns coherent position and rotor samples into physical fixed-step rates', () => {
    const fixedStep = 0.125;
    const samples: number[] = [];
    const driver = new KinematicTrackDriver4({
      fixedStep,
      positionAt: (time) => {
        samples.push(time);
        return poseAt(time).position;
      },
      rotationTrack: track()
    });

    expect(samples).toEqual([0, fixedStep]);
    expect(driver.segmentIndex).toBe(0);
    expect(driver.segmentStartTime).toBe(0);
    expect(driver.segmentEndTime).toBe(fixedStep);
    expectPoseClose(driver.body.pose(), poseAt(0), 2e-14);

    const expected = rigidTrajectoryFromTransforms4(poseAt(0), poseAt(fixedStep));
    expectArrayClose(
      driver.body.linearVelocity.data,
      expected.linearDisplacement.multiplyScalar(1 / fixedStep).data,
      2e-14
    );
    expectArrayClose(
      driver.body.angularVelocityWorld.coeffs,
      expected.angularDisplacementWorld.scale(1 / fixedStep).coeffs,
      2e-13
    );
  });

  it('chains exhausted segments from one cached boundary sample', () => {
    const samples: number[] = [];
    const driver = new KinematicTrackDriver4({
      fixedStep: 0.1,
      startTime: 0.3,
      positionAt: (time) => {
        samples.push(time);
        return poseAt(time).position;
      },
      rotationTrack: track()
    });

    applyKinematicBodyPosePlan4(planKinematicBodyPose4(driver.body, 0.1), 1);
    expectPoseClose(driver.body.pose(), poseAt(0.4), 3e-14);
    driver.advanceSegment();
    expect(samples).toEqual([0.3, 0.4, 0.5]);
    expect(driver.segmentIndex).toBe(1);
    expect(driver.segmentStartTime).toBeCloseTo(0.4, 15);
    expect(driver.segmentEndTime).toBeCloseTo(0.5, 15);
    expectPoseClose(driver.body.pose(), poseAt(0.4), 3e-14);

    applyKinematicBodyPosePlan4(planKinematicBodyPose4(driver.body, 0.1), 1);
    expectPoseClose(driver.body.pose(), poseAt(0.5), 3e-14);
  });

  it('keeps animation sampling outside continuous-event subdivision', () => {
    const samples: number[] = [];
    const driver = new KinematicTrackDriver4({
      fixedStep: 0.1,
      positionAt: (time) => {
        samples.push(time);
        return new VecN([-5 + 100 * time, 0, 0, 0]);
      },
      rotationTrack: new Rotor4Track(
        [0, 1],
        [Rotor4.identity(), Rotor4.identity()]
      )
    });
    const target = new RigidBody4({
      mass: 1,
      inertiaDiagonal: new Float64Array(6).fill(1),
      gravityScale: 0
    });
    const result = new ContactPipeline4({
      solverOptions: { iterations: 12, baumgarte: 0 }
    })
      .addCollider(new GlomeCollider4({
        id: 'authored-driver',
        radius: 1,
        participant: driver.body,
        material: { friction: 0 }
      }))
      .addCollider(new GlomeCollider4({
        id: 'dynamic-target',
        radius: 1,
        participant: target,
        material: { friction: 0 }
      }))
      .stepWorldContinuous(
        new PhysicsWorld4({ gravity: [0, 0, 0, 0] }).addBody(target),
        0.1
      );

    expect(result.status).toBe('complete');
    expect(result.substeps[0]!.events).toHaveLength(1);
    expect(samples).toEqual([0, 0.1]);
    expectPoseClose(
      driver.body.pose(),
      new TransformN(4, Rotor4.identity(), new VecN([5, 0, 0, 0])),
      2e-10
    );
  });

  it('refuses early advancement and malformed next samples atomically', () => {
    let malformed = false;
    const driver = new KinematicTrackDriver4({
      fixedStep: 0.1,
      positionAt: (time) => malformed && time > 0.15
        ? [0, Number.NaN, 0, 0]
        : poseAt(time).position,
      rotationTrack: track()
    });
    expect(() => driver.advanceSegment()).toThrow(/not exhausted/);
    expect(driver.segmentIndex).toBe(0);

    applyKinematicBodyPosePlan4(planKinematicBodyPose4(driver.body, 0.1), 1);
    const exhaustedPose = driver.body.pose();
    malformed = true;
    expect(() => driver.advanceSegment()).toThrow(/four finite/);
    expect(driver.segmentIndex).toBe(0);
    expect(driver.segmentStartTime).toBe(0);
    expect(driver.segmentEndTime).toBe(0.1);
    expect(driver.body.remainingTime).toBe(0);
    expectPoseClose(driver.body.pose(), exhaustedPose, 1e-15);

    malformed = false;
    driver.advanceSegment();
    expect(driver.segmentIndex).toBe(1);
  });

  it('validates the clock, positions, cut locus, and rotor-pair cover', () => {
    expect(() => new KinematicTrackDriver4({
      fixedStep: 0,
      positionAt: () => [0, 0, 0, 0],
      rotationTrack: track()
    })).toThrow(/positive/);
    expect(() => new KinematicTrackDriver4({
      fixedStep: 0.1,
      startTime: Number.POSITIVE_INFINITY,
      positionAt: () => [0, 0, 0, 0],
      rotationTrack: track()
    })).toThrow(/finite/);
    expect(() => new KinematicTrackDriver4({
      fixedStep: 0.1,
      positionAt: () => [0, 0, 0],
      rotationTrack: track()
    })).toThrow(/four finite/);

    const centralInversion = Rotor4.fromPlanes([
      { i: 0, j: 1, angle: Math.PI },
      { i: 2, j: 3, angle: Math.PI }
    ]);
    expect(() => new KinematicTrackDriver4({
      fixedStep: 1,
      positionAt: () => [0, 0, 0, 0],
      rotationTrack: new Rotor4Track(
        [0, 1],
        [Rotor4.identity(), centralInversion]
      )
    })).toThrow(/no unique logarithm/);

    const coveredEnd = poseAt(1).rotation as Rotor4;
    const flippedEnd = coveredEnd.clone();
    for (const factor of [flippedEnd.left, flippedEnd.right]) {
      for (let index = 0; index < 4; index++) factor[index]! *= -1;
    }
    const positionAt = (time: number) => poseAt(time).position;
    const ordinary = new KinematicTrackDriver4({
      fixedStep: 0.2,
      positionAt,
      rotationTrack: new Rotor4Track(
        [0, 1],
        [Rotor4.identity(), coveredEnd]
      )
    });
    const covered = new KinematicTrackDriver4({
      fixedStep: 0.2,
      positionAt,
      rotationTrack: new Rotor4Track(
        [0, 1],
        [Rotor4.identity(), flippedEnd]
      )
    });
    expectPoseClose(ordinary.body.pose(), covered.body.pose(), 2e-14);
    expectArrayClose(
      ordinary.body.angularVelocityWorld.coeffs,
      covered.body.angularVelocityWorld.coeffs,
      2e-13
    );
  });
});
