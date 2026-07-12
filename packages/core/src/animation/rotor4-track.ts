import { Rotor4 } from '../math/rotor4.js';
import { qconj, qdot, qexp, qlog, qmul, qnormalize, qslerp } from './quat.js';

export type RotorInterpolation = 'step' | 'linear' | 'cubic';

/**
 * A keyframed rotation track on SO(4).
 *
 * The bi-invariant metric on SO(4) is (up to the double cover) the
 * product metric on SU(2) × SU(2), so geodesics — and therefore correct
 * interpolants — are per-factor quaternion constructions. The one
 * global subtlety is the cover: (l, r) and (−l, −r) are the same
 * rotation, but flipping a single factor multiplies by the central
 * inversion, a *different* element of SO(4). The track therefore makes
 * the sign choice once per key at construction (neighborhooding) and
 * all factor arithmetic downstream is flip-free:
 *
 * - each key is pair-normalized;
 * - key i is jointly negated iff that shortens the squared geodesic
 *   length acos²(dL) + acos²(dR) to key i−1 — the acos comparison, not
 *   sign(dL + dR), because when the factor dots disagree in sign the
 *   two lifts are genuinely different paths and the linear heuristic
 *   can pick the longer one;
 * - any segment still spanning a factor angle ≥ π − margin is
 *   subdivided by pair-slerp midpoints until none does, keeping every
 *   quaternion log downstream away from its q = −1 singularity.
 *
 * Interpolation: 'step', 'linear' (per-factor slerp = the SO(4)
 * geodesic), or 'cubic' — Shoemake squad applied per factor with inner
 * points aᵢ = qᵢ·exp(−(log(qᵢ⁻¹qᵢ₊₁) + log(qᵢ⁻¹qᵢ₋₁))/4); because the
 * metric is a product metric this is a C¹ geodesic-respecting spline
 * on SO(4) with no cross-factor correction term.
 */
export class Rotor4Track {
  readonly interpolation: RotorInterpolation;
  /** Key times, strictly increasing (possibly densified by subdivision). */
  readonly times: Float64Array;
  private readonly left: Float64Array[];
  private readonly right: Float64Array[];
  private innerLeft: Float64Array[] | null = null;
  private innerRight: Float64Array[] | null = null;

  constructor(
    times: ArrayLike<number>,
    rotors: readonly Rotor4[],
    interpolation: RotorInterpolation = 'linear'
  ) {
    if (times.length !== rotors.length) {
      throw new Error(`Rotor4Track: ${times.length} times for ${rotors.length} keys`);
    }
    if (times.length < 1) throw new Error('Rotor4Track: at least one key required');
    for (let i = 1; i < times.length; i++) {
      if (times[i]! <= times[i - 1]!) {
        throw new Error('Rotor4Track: key times must be strictly increasing');
      }
    }
    this.interpolation = interpolation;

    let t = Array.from(times as ArrayLike<number>);
    let left = rotors.map((r) => qnormalize(r.left));
    let right = rotors.map((r) => qnormalize(r.right));

    // Cover neighborhooding: joint sign per key, shortest pair geodesic.
    for (let i = 1; i < left.length; i++) {
      const dL = Math.max(-1, Math.min(1, qdot(left[i - 1]!, left[i]!)));
      const dR = Math.max(-1, Math.min(1, qdot(right[i - 1]!, right[i]!)));
      const keep = Math.acos(dL) ** 2 + Math.acos(dR) ** 2;
      const flip = Math.acos(-dL) ** 2 + Math.acos(-dR) ** 2;
      if (flip < keep) {
        left[i] = left[i]!.map((x) => -x) as unknown as Float64Array;
        right[i] = right[i]!.map((x) => -x) as unknown as Float64Array;
      }
    }

    // Segment subdivision: the S³ arc between consecutive factor keys
    // (acos of the signed, post-neighborhooding dot) must stay below
    // π − margin — near-antipodal factor pairs are where both the
    // quaternion log and slerp weights lose conditioning. Midpoint
    // insertion by normalized average is the exact geodesic midpoint
    // for any non-antipodal pair, so each split halves the arc.
    const MARGIN = 0.2;
    for (let guard = 0; guard < 24; guard++) {
      let split = -1;
      for (let i = 1; i < left.length; i++) {
        const arcL = Math.acos(Math.max(-1, Math.min(1, qdot(left[i - 1]!, left[i]!))));
        const arcR = Math.acos(Math.max(-1, Math.min(1, qdot(right[i - 1]!, right[i]!))));
        if (Math.max(arcL, arcR) >= Math.PI - MARGIN) {
          split = i;
          break;
        }
      }
      if (split === -1) break;
      t.splice(split, 0, (t[split - 1]! + t[split]!) / 2);
      left.splice(split, 0, qslerp(left[split - 1]!, left[split]!, 0.5));
      right.splice(split, 0, qslerp(right[split - 1]!, right[split]!, 0.5));
    }

    this.times = Float64Array.from(t);
    this.left = left;
    this.right = right;

    if (interpolation === 'cubic') {
      this.innerLeft = squadInnerPoints(left);
      this.innerRight = squadInnerPoints(right);
    }
  }

