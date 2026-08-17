/**
 * P66F Part A — the strengthened referee.
 *
 * The P66E review exposed a referee gap: accuracy was defined as a relative
 * error against a conditioning-aware bound, and relative error is the wrong
 * ruler wherever the output is subnormal — the grid there is ABSOLUTE, one
 * step of `2^-1074` regardless of magnitude, so "12% relative" can be one
 * grid step or fifteen million of them and the old ruler cannot tell which.
 *
 * Four regimes, each with its own definition of "accurate":
 *
 *   normal          relative error, against a stated fixed budget — the
 *                   sensitivity multiplier is deliberately gone, and why is a
 *                   finding (see ROUNDING_BUDGET);
 *   subnormal       ABSOLUTE error in subnormal ULPs (units of 2^-1074),
 *                   against 0.5 + the same budget converted to grid steps;
 *   rounds-to-zero  the same ULP ruler — a correct zero is within 0.5 ULP of
 *                   the exact value by definition, and a wrong MIN_VALUE is
 *                   not;
 *   overflow        the produced value must be non-finite; there is no number
 *                   to be near.
 *
 * The exact value comes from the 240-bit oracle on EXACTLY decoded Float64
 * inputs, with the logarithm computed by TWO independent routes that share no
 * series, no constant and no reduction — the second exists because the P66E
 * review's three adjudicators turned out to share one defect, and agreement
 * among routes that share a defect is not adjudication.
 */

import {
  ZERO, absolute, add, compare, divide, fromNumber, isNegative, multiply,
  negate, oracleAt, subtract, toNumber,
  type BigFloat, type OracleSample
} from './clamped-log-barrier-exact.js';

// ---------------------------------------------------------------------------
// The second logarithm route: digit-by-digit binary log, pinned ln 2
// ---------------------------------------------------------------------------

/**
 * ln 2 from a published decimal literal, parsed digit-by-digit.
 *
 * Deliberately NOT the oracle's `LOG2` (an atanh series at 1/3): this constant
 * enters the second route, and a shared constant would let one defect appear
 * twice and read as agreement. 75 significant digits cover 240 bits with
 * margin. Source: OEIS A002162.
 */
const LN2_DECIMAL =
  '0.693147180559945309417232121458176568075500134360255254120680009493393622';

function fromDecimalLiteral(text: string): BigFloat {
  const [unit, fraction] = text.split('.') as [string, string];
  const digits = unit + fraction;
  // digits as an exact integer, composed in 15-digit exact chunks
  let numerator = ZERO;
  const chunkSize = 15;
  const tenPow15 = fromNumber(10 ** chunkSize);
  for (let index = 0; index < digits.length; index += chunkSize) {
    const chunk = digits.slice(index, index + chunkSize);
    const scale = chunk.length === chunkSize
      ? tenPow15 : fromNumber(10 ** chunk.length);
    numerator = add(multiply(numerator, scale), fromNumber(Number(chunk)));
  }
  // divide by 10^(fraction length), composed the same way
  let denominator = fromNumber(1);
  let remaining = fraction.length;
  while (remaining > 0) {
    const step = Math.min(remaining, chunkSize);
    denominator = multiply(denominator, fromNumber(10 ** step));
    remaining -= step;
  }
  return divide(numerator, denominator);
}

const LN2_PINNED = fromDecimalLiteral(LN2_DECIMAL);

/** Extracted fraction bits. See the error bound in `logViaBits`. */
const LOG_BITS = 110;

/**
 * Natural logarithm by binary digit extraction — the second route.
 *
 * `x = m · 2^e` with `m ∈ [1, 2)`; `log2(m)`'s bits are read off by repeated
 * squaring: square `m`, and the integer part of the result IS the next bit.
 * `ln x = (e + Σ bit_i 2^-i) · ln2` with the pinned constant above.
 *
 * Nothing is shared with the oracle's route: no atanh series, no `LOG2`
 * constant, no √2/2 recentring.
 *
 * ## Stated error bound
 *
 * Each squaring rounds at 240 bits and squaring doubles relative error, so
 * after `i` steps the accumulated error is about `2^i · 2^-239`; truncating
 * the fraction at `LOG_BITS` bits adds `2^-LOG_BITS`. With `LOG_BITS = 110`
 * the route is accurate to roughly `2^-110` relative on the fraction — far
 * coarser than the primary route's ~2^-230, and far finer than any question
 * this referee is asked to adjudicate. The cross-check gate in
 * `p66f-referee.test.ts` requires the two routes within `2^-100`.
 */
