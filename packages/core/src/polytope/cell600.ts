import { CellComplex } from '../geometry/cell-complex.js';

const PHI = (1 + Math.sqrt(5)) / 2;

export interface Cell600Options {
  /** Circumradius (distance from center to each vertex). Default 1. */
  radius?: number;
}

/** Combinatorics of the unit-circumradius 600-cell, computed once. */
export interface Cell600Data {
  /** 120 packed 4D vertices at circumradius 1. */
  vertices: Float64Array;
  /** Adjacency lists (12 neighbors per vertex). */
  neighbors: number[][];
  /** 720 edges. */
  edges: Uint32Array;
  /** 1200 triangular faces. */
  triangles: Uint32Array;
  /** 600 tetrahedral cells. */
  tets: Uint32Array;
}

let cached: Cell600Data | null = null;

/** All even permutations of (0, 1, 2, 3), by inversion-count parity. */
function evenPermutations(): number[][] {
  const result: number[][] = [];
  const items = [0, 1, 2, 3];
  const permute = (current: number[], remaining: number[]): void => {
    if (remaining.length === 0) {
      let inversions = 0;
      for (let a = 0; a < 4; a++) {
        for (let b = a + 1; b < 4; b++) if (current[a]! > current[b]!) inversions++;
      }
      if (inversions % 2 === 0) result.push([...current]);
      return;
    }
    for (let k = 0; k < remaining.length; k++) {
      permute([...current, remaining[k]!], remaining.filter((_, i) => i !== k));
    }
  };
  permute([], items);
  return result;
}

/**
 * The 600-cell's structure at unit circumradius: 120 vertices — the eight
 * ±eᵢ, the sixteen (±½,±½,±½,±½), and the ninety-six even permutations of
 * ½(±φ, ±1, ±1/φ, 0) — with edges as nearest-neighbor pairs (distance 1/φ),
 * faces as adjacent triples, and the 600 tetrahedral cells as 4-cliques.
 */
export function cell600Data(): Cell600Data {
  if (cached) return cached;

  const raw: number[][] = [];
  for (let a = 0; a < 4; a++) {
    for (const s of [1, -1]) {
      const v = [0, 0, 0, 0];
      v[a] = s;
      raw.push(v);
    }
  }
  for (let signs = 0; signs < 16; signs++) {
    raw.push([0, 1, 2, 3].map((a) => ((signs >> a) & 1 ? 0.5 : -0.5)));
  }
  const base = [PHI / 2, 0.5, 1 / (2 * PHI), 0];
  for (const perm of evenPermutations()) {
    for (let signs = 0; signs < 8; signs++) {
      const signed = [
        (signs & 1) !== 0 ? -base[0]! : base[0]!,
        (signs & 2) !== 0 ? -base[1]! : base[1]!,
        (signs & 4) !== 0 ? -base[2]! : base[2]!,
        0
      ];
      const v = [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) v[perm[k]!] = signed[k]!;
      raw.push(v);
    }
  }
  if (raw.length !== 120) throw new Error(`cell600Data: expected 120 vertices, got ${raw.length}`);

  const vertices = new Float64Array(120 * 4);
  raw.forEach((v, i) => {
    for (let c = 0; c < 4; c++) vertices[i * 4 + c] = v[c]!;
  });

  // Edges: squared distance 2 − φ = 1/φ².
  const edgeSq = 2 - PHI;
  const adjacent = (i: number, j: number): boolean => {
    let acc = 0;
    for (let c = 0; c < 4; c++) acc += (raw[i]![c]! - raw[j]![c]!) ** 2;
    return Math.abs(acc - edgeSq) < 1e-9;
  };
  const neighbors: number[][] = Array.from({ length: 120 }, () => []);
  const edges: number[] = [];
  for (let i = 0; i < 120; i++) {
    for (let j = i + 1; j < 120; j++) {
      if (adjacent(i, j)) {
        edges.push(i, j);
        neighbors[i]!.push(j);
        neighbors[j]!.push(i);
      }
    }
  }

  // Faces (adjacent triples) and cells (4-cliques).
  const triangles: number[] = [];
  const tets: number[] = [];
  for (let i = 0; i < 120; i++) {
    for (const j of neighbors[i]!) {
      if (j <= i) continue;
      for (const k of neighbors[i]!) {
        if (k <= j || !neighbors[j]!.includes(k)) continue;
        triangles.push(i, j, k);
        for (const l of neighbors[i]!) {
          if (l <= k || !neighbors[j]!.includes(l) || !neighbors[k]!.includes(l)) continue;
          tets.push(i, j, k, l);
        }
      }
    }
  }

  cached = {
    vertices,
    neighbors,
    edges: Uint32Array.from(edges),
    triangles: Uint32Array.from(triangles),
    tets: Uint32Array.from(tets)
  };
  return cached;
}

/**
 * Builds the 600-cell: 120 vertices, 720 edges, 1200 triangular faces,
 * 600 tetrahedral cells — the finest of the regular polychora, and
 * natively sliceable since its cells are already tetrahedra.
 */
export function create600Cell({ radius = 1 }: Cell600Options = {}): CellComplex {
  const data = cell600Data();
  const positions = new Float64Array(data.vertices.length);
  for (let k = 0; k < positions.length; k++) positions[k] = data.vertices[k]! * radius;
  return new CellComplex(4, positions, [
    { dim: 1, verticesPerCell: 2, kind: 'simplex', indices: data.edges.slice() },
    { dim: 2, verticesPerCell: 3, kind: 'simplex', indices: data.triangles.slice() },
    { dim: 3, verticesPerCell: 4, kind: 'simplex', indices: data.tets.slice() }
  ]);
}
