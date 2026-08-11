import { describe, expect, it } from 'vitest';
import { CellComplex, VecN } from '@holotope/core';
import { evaluateSimplexSquaredMeasureN } from '../src/xpbd-simplex-measure.js';
import { lumpSimplexMassesN } from '../src/simplex-mass.js';
import { compileXpbdSimplexMeasureFamilyN } from '../src/xpbd-simplex-family.js';
import { XpbdParticleN } from '../src/xpbd-world.js';

/**
 * The documented rank contract, pinned publicly.
 *
 * `evaluateSimplexSquaredMeasureN` promises that at exact rank deficiency the
 * squared measure and every gradient component are exactly zero, and that callers
 * may therefore use a zero measure as a degeneracy test. That guarantee is only
 * as strong as its worst input, and a sum of squared minors cannot cancel a
 * spurious residue — it turns one into a positive measure that every
 * `!(measure > 0)` guard accepts.
 *
 * The two matrices below are the ones that broke it: a division-based elimination
 * of the 2x2 minor `[[2, 4], [49, 98]]` returns about `-2.18e-14` where the
 * division-free `2*98 - 4*49` is exactly zero, because `2/49` is not
 * representable. They are pinned here rather than only in private measurement so
 * that a future change to the determinant path fails in CI.
 */
const points = (rows: readonly (readonly number[])[]): VecN[] =>
  rows.map((r) => new VecN(Float64Array.from(r)));

describe('evaluateSimplexSquaredMeasureN: exact rank deficiency', () => {
  it('returns exact zero for collinear points whose dependency is exact', () => {
    // Edge 2 is exactly twice edge 1 in the supplied Float64 values.
    const result = evaluateSimplexSquaredMeasureN(points([[0, 0], [2, 49], [4, 98]]));
    expect(result.squaredMeasure).toBe(0);
    expect(result.measure).toBe(0);
  });

  it('returns exact zero gradients there, as the contract promises', () => {
    const result = evaluateSimplexSquaredMeasureN(points([[0, 0], [2, 49], [4, 98]]));
    for (const gradient of result.gradients) {
      for (const component of gradient.data) expect(component).toBe(0);
    }
  });

  it('returns exact zero for an exactly dependent R3 edge matrix', () => {
    // Column 3 is column 1 plus column 2.
    const result = evaluateSimplexSquaredMeasureN(
      points([[0, 0, 0], [2, 2, 4], [2, 3, 5], [3, 2, 5]])
    );
    expect(result.squaredMeasure).toBe(0);
    expect(result.measure).toBe(0);
  });

  it('holds under embedding, reordering, reflection and power-of-two scaling', () => {
    const variants: readonly (readonly number[])[][] = [
      [[0, 0, 0, 0], [2, 49, 0, 0], [4, 98, 0, 0]],
      [[0, 0, 0, 0, 0, 0, 0], [2, 49, 0, 0, 0, 0, 0], [4, 98, 0, 0, 0, 0, 0]],
      [[2, 49], [0, 0], [4, 98]],
      [[4, 98], [0, 0], [2, 49]],
      [[0, 0], [-2, 49], [-4, 98]],
      [[0, 0], [16, 392], [32, 784]]
    ];
    for (const rows of variants) {
      const result = evaluateSimplexSquaredMeasureN(points(rows));
      expect(result.measure, JSON.stringify(rows)).toBe(0);
    }
  });

  it('keeps a nearby positive-volume perturbation strictly positive', () => {
    // One representable step in the last coordinate makes the area genuinely
    // positive, and it must not be clamped to zero.
    const result = evaluateSimplexSquaredMeasureN(
      points([[0, 0], [2, 49], [4, 98 + 2 ** -46]])
    );
    expect(result.measure).toBeGreaterThan(0);
    // Exactly `|2*(98 + 2^-46) - 4*49| / 2 = 2^-46`.
    expect(result.measure).toBeCloseTo(2 ** -46, 20);
  });

  it('resolves a needle and a cap exactly on representable inputs', () => {
    // Both have an exactly representable area; the evaluator must not lose it.
    expect(evaluateSimplexSquaredMeasureN(
      points([[0, 0], [1e7, 0], [1e7, 1]])).measure).toBe(5e6);
    expect(evaluateSimplexSquaredMeasureN(
      points([[0, 0], [1e7, 1], [2e7, 0]])).measure).toBe(1e7);
  });
});

describe('the downstream degeneracy guards refuse a collapsed cell', () => {
  const simplexGroup = {
    key: 'collinear', dim: 2, verticesPerCell: 3, kind: 'simplex' as const,
    indices: Uint32Array.from([0, 1, 2])
  };
  const source = new CellComplex(
    2, Float64Array.from([0, 0, 2, 49, 4, 98]), [simplexGroup as never]);

  it('lumpSimplexMassesN refuses by name', () => {
    expect(() => lumpSimplexMassesN({
      source, simplexGroup: simplexGroup as never, density: 1
    } as never)).toThrow(/degenerate/);
  });

  it('compileXpbdSimplexMeasureFamilyN refuses by name', () => {
    const particles = [[0, 0], [2, 49], [4, 98]].map((p, i) => new XpbdParticleN({
      id: `p${i}`, position: new VecN(Float64Array.from(p)), inverseMass: 1
    }));
    expect(() => compileXpbdSimplexMeasureFamilyN({
      id: 'collinear', source, simplexGroup: simplexGroup as never, particles
    } as never)).toThrow(/degenerate/);
  });
});
