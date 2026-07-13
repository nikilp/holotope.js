import { phiRing, type ExactValue } from '../coxeter/exact.js';
import {
  ConvexWindow,
  FlatN,
  LatticeN,
  type CoefficientRange,
  type ModelPoint,
  type ModelSetSampleOptions,
  type WindowBoundaryPolicy
} from './model-set.js';

const exact = (a: bigint, b = 0n): ExactValue => ({ a, b });
const PHI = exact(0n, 1n);
const PHI_MINUS_ONE = exact(-1n, 1n);
const ONE_MINUS_PHI = exact(1n, -1n);
const SEVEN = exact(7n);

type ExactPair = readonly [ExactValue, ExactValue];

export type PenroseCoefficients = readonly [bigint, bigint, bigint, bigint];
export type PenroseWindowClass = 1 | 2 | 3 | 4;
export type PenrosePhasonOffset = readonly [ExactValue, ExactValue];

export interface PenroseModelSetOptions {
  boundaryPolicy?: WindowBoundaryPolicy;
  /**
   * Exact internal translation in seventh-coordinate units. The default
   * `[1,1]` is globally nonsingular; `[0,0]` is the symmetric singular cut.
   */
  phasonOffsetSevenths?: PenrosePhasonOffset;
}

export interface PenroseModelPoint extends ModelPoint {
  /** Discrete C5 component selecting one of the four pentagonal windows. */
  readonly windowClass: PenroseWindowClass;
}

export interface PenroseModelSetPatch {
  readonly points: readonly PenroseModelPoint[];
  readonly candidateCount: number;
  readonly boundaryCount: number;
}

export interface PenrosePatchOptions {
  /** Inclusive cyclotomic coefficient radius. Default 7. */
  coefficientRadius?: number;
  /** Euclidean radius in the unit-edge physical plane. Default 9. */
  physicalRadius?: number;
  /** Exact internal translation in seventh-coordinate units. Default `[1,1]`. */
  phasonOffsetSevenths?: PenrosePhasonOffset;
  /** Boundary policy. Default `error`; use `include` for the singular centered cut. */
  boundaryPolicy?: WindowBoundaryPolicy;
}

export interface PenrosePatch {
  readonly points: readonly PenroseModelPoint[];
  /** Tiling edges between accepted points at one of the five unit directions. */
  readonly edges: Uint32Array;
  /** Direction 0...4 for each edge pair, corresponding to powers of zeta_5. */
  readonly edgeDirections: Uint8Array;
  readonly boundaryCount: number;
  readonly candidateCount: number;
}

export interface PenroseVertexStarCensusOptions {
  /** Only vertices within this Euclidean radius are counted. */
  interiorRadius: number;
}

const ZETA_POWERS: readonly ExactPair[] = [
  [exact(1n), exact(0n)],
  [exact(0n), exact(1n)],
  [exact(-1n), PHI_MINUS_ONE],
  [ONE_MINUS_PHI, ONE_MINUS_PHI],
  [PHI_MINUS_ONE, exact(-1n)]
];

const PHYSICAL_PROJECTION: ReadonlyArray<ReadonlyArray<ExactValue>> = [
  [ZETA_POWERS[0]![0], ZETA_POWERS[1]![0], ZETA_POWERS[2]![0], ZETA_POWERS[3]![0]],
  [ZETA_POWERS[0]![1], ZETA_POWERS[1]![1], ZETA_POWERS[2]![1], ZETA_POWERS[3]![1]]
];

// Galois star map zeta_5 -> zeta_5^2, still expressed in the exact basis {1,zeta_5}.
const INTERNAL_PROJECTION: ReadonlyArray<ReadonlyArray<ExactValue>> = [
  [ZETA_POWERS[0]![0], ZETA_POWERS[2]![0], ZETA_POWERS[4]![0], ZETA_POWERS[1]![0]],
  [ZETA_POWERS[0]![1], ZETA_POWERS[2]![1], ZETA_POWERS[4]![1], ZETA_POWERS[1]![1]]
];

const EDGE_STEPS: readonly PenroseCoefficients[] = [
  [1n, 0n, 0n, 0n],
  [0n, 1n, 0n, 0n],
  [0n, 0n, 1n, 0n],
  [0n, 0n, 0n, 1n],
  [-1n, -1n, -1n, -1n]
];

