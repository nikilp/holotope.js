import { describe, expect, it } from 'vitest';
import {
  ClampedLogBarrierInputErrorN,
  evaluateClampedLogBarrierAtOrderN,
  type BarrierComponentN,
  type ClampedLogBarrierForceN,
  type ClampedLogBarrierInputsN,
  type ClampedLogBarrierValueN
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

  it('the runtime order guard: every invalid ERASED order value throws the'
    + ' typed permanent error, and nothing escapes', () => {
    // NC1 (P66E-PUB review): before the guard, all of these returned a full
    // order-2 result from the packed tarball. The type system cannot stop a
    // JavaScript caller or a JSON/config/adapter boundary, so the rejection
    // is driven here with ERASED values, not TypeScript negatives.
    const erased = evaluateClampedLogBarrierAtOrderN as unknown as (
      inputs: ClampedLogBarrierInputsN, order?: unknown
    ) => unknown;
    const inputs = { coordinate: 0.5, activation: 1, stiffness: 1 };
    const invalid: readonly [string, unknown][] = [
      ['undefined', undefined], ['null', null], ['3', 3], ['"1"', '1'],
      ['1.5', 1.5], ['-1', -1], ['NaN', Number.NaN],
      // Order equality is LITERAL: coercible impostors are rejected too.
      ['new Number(1)', new Number(1)], ['true', true], ['"2"', '2'],
      ['[1]', [1]], ['{}', {}]
    ];
    for (const [label, order] of invalid) {
      expect(() => erased(inputs, order),
        `order ${label} must throw`).toThrow(ClampedLogBarrierInputErrorN);
      expect(() => erased(inputs, order),
        `order ${label} must name the order`).toThrow(
        'order must be exactly 0, 1 or 2');
    }
    // The omitted argument — the exact packed-tarball reproduction shape.
    expect(() => (erased as (i: ClampedLogBarrierInputsN) => unknown)(inputs))
      .toThrow(ClampedLogBarrierInputErrorN);
    // Permanence: the same call throws identically twice — nothing is
    // memoized, half-built or recovered.
    expect(() => erased(inputs, 3)).toThrow(ClampedLogBarrierInputErrorN);
    expect(() => erased(inputs, 3)).toThrow(ClampedLogBarrierInputErrorN);
    // No component escapes: the throw happens before any result object is
    // created, so the only observable is the error itself.
    let escaped: unknown = 'nothing';
    try {
      escaped = erased(inputs, 1.5);
    } catch (error) {
      expect(error).toBeInstanceOf(ClampedLogBarrierInputErrorN);
      // The error carries its identity and nothing of a result's shape.
      expect(Object.keys(error as object)).toEqual(['name']);
      for (const key of ['inputs', 'active', 'energy', 'firstDerivative',
        'secondDerivative']) {
        expect(key in (error as object), `${key} escaped`).toBe(false);
      }
    }
    expect(escaped).toBe('nothing');
    // The caller's input object is untouched by a rejected call.
    expect(Object.isFrozen(inputs)).toBe(false);
    expect(inputs).toEqual({ coordinate: 0.5, activation: 1, stiffness: 1 });
    // And valid orders, supplied as ERASED runtime numbers, retain their
    // exact runtime keys.
    const expectedKeys: Record<number, string[]> = {
      0: ['inputs', 'active', 'energy'],
      1: ['inputs', 'active', 'energy', 'firstDerivative'],
      2: ['inputs', 'active', 'energy', 'firstDerivative', 'secondDerivative']
    };
    for (const order of [0, 1, 2]) {
      const result = erased(inputs, JSON.parse(String(order))) as object;
      expect(Object.keys(result)).toEqual(expectedKeys[order]);
    }
  });

  it('validation precedence: malformed scalar inputs are named before a'
    + ' malformed order, and both precede any arithmetic', () => {
    const erased = evaluateClampedLogBarrierAtOrderN as unknown as (
      inputs: unknown, order: unknown
    ) => unknown;
    // Both defects present: the scalar-input validation keeps its
    // pre-existing precedence.
    expect(() => erased(
      { coordinate: -1, activation: 1, stiffness: 1 }, 7))
      .toThrow('coordinate must be finite and positive');
    expect(() => erased(null, 7)).toThrow('inputs must be an object');
    // Order alone malformed, inputs valid: the order is named.
    expect(() => erased(
      { coordinate: 0.5, activation: 1, stiffness: 1 }, 7))
      .toThrow('order must be exactly 0, 1 or 2');
    // Both validations finish before the core runs: zero core operations
    // on either rejection.
    takeCoreOperationCount();
    for (const call of [
      () => erased({ coordinate: -1, activation: 1, stiffness: 1 }, 7),
      () => erased({ coordinate: 0.5, activation: 1, stiffness: 1 }, 7)
    ]) {
      expect(call).toThrow(ClampedLogBarrierInputErrorN);
    }
    expect(takeCoreOperationCount()).toBe(0);
  });

  it('snapshot: each scalar is read from the caller exactly once, and the'
    + ' record validated, computed from and published is the same one', () => {
    /**
     * P66E-PUB-S: before the snapshot, an accessor- or Proxy-backed input
     * was read three times per scalar, so the value validated, the value the
     * core used and the value published could all differ — `result.inputs`
     * could carry a coordinate the function's own validation forbids.
     */
    const counted = (values: readonly number[]) => {
      const reads = { coordinate: 0, activation: 0, stiffness: 0 };
      const inputs = {
        get coordinate() {
          const value = values[Math.min(reads.coordinate, values.length - 1)]!;
          reads.coordinate += 1;
          return value;
        },
        get activation() { reads.activation += 1; return 1; },
        get stiffness() { reads.stiffness += 1; return 1; }
      };
      return { inputs: inputs as ClampedLogBarrierInputsN, reads };
    };

    // Three DIFFERENT valid values: one read each, and the first is the one
    // that is validated, computed from and published.
    for (const order of ORDERS) {
      const { inputs, reads } = counted([0.5, 0.25, 0.125]);
      const result = evaluateClampedLogBarrierAtOrderN(inputs, order);
      expect(reads).toEqual({ coordinate: 1, activation: 1, stiffness: 1 });
      expect(result.inputs.coordinate).toBe(0.5);
      // Published evidence and computed value agree: replaying the published
      // record on plain data reproduces the result bit for bit.
      const replay = evaluateClampedLogBarrierAtOrderN(result.inputs, order);
      expect(replay).toEqual(result);
    }

    // Valid first, invalid later: the FIRST snapshot is evaluated and
    // published; the later value is never seen.
    const later = counted([0.5, -1]);
    const evaluated = evaluateClampedLogBarrierAtOrderN(later.inputs, 0);
    expect(later.reads.coordinate).toBe(1);
    expect(evaluated.inputs.coordinate).toBe(0.5);
    expect(value(evaluated.energy)).toBeGreaterThan(0);

    // Invalid first, valid later: the CAPTURED invalid snapshot is rejected;
    // the later valid value cannot rescue it.
    const first = counted([-1, 0.5]);
    expect(() => evaluateClampedLogBarrierAtOrderN(first.inputs, 2))
      .toThrow(ClampedLogBarrierInputErrorN);
    expect(first.reads.coordinate).toBe(1);
  });

  it('snapshot: the published record is the identical object the core'
    + ' consumed, and the caller object is untouched', () => {
    takeCoreOperationCount();
    const callerInputs = { coordinate: 0.5, activation: 1, stiffness: 2 };
    const result = evaluateClampedLogBarrierAtOrderN(callerInputs, 2);
    // Not the caller's object, and the same object at every order level.
    expect(result.inputs).not.toBe(callerInputs);
    expect(Object.isFrozen(result.inputs)).toBe(true);
    const asForce: ClampedLogBarrierForceN = result;
    const asValue: ClampedLogBarrierValueN = result;
    expect(asForce.inputs).toBe(result.inputs);
    expect(asValue.inputs).toBe(result.inputs);
    // The caller's object stays writable, extensible and unfrozen.
    expect(Object.isFrozen(callerInputs)).toBe(false);
    expect(Object.isExtensible(callerInputs)).toBe(true);
    (callerInputs as { coordinate: number }).coordinate = 99;
    (callerInputs as { extra?: number }).extra = 1;
    expect(result.inputs.coordinate).toBe(0.5);
    expect(Object.keys(result.inputs))
      .toEqual(['coordinate', 'activation', 'stiffness']);
  });

  it('snapshot: a throwing caller getter escapes unchanged, before any'
    + ' arithmetic or result object', () => {
    class CallerFault extends Error {}
    takeCoreOperationCount();
    const exploding = {
      get coordinate(): number { throw new CallerFault('caller getter'); },
      get activation(): number { return 1; },
      get stiffness(): number { return 1; }
    } as ClampedLogBarrierInputsN;
    // Caller code, not a malformed number: it must NOT be converted into a
    // ClampedLogBarrierInputErrorN, and must not be swallowed.
    expect(() => evaluateClampedLogBarrierAtOrderN(exploding, 2))
      .toThrow(CallerFault);
    let caught: unknown;
    try { evaluateClampedLogBarrierAtOrderN(exploding, 2); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(CallerFault);
    expect(caught).not.toBeInstanceOf(ClampedLogBarrierInputErrorN);
    expect((caught as Error).message).toBe('caller getter');
    // Nothing was computed on the way out.
    expect(takeCoreOperationCount()).toBe(0);
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
