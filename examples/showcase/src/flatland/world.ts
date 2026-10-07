import {
  CellComplex,
  HyperplaneSliceN,
  TransformN,
  VecN,
  createHypercube,
  expBivector,
  simplexizeCuboidGroupN,
  wedgeVectors,
  type CellGroup,
  type MatN,
  type SectionSimplexGroupNDiagnosticsN
} from '@holotope/core';
import { SectionChart3D } from '@holotope/three';
import { MeshStandardMaterial, DoubleSide } from 'three';
import { nameCubes, type SourceFace } from '../spatial-4d-turn/faces.js';
import { buildFlatlandSource, outlineProvenance, sectionOutline, type FlatlandOutline } from './section.js';

/**
 * The two worlds of One More Direction, and everything measured in them.
 *
 * ## Two rungs, one construction
 *
 * The **plane rung** is a cube in R3 and a plane, the slice, at height `h` on
 * the z axis: the direction the plane lacks. The **space rung** is a tesseract
 * in R4 and a three-dimensional slice at `h` on the w axis: the direction your
 * space lacks. Everything below is written once and read twice: the same tip,
 * the same cut, the same shadow, one dimension apart.
 *
 * ## Who computes what
 *
 * The library, always. The cube's cut is `sectionOutline` from `section.ts`:
 * the pinned Flatland module over the library's `sectionSimplexGroupN`, whose
 * contracts and baseline digest are kept. The tesseract's cut is
 * `SectionChart3D` over `simplexizeCuboidGroupN` of its eight cubes, as The
 * Hidden Direction cuts its block. A shadow is the slice's own
 * `projectPointToChart`: the orthogonal drop along the slice's normal, which is
 * light arriving straight along the missing direction. The turn is
 * `expBivector`, a rigid rotation, applied as a pose. This module adds only
 * bookkeeping: which corners lie where, which points pile up in a shadow, what
 * to call a shape it has counted.
 *
 * ## Frames
 *
 * The slice never turns: it stays perpendicular to the missing axis, so its
 * chart is exactly the remaining axes, in order (`HyperplaneSliceN.axisAligned`).
 * What turns is the object, by a pose. A cut therefore arrives in world
 * coordinates, and nothing about the picture's frame moves when the object does.
 *
 * ## The boundary
 *
 * The sectioner counts a point within 1e-9 of the slice as lying on the far
 * side. So a slice lying exactly on a face draws nothing when the object is on
 * the far side, and the face when it is on the near side. {@link Meeting} says
 * which, and the copy says it was the tie-break and not the geometry.
 */

export type RungId = 'plane' | 'space';

/**
 * The sectioner's default classification tolerance, mirrored. The library does
 * not export it; `test/flatland/world.test.ts` checks the mirror against the
 * section's own behaviour at the boundary.
 */
export const ON_PLANE_EPSILON = 1e-9;

/** The tip's three named poses, as angles in radians. */
export interface TipStops {
  /** The facet (a face of the cube, a cell of the tesseract) lies flat, toward the slice. */
  readonly facet: number;
  /** A corner points straight along the missing direction. */
  readonly corner: number;
  /** An edge lies flat, toward the slice. */
  readonly edge: number;
}

export interface RungSpec {
  readonly id: RungId;
  readonly dim: 3 | 4;
  /** The missing direction: the slice's normal axis. */
  readonly extraAxis: 2 | 3;
  /**
   * The unit vector the tip turns toward the missing axis. The tip is the rotation
   * in the plane spanned by this vector and the missing axis, and nothing else.
   */
  readonly tipToward: readonly number[];
  readonly stops: TipStops;
  /** How far the slider reaches either way: past the object's farthest corner in every pose. */
  readonly reach: number;
}

const unit = (v: readonly number[]): number[] => {
  const length = Math.hypot(...v);
  return v.map((x) => x / length);
};

/**
 * The plane rung. The tip turns the main diagonal of the cube's bottom face up
 * toward z: at 0 a face lies flat, at acos(1/√3) ≈ 54.74° the corner (+ + +)
 * points straight up, at 90° the edge {x = y = −1} lies lowest.
 */
export const PLANE_RUNG: RungSpec = {
  id: 'plane',
  dim: 3,
  extraAxis: 2,
  tipToward: unit([1, 1, 0]),
  stops: { facet: 0, corner: Math.acos(1 / Math.sqrt(3)), edge: Math.PI / 2 },
  reach: 2.1
};

/**
 * The space rung. The tip turns the main diagonal of one cubic cell up toward w:
 * at 0 a cell lies flat, at acos(1/2) = 60° the corner (+ + + +) points straight
 * along w, at 90° the edge {x = y = z = −1} lies lowest.
 */
export const SPACE_RUNG: RungSpec = {
  id: 'space',
  dim: 4,
  extraAxis: 3,
  tipToward: unit([1, 1, 1, 0]),
  stops: { facet: 0, corner: Math.acos(1 / 2), edge: Math.PI / 2 },
  reach: 2.4
};

