/**
 * P66E Part B — an independent high-precision oracle for the scalar barrier
 * law, and the arbitrary-precision arithmetic it needs.
 *
 * ## Why this cannot reuse the production formulas
 *
 * The question Part B answers is "which outputs are mathematically
 * representable, and which does the released implementation lose anyway".
 * An oracle built from the released expressions cannot separate those: it
 * would overflow in exactly the places the implementation overflows, and every
 * intermediate-overflow row would read as a genuinely unrepresentable output.
 *
 * So the oracle starts from the PUBLISHED LAW and nothing else:
 *
 *     E(x)   = -k (x - a)^2 log(x / a)
 *     E'(x)  = -k [ 2 (x - a) log(x / a) + (x - a)^2 / x ]
 *     E''(x) = -k [ 2 log(x / a) + 3 - 2 a / x - a^2 / x^2 ]
 *
 * The two derivative forms are differentiations of the energy, done by hand.
 * That is an independent derivation, not an independent check — so the
 * calibration drives them against high-precision CENTRAL DIFFERENCES of the
 * oracle's own energy, which depends on no derivative formula at all. If a
 * derivative here were mis-derived, the difference quotient would disagree.
 *
 * ## Why arbitrary precision, and in this shape
 *
 * Every classification in Part B is a statement about Float64 boundaries, so
 * the oracle must be able to compute values Float64 cannot hold — `a^2 / x^2`
 * for small `x` is past 1e308 long before the energy is in any trouble.
 *
 * The representation is a binary float with a fixed significand width, NOT
 * fixed point. Fixed point cannot hold both `MIN_VALUE` (2^-1074) and the
 * squares of large ratios without thousands of bits; a mantissa-and-exponent
 * pair holds both at constant cost.
 */

/** Significand bits. ~72 decimal digits — far past any Float64 decision. */
const PRECISION = 240;
const PRECISION_BIG = BigInt(PRECISION);

/**
 * `value = mantissa * 2^exponent`, with `|mantissa|` normalized to exactly
 * PRECISION bits, or `mantissa === 0n` for exact zero.
 */
export interface BigFloat {
  readonly mantissa: bigint;
  readonly exponent: number;
}

export const ZERO: BigFloat = { mantissa: 0n, exponent: 0 };

const bitLength = (value: bigint): number => {
  if (value === 0n) return 0;
  let length = 0;
  let rest = value;
  // Coarse 64-bit strides first, so a 240-bit value costs a handful of steps
  // rather than a decimal-string conversion per operation.
  while (rest >= 0x10000000000000000n) { rest >>= 64n; length += 64; }
  while (rest > 0n) { rest >>= 1n; length += 1; }
  return length;
};

function normalize(mantissa: bigint, exponent: number): BigFloat {
  if (mantissa === 0n) return ZERO;
  const negative = mantissa < 0n;
  const magnitude = negative ? -mantissa : mantissa;
  const shift = bitLength(magnitude) - PRECISION;
  const scaled = shift > 0 ? magnitude >> BigInt(shift) : magnitude << BigInt(-shift);
  return { mantissa: negative ? -scaled : scaled, exponent: exponent + shift };
}

/** Exact: a Float64 is a dyadic rational, so nothing is lost here. */
export function fromNumber(value: number): BigFloat {
  if (value === 0) return ZERO;
  if (!Number.isFinite(value)) throw new Error('fromNumber: not finite');
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const high = view.getUint32(0);
  const low = view.getUint32(4);
  const negative = (high >>> 31) === 1;
  const biased = (high >>> 20) & 0x7ff;
  let mantissa = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
  let exponent: number;
  if (biased === 0) {
    exponent = -1074;                       // subnormal
  } else {
    mantissa |= 1n << 52n;                  // implicit leading bit
    exponent = biased - 1075;
  }
  return normalize(negative ? -mantissa : mantissa, exponent);
}

export const fromInt = (value: number): BigFloat => fromNumber(value);

export const negate = (a: BigFloat): BigFloat =>
  ({ mantissa: -a.mantissa, exponent: a.exponent });

export function add(a: BigFloat, b: BigFloat): BigFloat {
  if (a.mantissa === 0n) return b;
  if (b.mantissa === 0n) return a;
  const aIsLarger = a.exponent >= b.exponent;
  const larger = aIsLarger ? a : b;
  const smaller = aIsLarger ? b : a;
  const gap = larger.exponent - smaller.exponent;
  // Past the significand width the smaller term lies entirely below the
  // result's last bit, so it is DROPPED. It must not instead be shifted by a
  // capped amount: capping the alignment rescales one term by a different
  // power of two than its exponent says, which silently returns a value with
  // no relation to either input.
  if (gap > PRECISION + 2) return larger;
  return normalize(
    (larger.mantissa << BigInt(gap)) + smaller.mantissa,
    smaller.exponent
  );
}

