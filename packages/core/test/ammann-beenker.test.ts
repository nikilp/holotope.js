import { describe, expect, it } from 'vitest';
import {
  ammannBeenkerInflate,
  ammannBeenkerInflationFactors,
  ammannBeenkerPatch,
  ammannBeenkerRotate45,
  createAmmannBeenkerModelSet,
  sqrt2Ring,
  type AmmannBeenkerCoefficients,
  type ExactValue
} from '@holotope/core';

function exactVectorKey(values: readonly ExactValue[]): string {
  return values.map((value) => sqrt2Ring.key(value)).join('|');
}

describe('Ammann–Beenker model set', () => {
  it('has a nonsingular exact octagonal window on a finite lattice box', () => {
    const patch = createAmmannBeenkerModelSet().sample({
      coefficientRanges: Array.from({ length: 4 }, () => ({ min: -5, max: 5 }))
    });
    expect(patch.candidateCount).toBe(11 ** 4);
    expect(patch.boundaryCount).toBe(0);
    expect(patch.points.length).toBeGreaterThan(100);
  });

  it('is exactly closed under the 45-degree provenance rotation', () => {
    const model = createAmmannBeenkerModelSet();
    const patch = model.sample({
      coefficientRanges: Array.from({ length: 4 }, () => ({ min: -3, max: 3 }))
    });
    for (const point of patch.points) {
      let rotated = point.coefficients as AmmannBeenkerCoefficients;
      for (let turn = 0; turn < 8; turn++) rotated = ammannBeenkerRotate45(rotated);
      expect(rotated).toEqual(point.coefficients);

      const once = ammannBeenkerRotate45(point.coefficients as AmmannBeenkerCoefficients);
      const ambient = model.lattice.point(once);
      const internal = model.flat.projectPerpendicular(ambient);
      expect(model.window.classify(internal)).not.toBe('outside');
      const physical = model.flat.projectParallel(ambient).map((value) =>
        sqrt2Ring.toNumber(value) / 2
      );
      const [x, y] = point.parallel;
      expect(physical[0]).toBeCloseTo((x! - y!) / Math.SQRT2, 12);
      expect(physical[1]).toBeCloseTo((x! + y!) / Math.SQRT2, 12);
    }
  });

  it('inflates physically and contracts internally by conjugate silver means', () => {
    const model = createAmmannBeenkerModelSet();
    const patch = model.sample({
      coefficientRanges: Array.from({ length: 4 }, () => ({ min: -3, max: 3 }))
    });
    for (const point of patch.points) {
      const inflated = ammannBeenkerInflate(point.coefficients as AmmannBeenkerCoefficients);
      const ambient = model.lattice.point(inflated);
      const parallel = model.flat.projectParallel(ambient);
      const perpendicular = model.flat.projectPerpendicular(ambient);
      expect(exactVectorKey(parallel)).toBe(
        exactVectorKey(
          point.parallelExact.map((value) =>
            sqrt2Ring.mul(ammannBeenkerInflationFactors.parallel, value)
          )
        )
      );
      expect(exactVectorKey(perpendicular)).toBe(
        exactVectorKey(
          point.perpendicularExact.map((value) =>
            sqrt2Ring.mul(ammannBeenkerInflationFactors.perpendicular, value)
          )
        )
      );
      expect(model.window.classify(perpendicular)).toBe('inside');
    }
  });

  it('builds a unit-edge radial tiling patch with exact provenance', () => {
    const patch = ammannBeenkerPatch({ coefficientRadius: 6, physicalRadius: 7 });
    expect(patch.boundaryCount).toBe(0);
    expect(patch.points.length).toBeGreaterThan(100);
    const keys = new Set(patch.points.map((point) => point.coefficients.join(',')));
    expect(keys.size).toBe(patch.points.length);
    for (let e = 0; e < patch.edges.length; e += 2) {
      const left = patch.points[patch.edges[e]!]!.parallel;
      const right = patch.points[patch.edges[e + 1]!]!.parallel;
      expect(Math.hypot(left[0]! - right[0]!, left[1]! - right[1]!)).toBeCloseTo(1, 12);
    }
  });

  it('produces distinct nonsingular patterns from exact quarter-unit phason shifts', () => {
    const canonical = ammannBeenkerPatch({ coefficientRadius: 6, physicalRadius: 7 });
    const shifted = ammannBeenkerPatch({
      coefficientRadius: 6,
      physicalRadius: 7,
      phasonOffsetQuarters: [sqrt2Ring.one, sqrt2Ring.one]
    });
    expect(canonical.boundaryCount).toBe(0);
    expect(shifted.boundaryCount).toBe(0);
    const canonicalKeys = new Set(canonical.points.map((point) => point.coefficients.join(',')));
    const shiftedKeys = new Set(shifted.points.map((point) => point.coefficients.join(',')));
    expect(shiftedKeys).not.toEqual(canonicalKeys);
    expect([...shiftedKeys].some((key) => !canonicalKeys.has(key))).toBe(true);
  });
});
