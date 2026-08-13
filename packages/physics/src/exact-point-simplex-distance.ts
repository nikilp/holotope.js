/**
 * Why an exact point--simplex decision could not be published as finite
 * Float64 evidence.
 *
 * Exact arithmetic is an implementation detail.  Callers receive one
 * coherent Float64 witness plus outward-rounded Float64 error bounds.
 */
export type PointSimplexPublicationReason =
  | 'weight-underflow'
  | 'value-overflow'
  | 'value-underflow'
  | 'accuracy-bound-overflow';

interface PointSimplexCommonErrorBounds {
  /** Absolute error bound for each source-ordered barycentric weight. */
  readonly weightAbsoluteErrorBound: readonly number[];
  /** Absolute error bound for each coordinate of the published point. */
  readonly pointAbsoluteErrorBound: readonly number[];
  /** Absolute error bound for the published squared distance. */
  readonly squaredDistanceErrorBound: number;
}

/** Error evidence for an exact-zero point--simplex result. */
export interface PointSimplexZeroErrorBounds
  extends PointSimplexCommonErrorBounds {}

/** Error evidence for a positive point--simplex distance. */
export interface PointSimplexProjectedErrorBounds
  extends PointSimplexCommonErrorBounds {
  /** Euclidean error radius enclosing the published unit direction. */
  readonly directionErrorBound: number;
}

/** Coherent Float64 witness for an exact-zero result. */
export interface PointSimplexZeroWitness {
  /** Source-ordered barycentric weights, summing to one in Float64. */
  readonly weights: readonly number[];
  /** Permutation-invariant residual-weight anchor slot. */
  readonly anchorSlot: number;
  /** Point reconstructed from `weights` by the documented affine algorithm. */
  readonly point: readonly number[];
}

/** Coherent Float64 witness for a positive point--simplex distance. */
export interface PointSimplexProjectedWitness extends PointSimplexZeroWitness {
  /** Euclidean distance derived from the published displacement. */
  readonly distance: number;
  /** Squared Euclidean distance derived from the published displacement. */
  readonly squaredDistance: number;
  /** Unit direction from the published simplex point toward the query point. */
  readonly direction: readonly number[];
}

/** Certified positive-distance projection. */
export interface PointSimplexProjectedResult {
  /** Positive exact distance with a successfully published Float64 witness. */
  readonly status: 'projected';
  /** Exact affine rank of the supplied Float64 simplex. */
  readonly exactRank: number;
  /** Slots whose exact barycentric weights are strictly positive. */
  readonly activeSlots: readonly number[];
  /** Coherent Float64 closest-point, distance, and direction evidence. */
  readonly witness: PointSimplexProjectedWitness;
  /** Outward absolute error bounds for every published approximation. */
  readonly error: PointSimplexProjectedErrorBounds;
}

/** Certified exact-zero projection. */
export interface PointSimplexZeroResult {
  /** Exact zero distance with a successfully published Float64 witness. */
  readonly status: 'zero';
  /** Exact affine rank of the supplied Float64 simplex. */
  readonly exactRank: number;
  /** Slots whose exact barycentric weights are strictly positive. */
  readonly activeSlots: readonly number[];
  /** Coherent Float64 point and barycentric source-coordinate evidence. */
  readonly witness: PointSimplexZeroWitness;
  /** Outward absolute error bounds for every published approximation. */
  readonly error: PointSimplexZeroErrorBounds;
}

/** The supplied simplex is exactly affine-rank deficient. */
export interface PointSimplexRankDeficientResult {
  /** The supplied vertices do not span the simplex dimension they claim. */
  readonly status: 'rank-deficient';
  /** Exact affine rank of the supplied Float64 vertices. */
  readonly exactRank: number;
}

/** The exact decision exists but cannot be published by this Float64 surface. */
export interface PointSimplexUncertifiedResult {
  /** The exact decision cannot be represented by the supported Float64 surface. */
  readonly status: 'uncertified';
  /** Exact affine rank, already proved full before publication failed. */
  readonly exactRank: number;
  /** Machine-readable recovery class for the failed publication. */
  readonly reason: PointSimplexPublicationReason;
  /** Human-readable location and mechanism of the failed publication. */
  readonly detail: string;
}

