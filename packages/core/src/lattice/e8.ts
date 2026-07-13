import { CellComplex } from '../geometry/cell-complex.js';
import { orbitDistanceTuples } from '../coxeter/action.js';
import { coxeterE8 } from '../coxeter/diagram.js';
import { phiRing, type ExactValue } from '../coxeter/exact.js';

/** Which real embedding of Z[phi] is used to obtain a point in R^4. */
export type PhiEmbedding = 'parallel' | 'perpendicular';

/** The two norm-2 icosian shells whose union is the E8 root system. */
export type E8RootShell = 'unit' | 'conjugate';

/** Exact provenance classes of the folded E8 root-polytope edges. */
export type E8EdgeClass = 'parallel-skeleton' | 'perpendicular-skeleton' | 'chord' | 'strut';

/** Four doubled quaternion coordinates in Z[phi]. The represented point is q = coords / 2. */
export type DoubledIcosian = readonly [ExactValue, ExactValue, ExactValue, ExactValue];

/** A standard E8 coordinate vector multiplied by two, so every entry is integral. */
export type DoubledE8Vector = readonly [
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint
];

/**
 * Exact base change from `[a0..a3,b0..b3]` of a doubled icosian to a
 * doubled standard E8 coordinate vector. The inverse matrix is stored as
 * integer numerators over the common denominator two.
 */
export interface E8BaseChange {
  readonly icosianToInteger: ReadonlyArray<ReadonlyArray<bigint>>;
  readonly integerToIcosianNumerators: ReadonlyArray<ReadonlyArray<bigint>>;
  readonly integerToIcosianDenominator: 2n;
}

export interface IcosianE8Data {
  /** The 240 exact roots: 120 unit icosians followed by (1-phi) times those 120. */
  readonly roots: readonly DoubledIcosian[];
  /** Shell provenance, parallel to `roots`. */
  readonly shells: readonly E8RootShell[];
  /** Both Galois readings of the same exact roots, packed as 240 points in R^4. */
  readonly parallelPositions: Float64Array;
  readonly perpendicularPositions: Float64Array;
  /** Metric-nearest pairs of both 600-cell shells in the parallel embedding. */
  readonly parallelMetricSkeletonEdges: Uint32Array;
  /** Metric-nearest pairs of both 600-cell shells in the perpendicular embedding. */
  readonly perpendicularMetricSkeletonEdges: Uint32Array;
  /** All 6720 minimal-distance pairs. */
  readonly edges: Uint32Array;
  /** 720 E8 edges that are metric shell edges in the parallel embedding. */
  readonly parallelSkeletonEdges: Uint32Array;
  /** 720 E8 edges that are metric shell edges in the perpendicular embedding. */
  readonly perpendicularSkeletonEdges: Uint32Array;
  /** The remaining 2400 in-shell E8 edges, which are chords in both embeddings. */
  readonly chordEdges: Uint32Array;
  /** The 2880 edges joining the two shells. */
  readonly strutEdges: Uint32Array;
}

const ZERO: ExactValue = { a: 0n, b: 0n };
const ONE: ExactValue = { a: 1n, b: 0n };
const PHI: ExactValue = { a: 0n, b: 1n };
const INV_PHI: ExactValue = { a: -1n, b: 1n };
const PHI_CONJUGATE: ExactValue = { a: 1n, b: -1n };

const ICOSIAN_TO_INTEGER = [
  [-1n, 1n, 0n, 0n, -1n, 1n, 0n, 0n],
  [-1n, -1n, 0n, 0n, -1n, -1n, 0n, 0n],
  [0n, 0n, -1n, -1n, 0n, 0n, -1n, -1n],
  [0n, 0n, 0n, 0n, 0n, 1n, -1n, 0n],
  [0n, 0n, 1n, -1n, 0n, 0n, 1n, -1n],
  [0n, 0n, 0n, 0n, 0n, 1n, 1n, 0n],
  [0n, 0n, 0n, 0n, 1n, 0n, 0n, -1n],
  [0n, 0n, 0n, 0n, -1n, 0n, 0n, -1n]
] as const;

