import { describe, expect, it } from 'vitest';
import {
  evaluateExactPointSimplexResult,
  type PointSimplexResult
} from '../src/index.js';

function walk(value: unknown, visit: (entry: unknown) => void): void {
  visit(value);
  if (value !== null && typeof value === 'object') {
    for (const key of Reflect.ownKeys(value)) {
      walk((value as Record<PropertyKey, unknown>)[key], visit);
    }
  }
}

describe('exact point--simplex distance', () => {
  it('publishes one coherent triangle witness with outward evidence', () => {
    const result = evaluateExactPointSimplexResult(
      [0.25, 0.125, 2],
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
      3
    );
    expect(result.status).toBe('projected');
    if (result.status !== 'projected') return;
    expect(result.exactRank).toBe(2);
    expect(result.activeSlots).toEqual([0, 1, 2]);
    expect(result.witness.weights).toEqual([0.625, 0.25, 0.125]);
    expect(result.witness.point).toEqual([0.25, 0.125, 0]);
    expect(result.witness.distance).toBe(2);
    expect(result.witness.squaredDistance).toBe(4);
    expect(result.witness.direction).toEqual([0, 0, 1]);
    expect(result.error.weightAbsoluteErrorBound).toEqual([0, 0, 0]);
    expect(result.error.pointAbsoluteErrorBound).toEqual([0, 0, 0]);
    expect(result.error.squaredDistanceErrorBound).toBe(0);
    expect(result.error.directionErrorBound).toBe(0);
  });

  it('decides zero and exact affine rank without a tolerance', () => {
    const zero = evaluateExactPointSimplexResult(
      [0.25, 0.25, 0],
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
      3
    );
    const deficient = evaluateExactPointSimplexResult(
      [0, 0, 1],
      [0, 0, 0, 1, 0, 0, 2, 0, 0],
      3
    );
    expect(zero.status).toBe('zero');
    expect(deficient).toEqual({ status: 'rank-deficient', exactRank: 1 });
  });

  it('is covariant under vertex permutations and power-of-two scaling', () => {
    const point = [0.25, 0.125, 2];
    const simplex = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const permuted = [0, 1, 0, 0, 0, 0, 1, 0, 0];
    const first = evaluateExactPointSimplexResult(point, simplex, 3);
    const second = evaluateExactPointSimplexResult(point, permuted, 3);
    const scale = 2 ** 40;
    const scaled = evaluateExactPointSimplexResult(
      point.map((value) => value * scale),
      simplex.map((value) => value * scale),
      3
    );
    expect(first.status).toBe('projected');
    expect(second.status).toBe('projected');
    expect(scaled.status).toBe('projected');
    if (first.status !== 'projected' || second.status !== 'projected' ||
      scaled.status !== 'projected') return;
    expect(second.witness.point).toEqual(first.witness.point);
    expect(second.witness.distance).toBe(first.witness.distance);
    expect(second.witness.direction).toEqual(first.witness.direction);
    expect(scaled.witness.distance).toBe(first.witness.distance * scale);
    expect(scaled.witness.direction).toEqual(first.witness.direction);
  });

  it('rejects the legacy negative-barycentric candidate at every band scale', () => {
    const triangle = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    for (const epsilon of [9e-14, 9e-12, 9e-11, 2e-10]) {
      const result = evaluateExactPointSimplexResult(
        [-epsilon, 0.5, 2 * epsilon], triangle, 3
      );
      expect(result.status).toBe('projected');
      if (result.status !== 'projected') continue;
      expect(result.witness.distance / epsilon).toBeCloseTo(Math.sqrt(5), 13);
      expect(result.activeSlots).toEqual([0, 2]);
      expect(result.witness.weights[1]).toBe(0);
    }
  });

  it('keeps an ill-conditioned interior optimum instead of collapsing it to an edge', () => {
    const result = evaluateExactPointSimplexResult(
      [0.5, 2 ** -37, 2 ** -25],
      [0, 0, 0, 1, 0, 0, 0, 2 ** -34, 0],
      3
    );
    expect(result.status).toBe('projected');
    if (result.status !== 'projected') return;
    expect(result.activeSlots).toEqual([0, 1, 2]);
    expect(result.witness.distance).toBe(2 ** -25);
    expect(result.witness.direction).toEqual([0, 0, 1]);
    expect(result.witness.weights[2]).toBe(2 ** -3);
  });

  it('keeps every uncertified reason distinct and reachable', () => {
    const segment = [0, 0, 1, 0];
    const results = [
      evaluateExactPointSimplexResult(
        [Number.MIN_VALUE, Number.MIN_VALUE], [0, 0, 2 ** 14, 0], 2
      ),
      evaluateExactPointSimplexResult([0, 2 ** -540], segment, 2),
      evaluateExactPointSimplexResult(
        [Number.MAX_VALUE, Number.MAX_VALUE],
        [-Number.MAX_VALUE, -Number.MAX_VALUE,
          Number.MAX_VALUE, Number.MAX_VALUE / 2],
        2
      ),
      evaluateExactPointSimplexResult(
        [7, Number.MIN_VALUE], [0, 0, 25, 0], 2
      )
    ];
    expect(results.map((result) => result.status === 'uncertified'
      ? result.reason
      : result.status)).toEqual([
      'weight-underflow',
      'value-underflow',
      'value-overflow',
      'accuracy-bound-overflow'
    ]);
  });

  it('keeps finite accuracy-bound overflow separate from witness overflow', () => {
    const accuracy = evaluateExactPointSimplexResult(
      [7, Number.MIN_VALUE], [0, 0, 25, 0], 2
    );
    const witness = evaluateExactPointSimplexResult(
      [Number.MAX_VALUE, -Number.MAX_VALUE],
      [-Number.MAX_VALUE, Number.MAX_VALUE,
        Number.MAX_VALUE, -Number.MAX_VALUE / 3],
      2
    );
    expect(accuracy).toMatchObject({
      status: 'uncertified', reason: 'accuracy-bound-overflow'
    });
    expect(witness).toMatchObject({
      status: 'uncertified', reason: 'value-overflow'
    });
  });

  it('owns and freezes all returned evidence without touching caller inputs', () => {
    const point = [0.25, 0.125, 2];
    const simplex = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const pointBefore = [...point];
    const simplexBefore = [...simplex];
    const result: PointSimplexResult = evaluateExactPointSimplexResult(
      point, simplex, 3
    );
    expect(point).toEqual(pointBefore);
    expect(simplex).toEqual(simplexBefore);
    expect(Object.isFrozen(point)).toBe(false);
    expect(Object.isFrozen(simplex)).toBe(false);
    walk(result, (value) => {
      if (value !== null && typeof value === 'object') {
        expect(Object.isFrozen(value)).toBe(true);
      }
      expect(typeof value).not.toBe('bigint');
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('canonicalises signed zero and refuses malformed inputs', () => {
    const result = evaluateExactPointSimplexResult(
      [-0, +0, 1], [-0, +0, -0, 1, 0, 0, 0, 1, -0], 3
    );
    walk(result, (value) => {
      if (typeof value === 'number') expect(Object.is(value, -0)).toBe(false);
    });
    expect(() => evaluateExactPointSimplexResult([0, 0], [0, 0], 2))
      .toThrow('1 <= k <= 3');
    expect(() => evaluateExactPointSimplexResult([0, Number.NaN], [0, 0, 1, 0], 2))
      .toThrow('finite');
    expect(() => evaluateExactPointSimplexResult([0, 0], [0, 0, 1], 2))
      .toThrow('divisible');
  });
});
