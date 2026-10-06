/**
 * An independent account of what a slice and a light make of a posed hypercube,
 * written from the definitions and sharing no code with the page or the
 * library's sectioner: an edge crosses the slice where its ends lie strictly
 * on opposite sides; the cut is the convex hull of those crossings and of the
 * corners lying in the slice; the shadow drops the missing coordinate.
 *
 * The posed corners come from the world under test, so the comparison is of
 * what each side makes of the same corners, not of how they were posed.
 */

export const EPS = 1e-9;

/** Every crossing of an edge with the slice, and every corner lying in it. */
export function crossings(corners: readonly (readonly number[])[], edges: readonly (readonly [number, number])[], axis: number, offset: number): number[][] {
  const out: number[][] = [];
  const push = (p: number[]): void => {
    if (!out.some((q) => q.every((x, k) => Math.abs(x - p[k]!) <= 1e-9))) out.push(p);
  };
  corners.forEach((c) => { if (Math.abs(c[axis]! - offset) <= EPS) push([...c]); });
  for (const [a, b] of edges) {
    const p = corners[a]!;
    const q = corners[b]!;
    const hp = p[axis]! - offset;
    const hq = q[axis]! - offset;
    if (Math.abs(hp) <= EPS || Math.abs(hq) <= EPS) continue;
    if (hp * hq < 0) {
      const t = hp / (hp - hq);
      push(p.map((x, k) => x + t * (q[k]! - x)));
    }
  }
  return out;
}

/** Drop one coordinate. */
export const drop = (p: readonly number[], axis: number): number[] => p.filter((_, k) => k !== axis);

/** The convex hull of points in the plane, counter-clockwise, collinear points removed. */
export function hull2(points: readonly (readonly number[])[]): number[][] {
  const p = [...points].map((q) => [q[0]!, q[1]!]).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
  const cross = (o: number[], a: number[], b: number[]): number => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const lower: number[][] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 1e-12) lower.pop(); lower.push(q); }
  const upper: number[][] = [];
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 1e-12) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function area2(ring: readonly (readonly number[])[]): number {
  let s = 0;
  ring.forEach((p, i) => { const q = ring[(i + 1) % ring.length]!; s += p[0]! * q[1]! - q[0]! * p[1]!; });
  return Math.abs(s) / 2;
}

const sub = (a: readonly number[], b: readonly number[]): number[] => a.map((x, k) => x - b[k]!);
const cross3 = (a: readonly number[], b: readonly number[]): number[] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const dot = (a: readonly number[], b: readonly number[]): number => a.reduce((s, x, k) => s + x * b[k]!, 0);

/**
 * The faces of the convex hull of points in space, by brute force over planes through three points: a plane is a
 * face when every point lies on one side of it. Returns each face's points, and the hull's surface area.
 */
export function hull3(points: readonly (readonly number[])[]): { faces: number[][][]; area: number } {
  const faces: { n: number[]; d: number; members: number[][] }[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      for (let k = j + 1; k < points.length; k++) {
        const n = cross3(sub(points[j]!, points[i]!), sub(points[k]!, points[i]!));
        const length = Math.hypot(...n);
        if (length < 1e-9) continue;
        const u = n.map((x) => x / length);
        const d = dot(u, points[i]!);
        const side = points.map((p) => dot(u, p) - d);
        const above = side.some((s) => s > 1e-7);
        const below = side.some((s) => s < -1e-7);
        if (above && below) continue;
        const outward = above ? u.map((x) => -x) : u;
        const od = above ? -d : d;
        if (faces.some((f) => Math.abs(dot(f.n, outward) - 1) < 1e-7 && Math.abs(f.d - od) < 1e-7)) continue;
        faces.push({ n: outward, d: od, members: points.filter((p) => Math.abs(dot(outward, p) - od) < 1e-7).map((p) => [...p]) });
      }
    }
  }
  let area = 0;
  for (const f of faces) {
    // Order the face's points around its centre, then fan.
    const c = [0, 1, 2].map((k) => f.members.reduce((s, p) => s + p[k]!, 0) / f.members.length);
    const e1 = sub(f.members[0]!, c);
    const e1n = e1.map((x) => x / Math.hypot(...e1));
    const e2 = cross3(f.n, e1n);
    const ring = [...f.members].sort((p, q) => Math.atan2(dot(sub(p, c), e2), dot(sub(p, c), e1n)) - Math.atan2(dot(sub(q, c), e2), dot(sub(q, c), e1n)));
    for (let i = 1; i + 1 < ring.length; i++) area += Math.hypot(...cross3(sub(ring[i]!, ring[0]!), sub(ring[i + 1]!, ring[0]!))) / 2;
  }
  return { faces: faces.map((f) => f.members), area };
}

/** Points of A and B are the same set, each within `tol` of one in the other. */
export function sameSet(a: readonly (readonly number[])[], b: readonly (readonly number[])[], tol = 1e-9): boolean {
  if (a.length !== b.length) return false;
  return a.every((p) => b.some((q) => p.every((x, k) => Math.abs(x - q[k]!) <= tol)))
    && b.every((p) => a.some((q) => p.every((x, k) => Math.abs(x - q[k]!) <= tol)));
}
