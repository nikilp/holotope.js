import { CellComplex } from '../geometry/cell-complex.js';
import { buildRagged, type FaceLattice } from '../geometry/face-lattice.js';
import { compileFaceLattice, type CompiledPolytope } from '../geometry/compile-lattice.js';
import { cell600Data } from './cell600.js';

const PHI = (1 + Math.sqrt(5)) / 2;

export interface GrandAntiprismOptions {
  /** Circumradius. Default 1. */
  radius?: number;
}

/**
 * The grand antiprism — 100 vertices, 500 edges, 720 faces (700
 * triangles + 20 pentagons), 300 tetrahedral + 20 pentagonal-antiprism
 * cells — as an exact diminishing of the 600-cell: remove the 20
 * vertices of two completely orthogonal great decagons.
 *
 * The rings are found exactly: a great decagon is a closed edge
 * geodesic obeying the chord relation v_{k+2} = φ·v_{k+1} − v_k, and
 * the orthogonal ring is the set of vertices with zero dot product
 * against the first ring's plane. Each removed vertex leaves a
 * pentagonal antiprism (its 10 surviving neighbors); the antiprisms'
 * pentagon caps are edge figures of the removed ring's edges, shared
 * between consecutive antiprisms of the same ring.
 */
export function createGrandAntiprism(options: GrandAntiprismOptions = {}): CellComplex {
  return createGrandAntiprismCompiled(options).complex;
}