export function logViaBits(x: BigFloat): BigFloat {
  if (x.mantissa <= 0n) throw new Error('logViaBits: argument must be positive');
  // The mantissa is normalized to a fixed width with the top bit set, so
  // m = mantissa · 2^-(width-1) ∈ [1, 2) exactly, and the binary exponent is
  // read off rather than searched for.
  const width = x.mantissa.toString(2).length;
  const e = x.exponent + width - 1;
  let m: BigFloat = { mantissa: x.mantissa, exponent: -(width - 1) };

  const two = fromNumber(2);
  const half = fromNumber(0.5);
  let fraction = ZERO;
  let place = fromNumber(0.5);
  for (let bit = 0; bit < LOG_BITS; bit += 1) {
    m = multiply(m, m);
    if (compare(m, two) >= 0) {
      fraction = add(fraction, place);
      m = multiply(m, half);
    }
    place = multiply(place, half);
  }
  return multiply(add(fromNumber(e), fraction), LN2_PINNED);
}

// ---------------------------------------------------------------------------
// Ground-truth conversion, independent of the oracle's own `toNumber`
// ---------------------------------------------------------------------------

const MIN_BF = fromNumber(Number.MIN_VALUE);

/**
 * Round-to-nearest-even Float64 of a BigFloat, built directly on the grid.
 *
 * This exists to CALIBRATE the repaired `toNumber` rather than to replace it:
 * two independently written conversions that agree bit-for-bit are evidence;
 * one conversion trusted twice is not. The construction here shares nothing
 * with `toNumber`'s: the value is expressed as an integer count of grid steps
 * (`2^-1074` in the subnormal range, `ulp(value)` above it) and the count is
 * rounded in BigInt.
 */
export function roundToFloat64ViaGrid(value: BigFloat): number {
  if (value.mantissa === 0n) return 0;
  const negative = isNegative(value);
  const magnitude = negative ? negate(value) : value;

  // An independent bit-length: toString(2), not the oracle's shift walk.
  const width = magnitude.mantissa.toString(2).length;
  const e = magnitude.exponent + width - 1;
  if (e > 1023) return negative ? -Infinity : Infinity;

  // Grid step: 2^(e-52) in the normal range, 2^-1074 below it. The value as a
  // count of grid steps is mantissa · 2^(exponent - stepExponent).
  const stepExponent = Math.max(e - 52, -1074);
  const alignment = magnitude.exponent - stepExponent;
  let integer: bigint;
  if (alignment >= 0) {
    integer = magnitude.mantissa << BigInt(alignment);   // exact
  } else {
    const shift = BigInt(-alignment);
    integer = magnitude.mantissa >> shift;
    const fractionBits = magnitude.mantissa & ((1n << shift) - 1n);
    const halfStep = 1n << (shift - 1n);
    if (fractionBits > halfStep
      || (fractionBits === halfStep && (integer & 1n) === 1n)) {
      integer += 1n;
    }
  }
  if (integer === 0n) return negative ? -0 : 0;
  // integer ≤ 2^53, or 2^53 exactly after a carry — both exact in Float64;
  // the power is representable for every reachable stepExponent, and a carry
  // at e = 1023 overflows to Infinity, which is the correct rounding there.
  const result = Number(integer) * 2 ** stepExponent;
  if (!Number.isFinite(result)) return negative ? -Infinity : Infinity;
  return negative ? -result : result;
}

// ---------------------------------------------------------------------------
// The four regimes and their rulers
// ---------------------------------------------------------------------------

export type RefereeRegime =
  | 'normal' | 'subnormal' | 'rounds-to-zero' | 'overflow';

export function regimeOf(exact: BigFloat): RefereeRegime {
  const rounded = roundToFloat64ViaGrid(exact);
  if (rounded === 0) return 'rounds-to-zero';
  if (!Number.isFinite(rounded)) return 'overflow';
  return Math.abs(rounded) < 2 ** -1022 ? 'subnormal' : 'normal';
}

