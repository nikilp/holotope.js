import { MatN } from '../math/matn.js';
import { TransformN } from '../math/transform.js';
import { VecN, assertSameDim } from '../math/vecn.js';

/**
 * A camera in R^n: a pose (position + orthonormal frame) from which the
 * scene is viewed before projection.
 *
 * Conventions generalize three.js: the camera looks down its **negative
 * last axis** (−z for n = 3, −w for n = 4). `viewTransform()` returns the
 * world→view rigid transform; feed view-space geometry to a `Projection`
 * (whose viewpoint sits on the positive hidden axes) or a slice.
 *
 * The rotation matrix's columns are the camera's axes expressed in world
 * coordinates; the last column is the "backward" direction (from target
 * toward camera).
 */
export class CameraN {
  readonly dim: number;
  position: VecN;
  rotation: MatN;

  constructor(dim: number, position?: VecN, rotation?: MatN) {
    this.dim = dim;
    this.position = position ?? new VecN(dim);
    this.rotation = rotation ?? MatN.identity(dim);
    assertSameDim(this.position.dim, dim);
    assertSameDim(this.rotation.n, dim);
  }

  /**
   * Aims the camera at `target`: the last camera axis becomes the unit
   * vector from target to position ("backward", as in three.js), and the
   * remaining axes are completed from the current frame by modified
   * Gram–Schmidt — so successive lookAt calls change orientation
   * continuously instead of snapping roll. Falls back to standard basis
   * vectors when the current frame degenerates, and flips the first axis
   * if needed to keep the frame orientation-preserving (det +1).
   */
  lookAt(target: VecN): this {
    const n = this.dim;
    assertSameDim(target.dim, n);
    const backward = this.position.clone().sub(target);
    if (backward.length() < 1e-12) {
      throw new Error('CameraN.lookAt: target coincides with camera position');
    }
    backward.normalize();

    // Candidate axes: current frame columns first (continuity), then the
    // standard basis as fallback for degenerate cases.
    const candidates: VecN[] = [];
    for (let col = 0; col < n - 1; col++) {
      const v = new VecN(n);
      for (let row = 0; row < n; row++) v.data[row] = this.rotation.get(row, col);
      candidates.push(v);
    }
    for (let axis = 0; axis < n; axis++) candidates.push(VecN.basis(n, axis));

    const frame: VecN[] = [];
    for (const candidate of candidates) {
      if (frame.length === n - 1) break;
      const v = candidate.clone();
      let dot = v.dot(backward);
      for (let c = 0; c < n; c++) v.data[c]! -= dot * backward.data[c]!;
      for (const f of frame) {
        dot = v.dot(f);
        for (let c = 0; c < n; c++) v.data[c]! -= dot * f.data[c]!;
      }
      if (v.length() > 1e-8) frame.push(v.normalize());
    }
    if (frame.length !== n - 1) {
      throw new Error('CameraN.lookAt: failed to complete an orthonormal frame');
    }

    const rotation = new MatN(n);
    for (let col = 0; col < n - 1; col++) {
      for (let row = 0; row < n; row++) rotation.set(row, col, frame[col]!.data[row]!);
    }
    for (let row = 0; row < n; row++) rotation.set(row, n - 1, backward.data[row]!);
    if (rotation.determinant() < 0) {
      for (let row = 0; row < n; row++) rotation.set(row, 0, -rotation.get(row, 0));
    }
    this.rotation = rotation;
    return this;
  }

  /** The camera pose as a transform (view → world). */
  poseTransform(): TransformN {
    return new TransformN(this.dim, this.rotation.clone(), this.position.clone());
  }

  /**
   * The world → view transform: compose with object transforms before
   * projecting, e.g. `camera.viewTransform().compose(objectTransform)`.
   */
  viewTransform(): TransformN {
    return this.poseTransform().inverse();
  }
}
