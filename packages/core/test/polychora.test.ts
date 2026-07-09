import { describe, expect, it } from 'vitest';
import {
  HyperplaneSlice4,
  create24Cell,
  createCrossPolytope,
  createSimplex,
  sliceTetrahedra,
  type CellComplex
} from '@holotope/core';

/** 3-volume of a tetra embedded in R^4 via the Gram determinant. */
function tetraVolume4(positions: Float64Array, a: number, b: number, c: number, d: number): number {
  const e = [b, c, d].map((v) => {
    const edge = new Float64Array(4);
    for (let k = 0; k < 4; k++) edge[k] = positions[v * 4 + k]! - positions[a * 4 + k]!;
    return edge;
  });
  const g = (i: number, j: number) => {
    let acc = 0;
    for (let k = 0; k < 4; k++) acc += e[i]![k]! * e[j]![k]!;
    return acc;
  };
  const det =
    g(0, 0) * (g(1, 1) * g(2, 2) - g(1, 2) * g(2, 1)) -
    g(0, 1) * (g(1, 0) * g(2, 2) - g(1, 2) * g(2, 0)) +
    g(0, 2) * (g(1, 0) * g(2, 1) - g(1, 1) * g(2, 0));
  return Math.sqrt(Math.max(0, det)) / 6;
}

function boundaryVolume(complex: CellComplex): number {
  let volume = 0;
  for (const g of complex.cellsOfDim(3).filter((g) => g.kind === 'simplex')) {
    for (let t = 0; t < g.indices.length; t += 4) {
      volume += tetraVolume4(
        complex.positions,
        g.indices[t]!,
        g.indices[t + 1]!,
        g.indices[t + 2]!,
        g.indices[t + 3]!
      );
    }
  }
  return volume;
}

