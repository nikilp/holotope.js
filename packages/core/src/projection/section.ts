import type { CellComplex, CellGroup } from '../geometry/cell-complex.js';
import type { HyperplaneSliceN } from './slice.js';

/**
 * Codimension-one sections of simplicial cells in ℝⁿ, with ancestry that
 * survives being sectioned again.
 *
 * A section is an **intersection**, not a projection: the emitted geometry is
 * the part of the input that lies in the hyperplane. It is injective on what it
 * keeps — each output point came from exactly one ambient point — and what it
 * loses is dimension rather than distinctness. A projection loses distinctness
 * instead, which is why one of them can name a source point and the other
 * cannot.
 */

/**
 * Each output vertex as a sparse affine combination of **original** source
 * vertices, in compressed-row form.
 *
 * One source edge plus an interpolation parameter is enough ancestry for a
 * single cut and provably not enough for two: an edge of an already-sectioned
 * complex is generally not an edge of the original source, so a second section
 * would name a vertex that never existed in the input a reader started from.
 * Affine weights compose — the `t`-blend of two combinations is a combination —
 * so ancestry stays expressed in the original numbering however many times the
 * geometry is cut.
 *
 * Rows are sorted ascending by source vertex with duplicates merged, so
 * identical geometry produces identical rows bitwise.
 */
export interface SourceAffineLineageN {
  /** Row offsets into {@link sourceVertices} and {@link weights}. */
  readonly offsets: Uint32Array;
  /** Original source vertex indices, ascending within each row. */
  readonly sourceVertices: Uint32Array;
  /** Affine weights, summing to one per row. */
  readonly weights: Float64Array;
}

/** What one section call cost and found, so "empty" is never guessed. */
export interface SectionSimplexGroupNDiagnosticsN {
  /** Source cells examined. */
  readonly sourceCells: number;
  /** Source cells that produced at least one output cell. */
  readonly sectionedCells: number;
  /**
   * Cells suppressed because no vertex was strictly below the hyperplane.
   *
   * This is the population that distinguishes "the plane misses this complex"
   * from "the plane grazes or contains part of it": a wholly on-plane cell and a
   * cell tangent at one vertex both land here rather than being emitted as a
   * dimensionally false result.
   */
  readonly suppressedOnPlaneCells: number;
  /** Cells with no vertex on or above the hyperplane. */
  readonly cellsBelow: number;
  /** Distinct output vertices after welding. */
  readonly weldedVertices: number;
  /** Output vertices before welding, so the saving is visible. */
  readonly crossingsFound: number;
}

/** What to section, with what, and what ancestry to compose through. */
export interface SectionSimplexGroupNOptions {
  /** The complex whose packed ambient positions are authoritative. */
  readonly complex: CellComplex;
  /** One simplicial group of that complex. */
  readonly group: CellGroup;
  /** The hyperplane and the chart the result is expressed in. */
  readonly slice: HyperplaneSliceN;
  /**
   * Classification tolerance: `|signedDistance| <= epsilon` counts as exactly
   * on the hyperplane, and on-plane counts as non-negative. Default `1e-9`.
   */
  readonly epsilon?: number;
  /**
   * Ancestry of the *input* vertices over an original source, for chaining.
   *
   * Omit for a first section, where each input vertex is its own ancestor.
   * Supply the previous section's `lineage` to keep the result expressed in the
   * original numbering rather than in the intermediate complex's.
   */
  readonly lineage?: SourceAffineLineageN;
}

/** One codimension-one section: geometry, topology, ancestry, diagnostics. */
export interface SectionSimplexGroupNResultN {
  /** Ambient dimension, the same as the input complex's. */
  readonly ambientDim: number;
  /** Chart dimension, one less than {@link ambientDim}. */
  readonly chartDim: number;
  /** Intrinsic dimension of the emitted cells: one less than the input's. */
  readonly cellDim: number;
  /** `cellDim + 1`, because the output is simplicial too. */
  readonly verticesPerCell: number;
  /** Distinct output vertices after welding. */
  readonly vertexCount: number;
  /** Emitted `(k-1)`-simplices. */
  readonly cellCount: number;
  /** Packed ambient coordinates, `ambientDim` per vertex, all on the plane. */
  readonly ambientPositions: Float64Array;
  /** Packed chart coordinates, `chartDim` per vertex. */
  readonly chartPositions: Float64Array;
  /** Flat vertex indices, `verticesPerCell` per cell. */
  readonly cells: Uint32Array;
  /** Source cell index each output cell was cut from. */
  readonly parentCells: Uint32Array;
  /** Each output vertex as an affine combination of original source vertices. */
  readonly lineage: SourceAffineLineageN;
  /** Populations that distinguish an empty section from a suppressed one. */
  readonly diagnostics: SectionSimplexGroupNDiagnosticsN;
}

