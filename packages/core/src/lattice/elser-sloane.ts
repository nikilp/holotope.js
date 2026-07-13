import { phiRing, type ExactValue } from '../coxeter/exact.js';
import { CellComplex } from '../geometry/cell-complex.js';
import {
  e8IntegerSecondShell,
  e8IntegerToIcosian,
  e8IntegerVectorsThroughNorm,
  evaluatePhi,
  icosianE8Data,
  icosianToE8Integer,
  type DoubledE8Vector,
  type DoubledIcosian
} from './e8.js';
import {
  ConvexWindow,
  FlatN,
  LatticeN,
  ModelSet,
  type ExactHalfspace,
  type ModelPoint,
  type WindowBoundaryPolicy,
  type WindowLocation
} from './model-set.js';

const exact = (a: bigint, b = 0n): ExactValue => ({ a, b });
const ZERO = exact(0n);
const ONE = exact(1n);
const PHI = exact(0n, 1n);
const PHI_INVERSE = exact(-1n, 1n);
const PHI_SQUARED = exact(1n, 1n);
const PHI_INVERSE_SQUARED = exact(2n, -1n);
const SQRT_FIVE = exact(-1n, 2n);

let cachedHalfspaces: readonly ExactHalfspace[] | null = null;
let cachedVertices: readonly (readonly ExactValue[])[] | null = null;
let cachedWindow: ConvexWindow | null = null;
let cachedGerm: ElserSloaneGerm | null = null;

const ICOSIAN_ROOT_BASIS_INDICES = [98, 120, 226, 3, 59, 188, 63, 167] as const;
const ICOSIAN_BASIS_INVERSE_NUMERATORS = [
  [1n, 0n, 0n, -1n, 1n, 1n, 0n, 0n],
  [0n, 0n, 1n, 1n, -1n, 0n, 1n, 0n],
  [0n, 0n, 0n, 2n, 0n, -2n, -2n, 0n],
  [1n, -1n, 0n, -2n, 1n, 0n, 1n, 0n],
  [0n, 0n, -1n, -1n, 0n, 1n, 0n, 1n],
  [1n, 0n, 0n, -1n, 1n, 1n, 2n, 0n],
  [0n, 0n, -1n, -3n, 0n, 1n, 0n, -1n],
  [1n, 0n, 0n, -3n, 1n, 1n, 2n, 0n]
] as const;

/**
 * Integer action of multiplication by phi on coefficients in the fixed
 * E8 root basis used by `createElserSloaneModelSet`.
 */
export const elserSloaneInflationMatrix: ReadonlyArray<ReadonlyArray<bigint>> = [
  [1n, -1n, 0n, -1n, -1n, 1n, 0n, 0n],
  [-1n, 0n, -1n, 0n, 0n, -1n, -1n, 1n],
  [-1n, 0n, 1n, 2n, 2n, 0n, 0n, -1n],
  [0n, -1n, 0n, 0n, -2n, 1n, 0n, 0n],
  [1n, 0n, 0n, -1n, 0n, 0n, 0n, 0n],
  [1n, -1n, -1n, -1n, -2n, 0n, -1n, 1n],
  [1n, 0n, 0n, -1n, -2n, 1n, 2n, -1n],
  [1n, -1n, -1n, -1n, -3n, 1n, 0n, 0n]
];

function scale(value: ExactValue, scalar: bigint): ExactValue {
  return { a: value.a * scalar, b: value.b * scalar };
}

function permutationParity(permutation: readonly number[]): number {
  let inversions = 0;
  for (let i = 0; i < permutation.length; i++) {
    for (let j = i + 1; j < permutation.length; j++) {
      if (permutation[i]! > permutation[j]!) inversions++;
    }
  }
  return inversions & 1;
}

function evenPermutations4(): readonly (readonly number[])[] {
  const out: number[][] = [];
  const visit = (prefix: number[], remaining: number[]): void => {
    if (remaining.length === 0) {
      if (permutationParity(prefix) === 0) out.push(prefix);
      return;
    }
    for (let i = 0; i < remaining.length; i++) {
      visit([...prefix, remaining[i]!], remaining.filter((_, j) => j !== i));
    }
  };
  visit([], [0, 1, 2, 3]);
  return out;
}

