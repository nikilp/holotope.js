import { describe, expect, it } from 'vitest';
import {
  findIncidentCellsN,
  createHypercube,
  tetrahedralizeCuboidCells,
  type CellGroup
} from '@holotope/core';

describe('findIncidentCellsN', () => {
  it('finds every tetrahedron containing a retained boundary triangle', () => {
    const source = tetrahedralizeCuboidCells(
      createHypercube({ dim: 4, size: 2, maxCellDimension: 4 })
    );
    const faces = source.cellsOfDim(2)[0]!;
    const tetrahedra = source.cellsOfDim(3).find(
      (group) => group.kind === 'simplex'
    )!;
    const triangle = [
      faces.indices[0]!,
      faces.indices[1]!,
      faces.indices[2]!
    ];

    const incident = findIncidentCellsN(tetrahedra, triangle);

    expect(Array.from(incident)).toHaveLength(2);
    for (const cellIndex of incident) {
      const start = cellIndex * tetrahedra.verticesPerCell;
      const cell = new Set(
        tetrahedra.indices.subarray(start, start + tetrahedra.verticesPerCell)
      );
      expect(triangle.every((vertex) => cell.has(vertex))).toBe(true);
    }
  });

  it('is independent of query order and returns target cells in source order', () => {
    const group: CellGroup = {
      dim: 3,
      kind: 'simplex',
      verticesPerCell: 4,
      indices: Uint32Array.of(
        8, 2, 5, 1,
        7, 5, 2, 9,
        2, 5, 3, 4
      )
    };

    expect(Array.from(findIncidentCellsN(group, [2, 5]))).toEqual([0, 1, 2]);
    expect(Array.from(findIncidentCellsN(group, [5, 2]))).toEqual([0, 1, 2]);
    expect(Array.from(findIncidentCellsN(group, [8, 5]))).toEqual([0]);
    expect(Array.from(findIncidentCellsN(group, [8, 9]))).toEqual([]);
  });

  it('refuses empty, duplicate, and invalid vertex queries', () => {
    const group: CellGroup = {
      dim: 1,
      kind: 'simplex',
      verticesPerCell: 2,
      indices: Uint32Array.of(0, 1)
    };

    expect(() => findIncidentCellsN(group, [])).toThrow(/non-empty/);
    expect(() => findIncidentCellsN(group, [0, 0])).toThrow(/unique/);
    expect(() => findIncidentCellsN(group, [-1])).toThrow(/non-negative/);
    expect(() => findIncidentCellsN(group, [0.5])).toThrow(/safe integers/);
  });
});
