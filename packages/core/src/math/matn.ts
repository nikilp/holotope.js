import { VecN, assertSameDim } from './vecn.js';

/**
 * A dense square N×N matrix backed by a Float64Array, row-major.
 *
 * Convention: vectors are columns and transforms act on the left,
 * `w = M · v`. Entry (row, col) lives at `data[row * n + col]`.
 *
 * Rotations are represented directly as orthonormal matrices. This is the
 * dimension-generic baseline backend; optimized representations (paired
 * quaternion Rotor4, Givens factor lists, so(n) bivectors) will plug in
 * behind the same interface later.
 */
export class MatN {
  readonly n: number;
  readonly data: Float64Array;

  constructor(n: number, data?: ArrayLike<number>) {
    this.n = n;
    if (data !== undefined) {
      if (data.length !== n * n) {
        throw new Error(`MatN: expected ${n * n} entries, got ${data.length}`);
      }
      this.data = Float64Array.from(data);
    } else {
      this.data = new Float64Array(n * n);
    }
  }

  static identity(n: number): MatN {
    const m = new MatN(n);
    for (let i = 0; i < n; i++) m.data[i * n + i] = 1;
    return m;
  }

  /**
   * Rotation in the coordinate plane spanned by axes i and j, rotating
   * axis i toward axis j by `angle` radians (a Givens rotation).
   *
   * For n = 3, rotationInPlane(3, 0, 1, θ) equals a rotation about the
   * z axis by θ in the usual right-handed convention.
   */
  static rotationInPlane(n: number, i: number, j: number, angle: number): MatN {
    if (i === j || i < 0 || j < 0 || i >= n || j >= n) {
      throw new Error(`MatN: invalid rotation plane (${i}, ${j}) for dimension ${n}`);
    }
    const m = MatN.identity(n);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    m.data[i * n + i] = c;
    m.data[i * n + j] = -s;
    m.data[j * n + i] = s;
    m.data[j * n + j] = c;
    return m;
  }

  get(row: number, col: number): number {
    return this.data[row * this.n + col]!;
  }

  set(row: number, col: number, value: number): this {
    this.data[row * this.n + col] = value;
    return this;
  }

  clone(): MatN {
    return new MatN(this.n, this.data);
  }

  copy(m: MatN): this {
    assertSameDim(this.n, m.n);
    this.data.set(m.data);
    return this;
  }

  /** Returns a new matrix `this · m`. */
  multiply(m: MatN): MatN {
    assertSameDim(this.n, m.n);
    const n = this.n;
    const out = new MatN(n);
    for (let r = 0; r < n; r++) {
      for (let k = 0; k < n; k++) {
        const a = this.data[r * n + k]!;
        if (a === 0) continue;
        for (let c = 0; c < n; c++) {
          out.data[r * n + c]! += a * m.data[k * n + c]!;
        }
      }
    }
    return out;
  }

  transpose(): MatN {
    const n = this.n;
    const out = new MatN(n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        out.data[c * n + r] = this.data[r * n + c]!;
      }
    }
    return out;
  }

  /** Applies `M · v`, writing into `out` (allocated if omitted). */
  applyTo(v: VecN, out?: VecN): VecN {
    assertSameDim(this.n, v.dim);
    const n = this.n;
    const result = out ?? new VecN(n);
    assertSameDim(result.dim, n);
    // Guard against aliasing (out === v).
    const src = result === v ? v.data.slice() : v.data;
    for (let r = 0; r < n; r++) {
      let acc = 0;
      for (let c = 0; c < n; c++) acc += this.data[r * n + c]! * src[c]!;
      result.data[r] = acc;
    }
    return result;
  }

  /**
   * Applies the matrix to `count` packed n-vectors from `src` into `dst`.
   * Both arrays are laid out as [x0…x(n-1), x0…x(n-1), …]. `src` and `dst`
   * must not alias.
   */
  applyToPositions(src: Float64Array, dst: Float64Array, count: number): void {
    const n = this.n;
    for (let p = 0; p < count; p++) {
      const base = p * n;
      for (let r = 0; r < n; r++) {
        let acc = 0;
        for (let c = 0; c < n; c++) acc += this.data[r * n + c]! * src[base + c]!;
        dst[base + r] = acc;
      }
    }
  }

  /** Determinant via Gaussian elimination with partial pivoting. */
  determinant(): number {
    const n = this.n;
    const a = this.data.slice();
    let det = 1;
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(a[r * n + col]!) > Math.abs(a[pivot * n + col]!)) pivot = r;
      }
      if (a[pivot * n + col] === 0) return 0;
      if (pivot !== col) {
        for (let c = 0; c < n; c++) {
          const tmp = a[col * n + c]!;
          a[col * n + c] = a[pivot * n + c]!;
          a[pivot * n + c] = tmp;
        }
        det = -det;
      }
      const d = a[col * n + col]!;
      det *= d;
      for (let r = col + 1; r < n; r++) {
        const factor = a[r * n + col]! / d;
        for (let c = col; c < n; c++) a[r * n + c]! -= factor * a[col * n + c]!;
      }
    }
    return det;
  }

  /** Max absolute entry of Mᵀ·M − I; ~0 for orthonormal matrices. */
  orthogonalityError(): number {
    const n = this.n;
    let maxErr = 0;
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        let acc = 0;
        for (let r = 0; r < n; r++) acc += this.data[r * n + a]! * this.data[r * n + b]!;
        const err = Math.abs(acc - (a === b ? 1 : 0));
        if (err > maxErr) maxErr = err;
      }
    }
    return maxErr;
  }

  /**
   * Re-orthonormalizes the columns in place using modified Gram–Schmidt.
   * Call periodically on rotation matrices accumulated by repeated
   * multiplication to correct floating-point drift.
   */
  orthonormalizeInPlace(): this {
    const n = this.n;
    for (let col = 0; col < n; col++) {
      for (let prev = 0; prev < col; prev++) {
        let dot = 0;
        for (let r = 0; r < n; r++) dot += this.data[r * n + col]! * this.data[r * n + prev]!;
        for (let r = 0; r < n; r++) this.data[r * n + col]! -= dot * this.data[r * n + prev]!;
      }
      let norm = 0;
      for (let r = 0; r < n; r++) norm += this.data[r * n + col]! ** 2;
      norm = Math.sqrt(norm);
      if (norm < 1e-12) {
        throw new Error('MatN: cannot orthonormalize a rank-deficient matrix');
      }
      for (let r = 0; r < n; r++) this.data[r * n + col]! /= norm;
    }
    return this;
  }
}

/** One rotation plane (axis pair) with an angle, e.g. { i: 0, j: 3 } = xw. */
export interface PlaneRotation {
  i: number;
  j: number;
  angle: number;
}

/**
 * Composes plane rotations left-to-right into a single rotation matrix:
 * the first entry is applied to a vector first. Order matters — plane
 * rotations do not commute in general.
 */
export function rotationFromPlanes(n: number, planes: readonly PlaneRotation[]): MatN {
  let m = MatN.identity(n);
  for (const { i, j, angle } of planes) {
    m = MatN.rotationInPlane(n, i, j, angle).multiply(m);
  }
  return m;
}