export const subtract = (a: BigFloat, b: BigFloat): BigFloat => add(a, negate(b));

export const multiply = (a: BigFloat, b: BigFloat): BigFloat =>
  normalize(a.mantissa * b.mantissa, a.exponent + b.exponent);

export function divide(a: BigFloat, b: BigFloat): BigFloat {
  if (b.mantissa === 0n) throw new Error('divide: by zero');
  if (a.mantissa === 0n) return ZERO;
  return normalize(
    (a.mantissa << (PRECISION_BIG + 2n)) / b.mantissa,
    a.exponent - b.exponent - (PRECISION + 2)
  );
}

/** Sign of `a - b`, without forming the difference. */
export function compare(a: BigFloat, b: BigFloat): number {
  const difference = subtract(a, b);
  return difference.mantissa === 0n ? 0 : (difference.mantissa < 0n ? -1 : 1);
}

export const isNegative = (a: BigFloat): boolean => a.mantissa < 0n;
export const absolute = (a: BigFloat): BigFloat =>
  a.mantissa < 0n ? negate(a) : a;

/**
 * Nearest Float64, saturating to ±Infinity above the range and to 0 below it.
 *
 * The saturation is deliberate and is what the classifier reads: an oracle
 * that threw on out-of-range values could not describe the very rows Part B
 * exists to describe.
 *
 * ## P66F REPAIR — one rounding, on the destination grid
 *
 * The original conversion rounded the significand to 53 bits FIRST and then
 * scaled down in chunks of `2^-1074`. For a subnormal target that is a double
 * rounding — 53 bits have fewer places than the subnormal grid offers, and the
 * chunked scaling rounds again on the way down — the same defect shape the
 * P66E review suspected in the core's own `applyExponent`. A referee whose
 * conversion double-rounds cannot adjudicate a single-rounding question.
 *
 * The repair determines the DESTINATION precision from the value's exponent —
 * 53 bits in the normal range, `e + 1075` bits when the value lands in the
 * subnormal range — and rounds once, half-to-even, in BigInt. The assembly
 * below the rounding is then EXACT: `top` is already on the destination grid,
 * `Number(top)` is exact for ≤ 53 bits, and `2^scaledExponent` is a
 * representable power of two for every reachable exponent, so the final
 * multiplication reconstructs the rounded value bit-for-bit (or overflows to
 * Infinity, which is the correct rounding above the range).
 */
export function toNumber(a: BigFloat): number {
  if (a.mantissa === 0n) return 0;
  const negative = a.mantissa < 0n;
  const magnitude = negative ? -a.mantissa : a.mantissa;
  const bits = bitLength(magnitude);
  // value ∈ [2^e, 2^(e+1))
  const e = a.exponent + bits - 1;
  if (e > 1023) return negative ? -Infinity : Infinity;
  // Destination precision: the subnormal grid loses one bit per binade below
  // 2^-1022. At e = -1075 zero bits remain and only the tie decides.
  const targetBits = Math.min(53, e + 1075);
  if (targetBits < 0) return negative ? -0 : 0;
  const drop = bits - targetBits;
  let top: bigint;
  if (drop <= 0) {
    top = magnitude << BigInt(-drop);          // exact; nothing to round
  } else {
    top = magnitude >> BigInt(drop);
    const remainder = magnitude & ((1n << BigInt(drop)) - 1n);
    const half = 1n << BigInt(drop - 1);
    if (remainder > half || (remainder === half && (top & 1n) === 1n)) top += 1n;
  }
  // scaledExponent ∈ [-1074, 971] for every e ≤ 1023, so the power is a
  // representable Float64 and the product is exact (a carry to 2^targetBits at
  // e = 1023 overflows to Infinity, which is the correct result there).
  const scaledExponent = a.exponent + drop;
  const value = Number(top) * 2 ** scaledExponent;
  return negative ? -value : value;
}

// ---------------------------------------------------------------------------
// Natural logarithm
// ---------------------------------------------------------------------------

const ONE = fromNumber(1);
const THREE = fromNumber(3);

