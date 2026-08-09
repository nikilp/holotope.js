import type {
  DisplayMap3D,
  DisplayMapInverse3D,
  DisplayMapInvertOptions,
  InvertibleDisplayMap3D
} from './types.js';

/**
 * Runtime capability probe for invertible display maps, in the same family as
 * `isHomogeneousProjection`: adapters branch on disclosed capability, never on
 * subclass identity.
 */
export function isInvertibleDisplayMap3D(
  map: DisplayMap3D
): map is InvertibleDisplayMap3D {
  return typeof (map as Partial<InvertibleDisplayMap3D>).invertPoint === 'function';
}

/**
 * The exact coordinate-plane embedding ℝ² ↪ ℝ³: `[x, y] → [x, y, 0]`.
 *
 * This is an embedding, not a projection — the map is injective, so nothing
 * is collapsed and there is no fibre to disclose. Its image is exactly the
 * `z = 0` plane, on which it has a unique mathematical inverse:
 * {@link invertPoint} returns that preimage, or a typed off-image status for
 * points with `z ≠ 0`, rather than fabricating a nearest point (collapsing
 * off-image points onto the plane would be a projection).
 *
 * Both mapping directions are exact in Float64. The packed
 * {@link projectPositions} path writes Float32 because the destination is a
 * GPU vertex buffer; a point recovered from a *renderer-derived* observation
 * is therefore an inverse of a Float32 image and must stay qualified
 * approximate — injectivity makes the inverse of the exact image unique, it
 * does not make an observation of that image exact.
 *
 * Placement in the scene is deliberately not this map's job: it has no
 * configurable axes or offset, because posing display content is what
 * `Object3D` transforms are for.
 *
 * @example
 * An R2 wire square displayed through the embedding, picked, and read back in
 * R2 coordinates:
 * ```ts
 * const square = new CellComplex(2, Float64Array.from([
 *   0, 0,
 *   2, 0,
 *   2, 2,
 *   0, 2
 * ]), [{ dim: 1, verticesPerCell: 2, kind: 'simplex',
 *        indices: Uint32Array.from([0, 1, 1, 2, 2, 3, 3, 0]) }]);
 * const embedding = new PlaneEmbedding3D();
 * const edges = new ProjectedEdges3D(square, embedding);
 * scene.add(edges.object);
 *
 * // The unique inverse on the image, and the typed refusal off it.
 * const image = embedding.projectPoint([1.5, 0.25]);
 * log('image', image); // [1.5, 0.25, 0]
 * const back = embedding.invertPoint(image);
 * if (back.status === 'on-image') log('preimage', back.point); // [1.5, 0.25]
 * const off = embedding.invertPoint([1.5, 0.25, 0.5]);
 * log(off.status, off.status === 'off-image' ? off.distanceFromImage : 0); // 0.5
 *
 * onFrame((t) => {
 *   edges.object.rotation.z = t * 0.0004; // posing is Object3D's job
 * });
 * ```
 */
export class PlaneEmbedding3D implements InvertibleDisplayMap3D {
  /**
   * The embedding is one fixed map, so construction takes nothing: no axes,
   * no offset, no tolerance — posing is `Object3D`'s job and tolerance is the
   * inverse caller's explicit choice.
   */
  constructor() {}

  /** Always `2`: the embedding takes the R2 coordinate plane and nothing else. */
  readonly fromDim = 2;

  /** The exact image `[x, y, 0]` of one R2 point; refuses by name otherwise. */
  projectPoint(point: ArrayLike<number>): [number, number, number] {
    if (point.length !== 2) {
      throw new Error(
        `PlaneEmbedding3D: expected a 2D point, got ${point.length} coordinates`
      );
    }
    const x = point[0]!;
    const y = point[1]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('PlaneEmbedding3D: point coordinates must be finite');
    }
    return [x, y, 0];
  }

  /**
   * Maps `count` packed R2 points into packed Float32 3-vectors with `z = 0`.
   * Deterministic: the only rounding is the per-component Float64→Float32
   * store, so identical input is bitwise-identical output.
   */
  projectPositions(src: Float64Array, count: number, dst: Float32Array): void {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(
        `PlaneEmbedding3D.projectPositions: count must be a non-negative integer, got ${count}`
      );
    }
    if (src.length < count * 2 || dst.length < count * 3) {
      throw new Error(
        'PlaneEmbedding3D.projectPositions: buffers are too small for the requested count'
      );
    }
    for (let point = 0; point < count; point++) {
      dst[point * 3] = src[point * 2]!;
      dst[point * 3 + 1] = src[point * 2 + 1]!;
      dst[point * 3 + 2] = 0;
    }
  }

  /**
   * The unique preimage of a display point on the `z = 0` image, or a typed
   * `'off-image'` status carrying the distance `|z|` from the image.
   *
   * The default tolerance is `0`: exact image membership, the mathematical
   * inverse. A caller holding an *observed* display point (a Float32 pick on
   * a posed object) passes an explicit positive tolerance and qualifies the
   * recovered point approximate — see the class contract.
   */
  invertPoint(
    point: ArrayLike<number>,
    options: DisplayMapInvertOptions = {}
  ): DisplayMapInverse3D {
    if (point.length !== 3) {
      throw new Error(
        `PlaneEmbedding3D.invertPoint: expected a 3D display point, got ${point.length} coordinates`
      );
    }
    const x = point[0]!;
    const y = point[1]!;
    const z = point[2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error('PlaneEmbedding3D.invertPoint: point coordinates must be finite');
    }
    const tolerance = options.tolerance ?? 0;
    if (!Number.isFinite(tolerance) || tolerance < 0) {
      throw new Error(
        `PlaneEmbedding3D.invertPoint: tolerance must be finite and non-negative, got ${tolerance}`
      );
    }
    const scale = Math.max(1, Math.abs(x), Math.abs(y), Math.abs(z));
    if (Math.abs(z) > tolerance * scale) {
      return { status: 'off-image', distanceFromImage: Math.abs(z) };
    }
    return { status: 'on-image', point: [x, y] };
  }
}
