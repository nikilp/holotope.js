import { VecN } from '../math/vecn.js';

export interface HyperplaneSlice4Options {
  /** Hyperplane normal in R^4 (normalized internally). */
  normal: VecN | ArrayLike<number>;
  /** Signed distance of the hyperplane from the origin along the normal. */
  offset?: number;
}

/**
 * An affine hyperplane in R^4, `{ x : ⟨normal, x⟩ = offset }`, together with
 * an orthonormal basis of the hyperplane used as the display frame: sliced
 * geometry is expressed in these 3 in-plane coordinates and rendered
 * directly as 3D.
 *
 * 4D-specific for now (the slice of R^4 is the only one that is itself a
 * renderable 3-flat); the N-parameterized generalization arrives with
 * chained slicing.
 */
export class HyperplaneSlice4 {
  readonly normal: VecN;
  offset: number;
  /** Rows: 3 orthonormal in-plane basis vectors (each length 4). */
  readonly basis: [Float64Array, Float64Array, Float64Array];

  constructor({ normal, offset = 0 }: HyperplaneSlice4Options) {
    const n = normal instanceof VecN ? normal.clone() : new VecN(normal);
    if (n.dim !== 4) throw new Error(`HyperplaneSlice4: normal must be 4D, got ${n.dim}D`);
    this.normal = n.normalize();
    this.offset = offset;
    this.basis = computeComplementBasis(this.normal);
  }

  /**
   * Slice orthogonal to a coordinate axis (default: w). For hiddenAxis 3 the
   * display frame is exactly x, y, z.
   */
  static axisAligned(hiddenAxis = 3, offset = 0): HyperplaneSlice4 {
    return new HyperplaneSlice4({ normal: VecN.basis(4, hiddenAxis), offset });
  }

  signedDistance(x0: number, x1: number, x2: number, x3: number): number {
    const n = this.normal.data;
    return n[0]! * x0 + n[1]! * x1 + n[2]! * x2 + n[3]! * x3 - this.offset;
  }
}

/**
 * Orthonormal basis of the complement of `normal` in R^4: project the
 * standard basis vectors onto the hyperplane, keep the three least parallel
 * to the normal (stability), and run modified Gram–Schmidt. For an
 * axis-aligned normal this returns the remaining coordinate axes unchanged,
 * in ascending axis order.
 */
function computeComplementBasis(normal: VecN): [Float64Array, Float64Array, Float64Array] {
  const nd = normal.data;
  const axes = [0, 1, 2, 3].sort((a, b) => Math.abs(nd[a]!) - Math.abs(nd[b]!) || a - b).slice(0, 3);
  axes.sort((a, b) => a - b); // deterministic, axis-ordered display frame
  const basis: Float64Array[] = [];
  for (const axis of axes) {
    const u = new Float64Array(4);
    u[axis] = 1;
    // Orthogonalize against the normal, then previous basis vectors (MGS).
    let dot = nd[axis]!;
    for (let c = 0; c < 4; c++) u[c]! -= dot * nd[c]!;
    for (const b of basis) {
      dot = 0;
      for (let c = 0; c < 4; c++) dot += u[c]! * b[c]!;
      for (let c = 0; c < 4; c++) u[c]! -= dot * b[c]!;
    }
    let norm = 0;
    for (let c = 0; c < 4; c++) norm += u[c]! * u[c]!;
    norm = Math.sqrt(norm);
    for (let c = 0; c < 4; c++) u[c]! /= norm;
    basis.push(u);
  }
  return basis as [Float64Array, Float64Array, Float64Array];
}

/**
 * Marching tetrahedra in R^4: intersects tetrahedral 3-cells with a
 * hyperplane, emitting a triangle-soup cross-section surface as **ambient
 * 4D points** (all lying in the hyperplane). Use this form when the
 * section should be re-projected like any other 4D geometry — e.g.
 * rendering the cut inside a perspective projection; use
 * `sliceTetrahedra` for the section in the slice's own 3D display frame.
 *
 * Degeneracy policy: signed distances within `epsilon` of the hyperplane
 * snap to zero and count as non-negative (canonical tie-break), so
 * on-plane vertices interpolate exactly to themselves and cells lying
 * entirely in the hyperplane are suppressed rather than emitted twice.
 * Triangle winding is not globally consistent — render double-sided.
 *
 * @param worldPositions packed 4D vertex coordinates (post-transform)
 * @param tets           flat tetra vertex indices (4 per cell)
 * @param slice          the hyperplane
 * @param outPositions   output for packed 4D triangle vertices; must hold at
 *                       least `(tets.length / 4) * 24` floats (2 triangles ×
 *                       3 vertices × 4 coords per tetra worst case)
 * @param outProvenance  optional per-triangle provenance: the source tetra
 *                       index (position in `tets` / 4) of each emitted
 *                       triangle; must hold `(tets.length / 4) * 2` entries
 * @returns number of vertices written (a multiple of 3)
 */
