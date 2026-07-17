import { BivectorN } from './bivector.js';
import { MatN, type PlaneRotation } from './matn.js';
import { VecN, assertSameDim } from './vecn.js';

/**
 * A 4D rotation as a pair of unit quaternions — the fast path for SO(4).
 *
 * SO(4) is (up to double cover) S³ × S³: identify a point
 * p = (x₀, x₁, x₂, x₃) with the quaternion P = x₃ + x₀i + x₁j + x₂k, and
 * every 4D rotation is p ↦ q_L · P · q_R for unit quaternions q_L, q_R.
 * Applying a rotor is two quaternion products (~2× cheaper than a dense
 * 4×4 multiply), composition never drifts off the rotation manifold the
 * way accumulated matrix products do, and renormalization is two vector
 * normalizations instead of Gram–Schmidt.
 *
 * The bivector → (q_L, q_R) split is the so(4) ≅ so(3) ⊕ so(3)
 * decomposition; the sign conventions are pinned by tests against
 * `expBivector` and `MatN.rotationInPlane`.
 *
 * Quaternions are stored as Float64Array [i, j, k, real] so that a point's
 * coordinate layout (x₀, x₁, x₂, x₃) is itself a valid quaternion.
 */
export class Rotor4 {
  readonly left: Float64Array;
  readonly right: Float64Array;

  private constructor(left: Float64Array, right: Float64Array) {
    this.left = left;
    this.right = right;
  }

  static identity(): Rotor4 {
    return new Rotor4(Float64Array.of(0, 0, 0, 1), Float64Array.of(0, 0, 0, 1));
  }