const CALLER = 'sectionSimplexGroupN';

/** Identity ancestry: every vertex is its own sole ancestor. */
function identityLineage(vertexCount: number): SourceAffineLineageN {
  const offsets = new Uint32Array(vertexCount + 1);
  const sourceVertices = new Uint32Array(vertexCount);
  const weights = new Float64Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    offsets[vertex + 1] = vertex + 1;
    sourceVertices[vertex] = vertex;
    weights[vertex] = 1;
  }
  return { offsets, sourceVertices, weights };
}

/** One row as an ascending, duplicate-merged (vertex, weight) list. */
function blendRows(
  lineage: SourceAffineLineageN,
  left: number,
  right: number,
  leftWeight: number,
  rightWeight: number
): { vertices: number[]; weights: number[] } {
  const merged = new Map<number, number>();
  const add = (row: number, scale: number): void => {
    for (let at = lineage.offsets[row]!; at < lineage.offsets[row + 1]!; at++) {
      const vertex = lineage.sourceVertices[at]!;
      merged.set(vertex, (merged.get(vertex) ?? 0) + scale * lineage.weights[at]!);
    }
  };
  add(left, leftWeight);
  if (right !== left) add(right, rightWeight);
  else {
    // Same ancestor row on both ends: the blend is that row, and adding it twice
    // with weights summing to one must not double it.
    merged.clear();
    add(left, 1);
  }
  const vertices = [...merged.keys()].sort((a, b) => a - b);
  return { vertices, weights: vertices.map((vertex) => merged.get(vertex)!) };
}

/**
 * Monotone lattice paths from `(0, 0)` to `(a - 1, b - 1)`, each visiting
 * `a + b - 1` points — the deterministic staircase triangulation of
 * `Δ^(a-1) × Δ^(b-1)`, which is the combinatorial shape of a simplex cut by a
 * hyperplane under its negative/non-negative vertex split.
 *
 * Enumerated with the `j` move before the `i` move, so the order is a function
 * of the split alone. For a tetrahedron this reproduces the existing R4
 * marching-tetrahedra cells: a 1–3 or 3–1 split yields the single triangle in
 * crossing order, and a 2–2 split yields the same two triangles the R4 quad fan
 * emits (the second triangle's last two vertices are transposed, which is an
 * orientation choice inside one cell — neither path promises globally
 * consistent orientation).
 */
function staircasePaths(a: number, b: number): number[][][] {
  const paths: number[][][] = [];
  const walk = (i: number, j: number, visited: number[][]): void => {
    if (i === a - 1 && j === b - 1) {
      paths.push(visited);
      return;
    }
    if (j < b - 1) walk(i, j + 1, [...visited, [i, j + 1]]);
    if (i < a - 1) walk(i + 1, j, [...visited, [i + 1, j]]);
  };
  walk(0, 0, [[0, 0]]);
  return paths;
}

