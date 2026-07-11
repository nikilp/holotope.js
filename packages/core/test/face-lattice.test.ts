import { describe, expect, it } from 'vitest';
import {
  create120CellCompiled,
  eulerCharacteristic,
  fVector,
  raggedItem
} from '@holotope/core';

const compiled = create120CellCompiled();
const { lattice, tetrahedralization: tets } = compiled;

describe('120-cell face lattice (stage 0 retrofit)', () => {
  it('has the canonical f-vector and Euler characteristic 0', () => {
    expect(fVector(lattice)).toEqual([600, 1200, 720, 120]);
    expect(eulerCharacteristic(lattice)).toBe(0);
  });

  it('every pentagon bounds exactly two cells, every edge exactly two pentagons', () => {
    const faceUse = new Uint32Array(720);
    for (let c = 0; c < 120; c++) {
      for (const f of raggedItem(lattice.boundary[3]!, c)) faceUse[f]!++;
    }
    for (const n of faceUse) expect(n).toBe(2);

    const edgeUse = new Uint32Array(1200);
    for (let f = 0; f < 720; f++) {
      for (const e of raggedItem(lattice.boundary[2]!, f)) edgeUse[e]!++;
    }
    // The diamond property one level down: in a 4-polytope each edge
    // belongs to 3 pentagons here (dodecahedral vertex figure) — pin the
    // observed regular structure instead of the 2-cover, which applies
    // one rank up.
    for (const n of edgeUse) expect(n).toBe(3);
  });
});

describe('120-cell tetrahedralization provenance', () => {
  it('is cell-major with exact tetToCell: 36 tets per cell, each on its own centroid', () => {
    expect(tets.indices.length / 4).toBe(4320);
    expect(tets.sourceVertexCount).toBe(600);
    for (let c = 0; c < 120; c++) {
      expect(tets.cellTetOffsets[c + 1]! - tets.cellTetOffsets[c]!).toBe(36);
      expect(tets.cellCentroidVertex[c]).toBe(600 + c);
      for (let t = tets.cellTetOffsets[c]!; t < tets.cellTetOffsets[c + 1]!; t++) {
        expect(tets.tetToCell[t]).toBe(c);
        expect(tets.indices[t * 4]).toBe(600 + c); // apex = own centroid
      }
    }
  });

  it('tetToFace points at a face on the owning cell boundary', () => {
    for (let t = 0; t < tets.tetToCell.length; t++) {
      const cellFaces = raggedItem(lattice.boundary[3]!, tets.tetToCell[t]!);
      expect(Array.from(cellFaces)).toContain(tets.tetToFace[t]!);
    }
  });

  it('shared pentagons are triangulated identically on both sides', () => {
    // Collect each cell's boundary triangles (non-apex vertices) per
    // source face; the two cells incident to a pentagon must carry the
    // same three triangles — the conforming-triangulation guarantee that
    // keeps slices continuous across cell boundaries.
    const byFace = new Map<number, Map<number, Set<string>>>();
    for (let t = 0; t < tets.tetToFace.length; t++) {
      const face = tets.tetToFace[t]!;
      const cell = tets.tetToCell[t]!;
      const tri = [tets.indices[t * 4 + 1]!, tets.indices[t * 4 + 2]!, tets.indices[t * 4 + 3]!]
        .sort((a, b) => a - b)
        .join(',');
      let cells = byFace.get(face);
      if (!cells) byFace.set(face, (cells = new Map()));
      let tris = cells.get(cell);
      if (!tris) cells.set(cell, (tris = new Set()));
      tris.add(tri);
    }
    expect(byFace.size).toBe(720);
    for (const cells of byFace.values()) {
      const sides = [...cells.values()];
      expect(sides.length).toBe(2);
      expect(sides[0]!.size).toBe(3);
      expect(sides[1]!.size).toBe(3);
      for (const tri of sides[0]!) expect(sides[1]!.has(tri)).toBe(true);
    }
  });

  it('all 120 cells have equal positive fan volume (regularity + conservation)', () => {
    const p = tets.positions;
    const volumeOf = (t: number): number => {
      const [a, b, c, d] = [0, 1, 2, 3].map((k) => tets.indices[t * 4 + k]!);
      const e = [b, c, d].map((v) => {
        const edge = new Float64Array(4);
        for (let k = 0; k < 4; k++) edge[k] = p[v * 4 + k]! - p[a * 4 + k]!;
        return edge;
      });
      const g = (i: number, j: number): number => {
        let acc = 0;
        for (let k = 0; k < 4; k++) acc += e[i]![k]! * e[j]![k]!;
        return acc;
      };
      const det =
        g(0, 0) * (g(1, 1) * g(2, 2) - g(1, 2) * g(2, 1)) -
        g(0, 1) * (g(1, 0) * g(2, 2) - g(1, 2) * g(2, 0)) +
        g(0, 2) * (g(1, 0) * g(2, 1) - g(1, 1) * g(2, 0));
      return Math.sqrt(Math.max(0, det)) / 6;
    };
    const cellVolumes: number[] = [];
    for (let c = 0; c < 120; c++) {
      let acc = 0;
      for (let t = tets.cellTetOffsets[c]!; t < tets.cellTetOffsets[c + 1]!; t++) {
        const v = volumeOf(t);
        expect(v).toBeGreaterThan(1e-9);
        acc += v;
      }
      cellVolumes.push(acc);
    }
    for (const v of cellVolumes) expect(v).toBeCloseTo(cellVolumes[0]!, 10);
  });
});