/** The grand antiprism with its face lattice and provenance retained. */
export function createGrandAntiprismCompiled({
  radius = 1
}: GrandAntiprismOptions = {}): CompiledPolytope {
  const { vertices, neighbors, tets } = cell600Data();

  // Vertex lookup by rounded exact coordinates (values are separated by
  // ≥ 0.19, so 1e-6 rounding is collision-free).
  const byKey = new Map<string, number>();
  const key = (x: number, y: number, z: number, w: number): string =>
    [x, y, z, w].map((c) => (Math.abs(c) < 1e-9 ? '0.000000' : c.toFixed(6))).join(',');
  for (let v = 0; v < 120; v++) {
    byKey.set(key(vertices[v * 4]!, vertices[v * 4 + 1]!, vertices[v * 4 + 2]!, vertices[v * 4 + 3]!), v);
  }

  // First decagon: walk the geodesic from vertex 0 through its first
  // neighbor with the exact chord relation.
  const ringA: number[] = [0, neighbors[0]![0]!];
  while (ringA.length < 10) {
    const a = ringA[ringA.length - 2]!;
    const b = ringA[ringA.length - 1]!;
    const next = key(
      PHI * vertices[b * 4]! - vertices[a * 4]!,
      PHI * vertices[b * 4 + 1]! - vertices[a * 4 + 1]!,
      PHI * vertices[b * 4 + 2]! - vertices[a * 4 + 2]!,
      PHI * vertices[b * 4 + 3]! - vertices[a * 4 + 3]!
    );
    const v = byKey.get(next);
    if (v === undefined) throw new Error('grand antiprism: decagon geodesic left the vertex set');
    ringA.push(v);
  }
  if (new Set(ringA).size !== 10) throw new Error('grand antiprism: decagon does not close on 10');

  // Orthogonal decagon: every vertex orthogonal to the first ring's plane.
  const dot = (a: number, b: number): number => {
    let acc = 0;
    for (let c = 0; c < 4; c++) acc += vertices[a * 4 + c]! * vertices[b * 4 + c]!;
    return acc;
  };
  const ringB: number[] = [];
  for (let v = 0; v < 120; v++) {
    if (Math.abs(dot(v, ringA[0]!)) < 1e-9 && Math.abs(dot(v, ringA[1]!)) < 1e-9) ringB.push(v);
  }
  if (ringB.length !== 10) {
    throw new Error(`grand antiprism: orthogonal ring has ${ringB.length} vertices, expected 10`);
  }

  const removed = new Set<number>([...ringA, ...ringB]);
  if (removed.size !== 20) throw new Error('grand antiprism: rings overlap');
  // Ring order of B (needed for its antiprisms' caps): each ring vertex
  // has exactly two removed neighbors — its ring predecessors/successors.
  const removedRingNeighbors = new Map<number, number[]>();
  for (const r of removed) {
    const ringMates = neighbors[r]!.filter((n) => removed.has(n));
    if (ringMates.length !== 2) {
      throw new Error(`grand antiprism: removed vertex with ${ringMates.length} removed neighbors`);
    }
    removedRingNeighbors.set(r, ringMates);
  }

  // Reindex survivors.
  const newIndex = new Int32Array(120).fill(-1);
  let kept = 0;
  for (let v = 0; v < 120; v++) if (!removed.has(v)) newIndex[v] = kept++;
  if (kept !== 100) throw new Error(`grand antiprism: kept ${kept} vertices, expected 100`);
  const positions = new Float64Array(100 * 4);
  for (let v = 0; v < 120; v++) {
    if (newIndex[v] === -1) continue;
    for (let c = 0; c < 4; c++) positions[newIndex[v]! * 4 + c] = vertices[v * 4 + c]! * radius;
  }

  // Cells: untouched tetrahedra (300) + one pentagonal antiprism per
  // removed vertex (its 10 surviving neighbors).
  const adjacency = neighbors.map((list) => new Set(list));
  const cells: number[][] = [];
  const cellTypes: number[] = [];
  for (let t = 0; t < tets.length; t += 4) {
    const quad = [tets[t]!, tets[t + 1]!, tets[t + 2]!, tets[t + 3]!];
    if (quad.some((v) => removed.has(v))) continue;
    cells.push(quad.map((v) => newIndex[v]!));
    cellTypes.push(0);
  }
  if (cells.length !== 300) {
    throw new Error(`grand antiprism: ${cells.length} surviving tetrahedra, expected 300`);
  }

  const faceId = new Map<string, number>();
  const faces: number[][] = [];
  const internFace = (loop: number[]): number => {
    const k = [...loop].sort((a, b) => a - b).join(',');
    let id = faceId.get(k);
    if (id === undefined) {
      id = faces.length;
      faceId.set(k, id);
      faces.push(loop);
    }
    return id;
  };
  const cellFaces: number[][] = [];
  for (const cell of cells) {
    const list: number[] = [];
    for (let skip = 0; skip < 4; skip++) list.push(internFace(cell.filter((_, i) => i !== skip)));
    cellFaces.push(list);
  }

  // Pentagon cap of removed edge (r, s): the surviving common neighbors
  // of r and s (an edge figure), walked into its 5-cycle.
  const capOf = (r: number, s: number): number[] => {
    const cap = neighbors[r]!.filter((n) => !removed.has(n) && adjacency[s]!.has(n));
    if (cap.length !== 5) throw new Error(`grand antiprism: cap of size ${cap.length}`);
    const inCap = new Set(cap);
    const loop = [cap[0]!];
    let prev = -1;
    while (loop.length < 5) {
      const here = loop[loop.length - 1]!;
      const next = neighbors[here]!.find((n) => inCap.has(n) && n !== prev && !loop.includes(n));
      if (next === undefined) throw new Error('grand antiprism: cap is not a 5-cycle');
      prev = here;
      loop.push(next);
    }
    return loop.map((v) => newIndex[v]!);
  };

  for (const r of removed) {
    const base = neighbors[r]!.filter((n) => !removed.has(n));
    if (base.length !== 10) throw new Error('grand antiprism: antiprism base is not 10 vertices');
    cells.push(base.map((v) => newIndex[v]!));
    cellTypes.push(1);
    const list: number[] = [];
    // 10 side triangles: induced adjacency triangles on the base.
    const baseNew = new Set(base.map((v) => newIndex[v]!));
    const oldOf = new Map(base.map((v) => [newIndex[v]!, v] as const));
    const baseSorted = [...baseNew].sort((a, b) => a - b);
    for (let i = 0; i < baseSorted.length; i++) {
      for (let j = i + 1; j < baseSorted.length; j++) {
        if (!adjacency[oldOf.get(baseSorted[i]!)!]!.has(oldOf.get(baseSorted[j]!)!)) continue;
        for (let k = j + 1; k < baseSorted.length; k++) {
          if (
            adjacency[oldOf.get(baseSorted[i]!)!]!.has(oldOf.get(baseSorted[k]!)!) &&
            adjacency[oldOf.get(baseSorted[j]!)!]!.has(oldOf.get(baseSorted[k]!)!)
          ) {
            list.push(internFace([baseSorted[i]!, baseSorted[j]!, baseSorted[k]!]));
          }
        }
      }
    }
    // 2 pentagon caps toward the ring neighbors, shared with the
    // consecutive antiprisms of the same ring.
    for (const s of removedRingNeighbors.get(r)!) list.push(internFace(capOf(r, s)));
    if (list.length !== 12) {
      throw new Error(`grand antiprism: antiprism with ${list.length} faces, expected 12`);
    }
    cellFaces.push(list);
  }
  if (faces.length !== 720) throw new Error(`grand antiprism: ${faces.length} faces, expected 720`);

  // Edges from face sides.
  const edgeId = new Map<number, number>();
  const edges: number[][] = [];
  const faceEdges = faces.map((loop) => {
    const list: number[] = [];
    for (let k = 0; k < loop.length; k++) {
      const a = loop[k]!;
      const b = loop[(k + 1) % loop.length]!;
      const kk = a < b ? a * 100 + b : b * 100 + a;
      let id = edgeId.get(kk);
      if (id === undefined) {
        id = edges.length;
        edgeId.set(kk, id);
        edges.push(a < b ? [a, b] : [b, a]);
      }
      list.push(id);
    }
    return list;
  });
  if (edges.length !== 500) throw new Error(`grand antiprism: ${edges.length} edges, expected 500`);

  const lattice: FaceLattice = {
    rank: 4,
    vertexCount: 100,
    layers: [
      undefined,
      { vertices: buildRagged(edges), typeId: new Uint16Array(edges.length) },
      {
        vertices: buildRagged(faces),
        typeId: Uint16Array.from(faces.map((f) => (f.length === 3 ? 0 : 1)))
      },
      { vertices: buildRagged(cells), typeId: Uint16Array.from(cellTypes) }
    ],
    boundary: [undefined, undefined, buildRagged(faceEdges), buildRagged(cellFaces)]
  };

  return compileFaceLattice(lattice, positions);
}
