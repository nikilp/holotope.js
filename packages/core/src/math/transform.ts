import { MatN } from './matn.js';
import { Rotor4 } from './rotor4.js';
import { VecN, assertSameDim } from './vecn.js';

/**
 * Pluggable rotation representations. The dense matrix is the
 * dimension-generic baseline; Rotor4 is the optimized 4D fast path.
 */
export type RotationBackend = MatN | Rotor4;

/**
 * A rigid (or affine, if the rotation matrix is not orthonormal) transform
 * in R^n: `p ↦ R · p + t`.
 *
 * Stored as an explicit rotation/position pair rather than an (n+1)×(n+1)
 * homogeneous matrix; the pair form is easier to keep numerically clean
 * (each backend has its own cheap drift repair) and homogeneous coordinates
 * only become necessary at the projective camera stage.
 */
export class TransformN {
  readonly dim: number;
  rotation: RotationBackend;
  position: VecN;

  constructor(dim: number, rotation?: RotationBackend, position?: VecN) {
    this.dim = dim;
    this.rotation = rotation ?? MatN.identity(dim);
    this.position = position ?? new VecN(dim);
    assertSameDim(rotationDim(this.rotation), dim);
    assertSameDim(this.position.dim, dim);
  }

  static identity(dim: number): TransformN {
    return new TransformN(dim);
  }

  clone(): TransformN {
    return new TransformN(this.dim, this.rotation.clone(), this.position.clone());
  }

  applyToPoint(p: VecN, out?: VecN): VecN {
    const rotated =
      this.rotation instanceof Rotor4
        ? this.rotation.applyToPoint(p, out)
        : this.rotation.applyTo(p, out);
    return rotated.add(this.position);
  }

  /**
   * Transforms `count` packed n-points from `src` into `dst`
   * (`src` and `dst` must not alias when the rotation is a matrix).
   */
  applyToPositions(src: Float64Array, dst: Float64Array, count: number): void {
    const n = this.dim;
    this.rotation.applyToPositions(src, dst, count);
    for (let p = 0; p < count; p++) {
      const base = p * n;
      for (let r = 0; r < n; r++) dst[base + r]! += this.position.data[r]!;
    }
  }

  /**
   * The inverse rigid transform: `p ↦ R⁻¹ · (p − t)`. Assumes the rotation
   * is orthonormal (matrix backend inverts by transpose).
   */
  inverse(): TransformN {
    const rotation =
      this.rotation instanceof Rotor4 ? this.rotation.conjugate() : this.rotation.transpose();
    const negated = this.position.clone().multiplyScalar(-1);
    const position =
      rotation instanceof Rotor4 ? rotation.applyToPoint(negated) : rotation.applyTo(negated);
    return new TransformN(this.dim, rotation, position);
  }

  /** Returns `this ∘ child` (child applied first): parent-child composition. */
  compose(child: TransformN): TransformN {
    assertSameDim(this.dim, child.dim);
    let rotation: RotationBackend;
    if (this.rotation instanceof Rotor4 && child.rotation instanceof Rotor4) {
      rotation = this.rotation.multiply(child.rotation);
    } else {
      rotation = rotationMatrix(this.rotation).multiply(rotationMatrix(child.rotation));
    }
    const position = this.applyToPoint(child.position);
    return new TransformN(this.dim, rotation, position);
  }
}

function rotationDim(rotation: RotationBackend): number {
  return rotation instanceof Rotor4 ? 4 : rotation.n;
}

/** Dense matrix form of any rotation backend. */
export function rotationMatrix(rotation: RotationBackend): MatN {
  return rotation instanceof Rotor4 ? rotation.toMatrix() : rotation;
}
