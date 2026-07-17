import {
  Rotor4,
  TransformN,
  VecN,
  createSimplex
} from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  ConvexHullSupportShapeN,
  GlomeSupportShapeN,
  HyperboxSupportShape4,
  TransformedSupportShapeN,
  epaPenetration4,
  hyperboxSat4
} from '../src/index.js';

function box(
  center: ArrayLike<number>,
  rotation: Rotor4 = Rotor4.identity()
): HyperboxSupportShape4 {
  return new HyperboxSupportShape4(
    [1, 1, 1, 1],
    new TransformN(4, rotation, new VecN(center))
  );
}

function expectVector(
  actual: VecN,
  expected: ArrayLike<number>,
  digits = 10
): void {
  expect(actual.dim).toBe(expected.length);
  for (let axis = 0; axis < actual.dim; axis++) {
    expect(actual.data[axis]).toBeCloseTo(expected[axis]!, digits);
  }
}

describe('epaPenetration4', () => {
  it('returns an ordered minimum-translation witness for overlapping boxes', () => {
    const shapeA = box([0, 0, 0, 0]);
    const shapeB = box([1.5, 0, 0, 0]);
    const result = epaPenetration4(shapeA, shapeB, { recordTrace: true });

    expect(result.status).toBe('penetrating');
    expect(result.intersects).toBe(true);
    expect(result.penetrationDepth).toBeCloseTo(0.5, 10);
    expectVector(result.normal!, [-1, 0, 0, 0]);
    expect(result.termination.reason).toMatch(/support-gap|duplicate-support/);
    expect(result.errorBound).toBeLessThan(1e-8);
    expect(result.facet?.weights.reduce((sum, value) => sum + value, 0))
      .toBeCloseTo(1, 13);
    expect(result.facet?.witnessResidual).toBeLessThan(1e-9);
    expectVector(
      result.pointA!.clone().add(result.patch!.translationA),
      result.pointB!.data
    );
    expect(result.trace).toBeDefined();
  });

  it('preserves depth and reverses the ordered witness direction', () => {
    const shapeA = box([0, 0, 0, 0]);
    const shapeB = box([1.5, 0, 0, 0]);
    const forward = epaPenetration4(shapeA, shapeB);
    const reverse = epaPenetration4(shapeB, shapeA);

    expect(reverse.status).toBe('penetrating');
    expect(reverse.penetrationDepth).toBeCloseTo(forward.penetrationDepth!, 10);
    expectVector(reverse.normal!, forward.normal!.clone().multiplyScalar(-1).data);
    expectVector(reverse.pointA!, forward.pointB!.data);
    expectVector(reverse.pointB!, forward.pointA!.data);
  });

  it('keeps separation and exact touching distinct', () => {
    const origin = box([0, 0, 0, 0]);
    const separated = epaPenetration4(origin, box([3, 0, 0, 0]));
    expect(separated).toMatchObject({
      status: 'separated',
      intersects: false,
      penetrationDepth: null,
      normal: null,
      termination: { reason: 'gjk-separated' }
    });

    const touching = epaPenetration4(origin, box([2, 0, 0, 0]));
    expect(touching.status).toBe('touching');
    expect(touching.intersects).toBe(true);
    expect(touching.penetrationDepth).toBeCloseTo(0, 12);
    expect(touching.patch).not.toBeNull();
  });

  it('agrees with complete hyperbox SAT over deterministic full-SO(4) overlaps', () => {
    let state = 0xc51a_40e7;
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    const origin = box([0, 0, 0, 0]);
    let compared = 0;
    for (let sample = 0; sample < 1_200 && compared < 500; sample++) {
      const rotation = Rotor4.fromPlanes([
        { i: 0, j: 3, angle: random() * 1.2 - 0.6 },
        { i: 1, j: 2, angle: random() * 1.2 - 0.6 },
        { i: 0, j: 2, angle: random() * 0.8 - 0.4 }
      ]);
      const other = box(
        [
          random() * 2.4 - 1.2,
          random() * 2.4 - 1.2,
          random() * 2.4 - 1.2,
          random() * 2.4 - 1.2
        ],
        rotation
      );
      const sat = hyperboxSat4(origin, other);
      if (!sat.intersects || sat.penetrationDepth < 1e-5) continue;
      const epa = epaPenetration4(origin, other);
      expect(epa.status).toBe('penetrating');
      expect(epa.penetrationDepth).toBeCloseTo(sat.penetrationDepth, 7);
      expect(Math.abs(epa.normal!.dot(sat.axis))).toBeCloseTo(1, 6);
      expect(epa.errorBound).toBeLessThan(1e-7);
      expect(epa.lowerBound!).toBeLessThanOrEqual(sat.penetrationDepth + 1e-8);
      expect(epa.upperBound!).toBeGreaterThanOrEqual(sat.penetrationDepth - 1e-8);
      compared++;
    }
    expect(compared).toBe(500);
  });

  it('handles general convex hulls without a shape-specific SAT route', () => {
    const source = ConvexHullSupportShapeN.fromCellComplex(
      createSimplex({ dim: 4, edgeLength: 2 })
    );
    const shapeA = new TransformedSupportShapeN(source);
    const shapeB = new TransformedSupportShapeN(
      source,
      new TransformN(
        4,
        Rotor4.fromPlanes([
          { i: 0, j: 3, angle: 0.31 },
          { i: 1, j: 2, angle: -0.27 }
        ]),
        new VecN([0.15, -0.1, 0.2, 0.05])
      )
    );
    const result = epaPenetration4(shapeA, shapeB);
    expect(result.status).toBe('penetrating');
    expect(result.penetrationDepth).toBeGreaterThan(0);
    expect(result.facet?.featurePairs).toHaveLength(4);
    expect(result.facet?.witnessResidual).toBeLessThan(1e-8);
  });

  it('reports a rank-deficient intersecting seed as indeterminate', () => {
    const square = new ConvexHullSupportShapeN(4, [
      -1, -1, 0, 0,
       1, -1, 0, 0,
       1,  1, 0, 0,
      -1,  1, 0, 0
    ]);
    const result = epaPenetration4(square, square);
    expect(result).toMatchObject({
      status: 'indeterminate',
      intersects: null,
      penetrationDepth: null,
      patch: null,
      termination: { reason: 'degenerate-seed' }
    });
  });

  it('exposes a finite EPA budget without returning an uncertified smooth witness', () => {
    const result = epaPenetration4(
      new GlomeSupportShapeN([0, 0, 0, 0], 1),
      new GlomeSupportShapeN([1.5, 0, 0, 0], 1),
      { maxIterations: 1 }
    );
    expect(result).toMatchObject({
      status: 'indeterminate',
      intersects: null,
      penetrationDepth: null,
      normal: null,
      patch: null,
      termination: {
        reason: 'iteration-limit',
        expansionIterations: 1
      }
    });
    expect(result.lowerBound).not.toBeNull();
  });

  it('validates dimension and every numerical policy', () => {
    expect(() => epaPenetration4(
      new ConvexHullSupportShapeN(3, [0, 0, 0]),
      new ConvexHullSupportShapeN(3, [0, 0, 0])
    )).toThrow(/R4/);
    expect(() => epaPenetration4(
      new ConvexHullSupportShapeN(4, [0, 0, 0, 0]),
      new ConvexHullSupportShapeN(3, [0, 0, 0])
    )).toThrow(/dimensions differ/);
    const first = box([0, 0, 0, 0]);
    const second = box([1, 0, 0, 0]);
    expect(() => epaPenetration4(first, second, { maxIterations: 0 }))
      .toThrow(/maxIterations/);
    expect(() => epaPenetration4(first, second, {
      visibilityTolerance: Number.NaN
    })).toThrow(/visibilityTolerance/);
  });
});
