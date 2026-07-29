import { describe, expect, it } from 'vitest';
import { VecN } from '../src/math/vecn.js';
import { CellComplex } from '../src/geometry/cell-complex.js';
import { createHypercube } from '../src/polytope/hypercube.js';
import { simplexizeCuboidGroupN } from '../src/geometry/tetrahedralize.js';
import { HyperplaneSlice4, sliceTetrahedraAmbient } from '../src/projection/slice.js';
import type { SliceVertexProvenanceBuffers } from '../src/projection/slice.js';
import { PerspectiveProjection } from '../src/projection/perspective.js';
import {
  affineSliceChartMapRecipe4,
  createRepresentationLineageN,
  projectionMapRecipeN
} from '../src/representation/map.js';
import { evaluateRepresentationLineagePointN } from '../src/representation/lineage-evaluation.js';
import { representationMapCapabilitiesN } from '../src/representation/map-capabilities.js';
import {
  createSourceCellLookupN,
  createSourceCellReferenceN
} from '../src/representation/source-reference.js';
import {
  createSourceEdgeCoordinateN,
  evaluateSourceEdgeCoordinateN
} from '../src/representation/source-edge-coordinate.js';

/**
 * A provenance round-trip driven from outside `representation/`'s own tests.
 *
 * The claim under test is the library's central one: a visible result can be
 * traced back to the source it was derived from. Here the visible result is a
 * vertex of an exact hyperplane section of a tesseract, and the source is the
 * 1-cell it was interpolated along.
 *
 * Every recovery below is checked against an oracle computed from the raw
 * position buffer, so nothing is verified by asking the same code twice.
 */

const SIZE = 2;
/** Deliberately irrational-ish so the cut misses vertices and axis planes. */
const SLICE_OFFSET = 0.3137;

interface Fixture {
  readonly positions: Float64Array;
  readonly edgeIndices: Uint32Array;
  readonly tets: Uint32Array;
  readonly slice: HyperplaneSlice4;
  readonly vertexCount: number;
  readonly ambient: Float64Array;
  readonly provenance: SliceVertexProvenanceBuffers;
  readonly emitted: number;
  readonly complex: ReturnType<typeof createHypercube>;
  readonly edgeGroup: { dim: number; verticesPerCell: number; indices: Uint32Array };
}

function buildFixture(): Fixture {
  const complex = createHypercube({ dim: 4, size: SIZE });
  const positions = complex.positions;
  const vertexCount = positions.length / 4;

  const edgeGroup = complex.groups.find(
    (group) => group.dim === 1 && group.verticesPerCell === 2
  )!;
  const cuboidGroup = complex.groups.find(
    (group) => group.dim === 3 && group.kind === 'cuboid' && group.verticesPerCell === 8
  )!;

  // The provenance-preserving simplexization, not the `tetrahedralizeCuboidCells`
  // wrapper: the wrapper keeps only `.simplexGroup` and drops the parent-cell map.
  const simplexization = simplexizeCuboidGroupN(cuboidGroup);
  const tets = simplexization.simplexGroup.indices;

  const slice = new HyperplaneSlice4({ normal: [0, 0, 0, 1], offset: SLICE_OFFSET });

  // Upper bound: marching tetrahedra emits at most two triangles per tet.
  const ambient = new Float64Array(tets.length / 4 * 2 * 3 * 4);
  const provenance: SliceVertexProvenanceBuffers = {
    edgeVertices: new Uint32Array((ambient.length / 4) * 2),
    edgeParameters: new Float64Array(ambient.length / 4)
  };
  const emitted = sliceTetrahedraAmbient(
    positions,
    tets,
    slice,
    ambient,
    1e-9,
    undefined,
    provenance
  );

  return {
    positions,
    edgeIndices: edgeGroup.indices,
    tets,
    slice,
    vertexCount,
    ambient,
    provenance,
    emitted,
    complex,
    edgeGroup
  };
}

