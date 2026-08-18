import { describe, expect, it } from 'vitest';
import {
  evaluateClampedLogBarrierAtOrderN,
  type ClampedLogBarrierInputsN
} from '../src/index.js';
import {
  NORMAL_RELATIVE_BOUND, refereeAt, refereeRelativeError, refereeVerdict,
  roundToFloat64ViaGrid, subnormalUlpBound, subnormalUlpError
} from './support/clamped-log-barrier-referee.js';
import {
  absolute, divide, toNumber, type BigFloat
} from './support/clamped-log-barrier-exact.js';
import { barrierTermParts } from '../src/clamped-log-barrier-core.js';

/**
 * The permanent accuracy gates: the exact oracle and the regime-ruler
 * referee (fixed 16-rounding budget, no sensitivity multiplier) over the
 * corpus, the phase diagram, the reachable emission-window family as
 * ORDINARY rows, the off-grid boundary census, and the calibration that the
 * old loose allowance can never return.
 */

const OUTPUTS = ['energy', 'firstDerivative', 'secondDerivative'] as const;

/** The corpus generator, unchanged from the Kitchen evidence. */
function corpus(): ClampedLogBarrierInputsN[] {
  const rows: ClampedLogBarrierInputsN[] = [];
  for (const activation of [1e-300, 1e-200, 1e-80, 1e-3, 1, 1e3, 1e80, 1e200]) {
    for (const stiffness of [1e-300, 1e-150, 1e-20, 1, 1e20, 1e150, 1e300]) {
      for (const exponent of
        [-320, -310, -200, -160, -155, -100, -20, -3, -1, -0.3, 0, 0.5]) {
        const coordinate = activation * 10 ** exponent;
        if (!Number.isFinite(coordinate) || coordinate <= 0) continue;
        rows.push({ coordinate, activation, stiffness });
      }
    }
  }
  return rows;
}

/**
 * The reachable emission-window family: at this shape a chunked emission
 * returns 0 where the correct rounding is MIN_VALUE. 348 of these 400 rows
 * are witnesses (independently confirmed by the P66F-R reviewer's exact
 * route); they live in the ORDINARY corpus so the defect shape is killed at
 * corpus level.
 */
function emissionWindowFamily(): ClampedLogBarrierInputsN[] {
  const x = 0.5 * (1 + 2 ** -40);
  const a = x + 0.5 * 1.8 * 2 ** -30;
  const rows: ClampedLogBarrierInputsN[] = [];
  for (let step = 0; step < 400; step += 1) {
    rows.push({ coordinate: x, activation: a,
      stiffness: ((0.501 + step * 0.0005) / (6 * 1.8)) * 2 ** (-1074 + 30) });
  }
  return rows;
}

const INFINITY_THRESHOLD: BigFloat =
  { mantissa: (1n << 54n) - 1n, exponent: 1024 - 54 };

/**
 * The measured accommodation the implementation inherits (commission §10.3):
 * a finiteness disagreement is tolerated exactly when the exact value lies
 * within the budget of the rounding threshold to ±Infinity.
 */
function withinBudgetOfInfinity(exact: BigFloat): boolean {
  const ratio = toNumber(divide(absolute(exact), INFINITY_THRESHOLD));
  return Math.abs(ratio - 1) <= NORMAL_RELATIVE_BOUND;
}

function verdictHolds(
  produced: number | undefined, exact: BigFloat, label: string
): void {
  const actual = produced === undefined ? Number.NaN : produced;
  const verdict = refereeVerdict(actual, exact);
  if (verdict.pass) return;
  // The one tolerated shape: an in-budget straddle of the Infinity
  // threshold (either direction).
  const straddle = withinBudgetOfInfinity(exact)
    && ((verdict.regime === 'normal' && !Number.isFinite(actual))
      || (verdict.regime === 'overflow' && Number.isFinite(actual)
        && refereeRelativeError(actual, exact) <= NORMAL_RELATIVE_BOUND));
  expect(straddle, `${label}: outside the referee bound`).toBe(true);
}

