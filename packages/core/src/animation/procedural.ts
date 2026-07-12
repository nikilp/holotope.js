import { BivectorN } from '../math/bivector.js';
import { Rotor4 } from '../math/rotor4.js';
import type { VecN } from '../math/vecn.js';

/** A time-parameterized rotation, sampled per frame. */
export type RotorMotion = (t: number) => Rotor4;

/** Constant-rate rotation in one coordinate plane. */
export function spin(i: number, j: number, rate: number): RotorMotion {
  return (t) => Rotor4.fromPlane(i, j, rate * t);
}

/**
 * Double rotation in two disjoint coordinate planes with independent
 * rates. Disjoint-plane bivectors commute, so the exponential of the
 * sum is exact — no ordering ambiguity.
 */
export function doubleSpin(
  planeA: [number, number],
  rateA: number,
  planeB: [number, number],
  rateB: number
): RotorMotion {
  const shared = new Set([planeA[0], planeA[1]]);
  if (shared.has(planeB[0]) || shared.has(planeB[1])) {
    throw new Error('doubleSpin: planes must be disjoint');
  }
  return (t) =>
    Rotor4.fromBivector(
      new BivectorN(4).set(planeA[0], planeA[1], rateA * t).set(planeB[0], planeB[1], rateB * t)
    );
}

/**
 * Isoclinic rotation: equal-angle double rotation in a plane and its
 * orthogonal complement — every point of the 3-sphere moves at equal
 * speed along Clifford-parallel circles. In the paired-quaternion
 * split, 'left' chirality drives only the left factor and 'right' only
 * the right; torque-free 4D rigid bodies relax toward exactly these
 * motions, so they are the natural idle/ambient spins.
 */
export function isoclinicSpin(rate: number, chirality: 'left' | 'right' = 'left'): RotorMotion {
  // Under the so(4) = su(2) ⊕ su(2) split, θ₀₁ = −θ₂₃ generates the
  // left factor and θ₀₁ = +θ₂₃ the right (u₃ = (θ₀₁−θ₂₃)/2,
  // v₃ = −(θ₀₁+θ₂₃)/2 in the kernel's convention).
  const sign = chirality === 'left' ? -1 : 1;
  return (t) =>
    Rotor4.fromBivector(new BivectorN(4).set(0, 1, rate * t).set(2, 3, sign * rate * t));
}

/**
 * Removes the component of `rotor` that moves the axis `up`: peels off
 * the minimal plane rotation taking R·u back to u, leaving a rotation
 * that stabilizes u (the swing–twist split taken at the vector
 * stabilizer). The result is the roll-free constraint for cameras and
 * walk controllers: with u fixed, the admissible motion is the SO(3)
 * of the orthogonal 3-space.
 */
export function constrainUp(rotor: Rotor4, up: VecN): Rotor4 {
  const u = up.clone().normalize();
  const v = rotor.applyToPoint(u.clone());
  let dot = 0;
  for (let c = 0; c < 4; c++) dot += u.data[c]! * v.data[c]!;
  dot = Math.max(-1, Math.min(1, dot));
  const angle = Math.acos(dot);
  if (angle < 1e-12) return rotor.clone().normalize();
  if (Math.PI - angle < 1e-9) {
    throw new Error('constrainUp: R·u antipodal to u — the minimal rotation is ambiguous');
  }
  // Orthonormal basis (u, w) of the plane containing u and v.
  const w = v.clone();
  for (let c = 0; c < 4; c++) w.data[c]! -= dot * u.data[c]!;
  w.normalize();
  // Rotation by −angle in the (u, w) plane sends v back to u. Plane
  // bivector coefficients over the coordinate basis: θ·(u_i w_j − u_j w_i)
  // rotates u toward w by θ (matching rotationInPlane's convention),
  // so use θ = −angle.
  const b = new BivectorN(4);
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      b.set(i, j, -angle * (u.data[i]! * w.data[j]! - u.data[j]! * w.data[i]!));
    }
  }
  return Rotor4.fromBivector(b).multiply(rotor).normalize();
}
