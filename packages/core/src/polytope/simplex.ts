import { CellComplex } from '../geometry/cell-complex.js';
import {
  assertBuilderInputs,
  assertGroupWithinBudget,
  assertMaxCellDimension,
  binomial,
  lexicographicSubsets
} from './simplicial-authoring.js';

export interface SimplexOptions {
  /** Intrinsic (and ambient) dimension; 4 gives the 5-cell. */
  dim: number;
  /** Edge length. Default 1. */
  edgeLength?: number;
  /**
   * Highest cell dimension to author, `1…dim` inclusive — `dim` is the top
   * simplex itself, one cell naming every vertex, which is what the RN
   * section path consumes. Default `min(dim, 3)`, reproducing the historical
   * output byte-for-byte; each `k` in range emits one group of all
   * `C(dim+1, k+1)` ascending-index `(k+1)`-subsets, lexicographic.
   *
   * Authored groups are combinatorial and **unoriented**: ascending-index
   * order is not boundary-coherent (shared faces double rather than cancel),
   * so render double-sided, and derive oriented boundaries from
   * `sectionSimplexGroupN`, which computes them from geometry.
   */
  maxCellDimension?: number;
}

/**
 * Builds a regular n-simplex (n+1 vertices) centered at the origin in ℝⁿ.
 *
 * Construction: take the n+1 standard basis vectors of R^(n+1) — which form
 * a regular simplex with edge length √2 in the hyperplane orthogonal to the
 * all-ones vector — recenter on their centroid, express them in an
 * orthonormal basis of that hyperplane (modified Gram–Schmidt), and scale.
 *
 * @param options - Intrinsic dimension and target edge length.
 *
 * @example
 * The 5-cell — the 4D tetrahedron, and the smallest polychoron there is:
 * ```ts
 * const fiveCell = createSimplex({ dim: 4 });
 * fiveCell.vertexCount; // 5
 * fiveCell.cellCount(1); // 10 — every pair of vertices is an edge
 * ```
 *
 * @example
 * Dimension-complete authoring: the R5 simplex with every face family up to
 * its six simplicial 4-facets and the top cell itself — which is exactly what
 * a chained RN section consumes:
 * ```ts
 * const body = createSimplex({ dim: 5, maxCellDimension: 5 });
 * log('tets', body.cellCount(3)); // 15 — C(6, 4)
 * log('4-facets', body.cellCount(4)); // 6 — C(6, 5), new above the default
 * log('top cell', body.cellCount(5)); // 1 — the simplex itself
 * ```
 *
 * @example
 * Every simplex is its own tetrahedralization, so this projects and
 * slices without any preparation:
 * ```ts
 * const fiveCell = new ProjectedEdges3D(
 *   createSimplex({ dim: 4 }),
 *   new PerspectiveProjection({ fromDim: 4, viewDistance: 4 })
 * );
 * scene.add(fiveCell.object);
 *
 * onFrame((t) =>
 *   fiveCell.update(
 *     new TransformN(4, rotationFromPlanes(4, [{ i: 0, j: 3, angle: t * 0.5 }]))
 *   )
 * );
 * ```
 */
export function createSimplex(options: SimplexOptions): CellComplex {
  const { dim, edgeLength = 1 } = options;
  assertBuilderInputs('createSimplex', dim, 'edgeLength', edgeLength);
  const maxCellDimension = options.maxCellDimension ?? Math.min(dim, 3);
  assertMaxCellDimension(
    'createSimplex', maxCellDimension, dim,
    `the top cell of a ${dim}-simplex`
  );
  // Refuse every group arithmetically before allocating any of them.
  const m = dim + 1;
  for (let cellDim = 1; cellDim <= maxCellDimension; cellDim++) {
    assertGroupWithinBudget(
      'createSimplex', cellDim, binomial(m, cellDim + 1), cellDim + 1
    );
  }

  // Centered vertices in R^m: q_i = e_i − (1/m, …, 1/m).
  const q: Float64Array[] = [];
  for (let i = 0; i < m; i++) {
    const v = new Float64Array(m).fill(-1 / m);
    v[i]! += 1;
    q.push(v);
  }

  // Orthonormal basis of span{q_1 − q_0, …, q_n − q_0} via modified Gram–Schmidt.
  const basis: Float64Array[] = [];
  for (let k = 1; k < m; k++) {
    const u = new Float64Array(m);
    for (let c = 0; c < m; c++) u[c] = q[k]![c]! - q[0]![c]!;
    for (const b of basis) {
      let dot = 0;
      for (let c = 0; c < m; c++) dot += u[c]! * b[c]!;
      for (let c = 0; c < m; c++) u[c]! -= dot * b[c]!;
    }
    let norm = 0;
    for (let c = 0; c < m; c++) norm += u[c]! * u[c]!;
    norm = Math.sqrt(norm);
    for (let c = 0; c < m; c++) u[c]! /= norm;
    basis.push(u);
  }

  const scale = edgeLength / Math.SQRT2;
  const positions = new Float64Array(m * dim);
  for (let i = 0; i < m; i++) {
    for (let k = 0; k < dim; k++) {
      let dot = 0;
      for (let c = 0; c < m; c++) dot += q[i]![c]! * basis[k]![c]!;
      positions[i * dim + k] = dot * scale;
    }
  }

  // Every (k+1)-subset of the vertices is a k-simplex; lexicographic
  // enumeration reproduces the historical nested pair/triple/4-subset loops
  // byte-for-byte in the default range and extends them to any requested k,
  // including k = dim, the top simplex itself.
  const complex = new CellComplex(dim, positions, [
    { dim: 1, verticesPerCell: 2, kind: 'simplex', indices: lexicographicSubsets(m, 2) }
  ]);
  for (let cellDim = 2; cellDim <= maxCellDimension; cellDim++) {
    complex.addGroup({
      dim: cellDim,
      verticesPerCell: cellDim + 1,
      kind: 'simplex',
      indices: lexicographicSubsets(m, cellDim + 1)
    });
  }
  return complex;
}
