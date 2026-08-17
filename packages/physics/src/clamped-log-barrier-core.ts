/**
 * The scalar barrier's numerical core. Internal: not exported from the
 * package index, and nothing of its vocabulary (significands, exponents,
 * operation counts) appears on any public result.
 *
 * The arithmetic is the P66F/P66F-R repaired assembly, ported verbatim from
 * the Kitchen authority (`p66e-partd-core.ts` at the reviewed checkpoint):
 *
 *   LOGARITHM  `log1p((x-a)/a)` near activation, where the ratio logarithm
 *              loses seven digits (Boost.Math documents the cancellation);
 *              the ratio logarithm in the ordinary field; `log x - log a`
 *              when the ratio itself leaves Float64.
 *   ASSEMBLY   exponent-tracked term products (a POSIX-`frexp`-style split
 *              into a significand in [0.5, 1) and an integer exponent, read
 *              from the bit pattern since JavaScript exposes no frexp),
 *              summed at a common scale and rounded ONCE per output, with
 *              single-rounding exponent application. There is no chunked
 *              2^±1000-class emission: the chunked form rounds on the
 *              subnormal grid and then rounds again, which turns values as
 *              representable as MIN_VALUE into zero — an availability error,
 *              not merely an accuracy one.
 *
 * Evaluation is lazy by ORDER: a caller asking for order 0 must not pay for
 * a curvature it did not request. The operation counter (logarithms plus
 * scaled term products) makes 2 / 4 / 7 active and 0 inactive a measurement
 * rather than a claim.
 */

/** Highest derivative the caller wants. Lower orders skip later work. */
export type CoreOrder = 0 | 1 | 2;

export interface CoreInputs {
  readonly coordinate: number;
  readonly activation: number;
  readonly stiffness: number;
}

export interface CoreOutputs {
  readonly active: boolean;
  /** `undefined` when not requested; non-finite when outside Float64. */
  readonly energy: number | undefined;
  readonly firstDerivative: number | undefined;
  readonly secondDerivative: number | undefined;
}

let operationCount = 0;
/** Reads and clears the count of logarithms and scaled products performed. */
export function takeCoreOperationCount(): number {
  const count = operationCount;
  operationCount = 0;
  return count;
}

const splitView = new DataView(new ArrayBuffer(8));

/** Significand in [0.5, 1) and a binary exponent. Exact. */
function splitExponent(
  value: number
): { significand: number; exponent: number } {
  if (value === 0 || !Number.isFinite(value)) {
    return { significand: value, exponent: 0 };
  }
  splitView.setFloat64(0, value);
  const bits = splitView.getBigUint64(0);
  const biased = Number((bits >> 52n) & 0x7ffn);
  if (biased === 0) {
    // Subnormal. Reading the biased field directly would report exponent 0
    // and mis-scale exactly the tiny values this machinery exists to handle.
    const lifted = splitExponent(value * 2 ** 200);
    return { significand: lifted.significand, exponent: lifted.exponent - 200 };
  }
  splitView.setBigUint64(0, (bits & ~(0x7ffn << 52n)) | (1022n << 52n));
  return { significand: splitView.getFloat64(0), exponent: biased - 1022 };
}

/**
 * `significand * 2^exponent`, with at most ONE rounding — the final one.
 *
 * The pre-scale by a single exact power keeps the value normal (a
 * power-of-two scaling within the normal range loses nothing), so the only
 * rounding is the last multiplication, which lands on the destination grid
 * exactly once. Certain overflow yields ±Infinity, certain underflow ±0,
 * both with the sign of the significand.
 *
 * The renormalization guard keeps |significand| within (2^-8, 16). Reachable
 * significands sit strictly inside it — term products span (2^-2, 8) and
 * combine sums (2^-2, 12) in the per-factor [1, 2) normalization, a measured
 * envelope with a 7.2200 witness and a 2x margin against the guard — so on
 * evaluator-produced inputs the guard is inert; it is defence in depth for
 * out-of-envelope significands, where the down pre-scale itself would land
 * subnormal and round.
 */
