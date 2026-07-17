import { describe, expect, it } from 'vitest';
import {
  Rotor4,
  TransformN,
  VecN,
  createHypercube,
  integerRing,
  type ExactValue
} from '@holotope/core';
import {
  ConvexHullSupportShapeN,
  GlomeSupportShapeN,
  HyperplaneColliderN,
  RoundedSupportShapeN,
  TransformedSupportShapeN,
  createExactRingGjkSignOracle,
  gjkDistance,
  gjkMarginDistance,
  querySupportShapeHyperplane,
  type ExactSupportCoordinatesN,
  type SupportFeatureId
} from '../src/index.js';

function expectVectorClose(
  actual: VecN,
  expected: ArrayLike<number>,
  digits = 11
): void {
  expect(actual.dim).toBe(expected.length);
  for (let axis = 0; axis < actual.dim; axis++) {
    expect(actual.data[axis]!).toBeCloseTo(expected[axis]!, digits);
  }
}

function translatedHypercube(
  dim: number,
  center: ArrayLike<number>,
  size = 2
): ConvexHullSupportShapeN {
  const complex = createHypercube({ dim, size });
  for (let vertex = 0; vertex < complex.vertexCount; vertex++) {
    for (let axis = 0; axis < dim; axis++) {
      complex.positions[vertex * dim + axis]! += center[axis]!;
    }
  }
  return ConvexHullSupportShapeN.fromCellComplex(complex);
}

function exactIntegerCoordinates(shape: ConvexHullSupportShapeN): ExactSupportCoordinatesN {
  return {
    dim: shape.dim,
    ring: integerRing,
    coordinates(featureId: SupportFeatureId): readonly ExactValue[] | undefined {
      if (
        typeof featureId !== 'number' ||
        !Number.isSafeInteger(featureId) ||
        featureId < 0 ||
        featureId >= shape.vertexCount
      ) {
        return undefined;
      }
      return Array.from({ length: shape.dim }, (_, axis) => ({
        a: BigInt(shape.positions[featureId * shape.dim + axis]!),
        b: 0n
      }));
    }
  };
}

describe('convex support mappings', () => {
  it('finds the same transformed hull support as a brute-force world scan', () => {
    const source = ConvexHullSupportShapeN.fromCellComplex(
      createHypercube({ dim: 4, size: 2 })
    );
    const rotation = Rotor4.fromPlanes([
      { i: 0, j: 3, angle: 0.62 },
      { i: 1, j: 2, angle: -0.37 }
    ]);
    const translation = new VecN([3, -2, 1, 0.5]);
    const shape = new TransformedSupportShapeN(
      source,
      new TransformN(4, rotation, translation)
    );
    const direction = new VecN([0.3, -0.8, 1.1, 0.45]);
    const support = shape.support(direction);

    let bruteDot = Number.NEGATIVE_INFINITY;
    let bruteFeature = -1;
    for (let vertex = 0; vertex < source.vertexCount; vertex++) {
      const local = new VecN(
        source.positions.subarray(vertex * 4, vertex * 4 + 4)
      );
      const world = rotation.applyToPoint(local).add(translation);
      const dot = world.dot(direction);
      if (dot > bruteDot) {
        bruteDot = dot;
        bruteFeature = vertex;
      }
    }
    expect(support.point.dot(direction)).toBeCloseTo(bruteDot, 13);
    expect(support.featureId).toBe(bruteFeature);
  });

  it('implements analytic N-ball and rounded-core support without aliasing', () => {
    const direction = new VecN([3, 4, 0, 0]);
    const glome = new GlomeSupportShapeN([1, 2, 3, 4], 2);
    expectVectorClose(glome.support(direction).point, [2.2, 3.6, 3, 4], 14);

    const cachedPoint = new VecN([1, 0, 0, 0]);
    const rounded = new RoundedSupportShapeN(
      {
        dim: 4,
        center: new VecN(4),
        support: () => ({ point: cachedPoint, featureId: 0 })
      },
      0.5
    );
    expectVectorClose(rounded.support(new VecN([1, 0, 0, 0])).point, [1.5, 0, 0, 0]);
    expectVectorClose(cachedPoint, [1, 0, 0, 0]);
  });
});

