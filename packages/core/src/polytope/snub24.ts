import { CellComplex } from '../geometry/cell-complex.js';
import { buildRagged, type FaceLattice } from '../geometry/face-lattice.js';
import { compileFaceLattice, type CompiledPolytope } from '../geometry/compile-lattice.js';
import { cell600Data } from './cell600.js';

export interface Snub24CellOptions {
  /** Circumradius. Default 1. */
  radius?: number;
}

/**
 * The snub 24-cell — 96 vertices, 432 edges, 480 triangles, 120
 * tetrahedral + 24 icosahedral cells — as an exact combinatorial
 * diminishing of the 600-cell: removing the 24 vertices of an inscribed
 * 24-cell removes 24 icosahedral pyramids, leaving their icosahedral
 * bases. The removed set is identified structurally (the unit Hurwitz
 * quaternions are the 600-cell builder's first 24 vertices — the ±eᵢ
 * and (±½,±½,±½,±½) classes), never by distance thresholds.
 *
 * The construction is uniform (every edge is a 600-cell edge). Note on
 * the often-cited "two forms": this vertex set — even permutations of
 * ½(0, ±1, ±φ, ±1/φ) with free signs — is closed under coordinate
 * negation, so the realization equals its own mirror image; the paired
 * form in the literature arises from the alternation/Galois-conjugate
 * choice, which yields a congruent polytope.
 */
export function createSnub24Cell(options: Snub24CellOptions = {}): CellComplex {
  return createSnub24CellCompiled(options).complex;
}

/** The snub 24-cell with its face lattice and provenance retained. */
export function createSnub24CellCompiled({ radius = 1 }: Snub24CellOptions = {}): CompiledPolytope {
  const { vertices, neighbors, tets } = cell600Data();

  // The inscribed 24-cell: builder vertex classes 0…23. Defensive
  // assertions per the diminishing algorithm: exactly 24, and no
  // 600-cell edge joins two removed vertices.
  const removed = new Set<number>();
  for (let r = 0; r < 24; r++) removed.add(r);
  for (const r of removed) {
    for (const n of neighbors[r]!) {
      if (removed.has(n)) throw new Error('snub 24-cell: removed vertices are adjacent');
    }
  }

  // Reindex the 96 survivors.
  const newIndex = new Int32Array(120).fill(-1);
  let kept = 0;
  for (let v = 0; v < 120; v++) if (!removed.has(v)) newIndex[v] = kept++;
  if (kept !== 96) throw new Error(`snub 24-cell: kept ${kept} vertices, expected 96`);

  const positions = new Float64Array(96 * 4);
  for (let v = 0; v < 120; v++) {
    if (newIndex[v] === -1) continue;
    const base = newIndex[v]! * 4;
    for (let c = 0; c < 4; c++) positions[base + c] = vertices[v * 4 + c]! * radius;
  }

  // Cells: 600-cell tetrahedra untouched by the removal (must be 120),
  // plus one icosahedron per removed vertex (its 12 neighbors).
  const cells: number[][] = [];
  const cellTypes: number[] = [];
  for (let t = 0; t < tets.length; t += 4) {
    const quad = [tets[t]!, tets[t + 1]!, tets[t + 2]!, tets[t + 3]!];
    if (quad.some((v) => removed.has(v))) continue;
    cells.push(quad.map((v) => newIndex[v]!));
    cellTypes.push(0);
  }
  if (cells.length !== 120) {
    throw new Error(`snub 24-cell: ${cells.length} surviving tetrahedra, expected 120`);
  }
  const adjacency = neighbors.map((list) => new Set(list));
  for (const r of removed) {
    const base = neighbors[r]!;
    if (base.length !== 12 || base.some((v) => removed.has(v))) {
      throw new Error('snub 24-cell: icosahedral base is not 12 surviving vertices');
    }
    cells.push(base.map((v) => newIndex[v]!));
    cellTypes.push(1);
  }

  // Faces: every triangle of every cell, deduplicated by sorted triple.
  // Tetrahedra contribute their 4 triples; an icosahedral cell's faces
  // are the triangles of the induced 600-cell adjacency on its base
  // (the vertex figure is an icosahedron, so exactly 20).
  const faceId = new Map<string, number>();
  const faces: number[][] = [];
  const cellFaces: number[][] = [];
  const internFace = (tri: number[]): number => {
    const sorted = [...tri].sort((a, b) => a - b);
    const key = sorted.join(',');
    let id = faceId.get(key);
    if (id === undefined) {
      id = faces.length;
      faceId.set(key, id);
      faces.push(sorted);
    }
    return id;
  };
  const oldOf = new Int32Array(96);
  for (let v = 0; v < 120; v++) if (newIndex[v] !== -1) oldOf[newIndex[v]!] = v;

  cells.forEach((cell, c) => {
    const list: number[] = [];
    if (cellTypes[c] === 0) {
      for (let skip = 0; skip < 4; skip++) list.push(internFace(cell.filter((_, i) => i !== skip)));
    } else {
      for (let a = 0; a < cell.length; a++) {
        for (let b = a + 1; b < cell.length; b++) {
          if (!adjacency[oldOf[cell[a]!]!]!.has(oldOf[cell[b]!]!)) continue;
          for (let d = b + 1; d < cell.length; d++) {
            if (
              adjacency[oldOf[cell[a]!]!]!.has(oldOf[cell[d]!]!) &&
              adjacency[oldOf[cell[b]!]!]!.has(oldOf[cell[d]!]!)
            ) {
              list.push(internFace([cell[a]!, cell[b]!, cell[d]!]));
            }
          }
        }
      }
      if (list.length !== 20) {
        throw new Error(`snub 24-cell: icosahedral cell with ${list.length} faces`);
      }
    }
    cellFaces.push(list);
  });
  if (faces.length !== 480) {
    throw new Error(`snub 24-cell: ${faces.length} faces, expected 480`);
  }

  // Edges from face sides.
  const edgeId = new Map<number, number>();
  const edges: number[][] = [];
  const faceEdges = faces.map((tri) => {
    const list: number[] = [];
    for (let k = 0; k < 3; k++) {
      const a = tri[k]!;
      const b = tri[(k + 1) % 3]!;
      const key = a < b ? a * 96 + b : b * 96 + a;
      let id = edgeId.get(key);
      if (id === undefined) {
        id = edges.length;
        edgeId.set(key, id);
        edges.push(a < b ? [a, b] : [b, a]);
      }
      list.push(id);
    }
    return list;
  });
  if (edges.length !== 432) {
    throw new Error(`snub 24-cell: ${edges.length} edges, expected 432`);
  }

  const lattice: FaceLattice = {
    rank: 4,
    vertexCount: 96,
    layers: [
      undefined,
      { vertices: buildRagged(edges), typeId: new Uint16Array(edges.length) },
      { vertices: buildRagged(faces), typeId: new Uint16Array(faces.length) },
      { vertices: buildRagged(cells), typeId: Uint16Array.from(cellTypes) }
    ],
    boundary: [undefined, undefined, buildRagged(faceEdges), buildRagged(cellFaces)]
  };

  return compileFaceLattice(lattice, positions);
}
