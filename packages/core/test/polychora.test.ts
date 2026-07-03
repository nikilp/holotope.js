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
