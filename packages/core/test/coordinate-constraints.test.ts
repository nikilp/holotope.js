import { describe, expect, it } from 'vitest';
import { solveLinearCoordinateConstraintsN } from '@holotope/core';

describe('linear coordinate constraints', () => {
  it('solves a full-rank exact system and exposes its certificate', () => {
    const fit = solveLinearCoordinateConstraintsN(2, [{
      label: 'exact pair',
      coefficients: [1, 1, 1, -1],
      targets: [3, 1],
      rowCount: 2
    }]);

    expect(fit.solution[0]).toBeCloseTo(2, 14);
    expect(fit.solution[1]).toBeCloseTo(1, 14);
    expect(fit.consistency).toBe('compatible');
    expect(fit.determination).toBe('unique');
    expect(fit.rank).toBe(2);
    expect(fit.unresolvedDegreesOfFreedom).toBe(0);
    expect(fit.normalizedResidualRms).toBeLessThan(1e-14);
    expect(fit.normalResidual).toBeLessThan(1e-13);
    expect(fit.blocks).toMatchObject([{ label: 'exact pair', rank: 2 }]);
  });

  it('uses the zero prior for the minimum-norm rank-deficient solution', () => {
    const fit = solveLinearCoordinateConstraintsN(2, [{
      coefficients: [1, 1],
      targets: [3],
      rowCount: 1
    }]);

    expect(fit.solution[0]).toBeCloseTo(1.5, 14);
    expect(fit.solution[1]).toBeCloseTo(1.5, 14);
    expect(fit.determination).toBe('rank-deficient');
    expect(fit.rank).toBe(1);
    expect(fit.unresolvedDegreesOfFreedom).toBe(1);
  });

  it('copies only unresolved spectral components from a prior', () => {
    const fit = solveLinearCoordinateConstraintsN(2, [{
      coefficients: [1, 1],
      targets: [3],
      rowCount: 1
    }], { prior: [4, 0] });

    expect(fit.solution[0]).toBeCloseTo(3.5, 14);
    expect(fit.solution[1]).toBeCloseTo(-0.5, 14);
    expect(fit.normalizedResidualRms).toBeLessThan(1e-14);
  });

  it('reports the weighted optimum of incompatible blocks', () => {
    const fit = solveLinearCoordinateConstraintsN(1, [
      { label: 'left', coefficients: [1], targets: [0], rowCount: 1 },
      {
        label: 'right',
        coefficients: [1],
        targets: [2],
        rowCount: 1,
        weight: 3
      }
    ]);

    expect(fit.solution[0]).toBeCloseTo(1.5, 14);
    expect(fit.consistency).toBe('conflicting');
    expect(fit.determination).toBe('unique');
    expect(fit.objective).toBeCloseTo(3, 14);
    expect(fit.normalizedResidualRms).toBeCloseTo(Math.sqrt(0.75), 14);
    expect(fit.normalResidual).toBeLessThan(1e-13);
  });

  it('makes block units explicit and invariant under matching rescaling', () => {
    const base = solveLinearCoordinateConstraintsN(2, [{
      coefficients: [1, 2],
      targets: [3],
      rowCount: 1
    }], { prior: [1, -1] });
    const rescaled = solveLinearCoordinateConstraintsN(2, [{
      coefficients: [7, 14],
      targets: [21],
      rowCount: 1,
      scale: 7
    }], { prior: [1, -1] });

    expect(Array.from(rescaled.solution)).toEqual(Array.from(base.solution));
    expect(rescaled.rank).toBe(base.rank);
    expect(rescaled.rankConditioning).toBe(base.rankConditioning);
    expect(rescaled.objective).toBe(base.objective);
  });

  it('returns the prior for an explicitly unconstrained coordinate space', () => {
    const fit = solveLinearCoordinateConstraintsN(3, [], { prior: [2, -3, 5] });
    expect(fit.solution).toEqual(new Float64Array([2, -3, 5]));
    expect(fit).toMatchObject({
      consistency: 'compatible',
      determination: 'rank-deficient',
      totalRows: 0,
      rank: 0,
      unresolvedDegreesOfFreedom: 3,
      objective: 0,
      normalizedResidualRms: 0
    });
  });

  it('is deterministic for an overdetermined mixed-scale system', () => {
    const blocks = [
      {
        coefficients: [1, 2, -1, 0, 1, 3],
        targets: [0.5, -2],
        rowCount: 2,
        weight: 0.75,
        scale: 2
      },
      {
        coefficients: [4, -1, 2, -3, 5, 1],
        targets: [7, -4],
        rowCount: 2,
        weight: 2.25,
        scale: 5
      }
    ] as const;
    const first = solveLinearCoordinateConstraintsN(3, blocks);
    const second = solveLinearCoordinateConstraintsN(3, blocks);

    expect(second.solution).toEqual(first.solution);
    expect(second.singularValues).toEqual(first.singularValues);
    expect(second.objective).toBe(first.objective);
    expect(first.normalResidual).toBeLessThan(1e-12);
  });

  it('rejects malformed, non-finite, or dimensionless policies', () => {
    expect(() => solveLinearCoordinateConstraintsN(0, [])).toThrow(/coordinateDim/);
    expect(() => solveLinearCoordinateConstraintsN(2, [{
      coefficients: [1, 2, 3], targets: [1, 2], rowCount: 2
    }])).toThrow(/coefficients must contain 4/);
    expect(() => solveLinearCoordinateConstraintsN(1, [{
      coefficients: [1], targets: [Number.NaN], rowCount: 1
    }])).toThrow(/targets must be finite/);
    expect(() => solveLinearCoordinateConstraintsN(1, [{
      coefficients: [1], targets: [0], rowCount: 1, weight: 0
    }])).toThrow(/weight must be finite and positive/);
    expect(() => solveLinearCoordinateConstraintsN(1, [{
      coefficients: [1], targets: [0], rowCount: 1, scale: 0
    }])).toThrow(/scale must be finite and positive/);
    expect(() => solveLinearCoordinateConstraintsN(2, [], { prior: [1] })).toThrow(
      /prior must contain 2/
    );
  });
});
