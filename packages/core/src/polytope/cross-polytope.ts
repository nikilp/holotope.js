import { CellComplex } from '../geometry/cell-complex.js';

export interface CrossPolytopeOptions {
  /** Ambient (and intrinsic) dimension; 4 gives the 16-cell. */
  dim: number;
  /** Circumradius (distance from center to each vertex). Default 1. */
  radius?: number;
}

/**
 * Builds an n-dimensional cross-polytope (orthoplex): vertices at ±r·e_i.
 *
 * Vertices 0…n−1 are +e_i, vertices n…2n−1 are −e_i. Every vertex pair is
 * an edge except antipodal pairs: 2n(n−1) edges total.
 */
export function createCrossPolytope({ dim, radius = 1 }: CrossPolytopeOptions): CellComplex {
  if (dim < 1) throw new Error(`createCrossPolytope: unsupported dimension ${dim}`);
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

  // Tetrahedral 3-faces: one per choice of 4 axes and a sign for each
  // (for dim = 4 these are the 16 boundary cells of the 16-cell).
  if (dim >= 4) {
    const tets: number[] = [];
    for (let a = 0; a < dim; a++) {
      for (let b = a + 1; b < dim; b++) {
        for (let c = b + 1; c < dim; c++) {
          for (let d = c + 1; d < dim; d++) {
            for (let signs = 0; signs < 16; signs++) {
              tets.push(
                (signs & 1) !== 0 ? a + dim : a,
                (signs & 2) !== 0 ? b + dim : b,
                (signs & 4) !== 0 ? c + dim : c,
                (signs & 8) !== 0 ? d + dim : d
              );
            }
          }
        }
      }
    }
    complex.addGroup({
      dim: 3,
      verticesPerCell: 4,
      kind: 'simplex',
      indices: Uint32Array.from(tets)
    });
  }

  return complex;
}