export const RUNGS: Record<RungId, RungSpec> = { plane: PLANE_RUNG, space: SPACE_RUNG };

/** The tip as a rotation matrix: `exp(θ · u ∧ e)`, turning `u` toward the missing axis `e` by θ. */
export function tipRotation(rung: RungSpec, angle: number): MatN {
  const e = new Array<number>(rung.dim).fill(0);
  e[rung.extraAxis] = 1;
  return expBivector(wedgeVectors(new VecN(rung.tipToward), new VecN(e)).scale(angle));
}

/** One corner of the source, named by the signs of its authored coordinates. */
export interface Corner {
  readonly index: number;
  /** e.g. "(+ − +)": the authored corner, whatever the pose. */
  readonly name: string;
  /** Where the pose has put it, in world coordinates. */
  readonly posed: readonly number[];
  /** Its signed distance from the slice: positive on the side the missing axis points to. */
  readonly height: number;
}

/** What the slice meets, from the corners' own signed distances. */
export type Meeting =
  /** Every corner lies strictly on the side the missing axis points to: the slice is below the object. */
  | { readonly kind: 'apart'; readonly side: 'below' | 'above'; readonly gap: number }
  /**
   * No corner lies strictly on one side, and some lie on the slice: the object only touches it.
   * `feature` is what lies on the slice; `drawn` is what the sectioner emitted for it, and `undrawn` says why
   * nothing was, from the section's own diagnostics: `far-side` when no cell had a corner strictly below the
   * slice (the tie-break counts a corner on it as above), `collapsed` when cells straddled it but every cut
   * collapsed to a point or a segment.
   */
  | {
    readonly kind: 'touching';
    readonly feature: 'corner' | 'edge' | 'face' | 'cell';
    readonly objectSide: 'below' | 'above';
    readonly onCorners: readonly number[];
    readonly drawn: boolean;
    readonly undrawn: 'far-side' | 'collapsed' | null;
  }
  /** Corners lie strictly on both sides: the slice passes through the object. */
  | { readonly kind: 'crossing' };

/** A height along the missing direction where corners of the posed object lie: where the cut can change. */
export interface Layer {
  /** Along the missing axis, in world coordinates; snapped onto the slide grid when within 1e-9 of it. */
  readonly height: number;
  /** The corners at this height, by index. */
  readonly corners: readonly number[];
}

/** One point of a shadow, and every corner that lands on it. */
export interface ShadowPoint {
  /** World coordinates on the slice. */
  readonly at: readonly number[];
  /** The corners landing here, by index; two or more is overlap, not identity. */
  readonly corners: readonly number[];
}

export interface Shadow {
  readonly points: readonly ShadowPoint[];
  /** Every source edge, projected: pairs of world points on the slice. */
  readonly segments: readonly (readonly [readonly number[], readonly number[]])[];
  /** Source edges as vertex index pairs, in the same order as `segments`. */
  readonly edges: readonly (readonly [number, number])[];
}

/** A corner of a cut: where it is, and the source edge or corner it lies on. */
export interface CutCorner {
  readonly at: readonly number[];
  /** The source corners this point lies between: one (it is a corner) or two (an edge). */
  readonly on: readonly number[];
  /** How far along the edge `on[0] → on[1]`, 0..1; 0 when `on` is a single corner. */
  readonly along: number;
}

/** One edge of a cut: two of its corners, its measured length, and the source faces or cells it lies in. */
export interface CutEdge {
  /** The cut's corners it joins, by index into {@link CutSummary.corners}. */
  readonly a: number;
  readonly b: number;
  /** Unrounded: a display rounds it, a name never does. */
  readonly length: number;
  /**
   * Where it lies on the source: the one face of the cube a side of the cut polygon lies in, or the two cells of
   * the tesseract an edge of the cut solid lies in.
   */
  readonly on: readonly SourceFace[];
}

/** The cut, counted. */
export interface CutSummary {
  readonly empty: boolean;
  /** Intrinsic dimension of what was drawn: 2 (a polygon) in the plane rung, 3 (a solid) in the space rung; null when empty. */
  readonly dimension: number | null;
  readonly corners: readonly CutCorner[];
  /** Faces of a cut solid (space rung) or sides of a cut polygon (plane rung), by source face or cell. */
  readonly faces: readonly { readonly source: SourceFace; readonly sides: number }[];
  /** The edges of the cut (plane rung: its sides, in order around it). */
  readonly edges: readonly CutEdge[];
  /** Their lengths, unrounded, in the same order. */
  readonly edgeLengths: readonly number[];
  /**
   * A measured name: "a square", "a hexagon", "an octahedron"... or a count when nothing simpler is true. A name
   * that says equal, regular, square, right-angled or prism holds by the conditions in {@link EQUAL_REL},
   * {@link ANGLE_ABS} and {@link RESOLVED}, tested on unrounded lengths and directions.
   */
  readonly shape: string;
  /** Whether every edge (side) is the same length, established as {@link EQUAL_REL} says; never for an unresolved cut. */
  readonly equalEdges: boolean;
  /** Whether the cut is large enough to measure: its longest edge at least {@link RESOLVED}. Below it, it is only counted. */
  readonly resolved: boolean;
  /** Source edges the cut crosses, as vertex index pairs: the edges its corners lie on. */
  readonly crossedEdges: readonly (readonly [number, number])[];
}

