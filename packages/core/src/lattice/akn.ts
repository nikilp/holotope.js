import { phiRing, type ExactValue } from '../coxeter/exact.js';
import {
  ConvexWindow,
  FlatN,
  LatticeN,
  ModelSet,
  type ExactHalfspace,
  type ModelPoint,
  type WindowBoundaryPolicy
} from './model-set.js';

const exact = (a: bigint, b = 0n): ExactValue => ({ a, b });
const PHI = exact(0n, 1n);
const PHI_CONJUGATE = exact(1n, -1n);

export type AKNCoefficients = readonly [bigint, bigint, bigint, bigint, bigint, bigint];
export type AKNPhasonOffset = readonly [ExactValue, ExactValue, ExactValue];

export interface AKNModelSetOptions {
  boundaryPolicy?: WindowBoundaryPolicy;
  /** Exact internal translation in seventh-coordinate units. */
  phasonOffsetSevenths?: AKNPhasonOffset;
}

const PHYSICAL_PROJECTION: ReadonlyArray<ReadonlyArray<ExactValue>> = [
  [exact(1n), exact(-1n), exact(0n), exact(0n), PHI, PHI],
  [PHI, PHI, exact(1n), exact(-1n), exact(0n), exact(0n)],
  [exact(0n), exact(0n), PHI, PHI, exact(1n), exact(-1n)]
];

const INTERNAL_PROJECTION: ReadonlyArray<ReadonlyArray<ExactValue>> = [
  [exact(1n), exact(-1n), exact(0n), exact(0n), PHI_CONJUGATE, PHI_CONJUGATE],
  [PHI_CONJUGATE, PHI_CONJUGATE, exact(1n), exact(-1n), exact(0n), exact(0n)],
  [exact(0n), exact(0n), PHI_CONJUGATE, PHI_CONJUGATE, exact(1n), exact(-1n)]
];

function add(left: ExactValue, right: ExactValue): ExactValue {
  return phiRing.add(left, right);
}

function scale(value: ExactValue, scalar: bigint): ExactValue {
  return { a: value.a * scalar, b: value.b * scalar };
}

function scaleProjection(
  projection: ReadonlyArray<ReadonlyArray<ExactValue>>,
  scalar: bigint
): ExactValue[][] {
  return projection.map((row) => row.map((value) => scale(value, scalar)));
}

function dot(left: readonly ExactValue[], right: readonly ExactValue[]): ExactValue {
  let sum = phiRing.zero;
  for (let i = 0; i < left.length; i++) sum = add(sum, phiRing.mul(left[i]!, right[i]!));
  return sum;
}

function cross(left: readonly ExactValue[], right: readonly ExactValue[]): ExactValue[] {
  return [
    phiRing.sub(phiRing.mul(left[1]!, right[2]!), phiRing.mul(left[2]!, right[1]!)),
    phiRing.sub(phiRing.mul(left[2]!, right[0]!), phiRing.mul(left[0]!, right[2]!)),
    phiRing.sub(phiRing.mul(left[0]!, right[1]!), phiRing.mul(left[1]!, right[0]!))
  ];
}

function absolute(value: ExactValue): ExactValue {
  return phiRing.sign(value) < 0 ? phiRing.neg(value) : value;
}

function internalGenerators(): ExactValue[][] {
  return Array.from({ length: 6 }, (_, column) =>
    INTERNAL_PROJECTION.map((row) => row[column]!)
  );
}

/**
 * Thirty exact supporting halfspaces of the projected six-cube. Each pair
 * of the six generator zones supplies one rhombic face pair.
 */
export function aknWindowHalfspaces(): readonly ExactHalfspace[] {
  const generators = internalGenerators();
  const halfspaces: ExactHalfspace[] = [];
  for (let i = 0; i < generators.length; i++) {
    for (let j = i + 1; j < generators.length; j++) {
      const normal = cross(generators[i]!, generators[j]!);
      let bound = phiRing.zero;
      for (const generator of generators) bound = add(bound, absolute(dot(normal, generator)));
      // Cube coefficients range over [-1/2,1/2]. Clearing the half gives
      // 2 n·x <= sum |n·g_k|.
      const doubled = normal.map((value) => scale(value, 2n));
      halfspaces.push({ normal: doubled, bound });
      halfspaces.push({ normal: doubled.map((value) => phiRing.neg(value)), bound });
    }
  }
  return halfspaces;
}

