import { CellComplex } from '../geometry/cell-complex.js';
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
 * For slicing, every dodecahedron is fan-tetrahedralized from its centroid
 * (an extra helper vertex per cell, appended after the 600 real vertices):
 * 12 pentagons × 3 fan triangles × 120 cells = 4320 tetrahedra.
 */
export function create120Cell({ radius = 1 }: Cell120Options = {}): CellComplex {
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
  const dualEdges: number[] = [];
  for (const star of faceStar.values()) {
    if (star.length !== 2) {
      throw new Error(`create120Cell: face shared by ${star.length} cells, expected 2`);
    }
    dualEdges.push(star[0]!, star[1]!);
  }

  // Dodecahedral cells: fan-tetrahedralize around per-cell centroids.
  const positions = new Float64Array((tetCount + 120) * 4);
  positions.set(dual);
  const fanTets: number[] = [];
  const pentagons: number[] = [];
  const scratchBasis1 = new Float64Array(4);
  const scratchBasis2 = new Float64Array(4);

  for (let v = 0; v < 120; v++) {
    const star = vertexStar[v]!;
    if (star.length !== 20) {
      throw new Error(`create120Cell: vertex star of size ${star.length}, expected 20`);
    }
    const centroidIndex = tetCount + v;
    const base = centroidIndex * 4;
    for (const t of star) {
      for (let c = 0; c < 4; c++) positions[base + c]! += dual[t * 4 + c]! / 20;
    }

    // One pentagon per 600-cell edge at v: the 5 cells containing (v, u),
    // sorted cyclically in their own plane, then fanned into 3 triangles.
    for (const u of neighbors[v]!) {
      // A pentagon is the face between the dodecahedra of v and u; visit it
      // once (v < u) and emit fan tetrahedra for both cells' centroids.
      if (u < v) continue;
      const pentagon = edgeStar.get(edgeKey(v, u))!;
      if (pentagon.length !== 5) {
        throw new Error(`create120Cell: edge star of size ${pentagon.length}, expected 5`);
      }
      const ordered = sortCyclically(pentagon, dual, scratchBasis1, scratchBasis2);
      pentagons.push(...ordered);
      for (const centroid of [tetCount + v, tetCount + u]) {
        for (let f = 1; f < 4; f++) {
          fanTets.push(centroid, ordered[0]!, ordered[f]!, ordered[f + 1]!);
        }
      }
    }
  }

  return new CellComplex(4, positions, [
    { dim: 1, verticesPerCell: 2, kind: 'simplex', indices: Uint32Array.from(dualEdges) },
    { dim: 2, verticesPerCell: 5, kind: 'polygon', indices: Uint32Array.from(pentagons) },
    { dim: 3, verticesPerCell: 4, kind: 'simplex', indices: Uint32Array.from(fanTets) }
  ]);
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