function scale(value: ExactValue, scalar: bigint): ExactValue {
  return { a: value.a * scalar, b: value.b * scalar };
}

function scalePair([x, y]: ExactPair, scalar: ExactValue): ExactPair {
  return [phiRing.mul(x, scalar), phiRing.mul(y, scalar)];
}

function scaledProjection(
  projection: ReadonlyArray<ReadonlyArray<ExactValue>>,
  scalar: bigint
): ExactValue[][] {
  return projection.map((row) => row.map((value) => scale(value, scalar)));
}

function pentagonScale(windowClass: PenroseWindowClass): ExactValue {
  if (windowClass === 1) return phiRing.one;
  if (windowClass === 2) return phiRing.neg(PHI);
  if (windowClass === 3) return PHI;
  return phiRing.neg(phiRing.one);
}

/** Exact vertices of one native-scale pentagonal acceptance window. */
export function penroseWindowVertices(windowClass: PenroseWindowClass): readonly ExactPair[] {
  const scalar = pentagonScale(windowClass);
  return ZETA_POWERS.map((vertex) => scalePair(vertex, scalar));
}

function createPenroseWindow(windowClass: PenroseWindowClass): ConvexWindow {
  // Both the internal coordinates and window are multiplied by seven so
  // seventh-unit phason translations remain exact algebraic integers.
  const vertices = penroseWindowVertices(windowClass).map(
    ([x, y]): ExactPair => [scale(x, 7n), scale(y, 7n)]
  );
  const halfspaces = vertices.map((left, i) => {
    const right = vertices[(i + 1) % vertices.length]!;
    const edgeX = phiRing.sub(right[0], left[0]);
    const edgeY = phiRing.sub(right[1], left[1]);
    const normal: ExactPair = [edgeY, phiRing.neg(edgeX)];
    const bound = phiRing.add(phiRing.mul(normal[0], left[0]), phiRing.mul(normal[1], left[1]));
    return { normal, bound };
  });
  return new ConvexWindow(phiRing, 2, halfspaces);
}

function sumClass(coefficients: readonly bigint[]): 0 | PenroseWindowClass {
  let residue = coefficients.reduce((sum, value) => sum + value, 0n) % 5n;
  if (residue < 0n) residue += 5n;
  return Number(residue) as 0 | PenroseWindowClass;
}

function safeInteger(value: bigint | number, label: string): bigint {
  if (typeof value === 'bigint') return value;
  if (!Number.isSafeInteger(value)) throw new Error(`${label}: expected a safe integer, got ${value}`);
  return BigInt(value);
}

/**
 * Penrose's rank-four cyclotomic cut-and-project scheme. The discrete C5
 * component routes every point to P, -phi P, phi P, or -P.
 */
export class PenroseModelSet {
  readonly lattice: LatticeN;
  readonly flat: FlatN;
  readonly windows: ReadonlyMap<PenroseWindowClass, ConvexWindow>;
  readonly boundaryPolicy: WindowBoundaryPolicy;

  constructor({
    boundaryPolicy = 'error',
    phasonOffsetSevenths = [phiRing.one, phiRing.one]
  }: PenroseModelSetOptions = {}) {
    this.lattice = LatticeN.integer(phiRing, 4);
    this.flat = new FlatN({
      ring: phiRing,
      parallelProjection: PHYSICAL_PROJECTION,
      perpendicularProjection: scaledProjection(INTERNAL_PROJECTION, 7n),
      perpendicularOffset: phasonOffsetSevenths,
      perpendicularDenominator: 7n
    });
    this.windows = new Map<PenroseWindowClass, ConvexWindow>([
      [1, createPenroseWindow(1)],
      [2, createPenroseWindow(2)],
      [3, createPenroseWindow(3)],
      [4, createPenroseWindow(4)]
    ]);
    this.boundaryPolicy = boundaryPolicy;
  }

