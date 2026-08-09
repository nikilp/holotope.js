/**
 * Shared combinatorics for the simplicial polytope builders' authoring range.
 *
 * The ordering contract these helpers implement is frozen (P55B Part B):
 * `(k+1)`-subsets enumerate lexicographically over ascending indices, and a
 * combinatorial explosion refuses arithmetically — by name, with the
 * offending numbers — before a single element is allocated.
 */

/**
 * Per-group index budget. `Uint32Array` could hold more; the point is that a
 * request whose *count* is astronomical should die as an error message about
 * combinatorics, not as an allocation failure half-way through a loop.
 */
const MAX_GROUP_INDICES = 2 ** 28;

/** `C(n, k)` as a float, capped: returns `Infinity` once it exceeds 2^53. */
export function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const smaller = Math.min(k, n - k);
  let result = 1;
  for (let step = 1; step <= smaller; step++) {
    result = (result * (n - smaller + step)) / step;
    if (result > Number.MAX_SAFE_INTEGER) return Number.POSITIVE_INFINITY;
  }
  return Math.round(result);
}

/** Refuses a group whose index total exceeds the budget, before allocating. */
export function assertGroupWithinBudget(
  builder: string,
  cellDim: number,
  cellCount: number,
  verticesPerCell: number
): void {
  const indexTotal = cellCount * verticesPerCell;
  if (!Number.isFinite(indexTotal) || indexTotal > MAX_GROUP_INDICES) {
    throw new Error(
      `${builder}: authoring ${cellCount} cells of dimension ${cellDim} needs ` +
      `${indexTotal} indices, above the ${MAX_GROUP_INDICES} per-group limit`
    );
  }
}

/**
 * All `size`-subsets of `0…n-1`, lexicographic, ascending within a subset —
 * exactly the order the builders' historical nested loops produced, which is
 * why the default groups stay byte-identical through this generalization.
 */
export function lexicographicSubsets(n: number, size: number): Uint32Array {
  const count = binomial(n, size);
  const out = new Uint32Array(count * size);
  const chosen = new Uint32Array(size);
  for (let slot = 0; slot < size; slot++) chosen[slot] = slot;
  let written = 0;
  while (true) {
    out.set(chosen, written);
    written += size;
    // Advance: find the rightmost slot that can still move up.
    let slot = size - 1;
    while (slot >= 0 && chosen[slot]! === n - size + slot) slot--;
    if (slot < 0) break;
    chosen[slot]!++;
    for (let rest = slot + 1; rest < size; rest++) {
      chosen[rest] = chosen[rest - 1]! + 1;
    }
  }
  return out;
}

/** Shared input validation: a safe integer dimension and a finite positive size. */
export function assertBuilderInputs(
  builder: string,
  dim: number,
  sizeName: string,
  size: number
): void {
  if (!Number.isSafeInteger(dim) || dim < 1) {
    throw new Error(`${builder}: dim must be a safe integer >= 1, got ${dim}`);
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error(`${builder}: ${sizeName} must be finite and positive, got ${size}`);
  }
}

/** Validates an explicit `maxCellDimension` against the builder's range. */
export function assertMaxCellDimension(
  builder: string,
  requested: number,
  highest: number,
  highestReason: string
): void {
  if (!Number.isSafeInteger(requested) || requested < 1) {
    throw new Error(
      `${builder}: maxCellDimension must be a safe integer >= 1, got ${requested}`
    );
  }
  if (requested > highest) {
    throw new Error(
      `${builder}: maxCellDimension ${requested} exceeds ${highest}, ${highestReason}`
    );
  }
}
