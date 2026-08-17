import { describe, expect, it } from 'vitest';
import {
  ClampedLogBarrierInputErrorN,
  evaluateClampedLogBarrierAtOrderN,
  type BarrierComponentN,
  type ClampedLogBarrierInputsN
} from '../src/index.js';
import {
  takeCoreOperationCount
} from '../src/clamped-log-barrier-core.js';

/**
 * The graded scalar contract: requested order, per-component availability,
 * frozen compiler-owned inputs, typed permanent input error, exact runtime
 * shape, and the operation-count laziness pins.
 */

const ORDERS = [0, 1, 2] as const;

const value = (component: BarrierComponentN): number => {
  if (!component.available) {
    throw new Error('expected an available component');
  }
  return component.value;
};

describe('clamped-log barrier: the graded scalar contract', () => {
  it('throws the typed permanent error for every invalid input', () => {
    const bad = [
      { coordinate: 0, activation: 1, stiffness: 1 },
      { coordinate: -1, activation: 1, stiffness: 1 },
      { coordinate: Number.NaN, activation: 1, stiffness: 1 },
      { coordinate: Number.POSITIVE_INFINITY, activation: 1, stiffness: 1 },
      { coordinate: 1, activation: 0, stiffness: 1 },
      { coordinate: 1, activation: -2, stiffness: 1 },
      { coordinate: 1, activation: Number.NaN, stiffness: 1 },
      { coordinate: 1, activation: 1, stiffness: 0 },
      { coordinate: 1, activation: 1, stiffness: Number.NEGATIVE_INFINITY }
    ];
    for (const inputs of bad) {
      for (const order of ORDERS) {
        expect(() => evaluateClampedLogBarrierAtOrderN(inputs, order))
          .toThrow(ClampedLogBarrierInputErrorN);
      }
    }
    expect(() => evaluateClampedLogBarrierAtOrderN(
      null as unknown as ClampedLogBarrierInputsN, 0))
      .toThrow(ClampedLogBarrierInputErrorN);
    // The typed error is a RangeError, so a caller with an existing
    // RangeError arm keeps working — but it must narrow by class, never by
    // message.
    expect(new ClampedLogBarrierInputErrorN('x')).toBeInstanceOf(RangeError);
  });

  it('the inactive clamp: every requested component available and +0, with'
    + ' zero core operations', () => {
    for (const order of ORDERS) {
      takeCoreOperationCount();
      const result = evaluateClampedLogBarrierAtOrderN(
        { coordinate: 0.2, activation: 0.1, stiffness: 1 }, order);
      expect(takeCoreOperationCount()).toBe(0);
      expect(result.active).toBe(false);
      expect(result.energy).toEqual({ available: true, value: 0 });
      expect(Object.is(value(result.energy), 0)).toBe(true);   // +0, not -0
      if (order >= 1) {
        expect(value((result as { firstDerivative: BarrierComponentN })
          .firstDerivative)).toBe(0);
      }
      if (order === 2) {
        expect(value((result as { secondDerivative: BarrierComponentN })
          .secondDerivative)).toBe(0);
      }
    }
  });

  it('laziness is measured: 2 / 4 / 7 core operations at orders 0 / 1 / 2',
    () => {
      const counts = ORDERS.map((order) => {
        takeCoreOperationCount();
        evaluateClampedLogBarrierAtOrderN(
          { coordinate: 0.5, activation: 1, stiffness: 1 }, order);
        return takeCoreOperationCount();
      });
      expect(counts).toEqual([2, 4, 7]);
    });

  it('availability is per component and non-monotone, in both directions',
    () => {
      // Energy alive, curvature unavailable (overflow at the top).
      const topHeavy = evaluateClampedLogBarrierAtOrderN(
        { coordinate: 1e-320, activation: 1e-300, stiffness: 1e300 }, 2);
      expect(topHeavy.energy.available).toBe(true);
      expect(topHeavy.firstDerivative.available).toBe(true);
      expect(topHeavy.secondDerivative.available).toBe(false);
      if (!topHeavy.secondDerivative.available) {
        expect(topHeavy.secondDerivative.reason).toBe('outside-float64');
        expect('value' in topHeavy.secondDerivative).toBe(false);
      }

      // Energy rounded to zero, derivatives alive (underflow at the bottom).
      const bottomHeavy = evaluateClampedLogBarrierAtOrderN(
        { coordinate: 1e-320, activation: 1e-300, stiffness: 1e-20 }, 2);
      expect(bottomHeavy.active).toBe(true);
      expect(bottomHeavy.energy).toEqual({ available: true, value: 0 });
      expect(value(bottomHeavy.firstDerivative)).not.toBe(0);
      expect(value(bottomHeavy.secondDerivative)).not.toBe(0);

      // Energy finite, first derivative unavailable.
      const middle = evaluateClampedLogBarrierAtOrderN(
        { coordinate: 1e-280, activation: 1e-80, stiffness: 1e300 }, 1);
      expect(middle.energy.available).toBe(true);
      expect(middle.firstDerivative.available).toBe(false);
    });

  it('a correctly rounded zero is an answer, and `active` is what separates'
    + ' it from the clamp', () => {
    const underflowed = evaluateClampedLogBarrierAtOrderN(
      { coordinate: 1e-320, activation: 1e-300, stiffness: 1e-20 }, 0);
    expect(underflowed.active).toBe(true);
    expect(underflowed.energy).toEqual({ available: true, value: 0 });

    const clamped = evaluateClampedLogBarrierAtOrderN(
      { coordinate: 2e-300, activation: 1e-300, stiffness: 1e-20 }, 0);
    expect(clamped.active).toBe(false);
    expect(clamped.energy).toEqual({ available: true, value: 0 });
  });

  it('the removed ratio-underflow refusal stays removed: physics inside'
    + ' Float64 is delivered even when the ratio is not', () => {
    // x / a underflows to 0 here, and the old contract refused the row. The
    // energy is representable (9.747e-98, exact to the oracle) and must be
    // delivered.
    const result = evaluateClampedLogBarrierAtOrderN(
      { coordinate: 4.94e-324, activation: 1e100, stiffness: 1e-300 }, 0);
    expect(result.active).toBe(true);
    expect(value(result.energy)).toBeCloseTo(9.747e-98, 100);
    expect(value(result.energy)).toBeGreaterThan(0);
  });

  it('inputs are a frozen compiler-owned copy; the caller object is neither'
    + ' retained, frozen nor written', () => {
    const callerInputs = { coordinate: 0.5, activation: 1, stiffness: 2 };
    const result = evaluateClampedLogBarrierAtOrderN(callerInputs, 2);
    expect(result.inputs).not.toBe(callerInputs);
    expect(Object.isFrozen(result.inputs)).toBe(true);
    expect(Object.isFrozen(callerInputs)).toBe(false);
    expect(result.inputs).toEqual(callerInputs);
    // Writing the caller's object afterwards cannot change the evaluation's
    // record.
    (callerInputs as { coordinate: number }).coordinate = 99;
    expect(result.inputs.coordinate).toBe(0.5);
  });

  it('exact runtime shape at each order: keys, spread, no symbols, plain'
    + ' enumerable data properties, everything frozen', () => {
    const inputs = { coordinate: 0.5, activation: 1, stiffness: 1 };
    const expectedKeys: Record<number, string[]> = {
      0: ['inputs', 'active', 'energy'],
      1: ['inputs', 'active', 'energy', 'firstDerivative'],
      2: ['inputs', 'active', 'energy', 'firstDerivative', 'secondDerivative']
    };
    // Every availability combination the contract can produce carries the
    // same key set — availability changes an ARM's shape, never the result's.
    const rows: ClampedLogBarrierInputsN[] = [
      inputs,                                                    // all finite
      { coordinate: 1e-320, activation: 1e-300, stiffness: 1e300 },  // U arm
      { coordinate: 1e-320, activation: 1e-300, stiffness: 1e-20 },  // zero
      { coordinate: 2, activation: 1, stiffness: 1 }             // inactive
    ];
    for (const row of rows) {
      for (const order of ORDERS) {
        const result = evaluateClampedLogBarrierAtOrderN(row, order);
        expect(Object.keys(result)).toEqual(expectedKeys[order]);
        expect(Object.getOwnPropertySymbols(result)).toEqual([]);
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.energy)).toBe(true);
        // Spread reproduces exactly the same enumerable surface.
        expect(Object.keys({ ...result })).toEqual(expectedKeys[order]);
        for (const key of Object.keys(result)) {
          const descriptor = Object.getOwnPropertyDescriptor(result, key)!;
          expect(descriptor.enumerable).toBe(true);
          expect(descriptor.get).toBeUndefined();
        }
        // No internal vocabulary leaks: no exponent, significand, operation
        // count, status or ratio field anywhere on the result or its arms.
        const walk = JSON.stringify(result);
        for (const forbidden of ['exponent', 'significand', 'operation',
          'normalizedCoordinate', 'status']) {
          expect(walk).not.toContain(forbidden);
        }
      }
    }
  });

  it('the unavailable arm carries no value key, and the available arm no'
    + ' reason key', () => {
    const graded = evaluateClampedLogBarrierAtOrderN(
      { coordinate: 1e-320, activation: 1e-300, stiffness: 1e300 }, 2);
    expect(Object.keys(graded.secondDerivative)).toEqual(
      ['available', 'reason']);
    expect(Object.keys(graded.energy)).toEqual(['available', 'value']);
  });

  it('signed zero: the correctly rounded sign is preserved and `active` is'
    + ' the discriminator, not the sign bit', () => {
    // E' is strictly negative on the active domain, so its underflow is -0.
    const active = evaluateClampedLogBarrierAtOrderN(
      { coordinate: 1e-300 * (1 - 2 ** -40), activation: 1e-300,
        stiffness: 1e-310 }, 1);
    expect(active.active).toBe(true);
    expect(value(active.firstDerivative) === 0).toBe(true);
    expect(Object.is(value(active.firstDerivative), -0)).toBe(true);
    // The inactive clamp is +0 — but that agreement follows from the sign of
    // E' on the active domain, not from a normalization step.
    const inactive = evaluateClampedLogBarrierAtOrderN(
      { coordinate: 2, activation: 1, stiffness: 1 }, 1);
    expect(Object.is(value(inactive.firstDerivative), 0)).toBe(true);
  });

  it('replay: evaluating the attached inputs record reproduces the result'
    + ' bit for bit', () => {
    const rows: ClampedLogBarrierInputsN[] = [
      { coordinate: 0.5, activation: 1, stiffness: 1 },
      { coordinate: 1e-320, activation: 1e-300, stiffness: 1e-20 },
      { coordinate: 1 - 2 ** -40, activation: 1,
        stiffness: (0.55 / 6) * 2 ** (-1074 + 40) }
    ];
    for (const row of rows) {
      const first = evaluateClampedLogBarrierAtOrderN(row, 2);
      const replayed = evaluateClampedLogBarrierAtOrderN(first.inputs, 2);
      expect(replayed).toEqual(first);
      for (const key of ['energy', 'firstDerivative',
        'secondDerivative'] as const) {
        const a = first[key];
        const b = replayed[key];
        if (a.available && b.available) {
          expect(Object.is(a.value, b.value)).toBe(true);
        } else {
          expect(a.available).toBe(b.available);
        }
      }
    }
  });
});
