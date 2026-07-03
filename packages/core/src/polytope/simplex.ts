import { CellComplex } from '../geometry/cell-complex.js';

export interface SimplexOptions {
  /** Intrinsic (and ambient) dimension; 4 gives the 5-cell. */
  dim: number;
  /** Edge length. Default 1. */
  edgeLength?: number;
}

/**
 * Builds a regular n-simplex (n+1 vertices) centered at the origin in R^n.
 *
 * Construction: take the n+1 standard basis vectors of R^(n+1) — which form
 * a regular simplex with edge length √2 in the hyperplane orthogonal to the
 * all-ones vector — recenter on their centroid, express them in an
 * orthonormal basis of that hyperplane (modified Gram–Schmidt), and scale.
 */
export function createSimplex({ dim, edgeLength = 1 }: SimplexOptions): CellComplex {
  if (dim < 1) throw new Error(`createSimplex: unsupported dimension ${dim}`);
  const m = dim + 1;

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

  // Every pair of vertices is an edge, every triple a triangular face,
  // every 4-subset a tetrahedral 3-face (for dim = 4 these are the five
  // boundary cells of the 5-cell).
  const edges: number[] = [];
  const triangles: number[] = [];
  const tets: number[] = [];
  for (let a = 0; a < m; a++) {
    for (let b = a + 1; b < m; b++) {
      edges.push(a, b);
      for (let c = b + 1; c < m; c++) {
        triangles.push(a, b, c);
        for (let d = c + 1; d < m; d++) tets.push(a, b, c, d);
      }
    }
  }

  const complex = new CellComplex(dim, positions, [
    { dim: 1, verticesPerCell: 2, kind: 'simplex', indices: Uint32Array.from(edges) }
  ]);
  if (dim >= 2) {
    complex.addGroup({
      dim: 2,
      verticesPerCell: 3,
      kind: 'simplex',
      indices: Uint32Array.from(triangles)
    });
  }
  if (dim >= 3) {
    complex.addGroup({
      dim: 3,
      verticesPerCell: 4,
      kind: 'simplex',
      indices: Uint32Array.from(tets)
    });
  }
  return complex;
}
