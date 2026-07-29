import type { CellGroup } from './cell-complex.js';

/**
 * Finds cells in one homogeneous group that contain every queried vertex.
 *
 * The result contains local cell ordinals in the same order as `group.indices`.
 * Containment is combinatorial and orientation-independent: the query
 * `[4, 1, 7]` matches a cell whenever all three vertex ids occur in its tuple.
 * The function does not infer geometric intersection or ancestry across a
 * refinement; callers must carry that lineage separately.
 *
 * This is the small topology bridge needed after resolving a rendered simplex
 * to source vertices. For example, a projected source triangle can be related
 * to every tetrahedron that has it as a face, after which an exact section can
 * highlight only those tetrahedra.
 *
 * @param group - Homogeneous target cells to search.
 * @param vertices - Non-empty, duplicate-free source vertex ids that every
 * returned cell must contain.
 *
 * @example
 * ```ts
 * const solid = tetrahedralizeCuboidCells(
 *   createHypercube({ dim: 4, maxCellDimension: 3 })
 * );
 * const tetrahedra = solid
 *   .cellsOfDim(3)
 *   .find((group) => group.kind === 'simplex')!;
 *
 * // Local tetrahedron ordinals incident to this retained source triangle.
 * const incident = findIncidentCellsN(tetrahedra, [0, 1, 3]);
 * ```
 */
export function findIncidentCellsN(
  group: CellGroup,
  vertices: ArrayLike<number>
): Uint32Array {
  if (group === null || typeof group !== 'object') {
    throw new Error('findIncidentCellsN: expected a CellGroup');
  }
  if (vertices.length < 1) {
    throw new Error('findIncidentCellsN: vertices must be non-empty');
  }

  const query = new Set<number>();
  for (let index = 0; index < vertices.length; index++) {
    const vertex = vertices[index]!;
    if (!Number.isSafeInteger(vertex) || vertex < 0) {
      throw new Error('findIncidentCellsN: vertex ids must be non-negative safe integers');
    }
    if (query.has(vertex)) {
      throw new Error('findIncidentCellsN: vertex ids must be unique');
    }
    query.add(vertex);
  }
  if (query.size > group.verticesPerCell) return new Uint32Array();

  const result: number[] = [];
  const cellCount = group.indices.length / group.verticesPerCell;
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
    const start = cellIndex * group.verticesPerCell;
    const found = new Set<number>();
    for (let corner = 0; corner < group.verticesPerCell; corner++) {
      const vertex = group.indices[start + corner]!;
      if (query.has(vertex)) found.add(vertex);
    }
    if (found.size === query.size) result.push(cellIndex);
  }
  return Uint32Array.from(result);
}
