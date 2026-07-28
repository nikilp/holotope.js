import type { CellComplex, CellGroup, CellKind } from '../geometry/cell-complex.js';

/**
 * In-memory identity for one cell in one `CellComplex` group.
 *
 * The group object is the identity anchor. The reference survives vertex
 * position changes, unrelated group insertion, and group reordering. It is
 * retired when the group object is removed, its cell metadata changes, or
 * the referenced vertex tuple changes. It intentionally does not claim to
 * survive regeneration into a different `CellComplex` instance.
 *
 * `SourceCellIdN` is the same identity at the other lifetime: this one is
 * anchored to a live object and is cheap to resolve, that one is serializable
 * and re-checked against a rebuilt complex. Convert when crossing a boundary
 * the object cannot cross — storage, a worker, or a regenerated complex.
 */
export interface SourceCellReferenceN {
  /** Discriminant, for narrowing a union of source identities. */
  readonly kind: 'source-cell-reference';
  /** The complex the cell belongs to, held by reference. */
  readonly complex: CellComplex;
  /** The group object, which is what gives this reference its identity:
   * matching is by object, so reordering the complex's groups does not
   * disturb it and an equal-looking group from elsewhere does not satisfy it. */
  readonly group: CellGroup;
  /** Where the group sat when the reference was made. A hint for locating it
   * quickly, not part of the identity — the group object decides that. */
  readonly groupIndexAtCreation: number;
  /** Ordinal of the cell within its group. */
  readonly cellIndex: number;
  /** Dimension of the cell itself. */
  readonly intrinsicDim: number;
  /** Its kind. */
  readonly cellKind: CellKind;
  /** The cell's own vertex indices, which retire the reference if rewritten. */
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
 *
 * Every field here is a guard rather than a description: resolution checks
 * them in order and refuses with a named reason at the first that no longer
 * holds, so an id that resolves has been proven to still mean what it meant.
 *
 * | field | reason reported if it changed |
 * | --- | --- |
 * | `ambientDim` | `ambient-dimension-changed` |
 * | `groupKey` | `group-key-missing`, or `group-key-ambiguous` |
 * | `intrinsicDim`, `cellKind`, `verticesPerCell` | `group-metadata-changed` |
 * | `cellIndex` | `cell-removed` |
 * | `vertexIndices` | `cell-vertices-changed` |
 *
 * Refusing is the point. A cell ordinal alone would keep resolving after the
 * complex was rebuilt differently and would quietly name a different cell;
 * this returns unavailable instead, and says which assumption broke.
 */
export interface SourceCellIdN {
  /** Discriminant, for narrowing a union of source identities. */
  readonly kind: 'source-cell-id';
  /** Dimension the complex was in; a change invalidates everything below. */
  readonly ambientDim: number;
  /** Identifies the cell group. Its meaning depends on `groupKeyKind`. */
  readonly groupKey: string;
  /** `explicit` when the group carried an authored key, which survives
   * reordering. `derived` when the key encodes the group's position, which
   * only holds while construction order is preserved. */
  readonly groupKeyKind: SourceCellGroupKeyKind;
  /** Ordinal of the cell within its group. */
  readonly cellIndex: number;
  /** Dimension of the cell itself, checked against the group. */
  readonly intrinsicDim: number;
  /** Its kind, checked against the group. */
  readonly cellKind: CellKind;
  /** Vertices per cell in the group, checked against it. */
  readonly verticesPerCell: number;
  /** The cell's own vertex indices, compared entry for entry — the fingerprint
   * that catches a complex rebuilt with the same shape but different content. */
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

/**
 * Where a queried vertex tuple sits in a group, and how it is stored there.
 *
 * `orientation` is reported rather than normalised because the two producers
 * that meet at this seam agree today by coincidence rather than by contract:
 * `sliceTetrahedra` emits its provenance pairs ascending, and every cell group
 * built in this package stores them ascending, so a caller who assumes the
 * orders match is right — until a complex arrives that stores one descending.
 *
 * The failure that assumption produces is silent. A reversed pair turns
 * parameter `t` into `1 - t`, and the mirrored point **stays collinear with the
 * correct edge**, so an "is this point on the edge?" check still passes. Only a
 * hyperplane residual catches it. Reporting the orientation makes the caller
 * decide, which is the one thing a silent mirror never lets them do.
 */
export interface SourceCellLookupMatchN {
  /** Discriminant, for narrowing against a miss. */
  readonly kind: 'source-cell-lookup-match';
  /** Ordinal of the matching cell within the group. */
  readonly cellIndex: number;
  /**
   * How the group stores the tuple relative to the query: `aligned` for the
   * same sequence, `reversed` for the exact reverse, `permuted` for the same
   * vertices in some other order. A parameter along the cell must be inverted
   * when this is `reversed`.
   */
  readonly orientation: 'aligned' | 'reversed' | 'permuted';
}

/** A queried vertex tuple that is not a cell of the group. */
export interface SourceCellLookupMissN {
  /** Discriminant, for narrowing against a match. */
  readonly kind: 'source-cell-lookup-miss';
  /**
   * `not-a-cell` — these vertices bound no cell of this group. The common
   * cause is a simplexization diagonal: a Kuhn decomposition cuts each cuboid
   * along its main diagonal, so most tetrahedron edges are diagonals rather
   * than 1-cells, and a point interpolated along one has no cell-level source
   * to name. Roughly three quarters of a tesseract section's vertices are in
   * this position. Resolve those through the parent-cell ordinal from
   * `simplexizeCuboidGroupN` instead.
   *
   * `arity-mismatch` — the tuple length does not match `verticesPerCell`, so
   * it could not name a cell of this group whatever its contents.
   */
  readonly reason: 'not-a-cell' | 'arity-mismatch';
}

/** The result of locating a vertex tuple in a group: found, or why not. */
export type SourceCellLookupN = SourceCellLookupMatchN | SourceCellLookupMissN;

/** Reusable vertex-tuple index over one group. */
export interface SourceCellLookupIndexN {
  /** The group this index was built over; lookups are only valid against it. */
  readonly group: CellGroup;
  /** Locate the cell whose vertex set equals `vertices`. */
  find(vertices: ArrayLike<number>): SourceCellLookupN;
}

const lookupKey = (vertices: ArrayLike<number>): string => {
  const sorted = Array.from(vertices as ArrayLike<number>).sort((a, b) => a - b);
  return sorted.join(',');
};

/**
 * Builds a reusable vertex-tuple → cell-index map over one group.
 *
 * This is the seam between the module that *produces* provenance and the one
 * that *models* it. `sliceTetrahedra` reports which source vertices a section
 * vertex was interpolated between; {@link createSourceCellReferenceN} needs the
 * cell's ordinal. Nothing bridged them, so every caller doing this wrote the
 * same linear scan — and wrote it without noticing the orientation question.
 *
 * Prefer this over {@link findSourceCellByVerticesN} when resolving more than a
 * handful of vertices: building the map is one pass over the group, after which
 * each lookup is constant-time rather than a scan.
 *
 * @example
 * ```ts
 * const complex = createHypercube({ dim: 4, size: 2 });
 * const edges = complex.cellsOfDim(1)[0]!;
 * const index = createSourceCellLookupN(edges);
 *
 * // A section vertex reported by `sliceTetrahedra` as lying `t` of the way
 * // from source vertex `from` to source vertex `to`.
 * const from = edges.indices[2]!;
 * const to = edges.indices[3]!;
 * const t = 0.25;
 *
 * const found = index.find([from, to]);
 * if (found.kind === 'source-cell-lookup-match') {
 *   const reference = createSourceCellReferenceN(complex, edges, found.cellIndex);
 *   // The stored edge may run the other way, which would mirror the parameter.
 *   const parameter = found.orientation === 'reversed' ? 1 - t : t;
 *   const point = evaluateSourceEdgeCoordinateN(
 *     createSourceEdgeCoordinateN(reference, parameter)
 *   );
 *   console.log(point.data[0]);
 * }
 * ```
 */
export function createSourceCellLookupN(group: CellGroup): SourceCellLookupIndexN {
  if (group === null || typeof group !== 'object') {
    throw new Error('createSourceCellLookupN: expected a CellGroup');
  }
  const arity = group.verticesPerCell;
  if (!Number.isSafeInteger(arity) || arity < 1) {
    throw new Error('createSourceCellLookupN: verticesPerCell must be a positive integer');
  }
  const cellCount = Math.floor(group.indices.length / arity);
  const byVertexSet = new Map<string, number>();
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
    const start = cellIndex * arity;
    const key = lookupKey(group.indices.subarray(start, start + arity));
    // First wins: a group listing the same vertex set twice is degenerate, and
    // silently preferring the later copy would hide it.
    if (!byVertexSet.has(key)) byVertexSet.set(key, cellIndex);
  }