/** Complete result of an exact-on-supplied-Float64 point--simplex query. */
export type PointSimplexResult =
  | PointSimplexProjectedResult
  | PointSimplexZeroResult
  | PointSimplexRankDeficientResult
  | PointSimplexUncertifiedResult;

interface Rational { readonly n: bigint; readonly d: bigint }

const ZERO: Rational = { n: 0n, d: 1n };
const ONE: Rational = { n: 1n, d: 1n };

function bigintAbs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function gcd(left: bigint, right: bigint): bigint {
  let a = bigintAbs(left);
  let b = bigintAbs(right);
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function rational(numerator: bigint, denominator = 1n): Rational {
  if (denominator === 0n) throw new Error('exact point--simplex: zero denominator');
  let n = numerator;
  let d = denominator;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const divisor = gcd(n, d);
  return divisor > 1n
    ? { n: n / divisor, d: d / divisor }
    : { n, d };
}

function add(left: Rational, right: Rational): Rational {
  return rational(left.n * right.d + right.n * left.d, left.d * right.d);
}

function subtract(left: Rational, right: Rational): Rational {
  return rational(left.n * right.d - right.n * left.d, left.d * right.d);
}

function multiply(left: Rational, right: Rational): Rational {
  return rational(left.n * right.n, left.d * right.d);
}

function divide(left: Rational, right: Rational): Rational {
  if (right.n === 0n) throw new Error('exact point--simplex: division by zero');
  return rational(left.n * right.d, left.d * right.n);
}

function compare(left: Rational, right: Rational): number {
  const a = left.n * right.d;
  const b = right.n * left.d;
  return a < b ? -1 : a > b ? 1 : 0;
}

function sign(value: Rational): number {
  return value.n < 0n ? -1 : value.n > 0n ? 1 : 0;
}

function absolute(value: Rational): Rational {
  return value.n < 0n ? { n: -value.n, d: value.d } : value;
}

function bitLength(value: bigint): number {
  let bits = 0;
  let remaining = value;
  while (remaining > 0n) {
    remaining >>= 1n;
    bits += 1;
  }
  return bits;
}

/** Decode the stored IEEE-754 value exactly, including subnormals. */
function exactFloat(value: number): Rational {
  if (!Number.isFinite(value)) {
    throw new Error('evaluateExactPointSimplexResult: coordinates must be finite');
  }
  if (value === 0) return ZERO;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = (BigInt(view.getUint32(0)) << 32n) | BigInt(view.getUint32(4));
  const signed = ((bits >> 63n) & 1n) === 1n ? -1n : 1n;
  const biased = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & 0xfffffffffffffn;
  const mantissa = biased === 0 ? fraction : fraction | (1n << 52n);
  const exponent = (biased === 0 ? 1 : biased) - 1023 - 52;
  return exponent >= 0
    ? rational(signed * mantissa * (1n << BigInt(exponent)))
    : rational(signed * mantissa, 1n << BigInt(-exponent));
}

/** Nearest finite approximation used only to construct the published witness. */
function rationalToNumber(value: Rational): number {
  if (value.n === 0n) return 0;
  const numerator = Number(value.n);
  const denominator = Number(value.d);
  if (Number.isFinite(numerator) && Number.isFinite(denominator)) {
    return numerator / denominator;
  }
  const shift = bitLength(bigintAbs(value.n)) - bitLength(value.d);
  const keep = 64;
  const power = BigInt(keep - shift);
  const scaled = power >= 0n ? value.n << power : value.n >> -power;
  let result = Number(scaled / value.d);
  let remaining = shift - keep;
  while (remaining > 0) {
    const step = Math.min(remaining, 1000);
    result *= 2 ** step;
    remaining -= step;
  }
  while (remaining < 0) {
    const step = Math.max(remaining, -1000);
    result *= 2 ** step;
    remaining -= step;
  }
  return result;
}

function dot(left: readonly Rational[], right: readonly Rational[]): Rational {
  return left.reduce(
    (sum, value, axis) => add(sum, multiply(value, right[axis]!)), ZERO
  );
}

function solveExact(matrix: Rational[][], rhs: Rational[]): Rational[] | null {
  const count = rhs.length;
  const work = matrix.map((row, index) => [...row, rhs[index]!]);
  for (let column = 0; column < count; column += 1) {
    let pivot = -1;
    for (let row = column; row < count; row += 1) {
      if (sign(work[row]![column]!) !== 0) {
        pivot = row;
        break;
      }
    }
    if (pivot < 0) return null;
    [work[column], work[pivot]] = [work[pivot]!, work[column]!];
    const head = work[column]![column]!;
    for (let row = column + 1; row < count; row += 1) {
      const factor = divide(work[row]![column]!, head);
      if (sign(factor) === 0) continue;
      for (let entry = column; entry <= count; entry += 1) {
        work[row]![entry] = subtract(
          work[row]![entry]!, multiply(factor, work[column]![entry]!)
        );
      }
    }
  }
  const result = new Array<Rational>(count).fill(ZERO);
  for (let row = count - 1; row >= 0; row -= 1) {
    let value = work[row]![count]!;
    for (let column = row + 1; column < count; column += 1) {
      value = subtract(value, multiply(work[row]![column]!, result[column]!));
    }
    result[row] = divide(value, work[row]![row]!);
  }
  return result;
}

function affineRank(vertices: readonly (readonly Rational[])[]): number {
  if (vertices.length <= 1) return 0;
  const work = vertices.slice(1).map((vertex) => vertex.map(
    (coordinate, axis) => subtract(coordinate, vertices[0]![axis]!)
  ));
  let rank = 0;
  for (let column = 0;
    column < vertices[0]!.length && rank < work.length;
    column += 1) {
    let pivot = -1;
    for (let row = rank; row < work.length; row += 1) {
      if (sign(work[row]![column]!) !== 0) {
        pivot = row;
        break;
      }
    }
    if (pivot < 0) continue;
    [work[rank], work[pivot]] = [work[pivot]!, work[rank]!];
    for (let row = rank + 1; row < work.length; row += 1) {
      const factor = divide(work[row]![column]!, work[rank]![column]!);
      if (sign(factor) === 0) continue;
      for (let entry = column; entry < vertices[0]!.length; entry += 1) {
        work[row]![entry] = subtract(
          work[row]![entry]!, multiply(factor, work[rank]![entry]!)
        );
      }
    }
    rank += 1;
  }
  return rank;
}

interface ExactWitness {
  readonly weights: readonly Rational[];
  readonly point: readonly Rational[];
  readonly squaredDistance: Rational;
}

function subsets(count: number): number[][] {
  const result: number[][] = [];
  for (let mask = 1; mask < 1 << count; mask += 1) {
    const slots: number[] = [];
    for (let slot = 0; slot < count; slot += 1) {
      if ((mask & (1 << slot)) !== 0) slots.push(slot);
    }
    result.push(slots);
  }
  return result;
}

function exactProjection(
  query: readonly Rational[],
  vertices: readonly (readonly Rational[])[]
): ExactWitness {
  let best: ExactWitness | null = null;
  for (const slots of subsets(vertices.length)) {
    const base = vertices[slots[0]!]!;
    const edges = slots.slice(1).map((slot) => vertices[slot]!.map(
      (coordinate, axis) => subtract(coordinate, base[axis]!)
    ));
    const gap = query.map((coordinate, axis) => subtract(coordinate, base[axis]!));
    const matrix = edges.map((edge) => edges.map((other) => dot(edge, other)));
    const rhs = edges.map((edge) => dot(edge, gap));
    const solved = edges.length === 0 ? [] : solveExact(matrix, rhs);
    if (solved === null) continue;
    const faceWeights = [
      solved.reduce((value, weight) => subtract(value, weight), ONE),
      ...solved
    ];
    if (faceWeights.some((weight) => sign(weight) < 0)) continue;
    const weights = new Array<Rational>(vertices.length).fill(ZERO);
    slots.forEach((slot, index) => { weights[slot] = faceWeights[index]!; });
    const point = Array.from({ length: query.length }, (_, axis) =>
      weights.reduce(
        (value, weight, index) => add(
          value, multiply(weight, vertices[index]![axis]!)
        ),
        ZERO
      )
    );
    const squaredDistance = point.reduce((value, coordinate, axis) => {
      const delta = subtract(query[axis]!, coordinate);
      return add(value, multiply(delta, delta));
    }, ZERO);
    if (best === null || compare(squaredDistance, best.squaredDistance) < 0) {
      best = { weights, point, squaredDistance };
    }
  }
  if (best === null) {
    throw new Error('evaluateExactPointSimplexResult: no feasible simplex face');
  }
  return best;
}

function canonicalSum(values: readonly number[]): number {
  return [...values]
    .sort((left, right) => Math.abs(left) - Math.abs(right) || left - right)
    .reduce((sum, value) => sum + value, 0);
}

function compareVertices(
  left: number,
  right: number,
  simplex: ArrayLike<number>,
  dimension: number
): number {
  for (let axis = 0; axis < dimension; axis += 1) {
    const a = simplex[left * dimension + axis]!;
    const b = simplex[right * dimension + axis]!;
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

function publishWeights(
  exactWeights: readonly Rational[],
  simplex: ArrayLike<number>,
  dimension: number
): { readonly weights: number[]; readonly anchor: number } {
  let anchor = 0;
  for (let slot = 1; slot < exactWeights.length; slot += 1) {
    const order = compare(exactWeights[slot]!, exactWeights[anchor]!);
    if (order > 0 || (order === 0 &&
      compareVertices(slot, anchor, simplex, dimension) < 0)) {
      anchor = slot;
    }
  }
  const weights = exactWeights.map((weight, slot) =>
    slot === anchor ? 0 : rationalToNumber(weight)
  );
  if (weights.some((weight) => !Number.isFinite(weight))) {
    throw new Error('evaluateExactPointSimplexResult: non-finite weight conversion');
  }
  weights[anchor] = 1 - canonicalSum(
    weights.filter((_, slot) => slot !== anchor)
  );
  return { weights, anchor };
}

function evaluatePoint(
  weights: readonly number[],
  anchor: number,
  simplex: ArrayLike<number>,
  dimension: number
): number[] {
  return Array.from({ length: dimension }, (_, axis) => {
    const base = simplex[anchor * dimension + axis]!;
    const offsets = weights.flatMap((weight, slot) => slot === anchor
      ? []
      : [weight * (simplex[slot * dimension + axis]! - base)]
    );
    return base + canonicalSum(offsets);
  });
}

function evaluateDisplacement(
  query: ArrayLike<number>,
  weights: readonly number[],
  anchor: number,
  simplex: ArrayLike<number>,
  dimension: number
): number[] {
  return Array.from({ length: dimension }, (_, axis) => {
    const base = simplex[anchor * dimension + axis]!;
    const offsets = weights.flatMap((weight, slot) => slot === anchor
      ? []
      : [weight * (simplex[slot * dimension + axis]! - base)]
    );
    return (query[axis]! - base) - canonicalSum(offsets);
  });
}

interface ExactErrors {
  readonly weights: readonly Rational[];
  readonly point: readonly Rational[];
  readonly squaredDistance: Rational;
  readonly directionSquared?: Rational;
}

function exactErrors(
  query: ArrayLike<number>,
  publishedWeights: readonly number[],
  publishedPoint: readonly number[],
  displacement: readonly number[],
  squaredDistance: number,
  exact: ExactWitness,
  distance?: number,
  direction?: readonly number[]
): ExactErrors {
  const weights = publishedWeights.map((weight, slot) => absolute(subtract(
    exactFloat(weight), exact.weights[slot]!
  )));
  const point = publishedPoint.map((coordinate, axis) => absolute(subtract(
    exactFloat(coordinate), exact.point[axis]!
  )));
  let displacementSquaredError = ZERO;
  for (let axis = 0; axis < displacement.length; axis += 1) {
    const exactDelta = subtract(exactFloat(query[axis]!), exact.point[axis]!);
    const error = subtract(exactFloat(displacement[axis]!), exactDelta);
    displacementSquaredError = add(
      displacementSquaredError, multiply(error, error)
    );
  }
  const squaredError = absolute(subtract(
    exactFloat(squaredDistance), exact.squaredDistance
  ));
  if (exact.squaredDistance.n === 0n || distance === undefined ||
    direction === undefined) {
    return { weights, point, squaredDistance: squaredError };
  }
  const exactDistance = exactFloat(distance);
  let divisionErrorSquared = ZERO;
  let publishedNormSquared = ZERO;
  for (let axis = 0; axis < displacement.length; axis += 1) {
    const component = exactFloat(displacement[axis]!);
    const ideal = divide(component, exactDistance);
    const divisionError = subtract(exactFloat(direction[axis]!), ideal);
    divisionErrorSquared = add(
      divisionErrorSquared, multiply(divisionError, divisionError)
    );
    publishedNormSquared = add(
      publishedNormSquared, multiply(component, component)
    );
  }
  const normRatioSquared = divide(
    publishedNormSquared, multiply(exactDistance, exactDistance)
  );
  const normScaleError = subtract(normRatioSquared, ONE);
  const normScaleSquaredBound = multiply(normScaleError, normScaleError);
  const witnessDirectionSquaredBound = divide(
    multiply(rational(4n), displacementSquaredError), exact.squaredDistance
  );
  const directionSquared = multiply(rational(3n), add(
    divisionErrorSquared,
    add(normScaleSquaredBound, witnessDirectionSquaredBound)
  ));
  return { weights, point, squaredDistance: squaredError, directionSquared };
}

type Outward =
  | { readonly kind: 'finite'; readonly value: number }
  | { readonly kind: 'overflow' };

const SIGNIFICAND = 1n << 52n;
const TWO_SIGNIFICANDS = 1n << 53n;
const FRACTION_MASK = SIGNIFICAND - 1n;

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return numerator / denominator + (numerator % denominator === 0n ? 0n : 1n);
}

function scaledCeil(
  numerator: bigint,
  denominator: bigint,
  shift: number
): bigint {
  return shift >= 0
    ? ceilDivide(numerator << BigInt(shift), denominator)
    : ceilDivide(numerator, denominator << BigInt(-shift));
}

function floatFromPositiveBits(bits: bigint): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, bits);
  return view.getFloat64(0);
}