/**
 * `atanh`-series logarithm of a value already reduced to a neighbourhood of 1.
 *
 * `log(f) = 2 (z + z^3/3 + z^5/5 + …)` with `z = (f-1)/(f+1)`. Terms fall by
 * `z^2` each, so the reduction below decides the cost: the caller keeps `f` in
 * `[√2/2, √2)`, giving `z^2 <= 0.0295` and about five bits per term.
 */
function logNear(f: BigFloat): BigFloat {
  const z = divide(subtract(f, ONE), add(f, ONE));
  const zSquared = multiply(z, z);
  let term = z;
  let sum = z;
  for (let k = 3; k < 400; k += 2) {
    term = multiply(term, zSquared);
    const contribution = divide(term, fromInt(k));
    if (contribution.mantissa === 0n) break;
    const next = add(sum, contribution);
    if (next.mantissa === sum.mantissa && next.exponent === sum.exponent) break;
    sum = next;
  }
  return multiply(sum, fromNumber(2));
}

/** log 2, to full working precision, as `2 * atanh(1/3)`. */
const LOG2: BigFloat = (() => {
  const z = divide(ONE, THREE);
  const zSquared = multiply(z, z);
  let term = z;
  let sum = z;
  for (let k = 3; k < 800; k += 2) {
    term = multiply(term, zSquared);
    const contribution = divide(term, fromInt(k));
    if (contribution.mantissa === 0n) break;
    const next = add(sum, contribution);
    if (next.mantissa === sum.mantissa && next.exponent === sum.exponent) break;
    sum = next;
  }
  return multiply(sum, fromNumber(2));
})();

const SQRT_HALF = fromNumber(Math.SQRT1_2);

/** Natural logarithm. Requires a strictly positive argument. */
export function log(x: BigFloat): BigFloat {
  if (x.mantissa <= 0n) throw new Error('log: argument must be positive');
  // `x = f * 2^k` with the significand read as a fraction in [1/2, 1).
  let k = x.exponent + PRECISION;
  let f = normalize(x.mantissa, -PRECISION);
  // Recentre on 1 rather than on [1/2, 1): halves the series length.
  if (compare(f, SQRT_HALF) < 0) {
    f = normalize(f.mantissa, f.exponent + 1);
    k -= 1;
  }
  return add(logNear(f), multiply(fromInt(k), LOG2));
}

// ---------------------------------------------------------------------------
// The barrier law
// ---------------------------------------------------------------------------

/**
 * How much a correctly-implemented Float64 evaluation must lose here, in
 * multiples of `eps`, before any implementation error is counted.
 *
 * Two mechanisms, and the larger governs:
 *
 *   CANCELLATION   `sum |term| / |result|`. `E''` is the sharp case: at
 *                  `x = a` it is exactly zero while its four terms are each
 *                  `O(k)`, so near activation the relative error is amplified
 *                  by `1/delta`. No association can avoid that.
 *   LOG SENSITIVITY `|dO/dlog| / |O|`. The ratio carries one rounding, so
 *                  `log(x/a)` is uncertain by about `eps` in ABSOLUTE terms;
 *                  for the energy that is `1/|log r|` relative, which is what
 *                  the calibration measured near activation.
 *
 * Without this, every ill-conditioned row reads as an implementation defect
 * and a formulation comparison measures the problem instead of the code.
 */
export interface OracleSensitivity {
  readonly energy: number;
  readonly firstDerivative: number;
  readonly secondDerivative: number;
}

export interface OracleSample {
  /** `-k (x-a)^2 log(x/a)` */
  readonly energy: BigFloat;
  readonly firstDerivative: BigFloat;
  readonly secondDerivative: BigFloat;
  /** `x / a`, exact to working precision — not the Float64 quotient. */
  readonly normalizedCoordinate: BigFloat;
  readonly logRatio: BigFloat;
  /** Error amplification a correct implementation cannot avoid. */
  readonly sensitivity: OracleSensitivity;
}

/**
 * The published law and its first two derivatives, at full working precision.
 *
 * Inputs are the EXACT Float64 values the released evaluator would receive, so
 * a disagreement is the implementation's, never a difference of inputs.
 */
