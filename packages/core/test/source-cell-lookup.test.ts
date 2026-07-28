import {
  createHypercube,
  createSourceCellLookupN,
  createSourceCellReferenceN,
  createSourceEdgeCoordinateN,
  evaluateSourceEdgeCoordinateN,
  findSourceCellByVerticesN,
  tetrahedralizeCuboidCells,
  HyperplaneSlice4,
  sliceTetrahedra
} from '@holotope/core';
import { describe, expect, it } from 'vitest';

/**
 * The seam between the module that produces provenance and the one that models
 * it.
 *
 * `sliceTetrahedra` reports a section vertex as a pair of source vertices plus
 * a parameter; `createSourceCellReferenceN` needs a cell ordinal. Nothing
 * bridged the two, so the first outside caller wrote the scan by hand — and so
 * would every caller after them, each re-deciding the orientation question
 * without being told there was one.
 */

function tesseract() {
  const complex = tetrahedralizeCuboidCells(createHypercube({ dim: 4, size: 2 }));
  const edges = complex.cellsOfDim(1)[0]!;
  const tets = complex.groups.find((group) => group.dim === 3 && group.kind === 'simplex')!;
  return { complex, edges, tets };
}

describe('source cell lookup', () => {
  it('resolves a stored edge to its own ordinal, in either query order', () => {
    const { edges } = tesseract();
    const index = createSourceCellLookupN(edges);
    const cellCount = edges.indices.length / edges.verticesPerCell;

    let aligned = 0;
    let reversed = 0;
    for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
      const from = edges.indices[cellIndex * 2]!;
      const to = edges.indices[cellIndex * 2 + 1]!;

      const forward = index.find([from, to]);
      expect(forward.kind).toBe('source-cell-lookup-match');
      if (forward.kind !== 'source-cell-lookup-match') continue;
      expect(forward.cellIndex).toBe(cellIndex);
      expect(forward.orientation).toBe('aligned');
      aligned++;

      // The same edge asked for backwards is the same cell, reported reversed
      // rather than missed — which is the whole point of the seam.
      const backward = index.find([to, from]);
      expect(backward.kind).toBe('source-cell-lookup-match');
      if (backward.kind !== 'source-cell-lookup-match') continue;
      expect(backward.cellIndex).toBe(cellIndex);
      expect(backward.orientation).toBe('reversed');
      reversed++;
    }

    // liveness: 32 real edges resolved in both directions; an empty group would
    // satisfy every assertion above by never entering the loop.
    expect(aligned).toBe(32);
    expect(reversed).toBe(32);
  });

  it('reports a Kuhn diagonal as not-a-cell rather than absent', () => {
    const { complex, edges, tets } = tesseract();
    const index = createSourceCellLookupN(edges);

    // Every distinct vertex pair spanned by the tetrahedra, split by whether it
    // is a 1-cell of the complex.
    const seen = new Set<string>();
    let onCells = 0;
    let onDiagonals = 0;
    const tetCount = tets.indices.length / 4;
    for (let tet = 0; tet < tetCount; tet++) {
      for (let a = 0; a < 4; a++) {
        for (let b = a + 1; b < 4; b++) {
          const from = tets.indices[tet * 4 + a]!;
          const to = tets.indices[tet * 4 + b]!;
          const key = `${Math.min(from, to)},${Math.max(from, to)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const found = index.find([from, to]);
          if (found.kind === 'source-cell-lookup-match') onCells++;
          else {
            expect(found.reason).toBe('not-a-cell');
            onDiagonals++;
          }
        }
      }
    }

    // 32 tesseract edges and 32 simplexization diagonals: most tetrahedron
    // edges are not cells of anything, which is why a section resolves only in
    // part and why the miss needs a reason rather than an absent lookup.
    expect(onCells).toBe(32);
    expect(onDiagonals).toBe(32);
    expect(seen.size).toBe(64);
  });

  it('rejects a tuple that could not name a cell of this group', () => {
    const { edges } = tesseract();
    const miss = findSourceCellByVerticesN(edges, [0, 1, 2]);
    expect(miss).toEqual({ kind: 'source-cell-lookup-miss', reason: 'arity-mismatch' });
  });

  it('carries a section vertex back to the point it was interpolated from', () => {
    const { complex, edges, tets } = tesseract();
    const index = createSourceCellLookupN(edges);
    const slice = HyperplaneSlice4.axisAligned(3, 0.3137);

    const tetCount = tets.indices.length / 4;
    const chart = new Float32Array(tetCount * 18);
    const edgeVertices = new Uint32Array(tetCount * 12);
    const edgeParameters = new Float64Array(tetCount * 6);
    const emitted = sliceTetrahedra(
      complex.positions,
      tets.indices,
      slice,
      chart,
      1e-9,
      undefined,
      { edgeVertices, edgeParameters }
    );

    let resolved = 0;
    let onDiagonal = 0;
    for (let vertex = 0; vertex < emitted; vertex++) {
      const queriedFrom = edgeVertices[vertex * 2]!;
      const queriedTo = edgeVertices[vertex * 2 + 1]!;
      const t = edgeParameters[vertex]!;

      const found = index.find([queriedFrom, queriedTo]);
      if (found.kind !== 'source-cell-lookup-match') {
        // A Kuhn diagonal: correct, and the majority of a section's vertices.
        expect(found.reason).toBe('not-a-cell');
        onDiagonal++;
        continue;
      }

      const reference = createSourceCellReferenceN(complex, edges, found.cellIndex);
      const recovered = evaluateSourceEdgeCoordinateN(
        createSourceEdgeCoordinateN(
          reference,
          found.orientation === 'reversed' ? 1 - t : t
        )
      );

      // Independent oracle: interpolate straight from the position buffer along
      // the direction the slice reported, touching no representation/ code.
      const from = queriedFrom * 4;
      const to = queriedTo * 4;
      for (let axis = 0; axis < 4; axis++) {
        const expected =
          complex.positions[from + axis]! * (1 - t) + complex.positions[to + axis]! * t;
        expect(recovered.data[axis]).toBeCloseTo(expected, 12);
      }
      // And it lies on the cutting hyperplane, as a section vertex must.
      expect(recovered.data[3]).toBeCloseTo(0.3137, 12);
      resolved++;
    }

    // liveness: the section really was cut, and really did resolve in part. A
    // slice that emitted nothing — or one whose provenance buffers were never
    // written, which is how this test failed first — satisfies every assertion
    // above without executing one of them.
    expect(emitted).toBeGreaterThan(0);
    expect(resolved).toBeGreaterThan(0);
    // The split the provenance exercise measured: most of a section has no
    // cell-level source, so a resolver that silently skips misses is reporting
    // a quarter of the truth.
    expect(onDiagonal).toBeGreaterThan(resolved);
  });

  it('shows why the orientation has to be reported and not assumed', () => {
    const { complex, edges } = tesseract();
    const index = createSourceCellLookupN(edges);
    const from = edges.indices[0]!;
    const to = edges.indices[1]!;
    const t = 0.25;

    const found = index.find([to, from]); // queried against the stored order
    expect(found.kind).toBe('source-cell-lookup-match');
    if (found.kind !== 'source-cell-lookup-match') return;
    expect(found.orientation).toBe('reversed');

    const reference = createSourceCellReferenceN(complex, edges, found.cellIndex);
    const corrected = evaluateSourceEdgeCoordinateN(
      createSourceEdgeCoordinateN(reference, 1 - t)
    );
    const naive = evaluateSourceEdgeCoordinateN(createSourceEdgeCoordinateN(reference, t));

    // What a caller who ignored the orientation would get: a point still
    // exactly on the correct edge, so an "is it on the edge?" check passes,
    // and simply the wrong point on it. That is the silent failure the typed
    // orientation exists to make loud.
    // `t` is measured along the *queried* direction, which is `to → from`.
    const start = to * 4;
    const end = from * 4;
    for (let axis = 0; axis < 4; axis++) {
      const wanted =
        complex.positions[start + axis]! * (1 - t) + complex.positions[end + axis]! * t;
      expect(corrected.data[axis]).toBeCloseTo(wanted, 12);
    }
    let separation = 0;
    for (let axis = 0; axis < 4; axis++) {
      separation += (corrected.data[axis]! - naive.data[axis]!) ** 2;
    }
    expect(Math.sqrt(separation)).toBeGreaterThan(0.5);
  });
});
