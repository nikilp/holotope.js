import { describe, expect, it } from 'vitest';
import {
  aknEdgeLength,
  aknPatch,
  aknRotate3,
  aknRotate5,
  aknWindowHalfspaces,
  createAKNModelSet,
  phiRing,
  type AKNCoefficients
} from '@holotope/core';

describe('Ammann–Kramer–Neri model set', () => {
  it('derives the rhombic triacontahedron as 30 exact zonotope facets', () => {
    const halfspaces = aknWindowHalfspaces();
    expect(halfspaces).toHaveLength(30);
    expect(
      new Set(halfspaces.map((halfspace) => halfspace.normal.map((v) => phiRing.key(v)).join('|')))
        .size
    ).toBe(30);
    const model = createAKNModelSet();
    expect(model.window.halfspaces).toHaveLength(30);
    expect(model.window.classify([phiRing.zero, phiRing.zero, phiRing.zero])).toBe('inside');
  });

  it('reports the singular boundary of the fully symmetric centered cut', () => {
    const patch = createAKNModelSet().sample({
      coefficientRanges: Array.from({ length: 6 }, () => ({ min: -2, max: 2 }))
    });
    expect(patch.candidateCount).toBe(5 ** 6);
    expect(patch.boundaryCount).toBeGreaterThan(0);
    expect(patch.points.length).toBeGreaterThan(100);
  });

  it('closes exactly under its threefold and fivefold provenance rotations', () => {
    const model = createAKNModelSet();
    const patch = model.sample({
      coefficientRanges: Array.from({ length: 6 }, () => ({ min: -2, max: 2 }))
    });
    for (const point of patch.points) {
      let three = point.coefficients as AKNCoefficients;
      for (let turn = 0; turn < 3; turn++) three = aknRotate3(three);
      expect(three).toEqual(point.coefficients);
      let five = point.coefficients as AKNCoefficients;
      for (let turn = 0; turn < 5; turn++) five = aknRotate5(five);
      expect(five).toEqual(point.coefficients);

      for (const rotated of [
        aknRotate3(point.coefficients as AKNCoefficients),
        aknRotate5(point.coefficients as AKNCoefficients)
      ]) {
        const internal = model.flat.projectPerpendicular(model.lattice.point(rotated));
        expect(model.window.classify(internal)).not.toBe('outside');
      }
    }
  });

  it('builds a radial 3D patch whose provenance edges share one length', () => {
    const patch = aknPatch({ coefficientRadius: 2, physicalRadius: 5.5 });
    expect(patch.boundaryCount).toBeGreaterThan(0);
    expect(patch.points.length).toBeGreaterThan(80);
    for (let e = 0; e < patch.edges.length; e += 2) {
      const left = patch.points[patch.edges[e]!]!.parallel;
      const right = patch.points[patch.edges[e + 1]!]!.parallel;
      expect(
        Math.hypot(
          left[0]! - right[0]!,
          left[1]! - right[1]!,
          left[2]! - right[2]!
        )
      ).toBeCloseTo(aknEdgeLength, 12);
    }
  });

  it('produces a globally regular exact phason shift', () => {
    const shifted = aknPatch({
      coefficientRadius: 2,
      physicalRadius: 5.5,
      phasonOffsetSevenths: [phiRing.one, phiRing.one, { a: 2n, b: 0n }]
    });
    expect(shifted.boundaryCount).toBe(0);
    const canonical = aknPatch({ coefficientRadius: 2, physicalRadius: 5.5 });
    const shiftedKeys = new Set(shifted.points.map((point) => point.coefficients.join(',')));
    const canonicalKeys = new Set(canonical.points.map((point) => point.coefficients.join(',')));
    expect(shiftedKeys).not.toEqual(canonicalKeys);
  });
});
