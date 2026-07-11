import { CellComplex } from '../geometry/cell-complex.js';

export interface HopfFiberOptions {
  /** Base point on S² (normalized internally; must be nonzero). */
  base: [number, number, number];
  /** Radius of the 3-sphere carrying the fiber. Default 1. */
  radius?: number;
  /** Polyline segments. Default 96. */
  segments?: number;
}

/**
 * One fiber of the Hopf fibration S³ → S²: the great circle of the
 * 3-sphere sitting over a base point.
 *
 * With the Hopf map written as
 *
 *   h(x₀,x₁,x₂,x₃) = (2(x₀x₂ + x₁x₃), 2(x₁x₂ − x₀x₃), x₂²+x₃² − x₀²−x₁²),
 *
 * each output component is invariant under the simultaneous equal-angle
 * rotation of the (x₀,x₁) and (x₂,x₃) planes — so that isoclinic flow
 * *is* the fiber direction, and every fiber is a Clifford circle. A
 * preimage of the unit base (a,b,c) with c ≠ 1 is obtained by setting
 * x₁ = 0: x₀ = √((1−c)/2), x₂ = a/2x₀, x₃ = −b/2x₀; the north pole's
 * fiber is the (x₂,x₃)-plane circle.
 *
 * Returns a closed polyline CellComplex (1-cells), renderable by
 * ProjectedEdges3D. Projecting with PerspectiveProjection at
 * viewDistance = radius is exactly stereographic projection from the
 * pole, under which every fiber maps to a perfect circle (or a line
 * through the pole) and any two fibers are linked once.
 */
export function createHopfFiber(options: HopfFiberOptions): CellComplex {
  const radius = options.radius ?? 1;
  const segments = options.segments ?? 96;
  if (segments < 3) throw new Error(`createHopfFiber: segments must be ≥ 3, got ${segments}`);
  const [bx, by, bz] = options.base;
  const norm = Math.hypot(bx, by, bz);
  if (norm === 0) throw new Error('createHopfFiber: base point must be nonzero');
  const a = bx / norm;
  const b = by / norm;
  const c = bz / norm;

  // A point on the fiber over (a, b, c).
  let p0: [number, number, number, number];
  if (1 - c < 1e-12) {
    p0 = [0, 0, 1, 0]; // north pole: the (x₂,x₃)-plane circle
  } else {
    const x0 = Math.sqrt((1 - c) / 2);
    p0 = [x0, 0, a / (2 * x0), -b / (2 * x0)];
  }

  // Sweep the fiber with the equal-angle double rotation.
  const positions = new Float64Array(segments * 4);
  for (let s = 0; s < segments; s++) {
    const t = (s / segments) * 2 * Math.PI;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    positions[s * 4] = radius * (p0[0] * cos - p0[1] * sin);
    positions[s * 4 + 1] = radius * (p0[0] * sin + p0[1] * cos);
    positions[s * 4 + 2] = radius * (p0[2] * cos - p0[3] * sin);
    positions[s * 4 + 3] = radius * (p0[2] * sin + p0[3] * cos);
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