function roundNonnegativeUp(bound: Rational): Outward {
  if (sign(bound) < 0) throw new RangeError('point--simplex bound is negative');
  if (bound.n === 0n) return { kind: 'finite', value: 0 };
  let exponent = bitLength(bound.n) - bitLength(bound.d);
  const atLeastPower = exponent >= 0
    ? bound.n >= bound.d << BigInt(exponent)
    : bound.n << BigInt(-exponent) >= bound.d;
  if (!atLeastPower) exponent -= 1;
  if (exponent > 1023) return { kind: 'overflow' };
  if (exponent < -1022) {
    return {
      kind: 'finite',
      value: floatFromPositiveBits(scaledCeil(bound.n, bound.d, 1074))
    };
  }
  let significand = scaledCeil(bound.n, bound.d, 52 - exponent);
  if (significand === TWO_SIGNIFICANDS) {
    exponent += 1;
    significand = SIGNIFICAND;
  }
  if (exponent > 1023) return { kind: 'overflow' };
  const exponentBits = BigInt(exponent + 1023);
  const bits = (exponentBits << 52n) |
    ((significand - SIGNIFICAND) & FRACTION_MASK);
  return { kind: 'finite', value: floatFromPositiveBits(bits) };
}

function roundSqrtNonnegativeUp(bound: Rational): Outward {
  if (sign(bound) < 0) throw new RangeError('point--simplex squared bound is negative');
  if (bound.n === 0n) return { kind: 'finite', value: 0 };
  const maximumSquared = multiply(
    exactFloat(Number.MAX_VALUE), exactFloat(Number.MAX_VALUE)
  );
  if (compare(bound, maximumSquared) > 0) return { kind: 'overflow' };
  let low = 1n;
  let high = 0x7fefffffffffffffn;
  while (low < high) {
    const middle = (low + high) >> 1n;
    const value = exactFloat(floatFromPositiveBits(middle));
    if (compare(multiply(value, value), bound) >= 0) high = middle;
    else low = middle + 1n;
  }
  return { kind: 'finite', value: floatFromPositiveBits(low) };
}

