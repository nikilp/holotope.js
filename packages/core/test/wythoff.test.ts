import { describe, expect, it } from 'vitest';
import {
  coxeterA4,
  coxeterB4,
  coxeterD4,
  coxeterF4,
  coxeterH4,
  createSimplex,
  createWythoffPolytope,
  eulerCharacteristic,
  fVector,
  raggedItem
} from '@holotope/core';

/**
 * Every nonempty ring pattern of A4 with its catalog f-vector
 * [vertices, edges, 2-faces, cells]. Patterns and their diagram
 * reversals must agree (A4's diagram symmetry).
 */
const A4_CATALOG: Array<[string, boolean[], [number, number, number, number]]> = [
  ['5-cell x---', [true, false, false, false], [5, 10, 10, 5]],
  ['5-cell ---x', [false, false, false, true], [5, 10, 10, 5]],
  ['rectified -x--', [false, true, false, false], [10, 30, 30, 10]],
  ['rectified --x-', [false, false, true, false], [10, 30, 30, 10]],
  ['truncated xx--', [true, true, false, false], [20, 40, 30, 10]],
  ['truncated --xx', [false, false, true, true], [20, 40, 30, 10]],
  ['bitruncated -xx-', [false, true, true, false], [30, 60, 40, 10]],
  ['cantellated x-x-', [true, false, true, false], [30, 90, 80, 20]],
  ['cantellated -x-x', [false, true, false, true], [30, 90, 80, 20]],
  ['runcinated x--x', [true, false, false, true], [20, 60, 70, 30]],
  ['cantitruncated xxx-', [true, true, true, false], [60, 120, 80, 20]],
  ['cantitruncated -xxx', [false, true, true, true], [60, 120, 80, 20]],
  ['runcitruncated xx-x', [true, true, false, true], [60, 150, 120, 30]],
  ['runcitruncated x-xx', [true, false, true, true], [60, 150, 120, 30]],
  ['omnitruncated xxxx', [true, true, true, true], [120, 240, 150, 30]]
];

describe('createWythoffPolytope across all rank-4 groups', () => {
  const CATALOG: Array<[string, () => Parameters<typeof createWythoffPolytope>[0], boolean[], number[]]> = [
    ['B4 tesseract', coxeterB4, [false, false, false, true], [16, 32, 24, 8]],
    ['B4 16-cell', coxeterB4, [true, false, false, false], [8, 24, 32, 16]],
    ['B4 rectified tesseract', coxeterB4, [false, false, true, false], [32, 96, 88, 24]],
    ['D4 16-cell (demitesseract)', coxeterD4, [false, true, false, false], [8, 24, 32, 16]],
    ['F4 24-cell', coxeterF4, [true, false, false, false], [24, 96, 96, 24]],
    ['F4 rectified 24-cell', coxeterF4, [false, true, false, false], [96, 288, 240, 48]],
    ['H4 600-cell', coxeterH4, [false, false, false, true], [120, 720, 1200, 600]],
    ['H4 120-cell', coxeterH4, [true, false, false, false], [600, 1200, 720, 120]],
    ['H4 rectified 600-cell', coxeterH4, [false, false, true, false], [720, 3600, 3600, 720]],
    ['H4 omnitruncated 120-cell', coxeterH4, [true, true, true, true], [14400, 28800, 17040, 2640]]
  ];

  it.each(CATALOG)('%s matches the catalog f-vector', (_, make, rings, expected) => {
    const { lattice } = createWythoffPolytope(make(), rings);
    expect(fVector(lattice)).toEqual(expected);
    expect(eulerCharacteristic(lattice)).toBe(0);
    // Diamond property one rank up: every 2-face bounds exactly 2 cells.
    const use = new Uint32Array(expected[2]!);
    for (let c = 0; c < expected[3]!; c++) {
      for (const f of raggedItem(lattice.boundary[3]!, c)) use[f]!++;
    }
    for (const n of use) expect(n).toBe(2);
  });
});