/**
 * Primitive six-dimensional Ammann–Kramer–Neri icosahedral model set.
 * The fully symmetric centered cut is singular, so its canonical default
 * explicitly includes the closed triacontahedral boundary.
 */
export function createAKNModelSet(
  options: WindowBoundaryPolicy | AKNModelSetOptions = {}
): ModelSet {
  const phasonOffset = typeof options === 'string' ? undefined : options.phasonOffsetSevenths;
  const boundaryPolicy =
    typeof options === 'string'
      ? options
      : (options.boundaryPolicy ?? (phasonOffset === undefined ? 'include' : 'error'));
  const internalScale = phasonOffset === undefined ? 1n : 7n;
  const lattice = LatticeN.integer(phiRing, 6);
  const flat = new FlatN({
    ring: phiRing,
    parallelProjection: PHYSICAL_PROJECTION,
    perpendicularProjection: scaleProjection(INTERNAL_PROJECTION, internalScale),
    ...(phasonOffset === undefined ? {} : { perpendicularOffset: phasonOffset }),
    perpendicularDenominator: internalScale
  });
  const window = new ConvexWindow(
    phiRing,
    3,
    aknWindowHalfspaces().map((halfspace) => ({
      normal: halfspace.normal,
      bound: scale(halfspace.bound, internalScale)
    }))
  );
  return new ModelSet(lattice, flat, window, boundaryPolicy);
}

/** 120-degree coordinate cycle, an exact icosahedral threefold symmetry. */
export function aknRotate3(
  [n0, n1, n2, n3, n4, n5]: AKNCoefficients
): AKNCoefficients {
  return [n2, n3, n4, n5, n0, n1];
}

/** 72-degree rotation about one golden axis, as a signed provenance permutation. */
export function aknRotate5(
  [n0, n1, n2, n3, n4, n5]: AKNCoefficients
): AKNCoefficients {
  return [n5, -n3, n0, n2, n4, -n1];
}

export interface AKNPatchOptions {
  /** Inclusive coefficient radius; 2 means 5^6 candidates. Default 2. */
  coefficientRadius?: number;
  /** Radial crop in the unnormalized golden-axis coordinates. Default 6. */
  physicalRadius?: number;
  /** Exact internal translation in seventh-coordinate units. */
  phasonOffsetSevenths?: AKNPhasonOffset;
  boundaryPolicy?: WindowBoundaryPolicy;
}

export interface AKNPatch {
  readonly points: readonly ModelPoint[];
  readonly edges: Uint32Array;
  readonly boundaryCount: number;
  readonly candidateCount: number;
}

function coefficientKey(coefficients: readonly bigint[]): string {
  return coefficients.join(',');
}

/** A finite radial patch of the AKN vertex set and its six edge directions. */
export function aknPatch({
  coefficientRadius = 2,
  physicalRadius = 6,
  phasonOffsetSevenths,
  boundaryPolicy
}: AKNPatchOptions = {}): AKNPatch {
  if (!Number.isInteger(coefficientRadius) || coefficientRadius < 1) {
    throw new Error(`aknPatch: invalid coefficientRadius ${coefficientRadius}`);
  }
  if (!Number.isFinite(physicalRadius) || physicalRadius <= 0) {
    throw new Error(`aknPatch: invalid physicalRadius ${physicalRadius}`);
  }
  const sampled = createAKNModelSet({
    ...(phasonOffsetSevenths === undefined ? {} : { phasonOffsetSevenths }),
    ...(boundaryPolicy === undefined ? {} : { boundaryPolicy })
  }).sample({
    coefficientRanges: Array.from({ length: 6 }, () => ({
      min: -coefficientRadius,
      max: coefficientRadius
    }))
  });
  const points = sampled.points.filter(
    (point) =>
      Math.hypot(point.parallel[0]!, point.parallel[1]!, point.parallel[2]!) <=
      physicalRadius + 1e-12
  );
  const index = new Map(points.map((point, i) => [coefficientKey(point.coefficients), i]));
  const edges: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let axis = 0; axis < 6; axis++) {
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

/** Natural edge length in the exact golden-axis coordinates. */
export const aknEdgeLength = Math.sqrt((1 + Math.sqrt(5)) / 2 + 2);
