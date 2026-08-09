import { describe, expect, it } from 'vitest';
import {
  CellComplex,
  HyperplaneSlice4,
  HyperplaneSliceN,
  VecN,
  sectionSimplexGroupN,
  sliceTetrahedraAmbient,
  type CellGroup,
  type SectionSimplexGroupNResultN
} from '../src/index.js';

/**
 * The dimension-generic section, against analytic answers and against the R4
 * path it generalizes.
 *
 * Liveness comes before agreement everywhere: a section that emitted nothing
 * would satisfy every "all emitted points lie on the plane" assertion while
 * proving nothing, so each test first shows that live cells were produced.
 */

function simplexComplex(ambientDim: number, points: readonly number[][]): {
  complex: CellComplex; group: CellGroup;
} {
  const positions = Float64Array.from(points.flat());
  const dim = points.length - 1;
  const group: CellGroup = {
    dim,
    verticesPerCell: points.length,
    kind: 'simplex',
    indices: Uint32Array.from(points.map((_unused, index) => index))
  };
  return { complex: new CellComplex(ambientDim, positions, [group]), group };
}

/** Reconstructs one output vertex from its ancestry weights. */
function reconstruct(
  section: SectionSimplexGroupNResultN,
  source: Float64Array,
  ambientDim: number,
  vertex: number
): number[] {
  const out = new Array<number>(ambientDim).fill(0);
  for (let at = section.lineage.offsets[vertex]!; at < section.lineage.offsets[vertex + 1]!; at++) {
    const ancestor = section.lineage.sourceVertices[at]!;
    const weight = section.lineage.weights[at]!;
    for (let c = 0; c < ambientDim; c++) {
      out[c]! += weight * source[ancestor * ambientDim + c]!;
    }
  }
  return out;
}

