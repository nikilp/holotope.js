import { describe, expect, it } from 'vitest';
import {
  CellComplex,
  HyperplaneSlice4,
  createHypercube,
  cuboidCellFacetN,
  sliceTetrahedra,
  tetrahedralizeCuboidCells,
  type CellGroup
} from '../src/index.js';

/**
 * Facets, and the two conventions callers cannot read off a type.
 *
 * Cold callers reconstruct facet recovery by hand and encode the tesseract's
 * accidents while doing it: a literal `±1` bound, or `Math.sign` of the
 * coordinate. Both survive `size: 2` centred on the origin and fail elsewhere,
 * so the cases that matter here are the rescaled and translated ones.
 */
function cubes(complex: CellComplex): CellGroup {
  return complex.cellsOfDim(complex.ambientDim - 1).find((g) => g.kind === 'cuboid')!;
}

function facetNames(complex: CellComplex): string[] {
  const group = cubes(complex);
  const count = group.indices.length / group.verticesPerCell;
  const names: string[] = [];
  for (let cell = 0; cell < count; cell += 1) {
    const facet = cuboidCellFacetN(complex, group, cell);
    names.push(facet === null ? 'none' : `${facet.axis}:${facet.sign > 0 ? '+1' : '-1'}`);
  }
  return names;
}

/** Emission order is structural, not incidental — see below. */
const TESSERACT_FACETS = [
  '3:-1', '3:+1', '2:-1', '2:+1', '1:-1', '1:+1', '0:-1', '0:+1'
];

describe('cuboidCellFacetN', () => {
  it('names every facet of a tesseract', () => {
    const tesseract = createHypercube({ dim: 4, size: 2, maxCellDimension: 3 });
    expect(facetNames(tesseract)).toEqual(TESSERACT_FACETS);
  });

  it('is independent of size', () => {
    // The trap: a recipe comparing against a literal +/-1 passes at size 2 and
    // names nothing at any other size.
    for (const size of [0.5, 1, 2, 3, 17.25]) {
      const complex = createHypercube({ dim: 4, size, maxCellDimension: 3 });
      expect(facetNames(complex), `size ${size}`).toEqual(TESSERACT_FACETS);
    }
  });

  it('is independent of position', () => {
    // The second trap: `Math.sign(coordinate)` reads the origin, not the body.
    // Translated clear of the origin, every coordinate shares one sign.
    const complex = createHypercube({ dim: 4, size: 2, maxCellDimension: 3 });
    const shifted = translated(complex, [10, 10, 10, 10]);
    expect(facetNames(shifted)).toEqual(TESSERACT_FACETS);
    const facet = cuboidCellFacetN(shifted, cubes(shifted), 0);
    expect(facet?.coordinate).toBeCloseTo(9, 12);
  });

  it('reports the coordinate in source units', () => {
    const complex = createHypercube({ dim: 4, size: 3, maxCellDimension: 3 });
    const facet = cuboidCellFacetN(complex, cubes(complex), 1);
    expect(facet).toEqual({ axis: 3, sign: 1, coordinate: 1.5 });
  });

  it('declines a group of the wrong dimension and an out-of-range cell', () => {
    const complex = createHypercube({ dim: 4, size: 2, maxCellDimension: 3 });
    const edges = complex.cellsOfDim(1)[0]!;
    expect(cuboidCellFacetN(complex, edges, 0)).toBeNull();
    const group = cubes(complex);
    expect(cuboidCellFacetN(complex, group, 8)).toBeNull();
    expect(cuboidCellFacetN(complex, group, -1)).toBeNull();
    expect(cuboidCellFacetN(complex, group, 1.5)).toBeNull();
  });
});

describe('facet emission order is a contract', () => {
  /**
   * `createHypercube` enumerates cubic cells over axis triples `a < b < c` in
   * lexicographic order, so the omitted axis — the facet normal — descends,
   * and within a triple the low side precedes the high one. That is a property
   * of the construction loop rather than an accident of one dimension, so it
   * is pinned rather than left for callers to rediscover.
   */
  it('descends by omitted axis, negative side first', () => {
    const tesseract = createHypercube({ dim: 4, size: 2, maxCellDimension: 3 });
    expect(facetNames(tesseract)).toEqual(TESSERACT_FACETS);
  });

  it('holds in five dimensions too', () => {
    const penteract = createHypercube({ dim: 5, size: 2, maxCellDimension: 4 });
    expect(facetNames(penteract)).toEqual([
      '4:-1', '4:+1', '3:-1', '3:+1', '2:-1', '2:+1', '1:-1', '1:+1', '0:-1', '0:+1'
    ]);
  });
});

describe('section emptiness at the body extent', () => {
  /**
   * The slicer snaps distances within `epsilon` to zero and counts them as
   * non-negative — a canonical tie-break, so on-plane vertices interpolate to
   * themselves and cells lying wholly in the hyperplane are suppressed rather
   * than emitted twice.
   *
   * Its visible consequence is that the two extremes disagree: at the maximum
   * some vertices fall below the plane and the cut emits, while at the minimum
   * nothing is below it and the cut is empty. This is pinned because it is
   * exactly the asymmetry a caller cannot justify from the outside and would
   * otherwise "fix" into symmetry.
   */
  function written(offset: number): number {
    const complex = tetrahedralizeCuboidCells(
      createHypercube({ dim: 4, size: 2, maxCellDimension: 3 })
    );
    const tets = complex
      .cellsOfDim(3)
      .find((g) => g.kind === 'simplex' && g.verticesPerCell === 4)!;
    const count = tets.indices.length / tets.verticesPerCell;
    const out = new Float32Array(count * 6 * 3);
    return sliceTetrahedra(
      complex.positions,
      tets.indices,
      HyperplaneSlice4.axisAligned(3, offset),
      out
    );
  }

  it('is empty at the minimum and non-empty at the maximum', () => {
    expect(written(-1)).toBe(0);
    expect(written(1)).toBeGreaterThan(0);
  });

  it('is empty strictly outside either extreme', () => {
    expect(written(-1.0000001)).toBe(0);
    expect(written(1.0000001)).toBe(0);
  });

  it('is non-empty strictly inside', () => {
    for (const offset of [-0.999, -0.5, 0, 0.5, 0.999]) {
      expect(written(offset), `offset ${offset}`).toBeGreaterThan(0);
    }
  });
});

/** Rebuilds a complex with every vertex translated; keeps groups as they are. */
function translated(source: CellComplex, offset: readonly number[]): CellComplex {
  const { ambientDim, vertexCount, positions } = source;
  const moved = new Float64Array(positions.length);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    for (let axis = 0; axis < ambientDim; axis += 1) {
      moved[vertex * ambientDim + axis] =
        positions[vertex * ambientDim + axis]! + offset[axis]!;
    }
  }
  return new CellComplex(ambientDim, moved, [...source.groups]);
}