const EVEN_PERMUTATIONS = evenPermutations4();

/** All independent signs and even coordinate permutations of one H4 seed. */
function signedEvenOrbit(seed: readonly ExactValue[]): ExactValue[][] {
  const nonzero = seed.flatMap((value, i) => (phiRing.sign(value) === 0 ? [] : [i]));
  const out = new Map<string, ExactValue[]>();
  for (let mask = 0; mask < 1 << nonzero.length; mask++) {
    const signed = seed.map((value) => ({ ...value }));
    for (let bit = 0; bit < nonzero.length; bit++) {
      if ((mask & (1 << bit)) !== 0) signed[nonzero[bit]!] = phiRing.neg(signed[nonzero[bit]!]!);
    }
    for (const permutation of EVEN_PERMUTATIONS) {
      const vector = permutation.map((source) => signed[source]!);
      out.set(phiRing.keyTuple(vector), vector);
    }
  }
  return [...out.values()];
}

/**
 * The canonical 720 vertices of the Elser-Sloane acceptance window.
 *
 * Coordinates are scaled by `6/kappa`, where the common orthogonal-projection
 * normalizer cancels from every membership decision. With doubled icosian
 * input coordinates this means points are compared as `3 x*`.
 */
export function elserSloaneWindowVertices(): readonly (readonly ExactValue[])[] {
  if (cachedVertices) return cachedVertices;
  const halfScaleSeeds: readonly (readonly ExactValue[])[] = [
    [exact(2n), ZERO, ZERO, ZERO],
    [ONE, ONE, ONE, ONE],
    [ZERO, ONE, PHI, PHI_INVERSE]
  ];
  const thirdScaleSeeds: readonly (readonly ExactValue[])[] = [
    [PHI_SQUARED, PHI_INVERSE_SQUARED, ONE, ZERO],
    [PHI_SQUARED, PHI_INVERSE, PHI_INVERSE, PHI_INVERSE],
    [SQRT_FIVE, PHI_INVERSE, PHI, ZERO],
    [SQRT_FIVE, ONE, ONE, ONE],
    [PHI, PHI, PHI, PHI_INVERSE_SQUARED],
    [exact(2n), exact(2n), ZERO, ZERO],
    [exact(2n), ONE, PHI, PHI_INVERSE]
  ];
  const vertices = new Map<string, ExactValue[]>();
  for (const [seeds, factor] of [
    [halfScaleSeeds, exact(3n)],
    [thirdScaleSeeds, exact(2n)]
  ] as const) {
    for (const seed of seeds) {
      for (const vector of signedEvenOrbit(seed)) {
        const vertex = vector.map((value) => phiRing.mul(factor, value));
        vertices.set(phiRing.keyTuple(vertex), vertex);
      }
    }
  }
  if (vertices.size !== 720) {
    throw new Error(`elserSloaneWindowVertices: expected 720 vertices, got ${vertices.size}`);
  }
  cachedVertices = [...vertices.values()];
  return cachedVertices;
}

/**
 * Exact H-description of the four-dimensional Elser-Sloane window.
 *
 * The ten seeds are the H4 orbits of the 1,200 supporting hyperplanes of
 * the 720-vertex hull. Every inequality is `normal dot x <= 12/phi` in
 * the same `6/kappa` coordinate convention as `elserSloaneWindowVertices`.
 */