/** Oracle: the source point, computed straight from the position buffer. */
function lerpFromRawPositions(
  positions: Float64Array,
  from: number,
  to: number,
  t: number
): number[] {
  const point: number[] = [];
  for (let axis = 0; axis < 4; axis++) {
    const a = positions[from * 4 + axis]!;
    const b = positions[to * 4 + axis]!;
    point.push(a + t * (b - a));
  }
  return point;
}

describe('a section vertex round-trips to the source cell it was interpolated on', () => {
  it('recovers the source edge and reconstructs the point, checked against a raw-buffer oracle', () => {
    const fixture = buildFixture();
    const table = createSourceCellLookupN(fixture.edgeGroup as never);

    let checked = 0;
    let interiorParameters = 0;

    for (let vertex = 0; vertex < fixture.emitted; vertex++) {
      const from = fixture.provenance.edgeVertices[vertex * 2]!;
      const to = fixture.provenance.edgeVertices[vertex * 2 + 1]!;
      const parameter = fixture.provenance.edgeParameters[vertex]!;
      const entry = table.find([from, to]);
      // Kuhn diagonals are not 1-cells; those are covered by their own test.
      if (entry.kind !== 'source-cell-lookup-match') continue;

      // Recover through `representation/`: a persistent reference, then an
      // oriented coordinate on it, then the point.
      const reference = createSourceCellReferenceN(
        fixture.complex,
        fixture.edgeGroup as never,
        entry.cellIndex
      );
      // The stored orientation need not match the slice's reported direction.
      const oriented = entry.orientation === 'reversed'
        ? 1 - parameter
        : parameter;
      const coordinate = createSourceEdgeCoordinateN(reference, oriented);
      const recovered = evaluateSourceEdgeCoordinateN(coordinate);

      // Oracle: same point, computed from the raw buffer without touching
      // representation/ at all.
      const oracle = lerpFromRawPositions(fixture.positions, from, to, parameter);
      for (let axis = 0; axis < 4; axis++) {
        expect(recovered.data[axis]!).toBeCloseTo(oracle[axis]!, 12);
      }

      // The recovered point must also be the emitted section vertex.
      for (let axis = 0; axis < 4; axis++) {
        expect(recovered.data[axis]!).toBeCloseTo(
          fixture.ambient[vertex * 4 + axis]!,
          12
        );
      }

      // ...and must lie on the cutting hyperplane.
      expect(recovered.data[3]!).toBeCloseTo(SLICE_OFFSET, 12);

      checked++;
      if (parameter > 1e-6 && parameter < 1 - 1e-6) interiorParameters++;
    }

    // Liveness first. Every assertion above is vacuous if the loop never ran,
    // and a round-trip through a parameter of 0 or 1 only recovers a vertex.
    expect(fixture.emitted).toBeGreaterThan(0);
    expect(checked).toBeGreaterThan(0);
    expect(interiorParameters).toBeGreaterThan(0);
  });

  /**
   * The honest limit of the recovery.
   *
   * A Kuhn simplexization cuts each cuboid along its main diagonal, so a tet
   * edge is often a diagonal of the source cell rather than one of its 1-cells.
   * A section vertex on such an edge has no source *cell* to name: the complex
   * holds exactly 32 edges and the diagonal is not among them.
   */
  it('reports section vertices whose source is not a cell of the complex', () => {
    const fixture = buildFixture();
    const table = createSourceCellLookupN(fixture.edgeGroup as never);

    let onCells = 0;
    let onDiagonals = 0;
    for (let vertex = 0; vertex < fixture.emitted; vertex++) {
      const from = fixture.provenance.edgeVertices[vertex * 2]!;
      const to = fixture.provenance.edgeVertices[vertex * 2 + 1]!;
      if (table.find([from, to]).kind === 'source-cell-lookup-match') onCells++;
      else onDiagonals++;
    }

    expect(fixture.emitted).toBeGreaterThan(0);
    expect(onCells).toBeGreaterThan(0);
    // The point of the test: most of a section is not traceable to a cell at
    // all. For this tesseract it is 108 of 144 — three quarters — and a caller
    // has to be told which, rather than left to assume every vertex resolves.
    expect(onDiagonals).toBeGreaterThan(onCells);
    expect(onCells + onDiagonals).toBe(fixture.emitted);
  });

  /**
   * Both producers happen to emit ascending vertex pairs, so a caller who
   * ignores orientation gets away with it here.
   *
   * This was written expecting the opposite. Pinning it because the alignment
   * is load-bearing for any caller bridging slice provenance to a source
   * reference, and nothing states it: neither the slice's provenance buffers
   * nor `CellGroup.indices` documents an ordering, so the agreement is a
   * property of these two implementations rather than a contract.
   */
  it('finds both producers emitting ascending vertex pairs', () => {
    const fixture = buildFixture();

    let ascendingStored = 0;
    const edgeCells = fixture.edgeIndices.length / 2;
    for (let cell = 0; cell < edgeCells; cell++) {
      if (fixture.edgeIndices[cell * 2]! < fixture.edgeIndices[cell * 2 + 1]!) {
        ascendingStored++;
      }
    }

    let ascendingReported = 0;
    for (let vertex = 0; vertex < fixture.emitted; vertex++) {
      if (
        fixture.provenance.edgeVertices[vertex * 2]! <
        fixture.provenance.edgeVertices[vertex * 2 + 1]!
      ) {
        ascendingReported++;
      }
    }

    expect(edgeCells).toBeGreaterThan(0);
    expect(fixture.emitted).toBeGreaterThan(0);
    expect(ascendingStored).toBe(edgeCells);
    expect(ascendingReported).toBe(fixture.emitted);
  });

  /**
   * The hazard the alignment above is hiding.
   *
   * A complex whose edge group stores a pair descending is entirely legal —
   * nothing validates or normalises the order. Against such a complex the same
   * caller code builds the mirrored coordinate, and the mirrored point still
   * lies on the correct edge. Only the hyperplane residual catches it.
   */
  it('shows a reversed edge group silently mirrors the recovery', () => {
    const fixture = buildFixture();
    const table = createSourceCellLookupN(fixture.edgeGroup as never);

    // Same complex, one edge group stored the other way round.
    const reversed = new CellComplex(
      4,
      fixture.positions,
      [
        {
          dim: 1,
          verticesPerCell: 2,
          kind: 'cuboid' as const,
          indices: (() => {
            const flipped = new Uint32Array(fixture.edgeIndices.length);
            for (let cell = 0; cell * 2 < flipped.length; cell++) {
              flipped[cell * 2] = fixture.edgeIndices[cell * 2 + 1]!;
              flipped[cell * 2 + 1] = fixture.edgeIndices[cell * 2]!;
            }
            return flipped;
          })()
        }
      ]
    );

    let mirrored = 0;
    let stillOnEdge = 0;
    let offPlane = 0;

    for (let vertex = 0; vertex < fixture.emitted; vertex++) {
      const from = fixture.provenance.edgeVertices[vertex * 2]!;
      const to = fixture.provenance.edgeVertices[vertex * 2 + 1]!;
      const parameter = fixture.provenance.edgeParameters[vertex]!;
      if (parameter <= 1e-6 || parameter >= 1 - 1e-6) continue;
      const entry = table.find([from, to]);
      if (entry.kind !== 'source-cell-lookup-match') continue;

      const reference = createSourceCellReferenceN(
        reversed,
        reversed.groups[0]!,
        entry.cellIndex
      );
      // The naive bridge: pass the slice's parameter straight through.
      const wrong = evaluateSourceEdgeCoordinateN(
        createSourceEdgeCoordinateN(reference, parameter)
      );
      mirrored++;

      // Still collinear with the source edge, so an "is it on the edge?" check
      // cannot detect the mistake.
      const a = lerpFromRawPositions(fixture.positions, from, to, 0);
      const b = lerpFromRawPositions(fixture.positions, from, to, 1);
      const along = wrong.data.map((value, axis) => value - a[axis]!);
      const edge = b.map((value, axis) => value - a[axis]!);
      const scale = edge.reduce((sum, value, axis) => sum + value * along[axis]!, 0) /
        edge.reduce((sum, value) => sum + value * value, 0);
      const residual = Math.hypot(
        ...along.map((value, axis) => value - scale * edge[axis]!)
      );
      if (residual < 1e-12) stillOnEdge++;

      // But it has left the cutting hyperplane.
      if (Math.abs(wrong.data[3]! - SLICE_OFFSET) > 1e-9) offPlane++;
    }

    expect(mirrored).toBeGreaterThan(0);
    expect(stillOnEdge).toBe(mirrored);
    expect(offPlane).toBe(mirrored);
  });
});

