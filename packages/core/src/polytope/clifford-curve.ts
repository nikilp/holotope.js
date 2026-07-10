import { CellComplex } from '../geometry/cell-complex.js';

export interface CliffordCurveOptions {
  /** Windings in the xy plane. Default 2. */
  p?: number;
  /** Windings in the zw plane. Default 3. */
  q?: number;
  /** Circumradius: every vertex lies on the 3-sphere of this radius. Default 1. */
  radius?: number;
  /**
   * Ratio of the zw circle radius to the xy circle radius. 1 puts the
   * curve on the square Clifford torus. Default 1.
   */
  radiusRatio?: number;
  /** Number of polyline segments. Default 256. */
  segments?: number;
}

/**
 * The (p, q) curve on a Clifford torus in S³:
 *
 *   γ(θ) = (r₁·cos pθ, r₁·sin pθ, r₂·cos qθ, r₂·sin qθ),  θ ∈ [0, 2π)
 *
 * with r₁² + r₂² = radius², so the whole curve lies on the 3-sphere. For
 * coprime p and q this is the (p, q) torus knot — but flat, living on the
 * flat Clifford torus, with none of the pinching a torus embedded in R³
 * forces on it. It is exactly the vertex path of the p×q duoprism made
 * continuous.
 *
 * Under the equal-speed double rotation (xy and zw together — a Clifford
 * displacement) the curve slides along itself: the isoclinic flow of S³
 * is tangent to it everywhere.
 *
 * Returns a closed polyline: a CellComplex with 1-cells only, ready for
 * ProjectedEdges3D.
 */
export function createCliffordCurve(options: CliffordCurveOptions = {}): CellComplex {
  const p = options.p ?? 2;
  const q = options.q ?? 3;
  const radius = options.radius ?? 1;
  const ratio = options.radiusRatio ?? 1;
  const segments = options.segments ?? 256;
  if (!Number.isInteger(p) || !Number.isInteger(q) || p < 1 || q < 1) {
    throw new Error(`createCliffordCurve: p and q must be positive integers, got ${p}, ${q}`);
  }
  if (segments < 3) {
    throw new Error(`createCliffordCurve: segments must be at least 3, got ${segments}`);
  }

  const r1 = radius / Math.sqrt(1 + ratio * ratio);
  const r2 = r1 * ratio;

  const positions = new Float64Array(segments * 4);
  for (let s = 0; s < segments; s++) {
    const theta = (s / segments) * 2 * Math.PI;
    positions[s * 4] = r1 * Math.cos(p * theta);
    positions[s * 4 + 1] = r1 * Math.sin(p * theta);
    positions[s * 4 + 2] = r2 * Math.cos(q * theta);
    positions[s * 4 + 3] = r2 * Math.sin(q * theta);
  }

  const edges = new Uint32Array(segments * 2);
  for (let s = 0; s < segments; s++) {
    edges[s * 2] = s;
    edges[s * 2 + 1] = (s + 1) % segments;
  }

  return new CellComplex(4, positions, [
    { dim: 1, verticesPerCell: 2, kind: 'simplex', indices: edges }
  ]);
}
