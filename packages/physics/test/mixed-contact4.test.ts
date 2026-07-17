import { Rotor4, TransformN, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  GlomeSupportShapeN,
  HyperboxSupportShape4,
  HyperplaneColliderN,
  gjkDistance,
  glomeHyperboxContact4,
  hyperboxHyperplaneContact4,
  querySupportShapeHyperplane
} from '../src/index.js';

function box(
  center: ArrayLike<number> = [0, 0, 0, 0],
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
  digits = 13
): void {
  expect(actual.dim).toBe(expected.length);
  for (let axis = 0; axis < actual.dim; axis++) {
    expect(actual.data[axis]).toBeCloseTo(expected[axis]!, digits);
  }
}

describe('glomeHyperboxContact4', () => {
  it('returns exact ordered face witnesses outside the box core', () => {
    const glome = new GlomeSupportShapeN([1.5, 0, 0, 0], 1);
    const hyperbox = box();
    const result = glomeHyperboxContact4(glome, hyperbox);

    expect(result).toMatchObject({
      status: 'overlapping',
      intersects: true,
      signedDistance: -0.5,
      penetrationDepth: 0.5,
      shapeAType: 'glome',
      shapeBType: 'hyperbox',
      glomeCenterInsideCore: false
    });
    expectVector(result.normal!, [1, 0, 0, 0]);
    expectVector(result.pointA!, [0.5, 0, 0, 0]);
    expectVector(result.pointB!, [1, 0, 0, 0]);
    expectVector(result.patch!.resolvedPoint, result.pointB!.data);
    expect(result.boxFeature).toEqual({
      positiveMask: 1,
      negativeMask: 0,
      dimension: 3
    });

    const reverse = glomeHyperboxContact4(hyperbox, glome);
    expect(reverse.signedDistance).toBeCloseTo(result.signedDistance, 14);
    expectVector(reverse.normal!, [-1, 0, 0, 0]);
    expectVector(reverse.pointA!, result.pointB!.data);
    expectVector(reverse.pointB!, result.pointA!.data);
    expectVector(reverse.patch!.resolvedPoint, reverse.pointB!.data);
  });

  it('uses the Euclidean rounded-corner distance and both spherical margins', () => {
    const result = glomeHyperboxContact4(
      new GlomeSupportShapeN([1.5, 1.5, 0, 0], 0.5),
      box(),
      { glomeMargin: 0.1, hyperboxMargin: 0.2 }
    );
    expect(result.signedDistance).toBeCloseTo(Math.sqrt(0.5) - 0.8, 14);
    expectVector(result.normal!, [Math.SQRT1_2, Math.SQRT1_2, 0, 0]);
    expect(result.effectiveGlomeRadius).toBeCloseTo(0.6, 14);
    expect(result.hyperboxMargin).toBeCloseTo(0.2, 14);
    expect(result.boxFeature?.dimension).toBe(2);
  });

  it('chooses the unique minimum exit for an interior center', () => {
    const result = glomeHyperboxContact4(
      new GlomeSupportShapeN([0.8, 0, 0, 0], 0.25),
      box()
    );
    expect(result.status).toBe('overlapping');
    expect(result.glomeCenterInsideCore).toBe(true);
    expect(result.penetrationDepth).toBeCloseTo(0.45, 14);
    expectVector(result.normal!, [1, 0, 0, 0]);
    expectVector(result.pointA!, [0.55, 0, 0, 0]);
    expectVector(result.pointB!, [1, 0, 0, 0]);
    expectVector(result.patch!.resolvedPoint, result.pointB!.data);
  });

  it('exposes a non-unique interior MTV instead of inventing a normal', () => {
    const result = glomeHyperboxContact4(
      new GlomeSupportShapeN([0, 0, 0, 0], 0.25),
      box()
    );
    expect(result).toMatchObject({
      status: 'ambiguous-interior',
      intersects: true,
      signedDistance: -1.25,
      penetrationDepth: 1.25,
      normal: null,
      patch: null,
      boxFeature: null
    });
  });

  it('matches GJK separation for translated and rotated boxes', () => {
    let state = 0x3ad9_174b;
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    for (let sample = 0; sample < 120; sample++) {
      const rotation = Rotor4.fromPlane(0, 3, random() * 2 - 1)
        .multiply(Rotor4.fromPlane(1, 2, random() * 2 - 1));
      const hyperbox = box(
        [random() * 2 - 1, random() * 2 - 1, random() * 2 - 1, random() * 2 - 1],
        rotation
      );
      const direction = new VecN([
        random() * 2 - 1,
        random() * 2 - 1,
        random() * 2 - 1,
        random() * 2 - 1
      ]).normalize();
      const center = hyperbox.center.add(direction.multiplyScalar(5 + random()));
      const glome = new GlomeSupportShapeN(center, 0.1 + random() * 0.5);
      const exact = glomeHyperboxContact4(glome, hyperbox);
      const golden = gjkDistance(glome, hyperbox);
      expect(exact.status).toBe('separated');
      expect(exact.signedDistance).toBeCloseTo(golden.distance, 11);
    }
  });

  it('validates shape family, dimension, mutable radius, and options', () => {
    const glome = new GlomeSupportShapeN([0, 0, 0, 0], 1);
    const hyperbox = box();
    expect(() => glomeHyperboxContact4(glome, glome)).toThrow(/exactly one/);
    expect(() => glomeHyperboxContact4(hyperbox, hyperbox)).toThrow(/exactly one/);
    expect(() => glomeHyperboxContact4(
      new GlomeSupportShapeN([0, 0, 0], 1),
      hyperbox
    )).toThrow(/R4/);
    expect(() => glomeHyperboxContact4(glome, hyperbox, { glomeMargin: -1 }))
      .toThrow(/glomeMargin/);
    expect(() => glomeHyperboxContact4(glome, hyperbox, {
      degeneracyTolerance: Number.NaN
    })).toThrow(/degeneracyTolerance/);
    glome.radius = Number.POSITIVE_INFINITY;
    expect(() => glomeHyperboxContact4(glome, hyperbox)).toThrow(/finite R4/);
  });
});