describe('createWythoffPolytope on A4 (stage 2 acceptance)', () => {
  it.each(A4_CATALOG)('%s matches the catalog f-vector', (_, rings, expected) => {
    const { lattice } = createWythoffPolytope(coxeterA4(), rings);
    expect(fVector(lattice)).toEqual(expected);
    expect(eulerCharacteristic(lattice)).toBe(0);
  });

  it.each(A4_CATALOG)('%s: every 2-face bounds exactly two cells', (_, rings) => {
    const { lattice } = createWythoffPolytope(coxeterA4(), rings);
    const faceCount = fVector(lattice)[2]!;
    const cellCount = fVector(lattice)[3]!;
    const use = new Uint32Array(faceCount);
    for (let c = 0; c < cellCount; c++) {
      for (const f of raggedItem(lattice.boundary[3]!, c)) use[f]!++;
    }
    for (const n of use) expect(n).toBe(2);
  });

  it.each(A4_CATALOG)('%s is uniform: equiradial vertices, equal edge lengths', (_, rings) => {
    const { lattice, complex } = createWythoffPolytope(coxeterA4(), rings, { radius: 1.5 });
    const p = complex.positions;
    for (let v = 0; v < lattice.vertexCount; v++) {
      expect(Math.hypot(p[v * 4]!, p[v * 4 + 1]!, p[v * 4 + 2]!, p[v * 4 + 3]!)).toBeCloseTo(
        1.5,
        10
      );
    }
    const edges = lattice.layers[1]!.vertices;
    let first = -1;
    for (let e = 0; e < fVector(lattice)[1]!; e++) {
      const [a, b] = raggedItem(edges, e);
      let acc = 0;
      for (let c = 0; c < 4; c++) acc += (p[a! * 4 + c]! - p[b! * 4 + c]!) ** 2;
      const len = Math.sqrt(acc);
      if (first < 0) first = len;
      expect(len).toBeCloseTo(first, 10);
    }
  });

  it('the single-ring pattern is the regular 5-cell (matches createSimplex)', () => {
    const wythoff = createWythoffPolytope(coxeterA4(), [true, false, false, false]);
    const simplex = createSimplex({ dim: 4, edgeLength: 2 });
    expect(fVector(wythoff.lattice)).toEqual([5, 10, 10, 5]);
    expect(simplex.vertexCount).toBe(5);
    // Same combinatorics is forced at these counts; check the metric
    // ratio too: circumradius/edge of the regular 5-cell is √(2/5).
    const p = wythoff.complex.positions;
    const r = Math.hypot(p[0]!, p[1]!, p[2]!, p[3]!);
    const [a, b] = raggedItem(wythoff.lattice.layers[1]!.vertices, 0);
    let acc = 0;
    for (let c = 0; c < 4; c++) acc += (p[a! * 4 + c]! - p[b! * 4 + c]!) ** 2;
    expect(r / Math.sqrt(acc)).toBeCloseTo(Math.sqrt(2 / 5), 10);
  });

  it('every cell tetrahedralizes with positive equal-per-type volumes (provenance intact)', () => {
    const { tetrahedralization: tets, lattice } = createWythoffPolytope(
      coxeterA4(),
      [true, true, false, false] // truncated 5-cell: tetrahedra + truncated tetrahedra
    );
    const types = lattice.layers[3]!.typeId;
    const volumesByType = new Map<number, number[]>();
    const p = tets.positions;
    for (let c = 0; c < fVector(lattice)[3]!; c++) {
      let acc = 0;
      for (let t = tets.cellTetOffsets[c]!; t < tets.cellTetOffsets[c + 1]!; t++) {
        expect(tets.tetToCell[t]).toBe(c);
        const [i0, i1, i2, i3] = [0, 1, 2, 3].map((k) => tets.indices[t * 4 + k]!);
        const e = [i1, i2, i3].map((v) => {
          const edge = new Float64Array(4);
          for (let k = 0; k < 4; k++) edge[k] = p[v * 4 + k]! - p[i0 * 4 + k]!;
          return edge;
        });
        const g = (x: number, y: number): number => {
          let dot = 0;
          for (let k = 0; k < 4; k++) dot += e[x]![k]! * e[y]![k]!;
          return dot;
        };
        const det =
          g(0, 0) * (g(1, 1) * g(2, 2) - g(1, 2) * g(2, 1)) -
          g(0, 1) * (g(1, 0) * g(2, 2) - g(1, 2) * g(2, 0)) +
          g(0, 2) * (g(1, 0) * g(2, 1) - g(1, 1) * g(2, 0));
        const v = Math.sqrt(Math.max(0, det)) / 6;
        expect(v).toBeGreaterThan(1e-9);
        acc += v;
      }
      let bucket = volumesByType.get(types[c]!);
      if (!bucket) volumesByType.set(types[c]!, (bucket = []));
      bucket.push(acc);
    }
    // Two cell types (tetrahedron, truncated tetrahedron), each uniform.
    expect(volumesByType.size).toBe(2);
    for (const volumes of volumesByType.values()) {
      for (const v of volumes) expect(v).toBeCloseTo(volumes[0]!, 10);
    }
  });
});
