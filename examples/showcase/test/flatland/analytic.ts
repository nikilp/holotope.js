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

/** Every way of choosing k of 0..n−1, in increasing order. */
function choose(n: number, k: number): number[][] {
  if (k === 0) return [[]];
  const out: number[][] = [];
  for (let first = 0; first <= n - k; first++) for (const rest of choose(n - first - 1, k - 1)) out.push([first, ...rest.map((x) => x + first + 1)]);
  return out;
}

/**
 * The k-faces of a hypercube, from its authored corners' signs alone: each is the set of corners that agree on every
 * coordinate but k. For k = 1 these are the edges, for k = 2 the squares, for k = 3 the cubes.
 */
export function hypercubeFaces(signs: readonly (readonly number[])[], k: number): number[][] {
  const dim = signs[0]!.length;
  const out: number[][] = [];
  for (const free of choose(dim, k)) {
    const fixed = [...Array(dim).keys()].filter((a) => !free.includes(a));
    const groups = new Map<string, number[]>();
    signs.forEach((s, i) => {
      const key = fixed.map((a) => Math.sign(s[a]!)).join(',');
      groups.set(key, [...(groups.get(key) ?? []), i]);
    });
    out.push(...groups.values());
  }
  return out;
}

/** A cut, as the witness measures it: its corners, its edges (pairs of corners), and its faces (rings of corners, in order). */
export interface Measured {
  readonly points: readonly (readonly number[])[];
  readonly edges: readonly (readonly [number, number])[];
  readonly faces: readonly (readonly number[])[];
}

/** The ring a set of edges forming one cycle makes, from its first corner round. */
function chain(edges: readonly (readonly [number, number])[]): number[] {
  const ring = [edges[0]![0], edges[0]![1]];
  const used = new Set([0]);
  while (used.size < edges.length) {
    const last = ring[ring.length - 1]!;
    const next = edges.findIndex((e, i) => !used.has(i) && (e[0] === last || e[1] === last));
    if (next === -1) throw new Error('analytic: the cut edges do not close');
    used.add(next);
    const e = edges[next]!;
    ring.push(e[0] === last ? e[1] : e[0]);
  }
  if (ring[ring.length - 1] !== ring[0]) throw new Error('analytic: the cut edges do not close');
  return ring.slice(0, -1);
}

/**
 * The cut of a posed hypercube by the slice, by its faces, where no corner lies within {@link EPS} of the slice
 * (null otherwise). Then the cut's corners are exactly the crossings of the edges whose ends lie on opposite sides;
 * each square the slice cuts has exactly two such edges and gives the cut one edge, between their crossings; and each
 * cube it cuts gives a cut solid one face, the ring of the edges from that cube's squares. A cut polygon is the ring of
 * all its edges. The points are given in the slice, the missing coordinate dropped. Nothing here depends on the cut's
 * size, so it measures a cut far too small for a hull of its points.
 */
export function cutByFaces(signs: readonly (readonly number[])[], corners: readonly (readonly number[])[], axis: number, offset: number): Measured | null {
  const h = corners.map((p) => p[axis]! - offset);
  if (h.some((x) => Math.abs(x) <= EPS)) return null;
  const dim = signs[0]!.length;
  const points: number[][] = [];
  const crossingOf = new Map<string, number>();
  for (const [a, b] of hypercubeFaces(signs, 1) as [number, number][]) {
    if (h[a]! * h[b]! >= 0) continue;
    const t = h[a]! / (h[a]! - h[b]!);
    crossingOf.set(`${Math.min(a, b)}-${Math.max(a, b)}`, points.length);
    points.push(drop(corners[a]!.map((x, k) => x + t * (corners[b]![k]! - x)), axis));
  }
  const squares = hypercubeFaces(signs, 2);
  const edges: [number, number][] = [];
  const edgeOfSquare = new Map<number, number>();
  squares.forEach((square, s) => {
    const crossed: number[] = [];
    for (let i = 0; i < square.length; i++) {
      for (let j = i + 1; j < square.length; j++) {
        const c = crossingOf.get(`${Math.min(square[i]!, square[j]!)}-${Math.max(square[i]!, square[j]!)}`);
        if (c !== undefined) crossed.push(c);
      }
    }
    if (crossed.length === 0) return;
    if (crossed.length !== 2) throw new Error(`analytic: a square crossed at ${crossed.length} edges`);
    edgeOfSquare.set(s, edges.length);
    edges.push([crossed[0]!, crossed[1]!]);
  });
  if (points.length === 0) return { points, edges, faces: [] };
  const faces = dim === 3
    ? [chain(edges)]
    : hypercubeFaces(signs, 3).map((cube) => squares
      .map((square, s) => (square.every((i) => cube.includes(i)) ? edgeOfSquare.get(s) : undefined))
      .filter((e): e is number => e !== undefined)
      .map((e) => edges[e]!)).filter((es) => es.length > 0).map(chain);
  return { points, edges, faces };
}