describe('dimension-generic GJK distance', () => {
  it('matches the analytic separated and overlapping glome cases in R4', () => {
    const left = new GlomeSupportShapeN([0, 0, 0, 0], 1);
    const right = new GlomeSupportShapeN([3, 0, 0, 0], 1);
    const separated = gjkDistance(left, right, { recordTrace: true });

    expect(separated.status).toBe('separated');
    expect(separated.intersects).toBe(false);
    expect(separated.distance).toBeCloseTo(1, 13);
    expectVectorClose(separated.closestPointA, [1, 0, 0, 0]);
    expectVectorClose(separated.closestPointB, [2, 0, 0, 0]);
    expectVectorClose(separated.normal!, [-1, 0, 0, 0]);
    expect(separated.trace!.length).toBeGreaterThan(0);

    const overlapping = gjkDistance(
      left,
      new GlomeSupportShapeN([1.5, 0, 0, 0], 1)
    );
    expect(overlapping.status).toBe('intersecting');
    expect(overlapping.intersects).toBe(true);
    expect(overlapping.distance).toBe(0);
    expect(overlapping.normal).toBeNull();
  });

  it('matches the closed-form distance for deterministic 4D box pairs', () => {
    const origin = translatedHypercube(4, [0, 0, 0, 0]);
    let state = 0x7f4a7c15;
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    for (let sample = 0; sample < 400; sample++) {
      const center = Array.from({ length: 4 }, () => 8 * random() - 4);
      const other = translatedHypercube(4, center);
      const result = gjkDistance(origin, other);
      const analytic = Math.hypot(
        ...center.map((coordinate) => Math.max(Math.abs(coordinate) - 2, 0))
      );
      expect(result.intersects).not.toBeNull();
      expect(result.distance).toBeCloseTo(analytic, 9);
      expect(result.intersects).toBe(analytic <= 1e-12);
      expect(result.simplex.length).toBeLessThanOrEqual(5);
      expect(result.termination.maxSimplexSize).toBeLessThanOrEqual(5);
    }
  });

  it('handles touching boxes and preserves witness symmetry under argument reversal', () => {
    const left = translatedHypercube(4, [0, 0, 0, 0]);
    const touching = translatedHypercube(4, [2, 0, 0, 0]);
    expect(gjkDistance(left, touching).intersects).toBe(true);

    const right = translatedHypercube(4, [3, 4, 0.5, -0.25]);
    const forward = gjkDistance(left, right);
    const reverse = gjkDistance(right, left);
    expect(forward.distance).toBeCloseTo(reverse.distance, 12);
    expectVectorClose(forward.closestPointA, reverse.closestPointB.data, 11);
    expectVectorClose(forward.closestPointB, reverse.closestPointA.data, 11);
    expectVectorClose(forward.normal!, reverse.normal!.clone().multiplyScalar(-1).data, 11);
  });

  it('uses the same kernel in R3', () => {
    const left = new GlomeSupportShapeN([0, 0, 0], 0.5);
    const right = new GlomeSupportShapeN([1, 2, 2], 0.5);
    const result = gjkDistance(left, right);
    expect(result.distance).toBeCloseTo(2, 13);
    expect(result.simplex.length).toBeLessThanOrEqual(4);
  });

  it('reduces rank-deficient R4 simplices without inventing a full-dimensional hull', () => {
    const square = new ConvexHullSupportShapeN(4, [
      -1, -1, 0, 0,
       1, -1, 0, 0,
       1,  1, 0, 0,
      -1,  1, 0, 0
    ]);
    const displaced = new ConvexHullSupportShapeN(4, [
      -1, -1, 0, 2,
       1, -1, 0, 2,
       1,  1, 0, 2,
      -1,  1, 0, 2
    ]);
    const separated = gjkDistance(square, displaced);
    expect(separated.intersects).toBe(false);
    expect(separated.distance).toBeCloseTo(2, 13);
    expect(separated.simplexCertificate.conditionEstimate).toBeGreaterThan(0);
    expect(gjkDistance(square, square).intersects).toBe(true);
  });

  it('reports exact-ring branch provenance for exact-coordinate hulls', () => {
    const left = translatedHypercube(4, [0, 0, 0, 0]);
    const right = translatedHypercube(4, [1, 1, 1, 1]);
    const signOracle = createExactRingGjkSignOracle(
      exactIntegerCoordinates(left),
      exactIntegerCoordinates(right)
    );
    const result = gjkDistance(left, right, { signOracle, recordTrace: true });

    expect(result.intersects).toBe(true);
    expect(result.termination.exactPredicateCalls).toBeGreaterThan(0);
    expect(result.simplexCertificate.predicateSource).toBe('exact-ring:integer');
  });

  it('rehydrates feature-pair warm starts across coherent R4 motion', () => {
    const hull = ConvexHullSupportShapeN.fromCellComplex(
      createHypercube({ dim: 4, size: 2 })
    );
    const left = new TransformedSupportShapeN(hull);
    const right = new TransformedSupportShapeN(hull);
    const pose = (step: number): TransformN => new TransformN(
      4,
      Rotor4.fromPlanes([
        { i: 0, j: 3, angle: 0.31 + step * 0.0007 },
        { i: 1, j: 2, angle: -0.24 + step * 0.0004 }
      ]),
      new VecN([3.2 + step * 0.001, 1.4 - step * 0.0005, 0.65, -0.3])
    );
    right.transform = pose(0);
    let previous = gjkDistance(left, right);
    let coldIterations = 0;
    let warmIterations = 0;
    for (let step = 1; step <= 120; step++) {
      right.transform = pose(step);
      const cold = gjkDistance(left, right);
      const warm = gjkDistance(left, right, { warmStart: previous.warmStart });
      expect(warm.distance).toBeCloseTo(cold.distance, 11);
      expect(warm.intersects).toBe(cold.intersects);
      expect(warm.termination.warmStartSize).toBeGreaterThan(0);
      coldIterations += cold.iterations;
      warmIterations += warm.iterations;
      previous = warm;
    }
    expect(warmIterations).toBeLessThan(coldIterations);

    const smoothA = new GlomeSupportShapeN([0, 0, 0, 0], 1);
    const smoothB = new GlomeSupportShapeN([3, 0, 0, 0], 1);
    const smooth = gjkDistance(smoothA, smoothB);
    const smoothWarm = gjkDistance(smoothA, smoothB, { warmStart: smooth.warmStart });
    expect(smoothWarm.distance).toBeCloseTo(smooth.distance, 13);
    expect(smoothWarm.termination.warmStartSize).toBe(0);
  });

  it('validates shape and option contracts explicitly', () => {
    const shape4 = new GlomeSupportShapeN([0, 0, 0, 0], 1);
    expect(() => gjkDistance(shape4, new GlomeSupportShapeN([0, 0, 0], 1))).toThrow(
      /dimensions differ/
    );
    expect(() => gjkDistance(shape4, shape4, { maxIterations: 0 })).toThrow(
      /positive integer/
    );
    expect(() => gjkDistance(shape4, shape4, { initialDirection: [0, 0, 0, 0] }))
      .toThrow(/nonzero finite/);
    expect(() => gjkDistance(shape4, shape4, {
      warmStart: { dim: 3, direction: new VecN([1, 0, 0]), featurePairs: [] }
    })).toThrow(/warmStart dimension/);
  });
});