export function elserSloaneWindowHalfspaces(): readonly ExactHalfspace[] {
  if (cachedHalfspaces) return cachedHalfspaces;
  const facetSeeds: readonly (readonly ExactValue[])[] = [
    [exact(-1n, 1n), exact(-3n, 2n), exact(4n, -2n), exact(-4n, 3n)],
    [exact(-3n, 2n), exact(5n, -3n), exact(2n, -1n), exact(-2n, 2n)],
    [ONE, exact(5n, -3n), exact(2n, -1n), exact(4n, -2n)],
    [exact(-1n, 1n), exact(2n, -1n), ONE, exact(-6n, 4n)],
    [exact(2n, -1n), exact(-4n, 3n), exact(2n, -1n), exact(-4n, 3n)],
    [exact(-3n, 2n), ZERO, exact(-1n, 1n), exact(6n, -3n)],
    [exact(5n, -3n), ZERO, exact(-4n, 3n), ONE],
    [exact(6n, -3n), exact(2n, -1n), exact(2n, -1n), exact(2n, -1n)],
    [exact(-2n, 2n), ZERO, exact(-6n, 4n), ZERO],
    [exact(4n, -2n), exact(4n, -2n), exact(4n, -2n), ZERO]
  ];
  const halfspaces = new Map<string, ExactHalfspace>();
  const bound = exact(-12n, 12n); // 12 / phi
  for (const seed of facetSeeds) {
    for (const normal of signedEvenOrbit(seed)) {
      halfspaces.set(phiRing.keyTuple(normal), { normal, bound });
    }
  }
  if (halfspaces.size !== 1200) {
    throw new Error(`elserSloaneWindowHalfspaces: expected 1200 facets, got ${halfspaces.size}`);
  }
  cachedHalfspaces = [...halfspaces.values()];
  return cachedHalfspaces;
}

export function createElserSloaneWindow(): ConvexWindow {
  if (!cachedWindow) cachedWindow = new ConvexWindow(phiRing, 4, elserSloaneWindowHalfspaces());
  return cachedWindow;
}

export type ElserSloanePhasonOffset = readonly [
  ExactValue,
  ExactValue,
  ExactValue,
  ExactValue
];

export interface ElserSloaneModelSetOptions {
  boundaryPolicy?: WindowBoundaryPolicy;
  /** Exact internal translation in eleventh-coordinate units. */
  phasonOffsetElevenths?: ElserSloanePhasonOffset;
}

/** Galois conjugation `a+b phi -> (a+b)-b phi`. */
export function phiConjugate(value: ExactValue): ExactValue {
  return { a: value.a + value.b, b: -value.b };
}

function icosianAmbient(root: DoubledIcosian): ExactValue[] {
  return [
    ...root.map((coordinate) => exact(coordinate.a)),
    ...root.map((coordinate) => exact(coordinate.b))
  ];
}

/** Fixed unimodular E8 root basis used for bounded coefficient enumeration. */
export function elserSloaneLatticeBasis(): readonly (readonly ExactValue[])[] {
  const roots = icosianE8Data().roots;
  return ICOSIAN_ROOT_BASIS_INDICES.map((index) => icosianAmbient(roots[index]!));
}

/** Coordinates of an icosian in the fixed E8 root basis. */
export function elserSloaneCoefficients(root: DoubledIcosian): readonly bigint[] {
  const ambient = [...root.map((coordinate) => coordinate.a), ...root.map((coordinate) => coordinate.b)];
  return ICOSIAN_BASIS_INVERSE_NUMERATORS.map((row) => {
    const numerator = row.reduce<bigint>((sum, value, i) => sum + value * ambient[i]!, 0n);
    if (numerator % 2n !== 0n) {
      throw new Error('elserSloaneCoefficients: icosian lies outside the fixed E8 lattice basis');
    }
    return numerator / 2n;
  });
}

/** The canonical E8 -> R4 + R4 cut-and-project scheme in exact icosian coordinates. */
export function createElserSloaneModelSet(
  options: WindowBoundaryPolicy | ElserSloaneModelSetOptions = {}
): ModelSet {
  const phasonOffset = typeof options === 'string' ? undefined : options.phasonOffsetElevenths;
  const boundaryPolicy =
    typeof options === 'string'
      ? options
      : (options.boundaryPolicy ?? (phasonOffset === undefined ? 'include' : 'error'));
  const internalScale = phasonOffset === undefined ? 1n : 11n;
  const lattice = new LatticeN(phiRing, elserSloaneLatticeBasis());
  const parallelProjection = Array.from({ length: 4 }, (_, coordinate) =>
    Array.from({ length: 8 }, (_, input) =>
      input === coordinate ? ONE : input === coordinate + 4 ? PHI : ZERO
    )
  );
  const perpendicularProjection = Array.from({ length: 4 }, (_, coordinate) =>
    Array.from({ length: 8 }, (_, input) =>
      input === coordinate
        ? exact(3n * internalScale)
        : input === coordinate + 4
          ? exact(3n * internalScale, -3n * internalScale)
          : ZERO
    )
  );
  const flat = new FlatN({
    ring: phiRing,
    parallelProjection,
    perpendicularProjection,
    ...(phasonOffset === undefined ? {} : { perpendicularOffset: phasonOffset }),
    parallelDenominator: 2n,
    perpendicularDenominator: 6n * internalScale
  });
  const window =
    internalScale === 1n
      ? createElserSloaneWindow()
      : new ConvexWindow(
          phiRing,
          4,
          elserSloaneWindowHalfspaces().map((halfspace) => ({
            normal: halfspace.normal,
            bound: scale(halfspace.bound, internalScale)
          }))
        );
  return new ModelSet(lattice, flat, window, boundaryPolicy);
}