  /**
   * Factors an SO(4) matrix into the paired-quaternion cover used by Rotor4.
   * The factorization is convention-derived: the sixteen maps
   * `p ↦ e_i p e_j` form an orthogonal matrix basis, so their coefficients
   * form the rank-one outer product `q_L q_Rᵀ`.
   */
  static fromMatrix(matrix: MatN, tolerance = 1e-10): Rotor4 {
    if (matrix.n !== 4) {
      throw new Error(`Rotor4.fromMatrix: expected a 4×4 matrix, got ${matrix.n}×${matrix.n}`);
    }
    if (!Number.isFinite(tolerance) || tolerance <= 0) {
      throw new Error('Rotor4.fromMatrix: tolerance must be finite and positive');
    }
    if (matrix.orthogonalityError() > tolerance) {
      throw new Error('Rotor4.fromMatrix: matrix must be orthonormal');
    }
    if (Math.abs(matrix.determinant() - 1) > tolerance * 10) {
      throw new Error('Rotor4.fromMatrix: matrix must have determinant +1');
    }

    const associate = new Float64Array(16);
    const leftBasis = new Float64Array(4);
    const pointBasis = new Float64Array(4);
    const rightBasis = new Float64Array(4);
    for (let left = 0; left < 4; left++) {
      leftBasis.fill(0);
      leftBasis[left] = 1;
      for (let right = 0; right < 4; right++) {
        rightBasis.fill(0);
        rightBasis[right] = 1;
        let coefficient = 0;
        for (let col = 0; col < 4; col++) {
          pointBasis.fill(0);
          pointBasis[col] = 1;
          const transformed = qmul(qmul(leftBasis, pointBasis), rightBasis);
          for (let row = 0; row < 4; row++) {
            coefficient += matrix.get(row, col) * transformed[row]!;
          }
        }
        associate[left * 4 + right] = coefficient / 4;
      }
    }

    // Select the row with largest norm, fix that left component positive,
    // recover q_R from the row, then project every row onto q_R for q_L.
    let pivotRow = 0;
    let pivotNorm = 0;
    for (let row = 0; row < 4; row++) {
      let normSquared = 0;
      for (let col = 0; col < 4; col++) normSquared += associate[row * 4 + col]! ** 2;
      const norm = Math.sqrt(normSquared);
      if (norm > pivotNorm) {
        pivotNorm = norm;
        pivotRow = row;
      }
    }
    if (pivotNorm < 1e-15) {
      throw new Error('Rotor4.fromMatrix: paired-quaternion factorization is degenerate');
    }
    const right = new Float64Array(4);
    for (let col = 0; col < 4; col++) right[col] = associate[pivotRow * 4 + col]! / pivotNorm;
    const left = new Float64Array(4);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) left[row]! += associate[row * 4 + col]! * right[col]!;
    }
    qnormalize(left);
    qnormalize(right);
    const rotor = new Rotor4(left, right);
    const reconstructed = rotor.toMatrix();
    let error = 0;
    for (let index = 0; index < 16; index++) {
      error = Math.max(error, Math.abs(reconstructed.data[index]! - matrix.data[index]!));
    }
    if (error > tolerance * 20) {
      throw new Error(`Rotor4.fromMatrix: factorization residual ${error} exceeds tolerance`);
    }
    return rotor;
  }

  /** Exponential of a 4D bivector, split into left/right isoclinic parts. */
  static fromBivector(b: BivectorN): Rotor4 {
    if (b.n !== 4) throw new Error(`Rotor4: bivector must be 4D, got n=${b.n}`);
    const [t01, t02, t03, t12, t13, t23] = b.coeffs as unknown as [
      number, number, number, number, number, number
    ];
    // so(4) ≅ so(3) ⊕ so(3): left/right pure-quaternion generators.
    const u1 = (t12 - t03) / 2;
    const u2 = -(t02 + t13) / 2;
    const u3 = (t01 - t23) / 2;
    const v1 = -(t12 + t03) / 2;
    const v2 = (t02 - t13) / 2;
    const v3 = -(t01 + t23) / 2;
    return new Rotor4(expPure(u1, u2, u3), expPure(v1, v2, v3));
  }

  /** Rotation of axis i toward axis j by `angle`, as a rotor. */
  static fromPlane(i: number, j: number, angle: number): Rotor4 {
    return Rotor4.fromBivector(BivectorN.fromPlanes(4, [{ i, j, angle }]));
  }

  static fromPlanes(planes: readonly PlaneRotation[]): Rotor4 {
    let r = Rotor4.identity();
    for (const { i, j, angle } of planes) {
      r = Rotor4.fromPlane(i, j, angle).multiply(r);
    }
    return r;
  }

  clone(): Rotor4 {
    return new Rotor4(this.left.slice(), this.right.slice());
  }

  /** Returns `this ∘ r` (r applied first). */
  multiply(r: Rotor4): Rotor4 {
    return new Rotor4(qmul(this.left, r.left), qmul(r.right, this.right));
  }

  /** Rescales both quaternions to unit length (drift repair). */
  normalize(): this {
    qnormalize(this.left);
    qnormalize(this.right);
    return this;
  }

  /** The inverse rotation (conjugates of both unit quaternions). */
  conjugate(): Rotor4 {
    return new Rotor4(
      Float64Array.of(-this.left[0]!, -this.left[1]!, -this.left[2]!, this.left[3]!),
      Float64Array.of(-this.right[0]!, -this.right[1]!, -this.right[2]!, this.right[3]!)
    );
  }

  /**
   * Principal paired-quaternion logarithm in the kernel's bivector basis.
   *
   * The double-cover sign is chosen once for the pair, matching `slerp`.
   * A relative central inversion has no unique logarithm and is rejected;
   * coherent animation/kinematic samples should subdivide before that point.
   */
  log(): BivectorN {
    for (const factor of [this.left, this.right]) {
      const length = Math.hypot(factor[0]!, factor[1]!, factor[2]!, factor[3]!);
      if (!Number.isFinite(length) || Math.abs(length - 1) > 1e-10) {
        throw new Error('Rotor4.log: rotor factors must be finite and normalized');
      }
    }
    const sign = this.left[3]! + this.right[3]! < 0 ? -1 : 1;
    const u = quaternionLogVector(this.left, sign);
    const v = quaternionLogVector(this.right, sign);
    return new BivectorN(4, [
      u[2]! - v[2]!,
      v[1]! - u[1]!,
      -(u[0]! + v[0]!),
      u[0]! - v[0]!,
      -(u[1]! + v[1]!),
      -(u[2]! + v[2]!)
    ]);
  }

  /**
   * Isoclinic interpolation: SLERP applied to the left and right
   * quaternions with one shared cover choice. Because a geodesic of SO(4)
   * (in the bi-invariant metric) is exactly a pair of quaternion geodesics,
   * this is the geodesic from `a` to `b`: slerp(I, exp(B), t) = exp(t·B)
   * for every bivector B. The 4D generalization of quaternion slerp for
   * animation and camera tours.
   *
   * The double cover is pair-level: (l, r) and (−l, −r) are the same SO(4)
   * element, but flipping only one factor negates the rotation — so the
   * shorter-path sign must be chosen once for the pair, never per
   * quaternion. One factor may therefore legitimately travel an arc
   * longer than π.
   */
  static slerp(a: Rotor4, b: Rotor4, t: number): Rotor4 {
    const dot =
      a.left[0]! * b.left[0]! + a.left[1]! * b.left[1]! +
      a.left[2]! * b.left[2]! + a.left[3]! * b.left[3]! +
      a.right[0]! * b.right[0]! + a.right[1]! * b.right[1]! +
      a.right[2]! * b.right[2]! + a.right[3]! * b.right[3]!;
    const sign = dot < 0 ? -1 : 1;
    return new Rotor4(qslerp(a.left, b.left, t, sign), qslerp(a.right, b.right, t, sign));
  }

  applyToPoint(v: VecN, out?: VecN): VecN {
    assertSameDim(v.dim, 4);
    const result = out ?? new VecN(4);
    assertSameDim(result.dim, 4);
    const p = qmul(qmul(this.left, v.data), this.right);
    result.data.set(p);
    return result;
  }

  /** Applies the rotor to `count` packed 4-vectors (src and dst may alias). */
  applyToPositions(src: Float64Array, dst: Float64Array, count: number): void {
    const q = new Float64Array(4);
    for (let p = 0; p < count; p++) {
      const base = p * 4;
      q[0] = src[base]!;
      q[1] = src[base + 1]!;
      q[2] = src[base + 2]!;
      q[3] = src[base + 3]!;
      const rotated = qmul(qmul(this.left, q), this.right);
      dst[base] = rotated[0]!;
      dst[base + 1] = rotated[1]!;
      dst[base + 2] = rotated[2]!;
      dst[base + 3] = rotated[3]!;
    }
  }

  /** Dense matrix form (columns are rotated basis vectors). */
  toMatrix(): MatN {
    const m = new MatN(4);
    const e = new Float64Array(4);
    for (let col = 0; col < 4; col++) {
      e.fill(0);
      e[col] = 1;
      const r = qmul(qmul(this.left, e), this.right);
      for (let row = 0; row < 4; row++) m.data[row * 4 + col] = r[row]!;
    }
    return m;
  }
}