const signName = (position: readonly number[]): string => `(${position.map((x) => (x < 0 ? '−' : '+')).join(' ')})`;

const sameEdge = (a: number, b: number, positions: ArrayLike<number>, dim: number): boolean => {
  let differ = 0;
  for (let k = 0; k < dim; k++) if (Math.abs(positions[a * dim + k]! - positions[b * dim + k]!) > 1e-12) differ++;
  return differ === 1;
};

const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * When a cut's lengths, directions and angles are said to be equal, right or parallel.
 *
 * Positions come from the sectioner with a rounding error of a few units in the last place of coordinates no larger
 * than the object, so about 1e-15 absolutely. A cut is measured only when its longest edge is at least
 * {@link RESOLVED}, so a length there carries a relative error below 1e-10, and {@link EQUAL_REL} leaves a factor of
 * ten above that. An angle or a direction is judged only when every edge is at least {@link RESOLVED}, for the same
 * reason: a sliver's short side has a direction no better known than its length. These are tolerances on unrounded
 * floating-point measurements, not exact arithmetic: within about 1e-3° of a pose, a cut whose corners miss a right
 * angle by under 1e-9 is called square, true to the tolerance.
 *
 * Over the states `world.test.ts` walks, what the tolerances must refuse lies far beyond them: lengths that no
 * symmetry makes equal differ by at least 0.49 % at the tips the keys reach (named poses and 5° steps), 4 % at drags
 * of the dial just outside its 2.5° snap, and 0.018 % at a drag followed by a key that lands 0.01° from a pose. That
 * is a margin over the walked set, not a bound: nearer a pose, the spread shrinks with the angle.
 */
export const EQUAL_REL = 1e-9;
/** Below this longest edge (the object's edges are 2 long) a cut is too small to measure: counted, never called equal or right. */
export const RESOLVED = 1e-4;
/** A cosine within this of zero is a right angle; two cosines within it of each other, the same angle. */
export const ANGLE_ABS = 1e-9;

const EMPTY_CUT: CutSummary = {
  empty: true, dimension: null, corners: [], faces: [], edges: [], edgeLengths: [], shape: 'nothing', equalEdges: false, resolved: false, crossedEdges: []
};

/** Every length the same, relative to the longest. */
const allEqual = (lengths: readonly number[]): boolean => {
  if (lengths.length === 0) return false;
  const max = Math.max(...lengths);
  const min = Math.min(...lengths);
  return max - min <= EQUAL_REL * max;
};

const sub3 = (a: readonly number[], b: readonly number[]): number[] => [a[0]! - b[0]!, a[1]! - b[1]!, (a[2] ?? 0) - (b[2] ?? 0)];
const dot3 = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const cross3 = (a: readonly number[], b: readonly number[]): number[] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const norm3 = (a: readonly number[]): number => Math.hypot(a[0]!, a[1]!, a[2]!);

/** The cosine of the angle at each corner of a polygon given in order, between its two sides. */
const cornerCosines = (ring: readonly (readonly number[])[]): number[] => ring.map((p, i) => {
  const u = sub3(ring[(i - 1 + ring.length) % ring.length]!, p);
  const v = sub3(ring[(i + 1) % ring.length]!, p);
  return dot3(u, v) / (norm3(u) * norm3(v));
});

const countWord = (n: number): string => ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'][n] ?? String(n);

/**
 * A cut polygon's name, from its corners in order and its unrounded side lengths. Equal sides make a triangle
 * equilateral and a four-sided shape a rhombus; four right angles make a rectangle, and equal sides with them a
 * square; equal sides and equal angles make a hexagon regular. A cut too small to measure is only counted.
 */
function namePolygon(ring: readonly (readonly number[])[], sides: readonly number[]): { shape: string; equal: boolean; resolved: boolean } {
  const n = ring.length;
  const resolved = sides.length > 0 && Math.max(...sides) >= RESOLVED;
  const equal = resolved && allEqual(sides);
  const count = n === 3 ? 'a triangle' : n === 4 ? 'a four-sided shape' : n === 5 ? 'a pentagon' : n === 6 ? 'a hexagon' : `a shape with ${countWord(n)} corners`;
  if (!resolved) return { shape: count, equal: false, resolved };
  if (n === 3) return { shape: equal ? 'an equilateral triangle' : 'a triangle', equal, resolved };
  // Angles only when every side is long enough to have a known direction.
  const cosines = Math.min(...sides) >= RESOLVED ? cornerCosines(ring) : null;
  if (n === 4 && cosines?.every((c) => Math.abs(c) <= ANGLE_ABS)) return { shape: equal ? 'a square' : 'a rectangle', equal, resolved };
  // Four equal sides make a rhombus, whatever its angles.
  if (n === 4 && equal) return { shape: 'a rhombus', equal, resolved };
  if (n === 6 && equal && cosines?.every((c) => Math.abs(c - cosines[0]!) <= ANGLE_ABS)) return { shape: 'a regular hexagon', equal, resolved };
  return { shape: count, equal, resolved };
}