export function sliceTetrahedraAmbient(
  worldPositions: Float64Array,
  tets: Uint32Array,
  slice: HyperplaneSlice4,
  outPositions: Float64Array,
  epsilon = 1e-9,
  outProvenance?: Uint32Array
): number {
  const tetCount = tets.length / 4;
  if (outPositions.length < tetCount * 24) {
    throw new Error(
      `sliceTetrahedraAmbient: output buffer too small (${outPositions.length} < ${tetCount * 24})`
    );
  }

  const neg: number[] = [];
  const negS: number[] = [];
  const nonneg: number[] = [];
  const posS: number[] = [];
  let out = 0;
  let triangleCount = 0;

  // Interpolates the crossing point on edge (from → to) and writes its
  // ambient 4D coordinates to outPositions.
  const emitCrossing = (from: number, to: number, sFrom: number, sTo: number): void => {
    const t = sFrom / (sFrom - sTo);
    const a = from * 4;
    const b = to * 4;
    for (let c = 0; c < 4; c++) {
      outPositions[out++] =
        worldPositions[a + c]! + t * (worldPositions[b + c]! - worldPositions[a + c]!);
    }
  };

  const recordTriangles = (tet: number, count: number): void => {
    if (!outProvenance) {
      triangleCount += count;
      return;
    }
    for (let k = 0; k < count; k++) outProvenance[triangleCount++] = tet;
  };

  for (let tet = 0; tet < tetCount; tet++) {
    neg.length = 0;
    negS.length = 0;
    nonneg.length = 0;
    posS.length = 0;
    for (let v = 0; v < 4; v++) {
      const idx = tets[tet * 4 + v]!;
      const base = idx * 4;
      let d = slice.signedDistance(
        worldPositions[base]!,
        worldPositions[base + 1]!,
        worldPositions[base + 2]!,
        worldPositions[base + 3]!
      );
      if (Math.abs(d) <= epsilon) d = 0;
      if (d < 0) {
        neg.push(idx);
        negS.push(d);
      } else {
        nonneg.push(idx);
        posS.push(d);
      }
    }

    if (neg.length === 0 || neg.length === 4) continue;

    if (neg.length === 1) {
      // One vertex below: triangle from its three crossing edges.
      for (let k = 0; k < 3; k++) emitCrossing(neg[0]!, nonneg[k]!, negS[0]!, posS[k]!);
      recordTriangles(tet, 1);
    } else if (neg.length === 3) {
      // One vertex above: symmetric triangle.
      for (let k = 0; k < 3; k++) emitCrossing(neg[k]!, nonneg[0]!, negS[k]!, posS[0]!);
      recordTriangles(tet, 1);
    } else {
      // 2–2 split: quad across four crossing edges, emitted as two triangles.
      // Cyclic order (n0,p0) → (n0,p1) → (n1,p1) → (n1,p0).
      const quadStart = out;
      emitCrossing(neg[0]!, nonneg[0]!, negS[0]!, posS[0]!);
      emitCrossing(neg[0]!, nonneg[1]!, negS[0]!, posS[1]!);
      emitCrossing(neg[1]!, nonneg[1]!, negS[1]!, posS[1]!);
      // Second triangle: quad vertices 0, 2, 3.
      outPositions.copyWithin(out, quadStart, quadStart + 4);
      out += 4;
      outPositions.copyWithin(out, quadStart + 8, quadStart + 12);
      out += 4;
      emitCrossing(neg[1]!, nonneg[0]!, negS[1]!, posS[0]!);
      recordTriangles(tet, 2);
    }
  }

  return out / 4;
}

// Reusable scratch for the slice-frame wrapper (single-threaded JS).
let ambientScratch = new Float64Array(0);

/**
 * Marching tetrahedra with output in the slice's own 3D display frame:
 * each ambient crossing point is expressed in the hyperplane's orthonormal
 * basis, ready for direct 3D rendering. Same degeneracy policy and output
 * layout contract as `sliceTetrahedraAmbient`, but 3 floats per vertex
 * (buffer must hold `(tets.length / 4) * 18`).
 */
export function sliceTetrahedra(
  worldPositions: Float64Array,
  tets: Uint32Array,
  slice: HyperplaneSlice4,
  outPositions: Float32Array,
  epsilon = 1e-9,
  outProvenance?: Uint32Array
): number {
  const tetCount = tets.length / 4;
  if (outPositions.length < tetCount * 18) {
    throw new Error(
      `sliceTetrahedra: output buffer too small (${outPositions.length} < ${tetCount * 18})`
    );
  }
  if (ambientScratch.length < tetCount * 24) {
    ambientScratch = new Float64Array(tetCount * 24);
  }
  const count = sliceTetrahedraAmbient(
    worldPositions,
    tets,
    slice,
    ambientScratch,
    epsilon,
    outProvenance
  );
  for (let v = 0; v < count; v++) {
    const p = v * 4;
    for (let k = 0; k < 3; k++) {
      const bk = slice.basis[k]!;
      outPositions[v * 3 + k] =
        bk[0]! * ambientScratch[p]! +
        bk[1]! * ambientScratch[p + 1]! +
        bk[2]! * ambientScratch[p + 2]! +
        bk[3]! * ambientScratch[p + 3]!;
    }
  }
  return count;
}