describe('hyperboxHyperplaneContact4', () => {
  it('returns the complete ordered facet patch against an axis plane', () => {
    const hyperbox = box([0, 0.5, 0, 0]);
    const plane = new HyperplaneColliderN([0, 1, 0, 0], 0);
    const result = hyperboxHyperplaneContact4(hyperbox, plane);

    expect(result).toMatchObject({
      status: 'overlapping',
      intersects: true,
      signedDistance: -0.5,
      penetrationDepth: 0.5,
      shapeAType: 'hyperbox',
      shapeBType: 'hyperplane'
    });
    expectVector(result.normal, [0, 1, 0, 0]);
    expect(result.patch).toMatchObject({
      kind: 'polyhedron',
      intrinsicDim: 3,
      boxRole: 'a',
      penetrationDepth: 0.5
    });
    expect(result.patch!.vertices).toHaveLength(8);
    expect(result.patch!.maxResolvedPlaneResidual).toBeLessThan(1e-13);
    for (const vertex of result.patch!.vertices) {
      expectVector(
        vertex.pointA.clone().add(result.patch!.translationA),
        vertex.pointB.data
      );
      expectVector(vertex.resolvedPoint, vertex.pointB.data);
    }

    const reverse = hyperboxHyperplaneContact4(plane, hyperbox);
    expect(reverse.signedDistance).toBeCloseTo(result.signedDistance, 14);
    expectVector(reverse.normal, [0, -1, 0, 0]);
    expect(reverse.patch?.boxRole).toBe('b');
    expect(reverse.patch?.vertices.map(({ pointA }) => Array.from(pointA.data)))
      .toEqual(result.patch?.vertices.map(({ pointB }) => Array.from(pointB.data)));
  });

  it('retains the support-feature dimension from facet through vertex', () => {
    const cases = [
      { normal: [1, 0, 0, 0], offset: -1, kind: 'polyhedron', count: 8 },
      { normal: [1, 1, 0, 0], offset: -2, kind: 'polygon', count: 4 },
      { normal: [1, 1, 1, 0], offset: -3, kind: 'segment', count: 2 },
      { normal: [1, 1, 1, 1], offset: -4, kind: 'point', count: 1 }
    ] as const;
    for (const { normal, offset, kind, count } of cases) {
      const result = hyperboxHyperplaneContact4(
        box(),
        new HyperplaneColliderN(normal, offset)
      );
      expect(result.status).toBe('touching');
      expect(result.patch?.kind).toBe(kind);
      expect(result.patch?.vertices).toHaveLength(count);
      expect(result.patch?.intrinsicDim).toBe(Math.log2(count));
    }
  });

  it('matches the generic support-plane golden path under rotation', () => {
    let state = 0x0ab2_14cf;
    const random = (): number => {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return state / 0x1_0000_0000;
    };
    for (let sample = 0; sample < 120; sample++) {
      const hyperbox = box(
        [random() * 4 - 2, random() * 4 - 2, random() * 4 - 2, random() * 4 - 2],
        Rotor4.fromPlane(0, 2, random() * 2 - 1)
          .multiply(Rotor4.fromPlane(1, 3, random() * 2 - 1))
      );
      const normal = [
        random() * 2 - 1,
        random() * 2 - 1,
        random() * 2 - 1,
        random() * 2 - 1
      ];
      const plane = new HyperplaneColliderN(normal, random() * 4 - 2);
      const exact = hyperboxHyperplaneContact4(hyperbox, plane);
      const golden = querySupportShapeHyperplane(hyperbox, plane);
      expect(exact.signedDistance).toBeCloseTo(golden.signedDistance, 12);
      expectVector(exact.normal, golden.normal.data, 12);
    }
  });

  it('applies the hyperbox Minkowski margin exactly and validates inputs', () => {
    const hyperbox = box([0, 2, 0, 0]);
    const plane = new HyperplaneColliderN([0, 1, 0, 0], 0);
    const result = hyperboxHyperplaneContact4(hyperbox, plane, {
      hyperboxMargin: 1.25
    });
    expect(result.signedDistance).toBeCloseTo(-0.25, 14);
    expect(result.patch?.vertices).toHaveLength(8);
    expect(() => hyperboxHyperplaneContact4(hyperbox, hyperbox)).toThrow(/exactly one/);
    expect(() => hyperboxHyperplaneContact4(plane, plane)).toThrow(/exactly one/);
    expect(() => hyperboxHyperplaneContact4(hyperbox, plane, {
      hyperboxMargin: Number.NaN
    })).toThrow(/hyperboxMargin/);
    expect(() => hyperboxHyperplaneContact4(hyperbox, plane, {
      manifoldTolerance: -1
    })).toThrow(/manifoldTolerance/);
  });
});