const INTEGER_TO_ICOSIAN_NUMERATORS = [
  [-1n, -1n, 0n, 0n, 0n, 0n, -1n, 1n],
  [1n, -1n, 0n, -1n, 0n, -1n, 0n, 0n],
  [0n, 0n, -1n, 1n, 1n, -1n, 0n, 0n],
  [0n, 0n, -1n, 0n, -1n, 0n, 1n, 1n],
  [0n, 0n, 0n, 0n, 0n, 0n, 1n, -1n],
  [0n, 0n, 0n, 1n, 0n, 1n, 0n, 0n],
  [0n, 0n, 0n, -1n, 0n, 1n, 0n, 0n],
  [0n, 0n, 0n, 0n, 0n, 0n, -1n, -1n]
] as const;

export const e8BaseChange: E8BaseChange = {
  icosianToInteger: ICOSIAN_TO_INTEGER,
  integerToIcosianNumerators: INTEGER_TO_ICOSIAN_NUMERATORS,
  integerToIcosianDenominator: 2n
};

let cached: IcosianE8Data | null = null;
let cachedCoxeterRoots: readonly ExactValue[][] | null = null;
let cachedIntegerSecondShell: readonly DoubledE8Vector[] | null = null;
const cachedIntegerNormBalls = new Map<number, readonly DoubledE8Vector[]>();

const exact = (a: bigint, b = 0n): ExactValue => ({ a, b });
const scale = (x: ExactValue, s: bigint): ExactValue => ({ a: x.a * s, b: x.b * s });

function valueKey(x: ExactValue): string {
  return `${x.a},${x.b}`;
}

function rootKey(root: DoubledIcosian): string {
  return root.map(valueKey).join('|');
}