function multiplyIntegerMatrix(
  matrix: ReadonlyArray<ReadonlyArray<bigint>>,
  vector: readonly bigint[]
): bigint[] {
  return matrix.map((row) => row.reduce((sum, value, i) => sum + value * vector[i]!, 0n));
}

/** Exact E8 lattice automorphism: phi in physical space, 1-phi internally. */
export function elserSloaneInflate(coefficients: readonly bigint[]): readonly bigint[] {
  if (coefficients.length !== 8) {
    throw new Error(`elserSloaneInflate: expected 8 coefficients, got ${coefficients.length}`);
  }
  return multiplyIntegerMatrix(elserSloaneInflationMatrix, coefficients);
}

/** Inverse inflation; the identity S^-1 = S-I follows from S^2 = S+I. */
export function elserSloaneDeflate(coefficients: readonly bigint[]): readonly bigint[] {
  const inflated = elserSloaneInflate(coefficients);
  return inflated.map((value, i) => value - coefficients[i]!);
}

export interface ElserSloanePatchOptions {
  /** Symmetric coefficient box `[-r,r]^8`. Default 1; radius 2 has 390,625 candidates. */
  coefficientRadius?: number;
  /** Optional radial crop in physical R4 after exact window selection. */
  physicalRadius?: number;
  /** Candidate safety cap passed to `ModelSet.sample`. */
  maxCandidates?: number;
  boundaryPolicy?: WindowBoundaryPolicy;
  /** Exact internal translation in eleventh-coordinate units. */
  phasonOffsetElevenths?: ElserSloanePhasonOffset;
}

export interface ElserSloaneNormPatchOptions {
  /** Complete E8 shells through this quadratic norm. Default 6. */
  maxE8Norm?: number;
  /** Optional radial crop in physical R4 after exact window selection. */
  physicalRadius?: number;
  boundaryPolicy?: WindowBoundaryPolicy;
  /** Exact internal translation in eleventh-coordinate units. */
  phasonOffsetElevenths?: ElserSloanePhasonOffset;
}

export interface ElserSloanePatch {
  readonly points: readonly ModelPoint[];
  readonly candidateCount: number;
  readonly acceptedBeforePhysicalCrop: number;
  readonly boundaryCount: number;
}