/**
 * The same, for a cut through corners of the object, from the convex hull of the crossings and the corners in the
 * slice: every such point is a corner of the cut, its edges are the pairs on two common faces, and each face's ring is
 * its points in angular order about their centre. Only for cuts of a size a hull resolves.
 */
export function cutByHull(points: readonly (readonly number[])[], dim: number): Measured {
  if (dim === 2) {
    const ring = hull2(points);
    return { points: ring, edges: ring.map((_, i) => [i, (i + 1) % ring.length] as [number, number]), faces: [ring.map((_, i) => i)] };
  }
  const { faces } = hull3(points);
  const all: number[][] = [];
  const id = (p: readonly number[]): number => {
    const found = all.findIndex((q) => q.every((x, k) => Math.abs(x - p[k]!) < 1e-9));
    if (found !== -1) return found;
    all.push([...p]);
    return all.length - 1;
  };
  const rings = faces.map((f) => {
    const ids = f.map(id);
    const c = [0, 1, 2].map((k) => ids.reduce((s, i) => s + all[i]![k]!, 0) / ids.length);
    const e1 = sub(all[ids[0]!]!, c);
    const n = cross3(sub(all[ids[1]!]!, all[ids[0]!]!), sub(all[ids[2]!]!, all[ids[0]!]!));
    const e2 = cross3(n, e1);
    const angle = (i: number): number => Math.atan2(dot(sub(all[i]!, c), e2), dot(sub(all[i]!, c), e1));
    return [...ids].sort((p, q) => angle(p) - angle(q));
  });
  const edges: [number, number][] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (rings.filter((r) => r.includes(i) && r.includes(j)).length >= 2) edges.push([i, j]);
    }
  }
  return { points: all, edges, faces: rings };
}

const length = (g: Measured, [a, b]: readonly [number, number]): number => Math.hypot(...sub(g.points[a]!, g.points[b]!));

/** The cosine of the angle at each corner of a ring, between the two edges that meet there. */
export function ringCosines(g: Measured, ring: readonly number[]): number[] {
  return ring.map((p, i) => {
    const u = sub(g.points[ring[(i - 1 + ring.length) % ring.length]!]!, g.points[p]!);
    const v = sub(g.points[ring[(i + 1) % ring.length]!]!, g.points[p]!);
    return dot(u, v) / (Math.hypot(...u) * Math.hypot(...v));
  });
}

export const edgeLengths = (g: Measured): number[] => g.edges.map((e) => length(g, e));

/**
 * What a cut may be called, by the conditions each name states, with lengths equal when they differ by at most `eq`
 * of the longest and angles right or alike when their cosines differ by at most `angle`. A cut whose longest edge is
 * under 1e-4 is only counted: the coordinates carry about 1e-15 of error, so below that a length is not known to the
 * ten digits the conditions need; and no angle or direction is judged unless every edge is that long, since a short
 * edge's direction is known no better than its length. Written from the conditions, not from the page's code: an equiangular hexagon is
 * one whose angles are all 120°; a prism's caps are two faces of one size that share no corner, joined by edges that
 * are one and the same vector; a tetrahedron with its corners cut off has four hexagons whose planes meet, three at a
 * time, at four points, each beyond the triangle it is cut off by and inside the fourth hexagon's plane.
 */