/**
 * A cut solid's name, from its corners, its faces (each a ring of corner indices in order) and its edges, all
 * unrounded. Four triangles are a tetrahedron and eight an octahedron, regular when every edge is equal; six
 * four-sided faces with right angles throughout are a box, and with equal edges a cube; two triangles or two hexagons
 * joined by equal, parallel edges are a prism; four triangles and four hexagons, the hexagons' planes closing round a
 * tetrahedron, are a tetrahedron with its corners cut off. A cut too small to measure is only counted.
 */
function nameSolid(
  points: readonly (readonly number[])[], faces: readonly (readonly number[])[], edges: readonly { a: number; b: number; length: number }[]
): { shape: string; equal: boolean; resolved: boolean } {
  const V = points.length;
  const F = faces.length;
  const sizes = faces.map((f) => f.length);
  const allSize = (k: number): boolean => sizes.every((s) => s === k);
  const ofSize = (k: number): number => sizes.filter((s) => s === k).length;
  const lengths = edges.map((e) => e.length);
  const resolved = lengths.length > 0 && Math.max(...lengths) >= RESOLVED;
  const equal = resolved && allEqual(lengths);
  const generic = `a solid with ${countWord(V)} corners and ${countWord(F)} faces`;
  if (V === 4 && F === 4 && allSize(3)) return { shape: equal ? 'a regular tetrahedron' : 'a tetrahedron', equal, resolved };
  if (V === 6 && F === 8 && allSize(3)) return { shape: equal ? 'a regular octahedron' : 'an octahedron', equal, resolved };
  // What follows judges angles and directions: only when every edge is long enough to have a known direction.
  if (!resolved || Math.min(...lengths) < RESOLVED) return { shape: generic, equal, resolved };
  const ring = (f: readonly number[]): number[][] => f.map((i) => [...points[i]!]);
  if (V === 8 && F === 6 && allSize(4) && faces.every((f) => cornerCosines(ring(f)).every((c) => Math.abs(c) <= ANGLE_ABS))) {
    return { shape: equal ? 'a cube' : 'a box', equal, resolved };
  }
  /** The edges joining two faces of one size, k: a prism's lateral edges, if they are parallel and equal. */
  const prism = (k: number, quads: number): boolean => {
    if (!(F === quads + 2 && ofSize(k) === 2 && ofSize(4) === quads)) return false;
    const caps = faces.filter((f) => f.length === k);
    const inCap = (i: number): number => caps.findIndex((c) => c.includes(i));
    const lateral = edges.filter((e) => inCap(e.a) !== -1 && inCap(e.b) !== -1 && inCap(e.a) !== inCap(e.b));
    if (lateral.length !== k) return false;
    const dirs = lateral.map((e) => (inCap(e.a) === 0 ? sub3(points[e.b]!, points[e.a]!) : sub3(points[e.a]!, points[e.b]!)));
    return allEqual(lateral.map((e) => e.length))
      && dirs.every((d) => norm3(cross3(d, dirs[0]!)) <= ANGLE_ABS * norm3(d) * norm3(dirs[0]!) && dot3(d, dirs[0]!) > 0);
  };
  if (V === 6 && prism(3, 3)) return { shape: 'a triangular prism', equal, resolved };
  if (V === 12 && prism(6, 6)) return { shape: 'a hexagonal prism', equal, resolved };
  if (V === 12 && F === 8 && ofSize(3) === 4 && ofSize(6) === 4) {
    // The hexagons' outward normals must surround the origin: then their four planes bound a tetrahedron.
    const centre = [0, 1, 2].map((k) => points.reduce((s, p) => s + p[k]!, 0) / V);
    const normals = faces.filter((f) => f.length === 6).map((f) => {
      const r = ring(f);
      const n = cross3(sub3(r[1]!, r[0]!), sub3(r[2]!, r[0]!));
      return dot3(n, sub3(r[0]!, centre)) < 0 ? n.map((x) => -x) : n;
    });
    const [a, b, c, d] = normals as [number[], number[], number[], number[]];
    const det = dot3(a, cross3(b, c));
    if (Math.abs(det) > ANGLE_ABS * norm3(a) * norm3(b) * norm3(c)) {
      // Solve a·x + b·y + c·z = −d by Cramer's rule; all three positive means 0 lies inside their hull.
      const m = d.map((v) => -v);
      const x = dot3(m, cross3(b, c)) / det;
      const y = dot3(a, cross3(m, c)) / det;
      const z = dot3(a, cross3(b, m)) / det;
      if (x > 0 && y > 0 && z > 0) return { shape: 'a tetrahedron with its corners cut off', equal, resolved };
    }
  }
  return { shape: generic, equal, resolved };
}

