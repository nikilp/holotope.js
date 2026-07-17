import { type ExactRing, type ExactValue } from '@holotope/core';
import {
  type GjkBarycentricSignOracle,
  type GjkBarycentricSignResult,
  type GjkSimplexVertexN,
  type GjkSign
} from './gjk.js';
import { type SupportFeatureId } from './support-shape.js';

/**
 * Exact coordinates associated with stable support-feature IDs.
 *
 * Every coordinate is interpreted as `numerator / denominator`. A single
 * positive denominator is sufficient for integer, sqrt(2), and phi vertex
 * clouds and lets transformed/baked rational shapes retain exact predicates.
 */
export interface ExactSupportCoordinatesN {
  readonly dim: number;
  readonly ring: ExactRing;
  readonly denominator?: bigint;
  coordinates(featureId: SupportFeatureId): readonly ExactValue[] | undefined;
}

/**
 * Build a GJK branch oracle from exact feature coordinates for A and B.
 *
 * The oracle uses exact Gram determinants and Cramer's rule only for the
 * signs that select the active simplex face. GJK continues to calculate its
 * returned closest points and witnesses in Float64.
 */
export function createExactRingGjkSignOracle(
  shapeA: ExactSupportCoordinatesN,
  shapeB: ExactSupportCoordinatesN
): GjkBarycentricSignOracle {
  if (shapeA.dim !== shapeB.dim || shapeA.dim < 1) {
    throw new Error(
      `createExactRingGjkSignOracle: incompatible dimensions ${shapeA.dim} and ${shapeB.dim}`
    );
  }
  if (shapeA.ring.kind !== shapeB.ring.kind) {
    throw new Error(
      `createExactRingGjkSignOracle: incompatible rings ${shapeA.ring.kind} and ${shapeB.ring.kind}`
    );
  }
  const denominatorA = shapeA.denominator ?? 1n;
  const denominatorB = shapeB.denominator ?? 1n;
  if (denominatorA <= 0n || denominatorB <= 0n) {
    throw new Error('createExactRingGjkSignOracle: denominators must be positive');
  }
  const ring = shapeA.ring;
  const cache = new Map<string, readonly ExactValue[]>();

  return (
    simplex: readonly GjkSimplexVertexN[],
    subset: readonly number[]
  ): GjkBarycentricSignResult | undefined => {
    if (subset.length < 2) return undefined;
    const points: (readonly ExactValue[])[] = [];
    for (const index of subset) {
      const vertex = simplex[index];
      if (!vertex) return undefined;
      const key = `${featureKey(vertex.featureA)}\u0000${featureKey(vertex.featureB)}`;
      let point = cache.get(key);
      if (!point) {
        const pointA = shapeA.coordinates(vertex.featureA);
        const pointB = shapeB.coordinates(vertex.featureB);
        if (!pointA || !pointB) return undefined;
        assertExactPoint(pointA, shapeA.dim, 'shape A');
        assertExactPoint(pointB, shapeB.dim, 'shape B');
        // (a / dA) - (b / dB) has numerator a*dB - b*dA.
        // Its common positive denominator is irrelevant to barycentric signs.
        point = pointA.map((coordinateA, axis) =>
          ring.sub(
            scaleExact(coordinateA, denominatorB),
            scaleExact(pointB[axis]!, denominatorA)
          )
        );
        cache.set(key, point);
      }
      points.push(point);
    }

    const base = points[0]!;
    const edgeCount = points.length - 1;
    const edges = Array.from({ length: edgeCount }, (_, edge) =>
      subtractExactPoint(points[edge + 1]!, base, ring)
    );
    const gram = Array.from({ length: edgeCount }, (_, row) =>
      Array.from({ length: edgeCount }, (_, column) =>
        dotExact(edges[row]!, edges[column]!, ring)
      )
    );
    const rhs = edges.map((edge) => ring.neg(dotExact(edge, base, ring)));
    const denominator = determinantExact(gram, ring);
    const denominatorSign = ring.sign(denominator);
    if (denominatorSign === 0) {
      return {
        affineIndependent: false,
        weightSigns: new Array(points.length).fill(0) as GjkSign[],
        source: `exact-ring:${ring.kind}`
      };
    }

    const numerators = Array.from({ length: edgeCount }, (_, column) => {
      const replaced = gram.map((row, rowIndex) =>
        row.map((value, entry) => (entry === column ? rhs[rowIndex]! : value))
      );
      return determinantExact(replaced, ring);
    });
    const baseNumerator = numerators.reduce(
      (remaining, numerator) => ring.sub(remaining, numerator),
      denominator
    );
    const signs = [baseNumerator, ...numerators].map((numerator) =>
      multiplySigns(ring.sign(numerator), denominatorSign)
    );
    return {
      affineIndependent: true,
      weightSigns: signs,
      source: `exact-ring:${ring.kind}`
    };
  };
}

function featureKey(feature: SupportFeatureId): string {
  return typeof feature === 'number' ? `n:${feature}` : `s:${feature}`;
}

function assertExactPoint(
  point: readonly ExactValue[],
  dim: number,
  owner: string
): void {
  if (point.length !== dim) {
    throw new Error(
      `createExactRingGjkSignOracle: ${owner} feature has dimension ${point.length}, expected ${dim}`
    );
  }
}

function scaleExact(value: ExactValue, scalar: bigint): ExactValue {
  return { a: value.a * scalar, b: value.b * scalar };
}

function subtractExactPoint(
  left: readonly ExactValue[],
  right: readonly ExactValue[],
  ring: ExactRing
): ExactValue[] {
  return left.map((value, axis) => ring.sub(value, right[axis]!));
}

function dotExact(
  left: readonly ExactValue[],
  right: readonly ExactValue[],
  ring: ExactRing
): ExactValue {
  let sum = ring.zero;
  for (let axis = 0; axis < left.length; axis++) {
    sum = ring.add(sum, ring.mul(left[axis]!, right[axis]!));
  }
  return sum;
}

function determinantExact(
  matrix: readonly (readonly ExactValue[])[],
  ring: ExactRing
): ExactValue {
  const size = matrix.length;
  if (size === 0) return ring.one;
  if (matrix.some((row) => row.length !== size)) {
    throw new Error('createExactRingGjkSignOracle: determinant matrix must be square');
  }
  if (size === 1) return matrix[0]![0]!;
  let determinant = ring.zero;
  for (let column = 0; column < size; column++) {
    const minor = matrix.slice(1).map((row) =>
      row.filter((_, entry) => entry !== column)
    );
    const term = ring.mul(matrix[0]![column]!, determinantExact(minor, ring));
    determinant = column % 2 === 0
      ? ring.add(determinant, term)
      : ring.sub(determinant, term);
  }
  return determinant;
}

function multiplySigns(left: GjkSign, right: GjkSign): GjkSign {
  return (left * right) as GjkSign;
}
