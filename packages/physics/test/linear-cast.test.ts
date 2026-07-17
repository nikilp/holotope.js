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
  TransformedSupportShapeN,
  convexLinearCastN,
  hyperboxSat4,
  supportShapeHyperplaneLinearCastN
} from '../src/index.js';

function translatedCube(
  dim: number,
  center: ArrayLike<number>
): TransformedSupportShapeN {
  return new TransformedSupportShapeN(
    ConvexHullSupportShapeN.fromCellComplex(createHypercube({ dim, size: 2 })),
    new TransformN(dim, undefined, new VecN(center))
  );
}

function analyticCubeToi(
  centerA: readonly number[],
  displacementA: readonly number[],
  centerB: readonly number[],
  displacementB: readonly number[]
): number | null {
  let entry = 0;
  let exit = 1;
  for (let axis = 0; axis < centerA.length; axis++) {
    const position = centerA[axis]! - centerB[axis]!;
    const velocity = displacementA[axis]! - displacementB[axis]!;
    if (velocity === 0) {
      if (Math.abs(position) > 2) return null;
      continue;
    }
    let lower = (-2 - position) / velocity;
    let upper = (2 - position) / velocity;
    if (lower > upper) [lower, upper] = [upper, lower];
    entry = Math.max(entry, lower);
    exit = Math.min(exit, upper);
    if (entry > exit) return null;
  }
  return exit >= 0 && entry <= 1 ? Math.max(0, entry) : null;
}

function randomRotor(random: () => number): Rotor4 {
  return Rotor4.fromBivector(new BivectorN(
    4,
    Array.from({ length: 6 }, () => (random() * 2 - 1) * Math.PI)
  ));
}

describe('dimension-independent linear convex casting', () => {
  it('matches analytic N-ball impact time from R1 through R8', () => {
    for (let dim = 1; dim <= 8; dim++) {
      const origin = new Array<number>(dim).fill(0);
      const separated = origin.slice();
      separated[dim - 1] = 5;
      const displacement = origin.slice();
      displacement[dim - 1] = 6;
      const cast = convexLinearCastN(
        new GlomeSupportShapeN(origin, 1),
        displacement,
        new GlomeSupportShapeN(separated, 1),
        origin,
        { recordTrace: true }
      );
      expect(cast.status).toBe('impact');
      expect(cast.hit).toBe(true);
      expect(cast.time).toBeCloseTo(0.5, 11);
      expect(cast.safeTime).toBeLessThanOrEqual(cast.time!);
      expect(cast.normal!.data[dim - 1]).toBeCloseTo(-1, 12);
      expect(cast.trace!.length).toBeGreaterThan(0);
    }
  });

  it('preserves ordered symmetry and supports a positive target distance', () => {
    const a = new GlomeSupportShapeN([0, 0, 0, 0], 1);
    const b = new GlomeSupportShapeN([8, 0, 0, 0], 2);
    const forward = convexLinearCastN(a, [10, 0, 0, 0], b, [-2, 0, 0, 0], {
      targetDistance: 0.5
    });
    const reverse = convexLinearCastN(b, [-2, 0, 0, 0], a, [10, 0, 0, 0], {
      targetDistance: 0.5
    });
    expect(forward.time).toBeCloseTo(4.5 / 12, 11);
    expect(reverse.time).toBeCloseTo(forward.time!, 12);
    expect(reverse.normal!.data[0]).toBeCloseTo(-forward.normal!.data[0]!, 12);
    expect(forward.pointA.data[0]).toBeCloseTo(reverse.pointB.data[0], 11);
    expect(forward.pointB.data[0]).toBeCloseTo(reverse.pointA.data[0], 11);
  });

  it('distinguishes initial overlap, separating motion, horizon miss, and budget failure', () => {
    const a = new GlomeSupportShapeN([0, 0, 0, 0], 1);
    expect(convexLinearCastN(
      a,
      [1, 0, 0, 0],
      new GlomeSupportShapeN([1, 0, 0, 0], 1),
      [0, 0, 0, 0]
    )).toMatchObject({ status: 'initial-overlap', reason: 'initial-overlap', time: 0 });

    expect(convexLinearCastN(
      a,
      [-1, 0, 0, 0],
      new GlomeSupportShapeN([4, 0, 0, 0], 1),
      [0, 0, 0, 0]
    )).toMatchObject({ status: 'miss', reason: 'separating-motion', safeTime: 1 });

    expect(convexLinearCastN(
      a,
      [1, 0, 0, 0],
      new GlomeSupportShapeN([6, 0, 0, 0], 1),
      [0, 0, 0, 0]
    )).toMatchObject({ status: 'miss', reason: 'past-horizon', safeTime: 1 });

    const limited = convexLinearCastN(
      translatedCube(4, [-6, 0, 0, 0]),
      [12, 0, 0, 0],
      translatedCube(4, [0, 0, 0, 0]),
      [0, 0, 0, 0],
      { maxIterations: 1, timeTolerance: 0 }
    );
    expect(['impact', 'indeterminate']).toContain(limited.status);
  });

  it('matches analytic axis-aligned cube slabs across R1 through R6', () => {
    let state = 0x93d2_1f07;
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    for (let dim = 1; dim <= 6; dim++) {
      for (let sample = 0; sample < 40; sample++) {
        const centerA = Array.from({ length: dim }, () => random() * 10 - 5);
        const centerB = Array.from({ length: dim }, () => random() * 10 - 5);
        const displacementA = Array.from({ length: dim }, () => random() * 12 - 6);
        const displacementB = Array.from({ length: dim }, () => random() * 12 - 6);
        const expected = analyticCubeToi(
          centerA,
          displacementA,
          centerB,
          displacementB
        );
        const cast = convexLinearCastN(
          translatedCube(dim, centerA),
          displacementA,
          translatedCube(dim, centerB),
          displacementB,
          { maxIterations: 48, distanceTolerance: 1e-10 }
        );
        expect(cast.status).not.toBe('indeterminate');
        expect(cast.hit).toBe(expected !== null);
        if (expected !== null) expect(cast.time).toBeCloseTo(expected, 7);
      }
    }
  });

  it('agrees with complete R4 hyperbox SAT over full rotations', () => {
    let state = 0xe41a_8b5d;
    const random = (): number => {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return state / 0x1_0000_0000;
    };
    for (let sample = 0; sample < 100; sample++) {
      const rotationA = randomRotor(random);
      const rotationB = randomRotor(random);
      const extentsA = Array.from({ length: 4 }, () => 0.4 + random() * 1.2);
      const extentsB = Array.from({ length: 4 }, () => 0.4 + random() * 1.2);
      const moving = new HyperboxSupportShape4(
        extentsA,
        new TransformN(4, rotationA, new VecN([-8, 0, 0, 0]))
      );
      const fixed = new HyperboxSupportShape4(
        extentsB,
        new TransformN(4, rotationB)
      );
      const cast = convexLinearCastN(
        moving,
        [16, 0, 0, 0],
        fixed,
        [0, 0, 0, 0],
        { maxIterations: 48, distanceTolerance: 1e-10 }
      );
      expect(cast.status).toBe('impact');

      let lower = 0;
      let upper = 0.5;
      for (let iteration = 0; iteration < 55; iteration++) {
        const middle = (lower + upper) / 2;
        moving.transform.position.data[0] = -8 + 16 * middle;
        if (hyperboxSat4(moving, fixed).intersects) upper = middle;
        else lower = middle;
      }
      expect(cast.time).toBeCloseTo(upper, 7);
    }
  });

  it('validates dimensions, displacements, and numerical policies', () => {
    const a = new GlomeSupportShapeN([0, 0, 0, 0], 1);
    expect(() => convexLinearCastN(
      a,
      [0, 0, 0],
      a,
      [0, 0, 0, 0]
    )).toThrow(/four finite coordinates|4 finite coordinates/);
    expect(() => convexLinearCastN(
      a,
      [0, 0, 0, 0],
      new GlomeSupportShapeN([0, 0, 0], 1),
      [0, 0, 0]
    )).toThrow(/dimensions differ/);
    expect(() => convexLinearCastN(
      a,
      [0, 0, 0, 0],
      a,
      [0, 0, 0, 0],
      { distanceTolerance: -1 }
    )).toThrow(/distanceTolerance/);
  });
});

