/**
 * Unit-quaternion helpers for the per-factor arithmetic of Rotor4
 * animation. Layout matches Rotor4's factors: [i, j, k, real] — the
 * real part lives at index 3 so a quaternion doubles as a 4D point.
 *
 * None of these choose a double-cover sign: on SO(4) the cover choice
 * is a *pair-level* decision ((l, r) ~ (−l, −r) only jointly), so it is
 * made once, by the track's neighborhooding pass, never inside factor
 * arithmetic.
 */

export function qdot(a: Float64Array, b: Float64Array): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!;
}

export function qmul(a: Float64Array, b: Float64Array): Float64Array {
  return Float64Array.of(
    a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!,
    a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!,
    a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!,
    a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!
  );
}

export function qconj(a: Float64Array): Float64Array {
  return Float64Array.of(-a[0]!, -a[1]!, -a[2]!, a[3]!);
}

export function qnormalize(a: Float64Array): Float64Array {
  const len = Math.hypot(a[0]!, a[1]!, a[2]!, a[3]!);
  return Float64Array.of(a[0]! / len, a[1]! / len, a[2]! / len, a[3]! / len);
}

/**
 * Log of a unit quaternion: the pure-imaginary [v·θ̂, 0] with θ the
 * rotation half-angle. atan2 form — accurate near identity where
 * acos(w) loses digits, and well-defined at θ = π/2 (w = 0). Only
 * q → −1 is singular, which neighborhooded tracks never approach.
 */
export function qlog(a: Float64Array): Float64Array {
  const vlen = Math.hypot(a[0]!, a[1]!, a[2]!);
  if (vlen < 1e-15) return Float64Array.of(0, 0, 0, 0);
  const theta = Math.atan2(vlen, a[3]!);
  const s = theta / vlen;
  return Float64Array.of(a[0]! * s, a[1]! * s, a[2]! * s, 0);
}

/** Exp of a pure-imaginary quaternion (inverse of qlog). */
export function qexp(v: Float64Array): Float64Array {
  const theta = Math.hypot(v[0]!, v[1]!, v[2]!);
  if (theta < 1e-15) return Float64Array.of(0, 0, 0, 1);
  const s = Math.sin(theta) / theta;
  return Float64Array.of(v[0]! * s, v[1]! * s, v[2]! * s, Math.cos(theta));
}

/**
 * Geodesic interpolation toward `b` as stored — no shortest-arc flip
 * (see module note). Falls back to nlerp for nearly parallel inputs.
 */
export function qslerp(a: Float64Array, b: Float64Array, t: number): Float64Array {
  const dot = qdot(a, b);
  let wa: number;
  let wb: number;
  if (Math.abs(dot) > 0.9995) {
    wa = 1 - t;
    wb = t;
  } else {
    const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
    const sinTheta = Math.sin(theta);
    wa = Math.sin((1 - t) * theta) / sinTheta;
    wb = Math.sin(t * theta) / sinTheta;
  }
  return qnormalize(
    Float64Array.of(
      wa * a[0]! + wb * b[0]!,
      wa * a[1]! + wb * b[1]!,
      wa * a[2]! + wb * b[2]!,
      wa * a[3]! + wb * b[3]!
    )
  );
}