function sliceArea(complex: CellComplex, offset: number): number {
  const tetGroup = complex.cellsOfDim(3).find((g) => g.kind === 'simplex')!;
  const out = new Float32Array((tetGroup.indices.length / 4) * 18);
  const count = sliceTetrahedra(
    complex.positions,
    tetGroup.indices,
    HyperplaneSlice4.axisAligned(3, offset),
    out
  );
  let area = 0;
  for (let t = 0; t < count; t += 3) {
    const o = t * 3;
    const ux = out[o + 3]! - out[o]!, uy = out[o + 4]! - out[o + 1]!, uz = out[o + 5]! - out[o + 2]!;
    const vx = out[o + 6]! - out[o]!, vy = out[o + 7]! - out[o + 1]!, vz = out[o + 8]! - out[o + 2]!;
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return area;
}

describe('create24Cell', () => {
  it('has the canonical counts: 24 vertices, 96 edges, 96 triangles, 24 cells → 96 tets', () => {
    const c = create24Cell();
    expect(c.vertexCount).toBe(24);
    expect(c.cellCount(1)).toBe(96);
    expect(c.cellCount(2)).toBe(96);
    expect(c.cellCount(3)).toBe(96);
  });

  it('edge length equals the circumradius (the 24-cell speciality)', () => {
    const radius = 1.5;
    const c = create24Cell({ radius });
    const edges = c.cellsOfDim(1)[0]!;
    for (let e = 0; e < edges.indices.length; e += 2) {
      const a = edges.indices[e]!;
      const b = edges.indices[e + 1]!;
      let acc = 0;
      for (let k = 0; k < 4; k++) acc += (c.positions[a * 4 + k]! - c.positions[b * 4 + k]!) ** 2;
      expect(Math.sqrt(acc)).toBeCloseTo(radius, 10);
    }
  });

  it('boundary 3-volume is 8√2·r³ (24 octahedra)', () => {
    const radius = 1;
    const c = create24Cell({ radius });
    expect(boundaryVolume(c)).toBeCloseTo(8 * Math.SQRT2 * radius ** 3, 10);
  });

  it('the w=0 cross-section is a cuboctahedron: area (6 + 2√3)·r²', () => {
    const c = create24Cell({ radius: 1 });
    expect(sliceArea(c, 0)).toBeCloseTo(6 + 2 * Math.sqrt(3), 4);
  });
});

describe('5-cell (4-simplex) boundary cells', () => {
  it('has 5 tetrahedral cells with total volume 5·a³/(6√2)', () => {
    const edgeLength = 1.25;
    const c = createSimplex({ dim: 4, edgeLength });
    expect(c.cellCount(3)).toBe(5);
    expect(boundaryVolume(c)).toBeCloseTo((5 * edgeLength ** 3) / (6 * Math.SQRT2), 10);
  });

  it('is sliceable through its centroid', () => {
    const c = createSimplex({ dim: 4 });
    expect(sliceArea(c, 0)).toBeGreaterThan(0);
  });
});

describe('16-cell (4-orthoplex) boundary cells', () => {
  it('has 16 tetrahedral cells with total volume 16·r³/3', () => {
    const radius = 1.5;
    const c = createCrossPolytope({ dim: 4, radius });
    expect(c.cellCount(3)).toBe(16);
    expect(boundaryVolume(c)).toBeCloseTo((16 * radius ** 3) / 3, 10);
  });

  it('the w=0 cross-section is an octahedron: area 4√3·r²', () => {
    const radius = 1;
    const c = createCrossPolytope({ dim: 4, radius });
    // Section at w=0 is the octahedron with vertices ±r·e_i (i < 3):
    // 8 equilateral triangles of edge r√2 → 8 · (√3/4) · 2r² = 4√3·r².
    expect(sliceArea(c, 0)).toBeCloseTo(4 * Math.sqrt(3) * radius ** 2, 4);
  });
});

describe('create600Cell', () => {
  it('has the canonical counts: 120 vertices, 720 edges, 1200 faces, 600 cells', async () => {
    const { create600Cell } = await import('@holotope/core');
    const c = create600Cell();
    expect(c.vertexCount).toBe(120);
    expect(c.cellCount(1)).toBe(720);
    expect(c.cellCount(2)).toBe(1200);
    expect(c.cellCount(3)).toBe(600);
  });

  it('all vertices on the circumsphere; all edges of length r/φ', async () => {
    const { create600Cell } = await import('@holotope/core');
    const radius = 2;
    const phi = (1 + Math.sqrt(5)) / 2;
    const c = create600Cell({ radius });
    for (let v = 0; v < c.vertexCount; v++) {
      const r = Math.hypot(
        c.positions[v * 4]!,
        c.positions[v * 4 + 1]!,
        c.positions[v * 4 + 2]!,
        c.positions[v * 4 + 3]!
      );
      expect(r).toBeCloseTo(radius, 10);
    }
    const edges = c.cellsOfDim(1)[0]!;
    for (let e = 0; e < edges.indices.length; e += 2) {
      const a = edges.indices[e]!;
      const b = edges.indices[e + 1]!;
      let acc = 0;
      for (let k = 0; k < 4; k++) acc += (c.positions[a * 4 + k]! - c.positions[b * 4 + k]!) ** 2;
      expect(Math.sqrt(acc)).toBeCloseTo(radius / phi, 10);
    }
  });

  it('boundary 3-volume is 600 regular tetrahedra: 50√2·a³', async () => {
    const { create600Cell } = await import('@holotope/core');
    const phi = (1 + Math.sqrt(5)) / 2;
    const c = create600Cell();
    const a = 1 / phi;
    expect(boundaryVolume(c)).toBeCloseTo(50 * Math.SQRT2 * a ** 3, 8);
  });

  it('the w=0 cross-section is bounded by the icosidodecahedron and the unit ball', async () => {
    const { create600Cell } = await import('@holotope/core');
    const phi = (1 + Math.sqrt(5)) / 2;
    const c = create600Cell();
    // 30 vertices lie exactly in w=0, forming an icosidodecahedron of edge
    // 1/φ — but the section is strictly larger: edges like
    // ½(±φ, ±1, ±1/φ·w-only-sign-flips) cross w=0 at midpoints of radius
    // ≈0.951, outside the icosidodecahedron's triangle-face inradius
    // (≈0.934). Surface area is monotone under inclusion for convex
    // bodies, giving rigorous two-sided bounds:
    // icosidodecahedron < section < ball of radius 1.
    const a = 1 / phi;
    const icosidodecahedron = (5 * Math.sqrt(3) + 3 * Math.sqrt(25 + 10 * Math.sqrt(5))) * a * a;
    const area = sliceArea(c, 0);
    expect(area).toBeGreaterThan(icosidodecahedron);
    expect(area).toBeLessThan(4 * Math.PI);
    // Reflection symmetry of the section family in w.
    expect(sliceArea(c, 0.25)).toBeCloseTo(sliceArea(c, -0.25), 6);
  });
});

describe('create120Cell', () => {
  it('has 600 vertices (+120 fan centroids), 1200 edges, 4320 fan tetrahedra', async () => {
    const { create120Cell } = await import('@holotope/core');
    const c = create120Cell();
    expect(c.vertexCount).toBe(720); // 600 dual vertices + 120 cell centroids
    expect(c.cellCount(1)).toBe(1200);
    expect(c.cellCount(3)).toBe(4320); // 120 dodecahedra × 12 pentagons × 3
  });

  it('is regular: every edge has the same length, every vertex 4 neighbors', async () => {
    const { create120Cell } = await import('@holotope/core');
    const c = create120Cell({ radius: 1 });
    const edges = c.cellsOfDim(1)[0]!;
    const valence = new Uint32Array(600);
    const lengths: number[] = [];
    for (let e = 0; e < edges.indices.length; e += 2) {
      const a = edges.indices[e]!;
      const b = edges.indices[e + 1]!;
      valence[a]!++;
      valence[b]!++;
      let acc = 0;
      for (let k = 0; k < 4; k++) acc += (c.positions[a * 4 + k]! - c.positions[b * 4 + k]!) ** 2;
      lengths.push(Math.sqrt(acc));
    }
    const first = lengths[0]!;
    for (const len of lengths) expect(len).toBeCloseTo(first, 10);
    for (let v = 0; v < 600; v++) expect(valence[v]).toBe(4);
  });

  it('boundary 3-volume is 120 regular dodecahedra: 30·(15+7√5)·a³', async () => {
    const { create120Cell } = await import('@holotope/core');
    const c = create120Cell();
    // Measure the edge length from the construction, then compare the
    // fan-tetrahedra volume sum against the closed-form dodecahedron
    // volume — this validates the entire dual + pentagon + fan pipeline.
    const edges = c.cellsOfDim(1)[0]!;
    const a0 = edges.indices[0]!;
    const b0 = edges.indices[1]!;
    let acc = 0;
    for (let k = 0; k < 4; k++) acc += (c.positions[a0 * 4 + k]! - c.positions[b0 * 4 + k]!) ** 2;
    const a = Math.sqrt(acc);
    const dodecahedron = ((15 + 7 * Math.sqrt(5)) / 4) * a ** 3;
    expect(boundaryVolume(c)).toBeCloseTo(120 * dodecahedron, 8);
  });

  it('slices through the center to a positive-area section', async () => {
    const { create120Cell } = await import('@holotope/core');
    const c = create120Cell();
    expect(sliceArea(c, 0)).toBeGreaterThan(0);
  });
});

describe('createDuoprism', () => {
  it.each([
    [3, 3, 9, 18, 9, 18],
    [4, 6, 24, 48, 24, 84],
    [5, 5, 25, 50, 25, 90],
    [3, 8, 24, 48, 24, 78]
  ])('p=%i q=%i: %i vertices, %i edges, %i squares, %i tets', async (p, q, v, e, s, t) => {
    const { createDuoprism } = await import('@holotope/core');
    const c = createDuoprism({ p, q });
    expect(c.vertexCount).toBe(v);
    expect(c.cellCount(1)).toBe(e);
    expect(c.cellCount(2)).toBe(s);
    expect(c.cellCount(3)).toBe(t);
  });

  it('all vertices lie on the Clifford torus: radius √(r1²+r2²)', async () => {
    const { createDuoprism } = await import('@holotope/core');
    const c = createDuoprism({ p: 5, q: 7, radius1: 1.2, radius2: 0.8 });
    for (let v = 0; v < c.vertexCount; v++) {
      const xy = Math.hypot(c.positions[v * 4]!, c.positions[v * 4 + 1]!);
      const zw = Math.hypot(c.positions[v * 4 + 2]!, c.positions[v * 4 + 3]!);
      expect(xy).toBeCloseTo(1.2, 12);
      expect(zw).toBeCloseTo(0.8, 12);
    }
  });

  it('boundary 3-volume matches the closed form: pq·r1·r2·(r1·sin(2π/p)sin(π/q) + r2·sin(2π/q)sin(π/p))', async () => {
    const { createDuoprism } = await import('@holotope/core');
    for (const [p, q, r1, r2] of [
      [3, 3, 1, 1],
      [5, 7, 1.2, 0.8],
      [4, 4, 1, 1]
    ] as const) {
      const c = createDuoprism({ p, q, radius1: r1, radius2: r2 });
      const expected =
        p * q * r1 * r2 *
        (r1 * Math.sin((2 * Math.PI) / p) * Math.sin(Math.PI / q) +
          r2 * Math.sin((2 * Math.PI) / q) * Math.sin(Math.PI / p));
      expect(boundaryVolume(c)).toBeCloseTo(expected, 9);
    }
  });

  it('the 4,4-duoprism with equal radii is a tesseract (volume cross-check)', async () => {
    const { createDuoprism } = await import('@holotope/core');
    // 4,4 with circumradius 1 has edge √2 → boundary volume 8·(√2)³.
    const c = createDuoprism({ p: 4, q: 4 });
    expect(boundaryVolume(c)).toBeCloseTo(8 * Math.SQRT2 ** 3, 9);
  });

  it('slices through the center; empty past the zw circumradius', async () => {
    const { createDuoprism } = await import('@holotope/core');
    const c = createDuoprism({ p: 6, q: 8, radius1: 1, radius2: 0.9 });
    expect(sliceArea(c, 0)).toBeGreaterThan(0);
    expect(sliceArea(c, 0.95)).toBe(0);
  });

  it('rejects degenerate polygons', async () => {
    const { createDuoprism } = await import('@holotope/core');
    expect(() => createDuoprism({ p: 2, q: 5 })).toThrow(/≥ 3/);
  });
});
