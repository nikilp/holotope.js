import { MatN, type PlaneRotation } from './matn.js';

/**
 * An element of so(n) — the Lie algebra of N-dimensional rotations —
 * stored as coefficients over the coordinate-plane basis.
 *
 * Coefficient order: (0,1), (0,2), …, (0,n−1), (1,2), …, (n−2,n−1).
 * A coefficient θ on plane (i,j) generates rotation of axis i toward
 * axis j (matching `MatN.rotationInPlane`); there are n(n−1)/2 of them.
 *
 * Bivectors are the dimension-correct replacement for axis-angle vectors:
 * in 3D the plane count happens to equal the axis count (3), in 4D there
 * are 6 planes, and no "rotation axis" exists.
 */
export class BivectorN {
  readonly n: number;
  readonly coeffs: Float64Array;

  constructor(n: number, coeffs?: ArrayLike<number>) {
    const size = (n * (n - 1)) / 2;
    this.n = n;
    if (coeffs !== undefined) {
      if (coeffs.length !== size) {
        throw new Error(`BivectorN: expected ${size} coefficients for n=${n}, got ${coeffs.length}`);
      }
      this.coeffs = Float64Array.from(coeffs);
    } else {
      this.coeffs = new Float64Array(size);
    }
  }

  /** Flat index of plane (i,j) with i < j. */
  static planeIndex(n: number, i: number, j: number): number {
    if (i >= j || i < 0 || j >= n) {
      throw new Error(`BivectorN: invalid plane (${i}, ${j}) for n=${n}`);
    }
    return i * n - (i * (i + 1)) / 2 + (j - i - 1);
  }

  static fromPlanes(n: number, planes: readonly PlaneRotation[]): BivectorN {
    const b = new BivectorN(n);
    for (const { i, j, angle } of planes) {
      if (i < j) b.coeffs[BivectorN.planeIndex(n, i, j)]! += angle;
      else b.coeffs[BivectorN.planeIndex(n, j, i)]! -= angle;
    }
    return b;
  }

  /** Coefficient on plane (i,j); antisymmetric, so get(j,i) = −get(i,j). */
  get(i: number, j: number): number {
    if (i < j) return this.coeffs[BivectorN.planeIndex(this.n, i, j)]!;
    return -this.coeffs[BivectorN.planeIndex(this.n, j, i)]!;
  }

  set(i: number, j: number, value: number): this {
    if (i < j) this.coeffs[BivectorN.planeIndex(this.n, i, j)] = value;
    else this.coeffs[BivectorN.planeIndex(this.n, j, i)] = -value;
    return this;
  }

  clone(): BivectorN {
    return new BivectorN(this.n, this.coeffs);
  }

  scale(s: number): this {
    for (let k = 0; k < this.coeffs.length; k++) this.coeffs[k]! *= s;
    return this;
  }

  /**
   * The corresponding skew-symmetric matrix Ω, acting as dx = Ω·x:
   * Ω[j][i] = +θ_ij and Ω[i][j] = −θ_ij for i < j.
   */
  toSkewMatrix(): MatN {
    const n = this.n;
    const m = new MatN(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const theta = this.coeffs[BivectorN.planeIndex(n, i, j)]!;
        m.data[i * n + j] = -theta;
        m.data[j * n + i] = theta;
      }
    }
    return m;
  }
}

/**
 * The exponential map so(n) → SO(n): converts an infinitesimal rotation
 * (or an angular-velocity bivector times a timestep) into a rotation
 * matrix.
 *
 * Implementation: scaling-and-squaring with a Taylor series — scale the
 * skew matrix down by 2^s until its norm is small, sum the series to
 * convergence, square s times, then re-orthonormalize to shed the last
 * bits of floating-point drift. Exact for the n=3 axis-angle case and the
 * single-plane case (verified against `MatN.rotationInPlane` in tests).
 */
export function expBivector(b: BivectorN): MatN {
  const n = b.n;
  const a = b.toSkewMatrix();

  // Scale down until the max-abs-row-sum norm is ≤ 0.5.
  let norm = 0;
  for (let r = 0; r < n; r++) {
    let rowSum = 0;
    for (let c = 0; c < n; c++) rowSum += Math.abs(a.data[r * n + c]!);
    if (rowSum > norm) norm = rowSum;
  }
  const squarings = norm > 0.5 ? Math.ceil(Math.log2(norm / 0.5)) : 0;
  const scale = 2 ** -squarings;
  for (let k = 0; k < a.data.length; k++) a.data[k]! *= scale;

  // Taylor series: R = I + A + A²/2! + …
  let result = MatN.identity(n);
  let term = MatN.identity(n);
  for (let k = 1; k <= 40; k++) {
    term = term.multiply(a);
    let maxAbs = 0;
    for (let e = 0; e < term.data.length; e++) {
      term.data[e]! /= k;
      const abs = Math.abs(term.data[e]!);
      if (abs > maxAbs) maxAbs = abs;
    }
    for (let e = 0; e < result.data.length; e++) result.data[e]! += term.data[e]!;
    if (maxAbs < 1e-18) break;
  }

  for (let k = 0; k < squarings; k++) result = result.multiply(result);
  return result.orthonormalizeInPlace();
}
