import { describe, expect, it } from 'vitest';
import {
  CellComplex,
  MatN,
  createHypercube,
  createSimplex,
  eigenspaceProjector,
  graphLaplacian,
  graphLaplacianModes,
  rotationFromPlanes,
  symmetricEigenDecomposition
} from '@holotope/core';

function complexFromEdges(
  vertexCount: number,
  edges: readonly number[],
  ambientDim = 2
): CellComplex {
  return new CellComplex(ambientDim, new Float64Array(vertexCount * ambientDim), [
    {
      dim: 1,
      verticesPerCell: 2,
      kind: 'simplex',
      indices: Uint32Array.from(edges)
    }
  ]);
}

function expectArrayClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  digits = 10
): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < actual.length; index++) {
    expect(actual[index]!).toBeCloseTo(expected[index]!, digits);
  }
}

function diagonalMatrix(values: ArrayLike<number>): MatN {
  const matrix = new MatN(values.length);
  for (let index = 0; index < values.length; index++) matrix.set(index, index, values[index]!);
  return matrix;
}

describe('symmetricEigenDecomposition', () => {
  it('recovers synthetic distinct and repeated spectra from dimensions 2 through 12', () => {
    for (let n = 2; n <= 12; n++) {
      const expected = Float64Array.from(
        { length: n },
        (_, index) => Math.floor(index / 2) + n / 10
      );
      const planes = [];
      for (let left = 0; left < n; left++) {
        for (let right = left + 1; right < n; right++) {
          planes.push({
            i: left,
            j: right,
            angle: ((left + 1) * (right + 2)) / (17 * n)
          });
        }
      }
      const q = rotationFromPlanes(n, planes);
      const matrix = q.multiply(diagonalMatrix(expected)).multiply(q.transpose());
      const result = symmetricEigenDecomposition(matrix, { tolerance: 1e-13 });

      expectArrayClose(result.values, expected, 10);
      expect(result.orthogonalityError).toBeLessThan(2e-12);
      expect(result.maxResidual).toBeLessThan(2e-11);

      const reconstructed = result.vectors
        .multiply(diagonalMatrix(result.values))
        .multiply(result.vectors.transpose());
      expectArrayClose(reconstructed.data, matrix.data, 10);

      const trace = Array.from(result.values).reduce((sum, value) => sum + value, 0);
      const expectedTrace = Array.from(expected).reduce((sum, value) => sum + value, 0);
      expect(trace).toBeCloseTo(expectedTrace, 11);
      const spectralFrobeniusSquared = Array.from(result.values)
        .reduce((sum, value) => sum + value * value, 0);
      const matrixFrobeniusSquared = Array.from(matrix.data)
        .reduce((sum, value) => sum + value * value, 0);
      expect(spectralFrobeniusSquared).toBeCloseTo(matrixFrobeniusSquared, 10);
    }
  });

  it('uses deterministic signs for non-degenerate eigenvectors', () => {
    const rotation = rotationFromPlanes(4, [
      { i: 0, j: 2, angle: 0.31 },
      { i: 1, j: 3, angle: -0.73 },
      { i: 0, j: 1, angle: 0.19 }
    ]);
    const matrix = rotation
      .multiply(diagonalMatrix([1, 2, 4, 8]))
      .multiply(rotation.transpose());
    const first = symmetricEigenDecomposition(matrix);
    const second = symmetricEigenDecomposition(matrix);
    expect(first.vectors.data).toEqual(second.vectors.data);
    for (let col = 0; col < 4; col++) {
      let largestRow = 0;
      for (let row = 1; row < 4; row++) {
        if (Math.abs(first.vectors.get(row, col)) > Math.abs(first.vectors.get(largestRow, col))) {
          largestRow = row;
        }
      }
      expect(first.vectors.get(largestRow, col)).toBeGreaterThan(0);
    }
  });

  it('rejects invalid inputs and reports nonconvergence', () => {
    expect(() => symmetricEigenDecomposition(new MatN(2, [1, 2, 3, 4])))
      .toThrow(/symmetric/);
    expect(() => symmetricEigenDecomposition(new MatN(1, [Number.NaN])))
      .toThrow(/finite/);
    expect(() => symmetricEigenDecomposition(MatN.identity(2), { tolerance: 0 }))
      .toThrow(/tolerance/);

    const n = 12;
    const rotation = rotationFromPlanes(n, Array.from({ length: n - 1 }, (_, index) => ({
      i: index,
      j: index + 1,
      angle: 0.47 + index * 0.03
    })));
    const matrix = rotation
      .multiply(diagonalMatrix(Float64Array.from({ length: n }, (_, index) => index + 1)))
      .multiply(rotation.transpose());
    expect(() => symmetricEigenDecomposition(matrix, { tolerance: 1e-16, maxSweeps: 1 }))
      .toThrow(/failed to converge/);
  });
});