describe('clamped-log barrier: oracle and referee gates', () => {
  it('every corpus row is inside the referee bound at every order', () => {
    let active = 0;
    for (const row of corpus()) {
      if (!(row.coordinate < row.activation)) continue;
      active += 1;
      const exact = refereeAt(row.coordinate, row.activation, row.stiffness);
      const graded = evaluateClampedLogBarrierAtOrderN(row, 2);
      for (const output of OUTPUTS) {
        const component = graded[output];
        verdictHolds(component.available ? component.value
          : Number.POSITIVE_INFINITY, exact[output],
        `${output} at x=${row.coordinate.toExponential(3)}`
          + ` a=${row.activation.toExponential(0)}`
          + ` k=${row.stiffness.toExponential(0)}`);
        // Availability itself is adjudicated: unavailable must mean the
        // correct rounding is genuinely non-finite (subject to the §10.3
        // accommodation window).
        const correct = roundToFloat64ViaGrid(exact[output]);
        if (!component.available) {
          expect(!Number.isFinite(correct)
            || withinBudgetOfInfinity(exact[output]),
          `${output} withheld a representable value at`
            + ` x=${row.coordinate.toExponential(3)}`).toBe(true);
        } else {
          expect(Number.isFinite(component.value)).toBe(true);
        }
      }
    }
    expect(active).toBeGreaterThan(400);
  });

  it('the phase diagram is non-monotone in both directions, re-counted on'
    + ' the shipped surface', () => {
    let energyGoneDerivativeAlive = 0;
    let energyAliveCurvatureGone = 0;
    for (const row of corpus()) {
      if (!(row.coordinate < row.activation)) continue;
      const graded = evaluateClampedLogBarrierAtOrderN(row, 2);
      if (graded.energy.available && graded.energy.value === 0
        && graded.secondDerivative.available
        && graded.secondDerivative.value !== 0) {
        energyGoneDerivativeAlive += 1;
      }
      if (graded.energy.available && graded.energy.value !== 0
        && !graded.secondDerivative.available) {
        energyAliveCurvatureGone += 1;
      }
    }
    // Both directions exist, so no `availableOrder` field could be truthful.
    expect(energyGoneDerivativeAlive).toBeGreaterThan(0);
    expect(energyAliveCurvatureGone).toBeGreaterThan(0);
    console.log(`\nphase diagram: energy underflowed with live curvature on`
      + ` ${energyGoneDerivativeAlive} rows; energy alive with unavailable`
      + ` curvature on ${energyAliveCurvatureGone} rows.`);
  });

  it('the emission-window family: every row correctly rounded, and the'
    + ' chunked defect mirror misrounds 348 of them', () => {
    // The defect this family kills, held as a mirror: the same term parts,
    // the same alignment, but the LEGACY chunked exponent application that
    // rounds on the deepest subnormal grid and then rounds again.
    const chunkedCurvature = (row: ClampedLogBarrierInputsN): number => {
      const parts = barrierTermParts(row).secondDerivative
        .filter((part) => part.significand !== 0);
      if (parts.length === 0) return 0;
      const maxExponent = Math.max(...parts.map((part) => part.exponent));
      let sum = 0;
      for (const part of [...parts]
        .sort((left, right) => right.exponent - left.exponent)) {
        sum += part.significand
          * 2 ** Math.max(part.exponent - maxExponent, -1074);
      }
      let value = sum;
      let remaining = maxExponent;
      while (remaining > 1023) {
        value *= 2 ** 1023; remaining -= 1023;
        if (!Number.isFinite(value)) return value;
      }
      while (remaining < -1074) {
        value *= 2 ** -1074; remaining += 1074;
        if (value === 0) return value;
      }
      return value * 2 ** remaining;
    };

    let witnesses = 0;
    for (const row of emissionWindowFamily()) {
      const exact = refereeAt(row.coordinate, row.activation, row.stiffness);
      const correct = roundToFloat64ViaGrid(exact.secondDerivative);
      const graded = evaluateClampedLogBarrierAtOrderN(row, 2);
      expect(graded.secondDerivative.available).toBe(true);
      if (!graded.secondDerivative.available) continue;
      expect(Object.is(graded.secondDerivative.value, correct),
        `window row k=${row.stiffness.toExponential(6)}`).toBe(true);
      if (chunkedCurvature(row) === 0 && correct === Number.MIN_VALUE) {
        witnesses += 1;
      }
    }
    // 348 of 400 stiffnesses are witnesses: the chunked mirror returns zero
    // where the correct rounding — and the shipped core — is MIN_VALUE. The
    // count is pinned (independently confirmed by the P66F-R reviewer's
    // exact route) so the family cannot silently drift off the window.
    expect(witnesses).toBe(348);
    console.log(`\nemission window: ${witnesses}/400 rows where the chunked`
      + ' mirror returns 0 and the shipped core delivers MIN_VALUE.');
  });

  it('the near-activation central row: exact adjudication, not a tolerance',
    () => {
      // The row the P66E/P66F arc was fought over: x = nextDown(1e8).
      const view = new DataView(new ArrayBuffer(8));
      view.setFloat64(0, 1e8);
      view.setBigUint64(0, view.getBigUint64(0) - 1n);
      const x = view.getFloat64(0);
      const exact = refereeAt(x, 1e8, 1e-300);
      const correct = roundToFloat64ViaGrid(exact.secondDerivative);
      expect(correct.toExponential(6)).toBe('8.940697e-316');
      const graded = evaluateClampedLogBarrierAtOrderN(
        { coordinate: x, activation: 1e8, stiffness: 1e-300 }, 2);
      expect(graded.secondDerivative.available
        && Object.is(graded.secondDerivative.value, correct)).toBe(true);
      // The referee's two independent logarithm routes agreed within the
      // derived cross-check gate on this row — stated, not assumed.
      expect(exact.logCrossCheck).toBeLessThanOrEqual(
        2 ** -100 + 2 ** -105 / Math.abs(1.4901161193847656e-16));
    });

  it('off-grid boundary census: zero and overflow crossings behave, and the'
    + ' Infinity accommodation stays inside its window', () => {
    const view = new DataView(new ArrayBuffer(8));
    const bitsOf = (v: number): bigint => {
      view.setFloat64(0, v);
      return view.getBigUint64(0);
    };
    const fromBits = (b: bigint): number => {
      view.setBigUint64(0, b);
      return view.getFloat64(0);
    };
    const stepBits = (v: number, n: number): number =>
      fromBits(bitsOf(v) + BigInt(n));
    const curvature = (k: number, x: number, a: number): number => {
      const graded = evaluateClampedLogBarrierAtOrderN(
        { coordinate: x, activation: a, stiffness: k }, 2);
      return graded.secondDerivative.available
        ? graded.secondDerivative.value : Number.POSITIVE_INFINITY;
    };
    const bisect = (
      predicate: (k: number) => boolean, lo: number, hi: number
    ): number => {
      expect(predicate(lo)).toBe(false);
      expect(predicate(hi)).toBe(true);
      let loBits = bitsOf(lo);
      let hiBits = bitsOf(hi);
      while (hiBits - loBits > 1n) {
        const mid = (loBits + hiBits) >> 1n;
        if (predicate(fromBits(mid))) hiBits = mid;
        else loBits = mid;
      }
      return fromBits(hiBits);
    };

    // Overflow crossing at (a=100, x=6.25): every ladder row within bound or
    // inside the accommodation window; the crossing straddles for real.
    const overflowCrossing = bisect(
      (k) => !Number.isFinite(curvature(k, 6.25, 100)),
      2 ** 980, Number.MAX_VALUE);
    let sawFinite = 0;
    let sawInfinite = 0;
    for (let step = -8; step <= 8; step += 1) {
      const k = stepBits(overflowCrossing, step);
      const exact = refereeAt(6.25, 100, k);
      const graded = evaluateClampedLogBarrierAtOrderN(
        { coordinate: 6.25, activation: 100, stiffness: k }, 2);
      const produced = graded.secondDerivative.available
        ? graded.secondDerivative.value : Number.POSITIVE_INFINITY;
      verdictHolds(produced, exact.secondDerivative,
        `overflow ladder k=${k.toExponential(6)}`);
      if (graded.secondDerivative.available) sawFinite += 1;
      else sawInfinite += 1;
    }
    expect(sawFinite).toBeGreaterThan(0);
    expect(sawInfinite).toBeGreaterThan(0);

    // Rounds-to-zero crossing near activation: the ladder crosses from
    // published zeros to MIN_VALUE, every row the correct rounding.
    const nsb = { x: 1 - 2 ** -20, a: 1 };
    const zeroCrossing = bisect(
      (k) => curvature(k, nsb.x, nsb.a) !== 0,
      Number.MIN_VALUE, 2 ** -1000);
    let zeros = 0;
    let nonzeros = 0;
    for (let step = -8; step <= 8; step += 1) {
      const k = stepBits(zeroCrossing, step);
      const exact = refereeAt(nsb.x, nsb.a, k);
      const graded = evaluateClampedLogBarrierAtOrderN(
        { coordinate: nsb.x, activation: nsb.a, stiffness: k }, 2);
      expect(graded.secondDerivative.available).toBe(true);
      if (!graded.secondDerivative.available) continue;
      const produced = graded.secondDerivative.value;
      expect(subnormalUlpError(produced, exact.secondDerivative))
        .toBeLessThanOrEqual(subnormalUlpBound(exact.secondDerivative));
      if (produced === 0) zeros += 1;
      else nonzeros += 1;
    }
    expect(zeros).toBeGreaterThan(0);
    expect(nonzeros).toBeGreaterThan(0);
  });

  it('CALIBRATION: the referee these gates use fails what the old allowance'
    + ' admitted', () => {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, 1e8);
    view.setBigUint64(0, view.getBigUint64(0) - 1n);
    const x = view.getFloat64(0);
    const exact = refereeAt(x, 1e8, 1e-300);
    const correct = roundToFloat64ViaGrid(exact.secondDerivative);

    // A 12%-class relative error (the ratio-rounded reference's) must fail.
    const twelvePercentOff = correct * 1.12;
    expect(refereeVerdict(twelvePercentOff, exact.secondDerivative).pass)
      .toBe(false);

    // A 15,000-ULP subnormal error must fail, and the verdict's own
    // measurement says how far out it is.
    const fifteenThousandUlps = correct + 15_000 * Number.MIN_VALUE;
    const verdict = refereeVerdict(fifteenThousandUlps, exact.secondDerivative);
    expect(verdict.pass).toBe(false);
    expect(verdict.measured).toBeGreaterThan(14_999);
    expect(verdict.measured).toBeGreaterThan(verdict.bound);
    expect(subnormalUlpError(fifteenThousandUlps, exact.secondDerivative))
      .toBeGreaterThan(14_999);

    // And the bound the gates actually use here is the fixed-budget one: at
    // this magnitude it allows well under one grid step of slack beyond the
    // final rounding.
    expect(subnormalUlpBound(exact.secondDerivative)).toBeLessThan(0.51);
  });
});