describe('the round-trip starting where a caller actually starts: a chart point', () => {
  /**
   * The commission's shape: begin with three numbers in the section's own
   * display frame and end at a source cell.
   *
   * The lift is `HyperplaneSlice4.embedPoint`. It is worth naming explicitly
   * because nothing in `representation/` mentions it: the capability table calls
   * the ability `pointLift`, the method is called `embedPoint`, and they live in
   * different modules.
   */
  it('lifts a chart point with embedPoint and lands on the source cell', () => {
    const fixture = buildFixture();
    const lineage = createRepresentationLineageN(4, [
      affineSliceChartMapRecipe4(fixture.slice)
    ]);
    const table = createSourceCellLookupN(fixture.edgeGroup as never);

    let roundTripped = 0;
    for (let vertex = 0; vertex < fixture.emitted; vertex++) {
      const from = fixture.provenance.edgeVertices[vertex * 2]!;
      const to = fixture.provenance.edgeVertices[vertex * 2 + 1]!;
      const parameter = fixture.provenance.edgeParameters[vertex]!;
      const entry = table.find([from, to]);
      if (entry.kind !== 'source-cell-lookup-match') continue;

      const ambient = new VecN([
        fixture.ambient[vertex * 4]!,
        fixture.ambient[vertex * 4 + 1]!,
        fixture.ambient[vertex * 4 + 2]!,
        fixture.ambient[vertex * 4 + 3]!
      ]);

      // Forward to the chart — this is the only thing a caller is handed.
      const forward = evaluateRepresentationLineagePointN(lineage, ambient);
      expect(forward.kind).toBe('exact');
      if (forward.kind !== 'exact') continue;
      const chart = forward.point;
      expect(chart.dim).toBe(3);

      // Back to R4 through the slice's own lift.
      const lifted = fixture.slice.embedPoint(chart.data);
      for (let axis = 0; axis < 4; axis++) {
        expect(lifted[axis]!).toBeCloseTo(ambient.data[axis]!, 12);
      }

      // And on to the source cell, checked against the raw-buffer oracle.
      const oriented = entry.orientation === 'reversed'
        ? 1 - parameter
        : parameter;
      const reference = createSourceCellReferenceN(
        fixture.complex,
        fixture.edgeGroup as never,
        entry.cellIndex
      );
      const recovered = evaluateSourceEdgeCoordinateN(
        createSourceEdgeCoordinateN(reference, oriented)
      );
      const oracle = lerpFromRawPositions(fixture.positions, from, to, parameter);
      for (let axis = 0; axis < 4; axis++) {
        expect(recovered.data[axis]!).toBeCloseTo(oracle[axis]!, 12);
        expect(recovered.data[axis]!).toBeCloseTo(lifted[axis]!, 12);
      }
      roundTripped++;
    }

    expect(fixture.emitted).toBeGreaterThan(0);
    expect(roundTripped).toBeGreaterThan(0);
  });
});