/** exp of the pure quaternion u₁i + u₂j + u₃k: a unit quaternion. */
function expPure(u1: number, u2: number, u3: number): Float64Array {
  const angle = Math.hypot(u1, u2, u3);
  if (angle < 1e-300) return Float64Array.of(0, 0, 0, 1);
  const s = Math.sin(angle) / angle;
  return Float64Array.of(u1 * s, u2 * s, u3 * s, Math.cos(angle));
}

function quaternionLogVector(quaternion: Float64Array, sign: number): Float64Array {
  const x = sign * quaternion[0]!;
  const y = sign * quaternion[1]!;
  const z = sign * quaternion[2]!;
  const real = sign * quaternion[3]!;
  const vectorLength = Math.hypot(x, y, z);
  if (vectorLength < 1e-14) {
    if (real < 0) {
      throw new Error('Rotor4.log: relative central inversion has no unique logarithm');
    }
    return new Float64Array(3);
  }
  const scale = Math.atan2(vectorLength, real) / vectorLength;
  return Float64Array.of(x * scale, y * scale, z * scale);
}

/** Hamilton product in [i, j, k, real] layout. */
function qmul(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const a0 = a[0]!, a1 = a[1]!, a2 = a[2]!, a3 = a[3]!;
  const b0 = b[0]!, b1 = b[1]!, b2 = b[2]!, b3 = b[3]!;
  return Float64Array.of(
    a3 * b0 + a0 * b3 + a1 * b2 - a2 * b1,
    a3 * b1 + a1 * b3 + a2 * b0 - a0 * b2,
    a3 * b2 + a2 * b3 + a0 * b1 - a1 * b0,
    a3 * b3 - a0 * b0 - a1 * b1 - a2 * b2
  );
}

function qnormalize(q: Float64Array): void {
  const len = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!);
  for (let k = 0; k < 4; k++) q[k]! /= len;
}

/**
 * Spherical interpolation between unit quaternions toward `sign * b`.
 * The cover choice (`sign`) is the caller's: Rotor4 pairs must flip both
 * factors together or not at all, so no per-quaternion shortest-arc flip
 * happens here.
 */
function qslerp(a: Float64Array, b: Float64Array, t: number, sign: number): Float64Array {
  const dot =
    sign * (a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!);
  let wa: number;
  let wb: number;
  if (dot > 0.9995) {
    // Nearly parallel: lerp + renormalize avoids the unstable divide.
    wa = 1 - t;
    wb = t;
  } else if (dot < -(1 - 1e-12)) {
    // Antipodal within the chosen cover (a π isoclinic difference in this
    // factor): every great circle is equally short; pick a deterministic
    // perpendicular so the path is at least well-defined and unit.
    const c = Math.cos(Math.PI * t);
    const s = Math.sin(Math.PI * t);
    return Float64Array.of(
      c * a[0]! - s * a[1]!,
      c * a[1]! + s * a[0]!,
      c * a[2]! - s * a[3]!,
      c * a[3]! + s * a[2]!
    );
  } else {
    const theta = Math.acos(Math.min(1, dot));
    const sinTheta = Math.sin(theta);
    wa = Math.sin((1 - t) * theta) / sinTheta;
    wb = Math.sin(t * theta) / sinTheta;
  }
  const out = Float64Array.of(
    wa * a[0]! + sign * wb * b[0]!,
    wa * a[1]! + sign * wb * b[1]!,
    wa * a[2]! + sign * wb * b[2]!,
    wa * a[3]! + sign * wb * b[3]!
  );
  qnormalize(out);
  return out;
}