/**
 * Sections one simplicial cell group with a hyperplane, in any ambient
 * dimension.
 *
 * Every emitted vertex lies on the hyperplane and carries a sparse affine
 * combination of original source vertices, so ancestry survives a second
 * section. Vertices are welded by original source identity — a source vertex for
 * an on-plane crossing, an unordered source edge for an interpolated one — so
 * adjacent cells sharing a cut feature share one output vertex rather than
 * cracking.
 *
 * Non-simplicial input is refused rather than guessed: simplexize it first (see
 * `simplexizeCuboidGroupN`). Cells with no vertex strictly below the hyperplane
 * are suppressed rather than emitted, which is how a wholly on-plane cell avoids
 * being returned twice; the diagnostics count them so "empty" and "suppressed"
 * stay distinguishable.
 *
 * @param options - The complex and one of its simplicial groups, the hyperplane,
 *   the classification tolerance, and the ancestry to compose through.
 * @returns Ambient and chart geometry, `(k-1)`-simplices, parent cells,
 *   composable ancestry, and diagnostics.
 *
 * @example
 * A triangle group in R4 sections to a 1-complex whose vertices still name R4
 * source vertices, with weights that reconstruct the ambient point:
 * ```ts
 * const positions = Float64Array.from([
 *   0, 0, 0, -1,
 *   2, 0, 0, 1,
 *   0, 2, 0, 1
 * ]);
 * const complex = new CellComplex(4, positions, [
 *   { dim: 2, verticesPerCell: 3, kind: 'simplex', indices: Uint32Array.from([0, 1, 2]) }
 * ]);
 * const group = complex.groups[0];
 * if (group === undefined) throw new Error('expected one group');
 *
 * const slice = HyperplaneSliceN.axisAligned(4, 3, 0);
 * const section = sectionSimplexGroupN({ complex, group, slice });
 *
 * section.cellDim; // 1 — a triangle cut by a hyperplane is a segment
 * section.cellCount; // 1
 * section.vertexCount; // 2
 * section.diagnostics.sectionedCells; // 1
 *
 * // Every emitted vertex is on the plane, and names its ancestors.
 * const w = section.ambientPositions[3];
 * Math.abs(w ?? 1) < 1e-12; // true
 * const first = section.lineage.offsets[0] ?? 0;
 * const past = section.lineage.offsets[1] ?? 0;
 * past - first; // 2 — a crossing is an affine combination of two source vertices
 * ```
 */