export function nameByConditions(dim: 2 | 3, g: Measured, eq: number, angle: number): string {
  const lengths = edgeLengths(g);
  const max = Math.max(...lengths);
  const resolved = max >= 1e-4;
  const equal = resolved && max - Math.min(...lengths) <= eq * max;
  const V = g.points.length;
  const word = (n: number): string => ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'][n] ?? String(n);
  const directions = Math.min(...lengths) >= 1e-4;
  const right = (ring: readonly number[]): boolean => directions && ringCosines(g, ring).every((c) => Math.abs(c) <= angle);
  if (dim === 2) {
    const ring = g.faces[0]!;
    if (V === 3) return equal ? 'an equilateral triangle' : 'a triangle';
    if (V === 4) {
      if (!resolved) return 'a four-sided shape';
      if (right(ring)) return equal ? 'a square' : 'a rectangle';
      return equal ? 'a rhombus' : 'a four-sided shape';
    }
    if (V === 5) return 'a pentagon';
    if (V === 6) return equal && directions && ringCosines(g, ring).every((c) => Math.abs(c + 0.5) <= angle) ? 'a regular hexagon' : 'a hexagon';
    return `a shape with ${word(V)} corners`;
  }
  const F = g.faces.length;
  const sizes = g.faces.map((f) => f.length);
  const ofSize = (k: number): number => sizes.filter((s) => s === k).length;
  if (V === 4 && F === 4) return equal ? 'a regular tetrahedron' : 'a tetrahedron';
  if (V === 6 && F === 8 && ofSize(3) === 8) return equal ? 'a regular octahedron' : 'an octahedron';
  const generic = `a solid with ${word(V)} corners and ${word(F)} faces`;
  if (!directions) return generic;
  if (V === 8 && F === 6 && ofSize(4) === 6 && g.faces.every(right)) return equal ? 'a cube' : 'a box';
  for (const [k, name] of [[3, 'a triangular prism'], [6, 'a hexagonal prism']] as const) {
    const caps = g.faces.filter((f) => f.length === k);
    if (V !== 2 * k || F !== k + 2 || caps.length !== 2 || ofSize(4) !== k || caps[0]!.some((i) => caps[1]!.includes(i))) continue;
    const across = g.edges.filter(([a, b]) => (caps[0]!.includes(a) && caps[1]!.includes(b)) || (caps[0]!.includes(b) && caps[1]!.includes(a)));
    const vectors = across.map(([a, b]) => (caps[0]!.includes(a) ? sub(g.points[b]!, g.points[a]!) : sub(g.points[a]!, g.points[b]!)));
    const scale = Math.hypot(...vectors[0]!);
    if (across.length === k && vectors.every((v) => Math.hypot(...sub(v, vectors[0]!)) <= eq * scale)) return name;
  }
  if (V === 12 && F === 8 && ofSize(3) === 4 && ofSize(6) === 4 && truncated(g)) return 'a tetrahedron with its corners cut off';
  return generic;
}

/** The plane of a face: its unit normal, pointing away from the solid's centre, and its offset along it. */
function planeOf(g: Measured, ring: readonly number[], centre: readonly number[]): { n: number[]; d: number } {
  const p = g.points;
  let n = cross3(sub(p[ring[1]!]!, p[ring[0]!]!), sub(p[ring[2]!]!, p[ring[0]!]!));
  n = n.map((x) => x / Math.hypot(...n));
  if (dot(n, sub(p[ring[0]!]!, centre)) < 0) n = n.map((x) => -x);
  return { n, d: dot(n, p[ring[0]!]!) };
}

/** Where three planes meet, by elimination with partial pivoting; null when they do not meet in one point. */
function meet(planes: readonly { n: number[]; d: number }[]): number[] | null {
  const m = planes.map((q) => [...q.n, q.d]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    if (Math.abs(m[pivot]![col]!) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r]![col]! / m[col]![col]!;
      for (let c = col; c < 4; c++) m[r]![c] = m[r]![c]! - f * m[col]![c]!;
    }
  }
  return [0, 1, 2].map((k) => m[k]![3]! / m[k]![k]!);
}

/** Four hexagons whose planes close round a tetrahedron, each of whose corners one of the triangles cuts off. */
function truncated(g: Measured): boolean {
  const centre = [0, 1, 2].map((k) => g.points.reduce((s, p) => s + p[k]!, 0) / g.points.length);
  const hexagons = g.faces.filter((f) => f.length === 6);
  const triangles = g.faces.filter((f) => f.length === 3);
  const planes = hexagons.map((f) => planeOf(g, f, centre));
  return triangles.every((t) => {
    // The three hexagons that share an edge with this triangle, and the one that does not.
    const near = hexagons.map((f, i) => [f, i] as const).filter(([f]) => t.filter((i) => f.includes(i)).length === 2).map(([, i]) => i);
    if (near.length !== 3) return false;
    const far = [0, 1, 2, 3].find((i) => !near.includes(i))!;
    const apex = meet(near.map((i) => planes[i]!));
    if (apex === null) return false;
    const cut = planeOf(g, t, centre);
    return dot(cut.n, apex) > cut.d && dot(planes[far]!.n, apex) < planes[far]!.d;
  });
}