export function oracleAt(
  coordinate: number, activation: number, stiffness: number
): OracleSample {
  const x = fromNumber(coordinate);
  const a = fromNumber(activation);
  const k = fromNumber(stiffness);

  const ratio = divide(x, a);
  const logRatio = log(ratio);
  const gap = subtract(x, a);
  const gapSquared = multiply(gap, gap);

  // E = -k (x-a)^2 log(x/a)
  const energy = negate(multiply(k, multiply(gapSquared, logRatio)));

  // E' = -k [ 2 (x-a) log(x/a) + (x-a)^2 / x ]
  const firstDerivative = negate(multiply(k, add(
    multiply(fromNumber(2), multiply(gap, logRatio)),
    divide(gapSquared, x)
  )));

  // E'' = -k [ 2 log(x/a) + 3 - 2 a/x - (a/x)^2 ]
  const aOverX = divide(a, x);
  const secondDerivative = negate(multiply(k, add(
    add(multiply(fromNumber(2), logRatio), THREE),
    negate(add(multiply(fromNumber(2), aOverX), multiply(aOverX, aOverX)))
  )));

  // --- conditioning -------------------------------------------------------
  const ratioOf = (terms: readonly BigFloat[], result: BigFloat): number => {
    if (result.mantissa === 0n) return Infinity;
    let sum = ZERO;
    for (const term of terms) sum = add(sum, absolute(term));
    return Math.abs(toNumber(divide(sum, absolute(result))));
  };
  const logSensitivity = (derivative: BigFloat, result: BigFloat): number =>
    result.mantissa === 0n ? Infinity
      : Math.abs(toNumber(divide(absolute(derivative), absolute(result))));

  const two = fromNumber(2);
  const kGap = multiply(k, gap);
  const sensitivity: OracleSensitivity = {
    // One product, so no cancellation; the logarithm's absolute uncertainty
    // is the whole story, and it is `1/|log r|` in relative terms.
    energy: Math.max(1, logSensitivity(multiply(k, gapSquared), energy)),
    firstDerivative: Math.max(
      ratioOf([multiply(two, multiply(kGap, logRatio)),
        divide(multiply(k, gapSquared), x)], firstDerivative),
      logSensitivity(multiply(two, kGap), firstDerivative)
    ),
    secondDerivative: Math.max(
      ratioOf([multiply(k, multiply(aOverX, aOverX)),
        multiply(two, multiply(k, aOverX)),
        multiply(two, multiply(k, logRatio)),
        multiply(THREE, k)], secondDerivative),
      logSensitivity(multiply(two, k), secondDerivative)
    )
  };

  return { energy, firstDerivative, secondDerivative,
    normalizedCoordinate: ratio, logRatio, sensitivity };
}

/**
 * Energy alone, for the finite-difference calibration. Deliberately does not
 * share a code path with the derivatives above: the point of the calibration
 * is that the derivative FORMULAS are checked by something that never uses
 * them.
 */
export function oracleEnergyAt(
  coordinate: BigFloat, activation: BigFloat, stiffness: BigFloat
): BigFloat {
  const gap = subtract(coordinate, activation);
  return negate(multiply(stiffness,
    multiply(multiply(gap, gap), log(divide(coordinate, activation)))));
}

// ---------------------------------------------------------------------------
// Float64 representability
// ---------------------------------------------------------------------------

export type Representability =
  /** The true value is exactly zero. */
  | 'exact-zero'
  /** Rounds to a finite nonzero Float64. */
  | 'representable'
  /** Magnitude exceeds `Number.MAX_VALUE`; rounds to ±Infinity. */
  | 'overflow'
  /** Nonzero but below half `Number.MIN_VALUE`; rounds to zero. */
  | 'underflow';

const MAX_VALUE = fromNumber(Number.MAX_VALUE);
/** Half the smallest subnormal: below this, rounding to nearest gives zero. */
const HALF_MIN = normalize(fromNumber(Number.MIN_VALUE).mantissa,
  fromNumber(Number.MIN_VALUE).exponent - 1);

export function representability(value: BigFloat): Representability {
  if (value.mantissa === 0n) return 'exact-zero';
  const magnitude = absolute(value);
  if (compare(magnitude, MAX_VALUE) > 0) return 'overflow';
  if (compare(magnitude, HALF_MIN) < 0) return 'underflow';
  return 'representable';
}

/**
 * Relative error of a Float64 result against the oracle, in units of the
 * oracle value. Returns 0 when both are exactly zero, and Infinity when the
 * implementation lost a value the oracle says is representable.
 */
export function relativeError(produced: number, exact: BigFloat): number {
  if (exact.mantissa === 0n) return produced === 0 ? 0 : Infinity;
  if (!Number.isFinite(produced)) return Infinity;
  const difference = subtract(fromNumber(produced), exact);
  return Math.abs(toNumber(divide(difference, exact)));
}