/** The edge group of a hypercube complex: its 1-cells. */
function edgeGroup(complex: CellComplex): CellGroup {
  const edges = complex.cellsOfDim(1).find((g) => g.verticesPerCell === 2);
  if (edges === undefined) throw new Error('world: the source has no edge group');
  return edges;
}

/**
 * A world: one source, one slice, one pose. `setTip` and `setSlice` change
 * them; everything else is read from the library's result, once per change.
 */
export interface World {
  readonly rung: RungSpec;
  /** The authored source, never mutated. */
  readonly source: CellComplex;
  /** The slice, perpendicular to the missing axis; its offset is the slide. */
  readonly slice: HyperplaneSliceN;
  readonly tip: number;
  readonly offset: number;
  setTip(angle: number): void;
  setSlice(offset: number): void;
  corners(): readonly Corner[];
  /** Where the posed object lies along the missing axis: [lowest, highest]. */
  extent(): readonly [number, number];
  /** The corners grouped by height along the missing axis, lowest first. */
  layers(): readonly Layer[];
  meeting(): Meeting;
  cut(): CutSummary;
  shadow(): Shadow;
  /** The faces (cube) or cells (tesseract) of the source, named and coloured. */
  readonly faces: readonly SourceFace[];
  /** Source edges as vertex index pairs. */
  readonly edges: readonly (readonly [number, number])[];
  /** Every rigid invariant a turn must keep: edge lengths, rounded. For honesty checks. */
  edgeLengths(): readonly number[];
  /** The latest section's own accounting of the cells it examined: how many it cut, and why it cut no more. */
  diagnostics(): SectionSimplexGroupNDiagnosticsN;
}

abstract class BaseWorld implements World {
  readonly slice: HyperplaneSliceN;
  tip = 0;
  offset = 0;
  protected rotation: MatN;
  protected posed: Float64Array;
  readonly edges: readonly (readonly [number, number])[];
  abstract readonly faces: readonly SourceFace[];
  private cachedCorners: Corner[] | null = null;

  constructor(readonly rung: RungSpec, readonly source: CellComplex) {
    this.slice = HyperplaneSliceN.axisAligned(rung.dim, rung.extraAxis, 0);
    this.rotation = tipRotation(rung, 0);
    this.posed = new Float64Array(source.positions.length);
    const edges = edgeGroup(source);
    const list: [number, number][] = [];
    for (let k = 0; k < edges.indices.length; k += 2) list.push([edges.indices[k]!, edges.indices[k + 1]!]);
    this.edges = list;
    this.pose();
  }

  protected pose(): void {
    this.rotation.applyToPositions(this.source.positions, this.posed, this.source.vertexCount);
    this.cachedCorners = null;
  }

  setTip(angle: number): void {
    this.tip = angle;
    this.rotation = tipRotation(this.rung, angle);
    this.pose();
    this.recut();
  }

  setSlice(offset: number): void {
    this.offset = offset;
    this.slice.offset = offset;
    this.cachedCorners = null;
    this.recut();
  }

  protected abstract recut(): void;
  abstract cut(): CutSummary;

  corners(): readonly Corner[] {
    if (this.cachedCorners) return this.cachedCorners;
    const dim = this.rung.dim;
    const out: Corner[] = [];
    for (let v = 0; v < this.source.vertexCount; v++) {
      const posed = Array.from(this.posed.subarray(v * dim, v * dim + dim));
      out.push({
        index: v,
        name: signName(Array.from(this.source.positions.subarray(v * dim, v * dim + dim))),
        posed,
        height: this.slice.signedDistance(posed)
      });
    }
    this.cachedCorners = out;
    return out;
  }

  extent(): readonly [number, number] {
    const heights = this.corners().map((c) => c.posed[this.rung.extraAxis]!);
    return [Math.min(...heights), Math.max(...heights)];
  }

  layers(): readonly Layer[] {
    const axis = this.rung.extraAxis;
    const out: { height: number; corners: number[] }[] = [];
    const sorted = [...this.corners()].sort((p, q) => p.posed[axis]! - q.posed[axis]!);
    for (const c of sorted) {
      const h = c.posed[axis]!;
      const last = out[out.length - 1];
      if (last && Math.abs(h - last.height) <= ON_PLANE_EPSILON) last.corners.push(c.index);
      else out.push({ height: h, corners: [c.index] });
    }
    // A layer within the classification tolerance of a grid value is put on it: the middle is 0, not 1e-16.
    for (const layer of out) {
      const grid = Math.round(layer.height * 10) / 10;
      if (Math.abs(layer.height - grid) <= ON_PLANE_EPSILON) layer.height = grid === 0 ? 0 : grid;
    }
    return out;
  }

