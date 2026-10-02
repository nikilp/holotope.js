/**
 * The hidden plane, seen from outside.
 *
 * Everything this experience moves through the fourth direction moves in ONE
 * plane, the x–w plane: the slice turns in it (`TURN_PLANE`), the ball's drop
 * and the off-centre spin happen in it, and the turning scene's "through w"
 * mode turns the box in it. So a map of that plane can show the slice and the
 * bodies together, from a viewpoint no 3D observer has.
 *
 * ## Why the map can be trusted
 *
 * Flatten each body onto the x–w plane along y and z: its FOOTPRINT. While the
 * slice's normal n lies in the x–w plane, n·p reads only p's x and w, so
 *
 *     the slice {p : n·p = offset} meets a body
 *     ⇔ some point of the body has n·p = offset
 *     ⇔ the body's footprint meets the line {q : n·q = offset}.
 *
 * The map is therefore exact about WHETHER and WHERE the slice cuts — not
 * about the cut's shape, which needs y and z. The footprint of a convex
 * polytope is the convex hull of its projected corners; of a ball, the disc of
 * its radius about its projected centre. Both are read from the same posed
 * corners and centres the gauge reads; nothing here is authored geometry.
 *
 * The footprint is NOT the shadow: the shadow flattens a body onto your 3D
 * view along the slice's normal; the footprint flattens it onto the x–w plane
 * along y and z. They are named apart wherever they appear.
 *
 * If the slice's normal ever left the x–w plane the equivalence above would
 * fail, so `lineOf` refuses (returns null) rather than draw a wrong line.
 */

import { ON_PLANE_EPSILON } from '../spatial-4d-turn/section.js';

/** The coordinate axes the map shows: x across, w up. */
export const PLANE_AXES = [0, 3] as const;

/**
 * Half-width of the square the map shows, in model units: the turning world's footprints reach
 * x = 3.6 + 0.72, the contact world's launch w = 2.7 + 0.5; the rest is room for the handles.
 */
export const PLANE_EXTENT = 5.2;

/** Tolerance on a normal's y and z components for it to count as lying in the x–w plane. */
const IN_PLANE = 1e-12;

/**
 * The sectioner's own tolerance, mirrored by the section modules: a point within it of the slice is
 * ON the slice. The map uses the same band, so it never disagrees with the library about whether a
 * body touches the slice.
 */
const ON_LINE = ON_PLANE_EPSILON;

/** A body flattened onto the x–w plane along y and z. */
export type Footprint =
  | { readonly kind: 'polygon'; readonly points: readonly (readonly [number, number])[] }
  | { readonly kind: 'disc'; readonly centre: readonly [number, number]; readonly radius: number };

/** Convex hull of points in the plane, counter-clockwise, collinear points dropped (Andrew's monotone chain). */
export function hull(points: readonly (readonly [number, number])[]): [number, number][] {
  const sorted = [...points].map((p) => [p[0], p[1]] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** The footprint of a convex polytope from its posed 4D corners. */
export function polytopeFootprint(corners: readonly (readonly number[])[]): Footprint {
  return { kind: 'polygon', points: hull(corners.map((c) => [c[PLANE_AXES[0]]!, c[PLANE_AXES[1]]!] as const)) };
}

/** The footprint of a 4D ball from its centre and radius. */
export function ballFootprint(centre: readonly number[], radius: number): Footprint {
  return { kind: 'disc', centre: [centre[PLANE_AXES[0]]!, centre[PLANE_AXES[1]]!], radius };
}

/**
 * The slice as a line on the map, {q : n·q = offset} with n = (n_x, n_w) — or
 * null if the normal has any y or z component, when the map would not be exact.
 */
export function lineOf(normal: readonly number[], offset: number): { readonly n: readonly [number, number]; readonly offset: number } | null {
  if (Math.abs(normal[1] ?? 0) > IN_PLANE || Math.abs(normal[2] ?? 0) > IN_PLANE) return null;
  return { n: [normal[PLANE_AXES[0]]!, normal[PLANE_AXES[1]]!], offset };
}

type Line = NonNullable<ReturnType<typeof lineOf>>;
type Point = readonly [number, number];

/** Along the line: the direction d with (n, d) right-handed, so a turn of θ tilts d by θ from +x. */
const along = (line: Line): Point => [line.n[1], -line.n[0]];
/** The line's foot: its nearest point to the centre point. */
const foot = (line: Line): Point => [line.offset * line.n[0], line.offset * line.n[1]];

/** The line clipped to the map's square, as its two ends — or null if it misses the square. */
export function lineSegment(line: Line, extent: number = PLANE_EXTENT): [Point, Point] | null {
  const f = foot(line);
  const d = along(line);
  let t0 = Number.NEGATIVE_INFINITY;
  let t1 = Number.POSITIVE_INFINITY;
  for (const k of [0, 1] as const) {
    if (Math.abs(d[k]) < 1e-15) {
      if (Math.abs(f[k]) > extent) return null;
      continue;
    }
    const a = (-extent - f[k]) / d[k];
    const b = (extent - f[k]) / d[k];
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (t0 > t1) return null;
  return [[f[0] + t0 * d[0], f[1] + t0 * d[1]], [f[0] + t1 * d[0], f[1] + t1 * d[1]]];
}

/**
 * Where the line crosses a footprint: the slice's cut of that body, flattened
 * onto the map. Null when they do not meet; a zero-length chord when they meet
 * only at a boundary point. Meeting is decided with the sectioner's tolerance:
 * a corner within it of the line is on the line.
 */
export function chordOf(footprint: Footprint, line: Line): [Point, Point] | null {
  const d = along(line);
  if (footprint.kind === 'disc') {
    const s = line.n[0] * footprint.centre[0] + line.n[1] * footprint.centre[1] - line.offset;
    if (Math.abs(s) > footprint.radius + ON_LINE) return null;
    const half = Math.sqrt(Math.max(0, footprint.radius ** 2 - s ** 2));
    const m: Point = [footprint.centre[0] - s * line.n[0], footprint.centre[1] - s * line.n[1]];
    return [[m[0] - half * d[0], m[1] - half * d[1]], [m[0] + half * d[0], m[1] + half * d[1]]];
  }
  const pts = footprint.points;
  const hits: Point[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const sa = line.n[0] * a[0] + line.n[1] * a[1] - line.offset;
    const sb = line.n[0] * b[0] + line.n[1] * b[1] - line.offset;
    if (Math.abs(sa) <= ON_LINE) hits.push(a);
    if ((sa < -ON_LINE && sb > ON_LINE) || (sa > ON_LINE && sb < -ON_LINE)) {
      const t = sa / (sa - sb);
      hits.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  if (hits.length === 0) return null;
  const key = (p: Point): number => p[0] * d[0] + p[1] * d[1];
  hits.sort((p, q) => key(p) - key(q));
  return [hits[0]!, hits[hits.length - 1]!];
}

/** The ana side of the line within the map's square: the region its normal points into. */
export function anaRegion(line: Line, extent: number = PLANE_EXTENT): Point[] {
  const square: Point[] = [[-extent, -extent], [extent, -extent], [extent, extent], [-extent, extent]];
  const s = (p: Point): number => line.n[0] * p[0] + line.n[1] * p[1] - line.offset;
  const out: Point[] = [];
  for (let i = 0; i < square.length; i++) {
    const a = square[i]!;
    const b = square[(i + 1) % square.length]!;
    const sa = s(a);
    const sb = s(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}
