import {
  CellComplex,
  createHypercube,
  resolveSourceCellIdN,
  simplexizeCuboidGroupN,
  type CellGroup
} from '@holotope/core';
import { describe, expect, it } from 'vitest';
import { lumpSimplexMassesN } from '../src/index.js';

function squareTriangles(): CellComplex {
  return new CellComplex(2, new Float64Array([
    0, 0,
    1, 0,
    1, 1,
    0, 1
  ]), [{
    key: 'triangles',
    dim: 2,
    verticesPerCell: 3,
    kind: 'simplex',
    indices: new Uint32Array([0, 1, 2, 0, 2, 3])
  }]);
}

function embeddedTetrahedron(dimension: number, extraVertex = false): CellComplex {
  const vertexCount = extraVertex ? 5 : 4;
  const positions = new Float64Array(vertexCount * dimension);
  positions[dimension] = 1;
  positions[2 * dimension + 1] = 1;
  positions[3 * dimension + 2] = 1;
  if (extraVertex) positions[4 * dimension + dimension - 1] = 7;
  return new CellComplex(dimension, positions, [{
    key: 'tetrahedra',
    dim: 3,
    verticesPerCell: 4,
    kind: 'simplex',
    indices: new Uint32Array([0, 1, 2, 3])
  }]);
}

function expectCloseArray(actual: ArrayLike<number>, expected: readonly number[]): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < actual.length; index++) {
    expect(actual[index]!).toBeCloseTo(expected[index]!, 14);
  }
}

describe('intrinsic simplex mass lumping', () => {
  it('lumps analytic line and triangle masses equally onto incident vertices', () => {
    const line = new CellComplex(1, new Float64Array([0, 3]), [{
      key: 'line',
      dim: 1,
      verticesPerCell: 2,
      kind: 'simplex',
      indices: new Uint32Array([0, 1])
    }]);
    const lineMass = lumpSimplexMassesN({
      source: line,
      simplexGroup: line.groups[0]!,
      density: 2
    });
    expect(lineMass.totalElementMass).toBeCloseTo(6, 14);
    expectCloseArray(lineMass.vertexMasses, [3, 3]);

    const square = squareTriangles();
    const squareMass = lumpSimplexMassesN({
      source: square,
      simplexGroup: square.groups[0]!,
      density: 4
    });
    expect(squareMass.elements.map((element) => element.restMeasure)).toEqual([0.5, 0.5]);
    expect(squareMass.elements.map((element) => element.mass)).toEqual([2, 2]);
    expectCloseArray(squareMass.vertexMasses, [4 / 3, 2 / 3, 4 / 3, 2 / 3]);
    expect(squareMass.totalElementMass).toBeCloseTo(4, 14);
    expect(squareMass.totalVertexMass).toBeCloseTo(4, 14);
    expect(squareMass.massResidual).toBeCloseTo(0, 14);
  });

  it('uses intrinsic measure for embedded simplices and retains exact source ids', () => {
    const source = embeddedTetrahedron(6, true);
    const mass = lumpSimplexMassesN({
      source,
      simplexGroup: source.groups[0]!,
      density: (element) => {
        expect(Object.isFrozen(element)).toBe(true);
        expect(Object.isFrozen(element.sourceId)).toBe(true);
        expect(Object.isFrozen(element.sourceVertexIndices)).toBe(true);
        return 5;
      }
    });
    expect(mass.dimension).toBe(6);
    expect(mass.simplexDimension).toBe(3);
    expect(mass.elements[0]!.restMeasure).toBeCloseTo(1 / 6, 14);
    expect(mass.totalElementMass).toBeCloseTo(5 / 6, 14);
    expectCloseArray(mass.vertexMasses, [5 / 24, 5 / 24, 5 / 24, 5 / 24, 0]);
    expect(mass.unusedVertexCount).toBe(1);
    expect(resolveSourceCellIdN(source, mass.elements[0]!.sourceId).kind).toBe('resolved');
  });

  it('conserves total density-volume through a tesseract simplexization', () => {
    const source = createHypercube({ dim: 4, size: 2, maxCellDimension: 4 });
    const simplexization = simplexizeCuboidGroupN(source.cellsOfDim(4)[0]!, {
      outputKey: 'tesseract-simplices'
    });
    source.addGroup(simplexization.simplexGroup);
    const mass = lumpSimplexMassesN({
      source,
      simplexGroup: simplexization.simplexGroup,
      density: 1.5
    });
    expect(mass.elements).toHaveLength(24);
    expect(mass.totalElementMass).toBeCloseTo(24, 13);
    expect(mass.totalVertexMass).toBeCloseTo(24, 13);
    expect(mass.massResidual).toBeCloseTo(0, 13);
    expect(mass.unusedVertexCount).toBe(0);
  });

  it('obeys k-dimensional scaling independently of ambient dimension', () => {
    const base = embeddedTetrahedron(7);
    const scaled = embeddedTetrahedron(7);
    for (let index = 0; index < scaled.positions.length; index++) {
      scaled.positions[index]! *= 3;
    }
    const baseMass = lumpSimplexMassesN({
      source: base, simplexGroup: base.groups[0]!, density: 2
    });
    const scaledMass = lumpSimplexMassesN({
      source: scaled, simplexGroup: scaled.groups[0]!, density: 2
    });
    expect(scaledMass.totalElementMass / baseMass.totalElementMass).toBeCloseTo(27, 13);
  });

  it('rejects malformed topology, degeneracy, and density policies', () => {
    const source = embeddedTetrahedron(4);
    const group = source.groups[0]!;
    expect(() => lumpSimplexMassesN({
      source, simplexGroup: embeddedTetrahedron(4).groups[0]!, density: 1
    })).toThrow(/belong/);
    expect(() => lumpSimplexMassesN({
      source, simplexGroup: group, density: 0
    })).toThrow(/density/);
    expect(() => lumpSimplexMassesN({
      source, simplexGroup: group, density: () => Number.NaN
    })).toThrow(/density/);

    const repeated = embeddedTetrahedron(4);
    repeated.groups[0]!.indices = new Uint32Array([0, 1, 1, 3]);
    expect(() => lumpSimplexMassesN({
      source: repeated, simplexGroup: repeated.groups[0]!, density: 1
    })).toThrow(/repeats a vertex/);

    const degenerate = embeddedTetrahedron(4);
    degenerate.positions.set(degenerate.positions.subarray(0, 4), 4);
    expect(() => lumpSimplexMassesN({
      source: degenerate, simplexGroup: degenerate.groups[0]!, density: 1
    })).toThrow(/degenerate/);

    const wrongKind: CellGroup = {
      key: 'wrong-kind',
      dim: 3,
      verticesPerCell: 4,
      kind: 'cuboid',
      indices: new Uint32Array([0, 1, 2, 3])
    };
    source.addGroup(wrongKind);
    expect(() => lumpSimplexMassesN({
      source, simplexGroup: wrongKind, density: 1
    })).toThrow(/dim \+ 1 vertex simplices/);
  });
});
