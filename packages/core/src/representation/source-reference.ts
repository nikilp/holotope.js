import type { CellComplex, CellGroup, CellKind } from '../geometry/cell-complex.js';

/**
 * In-memory identity for one cell in one `CellComplex` group.
 *
 * The group object is the identity anchor. The reference survives vertex
 * position changes, unrelated group insertion, and group reordering. It is
 * retired when the group object is removed, its cell metadata changes, or
 * the referenced vertex tuple changes. It intentionally does not claim to
 * survive regeneration into a different `CellComplex` instance.
 */
export interface SourceCellReferenceN {
  readonly kind: 'source-cell-reference';
  readonly complex: CellComplex;
  readonly group: CellGroup;
  readonly groupIndexAtCreation: number;
  readonly cellIndex: number;
  readonly intrinsicDim: number;
  readonly cellKind: CellKind;
  readonly vertexIndices: readonly number[];
}

export type SourceCellReferenceRetirementReason =
  | 'group-removed'
  | 'group-metadata-changed'
  | 'cell-removed'
  | 'cell-vertices-changed';

export type SourceCellReferenceStatusN =
  | {
      readonly kind: 'current';
      readonly groupIndex: number;
    }
  | {
      readonly kind: 'retired';
      readonly reason: SourceCellReferenceRetirementReason;
    };

/** Creates a lifecycle-aware reference to a group-local cell ordinal. */
export function createSourceCellReferenceN(
  complex: CellComplex,
  group: CellGroup,
  cellIndex: number
): SourceCellReferenceN {
  const groupIndex = complex.groups.indexOf(group);
  if (groupIndex < 0) {
    throw new Error('createSourceCellReferenceN: group does not belong to complex');
  }
  if (!Number.isSafeInteger(cellIndex) || cellIndex < 0) {
    throw new Error('createSourceCellReferenceN: cellIndex must be a non-negative integer');
  }
  const cellCount = group.indices.length / group.verticesPerCell;
  if (cellIndex >= cellCount) {
    throw new Error(
      `createSourceCellReferenceN: cellIndex ${cellIndex} out of range (${cellCount} cells)`
    );
  }
  const start = cellIndex * group.verticesPerCell;
  return {
    kind: 'source-cell-reference',
    complex,
    group,
    groupIndexAtCreation: groupIndex,
    cellIndex,
    intrinsicDim: group.dim,
    cellKind: group.kind,
    vertexIndices: Object.freeze(
      Array.from(group.indices.subarray(start, start + group.verticesPerCell))
    )
  };
}

/** Audits whether a source-cell reference still names the same topology. */
export function inspectSourceCellReferenceN(
  reference: SourceCellReferenceN
): SourceCellReferenceStatusN {
  const groupIndex = reference.complex.groups.indexOf(reference.group);
  if (groupIndex < 0) return { kind: 'retired', reason: 'group-removed' };
  if (
    reference.group.dim !== reference.intrinsicDim ||
    reference.group.kind !== reference.cellKind ||
    reference.group.verticesPerCell !== reference.vertexIndices.length
  ) {
    return { kind: 'retired', reason: 'group-metadata-changed' };
  }
  const start = reference.cellIndex * reference.group.verticesPerCell;
  if (start + reference.group.verticesPerCell > reference.group.indices.length) {
    return { kind: 'retired', reason: 'cell-removed' };
  }
  for (let vertex = 0; vertex < reference.vertexIndices.length; vertex++) {
    if (reference.group.indices[start + vertex] !== reference.vertexIndices[vertex]) {
      return { kind: 'retired', reason: 'cell-vertices-changed' };
    }
  }
  return { kind: 'current', groupIndex };
}