/** Absolute error in units of the subnormal grid step, `2^-1074`. */
export function subnormalUlpError(produced: number, exact: BigFloat): number {
  if (!Number.isFinite(produced)) return Number.POSITIVE_INFINITY;
  const difference = absolute(subtract(fromNumber(produced), exact));
  return Math.abs(toNumber(divide(difference, MIN_BF)));
}

/** Relative error against the exact value; Infinity for a non-finite result. */
export function refereeRelativeError(
  produced: number, exact: BigFloat
): number {
  if (exact.mantissa === 0n) return produced === 0 ? 0 : Infinity;
  if (!Number.isFinite(produced)) return Infinity;
  return Math.abs(
    toNumber(divide(subtract(fromNumber(produced), exact), exact)));
}

/**
 * The computation budget, in roundings — FIXED, with no sensitivity
 * multiplier. That absence is a finding, not an omission.
 *
 * The old referee multiplied its bound by the oracle's per-row sensitivity,
 * and the oracle's sensitivity for `E''` is computed from the TEXTBOOK
 * grouping `k[(a/x)² + 2(a/x) − 2L − 3]`, whose terms cancel near activation —
 * at `x = nextDown(1e8)` it reports ~4.5e15, which inflates the allowance to
 * ~1.4e9 grid steps and admits the review's 12%-class error. But E1 replaced
 * that grouping precisely so that nothing cancels: in `k[u² + 4u − 2L]` the
 * terms are same-signed, `Σ|term|/|result| = 1` identically, and the
 * logarithm's own error is RELATIVE (the log1p path never rounds the ratio;
 * Sterbenz makes `x−a` exact within the ratio band, the argument carries one
 * division rounding, and `t/((1+t)·log1p(t))` is bounded by ~3 on the band).
 * The same holds for E (one term) and E' (two same-signed terms), and the
 * ordinary-field branches have `|L| ≥ log 2`, so no output of the hybrid-log
 * core is worse than O(1)-conditioned. The oracle's sensitivity model
 * describes the RELEASED formulations Part C compared, and using it to bound
 * the shipped core is exactly how a 12% error passes a "conditioning-aware"
 * gate — the review's attack 1, vindicated in substance.
 *
 * The budget itself: one logarithm (Math.log1p/Math.log carry NO
 * correctly-rounded guarantee — measured in `p66f-referee.test.ts` and
 * budgeted at 2), an argument of ≤ 2 roundings amplified ≤ 3 on the log1p
 * band, ≤ 3 exponent-tracked term products of ≤ 3 roundings each, a
 * same-signed accumulation of ≤ 2, one final rounding. Budgeted at 16.
 */
export const ROUNDING_BUDGET = 16;

/** The flat relative bound for normal outputs. */
export const NORMAL_RELATIVE_BOUND = ROUNDING_BUDGET * 2 ** -53;

/**
 * The subnormal bound: 0.5 grid steps for the single final rounding, plus the
 * pre-rounding relative budget converted to grid steps at this magnitude.
 *
 * This is the ruler the old referee lacked. At `|exact| = 1.7e5 · MIN` the
 * conversion term is ~3e-10 grid steps, so the bound is effectively 0.5 — and
 * a 12%-relative error there is ~1.5e7 grid steps, seven orders past it. A
 * bound that necessarily fails such an error is Part A requirement 3.
 */
export function subnormalUlpBound(exact: BigFloat): number {
  const magnitudeInUlps = Math.abs(toNumber(divide(absolute(exact), MIN_BF)));
  return 0.5 + NORMAL_RELATIVE_BOUND * magnitudeInUlps;
}

export interface RefereeVerdict {
  readonly regime: RefereeRegime;
  /** ULPs of 2^-1074 in the subnormal regimes, relative error in the normal. */
  readonly measured: number;
  readonly bound: number;
  readonly pass: boolean;
}

export function refereeVerdict(
  produced: number, exact: BigFloat
): RefereeVerdict {
  const regime = regimeOf(exact);
  if (regime === 'overflow') {
    const pass = !Number.isFinite(produced);
    return { regime, measured: pass ? 0 : Number.POSITIVE_INFINITY,
      bound: 0, pass };
  }
  if (regime === 'normal') {
    const measured = refereeRelativeError(produced, exact);
    return { regime, measured, bound: NORMAL_RELATIVE_BOUND,
      pass: measured <= NORMAL_RELATIVE_BOUND };
  }
  // subnormal and rounds-to-zero share the absolute grid ruler.
  const measured = subnormalUlpError(produced, exact);
  const bound = subnormalUlpBound(exact);
  return { regime, measured, bound, pass: measured <= bound };
}

