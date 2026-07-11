import { CellComplex } from '../geometry/cell-complex.js';
import { buildRagged, type FaceLattice } from '../geometry/face-lattice.js';
import { compileFaceLattice, type CompiledPolytope } from '../geometry/compile-lattice.js';
import { cell600Data } from './cell600.js';

export interface Cell120Options {
  /** Circumradius (distance from center to each vertex). Default 1. */
  radius?: number;
}

/**
 * Builds the 120-cell — 600 vertices, 1200 edges, 720 pentagonal faces,
 * 120 dodecahedral cells — as the dual of the 600-cell:
 *
 * - vertices are the 600-cell's cell centroids, normalized to the radius;
 * - edges connect centroids of cells sharing a triangular face (exact
 *   combinatorial duality, no distance thresholds);
 * - each dodecahedral cell is the star of a 600-cell vertex (the 20 cells
 *   containing it), and each of its 12 pentagonal faces is the star of a
 *   600-cell edge (the 5 cells containing it).
 *
 * The full incidence structure is assembled as a `FaceLattice` and
 * compiled generically: pentagons fan-triangulate once globally and cone
 * to per-cell centroid helpers (12 pentagons × 3 triangles × 120 cells =
 * 4320 tetrahedra, cell-major with exact `tetToCell` provenance).
 */
export function create120Cell(options: Cell120Options = {}): CellComplex {
  return create120CellCompiled(options).complex;
}

/** The 120-cell with its canonical face lattice and provenance retained. */
export function create120CellCompiled({ radius = 1 }: Cell120Options = {}): CompiledPolytope {
  const { vertices, neighbors, tets } = cell600Data();
  const tetCount = tets.length / 4; // 600

  // Dual vertices: normalized cell centroids.
  const dual = new Float64Array(tetCount * 4);
  for (let t = 0; t < tetCount; t++) {
    let norm = 0;
    for (let c = 0; c < 4; c++) {
      let acc = 0;
      for (let v = 0; v < 4; v++) acc += vertices[tets[t * 4 + v]! * 4 + c]!;
      dual[t * 4 + c] = acc / 4;
      norm += dual[t * 4 + c]! ** 2;
    }
    norm = Math.sqrt(norm);
    for (let c = 0; c < 4; c++) dual[t * 4 + c] = (dual[t * 4 + c]! / norm) * radius;
  }

  // Stars: which cells contain each vertex / each edge of the 600-cell.
  const vertexStar: number[][] = Array.from({ length: 120 }, () => []);
  const edgeStar = new Map<number, number[]>();
  const edgeKey = (a: number, b: number): number => (a < b ? a * 120 + b : b * 120 + a);
  for (let t = 0; t < tetCount; t++) {
    const cell = [tets[t * 4]!, tets[t * 4 + 1]!, tets[t * 4 + 2]!, tets[t * 4 + 3]!];
    for (const v of cell) vertexStar[v]!.push(t);
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        const key = edgeKey(cell[a]!, cell[b]!);
        let star = edgeStar.get(key);
        if (!star) edgeStar.set(key, (star = []));
        star.push(t);
      }
    }
  }

  // Dual edges: cells of the 600-cell sharing a triangular face.
  const faceStar = new Map<string, number[]>();
  for (let t = 0; t < tetCount; t++) {
    const cell = [tets[t * 4]!, tets[t * 4 + 1]!, tets[t * 4 + 2]!, tets[t * 4 + 3]!].sort(
      (x, y) => x - y
    );
    for (let skip = 0; skip < 4; skip++) {
      const key = cell.filter((_, i) => i !== skip).join(',');
      let star = faceStar.get(key);
      if (!star) faceStar.set(key, (star = []));
      star.push(t);
    }
  }
  const dualEdges: number[][] = [];
  const dualEdgeId = new Map<number, number>();
  const dualEdgeKey = (a: number, b: number): number => (a < b ? a * 600 + b : b * 600 + a);
  for (const star of faceStar.values()) {
    if (star.length !== 2) {
      throw new Error(`create120Cell: face shared by ${star.length} cells, expected 2`);
    }
    dualEdgeId.set(dualEdgeKey(star[0]!, star[1]!), dualEdges.length);
    dualEdges.push([star[0]!, star[1]!]);
  }

  // Pentagons (one per 600-cell edge, cyclically ordered in their own
  // plane), with their boundary edges; dodecahedral cells (one per
  // 600-cell vertex) with their boundary pentagons.
  const pentagons: number[][] = [];
  const pentagonEdges: number[][] = [];
  const cellPentagons: number[][] = Array.from({ length: 120 }, () => []);
  const scratchBasis1 = new Float64Array(4);
  const scratchBasis2 = new Float64Array(4);

  for (let v = 0; v < 120; v++) {
    if (vertexStar[v]!.length !== 20) {
      throw new Error(`create120Cell: vertex star of size ${vertexStar[v]!.length}, expected 20`);
    }
    for (const u of neighbors[v]!) {
      if (u < v) continue; // visit each pentagon once
      const star = edgeStar.get(edgeKey(v, u))!;
      if (star.length !== 5) {
        throw new Error(`create120Cell: edge star of size ${star.length}, expected 5`);
      }
      const ordered = sortCyclically(star, dual, scratchBasis1, scratchBasis2);
      const pid = pentagons.length;
      pentagons.push(ordered);
      const boundary: number[] = [];
      for (let k = 0; k < 5; k++) {
        const edge = dualEdgeId.get(dualEdgeKey(ordered[k]!, ordered[(k + 1) % 5]!));
        if (edge === undefined) {
          throw new Error('create120Cell: pentagon side is not a dual edge');
        }
        boundary.push(edge);
      }
      pentagonEdges.push(boundary);
      cellPentagons[v]!.push(pid);
      cellPentagons[u]!.push(pid);
    }
  }

  const lattice: FaceLattice = {
    rank: 4,
    vertexCount: 600,
    layers: [
      undefined,
      { vertices: buildRagged(dualEdges), typeId: new Uint16Array(dualEdges.length) },
      { vertices: buildRagged(pentagons), typeId: new Uint16Array(pentagons.length) },
      { vertices: buildRagged(vertexStar), typeId: new Uint16Array(120) }
    ],
    boundary: [
      undefined,
      undefined,
      buildRagged(pentagonEdges),
      buildRagged(cellPentagons)
    ]
  };

  return compileFaceLattice(lattice, dual);
}