  return Object.freeze({
    group,
    find(vertices: ArrayLike<number>): SourceCellLookupN {
      if (vertices.length !== arity) {
        return { kind: 'source-cell-lookup-miss', reason: 'arity-mismatch' };
      }
      const cellIndex = byVertexSet.get(lookupKey(vertices));
      if (cellIndex === undefined) {
        return { kind: 'source-cell-lookup-miss', reason: 'not-a-cell' };
      }
      const start = cellIndex * arity;
      let aligned = true;
      let reversed = true;
      for (let offset = 0; offset < arity; offset++) {
        const stored = group.indices[start + offset]!;
        if (stored !== vertices[offset]!) aligned = false;
        if (stored !== vertices[arity - 1 - offset]!) reversed = false;
      }
      return {
        kind: 'source-cell-lookup-match',
        cellIndex,
        // A 1-cell reversed is also a 1-cell permuted; `reversed` is the more
        // specific answer and the one that says how to fix the parameter.
        orientation: aligned ? 'aligned' : reversed ? 'reversed' : 'permuted'
      };
    }
  });
}

/**
 * Locates a single cell by its vertex tuple.
 *
 * A one-shot convenience over {@link createSourceCellLookupN}; it builds the
 * same index and discards it, so resolving many vertices through this is a
 * full pass per lookup.
 */
export function findSourceCellByVerticesN(
  group: CellGroup,
  vertices: ArrayLike<number>
): SourceCellLookupN {
  return createSourceCellLookupN(group).find(vertices);
}