function edgeKey(left: number, right: number): string {
  return `${left},${right}`;
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

function permutations4(): number[][] {
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

function unitIcosians(): DoubledIcosian[] {
  const roots = new Map<string, DoubledIcosian>();
  const add = (root: DoubledIcosian): void => {
    roots.set(rootKey(root), root);
  };

  // 8 coordinate units: (±2, 0, 0, 0), including permutations.
  for (let axis = 0; axis < 4; axis++) {
    for (const sign of [1n, -1n]) {
      const root: ExactValue[] = [ZERO, ZERO, ZERO, ZERO];
      root[axis] = exact(2n * sign);
      add(root as unknown as DoubledIcosian);
    }
  }

  // 16 half-coordinate units: (±1, ±1, ±1, ±1) after doubling.
  for (let mask = 0; mask < 16; mask++) {
    add([0, 1, 2, 3].map((axis) => exact((mask & (1 << axis)) === 0 ? 1n : -1n)) as unknown as DoubledIcosian);
  }

  // 96 units: even permutations of (0, ±1, ±1/phi, ±phi), doubled.
  for (const permutation of permutations4()) {
    for (let mask = 0; mask < 8; mask++) {
      const source = [
        ZERO,
        scale(ONE, (mask & 1) === 0 ? 1n : -1n),
        scale(INV_PHI, (mask & 2) === 0 ? 1n : -1n),
        scale(PHI, (mask & 4) === 0 ? 1n : -1n)
      ];
      const root: ExactValue[] = [ZERO, ZERO, ZERO, ZERO];
      for (let i = 0; i < 4; i++) root[permutation[i]!] = source[i]!;
      add(root as unknown as DoubledIcosian);
    }
  }

  if (roots.size !== 120) {
    throw new Error(`unitIcosians: expected 120 roots, got ${roots.size}`);
  }
  return [...roots.values()];
}

function asDoubledE8Vector(values: readonly bigint[]): DoubledE8Vector {
  if (values.length !== 8) throw new Error(`E8 vector needs 8 coordinates, got ${values.length}`);
  return values as unknown as DoubledE8Vector;
}

function icosianVector(root: DoubledIcosian): bigint[] {
  return [
    root[0].a,
    root[1].a,
    root[2].a,
    root[3].a,
    root[0].b,
    root[1].b,
    root[2].b,
    root[3].b
  ];
}

function multiplyIntegerMatrix(
  matrix: ReadonlyArray<ReadonlyArray<bigint>>,
  vector: readonly bigint[]
): bigint[] {
  return matrix.map((row) => row.reduce((sum, value, i) => sum + value * vector[i]!, 0n));
}

/** Map a doubled icosian exactly into the standard doubled E8 coordinate model. */
export function icosianToE8Integer(root: DoubledIcosian): DoubledE8Vector {
  return asDoubledE8Vector(multiplyIntegerMatrix(ICOSIAN_TO_INTEGER, icosianVector(root)));
}

/**
 * Map a standard doubled E8 lattice vector into doubled icosian
 * coordinates. Throws when the supplied integer vector is outside the E8
 * parity lattice and would require half-integral icosian coefficients.
 */
export function e8IntegerToIcosian(vector: DoubledE8Vector): DoubledIcosian {
  const numerators = multiplyIntegerMatrix(INTEGER_TO_ICOSIAN_NUMERATORS, vector);
  if (numerators.some((value) => value % 2n !== 0n)) {
    throw new Error('e8IntegerToIcosian: vector is outside the doubled E8 parity lattice');
  }
  const coordinates = numerators.map((value) => value / 2n);
  return [
    { a: coordinates[0]!, b: coordinates[4]! },
    { a: coordinates[1]!, b: coordinates[5]! },
    { a: coordinates[2]!, b: coordinates[6]! },
    { a: coordinates[3]!, b: coordinates[7]! }
  ];
}

/** The canonical 240 standard E8 roots in doubled integer coordinates. */
export function e8IntegerRoots(): readonly DoubledE8Vector[] {
  const roots: DoubledE8Vector[] = [];
  // 112 roots: permutations of (±2, ±2, 0^6).
  for (let i = 0; i < 8; i++) {
    for (let j = i + 1; j < 8; j++) {
      for (const left of [-2n, 2n]) {
        for (const right of [-2n, 2n]) {
          const root = Array<bigint>(8).fill(0n);
          root[i] = left;
          root[j] = right;
          roots.push(asDoubledE8Vector(root));
        }
      }
    }
  }
  // 128 roots: (±1)^8 with an even number of minus signs.
  for (let mask = 0; mask < 256; mask++) {
    let minus = 0;
    const root = Array.from({ length: 8 }, (_, i) => {
      const value = (mask & (1 << i)) === 0 ? 1n : -1n;
      if (value < 0n) minus++;
      return value;
    });
    if (minus % 2 === 0) roots.push(asDoubledE8Vector(root));
  }
  return roots;
}

/**
 * The 2,160 norm-4 vectors of E8 in doubled standard coordinates.
 *
 * The integer coset contributes the axis vectors `(±4,0^7)` and the
 * four-coordinate vectors `(±2)^4`; the half-integer coset contributes
 * `(±3,±1^7)` subject to the E8 parity condition.
 */
export function e8IntegerSecondShell(): readonly DoubledE8Vector[] {
  if (cachedIntegerSecondShell) return cachedIntegerSecondShell;
  const vectors: DoubledE8Vector[] = [];

  for (let axis = 0; axis < 8; axis++) {
    for (const sign of [-4n, 4n]) {
      const vector = Array<bigint>(8).fill(0n);
      vector[axis] = sign;
      vectors.push(asDoubledE8Vector(vector));
    }
  }

  const chooseFour = (start: number, selected: number[]): void => {
    if (selected.length === 4) {
      for (let mask = 0; mask < 16; mask++) {
        const vector = Array<bigint>(8).fill(0n);
        for (let i = 0; i < 4; i++) vector[selected[i]!] = (mask & (1 << i)) === 0 ? 2n : -2n;
        vectors.push(asDoubledE8Vector(vector));
      }
      return;
    }
    for (let axis = start; axis <= 8 - (4 - selected.length); axis++) {
      chooseFour(axis + 1, [...selected, axis]);
    }
  };
  chooseFour(0, []);

  for (let largeAxis = 0; largeAxis < 8; largeAxis++) {
    for (const largeSign of [-3n, 3n]) {
      for (let mask = 0; mask < 128; mask++) {
        const vector: bigint[] = [];
        let bit = 0;
        for (let axis = 0; axis < 8; axis++) {
          if (axis === largeAxis) vector.push(largeSign);
          else vector.push((mask & (1 << bit++)) === 0 ? 1n : -1n);
        }
        const integerCoordinateSum = vector.reduce((sum, value) => sum + (value - 1n) / 2n, 0n);
        if (integerCoordinateSum % 2n === 0n) vectors.push(asDoubledE8Vector(vector));
      }
    }
  }

  if (vectors.length !== 2160) {
    throw new Error(`e8IntegerSecondShell: expected 2160 vectors, got ${vectors.length}`);
  }
  cachedIntegerSecondShell = vectors;
  return cachedIntegerSecondShell;
}

/**
 * Every standard E8 lattice vector with quadratic norm at most `maxNorm`.
 * The bound is spherical in E8, so complete Weyl/H4 orbits are never clipped
 * by an arbitrary coordinate box.
 */
export function e8IntegerVectorsThroughNorm(maxNorm: number): readonly DoubledE8Vector[] {
  if (!Number.isSafeInteger(maxNorm) || maxNorm < 0 || maxNorm > 12) {
    throw new Error(`e8IntegerVectorsThroughNorm: invalid norm bound ${maxNorm}`);
  }
  const cached = cachedIntegerNormBalls.get(maxNorm);
  if (cached) return cached;
  const vectors: DoubledE8Vector[] = [];

  const integer = Array<bigint>(8).fill(0n);
  const visitInteger = (axis: number, norm: number, sum: number): void => {
    if (axis === 8) {
      if ((sum & 1) === 0) vectors.push(asDoubledE8Vector(integer.map((value) => 2n * value)));
      return;
    }
    const limit = Math.floor(Math.sqrt(maxNorm - norm));
    for (let value = -limit; value <= limit; value++) {
      integer[axis] = BigInt(value);
      visitInteger(axis + 1, norm + value * value, sum + value);
    }
  };
  visitInteger(0, 0, 0);

  const half = Array<bigint>(8).fill(1n);
  const maxDoubledNorm = 4 * maxNorm;
  const visitHalf = (axis: number, doubledNorm: number, integerPartSum: number): void => {
    if (axis === 8) {
      if ((integerPartSum & 1) === 0) vectors.push(asDoubledE8Vector(half.slice()));
      return;
    }
    const limit = Math.floor(Math.sqrt(maxDoubledNorm - doubledNorm));
    for (let value = -limit; value <= limit; value++) {
      if ((Math.abs(value) & 1) === 0) continue;
      half[axis] = BigInt(value);
      visitHalf(axis + 1, doubledNorm + value * value, integerPartSum + (value - 1) / 2);
    }
  };
  visitHalf(0, 0, 0);

  vectors.sort((left, right) => {
    const leftNorm = left.reduce((sum, value) => sum + value * value, 0n);
    const rightNorm = right.reduce((sum, value) => sum + value * value, 0n);
    if (leftNorm !== rightNorm) return leftNorm < rightNorm ? -1 : 1;
    return left.join(',').localeCompare(right.join(','));
  });
  cachedIntegerNormBalls.set(maxNorm, vectors);
  return vectors;
}

/** Evaluate a Z[phi] value in either of its two real embeddings. */
export function evaluatePhi(value: ExactValue, embedding: PhiEmbedding = 'parallel'): number {
  const radical = embedding === 'parallel' ? (1 + Math.sqrt(5)) / 2 : (1 - Math.sqrt(5)) / 2;
  return Number(value.a) + Number(value.b) * radical;
}

/** Exact quaternionic norm of a doubled icosian (four times the norm of the represented q). */
export function doubledIcosianNorm(root: DoubledIcosian): ExactValue {
  let sum = phiRing.zero;
  for (const coordinate of root) sum = phiRing.add(sum, phiRing.mul(coordinate, coordinate));
  return sum;
}

/** The integral E8 quadratic form Q(q) = 2(a+b), accounting for doubled storage. */
export function e8QuadraticNorm(root: DoubledIcosian): bigint {
  const norm = doubledIcosianNorm(root);
  const numerator = norm.a + norm.b;
  if (numerator % 2n !== 0n) throw new Error('e8QuadraticNorm: non-integral result');
  return numerator / 2n;
}

/** The integral bilinear form polarizing `e8QuadraticNorm`. */
export function e8InnerProduct(left: DoubledIcosian, right: DoubledIcosian): bigint {
  const sum = left.map((coordinate, i) => phiRing.add(coordinate, right[i]!)) as unknown as DoubledIcosian;
  const numerator = e8QuadraticNorm(sum) - e8QuadraticNorm(left) - e8QuadraticNorm(right);
  if (numerator % 2n !== 0n) throw new Error('e8InnerProduct: non-integral result');
  return numerator / 2n;
}

function phiDot(left: DoubledIcosian, right: DoubledIcosian): ExactValue {
  let sum = phiRing.zero;
  for (let i = 0; i < 4; i++) sum = phiRing.add(sum, phiRing.mul(left[i]!, right[i]!));
  return sum;
}

function sameValue(left: ExactValue, right: ExactValue): boolean {
  return left.a === right.a && left.b === right.b;
}

/** Exact sign after either real embedding, via integer comparison with sqrt(5). */
function embeddedSign(value: ExactValue, embedding: PhiEmbedding): number {
  const rational = 2n * value.a + value.b;
  const radical = embedding === 'parallel' ? value.b : -value.b;
  if (radical === 0n) return rational < 0n ? -1 : rational > 0n ? 1 : 0;
  if (rational === 0n) return radical < 0n ? -1 : 1;
  if ((rational < 0n) === (radical < 0n)) return rational < 0n ? -1 : 1;
  const comparison = rational * rational - 5n * radical * radical;
  if (comparison === 0n) return 0;
  return rational > 0n === comparison > 0n ? 1 : -1;
}

function compareEmbedded(left: ExactValue, right: ExactValue, embedding: PhiEmbedding): number {
  return embeddedSign(phiRing.sub(left, right), embedding);
}

function metricSkeletons(
  roots: readonly DoubledIcosian[],
  embedding: PhiEmbedding
): Uint32Array {
  const edges: number[] = [];
  for (const start of [0, 120]) {
    let nearestDot: ExactValue | null = null;
    for (let i = start; i < start + 120; i++) {
      for (let j = i + 1; j < start + 120; j++) {
        const dot = phiDot(roots[i]!, roots[j]!);
        if (!nearestDot || compareEmbedded(dot, nearestDot, embedding) > 0) nearestDot = dot;
      }
    }
    for (let i = start; i < start + 120; i++) {
      for (let j = i + 1; j < start + 120; j++) {
        if (sameValue(phiDot(roots[i]!, roots[j]!), nearestDot!)) edges.push(i, j);
      }
    }
  }
  return Uint32Array.from(edges);
}

function positions(roots: readonly DoubledIcosian[], embedding: PhiEmbedding): Float64Array {
  const out = new Float64Array(roots.length * 4);
  for (let i = 0; i < roots.length; i++) {
    for (let c = 0; c < 4; c++) out[i * 4 + c] = evaluatePhi(roots[i]![c]!, embedding) / 2;
  }
  return out;
}

/**
 * The E8 roots in the icosian model, with exact folded-edge provenance.
 *
 * The construction never classifies an edge by a floating threshold. E8
 * adjacency is the exact condition B(x,y)=1; the two in-shell classes are
 * separated by their exact Z[phi] quaternion inner products.
 */
export function icosianE8Data(): IcosianE8Data {
  if (cached) return cached;

  const units = unitIcosians();
  const conjugates = units.map(
    (root) => root.map((coordinate) => phiRing.mul(PHI_CONJUGATE, coordinate)) as unknown as DoubledIcosian
  );
  const roots = [...units, ...conjugates];
  const shells: E8RootShell[] = roots.map((_, i) => (i < 120 ? 'unit' : 'conjugate'));
  const parallelMetricSkeletonEdges = metricSkeletons(roots, 'parallel');
  const perpendicularMetricSkeletonEdges = metricSkeletons(roots, 'perpendicular');
  const parallelMetric = new Set<string>();
  const perpendicularMetric = new Set<string>();
  for (let i = 0; i < parallelMetricSkeletonEdges.length; i += 2) {
    parallelMetric.add(edgeKey(parallelMetricSkeletonEdges[i]!, parallelMetricSkeletonEdges[i + 1]!));
    perpendicularMetric.add(
      edgeKey(perpendicularMetricSkeletonEdges[i]!, perpendicularMetricSkeletonEdges[i + 1]!)
    );
  }
  const edges: number[] = [];
  const parallelSkeleton: number[] = [];
  const perpendicularSkeleton: number[] = [];
  const chords: number[] = [];
  const struts: number[] = [];

  for (let i = 0; i < roots.length; i++) {
    for (let j = i + 1; j < roots.length; j++) {
      if (e8InnerProduct(roots[i]!, roots[j]!) !== 1n) continue;
      edges.push(i, j);
      if (shells[i] !== shells[j]) {
        struts.push(i, j);
        continue;
      }
      const key = edgeKey(i, j);
      if (parallelMetric.has(key)) parallelSkeleton.push(i, j);
      else if (perpendicularMetric.has(key)) perpendicularSkeleton.push(i, j);
      else chords.push(i, j);
    }
  }

  cached = {
    roots,
    shells,
    parallelPositions: positions(roots, 'parallel'),
    perpendicularPositions: positions(roots, 'perpendicular'),
    parallelMetricSkeletonEdges,
    perpendicularMetricSkeletonEdges,
    edges: Uint32Array.from(edges),
    parallelSkeletonEdges: Uint32Array.from(parallelSkeleton),
    perpendicularSkeletonEdges: Uint32Array.from(perpendicularSkeleton),
    chordEdges: Uint32Array.from(chords),
    strutEdges: Uint32Array.from(struts)
  };
  return cached;
}

export interface FoldedE8ShellOptions {
  /** Which Galois embedding supplies the R^4 positions. Default `parallel`. */
  embedding?: PhiEmbedding;
  /** Uniform scale applied after embedding. Default 1. */
  scale?: number;
}

/** The two folded 600-cell vertex sets with their metric skeletons. */
export function createFoldedE8Shells({
  embedding = 'parallel',
  scale: outputScale = 1
}: FoldedE8ShellOptions = {}): CellComplex {
  if (!Number.isFinite(outputScale) || outputScale <= 0) {
    throw new Error(`createFoldedE8Shells: scale must be positive and finite, got ${outputScale}`);
  }
  const data = icosianE8Data();
  const source = embedding === 'parallel' ? data.parallelPositions : data.perpendicularPositions;
  return new CellComplex(4, Float64Array.from(source, (value) => value * outputScale), [
    {
      dim: 1,
      verticesPerCell: 2,
      kind: 'simplex',
      indices: (embedding === 'parallel'
        ? data.parallelMetricSkeletonEdges
        : data.perpendicularMetricSkeletonEdges
      ).slice()
    }
  ]);
}

/**
 * The same 240 E8 roots reached as an exact orbit of one simple root in
 * the rank-8 Coxeter representation. This is the integer model; use
 * `icosianE8Data` when the H4 folding and its two embeddings are needed.
 */
export function e8RootOrbit(): readonly ExactValue[][] {
  if (!cachedCoxeterRoots) {
    const diagram = coxeterE8();
    const seed = diagram.twoGram.map((row) => row[0]!);
    cachedCoxeterRoots = orbitDistanceTuples(diagram, seed);
    if (cachedCoxeterRoots.length !== 240) {
      throw new Error(`e8RootOrbit: expected 240 roots, got ${cachedCoxeterRoots.length}`);
    }
  }
  return cachedCoxeterRoots;
}

export interface FoldedE8Options {
  /** Which Galois embedding supplies the R^4 positions. Default `parallel`. */
  embedding?: PhiEmbedding;
  /** Exact edge classes to include. Default all three. */
  edgeClasses?: readonly E8EdgeClass[];
  /** Uniform scale applied after embedding. Default 1. */
  scale?: number;
}

/**
 * A 4D renderable view of the E8 root polytope under the H4 folding.
 * This is a view of the 8D root system, not a claim that E8 is 4D.
 */
export function createFoldedE8Roots({
  embedding = 'parallel',
  edgeClasses = ['parallel-skeleton', 'perpendicular-skeleton', 'chord', 'strut'],
  scale: outputScale = 1
}: FoldedE8Options = {}): CellComplex {
  if (!Number.isFinite(outputScale) || outputScale <= 0) {
    throw new Error(`createFoldedE8Roots: scale must be positive and finite, got ${outputScale}`);
  }
  const data = icosianE8Data();
  const source = embedding === 'parallel' ? data.parallelPositions : data.perpendicularPositions;
  const positions = Float64Array.from(source, (value) => value * outputScale);
  const byClass: Record<E8EdgeClass, Uint32Array> = {
    'parallel-skeleton': data.parallelSkeletonEdges,
    'perpendicular-skeleton': data.perpendicularSkeletonEdges,
    chord: data.chordEdges,
    strut: data.strutEdges
  };
  return new CellComplex(
    4,
    positions,
    edgeClasses.map((edgeClass) => ({
      dim: 1,
      verticesPerCell: 2,
      kind: 'simplex' as const,
      indices: byClass[edgeClass].slice()
    }))
  );
}
