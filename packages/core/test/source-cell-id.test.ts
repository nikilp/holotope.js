import { describe, expect, it } from 'vitest';
import {
  CellComplex,
  createSourceCellIdN,
  createSourceCellReferenceN,
  resolveSourceCellIdN
} from '../src/index.js';
import type { CellGroup, SourceCellIdN } from '../src/index.js';

const POSITIONS = new Float64Array([
  0, 0, 0, 0,
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0
]);

function edgeGroup(key?: string): CellGroup {
  return {
    ...(key === undefined ? {} : { key }),
    dim: 1,
    kind: 'simplex',
    verticesPerCell: 2,
    indices: new Uint32Array([0, 1, 1, 2])
  };
}

function faceGroup(key?: string): CellGroup {
  return {
    ...(key === undefined ? {} : { key }),
    dim: 2,
    kind: 'simplex',
    verticesPerCell: 3,
    indices: new Uint32Array([0, 1, 2])
  };
}

describe('SourceCellIdN', () => {
  it('resolves explicit group identity across reordering and regeneration', () => {
    const sourceEdges = edgeGroup('edges');
    const source = new CellComplex(4, POSITIONS.slice(), [sourceEdges, faceGroup('faces')]);
    const id = createSourceCellIdN(createSourceCellReferenceN(source, sourceEdges, 1));

    expect(id).toEqual({
      kind: 'source-cell-id',
      ambientDim: 4,
      groupKey: 'edges',
      groupKeyKind: 'explicit',
      cellIndex: 1,
      intrinsicDim: 1,
      cellKind: 'simplex',
      verticesPerCell: 2,
      vertexIndices: [1, 2]
    });

    const regeneratedEdges = edgeGroup('edges');
    const regenerated = new CellComplex(4, POSITIONS.slice(), [
      faceGroup('faces'),
      regeneratedEdges
    ]);
    regenerated.positions[4] = 7.5;
    const resolved = resolveSourceCellIdN(regenerated, id);
    expect(resolved.kind).toBe('resolved');
    if (resolved.kind !== 'resolved') return;
    expect(resolved.reference.group).toBe(regeneratedEdges);
    expect(resolved.reference.vertexIndices).toEqual([1, 2]);
  });

  it('labels fallback ids as derived and preserves them only with construction order', () => {
    const sourceEdges = edgeGroup();
    const source = new CellComplex(4, POSITIONS.slice(), [sourceEdges, faceGroup()]);
    const id = createSourceCellIdN(createSourceCellReferenceN(source, sourceEdges, 0));
    expect(id.groupKeyKind).toBe('derived');
    expect(id.groupKey).toBe('1:simplex:2:0');

    const sameOrderEdges = edgeGroup();
    const sameOrder = new CellComplex(4, POSITIONS.slice(), [sameOrderEdges, faceGroup()]);
    expect(resolveSourceCellIdN(sameOrder, id).kind).toBe('resolved');

    const reordered = new CellComplex(4, POSITIONS.slice(), [faceGroup(), edgeGroup()]);
    expect(resolveSourceCellIdN(reordered, id)).toEqual({
      kind: 'unavailable',
      reason: 'group-key-missing'
    });
  });

  it('returns typed topology refusals instead of retargeting the id', () => {
    const base = new CellComplex(4, POSITIONS.slice(), [edgeGroup('edges')]);
    const id = createSourceCellIdN(
      createSourceCellReferenceN(base, base.groups[0]!, 1)
    );

    expect(resolveSourceCellIdN(
      new CellComplex(4, POSITIONS.slice(), [edgeGroup('other')]),
      id
    )).toEqual({ kind: 'unavailable', reason: 'group-key-missing' });

    expect(resolveSourceCellIdN(
      new CellComplex(3, new Float64Array(POSITIONS.length / 4 * 3), [edgeGroup('edges')]),
      id
    )).toEqual({ kind: 'unavailable', reason: 'ambient-dimension-changed' });

    const metadataChanged = edgeGroup('edges');
    metadataChanged.dim = 2;
    expect(resolveSourceCellIdN(
      new CellComplex(4, POSITIONS.slice(), [metadataChanged]),
      id
    )).toEqual({ kind: 'unavailable', reason: 'group-metadata-changed' });

    const cellRemoved = edgeGroup('edges');
    cellRemoved.indices = new Uint32Array([0, 1]);
    expect(resolveSourceCellIdN(
      new CellComplex(4, POSITIONS.slice(), [cellRemoved]),
      id
    )).toEqual({ kind: 'unavailable', reason: 'cell-removed' });

    const tupleChanged = edgeGroup('edges');
    tupleChanged.indices = new Uint32Array([0, 1, 1, 3]);
    expect(resolveSourceCellIdN(
      new CellComplex(4, POSITIONS.slice(), [tupleChanged]),
      id
    )).toEqual({ kind: 'unavailable', reason: 'cell-vertices-changed' });
  });

  it('rejects invalid explicit keys and ambiguous key mutation', () => {
    expect(() => new CellComplex(4, POSITIONS.slice(), [
      edgeGroup('same'),
      faceGroup('same')
    ])).toThrow(/duplicate group key/);
    expect(() => new CellComplex(4, POSITIONS.slice(), [edgeGroup('  ')])).toThrow(
      /non-empty string/
    );

    const complex = new CellComplex(4, POSITIONS.slice(), [edgeGroup('edges')]);
    complex.groups.push(edgeGroup('edges'));
    const id: SourceCellIdN = {
      kind: 'source-cell-id',
      ambientDim: 4,
      groupKey: 'edges',
      groupKeyKind: 'explicit',
      cellIndex: 0,
      intrinsicDim: 1,
      cellKind: 'simplex',
      verticesPerCell: 2,
      vertexIndices: [0, 1]
    };
    expect(resolveSourceCellIdN(complex, id)).toEqual({
      kind: 'unavailable',
      reason: 'group-key-ambiguous'
    });
  });

  it('validates structural metadata before resolving a deserialized id', () => {
    const complex = new CellComplex(4, POSITIONS.slice(), [edgeGroup('edges')]);
    const id = createSourceCellIdN(
      createSourceCellReferenceN(complex, complex.groups[0]!, 0)
    );

    expect(() => resolveSourceCellIdN(complex, {
      ...id,
      intrinsicDim: -1
    })).toThrow(/intrinsicDim/);
    expect(() => resolveSourceCellIdN(complex, {
      ...id,
      cellKind: 'unknown'
    } as unknown as SourceCellIdN)).toThrow(/cellKind/);
    expect(() => resolveSourceCellIdN(complex, {
      ...id,
      vertexIndices: new Uint32Array([0, 1])
    } as unknown as SourceCellIdN)).toThrow(/vertexIndices/);
  });
});
