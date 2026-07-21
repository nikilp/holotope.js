import {
  BivectorN,
  Rotor4,
  TransformN,
  VecN,
  createHypercube
} from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  ConvexHullSupportShapeN,
  GlomeSupportShapeN,
  HyperboxSupportShape4,
  HyperplaneColliderN,
  RigidTrajectory4,
  convexLinearCastN,
  convexRigidCast4,
  hyperboxSat4,
  querySupportShapeHyperplane,
  supportShapeBoundingRadius4,
  supportShapeHyperplaneRigidCast4,
  type SupportShapeN
} from '../src/index.js';

function trajectory(options: {
  center?: ArrayLike<number>;
  rotation?: Rotor4;
  linear?: ArrayLike<number>;
  angular?: ArrayLike<number>;
} = {}): RigidTrajectory4 {
  return new RigidTrajectory4({
    start: new TransformN(
      4,
      options.rotation ?? Rotor4.identity(),
      new VecN(options.center ?? [0, 0, 0, 0])
    ),
    linearDisplacement: options.linear ?? [0, 0, 0, 0],
    angularDisplacementWorld: options.angular ?? [0, 0, 0, 0, 0, 0]
  });
}

function rotationError(left: Rotor4, right: Rotor4): number {
  const a = left.toMatrix().data;
  const b = right.toMatrix().data;
  let error = 0;
  for (let index = 0; index < 16; index++) {
    error = Math.max(error, Math.abs(a[index]! - b[index]!));
  }
  return error;
}

function randomRotor(random: () => number): Rotor4 {
  return Rotor4.fromBivector(new BivectorN(
    4,
    Array.from({ length: 6 }, () => (2 * random() - 1) * 0.8)
  ));
}