  sample({ coefficientRanges, maxCandidates = 1_000_000 }: ModelSetSampleOptions): PenroseModelSetPatch {
    if (coefficientRanges.length !== 4) {
      throw new Error(`PenroseModelSet.sample: ${coefficientRanges.length} ranges for rank 4`);
    }
    if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1) {
      throw new Error(`PenroseModelSet.sample: invalid maxCandidates ${maxCandidates}`);
    }
    const ranges = coefficientRanges.map(({ min, max }: CoefficientRange) => {
      const lo = safeInteger(min, 'PenroseModelSet.sample');
      const hi = safeInteger(max, 'PenroseModelSet.sample');
      if (lo > hi) throw new Error(`PenroseModelSet.sample: invalid coefficient range ${lo}...${hi}`);
      return { min: lo, max: hi };
    });
    let candidateCountBig = 1n;
    for (const range of ranges) candidateCountBig *= range.max - range.min + 1n;
    if (candidateCountBig > BigInt(maxCandidates)) {
      throw new Error(
        `PenroseModelSet.sample: coefficient box has ${candidateCountBig} candidates, cap is ${maxCandidates}`
      );
    }

    const points: PenroseModelPoint[] = [];
    let boundaryCount = 0;
    const coefficients = Array<bigint>(4).fill(0n);
    const visit = (axis: number): void => {
      if (axis < 4) {
        for (let value = ranges[axis]!.min; value <= ranges[axis]!.max; value++) {
          coefficients[axis] = value;
          visit(axis + 1);
        }
        return;
      }
      const windowClass = sumClass(coefficients);
      if (windowClass === 0) return;
      const ambient = this.lattice.point(coefficients);
      const perpendicularExact = this.flat.projectPerpendicular(ambient);
      const window = this.windows.get(windowClass)!;
      const location = window.classify(perpendicularExact);
      if (location === 'outside') return;
      if (location === 'boundary') {
        boundaryCount++;
        const facetDecision = window.boundaryDecision(perpendicularExact);
        if (facetDecision === false) return;
        if (facetDecision === null && this.boundaryPolicy === 'exclude') return;
        if (facetDecision === null && this.boundaryPolicy === 'error') {
          throw new Error(
            `PenroseModelSet.sample: singular cut at lattice point [${coefficients.join(',')}]`
          );
        }
      }
      const parallelExact = this.flat.projectParallel(ambient);
      points.push({
        coefficients: coefficients.slice(),
        ambient,
        parallelExact,
        perpendicularExact,
        parallelDenominator: this.flat.parallelDenominator,
        perpendicularDenominator: this.flat.perpendicularDenominator,
        parallel: Float64Array.from(parallelExact, (value) => phiRing.toNumber(value)),
        perpendicular: Float64Array.from(perpendicularExact, (value) => phiRing.toNumber(value) / 7),
        windowLocation: location,
        windowClass
      });
    };
    visit(0);
    return { points, candidateCount: Number(candidateCountBig), boundaryCount };
  }
}

export function createPenroseModelSet(options: PenroseModelSetOptions = {}): PenroseModelSet {
  return new PenroseModelSet(options);
}

/** Convert exact {1,zeta_5}-basis coordinates to an orthonormal Cartesian plane. */
export function penroseCartesian(exactCoordinates: readonly ExactValue[]): Float64Array {
  if (exactCoordinates.length !== 2) {
    throw new Error(`penroseCartesian: point dim ${exactCoordinates.length}, expected 2`);
  }
  const a = phiRing.toNumber(exactCoordinates[0]!);
  const b = phiRing.toNumber(exactCoordinates[1]!);
  const angle = (2 * Math.PI) / 5;
  return Float64Array.of(a + b * Math.cos(angle), b * Math.sin(angle));
}

/** Multiplication by zeta_5, an exact 72-degree rotation of provenance. */
export function penroseRotate72(
  [h, j, k, l]: PenroseCoefficients
): PenroseCoefficients {
  return [-l, h - l, j - l, k - l];
}

function coefficientKey(coefficients: readonly bigint[]): string {
  return coefficients.join(',');
}

