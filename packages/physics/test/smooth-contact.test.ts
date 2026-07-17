import { VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  GlomeSupportShapeN,
  HyperplaneColliderN,
  glomeGlomeContactN,
  glomeHyperplaneContactN,
  querySupportShapeHyperplane
} from '../src/index.js';

function expectVector(actual: VecN, expected: ArrayLike<number>, digits = 13): void {
  expect(actual.dim).toBe(expected.length);
  for (let axis = 0; axis < actual.dim; axis++) {
    expect(actual.data[axis]).toBeCloseTo(expected[axis]!, digits);
  }
}

function expectAlignedPatch(
  pointA: VecN,
  pointB: VecN,
  translationA: VecN,
  resolvedPoint: VecN
): void {
  const movedA = pointA.clone().add(translationA);
  expectVector(movedA, pointB.data);
  expectVector(resolvedPoint, pointB.data);
}

describe('glomeGlomeContactN', () => {
  it('returns exact ordered witnesses in R1 through R8', () => {
    for (let dim = 1; dim <= 8; dim++) {
      const centerA = new Float64Array(dim);
      const centerB = new Float64Array(dim);
      centerB[0] = 1.5;
      const shapeA = new GlomeSupportShapeN(centerA, 1);
      const shapeB = new GlomeSupportShapeN(centerB, 1);
      const result = glomeGlomeContactN(shapeA, shapeB);

      expect(result.status).toBe('overlapping');
      expect(result.intersects).toBe(true);
      expect(result.signedDistance).toBeCloseTo(-0.5, 14);
      expect(result.penetrationDepth).toBeCloseTo(0.5, 14);
      expectVector(result.normal!, [-1, ...new Array(dim - 1).fill(0)]);
      expectVector(result.pointA!, [1, ...new Array(dim - 1).fill(0)]);
      expectVector(result.pointB!, [0.5, ...new Array(dim - 1).fill(0)]);
      expect(result.patch?.alignmentShift).toBeCloseTo(0.5, 14);
      expectAlignedPatch(
        result.pointA!,
        result.pointB!,
        result.patch!.translationA,
        result.patch!.resolvedPoint
      );
    }
  });

  it('classifies separation, tolerance contact, and expanded-radius contact', () => {
    const shapeA = new GlomeSupportShapeN([0, 0, 0], 1);
    const shapeB = new GlomeSupportShapeN([2.25, 0, 0], 1);

    const separated = glomeGlomeContactN(shapeA, shapeB);
    expect(separated).toMatchObject({
      status: 'separated',
      intersects: false,
      distance: 0.25,
      penetrationDepth: 0,
      patch: null
    });
    expectVector(separated.pointA!, [1, 0, 0]);
    expectVector(separated.pointB!, [1.25, 0, 0]);

    const toleranceContact = glomeGlomeContactN(shapeA, shapeB, {
      tolerance: 0.3
    });
    expect(toleranceContact.status).toBe('touching');
    expect(toleranceContact.patch?.alignmentShift).toBeCloseTo(-0.25, 14);
    expectAlignedPatch(
      toleranceContact.pointA!,
      toleranceContact.pointB!,
      toleranceContact.patch!.translationA,
      toleranceContact.patch!.resolvedPoint
    );

    const expanded = glomeGlomeContactN(shapeA, shapeB, {
      marginA: 0.1,
      marginB: 0.2
    });
    expect(expanded.status).toBe('overlapping');
    expect(expanded.signedDistance).toBeCloseTo(-0.05, 14);
    expect(expanded.effectiveRadiusA).toBeCloseTo(1.1, 14);
    expect(expanded.effectiveRadiusB).toBeCloseTo(1.2, 14);
  });

  it('is symmetric under ordered-shape reversal', () => {
    const shapeA = new GlomeSupportShapeN([1, -2, 3, 0], 1.25);
    const shapeB = new GlomeSupportShapeN([-1, 1, 0, 2], 2.5);
    const forward = glomeGlomeContactN(shapeA, shapeB, {
      marginA: 0.2,
      marginB: 0.3
    });
    const reverse = glomeGlomeContactN(shapeB, shapeA, {
      marginA: 0.3,
      marginB: 0.2
    });

    expect(reverse.status).toBe(forward.status);
    expect(reverse.signedDistance).toBeCloseTo(forward.signedDistance, 14);
    expectVector(reverse.normal!, forward.normal!.clone().multiplyScalar(-1).data);
    expectVector(reverse.pointA!, forward.pointB!.data);
    expectVector(reverse.pointB!, forward.pointA!.data);
  });

  it('reports the non-unique coincident-center MTV without inventing a normal', () => {
    const result = glomeGlomeContactN(
      new GlomeSupportShapeN([1, 2, 3, 4], 1),
      new GlomeSupportShapeN([1, 2, 3, 4], 2)
    );
    expect(result).toMatchObject({
      status: 'coincident-centers',
      intersects: true,
      signedDistance: -3,
      penetrationDepth: 3,
      normal: null,
      pointA: null,
      pointB: null,
      patch: null
    });
  });

  it('revalidates mutable inputs and rejects malformed options', () => {
    const valid = new GlomeSupportShapeN([0, 0], 1);
    expect(() => glomeGlomeContactN(valid, new GlomeSupportShapeN([0, 0, 0], 1)))
      .toThrow(/dimensions differ/);
    expect(() => glomeGlomeContactN(valid, valid, { marginA: -1 }))
      .toThrow(/marginA/);
    expect(() => glomeGlomeContactN(valid, valid, { tolerance: Number.NaN }))
      .toThrow(/tolerance/);
    valid.radius = Number.POSITIVE_INFINITY;
    expect(() => glomeGlomeContactN(valid, valid)).toThrow(/finite center/);
  });
});