function finiteBound(bound: Outward): number | null {
  return bound.kind === 'overflow' ? null : bound.value;
}

function frozenNumbers(values: readonly number[]): readonly number[] {
  return Object.freeze(values.map((value) => value === 0 ? 0 : value));
}

function publishBounds(
  errors: ExactErrors
): PointSimplexZeroErrorBounds | PointSimplexProjectedErrorBounds | null {
  const weightAbsoluteErrorBound: number[] = [];
  for (const exact of errors.weights) {
    const converted = finiteBound(roundNonnegativeUp(exact));
    if (converted === null) return null;
    weightAbsoluteErrorBound.push(converted);
  }
  const pointAbsoluteErrorBound: number[] = [];
  for (const exact of errors.point) {
    const converted = finiteBound(roundNonnegativeUp(exact));
    if (converted === null) return null;
    pointAbsoluteErrorBound.push(converted);
  }
  const squaredDistanceErrorBound = finiteBound(
    roundNonnegativeUp(errors.squaredDistance)
  );
  if (squaredDistanceErrorBound === null) return null;
  const common = {
    weightAbsoluteErrorBound: Object.freeze(weightAbsoluteErrorBound),
    pointAbsoluteErrorBound: Object.freeze(pointAbsoluteErrorBound),
    squaredDistanceErrorBound
  };
  if (errors.directionSquared === undefined) return Object.freeze(common);
  const directionErrorBound = finiteBound(
    roundSqrtNonnegativeUp(errors.directionSquared)
  );
  if (directionErrorBound === null) return null;
  return Object.freeze({ ...common, directionErrorBound });
}