describe('the forward evaluator agrees with the recovery', () => {
  /**
   * `evaluateRepresentationLineagePointN` runs source to representation, so it
   * is a genuine cross-check on a recovery that ran the other way — it shares
   * no code with `source-edge-coordinate`.
   */
  it('pushes each recovered source point back to the section chart', () => {
    const fixture = buildFixture();
    const lineage = createRepresentationLineageN(4, [
      affineSliceChartMapRecipe4(fixture.slice)
    ]);
    const table = createSourceCellLookupN(fixture.edgeGroup as never);

    let agreed = 0;
    for (let vertex = 0; vertex < fixture.emitted; vertex++) {
      const from = fixture.provenance.edgeVertices[vertex * 2]!;
      const to = fixture.provenance.edgeVertices[vertex * 2 + 1]!;
      const parameter = fixture.provenance.edgeParameters[vertex]!;
      const entry = table.find([from, to]);
      if (entry.kind !== 'source-cell-lookup-match') continue;

      const oriented = entry.orientation === 'reversed'
        ? 1 - parameter
        : parameter;
      const reference = createSourceCellReferenceN(
        fixture.complex,
        fixture.edgeGroup as never,
        entry.cellIndex
      );
      const recovered = evaluateSourceEdgeCoordinateN(
        createSourceEdgeCoordinateN(reference, oriented)
      );

      const forward = evaluateRepresentationLineagePointN(lineage, recovered);
      expect(forward.kind).toBe('exact');
      if (forward.kind !== 'exact') continue;
      expect(forward.point.dim).toBe(3);
      agreed++;
    }
    expect(agreed).toBeGreaterThan(0);
  });

  /**
   * What the capability table says, asserted rather than paraphrased. This is
   * the answer to "what can the projection's inverse be": for a coordinate
   * projection it is not a point at all.
   */
  it('declares that a slice chart lifts exactly and a projection does not', () => {
    const slice = new HyperplaneSlice4({ normal: [0, 0, 0, 1], offset: SLICE_OFFSET });
    const chart = representationMapCapabilitiesN(affineSliceChartMapRecipe4(slice));
    expect(chart.pointLift).toBe('exact');
    expect(chart.sourceIdentity).toBe('preserved');

    const perspective = projectionMapRecipeN(
      new PerspectiveProjection({ fromDim: 4, viewDistance: 4 })
    );
    const projected = representationMapCapabilitiesN(perspective);
    expect(projected.inverseFibre).toBe('exact');
    expect(projected.pointLift).not.toBe('exact');
  });
});

