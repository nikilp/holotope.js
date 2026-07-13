import { describe, expect, it } from 'vitest';
import {
  classifyElserSloaneIcosian,
  createElserSloaneGermComplex,
  createElserSloaneModelSet,
  createElserSloaneWindow,
  e8IntegerSecondShell,
  e8IntegerVectorsThroughNorm,
  e8IntegerToIcosian,
  e8QuadraticNorm,
  elserSloaneGerm,
  elserSloaneGaloisProduct,
  elserSloaneDeflate,
  elserSloaneInflate,
  elserSloaneInflationMatrix,
  elserSloaneNormPatch,
  elserSloanePatch,
  elserSloaneSection,
  elserSloaneSectionEdges,
  elserSloaneWindowHalfspaces,
  elserSloaneWindowVertices,
  icosianE8Data,
  phiRing
} from '@holotope/core';

describe('Elser-Sloane exact germ', () => {
  it('derives the 720-vertex window and its 1,200 exact supporting facets', () => {
    const vertices = elserSloaneWindowVertices();
    const halfspaces = elserSloaneWindowHalfspaces();
    const window = createElserSloaneWindow();
    expect(vertices).toHaveLength(720);
    expect(halfspaces).toHaveLength(1200);
    expect(new Set(vertices.map((vertex) => phiRing.keyTuple(vertex))).size).toBe(720);
    expect(new Set(halfspaces.map(({ normal }) => phiRing.keyTuple(normal))).size).toBe(1200);
    expect(vertices.every((vertex) => window.classify(vertex) === 'boundary')).toBe(true);
  });

  it('enumerates the complete norm-4 E8 shell in the standard model', () => {
    const shell = e8IntegerSecondShell();
    expect(shell).toHaveLength(2160);
    expect(new Set(shell.map((vector) => vector.join(','))).size).toBe(2160);
    expect(shell.every((vector) => e8QuadraticNorm(e8IntegerToIcosian(vector)) === 4n)).toBe(true);
  });

  it('enumerates complete E8 norm balls without coordinate-box clipping', () => {
    const vectors = e8IntegerVectorsThroughNorm(6);
    const counts = new Map<bigint, number>();
    for (const vector of vectors) {
      const norm = e8QuadraticNorm(e8IntegerToIcosian(vector));
      counts.set(norm, (counts.get(norm) ?? 0) + 1);
    }
    expect(counts).toEqual(
      new Map<bigint, number>([
        [0n, 1],
        [2n, 240],
        [4n, 2160],
        [6n, 6720]
      ])
    );
  });

  it('builds the canonical germ from complete norm shells through norm four', () => {
    const patch = elserSloaneNormPatch({ maxE8Norm: 4 });
    expect(patch.candidateCount).toBe(2401);
    expect(patch.acceptedBeforePhysicalCrop).toBe(241);
    expect(patch.points).toHaveLength(241);
    expect(patch.boundaryCount).toBe(120);
    expect(elserSloaneSection(patch.points).length).toBeGreaterThan(1);
  });

  it(
    'accepts exactly 120 roots and 120 second-shell vectors',
    () => {
      const data = icosianE8Data();
      const acceptedRoots = data.roots.filter(
        (root) => classifyElserSloaneIcosian(root) !== 'outside'
      );
      const germ = elserSloaneGerm();
      expect(acceptedRoots).toHaveLength(120);
      expect(acceptedRoots).toEqual(data.roots.slice(0, 120));
      expect(germ.rootCount).toBe(120);
      expect(germ.secondShellCount).toBe(120);
      expect(germ.points).toHaveLength(240);
      expect(germ.edges.length / 2).toBe(1440);
      expect(createElserSloaneGermComplex().cellCount(1)).toBe(1440);
      expect(createElserSloaneGermComplex({ sourceShell: 'root' }).cellCount(1)).toBe(720);
      expect(createElserSloaneGermComplex({ sourceShell: 'second-shell' }).cellCount(1)).toBe(720);
      expect(
        germ.points
          .filter((point) => point.sourceShell === 'second-shell')
          .every((point) => e8QuadraticNorm(point.icosian) === 4n)
      ).toBe(true);
    },
    20_000
  );

  it('realizes inflation as an exact E8 coefficient automorphism', () => {
    const matrix = elserSloaneInflationMatrix;
    const squared = matrix.map((row, i) =>
      row.map((_, j) => row.reduce((sum, value, k) => sum + value * matrix[k]![j]!, 0n))
    );
    expect(squared).toEqual(
      matrix.map((row, i) => row.map((value, j) => value + (i === j ? 1n : 0n)))
    );

    const model = createElserSloaneModelSet();
    const patch = elserSloanePatch({ coefficientRadius: 1 });
    expect(patch.candidateCount).toBe(6561);
    expect(patch.points.length).toBeGreaterThan(1);
    for (const point of patch.points) {
      const inflated = elserSloaneInflate(point.coefficients);
      expect(elserSloaneDeflate(inflated)).toEqual(point.coefficients);
      const ambient = model.lattice.point(inflated);
      const parallel = model.flat.projectParallel(ambient);
      const perpendicular = model.flat.projectPerpendicular(ambient);
      expect(parallel).toEqual(point.parallelExact.map((value) => phiRing.mul(value, { a: 0n, b: 1n })));
      expect(perpendicular).toEqual(
        point.perpendicularExact.map((value) => phiRing.mul(value, { a: 1n, b: -1n }))
      );
      expect(model.window.classify(perpendicular)).not.toBe('outside');
    }
  });

  it('extracts the theorem-backed zero-coordinate section exactly', () => {
    const patch = elserSloanePatch({ coefficientRadius: 1 });
    const section = elserSloaneSection(patch.points);
    expect(section.length).toBeGreaterThan(1);
    expect(section.every((point) => phiRing.sign(point.parallelExact[3]!) === 0)).toBe(true);
    const keys = new Set(section.map((point) => point.parallelExact.map(phiRing.key).join('|')));
    for (const point of section) {
      const opposite = point.parallelExact.map(phiRing.neg);
      expect(keys.has(opposite.map(phiRing.key).join('|'))).toBe(true);
    }
    expect(elserSloaneSectionEdges(section).length).toBeGreaterThan(0);
  });

  it('keeps the physical/internal squared-norm product integral', () => {
    const points = elserSloaneNormPatch({ maxE8Norm: 8 }).points;
    for (let i = 1; i < Math.min(points.length, 80); i += 7) {
      expect(elserSloaneGaloisProduct(points[0]!, points[i]!)).toBeGreaterThan(0n);
    }
  });

  it('supports a globally regular exact eleventh-unit phason shift', () => {
    const phason = [
      { a: -2n, b: -2n },
      { a: -2n, b: -2n },
      { a: -2n, b: 1n },
      { a: 0n, b: -1n }
    ] as const;
    for (const { normal } of elserSloaneWindowHalfspaces()) {
      let pairing = phiRing.zero;
      for (let i = 0; i < 4; i++) {
        pairing = phiRing.add(pairing, phiRing.mul(normal[i]!, phason[i]!));
      }
      expect(pairing.a % 11n === 0n && pairing.b % 11n === 0n).toBe(false);
    }
    const shifted = elserSloanePatch({
      coefficientRadius: 1,
      phasonOffsetElevenths: phason
    });
    expect(shifted.boundaryCount).toBe(0);
    const canonical = elserSloanePatch({ coefficientRadius: 1 });
    const shiftedKeys = new Set(shifted.points.map((point) => point.coefficients.join(',')));
    const canonicalKeys = new Set(canonical.points.map((point) => point.coefficients.join(',')));
    expect(shiftedKeys).not.toEqual(canonicalKeys);
  });
});
