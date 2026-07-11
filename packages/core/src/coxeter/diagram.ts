import { integerRing, phiRing, sqrt2Ring, type ExactRing, type ExactValue } from './exact.js';

/**
 * A finite Coxeter diagram: `matrix[i][j]` is the Coxeter number m(i,j)
 * (order of sᵢsⱼ) — 1 on the diagonal, 2 for commuting mirrors, ≥ 3 for
 * a diagram link. Marks up to 5 are supported exactly: the doubled-Gram
 * entry −2cos(π/m) is then 0, −1, −√2, or −φ, all elements of a single
 * quadratic ring per diagram (mixing marks 4 and 5 would need both √2
 * and φ and is rejected).
 */
export interface CoxeterDiagram {
  readonly id: string;
  readonly rank: number;
  /** Expected group order; enumeration verifies against it. */
  readonly order: number;
  readonly matrix: ReadonlyArray<ReadonlyArray<number>>;
  readonly ring: ExactRing;
  /** C = 2G in exact form: C[i][j] = −2cos(π/m(i,j)), C[i][i] = 2. */
  readonly twoGram: ReadonlyArray<ReadonlyArray<ExactValue>>;
}

export function createCoxeterDiagram(
  id: string,
  matrix: ReadonlyArray<ReadonlyArray<number>>,
  order: number
): CoxeterDiagram {
  const rank = matrix.length;
  let needsSqrt2 = false;
  let needsPhi = false;
  for (let i = 0; i < rank; i++) {
    if (matrix[i]!.length !== rank) {
      throw new Error(`CoxeterDiagram ${id}: matrix is not ${rank}×${rank}`);
    }
    if (matrix[i]![i] !== 1) {
      throw new Error(`CoxeterDiagram ${id}: diagonal m(i,i) must be 1`);
    }
    for (let j = i + 1; j < rank; j++) {
      const m = matrix[i]![j]!;
      if (m !== matrix[j]![i]) {
        throw new Error(`CoxeterDiagram ${id}: matrix must be symmetric`);
      }
      if (!Number.isInteger(m) || m < 2 || m > 5) {
        throw new Error(
          `CoxeterDiagram ${id}: mark m(${i},${j}) = ${m} unsupported (need integer 2…5)`
        );
      }
      if (m === 4) needsSqrt2 = true;
      if (m === 5) needsPhi = true;
    }
  }
  if (needsSqrt2 && needsPhi) {
    throw new Error(`CoxeterDiagram ${id}: marks 4 and 5 in one diagram need ℤ[√2,φ] — unsupported`);
  }
  const ring = needsPhi ? phiRing : needsSqrt2 ? sqrt2Ring : integerRing;

  const two = ring.fromInt(2);
  const minusOne = ring.fromInt(-1);
  const twoGram = matrix.map((row, i) =>
    row.map((m, j) => {
      if (i === j) return two;
      switch (m) {
        case 2:
          return ring.zero;
        case 3:
          return minusOne;
        default:
          // 4 → −√2, 5 → −φ: minus the ring's radical either way.
          return ring.neg(ring.radical());
      }
    })
  );

  return { id, rank, order, matrix, ring, twoGram };
}

/** Builds the m(i,j) matrix of a linear (path) diagram from its marks. */
function path(id: string, marks: number[], order: number): CoxeterDiagram {
  const rank = marks.length + 1;
  const matrix = Array.from({ length: rank }, (_, i) =>
    Array.from({ length: rank }, (_, j) => {
      if (i === j) return 1;
      if (Math.abs(i - j) === 1) return marks[Math.min(i, j)]!;
      return 2;
    })
  );
  return createCoxeterDiagram(id, matrix, order);
}

/** Dihedral I₂(m): two mirrors at π/m. */
export const coxeterI2 = (m: number): CoxeterDiagram =>
  createCoxeterDiagram(`I2(${m})`, [[1, m], [m, 1]], 2 * m);

export const coxeterA3 = (): CoxeterDiagram => path('A3', [3, 3], 24);
export const coxeterB3 = (): CoxeterDiagram => path('B3', [3, 4], 48);
export const coxeterH3 = (): CoxeterDiagram => path('H3', [5, 3], 120);

export const coxeterA4 = (): CoxeterDiagram => path('A4', [3, 3, 3], 120);
export const coxeterB4 = (): CoxeterDiagram => path('B4', [3, 3, 4], 384);
export const coxeterF4 = (): CoxeterDiagram => path('F4', [3, 4, 3], 1152);
export const coxeterH4 = (): CoxeterDiagram => path('H4', [5, 3, 3], 14400);

/** D₄: node 0 is the branch center, joined to 1, 2, 3 by marks of 3. */
export const coxeterD4 = (): CoxeterDiagram =>
  createCoxeterDiagram(
    'D4',
    [
      [1, 3, 3, 3],
      [3, 1, 2, 2],
      [3, 2, 1, 2],
      [3, 2, 2, 1]
    ],
    192
  );