  meeting(): Meeting {
    const corners = this.corners();
    const below = corners.filter((c) => c.height < -ON_PLANE_EPSILON);
    const above = corners.filter((c) => c.height > ON_PLANE_EPSILON);
    const on = corners.filter((c) => Math.abs(c.height) <= ON_PLANE_EPSILON);
    if (on.length === 0 && below.length === 0) return { kind: 'apart', side: 'below', gap: Math.min(...above.map((c) => c.height)) };
    if (on.length === 0 && above.length === 0) return { kind: 'apart', side: 'above', gap: -Math.max(...below.map((c) => c.height)) };
    if (below.length > 0 && above.length > 0) return { kind: 'crossing' };
    // Touching: every corner is on the slice or to one side of it.
    const facetSize = 2 ** (this.rung.dim - 1);
    const feature = on.length === 1 ? 'corner' : on.length === 2 ? 'edge'
      : on.length === facetSize ? (this.rung.dim === 3 ? 'face' : 'cell') : 'face';
    const drawn = !this.cut().empty;
    const counts = this.diagnostics();
    return {
      kind: 'touching',
      feature,
      // Which side the OBJECT is on, relative to the slice: below when its other corners are strictly below.
      objectSide: below.length > 0 ? 'below' : 'above',
      onCorners: on.map((c) => c.index),
      drawn,
      undrawn: drawn ? null : counts.collapsedSectionCells > 0 ? 'collapsed' : 'far-side'
    };
  }

  abstract diagnostics(): SectionSimplexGroupNDiagnosticsN;

  shadow(): Shadow {
    const dim = this.rung.dim;
    const points: { at: number[]; corners: number[] }[] = [];
    const projected: number[][] = [];
    for (let v = 0; v < this.source.vertexCount; v++) {
      const chart = this.slice.projectPointToChart(this.posed.subarray(v * dim, v * dim + dim)).coordinates;
      const at = this.slice.embedPoint(chart);
      projected.push(at);
      const same = points.find((p) => p.at.every((x, k) => Math.abs(x - at[k]!) <= ON_PLANE_EPSILON));
      if (same) same.corners.push(v);
      else points.push({ at, corners: [v] });
    }
    return {
      points,
      segments: this.edges.map(([a, b]) => [projected[a]!, projected[b]!] as const),
      edges: this.edges
    };
  }

  edgeLengths(): readonly number[] {
    const dim = this.rung.dim;
    return this.edges.map(([a, b]) => {
      let sum = 0;
      for (let k = 0; k < dim; k++) sum += (this.posed[a * dim + k]! - this.posed[b * dim + k]!) ** 2;
      return round2(Math.sqrt(sum));
    });
  }

  /** The source vertices a cut point lies between, from lineage parents and weights: one corner, or an edge. */
  protected cutCornerOf(parents: readonly number[], weights: readonly number[], at: readonly number[]): CutCorner | null {
    const kept: { v: number; w: number }[] = [];
    parents.forEach((v, k) => { if (weights[k]! > 1e-12) kept.push({ v, w: weights[k]! }); });
    if (kept.length === 1) return { at, on: [kept[0]!.v], along: 0 };
    if (kept.length === 2 && sameEdge(kept[0]!.v, kept[1]!.v, this.source.positions, this.rung.dim)) {
      const [a, b] = kept[0]!.v < kept[1]!.v ? [kept[0]!, kept[1]!] : [kept[1]!, kept[0]!];
      return { at, on: [a.v, b.v], along: b.w };
    }
    return null;
  }
}

/** The plane rung: the authored Flatland cube, posed by the tip, cut by the plane through `section.ts`. */
class PlaneWorld extends BaseWorld {
  readonly faces: readonly SourceFace[];
  private outline: FlatlandOutline | null = null;

  constructor() {
    const flatland = buildFlatlandSource();
    super(PLANE_RUNG, flatland.complex);
    const squares = flatland.complex.cellsOfDim(2).find((g) => g.verticesPerCell === 4);
    if (squares === undefined) throw new Error('world: the cube has no square faces');
    // Names and colours only: `nameCubes` reads each face's fixed coordinate, never its winding.
    this.faces = nameCubes(flatland.complex, squares);
    this.outline = this.cutNow();
  }

  /** The cut of the posed cube, by the pinned module, at the slice's offset. */
  private cutNow(): FlatlandOutline {
    // The posed copy shares every group with the authored cube, including the keyed tetrahedra the cut needs.
    const posed = new CellComplex(3, Float64Array.from(this.posed), this.source.groups.slice());
    return sectionOutline({ complex: posed, normal: [0, 0, 1] }, this.offset);
  }

  protected recut(): void {
    this.outline = this.cutNow();
  }