describe('GJK shallow margin contact', () => {
  it('reports separation and margin penetration while cores remain apart', () => {
    const left = new GlomeSupportShapeN([0, 0, 0, 0], 0);
    const separated = gjkMarginDistance(
      left,
      new GlomeSupportShapeN([3, 0, 0, 0], 0),
      { marginA: 1, marginB: 1 }
    );
    expect(separated.status).toBe('separated');
    expect(separated.intersects).toBe(false);
    expect(separated.signedDistance).toBeCloseTo(1, 14);
    expect(separated.distance).toBeCloseTo(1, 14);
    expect(separated.penetrationDepth).toBe(0);
    expectVectorClose(separated.closestPointA!, [1, 0, 0, 0]);
    expectVectorClose(separated.closestPointB!, [2, 0, 0, 0]);

    const contact = gjkMarginDistance(
      left,
      new GlomeSupportShapeN([1.5, 0, 0, 0], 0),
      { marginA: 1, marginB: 1 }
    );
    expect(contact.status).toBe('margin-contact');
    expect(contact.intersects).toBe(true);
    expect(contact.signedDistance).toBeCloseTo(-0.5, 14);
    expect(contact.penetrationDepth).toBeCloseTo(0.5, 14);
    expectVectorClose(contact.normal!, [-1, 0, 0, 0]);
    expectVectorClose(contact.closestPointA!, [1, 0, 0, 0]);
    expectVectorClose(contact.closestPointB!, [0.5, 0, 0, 0]);
    expectVectorClose(contact.contactPoint!, [0.75, 0, 0, 0]);
  });

  it('refuses to fabricate penetration data after convex cores contact', () => {
    const left = translatedHypercube(4, [0, 0, 0, 0]);
    const right = translatedHypercube(4, [1, 0, 0, 0]);
    const result = gjkMarginDistance(left, right, { marginA: 0.1, marginB: 0.2 });
    expect(result.status).toBe('core-contact');
    expect(result.intersects).toBe(true);
    expect(result.signedDistance).toBeNull();
    expect(result.penetrationDepth).toBeNull();
    expect(result.normal).toBeNull();
    expect(result.contactPoint).toBeNull();
  });

  it('validates margins', () => {
    const point = new GlomeSupportShapeN([0, 0, 0, 0], 0);
    expect(() => gjkMarginDistance(point, point, { marginA: -1, marginB: 0 }))
      .toThrow(/marginA/);
  });
});