export function sectionSimplexGroupN(
  options: SectionSimplexGroupNOptions
): SectionSimplexGroupNResultN {
  const { complex, group, slice, epsilon = 1e-9 } = options;
  const ambientDim = complex.ambientDim;
  if (slice.ambientDim !== ambientDim) {
    throw new Error(
      `${CALLER}: slice is ${slice.ambientDim}D but the complex is ${ambientDim}D`
    );
  }
  if (group.kind !== 'simplex') {
    throw new Error(
      `${CALLER}: group kind must be 'simplex', got '${group.kind}'. Simplexize the ` +
      'group first (for example with simplexizeCuboidGroupN); this function does not ' +
      'guess a triangulation.'
    );
  }
  if (group.verticesPerCell !== group.dim + 1) {
    throw new Error(
      `${CALLER}: a ${group.dim}-simplex needs ${group.dim + 1} vertices per cell, ` +
      `got ${group.verticesPerCell}`
    );
  }
  if (group.dim < 1 || group.dim > ambientDim) {
    throw new Error(
      `${CALLER}: cell dimension must be in [1, ${ambientDim}], got ${group.dim}`
    );
  }
  if (!Number.isFinite(epsilon) || epsilon < 0) {
    throw new Error(`${CALLER}: epsilon must be a non-negative finite number`);
  }
  const lineage = options.lineage ?? identityLineage(complex.vertexCount);
  if (lineage.offsets.length !== complex.vertexCount + 1) {
    throw new Error(
      `${CALLER}: lineage describes ${lineage.offsets.length - 1} vertices but the ` +
      `complex has ${complex.vertexCount}`
    );
  }

  const perCell = group.verticesPerCell;
  const sourceCells = group.indices.length / perCell;
  const chartDim = slice.chartDim;

  // Welded output vertices, keyed by original-source identity.
  const vertexKeys = new Map<string, number>();
  const ambient: number[] = [];
  const chart: number[] = [];
  const rowVertices: number[][] = [];
  const rowWeights: number[][] = [];
  const cells: number[] = [];
  const parents: number[] = [];
  let crossingsFound = 0;
  let sectionedCells = 0;
  let suppressedOnPlaneCells = 0;
  let cellsBelow = 0;

  const distances = new Float64Array(perCell);
  const point = new Float64Array(ambientDim);

  /** Interns one crossing, returning its welded output vertex index. */
  const intern = (
    key: string,
    from: number,
    to: number,
    t: number
  ): number => {
    crossingsFound++;
    const existing = vertexKeys.get(key);
    if (existing !== undefined) return existing;
    const index = ambient.length / ambientDim;
    const a = from * ambientDim;
    const b = to * ambientDim;
    for (let c = 0; c < ambientDim; c++) {
      const value = complex.positions[a + c]! +
        t * (complex.positions[b + c]! - complex.positions[a + c]!);
      point[c] = value;
      ambient.push(value);
    }
    const projected = slice.projectPointToChart(point);
    for (let k = 0; k < chartDim; k++) chart.push(projected.coordinates[k]!);
    const blended = blendRows(lineage, from, to, 1 - t, t);
    rowVertices.push(blended.vertices);
    rowWeights.push(blended.weights);
    vertexKeys.set(key, index);
    return index;
  };

  for (let cell = 0; cell < sourceCells; cell++) {
    const negative: number[] = [];
    const negativeDistance: number[] = [];
    const nonNegative: number[] = [];
    const nonNegativeDistance: number[] = [];
    for (let v = 0; v < perCell; v++) {
      const vertex = group.indices[cell * perCell + v]!;
      const base = vertex * ambientDim;
      for (let c = 0; c < ambientDim; c++) point[c] = complex.positions[base + c]!;
      let d = slice.signedDistance(point);
      if (Math.abs(d) <= epsilon) d = 0;
      distances[v] = d;
      if (d < 0) {
        negative.push(vertex);
        negativeDistance.push(d);
      } else {
        nonNegative.push(vertex);
        nonNegativeDistance.push(d);
      }
    }
    if (negative.length === 0) {
      suppressedOnPlaneCells++;
      continue;
    }
    if (nonNegative.length === 0) {
      cellsBelow++;
      continue;
    }

    // The section of this simplex is the complete bipartite grid of crossings
    // between its below and not-below vertices: Δ^(a-1) × Δ^(b-1).
    const a = negative.length;
    const b = nonNegative.length;
    const grid: number[][] = [];
    for (let i = 0; i < a; i++) {
      const row: number[] = [];
      for (let j = 0; j < b; j++) {
        const from = negative[i]!;
        const to = nonNegative[j]!;
        const sFrom = negativeDistance[i]!;
        const sTo = nonNegativeDistance[j]!;
        const t = sFrom / (sFrom - sTo);
        // An on-plane endpoint is its own crossing, so every negative partner
        // must weld to that one vertex rather than to a per-edge duplicate.
        const key = sTo === 0
          ? `v${to}`
          : `e${Math.min(from, to)},${Math.max(from, to)}`;
        row.push(intern(key, from, to, t));
      }
      grid.push(row);
    }

    let emitted = 0;
    for (const path of staircasePaths(a, b)) {
      const corners = path.map(([i, j]) => grid[i!]![j!]!);
      // A degenerate path (a repeated welded vertex) would be a dimensionally
      // false cell; drop it rather than emit one.
      if (new Set(corners).size !== corners.length) continue;
      for (const corner of corners) cells.push(corner);
      parents.push(cell);
      emitted++;
    }
    if (emitted > 0) sectionedCells++;
  }

  const vertexCount = ambient.length / ambientDim;
  const offsets = new Uint32Array(vertexCount + 1);
  let total = 0;
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    total += rowVertices[vertex]!.length;
    offsets[vertex + 1] = total;
  }
  const flatVertices = new Uint32Array(total);
  const flatWeights = new Float64Array(total);
  let at = 0;
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const vertices = rowVertices[vertex]!;
    const weights = rowWeights[vertex]!;
    for (let k = 0; k < vertices.length; k++) {
      flatVertices[at] = vertices[k]!;
      flatWeights[at] = weights[k]!;
      at++;
    }
  }

  return {
    ambientDim,
    chartDim,
    cellDim: group.dim - 1,
    verticesPerCell: group.dim,
    vertexCount,
    cellCount: parents.length,
    ambientPositions: Float64Array.from(ambient),
    chartPositions: Float64Array.from(chart),
    cells: Uint32Array.from(cells),
    parentCells: Uint32Array.from(parents),
    lineage: { offsets, sourceVertices: flatVertices, weights: flatWeights },
    diagnostics: {
      sourceCells,
      sectionedCells,
      suppressedOnPlaneCells,
      cellsBelow,
      weldedVertices: vertexCount,
      crossingsFound
    }
  };
}