  diagnostics(): SectionSimplexGroupNDiagnosticsN {
    return this.drawn.result.diagnostics;
  }

  /** The raw outline, for drawing: its triangles in world coordinates are `result.ambientPositions` and `result.cells`. */
  get drawn(): FlatlandOutline {
    if (this.outline === null) this.outline = this.cutNow();
    return this.outline;
  }

  cut(): CutSummary {
    const outline = this.drawn;
    const result = outline.result;
    if (result.cellCount === 0 || outline.ringVertices.length === 0) return EMPTY_CUT;
    // A corner of the polygon is where the plane crosses one of the cube's edges, or meets one of its corners: a ring
    // vertex whose lineage is the two ends of a source edge, or one source corner. The other ring vertices lie on a
    // side: they cross the tetrahedra's inner edges, which run across the cube's faces. Read from the lineage, the
    // count does not depend on how small the cut is, as a test of where the ring turns would.
    const corners: CutCorner[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < outline.ringVertices.length; i++) {
      const provenance = outlineProvenance(outline, i);
      if (provenance === undefined) continue;
      const vertex = outline.ringVertices[i]!;
      const at = [result.ambientPositions[vertex * 3]!, result.ambientPositions[vertex * 3 + 1]!, result.ambientPositions[vertex * 3 + 2]!];
      const corner = this.cutCornerOf(provenance.sourceVertices, provenance.weights, at);
      if (!corner || seen.has(corner.on.join('-'))) continue;
      seen.add(corner.on.join('-'));
      corners.push(corner);
    }
    // Each side lies on one face of the cube: the face whose fixed coordinate both its ends share.
    const edges: CutEdge[] = corners.map((c, i) => {
      const j = (i + 1) % corners.length;
      const next = corners[j]!;
      const parents = [...c.on, ...next.on];
      const face = this.faces.find((f) => parents.every((v) => Math.sign(this.source.positions[v * 3 + f.axis]!) === f.sign));
      return { a: i, b: j, length: Math.hypot(...c.at.map((x, k) => x - next.at[k]!)), on: face ? [face] : [] };
    });
    const edgeLengths = edges.map((e) => e.length);
    const faces: { source: SourceFace; sides: number }[] = [];
    for (const edge of edges) {
      const face = edge.on[0];
      if (!face) continue;
      const entry = faces.find((e) => e.source.ordinal === face.ordinal);
      if (entry) entry.sides += 1; else faces.push({ source: face, sides: 1 });
    }
    const named = namePolygon(corners.map((c) => c.at), edgeLengths);
    return {
      empty: false,
      dimension: 2,
      corners,
      faces,
      edges,
      edgeLengths,
      shape: named.shape,
      equalEdges: named.equal,
      resolved: named.resolved,
      crossedEdges: corners.filter((c) => c.on.length === 2).map((c) => [c.on[0]!, c.on[1]!] as const)
    };
  }
}

/** The space rung: a tesseract, posed by the tip, cut by the three-dimensional slice through `SectionChart3D`. */
class SpaceWorld extends BaseWorld {
  readonly faces: readonly SourceFace[];
  /** The library's render product for the cut: one section evaluation per change, read here and drawn by the stage. */
  readonly chart: SectionChart3D;
  readonly material: MeshStandardMaterial;
  private readonly sourceCellIndices: Uint32Array;