function applyExponent(significand: number, exponent: number): number {
  if (significand === 0 || !Number.isFinite(significand)) return significand;
  if (Math.abs(significand) >= 16 || Math.abs(significand) < 2 ** -8) {
    const split = splitExponent(significand);
    return applyExponent(split.significand, exponent + split.exponent);
  }
  if (exponent >= -1022 && exponent <= 1023) {
    return significand * 2 ** exponent;
  }
  if (exponent > 1023) {
    // |true| ≥ 2^-8 · 2^exponent, so past 2100 the result is Infinity however
    // it is assembled; below that, one exact lift keeps the multiply single.
    if (exponent > 2100) return significand > 0 ? Infinity : -Infinity;
    const lifted = significand * 2 ** 1000;        // exact: |lifted| < 2^1004
    return lifted * 2 ** (exponent - 1000);
  }
  // exponent < -1022. |true| < 16 · 2^exponent, so below −2074 the result is
  // under half of MIN_VALUE and rounds to signed zero.
  if (exponent < -2074) return significand > 0 ? 0 : -0;
  const lowered = significand * 2 ** -1000;        // exact: |lowered| > 2^-1008
  return lowered * 2 ** (exponent + 1000);         // ∈ [-1074, -23]: one rounding
}

/**
 * A term held at scale: the significand has full Float64 precision and the
 * grid is not consulted until `combineSameSigned` emits the SUM. Internal
 * only; nothing of this shape reaches a caller.
 */
interface ScaledPart {
  readonly significand: number;
  readonly exponent: number;
}

/**
 * Sum of same-signed parts, rounded ONCE.
 *
 * Terms are aligned to the largest exponent by EXACT powers of two, summed
 * at full significand precision, and emitted once. For normal outputs this
 * is bit-identical to emitting each term and adding — the alignment is exact
 * and IEEE addition rounds the same real value either way — so only the rows
 * the grid touches change, which is the repair. The same-sign precondition
 * is the derivation below: every output of this law is a sum of same-signed
 * terms on the active domain, so the alignment can never cancel and dropping
 * a term more than ~2^1074 below the leader is exact to well past the
 * budget.
 */
function combineSameSigned(parts: readonly ScaledPart[]): number {
  let maxExponent = Number.NEGATIVE_INFINITY;
  for (const part of parts) {
    if (part.significand !== 0 && part.exponent > maxExponent) {
      maxExponent = part.exponent;
    }
  }
  if (!Number.isFinite(maxExponent)) return 0;
  const ordered = [...parts]
    .filter((part) => part.significand !== 0)
    .sort((left, right) => right.exponent - left.exponent);
  let sum = 0;
  for (const part of ordered) {
    const gap = part.exponent - maxExponent;       // ≤ 0
    // 2^gap is exact down to -1074 and 0 below, so a term too far below the
    // leader contributes exactly nothing — correct to < 2^-1050 relative.
    sum += part.significand * 2 ** Math.max(gap, -1074);
  }
  return applyExponent(sum, maxExponent);
}

/** The exponent-tracked product, held AT SCALE. Counts as one operation. */
function scaledTermParts(
  numerators: readonly number[], denominators: readonly number[]
): ScaledPart {
  operationCount += 1;
  let significand = 1;
  let exponent = 0;
  for (const factor of numerators) {
    if (factor === 0) return { significand: 0, exponent: 0 };
    const split = splitExponent(factor);
    significand *= split.significand;
    exponent += split.exponent;
  }
  for (const factor of denominators) {
    const split = splitExponent(factor);
    significand /= split.significand;
    exponent -= split.exponent;
  }
  return { significand, exponent };
}

/** Product of numerators over denominators, with no intermediate excursion. */
function scaledTerm(
  numerators: readonly number[], denominators: readonly number[]
): number {
  const parts = scaledTermParts(numerators, denominators);
  if (parts.significand === 0) return 0;
  return applyExponent(parts.significand, parts.exponent);
}

/** The hybrid logarithm of `x / a`. */
function logRatio(x: number, a: number): number {
  operationCount += 1;
  const ratio = x / a;
  if (ratio > 0.5 && ratio < 2) return Math.log1p((x - a) / a);
  if (ratio > 0 && Number.isFinite(ratio)) return Math.log(ratio);
  // The ratio left Float64 while both operands are inside it. The physical
  // outputs may still be perfectly representable, so this must not refuse.
  return Math.log(x) - Math.log(a);
}

/**
 * Inputs are assumed already validated by the public contract; this is the
 * shared kernel, not a public entry point.
 */
