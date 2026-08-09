import { CellComplex } from '../geometry/cell-complex.js';
import {
  assertBuilderInputs,
  assertGroupWithinBudget,
  assertMaxCellDimension,
  binomial,
  lexicographicSubsets
} from './simplicial-authoring.js';

export interface CrossPolytopeOptions {
  /** Ambient (and intrinsic) dimension; 4 gives the 16-cell. */
  dim: number;
  /** Circumradius (distance from center to each vertex). Default 1. */
  radius?: number;
  /**
   * Highest simplicial cell dimension to author, `1…dim-1` inclusive.
   * Requesting `dim` refuses by name: the cross-polytope's top cell is the
   * whole body with `2^dim` facets and is not a simplex, and authoring it as
   * one would be a lie. Default `min(dim - 1, 3)`, reproducing the historical
   * output byte-for-byte.
   *
   * For `k >= 2`, each group holds `C(dim, k+1) * 2^(k+1)` cells: ascending
   * axis subsets, lexicographic, then sign masks ascending (mask bit `j`
   * sends chosen axis `j` to its negative vertex). One vertex per distinct
   * axis, so no cell can contain an antipodal pair. The edge group predates
   * this family rule and keeps its frozen vertex-pair order — same cell set,
   * different order. Authored groups are combinatorial and **unoriented**
   * (render double-sided; oriented boundaries come from
   * `sectionSimplexGroupN`).
   */
  maxCellDimension?: number;
}

/**
 * Builds an n-dimensional cross-polytope (orthoplex): vertices at ±r·e_i.
 *
 * Vertices 0…n−1 are +e_i, vertices n…2n−1 are −e_i. Every vertex pair is
 * an edge except antipodal pairs: 2n(n−1) edges total.
 *
 * @param options - Ambient dimension and circumradius.
 *
 * @example
 * In four dimensions this is the 16-cell, dual to the tesseract — its 8
 * vertices answer to the tesseract's 8 cubic cells:
 * ```ts
 * const sixteenCell = createCrossPolytope({ dim: 4 });
 * sixteenCell.vertexCount; // 8
 * sixteenCell.cellCount(1); // 24 — all pairs but the 4 antipodal ones
 * ```
 *
 * @example
 * Dimension-complete authoring: the R5 cross-polytope's thirty-two simplicial
 * 4-facets — its whole boundary — while a requested top cell refuses by name,
 * because the body itself is not a simplex:
 * ```ts
 * const orthoplex = createCrossPolytope({ dim: 5, maxCellDimension: 4 });
 * log('boundary 4-facets', orthoplex.cellCount(4)); // 32 — C(5, 5) · 2⁵
 * ```
 *
 * @example
 * The 3D case is the octahedron, so the same call covers both:
 * ```ts
 * const octahedron = createCrossPolytope({ dim: 3 });
 * octahedron.vertexCount; // 6
 * ```
 */
export function createCrossPolytope(options: CrossPolytopeOptions): CellComplex {
  const { dim, radius = 1 } = options;
  assertBuilderInputs('createCrossPolytope', dim, 'radius', radius);
  const maxCellDimension = options.maxCellDimension ?? Math.min(dim - 1, 3);
  if (options.maxCellDimension !== undefined) {
    assertMaxCellDimension(
      'createCrossPolytope',
      options.maxCellDimension,
      dim - 1,
      `the highest simplicial face of a ${dim}-dimensional cross-polytope — ` +
      'its top cell is the whole body, not a simplex'
    );
  }
  // Refuse every group arithmetically before allocating any of them.
  for (let cellDim = 2; cellDim <= maxCellDimension; cellDim++) {
    assertGroupWithinBudget(
      'createCrossPolytope',
      cellDim,
      binomial(dim, cellDim + 1) * 2 ** (cellDim + 1),
      cellDim + 1
    );
  }
  const vertexCount = 2 * dim;

  const positions = new Float64Array(vertexCount * dim);
  for (let i = 0; i < dim; i++) {
    positions[i * dim + i] = radius;
    positions[(i + dim) * dim + i] = -radius;
  }

  const edges: number[] = [];
  for (let a = 0; a < vertexCount; a++) {
    for (let b = a + 1; b < vertexCount; b++) {
      if (b - a === dim && a < dim) continue; // antipodal pair
      edges.push(a, b);
    }
  }

  const complex = new CellComplex(dim, positions, [
    { dim: 1, verticesPerCell: 2, kind: 'simplex', indices: Uint32Array.from(edges) }
  ]);

  // Simplicial k-faces for k >= 2: one cell per (k+1)-subset of axes and a
  // sign per chosen axis — lexicographic axis subsets, ascending sign masks,
  // which reproduces the historical triangle and tetrahedron loops
  // byte-for-byte and extends them to any admitted k. One vertex per
  // distinct axis: an antipodal pair cannot occur.
  for (let cellDim = 2; cellDim <= maxCellDimension; cellDim++) {
    const verticesPerCell = cellDim + 1;
    const axisSubsets = lexicographicSubsets(dim, verticesPerCell);
    const subsetCount = axisSubsets.length / verticesPerCell;
    const signCount = 2 ** verticesPerCell;
    const indices = new Uint32Array(subsetCount * signCount * verticesPerCell);
    let written = 0;
    for (let subset = 0; subset < subsetCount; subset++) {
      for (let signs = 0; signs < signCount; signs++) {
        for (let slot = 0; slot < verticesPerCell; slot++) {
          const axis = axisSubsets[subset * verticesPerCell + slot]!;
          indices[written++] = (signs & (1 << slot)) !== 0 ? axis + dim : axis;
        }
      }
    }
    complex.addGroup({
      dim: cellDim,
      verticesPerCell,
      kind: 'simplex',
      indices
    });
  }

  return complex;
}
