import type { CellComplex, CellGroup } from './cell-complex.js';

/**
 * Kuhn decomposition of the unit cube into 6 tetrahedra around the main
 * diagonal (local vertex 0 → local vertex 7): one tetrahedron per monotone
 * lattice path 0 → e_i → e_i+e_j → 7. Every tetrahedron shares the main
 * diagonal, so the decomposition is deterministic and orientation-uniform.
 *
 * Local indices use the same bit convention as the hypercube builder:
 * bit k of the local index selects the k-th free axis.
 */
const CUBE_TETRA: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 1, 3, 7],
  [0, 1, 5, 7],
  [0, 2, 3, 7],
  [0, 2, 6, 7],
  [0, 4, 5, 7],
  [0, 4, 6, 7]
];

/**
 * Converts every cuboid 3-cell group of the complex into tetrahedral
 * (simplex) 3-cell groups, appending them to the complex. 6 tetrahedra per
 * cube. Existing cuboid groups are left in place.
 *
 * Slicing and other simplex-based algorithms operate on the tetrahedral
 * groups. Adjacent cubes triangulate shared faces independently; sliced
 * boundary segments still coincide geometrically (interpolation along a
 * shared planar face yields the same segment), so cross-sections render
 * watertight even though the triangulations are not globally conforming.
 */
export function tetrahedralizeCuboidCells(complex: CellComplex): CellComplex {
  const cuboidGroups = complex.groups.filter(
    (g) => g.dim === 3 && g.kind === 'cuboid' && g.verticesPerCell === 8
  );
  if (cuboidGroups.length === 0) {
    throw new Error('tetrahedralizeCuboidCells: complex has no cuboid 3-cells');
  }
  for (const group of cuboidGroups) {
    const cubeCount = group.indices.length / 8;
    const tets = new Uint32Array(cubeCount * CUBE_TETRA.length * 4);
    let k = 0;
    for (let cube = 0; cube < cubeCount; cube++) {
      const base = cube * 8;
      for (const tet of CUBE_TETRA) {
        for (const local of tet) {
          tets[k++] = group.indices[base + local]!;
        }
      }
    }
    const tetraGroup: CellGroup = { dim: 3, verticesPerCell: 4, kind: 'simplex', indices: tets };
    complex.addGroup(tetraGroup);
  }
  return complex;
}
