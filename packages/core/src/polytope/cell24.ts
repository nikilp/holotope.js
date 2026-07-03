import { CellComplex } from '../geometry/cell-complex.js';

export interface Cell24Options {
  /** Circumradius (distance from center to each vertex). Default 1. */
  radius?: number;
}

/**
 * Builds the 24-cell — the regular polychoron with no 3D analogue.
 *
 * Construction at circumradius √2 (then scaled): the 24 vertices are all
 * permutations of (±1, ±1, 0, 0). Each vertex has 8 nearest neighbors at
 * distance √2 (the edges, 96 total), every mutually-adjacent triple is a
 * triangular face (96), and the 24 octahedral cells are centered on the
 * vertices of the dual 24-cell — the 8 permutations of (±1, 0, 0, 0) plus
 * the 16 points (±½, ±½, ±½, ±½): a cell's 6 vertices are exactly those
 * with dot product 1 against its center.
 *
 * Each octahedron is split into 4 tetrahedra around one of its diagonals,
 * so the complex is sliceable out of the box.
 */
export function create24Cell({ radius = 1 }: Cell24Options = {}): CellComplex {
  const scale = radius / Math.SQRT2;

  // Vertices: choose 2 of 4 coordinates, 4 sign combinations each.
  const raw: number[][] = [];
  for (let a = 0; a < 4; a++) {
    for (let b = a + 1; b < 4; b++) {
      for (const sa of [1, -1]) {
        for (const sb of [1, -1]) {
          const v = [0, 0, 0, 0];
          v[a] = sa;
          v[b] = sb;
          raw.push(v);
        }
      }
    }
  }
  const positions = new Float64Array(24 * 4);
  raw.forEach((v, i) => {
    for (let c = 0; c < 4; c++) positions[i * 4 + c] = v[c]! * scale;
  });

  const distSq = (i: number, j: number): number => {
    let acc = 0;
    for (let c = 0; c < 4; c++) acc += (raw[i]![c]! - raw[j]![c]!) ** 2;
    return acc;
  };

  // Edges: nearest-neighbor pairs at squared distance 2.
  const edges: number[] = [];
  const adjacent = (i: number, j: number): boolean => Math.abs(distSq(i, j) - 2) < 1e-9;
  for (let i = 0; i < 24; i++) {
    for (let j = i + 1; j < 24; j++) {
      if (adjacent(i, j)) edges.push(i, j);
    }
  }

  // Triangular faces: mutually adjacent triples.
  const triangles: number[] = [];
  for (let i = 0; i < 24; i++) {
    for (let j = i + 1; j < 24; j++) {
      if (!adjacent(i, j)) continue;
      for (let k = j + 1; k < 24; k++) {
        if (adjacent(i, k) && adjacent(j, k)) triangles.push(i, j, k);
      }
    }
  }

  // Octahedral cells via the dual's vertices, each split into 4 tetrahedra.
  const centers: number[][] = [];
  for (let a = 0; a < 4; a++) {
    for (const s of [1, -1]) {
      const c = [0, 0, 0, 0];
      c[a] = s;
      centers.push(c);
    }
  }
  for (let signs = 0; signs < 16; signs++) {
    centers.push([0, 1, 2, 3].map((a) => ((signs >> a) & 1 ? 0.5 : -0.5)));
  }

  const tets: number[] = [];
  for (const center of centers) {
    const cell = raw
      .map((v, i) => ({ i, dot: v.reduce((acc, x, c) => acc + x * center[c]!, 0) }))
      .filter((e) => Math.abs(e.dot - 1) < 1e-9)
      .map((e) => e.i);
    if (cell.length !== 6) {
      throw new Error(`create24Cell: expected octahedral cell of 6 vertices, got ${cell.length}`);
    }
    // Octahedron: pick an antipodal pair (squared distance 4 within the
    // cell), order the remaining equatorial square as a cycle, and fan
    // 4 tetrahedra around the diagonal.
    const apex = cell[0]!;
    const apexOpposite = cell.find((v) => Math.abs(distSq(apex, v) - 4) < 1e-9)!;
    const equator = cell.filter((v) => v !== apex && v !== apexOpposite);
    // Order the 4 equator vertices into a cycle of adjacent pairs.
    const cycle = [equator[0]!];
    while (cycle.length < 4) {
      const last = cycle[cycle.length - 1]!;
      const next = equator.find((v) => !cycle.includes(v) && adjacent(last, v))!;
      cycle.push(next);
    }
    for (let e = 0; e < 4; e++) {
      tets.push(apex, cycle[e]!, cycle[(e + 1) % 4]!, apexOpposite);
    }
  }

  return new CellComplex(4, positions, [
    { dim: 1, verticesPerCell: 2, kind: 'simplex', indices: Uint32Array.from(edges) },
    { dim: 2, verticesPerCell: 3, kind: 'simplex', indices: Uint32Array.from(triangles) },
    { dim: 3, verticesPerCell: 4, kind: 'simplex', indices: Uint32Array.from(tets) }
  ]);
}
