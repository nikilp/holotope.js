import { sqrt2Ring, type ExactValue } from '../coxeter/exact.js';
import {
  ConvexWindow,
  FlatN,
  LatticeN,
  ModelSet,
  type ModelPoint,
  type WindowBoundaryPolicy
} from './model-set.js';

const exact = (a: bigint, b = 0n): ExactValue => ({ a, b });
const SQRT2 = exact(0n, 1n);
const SILVER = exact(1n, 1n);
const SILVER_CONJUGATE = exact(1n, -1n);

export type AmmannBeenkerCoefficients = readonly [bigint, bigint, bigint, bigint];

export type AmmannBeenkerPhasonOffset = readonly [ExactValue, ExactValue];

export interface AmmannBeenkerModelSetOptions {
  boundaryPolicy?: WindowBoundaryPolicy;
  /** Exact internal offset in quarter-coordinate units. Default zero. */
  phasonOffsetQuarters?: AmmannBeenkerPhasonOffset;
}

/** Canonical Z[zeta_8] Ammann–Beenker model set with a unit-edge octagonal window. */
export function createAmmannBeenkerModelSet(
  options: WindowBoundaryPolicy | AmmannBeenkerModelSetOptions = {}
): ModelSet {
  const boundaryPolicy = typeof options === 'string' ? options : (options.boundaryPolicy ?? 'error');
  const phasonOffset =
    typeof options === 'string' ? [exact(0n), exact(0n)] : (options.phasonOffsetQuarters ?? [exact(0n), exact(0n)]);
  const lattice = LatticeN.integer(sqrt2Ring, 4);
  // Numerators are doubled to keep every entry in Z[sqrt2]. Dividing by
  // two yields the standard unit vectors at angles 0, pi/4, pi/2, 3pi/4.
  const flat = new FlatN({
    ring: sqrt2Ring,
    parallelProjection: [
      [exact(2n), SQRT2, exact(0n), exact(0n, -1n)],
      [exact(0n), SQRT2, exact(2n), SQRT2]
    ],
    // Internal numerators use denominator four so quarter-unit phason
    // translations remain exact. The linear part is twice the canonical
    // doubled projection above.
    perpendicularProjection: [
      [exact(4n), exact(0n, -2n), exact(0n), exact(0n, 2n)],
      [exact(0n), exact(0n, 2n), exact(-4n), exact(0n, 2n)]
    ],
    perpendicularOffset: phasonOffset,
    parallelDenominator: 2n,
    perpendicularDenominator: 4n
  });

  // Projection of [-1/2,1/2]^4 into the doubled internal coordinates.
  // The result has edge length two here, hence unit edge after /2.
  const axisBound = exact(2n, 2n); // 2(1 + sqrt2)
  const diagonalBound = exact(4n, 2n); // 2(2 + sqrt2)
  const window = new ConvexWindow(sqrt2Ring, 2, [
    { normal: [exact(1n), exact(0n)], bound: axisBound },
    { normal: [exact(-1n), exact(0n)], bound: axisBound },
    { normal: [exact(0n), exact(1n)], bound: axisBound },
    { normal: [exact(0n), exact(-1n)], bound: axisBound },
    { normal: [exact(1n), exact(1n)], bound: diagonalBound },
    { normal: [exact(-1n), exact(-1n)], bound: diagonalBound },
    { normal: [exact(1n), exact(-1n)], bound: diagonalBound },
    { normal: [exact(-1n), exact(1n)], bound: diagonalBound }
  ]);
  return new ModelSet(lattice, flat, window, boundaryPolicy);
}

/** Multiplication by zeta_8: exact 45-degree rotation of lattice provenance. */
export function ammannBeenkerRotate45(
  [n0, n1, n2, n3]: AmmannBeenkerCoefficients
): AmmannBeenkerCoefficients {
  return [-n3, n0, n1, n2];
}

/**
 * Silver-mean inflation. In physical space this multiplies by 1+sqrt2;
 * in internal space its star image multiplies by 1-sqrt2.
 */
export function ammannBeenkerInflate(
  [n0, n1, n2, n3]: AmmannBeenkerCoefficients
): AmmannBeenkerCoefficients {
  return [n0 + n1 - n3, n0 + n1 + n2, n1 + n2 + n3, -n0 + n2 + n3];
}

export interface AmmannBeenkerPatchOptions {
  /** Inclusive lattice coefficient radius. Default 6. */
  coefficientRadius?: number;
  /** Euclidean radius in standard unit-edge physical coordinates. Default 8. */
  physicalRadius?: number;
  /** Exact internal offset in quarter-coordinate units. Default zero. */
  phasonOffsetQuarters?: AmmannBeenkerPhasonOffset;
}

export interface AmmannBeenkerPatch {
  readonly points: readonly ModelPoint[];
  /** Tiling edges between accepted points whose provenance differs by one basis vector. */
  readonly edges: Uint32Array;
  readonly boundaryCount: number;
  readonly candidateCount: number;
}

function coefficientKey(coefficients: readonly bigint[]): string {
  return coefficients.join(',');
}

/** A radial finite patch of the canonical Ammann–Beenker vertex set. */
export function ammannBeenkerPatch({
  coefficientRadius = 6,
  physicalRadius = 8,
  phasonOffsetQuarters
}: AmmannBeenkerPatchOptions = {}): AmmannBeenkerPatch {
  if (!Number.isInteger(coefficientRadius) || coefficientRadius < 1) {
    throw new Error(`ammannBeenkerPatch: invalid coefficientRadius ${coefficientRadius}`);
  }
  if (!Number.isFinite(physicalRadius) || physicalRadius <= 0) {
    throw new Error(`ammannBeenkerPatch: invalid physicalRadius ${physicalRadius}`);
  }
  const sampled = createAmmannBeenkerModelSet({
    ...(phasonOffsetQuarters === undefined ? {} : { phasonOffsetQuarters })
  }).sample({
    coefficientRanges: Array.from({ length: 4 }, () => ({
      min: -coefficientRadius,
      max: coefficientRadius
    }))
  });
  const points = sampled.points.filter(
    (point) => Math.hypot(point.parallel[0]!, point.parallel[1]!) <= physicalRadius + 1e-12
  );
  const index = new Map(points.map((point, i) => [coefficientKey(point.coefficients), i]));
  const edges: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let axis = 0; axis < 4; axis++) {
      const neighbor = points[i]!.coefficients.slice();
      neighbor[axis]! += 1n;
      const j = index.get(coefficientKey(neighbor));
      if (j !== undefined) edges.push(i, j);
    }
  }
  return {
    points,
    edges: Uint32Array.from(edges),
    boundaryCount: sampled.boundaryCount,
    candidateCount: sampled.candidateCount
  };
}

/** Exact silver-mean factors, exposed for invariant checks and dynamics. */
export const ammannBeenkerInflationFactors = {
  parallel: SILVER,
  perpendicular: SILVER_CONJUGATE
} as const;