describe('graphLaplacian', () => {
  it('constructs an exact simple-graph operator and exposes deduplication', () => {
    const complex = complexFromEdges(3, [1, 0, 1, 2, 2, 1]);
    const operator = graphLaplacian(complex);
    expect(Array.from(operator.edges)).toEqual([0, 1, 1, 2]);
    expect(Array.from(operator.degrees)).toEqual([1, 2, 1]);
    expect(operator.diagnostics).toEqual({
      inputEdgeCount: 3,
      uniqueEdgeCount: 2,
      duplicateEdgeCount: 1
    });
    expect(Array.from(operator.toDense().data)).toEqual([
      1, -1, 0,
      -1, 2, -1,
      0, -1, 1
    ]);
    for (let row = 0; row < 3; row++) {
      let sum = 0;
      for (let col = 0; col < 3; col++) sum += operator.toDense().get(row, col);
      expect(sum).toBe(0);
    }
  });

  it('matches sparse and dense application, including aliased output', () => {
    const operator = graphLaplacian(complexFromEdges(4, [0, 1, 1, 2, 2, 3, 3, 0]));
    const values = new Float64Array([2, -1, 4, 0.5]);
    const sparse = operator.apply(values);
    const dense = new Float64Array(4);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        dense[row]! += operator.toDense().get(row, col) * values[col]!;
      }
    }
    expectArrayClose(sparse, dense, 14);
    const aliased = values.slice();
    expect(operator.apply(aliased, aliased)).toBe(aliased);
    expectArrayClose(aliased, dense, 14);
  });

  it('satisfies the exact graph-energy identity', () => {
    const operator = graphLaplacian(complexFromEdges(5, [0, 1, 0, 3, 1, 4, 2, 4]));
    const values = new Float64Array([3, -2, 0.5, 7, -1]);
    const applied = operator.apply(values);
    let quadratic = 0;
    for (let vertex = 0; vertex < values.length; vertex++) {
      quadratic += values[vertex]! * applied[vertex]!;
    }
    let edgeEnergy = 0;
    for (let offset = 0; offset < operator.edges.length; offset += 2) {
      const difference = values[operator.edges[offset]!]! - values[operator.edges[offset + 1]!]!;
      edgeEnergy += difference * difference;
    }
    expect(quadratic).toBe(edgeEnergy);
  });

  it('finds canonical connected components including isolated vertices', () => {
    const operator = graphLaplacian(complexFromEdges(6, [0, 2, 1, 4, 4, 5]));
    expect(operator.componentCount).toBe(3);
    expect(Array.from(operator.componentOfVertex)).toEqual([0, 1, 0, 2, 1, 1]);
  });

  it('rejects ambiguous 1-cells, self-loops, and empty complexes', () => {
    expect(() => graphLaplacian(complexFromEdges(2, [0, 0]))).toThrow(/self-loop/);
    const malformed = new CellComplex(2, new Float64Array(6), [{
      dim: 1,
      verticesPerCell: 3,
      kind: 'simplex',
      indices: Uint32Array.from([0, 1, 2])
    }]);
    expect(() => graphLaplacian(malformed)).toThrow(/verticesPerCell/);
    expect(() => graphLaplacian(new CellComplex(2, new Float64Array()))).toThrow(/one vertex/);
  });
});