/** A deterministic finite coefficient-box sample of the infinite model set. */
export function elserSloanePatch({
  coefficientRadius = 1,
  physicalRadius,
  maxCandidates = 1_000_000,
  boundaryPolicy,
  phasonOffsetElevenths
}: ElserSloanePatchOptions = {}): ElserSloanePatch {
  if (!Number.isSafeInteger(coefficientRadius) || coefficientRadius < 0) {
    throw new Error(`elserSloanePatch: invalid coefficient radius ${coefficientRadius}`);
  }
  if (physicalRadius !== undefined && (!Number.isFinite(physicalRadius) || physicalRadius <= 0)) {
    throw new Error(`elserSloanePatch: physical radius must be positive and finite`);
  }
  const sampled = createElserSloaneModelSet({
    ...(boundaryPolicy === undefined ? {} : { boundaryPolicy }),
    ...(phasonOffsetElevenths === undefined ? {} : { phasonOffsetElevenths })
  }).sample({
    coefficientRanges: Array.from({ length: 8 }, () => ({
      min: -coefficientRadius,
      max: coefficientRadius
    })),
    maxCandidates
  });
  const radiusSquared = physicalRadius === undefined ? Number.POSITIVE_INFINITY : physicalRadius ** 2;
  const points = sampled.points
    .filter(
      (point) =>
        point.parallel.reduce((sum, coordinate) => sum + coordinate * coordinate, 0) <= radiusSquared
    )
    .sort((left, right) => {
      const leftNorm = left.parallel.reduce((sum, coordinate) => sum + coordinate * coordinate, 0);
      const rightNorm = right.parallel.reduce((sum, coordinate) => sum + coordinate * coordinate, 0);
      if (leftNorm !== rightNorm) return leftNorm - rightNorm;
      return left.coefficients.join(',').localeCompare(right.coefficients.join(','));
    });
  return {
    points,
    candidateCount: sampled.candidateCount,
    acceptedBeforePhysicalCrop: sampled.points.length,
    boundaryCount: sampled.boundaryCount
  };
}

/**
 * A symmetry-preserving finite sample built from complete ambient E8 shells.
 * This is the preferred bounded source for explanatory renders.
 */
export function elserSloaneNormPatch({
  maxE8Norm = 6,
  physicalRadius,
  boundaryPolicy,
  phasonOffsetElevenths
}: ElserSloaneNormPatchOptions = {}): ElserSloanePatch {
  if (physicalRadius !== undefined && (!Number.isFinite(physicalRadius) || physicalRadius <= 0)) {
    throw new Error(`elserSloaneNormPatch: physical radius must be positive and finite`);
  }
  const model = createElserSloaneModelSet({
    ...(boundaryPolicy === undefined ? {} : { boundaryPolicy }),
    ...(phasonOffsetElevenths === undefined ? {} : { phasonOffsetElevenths })
  });
  const resolvedBoundaryPolicy = model.boundaryPolicy;
  const candidates = e8IntegerVectorsThroughNorm(maxE8Norm);
  const accepted: ModelPoint[] = [];
  let boundaryCount = 0;
  for (const standard of candidates) {
    const icosian = e8IntegerToIcosian(standard);
    const coefficients = elserSloaneCoefficients(icosian);
    const ambient = model.lattice.point(coefficients);
    const perpendicularExact = model.flat.projectPerpendicular(ambient);
    const location = model.window.classify(perpendicularExact);
    if (location === 'outside') continue;
    if (location === 'boundary') {
      boundaryCount++;
      if (resolvedBoundaryPolicy === 'exclude') continue;
      if (resolvedBoundaryPolicy === 'error') {
        throw new Error(`elserSloaneNormPatch: singular cut at [${standard.join(',')}]`);
      }
    }
    const parallelExact = model.flat.projectParallel(ambient);
    accepted.push({
      coefficients,
      ambient,
      parallelExact,
      perpendicularExact,
      parallelDenominator: model.flat.parallelDenominator,
      perpendicularDenominator: model.flat.perpendicularDenominator,
      parallel: Float64Array.from(parallelExact, (value) => phiRing.toNumber(value) / 2),
      perpendicular: Float64Array.from(
        perpendicularExact,
        (value) => phiRing.toNumber(value) / Number(model.flat.perpendicularDenominator)
      ),
      windowLocation: location
    });
  }
  const radiusSquared = physicalRadius === undefined ? Number.POSITIVE_INFINITY : physicalRadius ** 2;
  const points = accepted.filter(
    (point) => point.parallel.reduce((sum, coordinate) => sum + coordinate * coordinate, 0) <= radiusSquared
  );
  return {
    points,
    candidateCount: candidates.length,
    acceptedBeforePhysicalCrop: accepted.length,
    boundaryCount
  };
}

/** Exact section by the fourth physical coordinate; zero is the icosahedral section. */
export function elserSloaneSection(
  points: readonly ModelPoint[],
  coordinate: ExactValue = ZERO
): readonly ModelPoint[] {
  return points.filter((point) => phiRing.compare(point.parallelExact[3]!, coordinate) === 0);
}

