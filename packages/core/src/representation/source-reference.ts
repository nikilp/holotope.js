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

export type SourceCellGroupKeyKind = 'explicit' | 'derived';

/**
 * Serializable structural identity for one cell.
 *
 * The topology fingerprint prevents a key/ordinal from silently retargeting
 * after incompatible regeneration. Explicit group keys survive group
 * reordering; derived keys are deterministic only while construction order is
 * preserved.
 */
export interface SourceCellIdN {
  readonly kind: 'source-cell-id';
  readonly ambientDim: number;
  readonly groupKey: string;
  readonly groupKeyKind: SourceCellGroupKeyKind;
  readonly cellIndex: number;
  readonly intrinsicDim: number;
  readonly cellKind: CellKind;
  readonly verticesPerCell: number;
  readonly vertexIndices: readonly number[];
}

export type SourceCellIdResolutionFailureReason =
  | 'ambient-dimension-changed'
  | 'group-key-missing'
  | 'group-key-ambiguous'
  | 'group-metadata-changed'
  | 'cell-removed'
  | 'cell-vertices-changed';

export type SourceCellIdResolutionN =
  | {
      readonly kind: 'resolved';
      readonly reference: SourceCellReferenceN;
    }
  | {
      readonly kind: 'unavailable';
      readonly reason: SourceCellIdResolutionFailureReason;
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

/** Returns the explicit group key or its deterministic order-based fallback. */
export function sourceCellGroupKeyN(
  complex: CellComplex,
  group: CellGroup
): { readonly key: string; readonly kind: SourceCellGroupKeyKind } {
  const groupIndex = complex.groups.indexOf(group);
  if (groupIndex < 0) {
    throw new Error('sourceCellGroupKeyN: group does not belong to complex');
  }
  if (group.key !== undefined) {
    if (typeof group.key !== 'string' || group.key.trim().length === 0) {
      throw new Error('sourceCellGroupKeyN: explicit group key must be a non-empty string');
    }
    return { key: group.key, kind: 'explicit' };
  }
  return {
    key: `${group.dim}:${group.kind}:${group.verticesPerCell}:${groupIndex}`,
    kind: 'derived'
  };
}

/** Snapshots a current in-memory cell reference as a structural id. */
export function createSourceCellIdN(reference: SourceCellReferenceN): SourceCellIdN {
  const status = inspectSourceCellReferenceN(reference);
  if (status.kind !== 'current') {
    throw new Error(`createSourceCellIdN: source reference is retired (${status.reason})`);
  }
  const groupKey = sourceCellGroupKeyN(reference.complex, reference.group);
  return {
    kind: 'source-cell-id',
    ambientDim: reference.complex.ambientDim,
    groupKey: groupKey.key,
    groupKeyKind: groupKey.kind,
    cellIndex: reference.cellIndex,
    intrinsicDim: reference.intrinsicDim,
    cellKind: reference.cellKind,
    verticesPerCell: reference.vertexIndices.length,
    vertexIndices: Object.freeze([...reference.vertexIndices])
  };
}

/** Resolve a structural id against one compatible current complex. */
export function resolveSourceCellIdN(
  complex: CellComplex,
  id: SourceCellIdN
): SourceCellIdResolutionN {
  requireSourceCellId(id);
  if (complex.ambientDim !== id.ambientDim) {
    return { kind: 'unavailable', reason: 'ambient-dimension-changed' };
  }
  const candidates = complex.groups.filter((group, groupIndex) => {
    if (id.groupKeyKind === 'explicit') return group.key === id.groupKey;
    return group.key === undefined &&
      `${group.dim}:${group.kind}:${group.verticesPerCell}:${groupIndex}` === id.groupKey;
  });
  if (candidates.length === 0) {
    return { kind: 'unavailable', reason: 'group-key-missing' };
  }
  if (candidates.length > 1) {
    return { kind: 'unavailable', reason: 'group-key-ambiguous' };
  }
  const group = candidates[0]!;
  if (
    group.dim !== id.intrinsicDim ||
    group.kind !== id.cellKind ||
    group.verticesPerCell !== id.verticesPerCell
  ) {
    return { kind: 'unavailable', reason: 'group-metadata-changed' };
  }
  const start = id.cellIndex * group.verticesPerCell;
  if (start + group.verticesPerCell > group.indices.length) {
    return { kind: 'unavailable', reason: 'cell-removed' };
  }
  for (let vertex = 0; vertex < id.vertexIndices.length; vertex++) {
    if (group.indices[start + vertex] !== id.vertexIndices[vertex]) {
      return { kind: 'unavailable', reason: 'cell-vertices-changed' };
    }
  }
  return {
    kind: 'resolved',
    reference: createSourceCellReferenceN(complex, group, id.cellIndex)
  };
}

function requireSourceCellId(id: SourceCellIdN): void {
  if (id.kind !== 'source-cell-id') {
    throw new Error('resolveSourceCellIdN: expected a source-cell-id');
  }
  if (!Number.isSafeInteger(id.ambientDim) || id.ambientDim < 1) {
    throw new Error('resolveSourceCellIdN: ambientDim must be a positive integer');
  }
  if (typeof id.groupKey !== 'string' || id.groupKey.length === 0) {
    throw new Error('resolveSourceCellIdN: groupKey must be a non-empty string');
  }
  if (id.groupKeyKind !== 'explicit' && id.groupKeyKind !== 'derived') {
    throw new Error('resolveSourceCellIdN: unknown groupKeyKind');
  }
  if (!Number.isSafeInteger(id.cellIndex) || id.cellIndex < 0) {
    throw new Error('resolveSourceCellIdN: cellIndex must be a non-negative integer');
  }
  if (!Number.isSafeInteger(id.intrinsicDim) || id.intrinsicDim < 0) {
    throw new Error('resolveSourceCellIdN: intrinsicDim must be a non-negative integer');
  }
  if (id.cellKind !== 'simplex' && id.cellKind !== 'cuboid' && id.cellKind !== 'polygon') {
    throw new Error('resolveSourceCellIdN: unknown cellKind');
  }
  if (!Number.isSafeInteger(id.verticesPerCell) || id.verticesPerCell < 1) {
    throw new Error('resolveSourceCellIdN: verticesPerCell must be a positive integer');
  }
  if (!Array.isArray(id.vertexIndices)) {
    throw new Error('resolveSourceCellIdN: vertexIndices must be an array');
  }
  if (id.vertexIndices.length !== id.verticesPerCell) {
    throw new Error('resolveSourceCellIdN: vertex tuple length does not match arity');
  }
  for (const vertex of id.vertexIndices) {
    if (!Number.isSafeInteger(vertex) || vertex < 0) {
      throw new Error('resolveSourceCellIdN: vertex indices must be non-negative integers');
    }
  }
}
