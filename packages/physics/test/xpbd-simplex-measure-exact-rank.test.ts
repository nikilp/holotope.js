import { describe, expect, it } from 'vitest';
import { CellComplex, VecN } from '@holotope/core';
import { evaluateSimplexSquaredMeasureN } from '../src/xpbd-simplex-measure.js';
import { lumpSimplexMassesN } from '../src/simplex-mass.js';
import { compileXpbdSimplexMeasureFamilyN } from '../src/xpbd-simplex-family.js';
import { XpbdParticleN } from '../src/xpbd-world.js';
import { compileSimplexConstitutiveFamilyN } from '../src/simplex-constitutive-family.js';
import { simplexStVenantKirchhoffLawN } from '../src/simplex-constitutive-laws.js';

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

  it('keeps a nearby positive-volume perturbation strictly positive, and exact', () => {
    // One representable step in the last coordinate makes the area genuinely
    // positive, and it must not be clamped to zero.
    const result = evaluateSimplexSquaredMeasureN(
      points([[0, 0], [2, 49], [4, 98 + 2 ** -46]])
    );
    // The minor is exactly `2*(98 + 2^-46) - 4*49 = 2^-45`, so the area is
    // exactly `2^-46` and the squared measure exactly `2^-92`. Pinned as an
    // equality rather than a tolerance: the value comes from an exact integer
    // determinant, so approximate agreement here would mean a regression.
    expect(result.squaredMeasure).toBe(2 ** -92);
    expect(result.measure).toBe(2 ** -46);
  });

  it('is a function of the point set, not of which vertex is listed first', () => {
    /**
     * An unsigned simplex measure is a symmetric function of its vertices, so
     * relabelling them cannot change it. That held only approximately while the
     * minor's magnitude came from a pivoted elimination: pivoting depends on the
     * row order, the row order depends on which vertex the caller listed first,
     * and on this sliver the three cyclic orders disagreed by a factor of 2.345
     * — 2.019e-28 against 4.735e-28. Two callers describing one cell differently
     * got different rest measures from it.
     */
    const rows = [[0, 0], [2, 49], [4, 98 + 2 ** -46]];
    for (let shift = 0; shift < 3; shift += 1) {
      const order = [0, 1, 2].map((i) => rows[(i + shift) % 3] as readonly number[]);
      const result = evaluateSimplexSquaredMeasureN(points(order));
      expect(result.squaredMeasure, `cyclic shift ${shift}`).toBe(2 ** -92);
    }
    // The same statement for a sliver tetrahedron in R3, over all four sources.
    const tetra = [[0, 0, 0], [1e4, 0, 0], [0, 1e4, 0], [1e4, 1e4, 2 ** -20]];
    const first = evaluateSimplexSquaredMeasureN(points(tetra)).squaredMeasure;
    expect(first).toBeGreaterThan(0);
    for (let shift = 1; shift < 4; shift += 1) {
      const order = [0, 1, 2, 3].map((i) => tetra[(i + shift) % 4] as readonly number[]);
      expect(
        evaluateSimplexSquaredMeasureN(points(order)).squaredMeasure,
        `tetra cyclic shift ${shift}`
      ).toBe(first);
    }
  });

  it('resolves a needle and a cap exactly on representable inputs', () => {
    // Both have an exactly representable area; the evaluator must not lose it.
    expect(evaluateSimplexSquaredMeasureN(
      points([[0, 0], [1e7, 0], [1e7, 1]])).measure).toBe(5e6);
    expect(evaluateSimplexSquaredMeasureN(
      points([[0, 0], [1e7, 1], [2e7, 0]])).measure).toBe(1e7);
  });
});

describe('all three downstream degeneracy guards', () => {
  const simplexGroup = {
    key: 'collinear', dim: 2, verticesPerCell: 3, kind: 'simplex' as const,
    indices: Uint32Array.from([0, 1, 2])
  };
  const collapsed = Float64Array.from([0, 0, 2, 49, 4, 98]);
  const source = new CellComplex(2, collapsed, [simplexGroup as never]);
  // The same point set moved comfortably off collinearity. A single representable
  // step gives an area of 2^-46, which the MEASURE resolves correctly but whose
  // rest metric the constitutive family then legitimately refuses to invert — a
  // separate downstream condition, not a measure defect.
  const positive = Float64Array.from([0, 0, 2, 49, 4, 108]);
  const positiveSource = new CellComplex(2, positive, [simplexGroup as never]);
  const particlesOf = (flat: Float64Array): XpbdParticleN[] =>
    [0, 1, 2].map((i) => new XpbdParticleN({
      id: `p${i}`,
      position: new VecN(Float64Array.from([flat[i * 2] as number, flat[i * 2 + 1] as number])),
      inverseMass: 1
    }));

  it('lumpSimplexMassesN refuses by name', () => {
    expect(() => lumpSimplexMassesN({
      source, simplexGroup: simplexGroup as never, density: 1
    } as never)).toThrow(/degenerate/);
  });

  it('compileXpbdSimplexMeasureFamilyN refuses by name', () => {
    expect(() => compileXpbdSimplexMeasureFamilyN({
      id: 'collinear', source, simplexGroup: simplexGroup as never,
      particles: particlesOf(collapsed)
    } as never)).toThrow(/degenerate/);
  });

  it('the constitutive-family source-cell guard refuses by name', () => {
    expect(() => compileSimplexConstitutiveFamilyN({
      id: 'collinear', source, simplexGroup: simplexGroup as never,
      particles: particlesOf(collapsed), law: simplexStVenantKirchhoffLawN,
      material: { firstLameParameter: 1, shearModulus: 1 }
    } as never)).toThrow(/degenerate/);
  });

  it('all three accept a nearby positive-volume cell', () => {
    expect(() => lumpSimplexMassesN({
      source: positiveSource, simplexGroup: simplexGroup as never, density: 1
    } as never)).not.toThrow();
    expect(() => compileXpbdSimplexMeasureFamilyN({
      id: 'positive', source: positiveSource, simplexGroup: simplexGroup as never,
      particles: particlesOf(positive)
    } as never)).not.toThrow();
    expect(() => compileSimplexConstitutiveFamilyN({
      id: 'positive', source: positiveSource, simplexGroup: simplexGroup as never,
      particles: particlesOf(positive), law: simplexStVenantKirchhoffLawN,
      material: { firstLameParameter: 1, shearModulus: 1 }
    } as never)).not.toThrow();
  });

  it('leaves source data unchanged after each refusal', () => {
    const before = Array.from(source.positions);
    for (const attempt of [
      () => lumpSimplexMassesN({
        source, simplexGroup: simplexGroup as never, density: 1 } as never),
      () => compileXpbdSimplexMeasureFamilyN({
        id: 'a', source, simplexGroup: simplexGroup as never,
        particles: particlesOf(collapsed) } as never),
      () => compileSimplexConstitutiveFamilyN({
        id: 'b', source, simplexGroup: simplexGroup as never,
        particles: particlesOf(collapsed), law: simplexStVenantKirchhoffLawN,
        material: { firstLameParameter: 1, shearModulus: 1 } } as never)
    ]) {
      expect(attempt).toThrow(/degenerate/);
      expect(Array.from(source.positions)).toEqual(before);
    }
  });
});
