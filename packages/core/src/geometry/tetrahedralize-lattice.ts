import { raggedCount, raggedItem, type FaceLattice } from './face-lattice.js';

/**
 * A tetrahedralization of a face lattice's 3-cells, with full provenance:
 * the derived object every slicer, picker, and per-cell material reads.
 */
export interface Tetrahedralization {
  /** Source vertices followed by one centroid helper vertex per 3-cell. */
  readonly positions: Float64Array;
  /** Four vertex indices per tetrahedron, emitted cell-major. */
  readonly indices: Uint32Array;
  /** Canonical rank-3 face (cell) ID of each tetrahedron. */
  readonly tetToCell: Uint32Array;
  /** Global 2-face whose triangulation generated each tetrahedron. */
  readonly tetToFace: Uint32Array;
  /** Cell c owns tets [cellTetOffsets[c], cellTetOffsets[c+1]). */
  readonly cellTetOffsets: Uint32Array;
  /** Helper centroid vertex index of each cell. */
  readonly cellCentroidVertex: Uint32Array;
  /** Vertex count before helpers were appended. */
  readonly sourceVertexCount: number;
}

/**
 * Centroid-fan tetrahedralization of every 3-cell of a convex polytope's
 * face lattice: each cell's centroid (strictly interior, being a positive
 * combination of its vertices) cones over its boundary polygons, and each
 * polygon is fan-triangulated **once globally** — adjacent cells reuse the
 * same triangles, so slices stay continuous across cell boundaries.
 *
 * Tetrahedra are emitted cell-major and positively oriented in each
 * cell's outward-oriented tangent frame; a degenerate (near-zero volume)
 * tetrahedron throws rather than silently corrupting downstream volume
 * or slicing invariants. Float64 is appropriate here: orientation
 * validates known topology, it does not determine incidence.
 */
export function tetrahedralizeLattice(
  lattice: FaceLattice,
  positions: Float64Array
): Tetrahedralization {
  if (lattice.rank !== 4) {
    throw new Error(`tetrahedralizeLattice: rank-4 lattices only, got rank ${lattice.rank}`);
  }
  const faces = lattice.layers[2];
  const cells = lattice.layers[3];
  const cellFaces = lattice.boundary[3];
  if (!faces || !cells || !cellFaces) {
    throw new Error('tetrahedralizeLattice: lattice needs 2-faces, 3-cells, and cell→face boundary');
  }
  const sourceVertexCount = lattice.vertexCount;
  const faceCount = raggedCount(faces.vertices);
  const cellCount = raggedCount(cells.vertices);

  // Global polygon triangulation, computed once per 2-face: fan
  // (v0, vi, vi+1) over the canonical cyclic loop.
  const faceTriangles: Uint32Array[] = new Array(faceCount);
  for (let f = 0; f < faceCount; f++) {
    const loop = raggedItem(faces.vertices, f);
    const tris = new Uint32Array((loop.length - 2) * 3);
    for (let k = 1; k < loop.length - 1; k++) {
      tris[(k - 1) * 3] = loop[0]!;
      tris[(k - 1) * 3 + 1] = loop[k]!;
      tris[(k - 1) * 3 + 2] = loop[k + 1]!;
    }
    faceTriangles[f] = tris;
  }

  // Helper centroids and the polytope interior point.
  const out = new Float64Array((sourceVertexCount + cellCount) * 4);
  out.set(positions.subarray(0, sourceVertexCount * 4));
  const interior = new Float64Array(4);
  for (let v = 0; v < sourceVertexCount; v++) {
    for (let c = 0; c < 4; c++) interior[c]! += positions[v * 4 + c]! / sourceVertexCount;
  }

  const indices: number[] = [];
  const tetToCell: number[] = [];
  const tetToFace: number[] = [];
  const cellTetOffsets = new Uint32Array(cellCount + 1);
  const cellCentroidVertex = new Uint32Array(cellCount);

  // Scratch frames.
  const normal = new Float64Array(4);
  const b = [new Float64Array(4), new Float64Array(4), new Float64Array(4)];
  const e = [new Float64Array(4), new Float64Array(4), new Float64Array(4)];

  for (let cell = 0; cell < cellCount; cell++) {
    const cellVerts = raggedItem(cells.vertices, cell);
    const centroidIndex = sourceVertexCount + cell;
    cellCentroidVertex[cell] = centroidIndex;
    const cBase = centroidIndex * 4;
    for (const v of cellVerts) {
      for (let c = 0; c < 4; c++) out[cBase + c]! += positions[v * 4 + c]! / cellVerts.length;
    }

    // Orthonormal tangent basis of the cell's 3-flat (MGS over vertex
    // offsets from the centroid), then the unit normal as the 4D
    // generalized cross product of the basis, oriented outward.
    let found = 0;
    for (const v of cellVerts) {
      const cand = e[found]!;
      for (let c = 0; c < 4; c++) cand[c] = positions[v * 4 + c]! - out[cBase + c]!;
      for (let k = 0; k < found; k++) {
        let dot = 0;
        for (let c = 0; c < 4; c++) dot += cand[c]! * b[k]![c]!;
        for (let c = 0; c < 4; c++) cand[c]! -= dot * b[k]![c]!;
      }
      let norm = 0;
      for (let c = 0; c < 4; c++) norm += cand[c]! * cand[c]!;
      norm = Math.sqrt(norm);
      if (norm > 1e-9) {
        for (let c = 0; c < 4; c++) b[found]![c] = cand[c]! / norm;
        if (++found === 3) break;
      }
    }
    if (found < 3) {
      throw new Error(`tetrahedralizeLattice: cell ${cell} is degenerate (flat span < 3)`);
    }
    cross4(b[0]!, b[1]!, b[2]!, normal);
    let outward = 0;
    for (let c = 0; c < 4; c++) outward += normal[c]! * (out[cBase + c]! - interior[c]!);
    if (outward < 0) {
      for (let c = 0; c < 4; c++) normal[c] = -normal[c]!;
      // Keep det[b0 b1 b2 n] > 0 by swapping two tangent vectors.
      const tmp = b[0]!;
      b[0] = b[1]!;
      b[1] = tmp;
    }

    // Cone every global face triangle to the centroid, positively
    // oriented in the tangent frame.
    for (const face of raggedItem(cellFaces, cell)) {
      const tris = faceTriangles[face]!;
      for (let t = 0; t < tris.length; t += 3) {
        let a = tris[t]!;
        let bb = tris[t + 1]!;
        const d = tris[t + 2]!;
        const det = signedTangentVolume(positions, out, cBase, b, a, bb, d);
        const scale = offsetNorm(positions, out, cBase, a) *
          offsetNorm(positions, out, cBase, bb) *
          offsetNorm(positions, out, cBase, d);
        if (Math.abs(det) <= 1e-12 * Math.max(scale, 1)) {
          throw new Error(
            `tetrahedralizeLattice: degenerate tetrahedron in cell ${cell} (face ${face})`
          );
        }
        if (det < 0) {
          const tmp = a;
          a = bb;
          bb = tmp;
        }
        indices.push(centroidIndex, a, bb, d);
        tetToCell.push(cell);
        tetToFace.push(face);
      }
    }
    cellTetOffsets[cell + 1] = indices.length / 4;
  }

  return {
    positions: out,
    indices: Uint32Array.from(indices),
    tetToCell: Uint32Array.from(tetToCell),
    tetToFace: Uint32Array.from(tetToFace),
    cellTetOffsets,
    cellCentroidVertex,
    sourceVertexCount
  };
}

