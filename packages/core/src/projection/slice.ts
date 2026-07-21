import { VecN } from '../math/vecn.js';

export interface HyperplaneSlice4Options {
  /** Hyperplane normal in R^4 (normalized internally). */
  normal: VecN | ArrayLike<number>;
  /** Signed distance of the hyperplane from the origin along the normal. */
  offset?: number;
}

export type SliceFrameUpdatePolicy = 'continuous' | 'canonical';

export interface HyperplaneSlice4SetNormalOptions {
  /**
   * `continuous` transports the preceding display basis into the new
   * hyperplane. `canonical` recomputes the deterministic axis-based frame.
   */
  readonly frame?: SliceFrameUpdatePolicy;
}

/** Optional source-edge and interpolation data for every emitted slice vertex. */
export interface SliceVertexProvenanceBuffers {
  /** Packed source vertex pairs, two entries per emitted vertex. */
  readonly edgeVertices: Uint32Array;
  /** `p = from + t * (to - from)`, one entry per emitted vertex. */
  readonly edgeParameters: Float64Array;
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
   * Slice orthogonal to a coordinate axis (default: w). Axis indices are
   * `0=x`, `1=y`, `2=z`, `3=w`; for hiddenAxis 3 the display frame is exactly
   * x, y, z.
   */
  static axisAligned(hiddenAxis = 3, offset = 0): HyperplaneSlice4 {
    return new HyperplaneSlice4({ normal: VecN.basis(4, hiddenAxis), offset });
  }

  /**
   * Reorients the hyperplane. The normal is normalized and the in-plane
   * display basis recomputed **in place**, so render products holding a
   * reference to `normal` or `basis` see the new frame on their next update.
   */
  setNormal(
    normal: VecN | ArrayLike<number>,
    { frame = 'continuous' }: HyperplaneSlice4SetNormalOptions = {}
  ): this {
    const n = normal instanceof VecN ? normal : new VecN(normal);
    if (n.dim !== 4) throw new Error(`HyperplaneSlice4: normal must be 4D, got ${n.dim}D`);
    this.normal.copy(n).normalize();
    if (frame !== 'continuous' && frame !== 'canonical') {
      throw new Error(`HyperplaneSlice4.setNormal: unknown frame policy ${String(frame)}`);
    }
    const fresh = frame === 'continuous'
      ? transportComplementBasis(this.normal, this.basis)
      : computeComplementBasis(this.normal);
    for (let k = 0; k < 3; k++) this.basis[k]!.set(fresh[k]!);
    return this;
  }

  signedDistance(x0: number, x1: number, x2: number, x3: number): number {
    const n = this.normal.data;
    return n[0]! * x0 + n[1]! * x1 + n[2]! * x2 + n[3]! * x3 - this.offset;
  }

  /** Embed one point from this slice's 3D display frame back into ambient R4. */
  embedPoint(point: ArrayLike<number>): [number, number, number, number] {
    if (point.length !== 3) {
      throw new Error(`HyperplaneSlice4.embedPoint: expected a 3D point, got ${point.length}D`);
    }
    if (![point[0], point[1], point[2]].every((coordinate) => Number.isFinite(coordinate))) {
      throw new Error('HyperplaneSlice4.embedPoint: coordinates must be finite');
    }
    const normal = this.normal.data;
    const out: [number, number, number, number] = [0, 0, 0, 0];
    for (let component = 0; component < 4; component++) {
      out[component] = normal[component]! * this.offset;
      for (let axis = 0; axis < 3; axis++) {
        out[component] = out[component]! + this.basis[axis]![component]! * point[axis]!;
      }
    }
    return out;
  }
}

/**
 * Projects the preceding frame into the new hyperplane before orthonormalizing.
 * For a continuously moving normal this selects the nearby frame instead of
 * snapping when the canonical coordinate-axis ordering changes.
 */