export function evaluateBarrierCore(
  inputs: CoreInputs, order: CoreOrder
): CoreOutputs {
  const { coordinate: x, activation: a, stiffness: k } = inputs;

  if (!(x < a)) {
    // The clamp. Exactly zero, and `active: false` is what tells a caller
    // this zero is the support boundary rather than an underflow.
    return {
      active: false, energy: 0, firstDerivative: 0, secondDerivative: 0
    };
  }

  const L = logRatio(x, a);
  const gap = x - a;
  const energy = -scaledTerm([k, gap, gap, L], []);
  if (order === 0) {
    return { active: true, energy, firstDerivative: undefined,
      secondDerivative: undefined };
  }

  // E' = -k [ 2 (x-a) log(x/a) + (x-a)^2 / x ] — two same-signed terms,
  // summed at scale and rounded once.
  const firstDerivative = -combineSameSigned([
    scaledTermParts([2, k, gap, L], []),
    scaledTermParts([k, gap, gap], [x])
  ]);
  if (order === 1) {
    return { active: true, energy, firstDerivative,
      secondDerivative: undefined };
  }

  /**
   * E'' in a CANCELLATION-FREE form.
   *
   * The textbook grouping `k[(a/x)^2 + 2(a/x) - 2 log(x/a) - 3]` subtracts a
   * `3k` that the first two terms very nearly supply near activation. At
   * `k = MAX_VALUE` and `x/a = 1 - 1e-10` the leading term overflows while
   * the true curvature is 1.08e299 — and `Infinity + Infinity - Infinity` is
   * NaN, so that grouping reports "outside Float64" for a perfectly
   * representable value. Exponent tracking cannot help: each term really is
   * that large; the cancellation is in the algebra, not the arithmetic.
   *
   * Substituting `u = a/x - 1 = (a-x)/x` removes it exactly:
   *
   *     (a/x)^2 + 2(a/x) - 3  =  (u+1)^2 + 2(u+1) - 3  =  u^2 + 4u
   *
   *     E'' = k [ u^2 + 4u - 2 log(x/a) ]
   *
   * On the active domain `x < a`, so `u > 0` and `log(x/a) < 0`: all three
   * terms are strictly positive and nothing cancels. Each is therefore no
   * larger than the sum, so a term can only overflow when `E''` itself does.
   * That is what licenses the contract to carry no premature-failure arm.
   */
  const aMinusX = a - x;
  const negatedLogPart = scaledTermParts([2, k, L], []);
  const secondDerivative = combineSameSigned([
    scaledTermParts([k, aMinusX, aMinusX], [x, x]),
    scaledTermParts([4, k, aMinusX], [x]),
    { significand: -negatedLogPart.significand,
      exponent: negatedLogPart.exponent }
  ]);

  return { active: true, energy, firstDerivative, secondDerivative };
}

// ---------------------------------------------------------------------------
// The invariant that licenses the contract's shape
// ---------------------------------------------------------------------------

/**
 * The individual terms of each output, held AT SCALE, for the same-sign
 * identity gate. The contract carries no "premature intermediate failure"
 * arm, and that is a claim about the algebra: on the active domain every
 * output is a sum of terms of the SAME SIGN, so no term exceeds the
 * magnitude of the sum, so a term can overflow only when the output itself
 * does. The gate assembles this mirror through the SHIPPED combiner and
 * requires bit-identity with `evaluateBarrierCore`, so the mirror cannot
 * drift from the code it makes a claim about.
 */
export interface BarrierTermPartsView {
  readonly energy: readonly { significand: number; exponent: number }[];
  readonly firstDerivative:
  readonly { significand: number; exponent: number }[];
  readonly secondDerivative:
  readonly { significand: number; exponent: number }[];
}

export function barrierTermParts(inputs: CoreInputs): BarrierTermPartsView {
  const { coordinate: x, activation: a, stiffness: k } = inputs;
  const L = logRatio(x, a);
  const gap = x - a;
  const aMinusX = a - x;
  const negated = (part: ScaledPart): ScaledPart =>
    ({ significand: -part.significand, exponent: part.exponent });
  return {
    energy: [negated(scaledTermParts([k, gap, gap, L], []))],
    firstDerivative: [
      negated(scaledTermParts([2, k, gap, L], [])),
      negated(scaledTermParts([k, gap, gap], [x]))
    ],
    secondDerivative: [
      scaledTermParts([k, aMinusX, aMinusX], [x, x]),
      scaledTermParts([4, k, aMinusX], [x]),
      negated(scaledTermParts([2, k, L], []))
    ]
  };
}

/** The shipped same-signed assembler, exposed for the identity gate alone. */
export function assembleSameSigned(
  parts: readonly { significand: number; exponent: number }[]
): number {
  return combineSameSigned(parts);
}