  constructor() {
    const complex = createHypercube({ dim: 4, size: 2 });
    super(SPACE_RUNG, complex);
    const cubes = complex.cellsOfDim(3).find((g) => g.kind === 'cuboid' && g.verticesPerCell === 8);
    if (cubes === undefined) throw new Error('world: the tesseract has no cubic cells');
    this.faces = nameCubes(complex, cubes);
    // Direct call, not the wrapper: the parent cube of every tetrahedron is the identity a face needs.
    const simplexization = simplexizeCuboidGroupN(cubes);
    complex.addGroup(simplexization.simplexGroup);
    this.sourceCellIndices = simplexization.sourceCellIndices;
    // Pushed back a little, so the cut's edges, drawn on its surface, are not lost in it.
    this.material = new MeshStandardMaterial({
      vertexColors: true, side: DoubleSide, roughness: 0.48, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    this.chart = new SectionChart3D(complex, simplexization.simplexGroup, this.slice, { material: this.material });
    this.recut();
  }

  protected recut(): void {
    if (this.chart === undefined) return; // during construction
    this.chart.update(new TransformN(4, this.rotation, new VecN([0, 0, 0, 0])));
  }

  diagnostics(): SectionSimplexGroupNDiagnosticsN {
    return this.chart.section.diagnostics;
  }

  /** The source cube (face) each drawn triangle was cut from, by ordinal. */
  faceOfPrimitive(primitive: number): SourceFace {
    const tetrahedron = this.chart.sourceCellOfPrimitive(primitive);
    return this.faces[this.sourceCellIndices[tetrahedron]!]!;
  }

  cut(): CutSummary {
    const section = this.chart.section;
    if (section.cellCount === 0) return EMPTY_CUT;
    const { lineage, vertexCount } = section;
    // The solid's corners: section vertices whose lineage is a tesseract edge or corner (see the plane rung's cut).
    const corners: CutCorner[] = [];
    const seen = new Set<string>();
    for (let v = 0; v < vertexCount; v++) {
      const from = lineage.offsets[v]!;
      const to = lineage.offsets[v + 1] ?? lineage.sourceVertices.length;
      const parents = Array.from(lineage.sourceVertices.slice(from, to));
      const weights = Array.from(lineage.weights.slice(from, to));
      const at = [section.chartPositions[v * 3]!, section.chartPositions[v * 3 + 1]!, section.chartPositions[v * 3 + 2]!];
      const corner = this.cutCornerOf(parents, weights, at);
      if (!corner || seen.has(corner.on.join('-'))) continue;
      seen.add(corner.on.join('-'));
      corners.push(corner);
    }
    // A face of the cut solid is the cut of one of the tesseract's cells: the cell holding at least three of the cut's
    // corners, all of whose source corners share the cell's fixed coordinate. Counted from the lineage, not by area.
    // A cell lying wholly in the slice is not one of them: the slice meets it in all three dimensions, so it is the
    // cut itself, and its faces are where the cells around it meet the slice.
    const ofCell = (v: number, f: SourceFace): boolean => Math.sign(this.source.positions[v * 4 + f.axis]!) === f.sign;
    const inCell = (c: CutCorner, f: SourceFace): boolean => c.on.every((v) => ofCell(v, f));
    const heights = this.corners().map((c) => c.height);
    const inSlice = (f: SourceFace): boolean => heights.every((h, v) => !ofCell(v, f) || Math.abs(h) <= ON_PLANE_EPSILON);
    const rings: { source: SourceFace; ring: number[] }[] = [];
    for (const source of this.faces) {
      const members = corners.map((c, i) => (inCell(c, source) ? i : -1)).filter((i) => i >= 0);
      if (members.length < 3 || inSlice(source)) continue;
      rings.push({ source, ring: aroundFace(members.map((i) => corners[i]!.at), members) });
    }
    rings.sort((p, q) => p.source.ordinal - q.source.ordinal);
    const faces = rings.map((r) => ({ source: r.source, sides: r.ring.length }));
    // The cut's edges: pairs of corners lying together in two of its faces.
    const edges: CutEdge[] = [];
    for (let i = 0; i < corners.length; i++) {
      for (let j = i + 1; j < corners.length; j++) {
        const shared = rings.filter((r) => r.ring.includes(i) && r.ring.includes(j));
        if (shared.length >= 2) {
          edges.push({ a: i, b: j, length: Math.hypot(...corners[i]!.at.map((x, k) => x - corners[j]!.at[k]!)), on: shared.map((r) => r.source) });
        }
      }
    }
    const edgeLengths = edges.map((e) => e.length);
    const named = nameSolid(corners.map((c) => c.at), rings.map((r) => r.ring), edges);
    return {
      empty: false,
      dimension: 3,
      corners,
      faces,
      edges,
      edgeLengths,
      shape: named.shape,
      equalEdges: named.equal,
      resolved: named.resolved,
      crossedEdges: corners.filter((c) => c.on.length === 2).map((c) => [c.on[0]!, c.on[1]!] as const)
    };
  }
}

/**
 * The corners of one face, in order around it: by angle about their centroid, in the face's own plane. The corners
 * of a convex polygon, seen from its centroid, follow one another in angle.
 */
function aroundFace(points: readonly (readonly number[])[], ids: readonly number[]): number[] {
  const n = points.length;
  const c = [0, 1, 2].map((k) => points.reduce((s, p) => s + p[k]!, 0) / n);
  // The plane's normal, from the farthest pair of corners and the corner farthest from their line.
  const first = points.reduce((p, q) => (norm3(sub3(q, c)) > norm3(sub3(p, c)) ? q : p));
  const e1 = sub3(first, c);
  let normal = [0, 0, 0];
  for (const p of points) {
    const candidate = cross3(e1, sub3(p, c));
    if (norm3(candidate) > norm3(normal)) normal = candidate;
  }
  const e2 = cross3(normal, e1);
  const angle = (p: readonly number[]): number => Math.atan2(dot3(sub3(p, c), e2), dot3(sub3(p, c), e1));
  return ids.map((id, k) => ({ id, a: angle(points[k]!) })).sort((p, q) => p.a - q.a).map((x) => x.id);
}

export type PlaneWorldT = PlaneWorld;
export type SpaceWorldT = SpaceWorld;

/** The cube and its plane: the plane rung. */
export function createPlaneWorld(): PlaneWorld {
  return new PlaneWorld();
}

/** The tesseract and its space: the space rung. */
export function createSpaceWorld(): SpaceWorld {
  return new SpaceWorld();
}
