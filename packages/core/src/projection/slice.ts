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
 * An affine hyperplane in ℝ⁴, `{ x : ⟨normal, x⟩ = offset }`, together with
 * an orthonormal basis of the hyperplane used as the display frame: sliced
 * geometry is expressed in these 3 in-plane coordinates and rendered
 * directly as 3D.
 *
 * 4D-specific for now (the slice of ℝ⁴ is the only one that is itself a
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
    this.basis = computeComplementBasisN(this.normal) as
      [Float64Array, Float64Array, Float64Array];
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
      ? transportComplementBasisN(this.normal, this.basis, 'HyperplaneSlice4')
      : computeComplementBasisN(this.normal);
    for (let k = 0; k < 3; k++) this.basis[k]!.set(fresh[k]!);
    return this;
  }

  signedDistance(x0: number, x1: number, x2: number, x3: number): number {
    const n = this.normal.data;
    return n[0]! * x0 + n[1]! * x1 + n[2]! * x2 + n[3]! * x3 - this.offset;
  }

  /**
   * Orthogonally project an ambient R4 point into this slice's 3D display
   * chart while retaining the discarded normal component explicitly.
   *
   * For a point on the hyperplane, `embedPoint(result.coordinates)` recovers
   * the input. For an arbitrary point, add
   * `result.signedDistance * normal` to that embedded point to reconstruct it.
   */
  projectPointToChart(point: ArrayLike<number>): {
    /** Coordinates of the point's orthogonal projection in the slice basis. */
    readonly coordinates: [number, number, number];
    /** Signed ambient distance from the point to this hyperplane. */
    readonly signedDistance: number;
  } {
    if (point.length !== 4) {
      throw new Error(
        `HyperplaneSlice4.projectPointToChart: expected a 4D point, got ${point.length}D`
      );
    }
    if (![point[0], point[1], point[2], point[3]].every(
      (coordinate) => Number.isFinite(coordinate)
    )) {
      throw new Error('HyperplaneSlice4.projectPointToChart: coordinates must be finite');
    }
    const coordinates: [number, number, number] = [0, 0, 0];
    for (let axis = 0; axis < 3; axis++) {
      const basis = this.basis[axis]!;
      coordinates[axis] =
        basis[0]! * point[0]! +
        basis[1]! * point[1]! +
        basis[2]! * point[2]! +
        basis[3]! * point[3]!;
    }
    return {
      coordinates,
      signedDistance: this.signedDistance(point[0]!, point[1]!, point[2]!, point[3]!)
    };
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

/** Construction parameters for a {@link HyperplaneSliceN}. */
export interface HyperplaneSliceNOptions {
  /** Hyperplane normal; its length fixes the ambient dimension. */
  readonly normal: VecN | ArrayLike<number>;
  /** Signed distance of the hyperplane from the origin along the normal. */
  readonly offset?: number;
}

/**
 * An affine hyperplane in ℝⁿ, `{ x : ⟨normal, x⟩ = offset }`, with an
 * orthonormal basis of that hyperplane as its chart: a section expressed in
 * these `n - 1` in-plane coordinates is an intersection of the ambient set,
 * not a projection of it.
 *
 * A section and a projection lose different things, and conflating them is the
 * misreading this class exists to prevent. A projection is many-to-one — several
 * ambient points share one image, so an image point does not name a source
 * point. A section is injective on what it keeps: every chart point came from
 * exactly one ambient point, the one lying in the hyperplane. What a section
 * loses is *dimension* — everything off the plane is absent rather than
 * flattened onto it.
 *
 * `ambientDim` is inferred from the normal rather than passed separately, so
 * there is no second source of truth to disagree with it.
 *
 * @example
 * A chart in R5, and the two directions a point travels through it. The chart
 * is injective on the hyperplane: a point already lying in it round-trips
 * exactly, while an off-plane point keeps its distance explicitly rather than
 * being silently flattened:
 * ```ts
 * const slice = HyperplaneSliceN.axisAligned(5, 4, 0.25);
 *
 * slice.ambientDim; // 5
 * slice.chartDim; // 4 — one less, because a hyperplane is codimension one
 *
 * const onPlane = [1, 2, 3, 4, 0.25];
 * const chart = slice.projectPointToChart(onPlane);
 * chart.signedDistance; // 0 — it is in the hyperplane
 * slice.embedPoint(chart.coordinates); // back to [1, 2, 3, 4, 0.25]
 *
 * const offPlane = [1, 2, 3, 4, 1.25];
 * const away = slice.projectPointToChart(offPlane);
 * away.signedDistance; // 1 — kept, not discarded
 * away.coordinates.join(); // '1,2,3,4' — the same chart point as above
 * ```
 */
export class HyperplaneSliceN {
  /** Dimension of the space the hyperplane lives in, inferred from the normal. */
  readonly ambientDim: number;
  /** `ambientDim - 1`: a hyperplane has codimension one. */
  readonly chartDim: number;
  /** Unit normal. Reorient it through {@link setNormal}, never by writing it. */
  readonly normal: VecN;
  /** Signed distance of the hyperplane from the origin along the normal. */
  offset: number;
  /** `chartDim` orthonormal in-plane rows, each of length `ambientDim`. */
  readonly basis: readonly Float64Array[];

  /**
   * Builds the chart from a normal, whose length fixes the ambient dimension.
   *
   * The frame is the canonical one: reproducible from the normal alone. Use
   * {@link setNormal} with `frame: 'continuous'` to reorient without snapping.
   *
   * @param options - The hyperplane's normal direction and its signed offset
   *   from the origin along that direction.
   */
  constructor({ normal, offset = 0 }: HyperplaneSliceNOptions) {
    const n = normal instanceof VecN ? normal.clone() : new VecN(normal);
    if (n.dim < 2) {
      throw new Error(
        `HyperplaneSliceN: ambient dimension must be at least 2, got ${n.dim}`
      );
    }
    if (!Number.isFinite(offset)) {
      throw new Error('HyperplaneSliceN: offset must be finite');
    }
    if (!n.data.every((coordinate) => Number.isFinite(coordinate))) {
      throw new Error('HyperplaneSliceN: normal coordinates must be finite');
    }
    if (n.length() === 0) {
      throw new Error('HyperplaneSliceN: normal must be non-zero');
    }
    this.ambientDim = n.dim;
    this.chartDim = n.dim - 1;
    // Normalized through `VecN` rather than by dividing here: the reciprocal
    // multiply is what keeps a 4D chart bit-identical to `HyperplaneSlice4`.
    this.normal = n.normalize();
    this.offset = offset;
    this.basis = computeComplementBasisN(this.normal);
  }

  /**
   * Slice orthogonal to a coordinate axis. The chart is then exactly the
   * remaining axes, in ascending order.
   */
  static axisAligned(ambientDim: number, hiddenAxis: number, offset = 0): HyperplaneSliceN {
    if (!Number.isSafeInteger(ambientDim) || ambientDim < 2) {
      throw new Error(
        `HyperplaneSliceN.axisAligned: ambientDim must be an integer of at least 2, ` +
        `got ${ambientDim}`
      );
    }
    if (!Number.isSafeInteger(hiddenAxis) || hiddenAxis < 0 || hiddenAxis >= ambientDim) {
      throw new Error(
        `HyperplaneSliceN.axisAligned: hiddenAxis must be in [0, ${ambientDim}), ` +
        `got ${hiddenAxis}`
      );
    }
    return new HyperplaneSliceN({ normal: VecN.basis(ambientDim, hiddenAxis), offset });
  }

  /**
   * Reorients the hyperplane, keeping its ambient dimension. The normal is
   * normalized and the chart basis recomputed **in place**, so a consumer
   * holding `normal` or a `basis` row sees the new frame on its next update.
   *
   * The two policies are different answers, not a default and a fallback:
   * `canonical` is reproducible from the normal alone, while `continuous`
   * depends on the frame it came from and is what a slowly rotating hyperplane
   * wants so its chart does not snap.
   *
   * The policy is passed directly rather than in an options bag, which is the
   * one place this class deliberately reads differently from
   * {@link HyperplaneSlice4}: there is exactly one choice to make, and a bag
   * whose only member is that choice adds a name a caller has to learn without
   * telling them anything. `HyperplaneSlice4.setNormal` keeps its bag unchanged.
   *
   * @param normal - The new normal; its dimension must match this chart's.
   * @param frame - How to choose the reoriented chart basis.
   */
  setNormal(
    normal: VecN | ArrayLike<number>,
    frame: SliceFrameUpdatePolicy = 'continuous'
  ): this {
    const n = normal instanceof VecN ? normal : new VecN(normal);
    if (n.dim !== this.ambientDim) {
      throw new Error(
        `HyperplaneSliceN.setNormal: normal must be ${this.ambientDim}D, got ${n.dim}D`
      );
    }
    if (!n.data.every((coordinate) => Number.isFinite(coordinate))) {
      throw new Error('HyperplaneSliceN.setNormal: normal coordinates must be finite');
    }
    if (n.length() === 0) {
      throw new Error('HyperplaneSliceN.setNormal: normal must be non-zero');
    }
    if (frame !== 'continuous' && frame !== 'canonical') {
      throw new Error(`HyperplaneSliceN.setNormal: unknown frame policy ${String(frame)}`);
    }
    this.normal.copy(n).normalize();
    const fresh = frame === 'continuous'
      ? transportComplementBasisN(this.normal, this.basis, 'HyperplaneSliceN')
      : computeComplementBasisN(this.normal);
    for (let k = 0; k < this.chartDim; k++) this.basis[k]!.set(fresh[k]!);
    return this;
  }

  /** Signed ambient distance from `point` to the hyperplane. */
  signedDistance(point: ArrayLike<number>): number {
    if (point.length !== this.ambientDim) {
      throw new Error(
        `HyperplaneSliceN.signedDistance: expected a ${this.ambientDim}D point, ` +
        `got ${point.length}D`
      );
    }
    const n = this.normal.data;
    let sum = 0;
    for (let c = 0; c < this.ambientDim; c++) sum += n[c]! * point[c]!;
    return sum - this.offset;
  }

  /**
   * Orthogonally project an ambient point into the chart, keeping the discarded
   * normal component explicitly.
   *
   * For a point on the hyperplane, `embedPoint(result.coordinates)` recovers the
   * input. For any other point, add `result.signedDistance * normal` to that
   * embedded point to reconstruct it — nothing is lost silently.
   */
  projectPointToChart(point: ArrayLike<number>): {
    /** `chartDim` coordinates of the point's orthogonal projection. */
    readonly coordinates: readonly number[];
    /** Signed ambient distance from the point to the hyperplane. */
    readonly signedDistance: number;
  } {
    if (point.length !== this.ambientDim) {
      throw new Error(
        `HyperplaneSliceN.projectPointToChart: expected a ${this.ambientDim}D point, ` +
        `got ${point.length}D`
      );
    }
    const coordinates: number[] = [];
    for (let axis = 0; axis < this.chartDim; axis++) {
      const basis = this.basis[axis]!;
      let sum = 0;
      for (let c = 0; c < this.ambientDim; c++) {
        const coordinate = point[c]!;
        if (!Number.isFinite(coordinate)) {
          throw new Error('HyperplaneSliceN.projectPointToChart: coordinates must be finite');
        }
        sum += basis[c]! * coordinate;
      }
      coordinates.push(sum);
    }
    return { coordinates, signedDistance: this.signedDistance(point) };
  }

  /** Embed one chart point back into ambient space. */
  embedPoint(point: ArrayLike<number>): number[] {
    if (point.length !== this.chartDim) {
      throw new Error(
        `HyperplaneSliceN.embedPoint: expected a ${this.chartDim}D point, got ${point.length}D`
      );
    }
    for (let axis = 0; axis < this.chartDim; axis++) {
      if (!Number.isFinite(point[axis]!)) {
        throw new Error('HyperplaneSliceN.embedPoint: coordinates must be finite');
      }
    }
    const normal = this.normal.data;
    const out: number[] = [];
    for (let c = 0; c < this.ambientDim; c++) {
      let value = normal[c]! * this.offset;
      for (let axis = 0; axis < this.chartDim; axis++) {
        value += this.basis[axis]![c]! * point[axis]!;
      }
      out.push(value);
    }
    return out;
  }
}

/**
 * Projects the preceding frame into the new hyperplane before orthonormalizing.
 * For a continuously moving normal this selects the nearby frame instead of
 * snapping when the canonical coordinate-axis ordering changes.
 *
 * Dimension-generic and shared with {@link HyperplaneSliceN}. For a 4D normal
 * it performs exactly the operations the R4-only predecessor did, in the same
 * order, so the transported frame is bit-identical.
 */
function transportComplementBasisN(
  normal: VecN,
  previous: readonly Float64Array[],
  caller: string
): Float64Array[] {
  const dim = normal.dim;
  const chartDim = dim - 1;
  const candidates = [
    ...previous,
    ...Array.from({ length: dim }, (_unused, axis) => VecN.basis(dim, axis).data)
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
    for (let coordinate = 0; coordinate < dim; coordinate++) {
      vector[coordinate]! /= norm;
    }
    basis.push(vector);
    if (basis.length === chartDim) break;
  }
  if (basis.length !== chartDim) {
    throw new Error(`${caller}: could not transport a complete display frame`);
  }
  return basis;
}

function orthogonalize(
  vector: Float64Array,
  normal: Float64Array,
  basis: readonly Float64Array[]
): void {
  const dim = vector.length;
  let dot = 0;
  for (let coordinate = 0; coordinate < dim; coordinate++) {
    dot += vector[coordinate]! * normal[coordinate]!;
  }
  for (let coordinate = 0; coordinate < dim; coordinate++) {
    vector[coordinate]! -= dot * normal[coordinate]!;
  }
  for (const existing of basis) {
    dot = 0;
    for (let coordinate = 0; coordinate < dim; coordinate++) {
      dot += vector[coordinate]! * existing[coordinate]!;
    }
    for (let coordinate = 0; coordinate < dim; coordinate++) {
      vector[coordinate]! -= dot * existing[coordinate]!;
    }
  }
}

/**
 * Orthonormal basis of the complement of `normal`: project the standard basis
 * vectors onto the hyperplane, keep the `dim - 1` least parallel to the normal
 * (stability), and run modified Gram–Schmidt. For an axis-aligned normal this
 * returns the remaining coordinate axes unchanged, in ascending axis order.
 *
 * Dimension-generic and shared with {@link HyperplaneSliceN}; for a 4D normal
 * it is the same operations in the same order as the R4-only predecessor, so
 * the frame is bit-identical.
 */
function computeComplementBasisN(normal: VecN): Float64Array[] {
  const nd = normal.data;
  const dim = normal.dim;
  const axes = Array.from({ length: dim }, (_unused, axis) => axis)
    .sort((a, b) => Math.abs(nd[a]!) - Math.abs(nd[b]!) || a - b)
    .slice(0, dim - 1);
  axes.sort((a, b) => a - b); // deterministic, axis-ordered display frame
  const basis: Float64Array[] = [];
  for (const axis of axes) {
    const u = new Float64Array(dim);
    u[axis] = 1;
    // Orthogonalize against the normal, then previous basis vectors (MGS).
    let dot = nd[axis]!;
    for (let c = 0; c < dim; c++) u[c]! -= dot * nd[c]!;
    for (const b of basis) {
      dot = 0;
      for (let c = 0; c < dim; c++) dot += u[c]! * b[c]!;
      for (let c = 0; c < dim; c++) u[c]! -= dot * b[c]!;
    }
    let norm = 0;
    for (let c = 0; c < dim; c++) norm += u[c]! * u[c]!;
    norm = Math.sqrt(norm);
    for (let c = 0; c < dim; c++) u[c]! /= norm;
    basis.push(u);
  }
  return basis;
}

/**
 * Marching tetrahedra in ℝ⁴: intersects tetrahedral 3-cells with a
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
