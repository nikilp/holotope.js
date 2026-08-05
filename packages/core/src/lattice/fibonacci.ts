import { phiRing, type ExactValue } from '../coxeter/exact.js';
import {
  ConvexWindow,
  FlatN,
  LatticeN,
  ModelSet,
  type ModelPoint,
  type WindowBoundaryPolicy
} from './model-set.js';

const exact = (a: bigint, b = 0n): ExactValue => ({ a, b });
const PHI: ExactValue = exact(0n, 1n);
const PHI_CONJUGATE: ExactValue = exact(1n, -1n);

/** The canonical Fibonacci cut-and-project scheme over Z[phi]. */
export function createFibonacciModelSet(
  boundaryPolicy: WindowBoundaryPolicy = 'error'
): ModelSet {
  const lattice = LatticeN.integer(phiRing, 2);
  const flat = new FlatN({
    ring: phiRing,
    parallelProjection: [[phiRing.one, PHI]],
    perpendicularProjection: [[phiRing.one, PHI_CONJUGATE]]
  });
  // The canonical singular, half-open interval
  //   phi - 2 <= x_perp < phi - 1
  // makes physical x=0 begin the substitution fixed point. Both boundary
  // hits remain reportable; their include/exclude convention is explicit.
  const window = new ConvexWindow(phiRing, 1, [
    { normal: [exact(-1n)], bound: exact(2n, -1n), boundary: 'include' },
    { normal: [exact(1n)], bound: exact(-1n, 1n), boundary: 'exclude' }
  ]);
  return new ModelSet(lattice, flat, window, boundaryPolicy);
}

export type FibonacciTile = 'L' | 'S';

export interface FibonacciPatch {
  /** `tileCount + 1` vertices, beginning at physical coordinate zero. */
  readonly points: readonly ModelPoint[];
  /** One symbol per exact vertex gap: `'L'` for phi^2, `'S'` for phi. */
  readonly tiles: readonly FibonacciTile[];
  /** Points of the underlying sample that landed on the window boundary. */
  readonly boundaryCount: number;
}

/** Prefix of the fixed point of L -> LS, S -> L. */
export function fibonacciSubstitutionPrefix(length: number): FibonacciTile[] {
  if (!Number.isInteger(length) || length < 0) {
    throw new Error(`fibonacciSubstitutionPrefix: invalid length ${length}`);
  }
  let word: FibonacciTile[] = ['L'];
  while (word.length < length) {
    word = word.flatMap((tile): FibonacciTile[] => (tile === 'L' ? ['L', 'S'] : ['L']));
  }
  return word.slice(0, length);
}

/**
 * A symbol-exact finite patch of the canonical Fibonacci model set.
 *
 * @example
 * The tile word is recovered from the geometry rather than rewritten into it.
 * Consecutive vertices, ordered along the one-dimensional physical axis
 * (`parallel[0]`), are separated by exactly two gap lengths whose ratio is
 * the golden ratio; classifying each gap as the longer or shorter one spells a
 * word, and that word is both `tiles` and a prefix of the substitution fixed
 * point — with tile counts that are consecutive Fibonacci numbers:
 * ```ts
 * const patch = fibonacciPatch(13);
 *
 * // Two gap lengths and nothing else, in ratio phi.
 * const gaps = [];
 * let previous = 0;
 * let first = true;
 * for (const point of patch.points) {
 *   const along = Number(point.parallel[0]);
 *   if (!first) gaps.push(along - previous);
 *   previous = along;
 *   first = false;
 * }
 * const long = Math.max(...gaps);
 * const short = Math.min(...gaps);
 * log(gaps.length, (long / short).toFixed(12));       // 13 '1.618033988750'
 *
 * // Classify each gap against the midpoint, and the geometry spells the word.
 * const middle = (long + short) / 2;
 * const recovered = gaps
 *   .map((gap) => (gap > middle ? 'L' : 'S'))
 *   .join('');
 * log(recovered);                                     // 'LSLLSLSLLSLLS'
 * log(recovered === patch.tiles.join(''));            // true
 * log(recovered === fibonacciSubstitutionPrefix(13).join(''));  // true
 *
 * const longs = recovered.split('L').length - 1;
 * log(longs, recovered.length - longs);               // 8 5
 * ```
 */
export function fibonacciPatch(tileCount: number): FibonacciPatch {
  if (!Number.isInteger(tileCount) || tileCount < 1) {
    throw new Error(`fibonacciPatch: invalid tileCount ${tileCount}`);
  }
  const model = createFibonacciModelSet();
  const radius = Math.max(16, tileCount * 2);
  const sampled = model.sample({
    coefficientRanges: [
      { min: -radius, max: radius },
      { min: -radius, max: radius }
    ]
  });
  const points = sampled.points
    .filter((point) => phiRing.sign(point.parallelExact[0]!) >= 0)
    .sort((left, right) => phiRing.compare(left.parallelExact[0]!, right.parallelExact[0]!))
    .slice(0, tileCount + 1);
  if (points.length !== tileCount + 1) {
    throw new Error(`fibonacciPatch: coefficient radius ${radius} produced too few points`);
  }
  const tiles: FibonacciTile[] = [];
  for (let i = 0; i < tileCount; i++) {
    const gap = phiRing.sub(points[i + 1]!.parallelExact[0]!, points[i]!.parallelExact[0]!);
    if (phiRing.key(gap) === phiRing.key(exact(1n, 1n))) tiles.push('L'); // phi^2
    else if (phiRing.key(gap) === phiRing.key(PHI)) tiles.push('S');
    else throw new Error(`fibonacciPatch: unexpected exact gap ${phiRing.key(gap)}`);
  }
  return { points, tiles, boundaryCount: sampled.boundaryCount };
}