/** 4D generalized cross product: out ⟂ u, v, w with det[u v w out] > 0. */
function cross4(u: Float64Array, v: Float64Array, w: Float64Array, out: Float64Array): void {
  const m = (a: number, b: number, c: number): number => {
    // 3×3 minor over columns (a, b, c) of rows u, v, w.
    return (
      u[a]! * (v[b]! * w[c]! - v[c]! * w[b]!) -
      u[b]! * (v[a]! * w[c]! - v[c]! * w[a]!) +
      u[c]! * (v[a]! * w[b]! - v[b]! * w[a]!)
    );
  };
  // Cofactor expansion of det[u; v; w; x] along the x row.
  out[0] = -m(1, 2, 3);
  out[1] = m(0, 2, 3);
  out[2] = -m(0, 1, 3);
  out[3] = m(0, 1, 2);
  let norm = 0;
  for (let c = 0; c < 4; c++) norm += out[c]! * out[c]!;
  norm = Math.sqrt(norm);
  for (let c = 0; c < 4; c++) out[c]! /= norm;
}

function offsetNorm(
  positions: Float64Array,
  out: Float64Array,
  cBase: number,
  v: number
): number {
  let acc = 0;
  for (let c = 0; c < 4; c++) {
    const d = positions[v * 4 + c]! - out[cBase + c]!;
    acc += d * d;
  }
  return Math.sqrt(acc);
}

/** det of the boundary-vertex offsets expressed in the tangent basis. */
function signedTangentVolume(
  positions: Float64Array,
  out: Float64Array,
  cBase: number,
  basis: Float64Array[],
  a: number,
  b: number,
  d: number
): number {
  const col = (v: number, k: number): number => {
    let acc = 0;
    for (let c = 0; c < 4; c++) {
      acc += basis[k]![c]! * (positions[v * 4 + c]! - out[cBase + c]!);
    }
    return acc;
  };
  const m00 = col(a, 0), m01 = col(b, 0), m02 = col(d, 0);
  const m10 = col(a, 1), m11 = col(b, 1), m12 = col(d, 1);
  const m20 = col(a, 2), m21 = col(b, 2), m22 = col(d, 2);
  return (
    m00 * (m11 * m22 - m12 * m21) -
    m01 * (m10 * m22 - m12 * m20) +
    m02 * (m10 * m21 - m11 * m20)
  );
}