  get keyCount(): number {
    return this.times.length;
  }

  /** Samples the track at time `t` (clamped to the key range). */
  sample(t: number, out?: Rotor4): Rotor4 {
    const result = out ?? Rotor4.identity();
    const n = this.times.length;
    if (t <= this.times[0]! || n === 1) return writeRotor(result, this.left[0]!, this.right[0]!);
    if (t >= this.times[n - 1]!) {
      return writeRotor(result, this.left[n - 1]!, this.right[n - 1]!);
    }
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid]! <= t) lo = mid;
      else hi = mid;
    }
    const u = (t - this.times[lo]!) / (this.times[hi]! - this.times[lo]!);

    if (this.interpolation === 'step') {
      return writeRotor(result, this.left[lo]!, this.right[lo]!);
    }
    if (this.interpolation === 'linear' || !this.innerLeft || !this.innerRight) {
      return writeRotor(
        result,
        qslerp(this.left[lo]!, this.left[hi]!, u),
        qslerp(this.right[lo]!, this.right[hi]!, u)
      );
    }
    return writeRotor(
      result,
      squad(this.left[lo]!, this.left[hi]!, this.innerLeft[lo]!, this.innerLeft[hi]!, u),
      squad(this.right[lo]!, this.right[hi]!, this.innerRight[lo]!, this.innerRight[hi]!, u)
    );
  }
}

function writeRotor(out: Rotor4, left: Float64Array, right: Float64Array): Rotor4 {
  out.left.set(left);
  out.right.set(right);
  return out;
}

/** Shoemake inner control points, endpoints reflected onto themselves. */
function squadInnerPoints(keys: Float64Array[]): Float64Array[] {
  const n = keys.length;
  const inner: Float64Array[] = new Array(n);
  inner[0] = keys[0]!;
  inner[n - 1] = keys[n - 1]!;
  for (let i = 1; i < n - 1; i++) {
    const inv = qconj(keys[i]!);
    const toNext = qlog(qnormalize(qmul(inv, keys[i + 1]!)));
    const toPrev = qlog(qnormalize(qmul(inv, keys[i - 1]!)));
    const mean = Float64Array.of(
      -(toNext[0]! + toPrev[0]!) / 4,
      -(toNext[1]! + toPrev[1]!) / 4,
      -(toNext[2]! + toPrev[2]!) / 4,
      0
    );
    inner[i] = qnormalize(qmul(keys[i]!, qexp(mean)));
  }
  return inner;
}

function squad(
  q0: Float64Array,
  q1: Float64Array,
  a0: Float64Array,
  a1: Float64Array,
  t: number
): Float64Array {
  return qslerp(qslerp(q0, q1, t), qslerp(a0, a1, t), 2 * t * (1 - t));
}