/** A finite radial patch of the unit-edge rhombic Penrose tiling. */
export function penrosePatch({
  coefficientRadius = 7,
  physicalRadius = 9,
  phasonOffsetSevenths,
  boundaryPolicy = 'error'
}: PenrosePatchOptions = {}): PenrosePatch {
  if (!Number.isInteger(coefficientRadius) || coefficientRadius < 1) {
    throw new Error(`penrosePatch: invalid coefficientRadius ${coefficientRadius}`);
  }
  if (!Number.isFinite(physicalRadius) || physicalRadius <= 0) {
    throw new Error(`penrosePatch: invalid physicalRadius ${physicalRadius}`);
  }
  const sampled = createPenroseModelSet({
    boundaryPolicy,
    ...(phasonOffsetSevenths === undefined ? {} : { phasonOffsetSevenths })
  }).sample({
    coefficientRanges: Array.from({ length: 4 }, () => ({
      min: -coefficientRadius,
      max: coefficientRadius
    }))
  });
  const points = sampled.points.filter((point) => {
    const [x, y] = penroseCartesian(point.parallelExact);
    return Math.hypot(x!, y!) <= physicalRadius + 1e-12;
  });
  const index = new Map(points.map((point, i) => [coefficientKey(point.coefficients), i]));
  const edges: number[] = [];
  const edgeDirections: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let direction = 0; direction < EDGE_STEPS.length; direction++) {
      const neighbor = points[i]!.coefficients.map(
        (value, axis) => value + EDGE_STEPS[direction]![axis]!
      );
      const j = index.get(coefficientKey(neighbor));
      if (j !== undefined) {
        edges.push(i, j);
        edgeDirections.push(direction);
      }
    }
  }
  return {
    points,
    edges: Uint32Array.from(edges),
    edgeDirections: Uint8Array.from(edgeDirections),
    boundaryCount: sampled.boundaryCount,
    candidateCount: sampled.candidateCount
  };
}

function rotateStarMask(mask: number, steps: number): number {
  let rotated = 0;
  for (let direction = 0; direction < 10; direction++) {
    if ((mask & (1 << direction)) !== 0) rotated |= 1 << ((direction + steps) % 10);
  }
  return rotated;
}

function reflectStarMask(mask: number): number {
  let reflected = 0;
  for (let direction = 0; direction < 10; direction++) {
    if ((mask & (1 << direction)) !== 0) reflected |= 1 << ((10 - direction) % 10);
  }
  return reflected;
}

/** Canonical ten-ray vertex-star key modulo the full local dihedral action. */
export function penroseVertexStarKey(mask: number): string {
  if (!Number.isInteger(mask) || mask < 0 || mask >= 1 << 10) {
    throw new Error(`penroseVertexStarKey: invalid mask ${mask}`);
  }
  let canonical = mask;
  for (let turn = 0; turn < 10; turn++) {
    const rotated = rotateStarMask(mask, turn);
    canonical = Math.min(canonical, rotated, reflectStarMask(rotated));
  }
  return canonical.toString(2).padStart(10, '0');
}

/** Census of complete local edge stars away from a radial patch boundary. */
export function penroseVertexStarCensus(
  patch: PenrosePatch,
  { interiorRadius }: PenroseVertexStarCensusOptions
): ReadonlyMap<string, number> {
  if (!Number.isFinite(interiorRadius) || interiorRadius <= 0) {
    throw new Error(`penroseVertexStarCensus: invalid interiorRadius ${interiorRadius}`);
  }
  const masks = new Uint16Array(patch.points.length);
  for (let edge = 0; edge < patch.edgeDirections.length; edge++) {
    const left = patch.edges[edge * 2]!;
    const right = patch.edges[edge * 2 + 1]!;
    const direction = patch.edgeDirections[edge]!;
    masks[left]! |= 1 << ((direction * 2) % 10);
    masks[right]! |= 1 << ((direction * 2 + 5) % 10);
  }
  const census = new Map<string, number>();
  for (let i = 0; i < patch.points.length; i++) {
    const [x, y] = penroseCartesian(patch.points[i]!.parallelExact);
    if (Math.hypot(x!, y!) > interiorRadius + 1e-12) continue;
    const key = penroseVertexStarKey(masks[i]!);
    census.set(key, (census.get(key) ?? 0) + 1);
  }
  return census;
}

/** Native regular pentagon, useful for internal-space renderers. */
export const penroseUnitPentagon = ZETA_POWERS;

/** Default offset numerator and common denominator of the regular cut. */
export const penroseDefaultPhason = {
  numerator: [phiRing.one, phiRing.one] as PenrosePhasonOffset,
  denominator: SEVEN
} as const;
