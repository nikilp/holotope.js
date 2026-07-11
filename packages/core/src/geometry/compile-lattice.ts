import { CellComplex, type CellGroup } from './cell-complex.js';
import { raggedCount, raggedItem, type FaceLattice } from './face-lattice.js';
import { tetrahedralizeLattice, type Tetrahedralization } from './tetrahedralize-lattice.js';

/**
 * A face lattice compiled for rendering: the canonical topology, its
 * tetrahedralization (with provenance), and the render-oriented
 * `CellComplex` built from both.
 */
export interface CompiledPolytope {
  readonly lattice: FaceLattice;
  readonly tetrahedralization: Tetrahedralization;
  readonly complex: CellComplex;
}

/**
 * Compiles a rank-4 face lattice into a `CellComplex`: edges as one
 * 1-simplex group, 2-faces as polygon groups batched by arity (triangles
 * as simplices, matching existing builders), and the centroid-fan
 * tetrahedralization as one 3-simplex group. The complex's positions are
 * the source vertices followed by the helper centroids, so `tetToCell`
 * indexes render output directly.
 */
export function compileFaceLattice(
  lattice: FaceLattice,
  positions: Float64Array
): CompiledPolytope {
  const tetrahedralization = tetrahedralizeLattice(lattice, positions);
  const groups: CellGroup[] = [];

  const edges = lattice.layers[1];
  if (edges) {
    groups.push({
      dim: 1,
      verticesPerCell: 2,
      kind: 'simplex',
      indices: edges.vertices.data.slice()
    });
  }

  const faces = lattice.layers[2];
  if (faces) {
    const byArity = new Map<number, number[]>();
    for (let f = 0; f < raggedCount(faces.vertices); f++) {
      const loop = raggedItem(faces.vertices, f);
      let bucket = byArity.get(loop.length);
      if (!bucket) byArity.set(loop.length, (bucket = []));
      bucket.push(...loop);
    }
    for (const [arity, indices] of [...byArity.entries()].sort((x, y) => x[0] - y[0])) {
      groups.push({
        dim: 2,
        verticesPerCell: arity,
        kind: arity === 3 ? 'simplex' : 'polygon',
        indices: Uint32Array.from(indices)
      });
    }
  }

  groups.push({
    dim: 3,
    verticesPerCell: 4,
    kind: 'simplex',
    indices: tetrahedralization.indices
  });

  return {
    lattice,
    tetrahedralization,
    complex: new CellComplex(4, tetrahedralization.positions, groups)
  };
}
