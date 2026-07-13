/**
 * Exact arithmetic for Coxeter group enumeration.
 *
 * Group elements and vertex orbits are identified by exact
 * mirror-distance tuples — never by Float64 comparison — so enumeration
 * cannot invent or merge chambers. The unit-normal mirror basis keeps
 * the required constants tiny: every doubled-Gram entry is 2, 0, −1,
 * −√2, or −φ, so three quadratic rings cover all built-in groups:
 *
 *   ℤ        (A, D families — simply laced)
 *   ℤ[√2]    (B, F families — the 4-marked link)
 *   ℤ[φ]     (H families — the 5-marked link, φ² = φ + 1)
 *
 * Elements are pairs (a, b) of bigints meaning a + b·ρ for the ring's
 * radical ρ; the integer ring simply keeps b = 0.
 */

/** An element a + b·ρ of one of the supported quadratic rings. */
export interface ExactValue {
  readonly a: bigint;
  readonly b: bigint;
}

export type ExactRingKind = 'integer' | 'sqrt2' | 'phi';

export interface ExactRing {
  readonly kind: ExactRingKind;
  readonly zero: ExactValue;
  readonly one: ExactValue;
  fromInt(n: number): ExactValue;
  add(x: ExactValue, y: ExactValue): ExactValue;
  sub(x: ExactValue, y: ExactValue): ExactValue;
  neg(x: ExactValue): ExactValue;
  mul(x: ExactValue, y: ExactValue): ExactValue;
  /** The radical ρ itself (√2 or φ); throws for the integer ring. */
  radical(): ExactValue;
  /** Exact hash key; equal keys ⇔ equal ring elements. */
  key(x: ExactValue): string;
  keyTuple(xs: readonly ExactValue[]): string;
  /** Exact order in the selected real embedding: −1, 0, or +1. */
  sign(x: ExactValue): -1 | 0 | 1;
  compare(x: ExactValue, y: ExactValue): -1 | 0 | 1;
  /** One-time conversion to Float64 (a + b·ρ numerically). */
  toNumber(x: ExactValue): number;
}

const ZERO: ExactValue = { a: 0n, b: 0n };
const ONE: ExactValue = { a: 1n, b: 0n };

function makeRing(
  kind: ExactRingKind,
  mulRadicals: (bx: bigint, by: bigint) => ExactValue,
  radicalValue: number,
  exactSign: (x: ExactValue) => -1 | 0 | 1
): ExactRing {
  return {
    kind,
    zero: ZERO,
    one: ONE,
    fromInt: (n) => ({ a: BigInt(n), b: 0n }),
    add: (x, y) => ({ a: x.a + y.a, b: x.b + y.b }),
    sub: (x, y) => ({ a: x.a - y.a, b: x.b - y.b }),
    neg: (x) => ({ a: -x.a, b: -x.b }),
    mul: (x, y) => {
      // (a₁ + b₁ρ)(a₂ + b₂ρ) = a₁a₂ + (a₁b₂ + b₁a₂)ρ + b₁b₂ρ²,
      // with ρ² folded back by the ring rule.
      const rad = mulRadicals(x.b, y.b);
      return { a: x.a * y.a + rad.a, b: x.a * y.b + x.b * y.a + rad.b };
    },
    radical: () => {
      if (kind === 'integer') throw new Error('integer ring has no radical');
      return { a: 0n, b: 1n };
    },
    key: (x) => `${x.a},${x.b}`,
    keyTuple: (xs) => xs.map((x) => `${x.a},${x.b}`).join('|'),
    sign: exactSign,
    compare: (x, y) => exactSign({ a: x.a - y.a, b: x.b - y.b }),
    toNumber: (x) => Number(x.a) + Number(x.b) * radicalValue
  };
}

function signInteger(value: bigint): -1 | 0 | 1 {
  return value < 0n ? -1 : value > 0n ? 1 : 0;
}

/** Exact sign of u + v√k for positive nonsquare integer k. */
function signQuadratic(u: bigint, v: bigint, k: bigint): -1 | 0 | 1 {
  if (v === 0n) return signInteger(u);
  if (u === 0n) return signInteger(v);
  if ((u < 0n) === (v < 0n)) return signInteger(u);
  const comparison = u * u - k * v * v;
  if (comparison === 0n) return 0;
  return u > 0n === comparison > 0n ? 1 : -1;
}

/** ℤ: ρ unused (b stays 0). */
export const integerRing: ExactRing = makeRing('integer', () => ZERO, 0, (x) => signInteger(x.a));

/** ℤ[√2]: ρ² = 2. */
export const sqrt2Ring: ExactRing = makeRing(
  'sqrt2',
  (bx, by) => ({ a: 2n * bx * by, b: 0n }),
  Math.SQRT2,
  (x) => signQuadratic(x.a, x.b, 2n)
);

/** ℤ[φ]: ρ² = ρ + 1 (the golden ratio). */
export const phiRing: ExactRing = makeRing(
  'phi',
  (bx, by) => ({ a: bx * by, b: bx * by }),
  (1 + Math.sqrt(5)) / 2,
  // a+bφ = (2a+b+b√5)/2.
  (x) => signQuadratic(2n * x.a + x.b, x.b, 5n)
);
