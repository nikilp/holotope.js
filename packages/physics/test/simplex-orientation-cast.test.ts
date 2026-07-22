import { MatN, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  analyzeLinearSimplexOrientationN,
  evaluateOrientedSimplexMeasureN
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

function signedRatio(rest: readonly VecN[], current: readonly VecN[]): number {
  return evaluateOrientedSimplexMeasureN(current).orientedMeasure /
    evaluateOrientedSimplexMeasureN(rest).orientedMeasure;
}

function transform(points: readonly VecN[], matrix: MatN, offset: VecN): VecN[] {
  return points.map((point) => matrix.applyTo(point).add(offset));
}

describe('linear full-dimensional simplex orientation analysis', () => {
  it('brackets the analytic R1 threshold time', () => {
    const rest = [v(0), v(1)];
    const result = analyzeLinearSimplexOrientationN({
      restPositions: rest,
      startPositions: rest,
      endPositions: [v(0), v(-1)],
      minimumSignedMeasureRatio: 0.2,
      timeTolerance: 2 ** -24
    });
    expect(Array.from(result.monomialCoefficients)).toEqual([0.8, -2]);
    expect(Array.from(result.bernsteinCoefficients)).toEqual([0.8, -1.2]);
    expect(result.status).toBe('possible-violation');
    if (result.status !== 'possible-violation') return;
    expect(result.timeBracket[0]).toBeLessThanOrEqual(0.4);
    expect(result.timeBracket[1]).toBeGreaterThanOrEqual(0.4);
    expect(result.timeBracket[1] - result.timeBracket[0]).toBeLessThanOrEqual(
      2 ** -24
    );
  });

  it('matches direct R2 and R4 determinant ratios over dense times', () => {
    const cases = [
      {
        rest: [v(0, 0), v(1, 0), v(0, 1)],
        start: [v(0.1, -0.2), v(1.2, 0.1), v(-0.2, 0.9)],
        end: [v(-0.2, 0.3), v(0.7, -0.4), v(0.6, 1.1)]
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
      const result = analyzeLinearSimplexOrientationN({
        restPositions: rest,
        startPositions: start,
        endPositions: end,
        minimumSignedMeasureRatio: threshold
      });
      for (let sample = 0; sample <= 128; sample++) {
        const time = sample / 128;
        expect(polynomial(result.monomialCoefficients, time) + threshold)
          .toBeCloseTo(signedRatio(rest, interpolate(start, end, time)), 11);
      }
    }
  });

  it('finds collapse between orientation-preserving endpoints without a sign change', () => {
    const rest = [v(0, 0), v(1, 0), v(0, 1)];
    const end = [v(0, 0), v(-1, 0), v(0, -1)];
    const result = analyzeLinearSimplexOrientationN({
      restPositions: rest,
      startPositions: rest,
      endPositions: end,
      minimumSignedMeasureRatio: 0,
      timeTolerance: 2 ** -22
    });
    expect(result.startSignedMeasureRatio).toBe(1);
    expect(result.endSignedMeasureRatio).toBe(1);
    expect(result.status).toBe('possible-violation');
    if (result.status !== 'possible-violation') return;
    expect(result.timeBracket[0]).toBeLessThanOrEqual(0.5);
    expect(result.timeBracket[1]).toBeGreaterThanOrEqual(0.5);
  });

  it('subdivides loose control bounds and proves a strictly safe trajectory', () => {
    const rest = [v(0, 0), v(1, -0.2), v(0.2, 1)];
    const end = [v(0, 0), v(-1, -0.2), v(0.2, -1)];
    const result = analyzeLinearSimplexOrientationN({
      restPositions: rest,
      startPositions: rest,
      endPositions: end,
      minimumSignedMeasureRatio: 0
    });
    expect(Math.min(...result.bernsteinCoefficients)).toBeLessThan(0);
    expect(result.status).toBe('safe');
    if (result.status !== 'safe') return;
    expect(result.minimumMarginLowerBound).toBeGreaterThan(0);
  });

  it('is invariant under common translation, positive affine maps, and vertex order', () => {
    const rest = [v(0, 0), v(1, 0), v(0, 1)];
    const start = [v(0.1, -0.2), v(1.2, 0.1), v(-0.2, 0.9)];
    const end = [v(-0.2, 0.3), v(0.7, -0.4), v(0.6, 1.1)];
    const base = analyzeLinearSimplexOrientationN({
      restPositions: rest,
      startPositions: start,
      endPositions: end,
      minimumSignedMeasureRatio: 0.1
    });
    const affine = new MatN(2, [1.3, 0.4, -0.2, 0.9]);
    expect(affine.determinant()).toBeGreaterThan(0);
    const offset = v(4, -3);
    const mapped = analyzeLinearSimplexOrientationN({
      restPositions: transform(rest, affine, offset),
      startPositions: transform(start, affine, offset),
      endPositions: transform(end, affine, offset),
      minimumSignedMeasureRatio: 0.1
    });
    const order = [2, 0, 1];
    const permuted = analyzeLinearSimplexOrientationN({
      restPositions: order.map((index) => rest[index]!),
      startPositions: order.map((index) => start[index]!),
      endPositions: order.map((index) => end[index]!),
      minimumSignedMeasureRatio: 0.1
    });
    for (let degree = 0; degree < base.monomialCoefficients.length; degree++) {
      expect(mapped.monomialCoefficients[degree]).toBeCloseTo(
        base.monomialCoefficients[degree]!, 12
      );
      expect(permuted.monomialCoefficients[degree]).toBeCloseTo(
        base.monomialCoefficients[degree]!, 12
      );
    }
  });

  it('refuses malformed, embedded, degenerate, and non-finite inputs', () => {
    const rest = [v(0, 0), v(1, 0), v(0, 1)];
    const valid = {
      restPositions: rest,
      startPositions: rest,
      endPositions: rest,
      minimumSignedMeasureRatio: 0
    };
    expect(() => analyzeLinearSimplexOrientationN({
      ...valid,
      startPositions: [v(0, 0), v(1, 0)]
    })).toThrow(/exactly 3 points/);
    expect(() => analyzeLinearSimplexOrientationN({
      ...valid,
      restPositions: [v(0, 0, 0), v(1, 0, 0), v(0, 1, 0)]
    })).toThrow(/full-dimensional/);
    expect(() => analyzeLinearSimplexOrientationN({
      ...valid,
      restPositions: [v(0, 0), v(1, 0), v(2, 0)]
    })).toThrow(/non-degenerate/);
    expect(() => analyzeLinearSimplexOrientationN({
      ...valid,
      endPositions: [v(0, 0), v(Number.NaN, 0), v(0, 1)]
    })).toThrow(/finite coordinates/);
    expect(() => analyzeLinearSimplexOrientationN({
      ...valid,
      minimumSignedMeasureRatio: -1
    })).toThrow(/non-negative/);
    expect(() => analyzeLinearSimplexOrientationN({
      ...valid,
      timeTolerance: 0
    })).toThrow(/timeTolerance/);
    expect(() => analyzeLinearSimplexOrientationN({
      ...valid,
      maximumDepth: 0
    })).toThrow(/maximumDepth/);
  });
});
