import { CellComplex, HyperplaneSliceN } from '@holotope/core';
import { CUBE_HALF_EXTENT, buildFlatlandSource } from './section.js';

/**
 * Scene 4 — "Projection lies differently".
 *
 * Scene 3 cut a cube with a plane and showed that a section forgets everything
 * off-plane. This scene keeps the **same chart** and changes only the map into
 * it. The plane's own orthonormal basis gives two-dimensional coordinates; a
 * section reaches them by intersecting, a projection by dropping the normal
 * component. Same target, two different losses:
 *
 * - a section is partial — it sees one plane and nothing else;
 * - a projection is many-to-one — it sees everything, stacked.
 *
 * The second is demonstrated rather than asserted, by building a second solid
 * that is genuinely different and provably shares the first's shadow.
 *
 * **The construction, and why it is not two meshes styled to look alike.** Every
 * vertex is displaced along the projection direction only:
 *
 * ```
 * p' = p + s(u, v) · n        u, v the chart coordinates; n the unit normal
 * ```
 *
 * The chart coordinates of a point are `(p·u, p·v)`, and `n` is orthogonal to
 * both, so `p'·u = p·u` and `p'·v = p·v`.
 *
 * **Not bitwise, and the difference is worth stating.** The chart basis is
 * orthonormal to floating-point precision, so `n·u` is about `1e-17` rather
 * than zero, and the displaced dot product rounds differently in its last bits.
 * Measured, the two shadows agree to around `1e-16` while the solids stand
 * about `1` apart in space — a ratio near `10^16`. The scene's claim is that
 * ratio, not an exact identity, and `test/flatland-projection.test.ts` pins it
 * as a ratio for exactly that reason.
 *
 * The cell structure is untouched, so the twin is the same combinatorial solid
 * with different geometry.
 *
 * That is the whole point of the scene: from the projection direction the two
 * are indistinguishable, and one orbit apart they never were the same.
 */

/**
 * Coefficient on the displacement, not a bound on it.
 *
 * The saddle `u·v` exceeds one at the cube's corners, because the projected
 * hexagon reaches further than the cube's half-extent, so the furthest vertex
 * travels further than this. {@link ambientSeparation} reports what it actually
 * is rather than trusting this number.
 */
export const SHEAR_COEFFICIENT = 0.85;

/** One solid and the chart it is being flattened into. */
export interface ProjectionPair {
  /** The cube from scene 3, unchanged. */
  readonly original: CellComplex;
  /** The same complex, displaced along the projection direction alone. */
  readonly twin: CellComplex;
  /** The chart both are projected into — scene 3's plane, reused. */
  readonly slice: HyperplaneSliceN;
  /** Unit projection direction; the coordinate the projection discards. */
  readonly normal: readonly [number, number, number];
}

/** Chart coordinates of one ambient point: what the flat view shows. */
export function chartOf(
  slice: HyperplaneSliceN,
  point: readonly number[]
): [number, number] {
  const [u, v] = slice.basis;
  let a = 0;
  let b = 0;
  for (let axis = 0; axis < point.length; axis++) {
    a += point[axis]! * u![axis]!;
    b += point[axis]! * v![axis]!;
  }
  return [a, b];
}

/**
 * Builds the cube and a genuinely different solid with the same shadow.
 *
 * @returns Both complexes and the shared chart.
 *
 * @example
 * ```ts
 * const pair = buildProjectionPair();
 * projectedVertices(pair, pair.original);   // the same shadow, to ~1e-16,
 * projectedVertices(pair, pair.twin);       // while the solids stand ~1 apart
 * ```
 */