/** Exact metric-nearest graph within one fixed-coordinate 3D section. */
export function elserSloaneSectionEdges(points: readonly ModelPoint[]): Uint32Array {
  let nearest: ExactValue | null = null;
  const distanceSquared = (left: ModelPoint, right: ModelPoint): ExactValue => {
    let result = phiRing.zero;
    for (let coordinate = 0; coordinate < 3; coordinate++) {
      const difference = phiRing.sub(left.parallelExact[coordinate]!, right.parallelExact[coordinate]!);
      result = phiRing.add(result, phiRing.mul(difference, difference));
    }
    return result;
  };
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const distance = distanceSquared(points[i]!, points[j]!);
      if (phiRing.sign(distance) === 0) continue;
      if (nearest === null || phiRing.compare(distance, nearest) < 0) nearest = distance;
    }
  }
  if (nearest === null) return new Uint32Array();
  const edges: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (phiRing.compare(distanceSquared(points[i]!, points[j]!), nearest) === 0) edges.push(i, j);
    }
  }
  return Uint32Array.from(edges);
}

/**
 * Integer Galois product for a point difference in the unnormalized icosian
 * coordinates: |delta_parallel|^2 |delta_perp|^2. The orthonormal E8
 * projection convention multiplies this integer by 1/20.
 */
export function elserSloaneGaloisProduct(
  left: ModelPoint,
  right: ModelPoint
): bigint {
  let squaredNorm = phiRing.zero;
  for (let coordinate = 0; coordinate < 4; coordinate++) {
    const difference = phiRing.sub(left.parallelExact[coordinate]!, right.parallelExact[coordinate]!);
    squaredNorm = phiRing.add(squaredNorm, phiRing.mul(difference, difference));
  }
  const fieldNorm = squaredNorm.a * squaredNorm.a + squaredNorm.a * squaredNorm.b - squaredNorm.b * squaredNorm.b;
  if (fieldNorm % 16n !== 0n) {
    throw new Error('elserSloaneGaloisProduct: non-integral doubled-coordinate invariant');
  }
  return fieldNorm / 16n;
}

/** Internal coordinate `6 x*` for a doubled icosian representing `2x`. */
export function elserSloaneInternalCoordinate(root: DoubledIcosian): readonly ExactValue[] {
  return root.map((coordinate) => scale(phiConjugate(coordinate), 3n));
}

export function classifyElserSloaneIcosian(root: DoubledIcosian): WindowLocation {
  return createElserSloaneWindow().classify(elserSloaneInternalCoordinate(root));
}

export type ElserSloaneSourceShell = 'root' | 'second-shell';

export interface ElserSloaneGermPoint {
  readonly sourceShell: ElserSloaneSourceShell;
  readonly standard: DoubledE8Vector;
  readonly icosian: DoubledIcosian;
  readonly windowLocation: 'inside' | 'boundary';
  readonly parallel: Float64Array;
  readonly perpendicular: Float64Array;
}

export interface ElserSloaneGerm {
  readonly points: readonly ElserSloaneGermPoint[];
  /** Exact metric skeletons of the accepted root and norm-4 600-cells. */
  readonly edges: Uint32Array;
  readonly rootCount: number;
  readonly secondShellCount: number;
  readonly boundaryCount: number;
}

function squaredDistance(left: DoubledIcosian, right: DoubledIcosian): ExactValue {
  let result = phiRing.zero;
  for (let i = 0; i < 4; i++) {
    const difference = phiRing.sub(left[i]!, right[i]!);
    result = phiRing.add(result, phiRing.mul(difference, difference));
  }
  return result;
}

function appendMetricSkeleton(
  points: readonly ElserSloaneGermPoint[],
  start: number,
  count: number,
  edges: number[]
): void {
  let nearest: ExactValue | null = null;
  for (let i = start; i < start + count; i++) {
    for (let j = i + 1; j < start + count; j++) {
      const distance = squaredDistance(points[i]!.icosian, points[j]!.icosian);
      if (nearest === null || phiRing.compare(distance, nearest) < 0) nearest = distance;
    }
  }
  if (nearest === null) return;
  for (let i = start; i < start + count; i++) {
    for (let j = i + 1; j < start + count; j++) {
      if (phiRing.compare(squaredDistance(points[i]!.icosian, points[j]!.icosian), nearest) === 0) {
        edges.push(i, j);
      }
    }
  }
}

