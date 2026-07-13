import { describe, expect, it } from 'vitest';
import {
  createPenroseModelSet,
  penroseCartesian,
  penrosePatch,
  penroseRotate72,
  penroseVertexStarCensus,
  penroseWindowVertices,
  phiRing,
  type PenroseCoefficients
} from '@holotope/core';

describe('rhombic Penrose model set', () => {
  it('routes the four nonzero C5 classes to exact pentagonal windows', () => {
    const model = createPenroseModelSet();
    expect(model.windows.size).toBe(4);
    for (const windowClass of [1, 2, 3, 4] as const) {
      const vertices = penroseWindowVertices(windowClass);
      expect(vertices).toHaveLength(5);
      const window = model.windows.get(windowClass)!;
      expect(window.halfspaces).toHaveLength(5);
      expect(window.classify([phiRing.zero, phiRing.zero])).toBe('inside');
    }
  });

  it('uses a globally nonsingular exact seventh-unit default phason', () => {
    const patch = createPenroseModelSet().sample({
      coefficientRanges: Array.from({ length: 4 }, () => ({ min: -8, max: 8 }))
    });
    expect(patch.candidateCount).toBe(17 ** 4);
    expect(patch.boundaryCount).toBe(0);
    expect(patch.points.length).toBeGreaterThan(500);
  });

  it('reports the centered singular cut instead of hiding its boundary choices', () => {
    const patch = createPenroseModelSet({
      phasonOffsetSevenths: [phiRing.zero, phiRing.zero],
      boundaryPolicy: 'include'
    }).sample({
      coefficientRanges: Array.from({ length: 4 }, () => ({ min: -4, max: 4 }))
    });
    expect(patch.boundaryCount).toBeGreaterThan(0);
    expect(() =>
      createPenroseModelSet({
        phasonOffsetSevenths: [phiRing.zero, phiRing.zero]
      }).sample({
        coefficientRanges: Array.from({ length: 4 }, () => ({ min: -4, max: 4 }))
      })
    ).toThrow(/singular cut/);
  });

  it('closes exactly under the cyclotomic 72-degree provenance rotation', () => {
    const point: PenroseCoefficients = [3n, -2n, 5n, 1n];
    let rotated = point;
    for (let turn = 0; turn < 5; turn++) rotated = penroseRotate72(rotated);
    expect(rotated).toEqual(point);

    const model = createPenroseModelSet({
      phasonOffsetSevenths: [phiRing.zero, phiRing.zero],
      boundaryPolicy: 'include'
    });
    const before = penroseCartesian(model.flat.projectParallel(model.lattice.point(point)));
    const after = penroseCartesian(
      model.flat.projectParallel(model.lattice.point(penroseRotate72(point)))
    );
    const angle = (2 * Math.PI) / 5;
    expect(after[0]).toBeCloseTo(before[0]! * Math.cos(angle) - before[1]! * Math.sin(angle), 12);
    expect(after[1]).toBeCloseTo(before[0]! * Math.sin(angle) + before[1]! * Math.cos(angle), 12);
  });

  it('builds unit rhomb edges and realizes all seven geometric vertex stars', () => {
    const patch = penrosePatch({ coefficientRadius: 9, physicalRadius: 10 });
    expect(patch.boundaryCount).toBe(0);
    expect(patch.points.length).toBeGreaterThan(300);
    for (let edge = 0; edge < patch.edgeDirections.length; edge++) {
      const left = penroseCartesian(patch.points[patch.edges[edge * 2]!]!.parallelExact);
      const right = penroseCartesian(patch.points[patch.edges[edge * 2 + 1]!]!.parallelExact);
      expect(Math.hypot(left[0]! - right[0]!, left[1]! - right[1]!)).toBeCloseTo(1, 12);
    }
    const census = penroseVertexStarCensus(patch, { interiorRadius: 8.5 });
    expect(census.size).toBe(7);
    expect([...census.values()].reduce((sum, count) => sum + count, 0)).toBeGreaterThan(200);
  });

  it('selects distinct regular tilings with exact phason offsets', () => {
    const first = penrosePatch({ coefficientRadius: 8, physicalRadius: 8 });
    const second = penrosePatch({
      coefficientRadius: 8,
      physicalRadius: 8,
      phasonOffsetSevenths: [{ a: 2n, b: 0n }, phiRing.one]
    });
    expect(first.boundaryCount).toBe(0);
    expect(second.boundaryCount).toBe(0);
    const firstKeys = new Set(first.points.map((point) => point.coefficients.join(',')));
    const secondKeys = new Set(second.points.map((point) => point.coefficients.join(',')));
    expect(secondKeys).not.toEqual(firstKeys);
  });
});
