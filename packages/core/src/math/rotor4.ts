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
 * decomposition; the sign conventions are derived in the kitchen notes
 * and pinned by tests against `expBivector` and `MatN.rotationInPlane`.
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
   * Isoclinic interpolation: shortest-path SLERP applied to the left and
   * right quaternions independently. Because a geodesic of SO(4) (in the
   * bi-invariant metric) is exactly a pair of quaternion geodesics, this is
   * the geodesic from `a` to `b`: slerp(I, exp(B), t) = exp(t·B) for every
   * bivector B. The 4D generalization of quaternion slerp for animation
   * and camera tours.
   */
  static slerp(a: Rotor4, b: Rotor4, t: number): Rotor4 {
    return new Rotor4(qslerp(a.left, b.left, t), qslerp(a.right, b.right, t));
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

/** Shortest-path spherical interpolation between unit quaternions. */
function qslerp(a: Float64Array, b: Float64Array, t: number): Float64Array {
  let dot = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!;
  // Quaternions double-cover rotations: take the shorter arc.
  let sign = 1;
  if (dot < 0) {
    dot = -dot;
    sign = -1;
  }
  let wa: number;
  let wb: number;
  if (dot > 0.9995) {
    // Nearly parallel: lerp + renormalize avoids the unstable divide.
    wa = 1 - t;
    wb = t;
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