describe('exact compact-shape / static-hyperplane linear casting', () => {
  it('finds ordinary-axis and hidden-axis impact analytically', () => {
    const shape = new GlomeSupportShapeN([0, 5, 0, 3], 1);
    const floor = supportShapeHyperplaneLinearCastN(
      shape,
      [0, -8, 0, 0],
      new HyperplaneColliderN([0, 1, 0, 0], 0)
    );
    expect(floor).toMatchObject({ status: 'impact', hit: true });
    expect(floor.time).toBeCloseTo(0.5, 13);
    expect(floor.pointOnShape.data[1]).toBeCloseTo(0, 12);

    const hidden = supportShapeHyperplaneLinearCastN(
      shape,
      [0, 0, 0, -8],
      new HyperplaneColliderN([0, 0, 0, 1], 0)
    );
    expect(hidden.time).toBeCloseTo(0.25, 13);
    expect(hidden.pointOnPlane.data[3]).toBeCloseTo(0, 12);
  });

  it('reports initial overlap and both certified miss classes', () => {
    const plane = new HyperplaneColliderN([0, 1, 0, 0], 0);
    expect(supportShapeHyperplaneLinearCastN(
      new GlomeSupportShapeN([0, 0.5, 0, 0], 1),
      [0, 2, 0, 0],
      plane
    )).toMatchObject({ status: 'initial-overlap', time: 0 });
    expect(supportShapeHyperplaneLinearCastN(
      new GlomeSupportShapeN([0, 3, 0, 0], 1),
      [0, 1, 0, 0],
      plane
    )).toMatchObject({ status: 'miss', reason: 'separating-motion' });
    expect(supportShapeHyperplaneLinearCastN(
      new GlomeSupportShapeN([0, 3, 0, 0], 1),
      [0, -1, 0, 0],
      plane
    )).toMatchObject({ status: 'miss', reason: 'past-horizon' });
  });
});