/** Sorts coplanar points cyclically by angle in their own plane. */
function sortCyclically(
  indices: number[],
  positions: Float64Array,
  d1: Float64Array,
  d2: Float64Array
): number[] {
  const m = [0, 0, 0, 0];
  for (const i of indices) {
    for (let c = 0; c < 4; c++) m[c]! += positions[i * 4 + c]! / indices.length;
  }
  // Orthonormal in-plane basis from the first two offsets (modified GS).
  let norm = 0;
  for (let c = 0; c < 4; c++) {
    d1[c] = positions[indices[0]! * 4 + c]! - m[c]!;
    norm += d1[c]! ** 2;
  }
  norm = Math.sqrt(norm);
  for (let c = 0; c < 4; c++) d1[c]! /= norm;
  let dot = 0;
  for (let c = 0; c < 4; c++) {
    d2[c] = positions[indices[1]! * 4 + c]! - m[c]!;
    dot += d2[c]! * d1[c]!;
  }
  norm = 0;
  for (let c = 0; c < 4; c++) {
    d2[c]! -= dot * d1[c]!;
    norm += d2[c]! ** 2;
  }
  norm = Math.sqrt(norm);
  for (let c = 0; c < 4; c++) d2[c]! /= norm;

  return [...indices].sort((a, b) => {
    const angle = (i: number): number => {
      let x = 0;
      let y = 0;
      for (let c = 0; c < 4; c++) {
        const offset = positions[i * 4 + c]! - m[c]!;
        x += offset * d1[c]!;
        y += offset * d2[c]!;
      }
      return Math.atan2(y, x);
    };
    return angle(a) - angle(b);
  });
}