function validateInputs(
  point: ArrayLike<number>,
  simplex: ArrayLike<number>,
  dimension: number
): number {
  if (!Number.isSafeInteger(dimension) || dimension < 1) {
    throw new Error('evaluateExactPointSimplexResult: dimension must be a positive safe integer');
  }
  if (point.length !== dimension) {
    throw new Error(`evaluateExactPointSimplexResult: point must be R${dimension}`);
  }
  if (simplex.length % dimension !== 0) {
    throw new Error('evaluateExactPointSimplexResult: simplex length must be divisible by dimension');
  }
  const count = simplex.length / dimension;
  if (count < 2 || count > 4 || count - 1 > dimension) {
    throw new Error(
      'evaluateExactPointSimplexResult: expected a nonempty k-simplex with 1 <= k <= 3 and k <= dimension'
    );
  }
  for (let index = 0; index < point.length; index += 1) {
    if (!Number.isFinite(point[index])) {
      throw new Error('evaluateExactPointSimplexResult: point coordinates must be finite');
    }
  }
  for (let index = 0; index < simplex.length; index += 1) {
    if (!Number.isFinite(simplex[index])) {
      throw new Error('evaluateExactPointSimplexResult: simplex coordinates must be finite');
    }
  }
  return count;
}

/**
 * Evaluate a point against a nondegenerate simplex exactly on the supplied
 * Float64 geometry.
 *
 * Exact dyadic arithmetic decides affine rank, the closest active face, and
 * whether the distance is zero.  A successful result contains one coherent
 * Float64 witness: its point, distance, and direction are all derived from the
 * same published barycentric weights.  Every accuracy field is rounded
 * outward, and every returned object and array is frozen.  Caller-owned inputs
 * are neither frozen nor mutated.
 *
 * This is deliberately not a generic simplex-pair query and has no tolerance
 * knobs. It supports simplex dimensions 1 through 3 in ambient R1 or higher.
 */
