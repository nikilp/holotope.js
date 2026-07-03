import { describe, expect, it } from 'vitest';
import { createCrossPolytope, createHypercube, createSimplex } from '@holotope/core';

function pairwiseEdgeLengths(positions: Float64Array, dim: number, edges: Uint32Array): number[] {
  const lengths: number[] = [];
  for (let e = 0; e < edges.length; e += 2) {
    const a = edges[e]!;
    const b = edges[e + 1]!;
    let acc = 0;
    for (let c = 0; c < dim; c++) {
      const d = positions[a * dim + c]! - positions[b * dim + c]!;
      acc += d * d;
    }
    lengths.push(Math.sqrt(acc));
  }
  return lengths;
}

describe('createHypercube', () => {
  it('tesseract has the canonical cell counts', () => {
    const t = createHypercube({ dim: 4, size: 2 });
    expect(t.vertexCount).toBe(16);
    expect(t.cellCount(1)).toBe(32);
    expect(t.cellCount(2)).toBe(24);
  });

  it.each([
    [1, 2, 1],
    [2, 4, 4],
    [3, 8, 12],
    [5, 32, 80],
    [6, 64, 192]
  ])('n=%i cube has %i vertices and %i edges', (dim, vertices, edges) => {
    const c = createHypercube({ dim });
    expect(c.vertexCount).toBe(vertices);
    expect(c.cellCount(1)).toBe(edges);
  });

  it('all edges have the requested length', () => {
    const size = 3;
    const c = createHypercube({ dim: 4, size });
    const edgeGroup = c.cellsOfDim(1)[0]!;
    for (const len of pairwiseEdgeLengths(c.positions, 4, edgeGroup.indices)) {
      expect(len).toBeCloseTo(size, 12);
    }
  });

  it('is centered at the origin', () => {
    const c = createHypercube({ dim: 4 });
    const centroid = new Float64Array(4);
    for (let v = 0; v < c.vertexCount; v++) {
      for (let a = 0; a < 4; a++) centroid[a]! += c.positions[v * 4 + a]!;
    }
    for (let a = 0; a < 4; a++) expect(centroid[a]! / c.vertexCount).toBeCloseTo(0, 14);
  });
});

describe('createSimplex', () => {
  it.each([2, 3, 4, 5, 7])('n=%i simplex is regular with the requested edge length', (dim) => {
    const edgeLength = 1.5;
    const s = createSimplex({ dim, edgeLength });
    expect(s.vertexCount).toBe(dim + 1);
    expect(s.cellCount(1)).toBe(((dim + 1) * dim) / 2);
    // Regularity: every pair of vertices (all of which are edges) is
    // exactly edgeLength apart.
    const edgeGroup = s.cellsOfDim(1)[0]!;
    for (const len of pairwiseEdgeLengths(s.positions, dim, edgeGroup.indices)) {
      expect(len).toBeCloseTo(edgeLength, 10);
    }
  });

  it('is centered at the origin', () => {
    const s = createSimplex({ dim: 4 });
    const centroid = new Float64Array(4);
    for (let v = 0; v < s.vertexCount; v++) {
      for (let a = 0; a < 4; a++) centroid[a]! += s.positions[v * 4 + a]!;
    }
    for (let a = 0; a < 4; a++) expect(centroid[a]! / s.vertexCount).toBeCloseTo(0, 12);
  });
});

describe('createCrossPolytope', () => {
  it('16-cell has canonical counts and edge lengths', () => {
    const radius = 2;
    const c = createCrossPolytope({ dim: 4, radius });
    expect(c.vertexCount).toBe(8);
    expect(c.cellCount(1)).toBe(24); // 2n(n-1) = 24 for the 16-cell
    const edgeGroup = c.cellsOfDim(1)[0]!;
    for (const len of pairwiseEdgeLengths(c.positions, 4, edgeGroup.indices)) {
      expect(len).toBeCloseTo(radius * Math.SQRT2, 12);
    }
  });

  it.each([
    [2, 4, 4],
    [3, 6, 12],
    [5, 10, 40]
  ])('n=%i orthoplex has %i vertices and %i edges', (dim, vertices, edges) => {
    const c = createCrossPolytope({ dim });
    expect(c.vertexCount).toBe(vertices);
    expect(c.cellCount(1)).toBe(edges);
  });
});