function transportComplementBasis(
  normal: VecN,
  previous: readonly Float64Array[]
): [Float64Array, Float64Array, Float64Array] {
  const candidates = [
    ...previous,
    ...[0, 1, 2, 3].map((axis) => VecN.basis(4, axis).data)
  ];
  const basis: Float64Array[] = [];
  const nd = normal.data;
  for (const candidate of candidates) {
    const vector = Float64Array.from(candidate);
    orthogonalize(vector, nd, basis);
    // A second pass keeps the transported frame orthogonal near rank loss.
    orthogonalize(vector, nd, basis);
    const norm = Math.hypot(...vector);
    if (norm <= 1e-12) continue;
    for (let coordinate = 0; coordinate < 4; coordinate++) {
      vector[coordinate]! /= norm;
    }
    basis.push(vector);
    if (basis.length === 3) break;
  }
  if (basis.length !== 3) {
    throw new Error('HyperplaneSlice4: could not transport a complete display frame');
  }
  return basis as [Float64Array, Float64Array, Float64Array];
}

function orthogonalize(
  vector: Float64Array,
  normal: Float64Array,
  basis: readonly Float64Array[]
): void {
  let dot = 0;
  for (let coordinate = 0; coordinate < 4; coordinate++) {
    dot += vector[coordinate]! * normal[coordinate]!;
  }
  for (let coordinate = 0; coordinate < 4; coordinate++) {
    vector[coordinate]! -= dot * normal[coordinate]!;
  }
  for (const existing of basis) {
    dot = 0;
    for (let coordinate = 0; coordinate < 4; coordinate++) {
      dot += vector[coordinate]! * existing[coordinate]!;
    }
    for (let coordinate = 0; coordinate < 4; coordinate++) {
      vector[coordinate]! -= dot * existing[coordinate]!;
    }
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
 * @param outVertexProvenance optional source edge and interpolation parameter
 *                       for every emitted vertex; buffers must hold six
 *                       vertices per source tetrahedron
 * @returns number of vertices written (a multiple of 3)
 */
export function sliceTetrahedraAmbient(
  worldPositions: Float64Array,
  tets: Uint32Array,
  slice: HyperplaneSlice4,
  outPositions: Float64Array,
  epsilon = 1e-9,
  outProvenance?: Uint32Array,
  outVertexProvenance?: SliceVertexProvenanceBuffers
): number {
  const tetCount = tets.length / 4;
  if (outPositions.length < tetCount * 24) {
    throw new Error(
      `sliceTetrahedraAmbient: output buffer too small (${outPositions.length} < ${tetCount * 24})`
    );
  }
  if (
    outVertexProvenance !== undefined &&
    (
      outVertexProvenance.edgeVertices.length < tetCount * 12 ||
      outVertexProvenance.edgeParameters.length < tetCount * 6
    )
  ) {
    throw new Error('sliceTetrahedraAmbient: vertex provenance buffer too small');
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
    const outputVertex = out / 4;
    if (outVertexProvenance !== undefined) {
      outVertexProvenance.edgeVertices[outputVertex * 2] = from;
      outVertexProvenance.edgeVertices[outputVertex * 2 + 1] = to;
      outVertexProvenance.edgeParameters[outputVertex] = t;
    }
    const a = from * 4;
    const b = to * 4;
    for (let c = 0; c < 4; c++) {
      outPositions[out++] =
        worldPositions[a + c]! + t * (worldPositions[b + c]! - worldPositions[a + c]!);
    }
  };

  const copyEmittedVertex = (sourceVertex: number): void => {
    const outputVertex = out / 4;
    outPositions.copyWithin(out, sourceVertex * 4, sourceVertex * 4 + 4);
    if (outVertexProvenance !== undefined) {
      outVertexProvenance.edgeVertices[outputVertex * 2] =
        outVertexProvenance.edgeVertices[sourceVertex * 2]!;
      outVertexProvenance.edgeVertices[outputVertex * 2 + 1] =
        outVertexProvenance.edgeVertices[sourceVertex * 2 + 1]!;
      outVertexProvenance.edgeParameters[outputVertex] =
        outVertexProvenance.edgeParameters[sourceVertex]!;
    }
    out += 4;
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
      const quadStartVertex = quadStart / 4;
      copyEmittedVertex(quadStartVertex);
      copyEmittedVertex(quadStartVertex + 2);
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
  outProvenance?: Uint32Array,
  outVertexProvenance?: SliceVertexProvenanceBuffers
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
    outProvenance,
    outVertexProvenance
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