describe('graphLaplacianModes', () => {
  it('matches the analytic C4 spectrum and repeated eigenspace', () => {
    const modes = graphLaplacianModes(complexFromEdges(4, [0, 1, 1, 2, 2, 3, 3, 0]));
    expectArrayClose(modes.eigensystem.values, [0, 2, 2, 4], 11);
    expect(modes.clusters.map(({ multiplicity }) => multiplicity)).toEqual([1, 2, 1]);
    const repeated = modes.clusters[1]!;
    const projector = eigenspaceProjector(modes.eigensystem, repeated);
    expectArrayClose(projector.multiply(projector).data, projector.data, 11);
    let trace = 0;
    for (let index = 0; index < 4; index++) trace += projector.get(index, index);
    expect(trace).toBeCloseTo(2, 11);
    expectArrayClose(projector.transpose().data, projector.data, 11);
  });

  it('matches complete-graph spectra from regular simplices', () => {
    for (let dimension = 1; dimension <= 6; dimension++) {
      const vertexCount = dimension + 1;
      const modes = graphLaplacianModes(createSimplex({ dim: dimension }));
      const expected = [0, ...new Array(vertexCount - 1).fill(vertexCount)];
      expectArrayClose(modes.eigensystem.values, expected, 10);
      expect(modes.clusters.map(({ multiplicity }) => multiplicity)).toEqual([1, vertexCount - 1]);
    }
  });

  it('matches Q_d eigenvalues 2k with binomial multiplicities', () => {
    for (let dimension = 1; dimension <= 5; dimension++) {
      const modes = graphLaplacianModes(createHypercube({ dim: dimension }));
      const expected: number[] = [];
      for (let k = 0; k <= dimension; k++) {
        expected.push(...new Array(binomial(dimension, k)).fill(2 * k));
      }
      expectArrayClose(modes.eigensystem.values, expected, 9);
      expect(modes.clusters.map(({ multiplicity }) => multiplicity))
        .toEqual(Array.from({ length: dimension + 1 }, (_, k) => binomial(dimension, k)));
    }
  });

  it('equates zero-mode multiplicity with exact component count', () => {
    const modes = graphLaplacianModes(complexFromEdges(5, [0, 1, 2, 3]));
    expect(modes.operator.componentCount).toBe(3);
    expect(modes.clusters[0]!.multiplicity).toBe(3);
    expect(Math.abs(modes.clusters[0]!.value)).toBeLessThan(1e-12);
  });

  it('is independent of ambient embedding, translation, rotation, and scale', () => {
    const edges = [0, 1, 1, 2, 2, 3, 1, 3];
    const spectra: Float64Array[] = [];
    for (const ambientDim of [2, 4, 7]) {
      const complex = complexFromEdges(4, edges, ambientDim);
      for (let vertex = 0; vertex < complex.vertexCount; vertex++) {
        for (let axis = 0; axis < ambientDim; axis++) {
          complex.positions[vertex * ambientDim + axis] =
            13 + 2.7 * (vertex + 1) * Math.cos((axis + 1) * 0.43);
        }
      }
      spectra.push(graphLaplacianModes(complex).eigensystem.values);
    }
    expectArrayClose(spectra[1]!, spectra[0]!, 13);
    expectArrayClose(spectra[2]!, spectra[0]!, 13);
  });

  it('transports repeated eigenspaces correctly under vertex permutation', () => {
    const edges = [0, 1, 1, 2, 2, 3, 3, 0];
    const permutation = [2, 0, 3, 1];
    const permutedEdges = edges.map((vertex) => permutation[vertex]!);
    const original = graphLaplacianModes(complexFromEdges(4, edges));
    const permuted = graphLaplacianModes(complexFromEdges(4, permutedEdges));
    const originalProjector = eigenspaceProjector(original.eigensystem, original.clusters[1]!);
    const permutedProjector = eigenspaceProjector(permuted.eigensystem, permuted.clusters[1]!);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        expect(permutedProjector.get(permutation[row]!, permutation[col]!))
          .toBeCloseTo(originalProjector.get(row, col), 11);
      }
    }
  });
});

function binomial(n: number, k: number): number {
  let result = 1;
  for (let index = 1; index <= k; index++) result = (result * (n - index + 1)) / index;
  return result;
}