function germPoint(
  sourceShell: ElserSloaneSourceShell,
  standard: DoubledE8Vector,
  icosian: DoubledIcosian,
  windowLocation: 'inside' | 'boundary'
): ElserSloaneGermPoint {
  return {
    sourceShell,
    standard,
    icosian,
    windowLocation,
    parallel: Float64Array.from(icosian, (value) => evaluatePhi(value, 'parallel') / 2),
    perpendicular: Float64Array.from(icosian, (value) => evaluatePhi(value, 'perpendicular') / 2)
  };
}

/** The exactly accepted norm-2 and norm-4 germ of the canonical model set. */
export function elserSloaneGerm(): ElserSloaneGerm {
  if (cachedGerm) return cachedGerm;
  const points: ElserSloaneGermPoint[] = [];
  let rootCount = 0;
  let secondShellCount = 0;
  let boundaryCount = 0;

  for (const icosian of icosianE8Data().roots) {
    const location = classifyElserSloaneIcosian(icosian);
    if (location === 'outside') continue;
    if (location === 'boundary') boundaryCount++;
    rootCount++;
    points.push(germPoint('root', icosianToE8Integer(icosian), icosian, location));
  }
  for (const standard of e8IntegerSecondShell()) {
    const icosian = e8IntegerToIcosian(standard);
    const location = classifyElserSloaneIcosian(icosian);
    if (location === 'outside') continue;
    if (location === 'boundary') boundaryCount++;
    secondShellCount++;
    points.push(germPoint('second-shell', standard, icosian, location));
  }
  const edges: number[] = [];
  appendMetricSkeleton(points, 0, rootCount, edges);
  appendMetricSkeleton(points, rootCount, secondShellCount, edges);
  cachedGerm = {
    points,
    edges: Uint32Array.from(edges),
    rootCount,
    secondShellCount,
    boundaryCount
  };
  return cachedGerm;
}

export interface ElserSloaneGermComplexOptions {
  /** Which Galois embedding supplies the R4 positions. Default `parallel`. */
  embedding?: 'parallel' | 'perpendicular';
  /** Uniform scale after embedding. Default 1. */
  scale?: number;
  /** Accepted source shell whose exact metric edges are included. Default `both`. */
  sourceShell?: ElserSloaneSourceShell | 'both';
}

/** A renderable 4D view of the two accepted 600-cell shells. */
export function createElserSloaneGermComplex({
  embedding = 'parallel',
  scale: outputScale = 1,
  sourceShell = 'both'
}: ElserSloaneGermComplexOptions = {}): CellComplex {
  if (!Number.isFinite(outputScale) || outputScale <= 0) {
    throw new Error(`createElserSloaneGermComplex: scale must be positive and finite, got ${outputScale}`);
  }
  const germ = elserSloaneGerm();
  const positions = new Float64Array(germ.points.length * 4);
  for (let i = 0; i < germ.points.length; i++) {
    const source = embedding === 'parallel' ? germ.points[i]!.parallel : germ.points[i]!.perpendicular;
    for (let coordinate = 0; coordinate < 4; coordinate++) {
      positions[i * 4 + coordinate] = source[coordinate]! * outputScale;
    }
  }
  const edges: number[] = [];
  for (let edge = 0; edge < germ.edges.length; edge += 2) {
    const left = germ.edges[edge]!;
    const right = germ.edges[edge + 1]!;
    const edgeShell: ElserSloaneSourceShell =
      left < germ.rootCount && right < germ.rootCount ? 'root' : 'second-shell';
    if (sourceShell === 'both' || sourceShell === edgeShell) edges.push(left, right);
  }
  return new CellComplex(4, positions, [
    {
      dim: 1,
      verticesPerCell: 2,
      kind: 'simplex',
      indices: Uint32Array.from(edges)
    }
  ]);
}