describe('glomeHyperplaneContactN', () => {
  it('preserves ordered B-to-A normals and witness roles in either order', () => {
    const glome = new GlomeSupportShapeN([1, 0.5, 3, 4], 1);
    const plane = new HyperplaneColliderN([0, 2, 0, 0], 0);
    const glomeFirst = glomeHyperplaneContactN(glome, plane);

    expect(glomeFirst).toMatchObject({
      status: 'overlapping',
      intersects: true,
      signedDistance: -0.5,
      penetrationDepth: 0.5,
      shapeAType: 'glome',
      shapeBType: 'hyperplane'
    });
    expectVector(glomeFirst.normal, [0, 1, 0, 0]);
    expectVector(glomeFirst.pointA, [1, -0.5, 3, 4]);
    expectVector(glomeFirst.pointB, [1, 0, 3, 4]);
    expectAlignedPatch(
      glomeFirst.pointA,
      glomeFirst.pointB,
      glomeFirst.patch!.translationA,
      glomeFirst.patch!.resolvedPoint
    );

    const planeFirst = glomeHyperplaneContactN(plane, glome);
    expect(planeFirst.shapeAType).toBe('hyperplane');
    expect(planeFirst.shapeBType).toBe('glome');
    expect(planeFirst.signedDistance).toBeCloseTo(glomeFirst.signedDistance, 14);
    expectVector(planeFirst.normal, [0, -1, 0, 0]);
    expectVector(planeFirst.pointA, glomeFirst.pointB.data);
    expectVector(planeFirst.pointB, glomeFirst.pointA.data);
    expectAlignedPatch(
      planeFirst.pointA,
      planeFirst.pointB,
      planeFirst.patch!.translationA,
      planeFirst.patch!.resolvedPoint
    );
  });

  it('matches the support-shape hyperplane golden query in arbitrary dimensions', () => {
    let state = 0x71e5_2a9d;
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    for (let dim = 1; dim <= 8; dim++) {
      for (let sample = 0; sample < 100; sample++) {
        const center = Array.from({ length: dim }, () => random() * 6 - 3);
        const normal = Array.from({ length: dim }, () => random() * 2 - 1);
        if (normal.every((value) => value === 0)) normal[0] = 1;
        const radius = random() * 2;
        const offset = random() * 4 - 2;
        const glome = new GlomeSupportShapeN(center, radius);
        const plane = new HyperplaneColliderN(normal, offset);
        const exact = glomeHyperplaneContactN(glome, plane);
        const golden = querySupportShapeHyperplane(glome, plane);

        expect(exact.signedDistance).toBeCloseTo(golden.signedDistance, 12);
        expectVector(exact.normal, golden.normal.data, 12);
        expectVector(exact.pointA, golden.pointOnShape.data, 12);
        expectVector(exact.pointB, golden.pointOnPlane.data, 12);
      }
    }
  });

  it('classifies separation, touching, overlap, and a glome margin exactly', () => {
    const plane = new HyperplaneColliderN([0, 1, 0], 0);
    const separated = glomeHyperplaneContactN(
      new GlomeSupportShapeN([0, 2, 0], 0.5),
      plane
    );
    expect(separated.status).toBe('separated');
    expect(separated.signedDistance).toBeCloseTo(1.5, 14);
    expect(separated.patch).toBeNull();

    const touching = glomeHyperplaneContactN(
      new GlomeSupportShapeN([0, 1, 0], 1),
      plane
    );
    expect(touching.status).toBe('touching');
    expect(touching.patch?.alignmentShift).toBeCloseTo(0, 14);

    const expanded = glomeHyperplaneContactN(
      new GlomeSupportShapeN([0, 1, 0], 0.75),
      plane,
      { glomeMargin: 0.5 }
    );
    expect(expanded.status).toBe('overlapping');
    expect(expanded.signedDistance).toBeCloseTo(-0.25, 14);
    expect(expanded.effectiveRadius).toBeCloseTo(1.25, 14);
  });

  it('requires exactly one same-dimensional glome and plane', () => {
    const glome2 = new GlomeSupportShapeN([0, 0], 1);
    const glome3 = new GlomeSupportShapeN([0, 0, 0], 1);
    const plane2 = new HyperplaneColliderN([0, 1], 0);
    const plane3 = new HyperplaneColliderN([0, 1, 0], 0);
    expect(() => glomeHyperplaneContactN(glome2, glome2)).toThrow(/exactly one/);
    expect(() => glomeHyperplaneContactN(plane2, plane2)).toThrow(/exactly one/);
    expect(() => glomeHyperplaneContactN(glome2, plane3)).toThrow(/dimensions differ/);
    expect(() => glomeHyperplaneContactN(plane2, glome3)).toThrow(/dimensions differ/);
    expect(() => glomeHyperplaneContactN(glome2, plane2, { glomeMargin: -1 }))
      .toThrow(/glomeMargin/);
  });
});
