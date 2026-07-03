import { MatN } from './matn.js';
import { VecN, assertSameDim } from './vecn.js';

/**
 * A rigid (or affine, if the rotation matrix is not orthonormal) transform
 * in R^n: `p ↦ R · p + t`.
 *
 * Stored as an explicit rotation/position pair rather than an (n+1)×(n+1)
 * homogeneous matrix; the pair form is easier to keep numerically clean
 * (the rotation can be re-orthonormalized independently) and homogeneous
 * coordinates only become necessary at the projective camera stage.
 */
export class TransformN {
  readonly dim: number;
  rotation: MatN;
  position: VecN;

  constructor(dim: number, rotation?: MatN, position?: VecN) {
    this.dim = dim;
    this.rotation = rotation ?? MatN.identity(dim);
    this.position = position ?? new VecN(dim);
    assertSameDim(this.rotation.n, dim);
    assertSameDim(this.position.dim, dim);
  }

  static identity(dim: number): TransformN {
    return new TransformN(dim);
  }

  clone(): TransformN {
    return new TransformN(this.dim, this.rotation.clone(), this.position.clone());
  }

  applyToPoint(p: VecN, out?: VecN): VecN {
    const result = this.rotation.applyTo(p, out);
    return result.add(this.position);
  }

  /**
   * Transforms `count` packed n-points from `src` into `dst`
   * (`src` and `dst` must not alias).
   */
  applyToPositions(src: Float64Array, dst: Float64Array, count: number): void {
    const n = this.dim;
    this.rotation.applyToPositions(src, dst, count);
    for (let p = 0; p < count; p++) {
      const base = p * n;
      for (let r = 0; r < n; r++) dst[base + r]! += this.position.data[r]!;
    }
  }

  /** Returns `this ∘ child` (child applied first): parent-child composition. */
  compose(child: TransformN): TransformN {
    assertSameDim(this.dim, child.dim);
    const rotation = this.rotation.multiply(child.rotation);
    const position = this.rotation.applyTo(child.position).add(this.position);
    return new TransformN(this.dim, rotation, position);
  }
}