export function buildProjectionPair(): ProjectionPair {
  const { complex, normal } = buildFlatlandSource();
  const slice = new HyperplaneSliceN({ normal: [...normal], offset: 0 });

  const positions = Float64Array.from(complex.positions);
  const moved = Float64Array.from(complex.positions);
  for (let vertex = 0; vertex < complex.vertexCount; vertex++) {
    const point = [
      positions[vertex * 3]!, positions[vertex * 3 + 1]!, positions[vertex * 3 + 2]!
    ];
    const [u, v] = chartOf(slice, point);
    // Any function of the chart coordinates alone preserves the shadow. A
    // saddle warps the twin visibly rather than merely shifting it. It vanishes
    // at the chart origin, so the diagonal's own two poles stay put and the
    // other six corners move — which is the honest description, and what
    // `test/flatland-projection.test.ts` pins.
    const along = SHEAR_COEFFICIENT * ((u * v) / (CUBE_HALF_EXTENT * CUBE_HALF_EXTENT));
    for (let axis = 0; axis < 3; axis++) {
      moved[vertex * 3 + axis] = point[axis]! + along * normal[axis]!;
    }
  }

  const twin = new CellComplex(3, moved, complex.groups.map((group) => ({
    ...(group.key === undefined ? {} : { key: group.key }),
    dim: group.dim,
    verticesPerCell: group.verticesPerCell,
    kind: group.kind,
    indices: Uint32Array.from(group.indices)
  })));

  return { original: complex, twin, slice, normal };
}

/** Every vertex of one solid, as the flat view would draw it. */
export function projectedVertices(
  pair: ProjectionPair,
  complex: CellComplex
): [number, number][] {
  const out: [number, number][] = [];
  for (let vertex = 0; vertex < complex.vertexCount; vertex++) {
    out.push(chartOf(pair.slice, [
      complex.positions[vertex * 3]!,
      complex.positions[vertex * 3 + 1]!,
      complex.positions[vertex * 3 + 2]!
    ]));
  }
  return out;
}

/** The projected 1-skeleton, as vertex-index pairs shared by both solids. */
export function projectedEdges(complex: CellComplex): [number, number][] {
  const group = complex.cellsOfDim(1)[0];
  if (group === undefined) throw new Error('projectedEdges: no 1-cells');
  const edges: [number, number][] = [];
  for (let i = 0; i < group.indices.length; i += 2) {
    edges.push([group.indices[i]!, group.indices[i + 1]!]);
  }
  return edges;
}

/**
 * How far apart the two solids actually are, in the direction that is dropped.
 *
 * The number the scene quotes when it claims the twin is a different solid
 * rather than a restyled one.
 */
export function ambientSeparation(pair: ProjectionPair): number {
  let worst = 0;
  for (let vertex = 0; vertex < pair.original.vertexCount; vertex++) {
    let sum = 0;
    for (let axis = 0; axis < 3; axis++) {
      const d = pair.twin.positions[vertex * 3 + axis]!
        - pair.original.positions[vertex * 3 + axis]!;
      sum += d * d;
    }
    worst = Math.max(worst, Math.sqrt(sum));
  }
  return worst;
}

/**
 * Fractional padding around the projection, so no vertex sits on the boundary.
 *
 * Small and fixed: the figure should fill its pane, and a vertex exactly on the
 * edge reads as clipped even when it is not.
 */
export const PROJECTION_PADDING = 0.08;

/**
 * Half-extent of a square viewBox that contains the whole projection.
 *
 * Derived from the points actually being drawn rather than assumed. The first
 * version reused the SECTION's extent — `√2 × 1.02 ≈ 1.4425`, which is right for
 * a cut, whose vertices never leave the solid — for the SHADOW, whose vertices
 * reach `2√2/√3 ≈ 1.6330`. The hexagon's two ±x poles fell outside and were
 * clipped by `overflow: hidden` at every pane narrower than 1.132:1, which is
 * most of them. The two vertices a visitor lost were exactly the ones that make
 * it a hexagon.
 *
 * Square, and taken over BOTH sources, so the two projections share one
 * coordinate scale and a resize letterboxes rather than distorts: with
 * `preserveAspectRatio="… meet"` a square viewBox is always fully visible, so
 * nothing can be clipped at any aspect ratio.
 *
 * @param pair - The two solids being projected.
 * @returns The half-extent to use for the viewBox, in chart units.
 */
export function projectionExtent(pair: ProjectionPair): number {
  let worst = 0;
  for (const complex of [pair.original, pair.twin]) {
    for (const [x, y] of projectedVertices(pair, complex)) {
      worst = Math.max(worst, Math.abs(x), Math.abs(y));
    }
  }
  return worst * (1 + PROJECTION_PADDING);
}
