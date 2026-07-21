import { describe, expect, it } from 'vitest';
import {
  createHypercube,
  simplexizeCuboidGroupN,
  tetrahedralizeCuboidCells,
  type CellGroup
} from '@holotope/core';

const LEGACY_GROUP_HASHES = [
  ['1:2:2:1076963a'],
  ['1:2:8:b8ba9d53', '2:4:4:e4acc43b'],
  ['1:2:24:dd4a9bd5', '2:4:24:4c2ba379', '3:8:8:6bf6a41d'],
  ['1:2:64:75049fc5', '2:4:96:4feca46d', '3:8:64:3717c6ed'],
  ['1:2:160:3014099d', '2:4:320:e3467435', '3:8:320:6a648825'],
  ['1:2:384:15467ef5', '2:4:960:0f8f9505', '3:8:1280:05b1a145']
] as const;

function hashIndices(indices: Uint32Array): string {
  let hash = 2166136261;
  for (const index of indices) {
    hash ^= index;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function choose(n: number, k: number): number {
  let value = 1;
  for (let index = 1; index <= k; index++) value = value * (n - index + 1) / index;
  return value;
}

function factorial(value: number): number {
  let result = 1;
  for (let factor = 2; factor <= value; factor++) result *= factor;
  return result;
}

function determinant(source: number[][]): number {
  const matrix = source.map((row) => [...row]);
  let sign = 1;
  let result = 1;
  for (let column = 0; column < matrix.length; column++) {
    let pivot = column;
    for (let row = column + 1; row < matrix.length; row++) {
      if (Math.abs(matrix[row]![column]!) > Math.abs(matrix[pivot]![column]!)) {
        pivot = row;
      }
    }
    if (matrix[pivot]![column] === 0) return 0;
    if (pivot !== column) {
      [matrix[pivot], matrix[column]] = [matrix[column]!, matrix[pivot]!];
      sign = -sign;
    }
    const diagonal = matrix[column]![column]!;
    result *= diagonal;
    for (let row = column + 1; row < matrix.length; row++) {
      const scale = matrix[row]![column]! / diagonal;
      for (let trailing = column + 1; trailing < matrix.length; trailing++) {
        matrix[row]![trailing] = matrix[row]![trailing]! -
          scale * matrix[column]![trailing]!;
      }
    }
  }
  return result * sign;
}

function simplexMeasure(
  positions: Float64Array,
  ambientDimension: number,
  vertices: readonly number[]
): number {
  const dimension = vertices.length - 1;
  const edges = vertices.slice(1).map((vertex) =>
    Array.from({ length: ambientDimension }, (_, axis) =>
      positions[vertex * ambientDimension + axis]! -
      positions[vertices[0]! * ambientDimension + axis]!
    ));
  const gram = Array.from({ length: dimension }, (_, row) =>
    Array.from({ length: dimension }, (_, column) =>
      edges[row]!.reduce(
        (dot, coordinate, axis) => dot + coordinate * edges[column]![axis]!,
        0
      )));
  return Math.sqrt(Math.max(0, determinant(gram))) / factorial(dimension);
}

describe('opt-in N-cube cell topology', () => {
  it('keeps every established default group byte-for-byte stable', () => {
    for (let dimension = 1; dimension <= 6; dimension++) {
      const complex = createHypercube({ dim: dimension });
      expect(complex.groups.map((group) =>
        `${group.dim}:${group.verticesPerCell}:${group.indices.length}:${hashIndices(group.indices)}`
      )).toEqual(LEGACY_GROUP_HASHES[dimension - 1]);
      expect(complex.groups.every((group) => group.dim <= 3)).toBe(true);
    }
  });

  it('authors every requested cuboid dimension with canonical counts', () => {
    for (let dimension = 4; dimension <= 7; dimension++) {
      const complex = createHypercube({
        dim: dimension,
        maxCellDimension: dimension
      });
      for (let cellDimension = 1; cellDimension <= dimension; cellDimension++) {
        const groups = complex.cellsOfDim(cellDimension);
        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({
          dim: cellDimension,
          verticesPerCell: 2 ** cellDimension,
          kind: 'cuboid'
        });
        expect(groups[0]!.indices.length / groups[0]!.verticesPerCell).toBe(
          choose(dimension, cellDimension) * 2 ** (dimension - cellDimension)
        );
      }
    }
  });

  it('gives a tesseract one 4-cell and a 5-cube its ten 4-cells plus one 5-cell', () => {
    const tesseract = createHypercube({ dim: 4, maxCellDimension: 4 });
    const cell4 = tesseract.cellsOfDim(4)[0]!;
    expect(cell4.indices).toEqual(Uint32Array.from({ length: 16 }, (_, index) => index));

    const cube5 = createHypercube({ dim: 5, maxCellDimension: 5 });
    expect(cube5.cellCount(4)).toBe(10);
    expect(cube5.cellCount(5)).toBe(1);
    expect(cube5.cellsOfDim(5)[0]!.indices).toEqual(
      Uint32Array.from({ length: 32 }, (_, index) => index)
    );
  });

  it('allows a deliberate lower-dimensional topology ceiling and validates it', () => {
    const skeleton = createHypercube({ dim: 5, maxCellDimension: 1 });
    expect(skeleton.groups).toHaveLength(1);
    expect(skeleton.groups[0]!.dim).toBe(1);
    expect(() => createHypercube({ dim: 4, maxCellDimension: 0 })).toThrow(
      /maxCellDimension/
    );
    expect(() => createHypercube({ dim: 4, maxCellDimension: 5 })).toThrow(
      /maxCellDimension/
    );
    expect(() => createHypercube({ dim: 4, maxCellDimension: 2.5 })).toThrow(
      /maxCellDimension/
    );
  });
});

describe('dimension-generic cuboid Kuhn simplexization', () => {
  it('reproduces the established cube tetrahedra byte-for-byte', () => {
    const cube = createHypercube({ dim: 3 });
    const cuboids = cube.cellsOfDim(3)[0]!;
    const generic = simplexizeCuboidGroupN(cuboids);
    const legacy = tetrahedralizeCuboidCells(createHypercube({ dim: 3 }))
      .cellsOfDim(3)
      .find((group) => group.kind === 'simplex')!;

    expect(generic.simplexGroup.indices).toEqual(legacy.indices);
    expect(Array.from(generic.simplexGroup.indices)).toEqual([
      0, 1, 3, 7,
      0, 1, 5, 7,
      0, 2, 3, 7,
      0, 2, 6, 7,
      0, 4, 5, 7,
      0, 4, 6, 7
    ]);
    expect(generic.permutations).toEqual([
      [0, 1, 2], [0, 2, 1], [1, 0, 2],
      [1, 2, 0], [2, 0, 1], [2, 1, 0]
    ]);
  });

  it('partitions unit k-cuboids into k! equal-measure simplices for k=1...5', () => {
    for (let dimension = 1; dimension <= 5; dimension++) {
      const complex = createHypercube({
        dim: dimension,
        maxCellDimension: dimension
      });
      const cuboid = complex.cellsOfDim(dimension)[0]!;
      const result = simplexizeCuboidGroupN(cuboid);
      const expectedCount = factorial(dimension);
      expect(result.simplicesPerCell).toBe(expectedCount);
      expect(result.simplexGroup.indices.length / (dimension + 1)).toBe(expectedCount);
      let totalMeasure = 0;
      for (let simplex = 0; simplex < expectedCount; simplex++) {
        const start = simplex * (dimension + 1);
        const vertices = Array.from(
          result.simplexGroup.indices.subarray(start, start + dimension + 1)
        );
        const measure = simplexMeasure(complex.positions, dimension, vertices);
        expect(measure).toBeCloseTo(1 / expectedCount, 13);
        totalMeasure += measure;
      }
      expect(totalMeasure).toBeCloseTo(1, 13);
    }
  });

  it('maps a tesseract 4-cell to 24 identified 4-simplices', () => {
    const complex = createHypercube({ dim: 4, maxCellDimension: 4 });
    const result = simplexizeCuboidGroupN(complex.cellsOfDim(4)[0]!, {
      outputKey: 'tesseract-volume-simplices'
    });

    expect(result).toMatchObject({
      dimension: 4,
      sourceCellCount: 1,
      simplicesPerCell: 24
    });
    expect(result.simplexGroup).toMatchObject({
      key: 'tesseract-volume-simplices',
      dim: 4,
      verticesPerCell: 5,
      kind: 'simplex'
    });
    expect(result.sourceCellIndices).toEqual(new Uint32Array(24));
    expect(result.permutationIndices).toEqual(
      Uint32Array.from({ length: 24 }, (_, index) => index)
    );
  });

  it('preserves monotone parent/permutation provenance over multiple cells', () => {
    const complex = createHypercube({ dim: 5, maxCellDimension: 4 });
    const result = simplexizeCuboidGroupN(complex.cellsOfDim(4)[0]!);
    expect(result.sourceCellCount).toBe(10);
    expect(result.simplexGroup.indices.length / 5).toBe(240);
    for (let output = 0; output < 240; output++) {
      expect(result.sourceCellIndices[output]).toBe(Math.floor(output / 24));
      expect(result.permutationIndices[output]).toBe(output % 24);
    }
  });

  it('refuses malformed groups and output budgets before allocation', () => {
    const valid = createHypercube({ dim: 4, maxCellDimension: 4 }).cellsOfDim(4)[0]!;
    const candidate = (changes: Partial<CellGroup>): CellGroup => ({
      ...valid,
      indices: valid.indices.slice(),
      ...changes
    });
    expect(() => simplexizeCuboidGroupN(candidate({ kind: 'simplex' }))).toThrow(
      /cuboids/
    );
    expect(() => simplexizeCuboidGroupN(candidate({ dim: 0 }))).toThrow(/dimension/);
    expect(() => simplexizeCuboidGroupN(candidate({ verticesPerCell: 15 }))).toThrow(
      /16-vertex/
    );
    expect(() => simplexizeCuboidGroupN(candidate({ indices: new Uint32Array() }))).toThrow(
      /complete/
    );
    expect(() => simplexizeCuboidGroupN(candidate({
      indices: valid.indices.subarray(0, 15)
    }))).toThrow(/complete/);
    expect(() => simplexizeCuboidGroupN(valid, { outputKey: ' ' })).toThrow(
      /outputKey/
    );
    expect(() => simplexizeCuboidGroupN(valid, { maxOutputCells: 0 })).toThrow(
      /positive integer/
    );
    expect(() => simplexizeCuboidGroupN(valid, { maxOutputCells: 23 })).toThrow(
      /budget/
    );

    const cuboid10: CellGroup = {
      dim: 10,
      verticesPerCell: 1024,
      kind: 'cuboid',
      indices: new Uint32Array(1024)
    };
    expect(() => simplexizeCuboidGroupN(cuboid10)).toThrow(/budget/);
  });
});