export function evaluateExactPointSimplexResult(
  point: ArrayLike<number>,
  simplex: ArrayLike<number>,
  dimension: number
): PointSimplexResult {
  const count = validateInputs(point, simplex, dimension);
  const exactVertices = Array.from({ length: count }, (_, vertex) =>
    Array.from({ length: dimension }, (_, axis) =>
      exactFloat(simplex[vertex * dimension + axis]!)
    )
  );
  const rank = affineRank(exactVertices);
  if (rank < count - 1) {
    return Object.freeze({ status: 'rank-deficient', exactRank: rank });
  }
  const exact = exactProjection(
    Array.from({ length: dimension }, (_, axis) => exactFloat(point[axis]!)),
    exactVertices
  );
  const publication = publishWeights(exact.weights, simplex, dimension);
  for (let slot = 0; slot < count; slot += 1) {
    if (sign(exact.weights[slot]!) > 0 && publication.weights[slot] === 0) {
      return Object.freeze({
        status: 'uncertified', exactRank: rank, reason: 'weight-underflow',
        detail: `positive exact weight at slot ${slot} rounds to zero`
      });
    }
  }
  const publishedPoint = evaluatePoint(
    publication.weights, publication.anchor, simplex, dimension
  );
  if (publishedPoint.some((coordinate) => !Number.isFinite(coordinate))) {
    return Object.freeze({
      status: 'uncertified', exactRank: rank, reason: 'value-overflow',
      detail: 'published witness point is not finite'
    });
  }
  const displacement = evaluateDisplacement(
    point, publication.weights, publication.anchor, simplex, dimension
  );
  let squaredDistance = 0;
  for (const component of displacement) squaredDistance += component * component;
  if (!Number.isFinite(squaredDistance)) {
    return Object.freeze({
      status: 'uncertified', exactRank: rank, reason: 'value-overflow',
      detail: 'published squared distance is not finite'
    });
  }
  const activeSlots = frozenNumbers(exact.weights.flatMap(
    (weight, slot) => sign(weight) > 0 ? [slot] : []
  ));
  const witnessBase = {
    weights: frozenNumbers(publication.weights),
    anchorSlot: publication.anchor,
    point: frozenNumbers(publishedPoint)
  };
  if (exact.squaredDistance.n === 0n) {
    const errors = exactErrors(
      point, publication.weights, publishedPoint, displacement,
      squaredDistance, exact
    );
    const error = publishBounds(errors);
    if (error === null) {
      return Object.freeze({
        status: 'uncertified', exactRank: rank,
        reason: 'accuracy-bound-overflow',
        detail: 'an exact publication-error bound has no finite Float64 enclosure'
      });
    }
    return Object.freeze({
      status: 'zero', exactRank: rank, activeSlots,
      witness: Object.freeze(witnessBase), error
    });
  }
  if (squaredDistance === 0) {
    return Object.freeze({
      status: 'uncertified', exactRank: rank, reason: 'value-underflow',
      detail: 'positive exact distance publishes as zero'
    });
  }
  const distance = Math.sqrt(squaredDistance);
  if (distance === 0) {
    return Object.freeze({
      status: 'uncertified', exactRank: rank, reason: 'value-underflow',
      detail: 'positive exact distance underflows Float64'
    });
  }
  const direction = displacement.map((component) => component / distance);
  const errors = exactErrors(
    point, publication.weights, publishedPoint, displacement,
    squaredDistance, exact, distance, direction
  );
  const error = publishBounds(errors);
  if (error === null) {
    return Object.freeze({
      status: 'uncertified', exactRank: rank,
      reason: 'accuracy-bound-overflow',
      detail: 'an exact publication-error bound has no finite Float64 enclosure'
    });
  }
  if (!('directionErrorBound' in error)) {
    throw new Error('evaluateExactPointSimplexResult: missing direction bound');
  }
  return Object.freeze({
    status: 'projected', exactRank: rank, activeSlots,
    witness: Object.freeze({
      ...witnessBase,
      distance: distance === 0 ? 0 : distance,
      squaredDistance: squaredDistance === 0 ? 0 : squaredDistance,
      direction: frozenNumbers(direction)
    }),
    error
  });
}