describe('analytic support-shape hyperplane query', () => {
  it('normalizes the plane equation and returns closest witnesses', () => {
    const plane = new HyperplaneColliderN([0, 2, 0, 0], 4);
    const shape = new GlomeSupportShapeN([0, 3, 0, 0], 0.5);
    const result = querySupportShapeHyperplane(shape, plane);
    expect(result.status).toBe('separated');
    expect(result.signedDistance).toBeCloseTo(0.5, 14);
    expectVectorClose(result.normal, [0, 1, 0, 0]);
    expectVectorClose(result.pointOnShape, [0, 2.5, 0, 0]);
    expectVectorClose(result.pointOnPlane, [0, 2, 0, 0]);
  });

  it('distinguishes touching and penetration along an ordinary or hidden axis', () => {
    const floor = new HyperplaneColliderN([0, 1, 0, 0]);
    const touching = translatedHypercube(4, [0, 1, 0, 0]);
    const touch = querySupportShapeHyperplane(touching, floor);
    expect(touch.status).toBe('touching');
    expect(touch.signedDistance).toBeCloseTo(0, 14);

    const penetrating = translatedHypercube(4, [0, 0.5, 0, 0]);
    const penetration = querySupportShapeHyperplane(penetrating, floor);
    expect(penetration.status).toBe('penetrating');
    expect(penetration.penetrationDepth).toBeCloseTo(0.5, 14);

    const hiddenFloor = new HyperplaneColliderN([0, 0, 0, 1], -2);
    const hidden = querySupportShapeHyperplane(
      new GlomeSupportShapeN([0, 0, 0, 0], 1),
      hiddenFloor
    );
    expect(hidden.status).toBe('separated');
    expect(hidden.distance).toBeCloseTo(1, 14);
  });

  it('validates plane and dimension contracts', () => {
    expect(() => new HyperplaneColliderN([0, 0, 0, 0])).toThrow(/nonzero/);
    expect(() => querySupportShapeHyperplane(
      new GlomeSupportShapeN([0, 0, 0], 1),
      new HyperplaneColliderN([0, 1, 0, 0])
    )).toThrow(/dimension/);
  });
});