describe('source distance and representation distance disagree', () => {
  /**
   * The thesis as a number.
   *
   * Two points at a fixed separation in the R4 source are projected into R3.
   * Perspective scales by the hidden coordinate, so the distance a viewer
   * measures off the picture is not the distance the source holds — and the
   * source figure is the authoritative one.
   */
  it('measures the same pair in both spaces and reports the gap', () => {
    const projection = new PerspectiveProjection({ fromDim: 4, viewDistance: 4 });

    // Same separation in x, different hidden coordinate w.
    const a = new VecN([0.5, 0, 0, 0.4]);
    const b = new VecN([1.5, 0, 0, 0.4]);
    const sourceDistance = Math.hypot(
      ...a.data.map((value, axis) => value - b.data[axis]!)
    );

    const pa = projection.projectPoint(a.data);
    const pb = projection.projectPoint(b.data);
    const representationDistance = Math.hypot(
      pa[0] - pb[0],
      pa[1] - pb[1],
      pa[2] - pb[2]
    );

    expect(sourceDistance).toBeCloseTo(1, 12);
    // Liveness: both figures are real measurements, not defaults.
    expect(representationDistance).toBeGreaterThan(0);
    // The disagreement is the point.
    expect(Math.abs(sourceDistance - representationDistance)).toBeGreaterThan(1e-3);

    // And it grows with the hidden coordinate: the same source separation
    // measured deeper in w reads differently again.
    const deep = new VecN([0.5, 0, 0, 1.2]);
    const deeper = new VecN([1.5, 0, 0, 1.2]);
    const pd = projection.projectPoint(deep.data);
    const pdd = projection.projectPoint(deeper.data);
    const deepDistance = Math.hypot(pd[0] - pdd[0], pd[1] - pdd[1], pd[2] - pdd[2]);

    expect(Math.abs(deepDistance - sourceDistance)).toBeGreaterThan(
      Math.abs(representationDistance - sourceDistance)
    );
  });
});