describe('explicit R4 rigid trajectories and conservative casts', () => {
  it('pins world-left screw endpoints and material-point speed bounds', () => {
    const start = Rotor4.fromPlanes([
      { i: 0, j: 2, angle: 0.37 },
      { i: 1, j: 3, angle: -0.28 }
    ]);
    const angular = new BivectorN(4, [0.5, -0.3, 0.2, 0.4, -0.15, 0.35]);
    const path = trajectory({
      center: [0.4, -0.2, 0.7, -0.1],
      rotation: start,
      linear: [1.2, -0.5, 0.3, 0.8],
      angular: angular.coeffs
    });
    expect(rotationError(path.poseAt(0).rotation as Rotor4, start)).toBeLessThan(1e-14);
    expect(rotationError(
      path.poseAt(1).rotation as Rotor4,
      Rotor4.fromBivector(angular).multiply(start)
    )).toBeLessThan(2e-14);
    const finalPosition = path.poseAt(1).position;
    for (const [index, expected] of [1.6, -0.7, 1, 0.7].entries()) {
      expect(finalPosition.data[index]).toBeCloseTo(expected, 14);
    }

    let state = 0x8f3a_21d7;
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    const radius = 2.4;
    const bound = path.pointSpeedBound(radius);
    const epsilon = 2e-7;
    for (let sample = 0; sample < 80; sample++) {
      const local = new VecN(Array.from({ length: 4 }, () => 2 * random() - 1));
      local.multiplyScalar(radius * random() / Math.max(local.length(), 1e-15));
      const time = 0.1 + 0.8 * random();
      const previous = path.poseAt(time - epsilon).applyToPoint(local);
      const next = path.poseAt(time + epsilon).applyToPoint(local);
      const speed = next.sub(previous).multiplyScalar(1 / (2 * epsilon)).length();
      expect(speed).toBeLessThanOrEqual(bound + 2e-8);
    }
    expect(() => path.poseAt(-0.1)).toThrow(/\[0, 1\]/);
    expect(() => path.pointSpeedBound(-1)).toThrow(/radius/);
  });

  it('is exactly differential to linear casting when angular motion is zero', () => {
    const a = new GlomeSupportShapeN([-4, 0, 0, 0], 0.7);
    const b = new GlomeSupportShapeN([2.5, 0, 0, 0], 1.1);
    const displacementA = new VecN([7.5, 0, 0, 0]);
    const displacementB = new VecN([-0.4, 0, 0, 0]);
    const linear = convexLinearCastN(
      a,
      displacementA,
      b,
      displacementB,
      { targetDistance: 0.05, recordTrace: true }
    );
    const rigid = convexRigidCast4(
      a,
      { trajectory: trajectory({ center: a.center.data, linear: displacementA.data }) },
      b,
      { trajectory: trajectory({ center: b.center.data, linear: displacementB.data }) },
      { targetDistance: 0.05, recordTrace: true }
    );
    expect(rigid.status).toBe(linear.status);
    expect(rigid.reason).toBe(linear.reason);
    expect(rigid.time).toBeCloseTo(linear.time!, 13);
    expect(rigid.safeTime).toBeCloseTo(linear.safeTime, 13);
    expect(rigid.pointA.distanceTo(linear.pointA)).toBeLessThan(2e-13);
    expect(rigid.pointB.distanceTo(linear.pointB)).toBeLessThan(2e-13);
    expect(rigid.iterations).toBe(linear.iterations);
    expect(rigid.gjkIterations).toBe(linear.gjkIterations);
    expect(rigid.trace).toEqual(linear.trace?.map((entry) => ({
      iteration: entry.iteration,
      time: entry.time,
      distance: entry.distance,
      closingSpeedBound: entry.closingSpeed,
      advance: entry.advance
    })));
  });

  it('detects a pure-spin plane impact missed by both endpoint samples', () => {
    const center = new VecN([1, 0, 0, 0]);
    const box = new HyperboxSupportShape4(
      [0.2, 1.5, 0.2, 0.2],
      new TransformN(4, Rotor4.identity(), center.clone())
    );
    const plane = new HyperplaneColliderN([1, 0, 0, 0], 0);
    const path = trajectory({ center: center.data, angular: [Math.PI, 0, 0, 0, 0, 0] });
    expect(querySupportShapeHyperplane(box, plane).status).toBe('separated');
    const endpoint = new HyperboxSupportShape4(
      box.halfExtents,
      path.poseAt(1)
    );
    expect(querySupportShapeHyperplane(endpoint, plane).status).toBe('separated');

    const cast = supportShapeHyperplaneRigidCast4(
      box,
      { trajectory: path },
      plane,
      { maxIterations: 80, distanceTolerance: 1e-11, recordTrace: true }
    );
    expect(cast.status).toBe('impact');
    expect(cast.time).not.toBeNull();
    let lower = 0;
    let upper = 0.5;
    for (let iteration = 0; iteration < 80; iteration++) {
      const middle = (lower + upper) / 2;
      const angle = Math.PI * middle;
      const minimumX = 1 - (
        0.2 * Math.abs(Math.cos(angle)) +
        1.5 * Math.abs(Math.sin(angle))
      );
      if (minimumX > 0) lower = middle;
      else upper = middle;
    }
    expect(cast.safeTime).toBeLessThanOrEqual(upper + 1e-12);
    expect(cast.time!).toBeLessThanOrEqual(upper + 1e-10);
    expect(upper - cast.time!).toBeLessThan(2e-7);
    expect(cast.angularSpeedBound).toBeCloseTo(Math.PI, 13);
    const sampled = new HyperboxSupportShape4(box.halfExtents, path.poseAt(cast.time!));
    expect(cast.featureId).toBe(
      querySupportShapeHyperplane(sampled, plane).featureId
    );
  });

  it('detects pure spin into a hidden-coordinate plane', () => {
    const center = new VecN([0, 0, 0, 1]);
    const box = new HyperboxSupportShape4(
      [1.5, 0.2, 0.2, 0.2],
      new TransformN(4, Rotor4.identity(), center.clone())
    );
    const plane = new HyperplaneColliderN([0, 0, 0, 1], 0);
    const path = trajectory({
      center: center.data,
      angular: [0, 0, Math.PI, 0, 0, 0]
    });
    expect(querySupportShapeHyperplane(box, plane).status).toBe('separated');
    expect(querySupportShapeHyperplane(
      new HyperboxSupportShape4(box.halfExtents, path.poseAt(1)),
      plane
    ).status).toBe('separated');

    const cast = supportShapeHyperplaneRigidCast4(
      box,
      { trajectory: path },
      plane,
      { maxIterations: 80, distanceTolerance: 1e-11 }
    );
    expect(cast.status).toBe('impact');
    expect(cast.time!).toBeGreaterThan(0);
    expect(cast.time!).toBeLessThan(0.5);
  });

  it('detects a compact pure-spin impact between separated endpoints', () => {
    const center = new VecN([1, 0, 0, 0]);
    const box = new HyperboxSupportShape4(
      [0.2, 1.5, 0.2, 0.2],
      new TransformN(4, Rotor4.identity(), center.clone())
    );
    const obstacleCenter = new VecN([0, 0, 0, 0]);
    const obstacle = new HyperboxSupportShape4(
      [0.1, 0.1, 0.1, 0.1],
      new TransformN(4, Rotor4.identity(), obstacleCenter.clone())
    );
    const cast = convexRigidCast4(
      box,
      { trajectory: trajectory({
        center: center.data,
        angular: [Math.PI, 0, 0, 0, 0, 0]
      }) },
      obstacle,
      { trajectory: trajectory({ center: obstacleCenter.data }) },
      { maxIterations: 96, distanceTolerance: 1e-10 }
    );
    expect(cast.status).toBe('impact');
    expect(cast.time!).toBeGreaterThan(0);
    expect(cast.time!).toBeLessThan(0.5);
    expect(cast.safeTime).toBeLessThanOrEqual(cast.time!);
  });

  it('keeps dense full-SO(4) SAT contacts outside every certified safe interval', () => {
    let state = 0xd3a1_84f9;
    const random = (): number => {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return state / 0x1_0000_0000;
    };
    for (let sample = 0; sample < 20; sample++) {
      const centerA = new VecN([-4.5, random() - 0.5, random() - 0.5, random() - 0.5]);
      const centerB = new VecN([0, random() - 0.5, random() - 0.5, random() - 0.5]);
      const rotationA = randomRotor(random);
      const rotationB = randomRotor(random);
      const extentsA = Array.from({ length: 4 }, () => 0.35 + 0.65 * random());
      const extentsB = Array.from({ length: 4 }, () => 0.35 + 0.65 * random());
      const displacementA = new VecN([6.5 + random(), 0.3 * (random() - 0.5), 0, 0]);
      const displacementB = new VecN([-0.3 * random(), 0, 0, 0]);
      const angularA = new BivectorN(
        4,
        Array.from({ length: 6 }, () => (2 * random() - 1) * 0.8)
      );
      const angularB = new BivectorN(
        4,
        Array.from({ length: 6 }, () => (2 * random() - 1) * 0.8)
      );
      const boxA = new HyperboxSupportShape4(
        extentsA,
        new TransformN(4, rotationA, centerA.clone())
      );
      const boxB = new HyperboxSupportShape4(
        extentsB,
        new TransformN(4, rotationB, centerB.clone())
      );
      const motionA = { trajectory: trajectory({
        center: centerA.data,
        rotation: rotationA,
        linear: displacementA.data,
        angular: angularA.coeffs
      }) };
      const motionB = { trajectory: trajectory({
        center: centerB.data,
        rotation: rotationB,
        linear: displacementB.data,
        angular: angularB.coeffs
      }) };
      const cast = convexRigidCast4(boxA, motionA, boxB, motionB, {
        maxIterations: 80,
        distanceTolerance: 1e-9
      });
      expect(cast.safeTime).toBeGreaterThanOrEqual(0);
      const samples = 160;
      for (let step = 0; step < samples; step++) {
        const time = cast.safeTime * step / samples;
        const incrementA = Rotor4.fromBivector(
          angularA.clone().scale(time)
        );
        const incrementB = Rotor4.fromBivector(
          angularB.clone().scale(time)
        );
        boxA.transform = new TransformN(
          4,
          incrementA.multiply(rotationA),
          centerA.clone().add(displacementA.clone().multiplyScalar(time))
        );
        boxB.transform = new TransformN(
          4,
          incrementB.multiply(rotationB),
          centerB.clone().add(displacementB.clone().multiplyScalar(time))
        );
        expect(hyperboxSat4(boxA, boxB).intersects).toBe(false);
      }

      // Rehydrate the declared starting poses before checking ordered symmetry.
      boxA.transform = new TransformN(4, rotationA, centerA.clone());
      boxB.transform = new TransformN(4, rotationB, centerB.clone());
      const reverse = convexRigidCast4(boxB, motionB, boxA, motionA, {
        maxIterations: 80,
        distanceTolerance: 1e-9
      });
      expect(reverse.status).toBe(cast.status);
      if (cast.time !== null && reverse.time !== null) {
        expect(reverse.time).toBeCloseTo(cast.time, 8);
      }
      expect(reverse.pointA.distanceTo(cast.pointB)).toBeLessThan(2e-7);
      expect(reverse.pointB.distanceTo(cast.pointA)).toBeLessThan(2e-7);
      if (cast.normal && reverse.normal) {
        expect(reverse.normal.clone().add(cast.normal).length()).toBeLessThan(2e-7);
      }
    }
  });

  it('infers auditable radii and refuses missing or undersized bounds', () => {
    const center = new VecN([0.3, -0.4, 0.2, 0.1]);
    const box = new HyperboxSupportShape4(
      [0.5, 0.8, 1.1, 1.4],
      new TransformN(4, Rotor4.identity(), center.clone())
    );
    expect(supportShapeBoundingRadius4(box, center)).toBeCloseTo(
      Math.hypot(0.5, 0.8, 1.1, 1.4),
      14
    );
    const hull = ConvexHullSupportShapeN.fromCellComplex(
      createHypercube({ dim: 4, size: 2 })
    );
    expect(supportShapeBoundingRadius4(hull)).toBeCloseTo(2, 14);
    expect(supportShapeBoundingRadius4(
      new GlomeSupportShapeN([1, 0, 0, 0], 0.4),
      [0, 0, 0, 0]
    )).toBeCloseTo(1.4, 14);

    const opaque: SupportShapeN = {
      dim: 4,
      center: new VecN(4),
      support(direction: VecN) {
        return { point: direction.clone().normalize(), featureId: 'opaque' };
      }
    };
    expect(supportShapeBoundingRadius4(opaque)).toBeNull();
    const fixed = new GlomeSupportShapeN([4, 0, 0, 0], 0.5);
    expect(() => convexRigidCast4(
      opaque,
      { trajectory: trajectory() },
      fixed,
      { trajectory: trajectory({ center: fixed.center.data }) }
    )).toThrow(/boundingRadius is required/);
    expect(() => convexRigidCast4(
      box,
      { trajectory: trajectory({ center: center.data }), boundingRadius: 0.2 },
      fixed,
      { trajectory: trajectory({ center: fixed.center.data }) }
    )).toThrow(/smaller than inferred radius/);
    expect(() => new RigidTrajectory4({
      start: TransformN.identity(3),
      linearDisplacement: [0, 0, 0],
      angularDisplacementWorld: [0, 0, 0]
    })).toThrow(/R4 transform/);
    expect(() => trajectory({
      angular: [Number.POSITIVE_INFINITY, 0, 0, 0, 0, 0]
    })).toThrow(/six finite coefficients/);
    expect(() => trajectory({
      linear: [0, 0, Number.NaN, 0]
    })).toThrow(/four finite coordinates/);
  });
});
