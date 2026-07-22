import { VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  analyzeLinearSimplexMeasureN,
  evaluateSimplexSquaredMeasureN
} from '../src/index.js';

const v = (...coordinates: number[]): VecN => new VecN(coordinates);

function interpolate(
  start: readonly VecN[],
  end: readonly VecN[],
  time: number
): VecN[] {
  return start.map((point, index) => {
    const result = new VecN(point.dim);
    for (let axis = 0; axis < point.dim; axis++) {
      result.data[axis] = point.data[axis]! + time * (
        end[index]!.data[axis]! - point.data[axis]!
      );
    }
    return result;
  });
}

function polynomial(coefficients: Float64Array, time: number): number {
  let value = 0;
  for (let degree = coefficients.length - 1; degree >= 0; degree--) {
    value = value * time + coefficients[degree]!;
  }
  return value;
}

function squaredMeasureRatio(
  rest: readonly VecN[],
  current: readonly VecN[]
): number {
  return evaluateSimplexSquaredMeasureN(current).squaredMeasure /
    evaluateSimplexSquaredMeasureN(rest).squaredMeasure;
}

describe('linear intrinsic simplex-measure analysis', () => {
  it('constructs the analytic quadratic for a reversing R1 segment in R2', () => {
    const rest = [v(0, 0), v(1, 0)];
    const result = analyzeLinearSimplexMeasureN({
      restPositions: rest,
      startPositions: rest,
      endPositions: [v(0, 0), v(-1, 0)],
      minimumMeasureRatio: 0.2,
      timeTolerance: 2 ** -24
    });
    expect(Array.from(result.monomialCoefficients)).toEqual([0.96, -4, 4]);
    expect(result).toMatchObject({
      ambientDimension: 2,
      simplexDimension: 1,
      degree: 2,
      startSquaredMeasureRatio: 1,
      endSquaredMeasureRatio: 1,
      status: 'possible-violation'
    });
    if (result.status !== 'possible-violation') return;
    expect(result.timeBracket[0]).toBeLessThanOrEqual(0.4);
    expect(result.timeBracket[1]).toBeGreaterThanOrEqual(0.4);
    expect(result.timeBracket[1] - result.timeBracket[0]).toBeLessThanOrEqual(
      2 ** -24
    );
  });

  it('matches direct Gram ratios for embedded and full-dimensional simplices', () => {
    const cases = [
      {
        rest: [v(0, 0, 0, 0), v(1, 0, 0, 0)],
        start: [v(0.1, -0.2, 0, 0.3), v(1.2, 0.1, -0.1, 0)],
        end: [v(-0.2, 0.3, 0.2, 0), v(0.7, -0.4, 0.3, 0.2)]
      },
      {
        rest: [v(0, 0, 0), v(1, 0, 0), v(0, 1, 0)],
        start: [v(0.1, -0.2, 0.1), v(1.2, 0.1, 0), v(-0.2, 0.9, 0.2)],
        end: [v(-0.2, 0.3, 0), v(0.7, -0.4, 0.4), v(0.6, 1.1, -0.1)]
      },
      {
        rest: [
          v(0, 0, 0, 0), v(1, 0, 0, 0), v(0, 1, 0, 0), v(0, 0, 1, 0)
        ],
        start: [
          v(0.1, 0, -0.1, 0.2), v(1.1, 0.2, 0, 0.1),
          v(0, 0.9, 0.1, -0.1), v(0.2, -0.1, 1.2, 0)
        ],
        end: [
          v(-0.2, 0.1, 0.2, 0), v(0.8, -0.2, 0.3, 0.2),
          v(0.3, 1.2, -0.1, 0.1), v(-0.1, 0.2, 0.7, 0.4)
        ]
      },
      {
        rest: [
          v(0, 0, 0, 0), v(1, 0, 0, 0), v(0, 1, 0, 0),
          v(0, 0, 1, 0), v(0, 0, 0, 1)
        ],
        start: [
          v(0.1, 0, -0.1, 0.2), v(1.1, 0.2, 0, 0.1),
          v(0, 0.9, 0.1, -0.1), v(0.2, -0.1, 1.2, 0),
          v(-0.1, 0.1, 0.2, 1.1)
        ],
        end: [
          v(-0.2, 0.1, 0.2, 0), v(0.8, -0.2, 0.3, 0.2),
          v(0.3, 1.2, -0.1, 0.1), v(-0.1, 0.2, 0.7, 0.4),
          v(0.2, -0.3, 0.1, 0.9)
        ]
      }
    ];
    for (const { rest, start, end } of cases) {
      const threshold = 0.17;
      const result = analyzeLinearSimplexMeasureN({
        restPositions: rest,
        startPositions: start,
        endPositions: end,
        minimumMeasureRatio: threshold
      });
      for (let sample = 0; sample <= 96; sample++) {
        const time = sample / 96;
        expect(polynomial(result.monomialCoefficients, time) + threshold ** 2)
          .toBeCloseTo(squaredMeasureRatio(
            rest,
            interpolate(start, end, time)
          ), 9);
      }
    }
  });

  it('finds embedded collapse between positive equal-measure endpoints', () => {
    const segmentRest = [v(0, 0, 0, 0), v(1, 0, 0, 0)];
    const segment = analyzeLinearSimplexMeasureN({
      restPositions: segmentRest,
      startPositions: segmentRest,
      endPositions: [v(0, 0, 0, 0), v(-1, 0, 0, 0)],
      minimumMeasureRatio: 0
    });
    expect(segment.status).toBe('possible-violation');

    const triangleRest = [v(0, 0, 0), v(1, 0, 0), v(0, 1, 0)];
    const triangle = analyzeLinearSimplexMeasureN({
      restPositions: triangleRest,
      startPositions: triangleRest,
      endPositions: [v(0, 0, 0), v(1, 0, 0), v(0, -1, 0)],
      minimumMeasureRatio: 0,
      timeTolerance: 2 ** -22
    });
    expect(triangle.startSquaredMeasureRatio).toBe(1);
    expect(triangle.endSquaredMeasureRatio).toBe(1);
    expect(triangle.status).toBe('possible-violation');
    if (triangle.status !== 'possible-violation') return;
    expect(triangle.timeBracket[0]).toBeLessThanOrEqual(0.5);
    expect(triangle.timeBracket[1]).toBeGreaterThanOrEqual(0.5);
  });

  it('subdivides loose squared-measure bounds and proves a safe chord', () => {
    const rest = [v(0, 0), v(1, -0.2), v(0.2, 1)];
    const result = analyzeLinearSimplexMeasureN({
      restPositions: rest,
      startPositions: rest,
      endPositions: [v(0, 0), v(-1, -0.2), v(0.2, -1)],
      minimumMeasureRatio: 0
    });
    expect(Math.min(...result.bernsteinCoefficients)).toBeLessThan(0);
    expect(result.status).toBe('safe');
    if (result.status !== 'safe') return;
    expect(result.minimumMarginLowerBound).toBeGreaterThan(0);
  });

  it('is invariant under ambient isometries and consistent vertex order', () => {
    const rest = [v(0, 0, 0), v(1, 0, 0), v(0, 1, 0)];
    const start = [v(0.1, -0.2, 0.1), v(1.2, 0.1, 0), v(-0.2, 0.9, 0.2)];
    const end = [v(-0.2, 0.3, 0), v(0.7, -0.4, 0.4), v(0.6, 1.1, -0.1)];
    const analyze = (r: VecN[], s: VecN[], e: VecN[]) =>
      analyzeLinearSimplexMeasureN({
        restPositions: r,
        startPositions: s,
        endPositions: e,
        minimumMeasureRatio: 0.1
      });
    const base = analyze(rest, start, end);
    const isometry = (points: readonly VecN[]) => points.map((point) =>
      v(
        point.data[1]! + 4,
        -point.data[0]! - 3,
        point.data[2]! + 2
      )
    );
    const mapped = analyze(isometry(rest), isometry(start), isometry(end));
    const order = [2, 0, 1];
    const permuted = analyze(
      order.map((index) => rest[index]!),
      order.map((index) => start[index]!),
      order.map((index) => end[index]!)
    );
    for (let degree = 0; degree < base.monomialCoefficients.length; degree++) {
      expect(mapped.monomialCoefficients[degree]).toBeCloseTo(
        base.monomialCoefficients[degree]!, 11
      );
      expect(permuted.monomialCoefficients[degree]).toBeCloseTo(
        base.monomialCoefficients[degree]!, 11
      );
    }
  });

  it('refuses malformed, over-dimensional, degenerate, and non-finite inputs', () => {
    const rest = [v(0, 0, 0), v(1, 0, 0), v(0, 1, 0)];
    const valid = {
      restPositions: rest,
      startPositions: rest,
      endPositions: rest,
      minimumMeasureRatio: 0
    };
    expect(() => analyzeLinearSimplexMeasureN({
      ...valid,
      startPositions: [v(0, 0, 0), v(1, 0, 0)]
    })).toThrow(/exactly 3 points/);
    expect(() => analyzeLinearSimplexMeasureN({
      ...valid,
      restPositions: [v(0, 0), v(1, 0), v(0, 1), v(1, 1)]
    })).toThrow(/exceeds ambient/);
    expect(() => analyzeLinearSimplexMeasureN({
      ...valid,
      restPositions: [v(0, 0, 0), v(1, 0, 0), v(2, 0, 0)]
    })).toThrow(/non-degenerate/);
    expect(() => analyzeLinearSimplexMeasureN({
      ...valid,
      endPositions: [v(0, 0, 0), v(Number.NaN, 0, 0), v(0, 1, 0)]
    })).toThrow(/finite coordinates/);
    expect(() => analyzeLinearSimplexMeasureN({
      ...valid,
      minimumMeasureRatio: -1
    })).toThrow(/non-negative/);
    expect(() => analyzeLinearSimplexMeasureN({
      ...valid,
      timeTolerance: 0
    })).toThrow(/timeTolerance/);
  });
});