// ---------------------------------------------------------------------------
// The exact evaluation, cross-checked
// ---------------------------------------------------------------------------

export interface RefereeSample extends OracleSample {
  /** Relative gap between the two independent logarithm routes. */
  readonly logCrossCheck: number;
}

/**
 * The oracle sample for exactly decoded Float64 inputs, with the logarithm
 * verified by the second route before anything downstream is believed.
 */
/**
 * The digit route's ABSOLUTE error bound, derived rather than tuned.
 *
 * Three sources, in natural-log units: truncating the extracted fraction at
 * `LOG_BITS = 110` bits contributes at most `2^-110 · ln2 < 2^-110`; the
 * squaring cascade's accumulated rounding is about `2^LOG_BITS · 2^-239 =
 * 2^-129`; and the pinned ln2 literal's parse error, at most `~2^-235`
 * relative, contributes `≤ 2^-224 · (|e| + 1)` across the whole exponent
 * range. The sum is under `2^-108`; the bound carries a margin to `2^-105`.
 */
export const LOG_ABSOLUTE_BOUND = 2 ** -105;

/**
 * The Float64-pair floor on |log(x/a)|.
 *
 * For distinct positive finite Float64 `x < a`, the relative gap
 * `(a − x)/a` is at least `ulp(a)/(2a) ≥ 2^-54` (subnormal `a` only widens
 * it), and `|log(1 − t)| ≥ t`, so `|L| ≥ 2^-54`. The regime in which an
 * absolute agreement says nothing about relative agreement — `|L| ≲ 2^-100` —
 * is therefore UNREACHABLE from real input pairs, and `refereeAt` asserts the
 * floor rather than assuming it. The P66F review named the old disjunctive
 * gate ("absolute OR relative") as a loophole precisely because it could not
 * be reasoned about locally; this floor plus the conjunction-free bound below
 * is the closure.
 */
export const LOG_MAGNITUDE_FLOOR = 2 ** -54;

/**
 * The two log routes must agree to a single, derived RELATIVE bound:
 *
 *     relativeGap ≤ 2^-100 + LOG_ABSOLUTE_BOUND / |L|
 *
 * There is no OR arm: the formula IS the information content of an
 * absolutely-accurate second route, stated relatively, and it degrades
 * exactly as the mathematics does. At the floor (|L| = 2^-54) it allows
 * `~2^-51`; at |L| ≥ 1 it is `~2^-100`. A tiny result can never pass
 * vacuously because results below the floor are refused outright.
 */
export function refereeAt(
  coordinate: number, activation: number, stiffness: number
): RefereeSample {
  const sample = oracleAt(coordinate, activation, stiffness);
  const magnitudeL = Math.abs(toNumber(sample.logRatio));
  if (sample.logRatio.mantissa === 0n || magnitudeL < LOG_MAGNITUDE_FLOOR) {
    throw new Error('p66f referee: |log(x/a)| is below the Float64-pair'
      + ` floor (${magnitudeL}) at x=${coordinate} a=${activation} — no such`
      + ' pair of distinct Float64 inputs exists, so this call is a defect in'
      + ' the caller, not a row to be scored');
  }
  const second = logViaBits(
    divide(fromNumber(coordinate), fromNumber(activation)));
  const difference = absolute(subtract(second, sample.logRatio));
  const relativeGap = Math.abs(toNumber(divide(difference, sample.logRatio)));
  const allowed = 2 ** -100 + LOG_ABSOLUTE_BOUND / magnitudeL;
  if (relativeGap > allowed) {
    throw new Error('p66f referee: the two logarithm routes disagree by'
      + ` ${relativeGap} against the derived bound ${allowed}`
      + ` at x=${coordinate} a=${activation}`);
  }
  return { ...sample, logCrossCheck: relativeGap };
}

// re-exported so Part 0/B/C tests take everything from one referee surface
export { log as oracleLog } from './clamped-log-barrier-exact.js';