describe('sectionSimplexGroupN: analytic sections across R2..R7', () => {
  it('cuts a k-simplex into (k-1)-simplices on the requested hyperplane', () => {
    for (const ambientDim of [2, 3, 4, 5, 6, 7]) {
      // A simplex spanning the hidden axis from -1 to +1: the section is the
      // standard cut through its interior.
      const points: number[][] = [];
      const below = new Array<number>(ambientDim).fill(0);
      below[ambientDim - 1] = -1;
      points.push(below);
      for (let axis = 0; axis < ambientDim - 1; axis++) {
        const above = new Array<number>(ambientDim).fill(0);
        above[axis] = 2;
        above[ambientDim - 1] = 1;
        points.push(above);
      }
      const { complex, group } = simplexComplex(ambientDim, points);
      const slice = HyperplaneSliceN.axisAligned(ambientDim, ambientDim - 1, 0);
      const section = sectionSimplexGroupN({ complex, group, slice });

      // Liveness, then shape.
      expect(section.cellCount, `dim ${ambientDim} cells`).toBeGreaterThan(0);
      expect(section.diagnostics.sectionedCells).toBe(1);
      expect(section.cellDim).toBe(group.dim - 1);
      expect(section.verticesPerCell).toBe(group.dim);
      expect(section.chartDim).toBe(ambientDim - 1);

      // Every emitted ambient point is on the hyperplane, and its chart point
      // embeds back to it.
      for (let vertex = 0; vertex < section.vertexCount; vertex++) {
        const ambient = Array.from(
          section.ambientPositions.subarray(vertex * ambientDim, (vertex + 1) * ambientDim)
        );
        expect(Math.abs(slice.signedDistance(ambient))).toBeLessThanOrEqual(1e-12);
        const chart = Array.from(
          section.chartPositions.subarray(vertex * section.chartDim, (vertex + 1) * section.chartDim)
        );
        const embedded = slice.embedPoint(chart);
        for (let c = 0; c < ambientDim; c++) {
          expect(embedded[c]!).toBeCloseTo(ambient[c]!, 12);
        }
      }

      // The analytic answer: the cut of this simplex is the midpoint set, each
      // crossing halfway along an edge from the below vertex.
      expect(section.vertexCount).toBe(ambientDim - 1);
      for (let vertex = 0; vertex < section.vertexCount; vertex++) {
        const ambient = section.ambientPositions.subarray(
          vertex * ambientDim, (vertex + 1) * ambientDim
        );
        // Exactly one coordinate is 1 (half of 2), the rest zero.
        const nonZero = Array.from(ambient).filter((value) => Math.abs(value) > 1e-12);
        expect(nonZero.length).toBe(1);
        expect(nonZero[0]!).toBeCloseTo(1, 12);
      }
    }
  });

  it('keeps ancestry that sums to one and reconstructs the point', () => {
    let checked = 0;
    for (const ambientDim of [3, 4, 5, 6]) {
      const points: number[][] = [];
      const below = new Array<number>(ambientDim).fill(0);
      below[ambientDim - 1] = -1.5;
      points.push(below);
      for (let axis = 0; axis < ambientDim - 1; axis++) {
        const above = new Array<number>(ambientDim).fill(0.25);
        above[axis] = 3;
        above[ambientDim - 1] = 2.5;
        points.push(above);
      }
      const { complex, group } = simplexComplex(ambientDim, points);
      const slice = HyperplaneSliceN.axisAligned(ambientDim, ambientDim - 1, 0.5);
      const section = sectionSimplexGroupN({ complex, group, slice });
      expect(section.vertexCount).toBeGreaterThan(0);

      for (let vertex = 0; vertex < section.vertexCount; vertex++) {
        let sum = 0;
        for (
          let at = section.lineage.offsets[vertex]!;
          at < section.lineage.offsets[vertex + 1]!;
          at++
        ) {
          const weight = section.lineage.weights[at]!;
          // Inside the source simplex, so no materially negative weight.
          expect(weight).toBeGreaterThan(-1e-12);
          sum += weight;
        }
        expect(sum).toBeCloseTo(1, 12);

        const rebuilt = reconstruct(section, complex.positions, ambientDim, vertex);
        for (let c = 0; c < ambientDim; c++) {
          expect(rebuilt[c]!).toBeCloseTo(
            section.ambientPositions[vertex * ambientDim + c]!, 12
          );
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('welds adjacent cells across a shared cut feature', () => {
    // Two triangles sharing edge 0-1, which the plane *cuts*: vertex 0 is below
    // and 1 is above, so both cells compute the same crossing on it. A shared
    // edge whose endpoints are on the same side is not a shared cut feature and
    // would prove nothing here.
    const positions = Float64Array.from([
      0, 0, -1,   // 0 below
      1, 0, 1,    // 1 above
      0, 1, 1,    // 2 above
      -1, 0, 1    // 3 above
    ]);
    const group: CellGroup = {
      dim: 2, verticesPerCell: 3, kind: 'simplex',
      indices: Uint32Array.from([0, 1, 2, 0, 1, 3])
    };
    const complex = new CellComplex(3, positions, [group]);
    const slice = HyperplaneSliceN.axisAligned(3, 2, 0);
    const section = sectionSimplexGroupN({ complex, group, slice });

    // Liveness: both cells sectioned into live segments.
    expect(section.diagnostics.sectionedCells).toBe(2);
    expect(section.cellCount).toBe(2);
    expect(section.cellDim).toBe(1);
    // Four crossings were computed — two per cell — and the shared cut edge
    // 0-1 welds, so three distinct vertices remain rather than four.
    expect(section.diagnostics.crossingsFound).toBe(4);
    expect(section.vertexCount).toBe(3);
    expect(section.diagnostics.weldedVertices).toBe(3);
    expect(Array.from(section.parentCells)).toEqual([0, 1]);

    // The weld is a shared index, not two coincident vertices: exactly one
    // output vertex appears in both cells.
    const first = new Set(Array.from(section.cells.subarray(0, 2)));
    const second = new Set(Array.from(section.cells.subarray(2, 4)));
    const shared = [...first].filter((vertex) => second.has(vertex));
    expect(shared.length).toBe(1);
    // And that welded vertex is the midpoint of the shared edge.
    const at = shared[0]! * 3;
    expect(section.ambientPositions[at]!).toBeCloseTo(0.5, 12);
    expect(section.ambientPositions[at + 1]!).toBeCloseTo(0, 12);
    expect(section.ambientPositions[at + 2]!).toBeCloseTo(0, 12);
  });

  it('distinguishes empty, suppressed, and below', () => {
    const { complex, group } = simplexComplex(3, [
      [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]
    ]);
    // Far above: nothing is below the plane, so every cell is suppressed rather
    // than reported as an empty section of an intersecting complex.
    const above = sectionSimplexGroupN({
      complex, group, slice: HyperplaneSliceN.axisAligned(3, 2, -5)
    });
    expect(above.cellCount).toBe(0);
    expect(above.diagnostics.suppressedOnPlaneCells).toBe(1);
    expect(above.diagnostics.cellsBelow).toBe(0);

    // Far below: the opposite population.
    const below = sectionSimplexGroupN({
      complex, group, slice: HyperplaneSliceN.axisAligned(3, 2, 5)
    });
    expect(below.cellCount).toBe(0);
    expect(below.diagnostics.cellsBelow).toBe(1);
    expect(below.diagnostics.suppressedOnPlaneCells).toBe(0);

    // A cell lying wholly in the plane is suppressed, not emitted twice.
    const flat = simplexComplex(3, [[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
    const onPlane = sectionSimplexGroupN({
      complex: flat.complex, group: flat.group,
      slice: HyperplaneSliceN.axisAligned(3, 2, 0)
    });
    expect(onPlane.cellCount).toBe(0);
    expect(onPlane.diagnostics.suppressedOnPlaneCells).toBe(1);
    expect(onPlane.diagnostics.collapsedSectionCells).toBe(0);
  });

  it('counts collapsed straddling cells, completing the partition', () => {
    // The two cases the P54 review measured as counted nowhere. Both straddle
    // the plane, so neither is suppressed nor below; both weld every crossing
    // onto too few vertices for a cell to survive.
    const partition = (section: SectionSimplexGroupNResultN): number =>
      section.diagnostics.sectionedCells +
      section.diagnostics.suppressedOnPlaneCells +
      section.diagnostics.cellsBelow +
      section.diagnostics.collapsedSectionCells;

    // Tangency whose on-plane vertex is the only non-below vertex.
    const tangent = simplexComplex(3, [
      [0, 0, -1], [1, 0, -1], [0, 1, -1], [0.2, 0.2, 0]
    ]);
    const tangentSection = sectionSimplexGroupN({
      complex: tangent.complex, group: tangent.group,
      slice: HyperplaneSliceN.axisAligned(3, 2, 0)
    });
    expect(tangentSection.cellCount).toBe(0);
    expect(tangentSection.diagnostics.collapsedSectionCells).toBe(1);
    expect(tangentSection.diagnostics.suppressedOnPlaneCells).toBe(0);
    expect(tangentSection.diagnostics.cellsBelow).toBe(0);
    // The welded vertex survives in the output while belonging to no cell.
    expect(tangentSection.vertexCount).toBe(1);
    expect(partition(tangentSection)).toBe(tangentSection.diagnostics.sourceCells);

    // An on-plane sub-face: two vertices in the plane, two below, so the
    // full-dimensional section collapses to that edge.
    const subFace = simplexComplex(3, [
      [0, 0, -1], [1, 0, -1], [0, 1, 0], [1, 1, 0]
    ]);
    const subFaceSection = sectionSimplexGroupN({
      complex: subFace.complex, group: subFace.group,
      slice: HyperplaneSliceN.axisAligned(3, 2, 0)
    });
    expect(subFaceSection.cellCount).toBe(0);
    expect(subFaceSection.diagnostics.collapsedSectionCells).toBe(1);
    expect(subFaceSection.vertexCount).toBe(2);
    expect(partition(subFaceSection)).toBe(subFaceSection.diagnostics.sourceCells);

    // And a live section reports zero collapsed, so the counter is not noise.
    const live = simplexComplex(3, [[0, 0, -1], [2, 0, 1], [0, 2, 1], [1, 1, -0.5]]);
    const liveSection = sectionSimplexGroupN({
      complex: live.complex, group: live.group,
      slice: HyperplaneSliceN.axisAligned(3, 2, 0)
    });
    expect(liveSection.cellCount).toBeGreaterThan(0);
    expect(liveSection.diagnostics.collapsedSectionCells).toBe(0);
    expect(partition(liveSection)).toBe(liveSection.diagnostics.sourceCells);
  });

  it('orients each parent as the boundary of its below region', () => {
    // Coherence: on a 2-2 split the shared diagonal must cancel in the
    // algebraic boundary of the two emitted triangles — the defect P54's review
    // measured as 0/64 before the shuffle parity was applied.
    const { complex, group } = simplexComplex(4, [
      [0.3, -0.2, 0.1, -1], [1.7, 0.4, -0.3, -0.6], [0.1, 1.5, 0.4, 0.8], [-0.5, 0.6, 1.2, 1.1]
    ]);
    const forward = sectionSimplexGroupN({
      complex, group, slice: new HyperplaneSliceN({ normal: VecN.basis(4, 3) })
    });
    expect(forward.cellCount).toBe(2);
    const directedEdges = (section: SectionSimplexGroupNResultN): Map<string, number> => {
      const net = new Map<string, number>();
      const label = (vertex: number): string =>
        Array.from(section.ambientPositions.subarray(vertex * 4, vertex * 4 + 4))
          .map((value) => (Math.abs(value) < 5e-10 ? 0 : value).toFixed(9)).join(',');
      for (let cell = 0; cell < section.cellCount; cell++) {
        const corners = [0, 1, 2].map((at) => section.cells[cell * 3 + at]!);
        const edges: readonly [number, number][] = [
          [corners[1]!, corners[2]!], [corners[2]!, corners[0]!], [corners[0]!, corners[1]!]
        ];
        for (const [tail, head] of edges) {
          const tailLabel = label(tail);
          const headLabel = label(head);
          const ordered = tailLabel < headLabel;
          const key = ordered ? `${tailLabel}>${headLabel}` : `${headLabel}>${tailLabel}`;
          net.set(key, (net.get(key) ?? 0) + (ordered ? 1 : -1));
        }
      }
      return net;
    };
    const net = directedEdges(forward);
    // Exactly one internal edge (the diagonal) cancels; four boundary edges remain.
    const surviving = [...net.values()].filter((sum) => sum !== 0);
    expect(net.size).toBe(5);
    expect(surviving.length).toBe(4);

    // The class is geometric: reversing the normal reverses every boundary edge.
    const backward = sectionSimplexGroupN({
      complex, group,
      slice: new HyperplaneSliceN({ normal: VecN.basis(4, 3).multiplyScalar(-1) })
    });
    const reversedNet = directedEdges(backward);
    for (const [key, sum] of net) {
      if (sum === 0) continue;
      expect(reversedNet.get(key), key).toBe(-sum);
    }
  });

  it('is invariant under source-vertex and cell permutation', () => {
    const base = simplexComplex(4, [
      [0, 0, 0, -1], [2, 0, 0, 1], [0, 2, 0, 1], [0, 0, 2, 1]
    ]);
    const slice = HyperplaneSliceN.axisAligned(4, 3, 0);
    const original = sectionSimplexGroupN({
      complex: base.complex, group: base.group, slice
    });
    expect(original.cellCount).toBeGreaterThan(0);

    // Relabel the source vertices, and permute the cell's vertex order.
    const permutation = [2, 0, 3, 1];
    const permuted = new Float64Array(16);
    for (let vertex = 0; vertex < 4; vertex++) {
      for (let c = 0; c < 4; c++) {
        permuted[permutation[vertex]! * 4 + c] = base.complex.positions[vertex * 4 + c]!;
      }
    }
    const group: CellGroup = {
      dim: 3, verticesPerCell: 4, kind: 'simplex',
      indices: Uint32Array.from([permutation[3]!, permutation[1]!, permutation[0]!, permutation[2]!])
    };
    const other = sectionSimplexGroupN({
      complex: new CellComplex(4, permuted, [group]), group, slice
    });

    // The geometry is the same set of points, whatever the labels.
    const key = (result: SectionSimplexGroupNResultN, vertex: number): string =>
      Array.from(result.ambientPositions.subarray(vertex * 4, vertex * 4 + 4))
        .map((value) => value.toFixed(9)).join(',');
    const left = new Set(
      Array.from({ length: original.vertexCount }, (_u, v) => key(original, v))
    );
    const right = new Set(
      Array.from({ length: other.vertexCount }, (_u, v) => key(other, v))
    );
    expect(right).toEqual(left);
    expect(other.cellCount).toBe(original.cellCount);
  });

  it('refuses non-simplicial input and mismatched dimensions', () => {
    const positions = Float64Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    const cuboid: CellGroup = {
      dim: 2, verticesPerCell: 4, kind: 'cuboid',
      indices: Uint32Array.from([0, 1, 2, 3])
    };
    const complex = new CellComplex(3, positions, [cuboid]);
    expect(() => sectionSimplexGroupN({
      complex, group: cuboid, slice: HyperplaneSliceN.axisAligned(3, 2, 0)
    })).toThrow(/Simplexize/);

    const { complex: tri, group } = simplexComplex(3, [[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
    expect(() => sectionSimplexGroupN({
      complex: tri, group, slice: HyperplaneSliceN.axisAligned(4, 3, 0)
    })).toThrow(/4D but the complex is 3D/);
  });
});

describe('sectionSimplexGroupN: the R4 tetrahedral differential', () => {
  it('emits the same cut points as sliceTetrahedraAmbient', () => {
    const fixtures: readonly (readonly number[][])[] = [
      // 1-3 split.
      [[0, 0, 0, -1], [2, 0, 0, 1], [0, 2, 0, 1], [0, 0, 2, 1]],
      // 3-1 split.
      [[0, 0, 0, 1], [2, 0, 0, -1], [0, 2, 0, -1], [0, 0, 2, -1]],
      // 2-2 split.
      [[0, 0, 0, -1], [2, 0, 0, -1], [0, 2, 0, 1], [0, 0, 2, 1]],
      // Asymmetric, off-axis normal handled below.
      [[0.5, -1, 0.25, -2], [3, 0.5, 1, 0.75], [-1, 2, 0.5, 1.5], [0.25, 0.5, 3, 0.5]]
    ];
    let compared = 0;
    for (const points of fixtures) {
      const { complex, group } = simplexComplex(4, points);
      const normal = VecN.basis(4, 3);
      const generic = new HyperplaneSliceN({ normal, offset: 0 });
      const shipped = new HyperplaneSlice4({ normal, offset: 0 });

      const section = sectionSimplexGroupN({ complex, group, slice: generic });
      const out = new Float64Array(24);
      const count = sliceTetrahedraAmbient(
        complex.positions, group.indices, shipped, out
      );

      // Liveness on both sides before any agreement claim.
      expect(count).toBeGreaterThan(0);
      expect(section.cellCount).toBeGreaterThan(0);
      // Same number of emitted triangles, and the same cut point set.
      expect(section.cellCount).toBe(count / 3);
      const shippedPoints = new Set<string>();
      for (let vertex = 0; vertex < count; vertex++) {
        shippedPoints.add(
          Array.from(out.subarray(vertex * 4, vertex * 4 + 4))
            .map((value) => value.toFixed(9)).join(',')
        );
      }
      const genericPoints = new Set<string>();
      for (let vertex = 0; vertex < section.vertexCount; vertex++) {
        genericPoints.add(
          Array.from(section.ambientPositions.subarray(vertex * 4, vertex * 4 + 4))
            .map((value) => value.toFixed(9)).join(',')
        );
      }
      expect(genericPoints).toEqual(shippedPoints);
      // Every output cell names the one source tetrahedron.
      expect(Array.from(new Set(section.parentCells))).toEqual([0]);
      compared++;
    }
    expect(compared).toBe(fixtures.length);
  });

  it('agrees on the 2-2 quad split as ordered triangles, up to one class', () => {
    // Both paths triangulate the same quad along the same diagonal. The generic
    // staircase is coherently oriented as the boundary of the below region; the
    // legacy fan is coherently wound in its own historical class. So the ordered
    // comparison is exact up to ONE choice per parent: each generic triangle is
    // the legacy triangle's cyclic class or its reversal, and the same choice
    // holds for both triangles. A vertex-set comparison would accept broken
    // winding; this does not.
    const { complex, group } = simplexComplex(4, [
      [0, 0, 0, -1], [2, 0, 0, -1], [0, 2, 0, 1], [0, 0, 2, 1]
    ]);
    const normal = VecN.basis(4, 3);
    const section = sectionSimplexGroupN({
      complex, group, slice: new HyperplaneSliceN({ normal })
    });
    const out = new Float64Array(24);
    const count = sliceTetrahedraAmbient(
      complex.positions, group.indices, new HyperplaneSlice4({ normal }), out
    );
    expect(count).toBe(6);
    expect(section.cellCount).toBe(2);

    const cyclic = (corners: readonly string[]): string => {
      let best = '';
      for (let start = 0; start < corners.length; start++) {
        const rotated = corners.map((_ignored, index) =>
          corners[(start + index) % corners.length]!);
        const key = rotated.join(' | ');
        if (best === '' || key < best) best = key;
      }
      return best;
    };
    const legacyClasses: string[] = [];
    const legacyReversed: string[] = [];
    for (let triangle = 0; triangle < 2; triangle++) {
      const corners: string[] = [];
      for (let corner = 0; corner < 3; corner++) {
        const at = (triangle * 3 + corner) * 4;
        corners.push(
          Array.from(out.subarray(at, at + 4)).map((value) => value.toFixed(9)).join(',')
        );
      }
      legacyClasses.push(cyclic(corners));
      legacyReversed.push(cyclic([...corners].reverse()));
    }
    const genericClasses: string[] = [];
    for (let cell = 0; cell < 2; cell++) {
      const corners: string[] = [];
      for (let corner = 0; corner < 3; corner++) {
        const vertex = section.cells[cell * 3 + corner]!;
        corners.push(
          Array.from(section.ambientPositions.subarray(vertex * 4, vertex * 4 + 4))
            .map((value) => value.toFixed(9)).join(',')
        );
      }
      genericClasses.push(cyclic(corners));
    }
    const matchesDirect =
      new Set(genericClasses).size === 2 &&
      genericClasses.every((entry) => legacyClasses.includes(entry));
    const matchesReversed =
      new Set(genericClasses).size === 2 &&
      genericClasses.every((entry) => legacyReversed.includes(entry));
    // Exactly one of the two, never a mixture: mixed classes are the broken
    // winding the P54 review measured as 0/64.
    expect(matchesDirect !== matchesReversed).toBe(true);
  });
});

describe('sectionSimplexGroupN: ancestry composes through a second section', () => {
  it('names original R5 vertices after sectioning R5 to R4 to R3', () => {
    // A 4-simplex in R5 spanning both hyperplanes.
    const { complex, group } = simplexComplex(5, [
      [0, 0, 0, -1, -1],
      [4, 0, 0, 1, 1],
      [0, 4, 0, 1, -1],
      [0, 0, 4, -1, 1],
      [1, 1, 1, 1, 1]
    ]);
    const first = sectionSimplexGroupN({
      complex, group, slice: HyperplaneSliceN.axisAligned(5, 4, 0)
    });
    // Liveness: the first cut produced live 3-cells.
    expect(first.cellCount).toBeGreaterThan(0);
    expect(first.cellDim).toBe(3);

    // The intermediate complex, still carrying R5 ancestry.
    const intermediate = new CellComplex(5, first.ambientPositions, []);
    const intermediateGroup: CellGroup = {
      dim: first.cellDim, verticesPerCell: first.verticesPerCell,
      kind: 'simplex', indices: first.cells
    };
    intermediate.addGroup(intermediateGroup);

    const second = sectionSimplexGroupN({
      complex: intermediate,
      group: intermediateGroup,
      slice: HyperplaneSliceN.axisAligned(5, 3, 0),
      lineage: first.lineage
    });
    expect(second.cellCount).toBeGreaterThan(0);
    expect(second.cellDim).toBe(2);

    for (let vertex = 0; vertex < second.vertexCount; vertex++) {
      // Ancestry is over the ORIGINAL five R5 vertices, never the intermediate.
      let sum = 0;
      for (
        let at = second.lineage.offsets[vertex]!;
        at < second.lineage.offsets[vertex + 1]!;
        at++
      ) {
        expect(second.lineage.sourceVertices[at]!).toBeLessThan(5);
        sum += second.lineage.weights[at]!;
      }
      expect(sum).toBeCloseTo(1, 11);

      // And those weights reconstruct the emitted point from the R5 source.
      const rebuilt = reconstruct(second, complex.positions, 5, vertex);
      for (let c = 0; c < 5; c++) {
        expect(rebuilt[c]!).toBeCloseTo(second.ambientPositions[vertex * 5 + c]!, 11);
      }
    }

    // Both hyperplanes are satisfied by the final geometry, which is what makes
    // this a codimension-two intersection rather than two unrelated cuts.
    const outer = HyperplaneSliceN.axisAligned(5, 4, 0);
    const inner = HyperplaneSliceN.axisAligned(5, 3, 0);
    for (let vertex = 0; vertex < second.vertexCount; vertex++) {
      const point = Array.from(second.ambientPositions.subarray(vertex * 5, vertex * 5 + 5));
      expect(Math.abs(outer.signedDistance(point))).toBeLessThanOrEqual(1e-11);
      expect(Math.abs(inner.signedDistance(point))).toBeLessThanOrEqual(1e-11);
    }
  });

  it('replays a chained section bitwise for identical input', () => {
    const build = (): SectionSimplexGroupNResultN => {
      const { complex, group } = simplexComplex(5, [
        [0, 0, 0, -1, -1], [4, 0, 0, 1, 1], [0, 4, 0, 1, -1],
        [0, 0, 4, -1, 1], [1, 1, 1, 1, 1]
      ]);
      const first = sectionSimplexGroupN({
        complex, group, slice: HyperplaneSliceN.axisAligned(5, 4, 0)
      });
      const intermediateGroup: CellGroup = {
        dim: first.cellDim, verticesPerCell: first.verticesPerCell,
        kind: 'simplex', indices: first.cells
      };
      return sectionSimplexGroupN({
        complex: new CellComplex(5, first.ambientPositions, [intermediateGroup]),
        group: intermediateGroup,
        slice: HyperplaneSliceN.axisAligned(5, 3, 0),
        lineage: first.lineage
      });
    };
    const a = build();
    const b = build();
    expect(a.vertexCount).toBeGreaterThan(0);
    expect(Array.from(b.ambientPositions)).toEqual(Array.from(a.ambientPositions));
    expect(Array.from(b.cells)).toEqual(Array.from(a.cells));
    expect(Array.from(b.lineage.weights)).toEqual(Array.from(a.lineage.weights));
    expect(Array.from(b.lineage.sourceVertices)).toEqual(Array.from(a.lineage.sourceVertices));
  });

  it('changes live output when either hyperplane moves', () => {
    const { complex, group } = simplexComplex(4, [
      [0, 0, 0, -2], [3, 0, 0, 2], [0, 3, 0, 2], [0, 0, 3, 2]
    ]);
    const near = sectionSimplexGroupN({
      complex, group, slice: HyperplaneSliceN.axisAligned(4, 3, -1)
    });
    const far = sectionSimplexGroupN({
      complex, group, slice: HyperplaneSliceN.axisAligned(4, 3, 1)
    });
    expect(near.cellCount).toBeGreaterThan(0);
    expect(far.cellCount).toBeGreaterThan(0);
    expect(Array.from(far.ambientPositions))
      .not.toEqual(Array.from(near.ambientPositions));
  });
});
