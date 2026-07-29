import {
  findIncidentCellsN,
  type CellGroup,
  type RepresentationHitN
} from '@holotope/core';

/** Source relation retained by one mechanics-workbench selection. */
export interface MechanicsWorkbenchSourceSelection {
  readonly hit: RepresentationHitN;
  /** Source vertices of the picked rendered simplex, not merely its 3D image. */
  readonly vertexIndices: readonly number[];
  /** Concatenated local tetrahedron ordinals incident to that simplex. */
  readonly tetrahedronIndices: Uint32Array;
}

/**
 * Relates a renderer-independent representation hit to the tetrahedra used by
 * the workbench's exact section.
 *
 * A projected surface resolves to a retained source triangle; a section
 * resolves directly to a source tetrahedron. Both therefore pass through the
 * same exact, combinatorial containment query. No 3D proximity or inverse
 * projection is used.
 */
export function resolveMechanicsWorkbenchSourceSelection(
  hit: RepresentationHitN,
  tetrahedronGroup: CellGroup
): MechanicsWorkbenchSourceSelection {
  if (hit.source.kind !== 'cell') {
    throw new Error(
      'resolveMechanicsWorkbenchSourceSelection: representation hit is not cell-backed'
    );
  }
  if (!hit.source.complex.groups.includes(tetrahedronGroup)) {
    throw new Error(
      'resolveMechanicsWorkbenchSourceSelection: tetrahedron group belongs to another source'
    );
  }
  if (
    tetrahedronGroup.dim !== 3 ||
    tetrahedronGroup.kind !== 'simplex' ||
    tetrahedronGroup.verticesPerCell !== 4
  ) {
    throw new Error(
      'resolveMechanicsWorkbenchSourceSelection: expected a tetrahedral 3-cell group'
    );
  }
  return Object.freeze({
    hit,
    vertexIndices: Object.freeze([...hit.source.vertexIndices]),
    tetrahedronIndices: findIncidentCellsN(
      tetrahedronGroup,
      hit.source.vertexIndices
    )
  });
}
