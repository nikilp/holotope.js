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
    expect(c.cellCount(2)).toBe(32); // C(4,3)·2³ triangles
    expect(c.cellCount(3)).toBe(16); // C(4,4)·2⁴ tetrahedral cells
    // No triangle may contain an antipodal pair (they'd be degenerate).
    const triangles = c.cellsOfDim(2)[0]!.indices;
    for (let t = 0; t < triangles.length; t += 3) {
      for (let i = 0; i < 3; i++) {
        for (let j = i + 1; j < 3; j++) {
          expect(Math.abs(triangles[t + i]! - triangles[t + j]!)).not.toBe(4);
        }
      }
    }
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

describe('createCliffordCurve', () => {
  it('every vertex lies on the 3-sphere and on the Clifford torus', async () => {
    const { createCliffordCurve } = await import('@holotope/core');
    const curve = createCliffordCurve({ p: 2, q: 3, radius: 1.5, segments: 128 });
    expect(curve.vertexCount).toBe(128);
    const half = (1.5 * 1.5) / 2;
    for (let v = 0; v < curve.vertexCount; v++) {
      const [x0, x1, x2, x3] = [0, 1, 2, 3].map((c) => curve.positions[v * 4 + c]!);
      expect(Math.hypot(x0, x1, x2, x3)).toBeCloseTo(1.5, 12);
      // Equal radii: the xy and zw circles each carry half the square radius.
      expect(x0! * x0! + x1! * x1!).toBeCloseTo(half, 12);
    }
  });

  it('is a single closed polyline: every vertex has degree 2', async () => {
    const { createCliffordCurve } = await import('@holotope/core');
    const curve = createCliffordCurve({ segments: 64 });
    const edges = curve.cellsOfDim(1)[0]!.indices;
    expect(edges.length).toBe(64 * 2);
    const degree = new Uint32Array(64);
    for (const idx of edges) degree[idx]!++;
    for (const d of degree) expect(d).toBe(2);
  });

  it('rejects non-integer windings and degenerate segment counts', async () => {
    const { createCliffordCurve } = await import('@holotope/core');
    expect(() => createCliffordCurve({ p: 1.5 })).toThrow(/positive integers/);
    expect(() => createCliffordCurve({ segments: 2 })).toThrow(/at least 3/);
  });
});

describe('createHopfFiber', () => {
  it('every fiber point maps to its base under the Hopf map', async () => {
    const { createHopfFiber } = await import('@holotope/core');
    const hopf = (x0: number, x1: number, x2: number, x3: number): number[] => [
      2 * (x0 * x2 + x1 * x3),
      2 * (x1 * x2 - x0 * x3),
      x2 * x2 + x3 * x3 - x0 * x0 - x1 * x1
    ];
    for (const base of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.3, -0.5, 0.8], [0, 0, -1]] as const) {
      const fiber = createHopfFiber({ base: [...base] as [number, number, number], radius: 2 });
      const n = Math.hypot(...base);
      for (let v = 0; v < fiber.vertexCount; v++) {
        const [x0, x1, x2, x3] = [0, 1, 2, 3].map((c) => fiber.positions[v * 4 + c]! / 2);
        // On the unit sphere and over the right base point.
        expect(Math.hypot(x0!, x1!, x2!, x3!)).toBeCloseTo(1, 12);
        const h = hopf(x0!, x1!, x2!, x3!);
        expect(h[0]).toBeCloseTo(base[0] / n, 10);
        expect(h[1]).toBeCloseTo(base[1] / n, 10);
        expect(h[2]).toBeCloseTo(base[2] / n, 10);
      }
    }
  });

  it('distinct fibers are disjoint', async () => {
    const { createHopfFiber } = await import('@holotope/core');
    const f1 = createHopfFiber({ base: [0, 0, 1], segments: 32 });
    const f2 = createHopfFiber({ base: [1, 0, 0], segments: 32 });
    for (let i = 0; i < 32; i++) {
      for (let j = 0; j < 32; j++) {
        let d = 0;
        for (let c = 0; c < 4; c++) d += (f1.positions[i * 4 + c]! - f2.positions[j * 4 + c]!) ** 2;
        expect(d).toBeGreaterThan(0.01);
      }
    }
  });
});
