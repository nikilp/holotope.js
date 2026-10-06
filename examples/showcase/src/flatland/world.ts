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
  /** Rounded to centimetres. */
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
  /** Their lengths, rounded to centimetres, in the same order. */
  readonly edgeLengths: readonly number[];
  /** A measured name: "a square", "a hexagon", "an octahedron"... or a count when nothing simpler is true. */
  readonly shape: string;
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
    if (outline.sides === 0 || result.cellCount === 0) {
      return { empty: true, dimension: null, corners: [], faces: [], edges: [], edgeLengths: [], shape: 'nothing', crossedEdges: [] };
    }
    // A corner of the polygon is where its ring turns; subdivision points on a side are not.
    const ring = outline.ring;
    const turning: number[] = [];
    for (let i = 0; i < ring.length; i++) {
      const before = ring[(i - 1 + ring.length) % ring.length]!;
      const at = ring[i]!;
      const after = ring[(i + 1) % ring.length]!;
      const cross = (at[0] - before[0]) * (after[1] - at[1]) - (at[1] - before[1]) * (after[0] - at[0]);
      const scale = Math.hypot(at[0] - before[0], at[1] - before[1]) * Math.hypot(after[0] - at[0], after[1] - at[1]);
      if (scale > 1e-12 && Math.abs(cross / scale) > 1e-7) turning.push(i);
    }
    const corners: CutCorner[] = [];
    for (const i of turning) {
      const provenance = outlineProvenance(outline, i);
      if (provenance === undefined) continue;
      const vertex = outline.ringVertices[i]!;
      const at = [result.ambientPositions[vertex * 3]!, result.ambientPositions[vertex * 3 + 1]!, result.ambientPositions[vertex * 3 + 2]!];
      const corner = this.cutCornerOf(provenance.sourceVertices, provenance.weights, at);
      if (corner) corners.push(corner);
    }
    // Each side lies on one face of the cube: the face whose fixed coordinate both its ends share.
    const edges: CutEdge[] = corners.map((c, i) => {
      const j = (i + 1) % corners.length;
      const next = corners[j]!;
      const parents = [...c.on, ...next.on];
      const face = this.faces.find((f) => parents.every((v) => Math.sign(this.source.positions[v * 3 + f.axis]!) === f.sign));
      return { a: i, b: j, length: round2(Math.hypot(...c.at.map((x, k) => x - next.at[k]!))), on: face ? [face] : [] };
    });
    const edgeLengths = edges.map((e) => e.length);
    const faces: { source: SourceFace; sides: number }[] = [];
    for (const edge of edges) {
      const face = edge.on[0];
      if (!face) continue;
      const entry = faces.find((e) => e.source.ordinal === face.ordinal);
      if (entry) entry.sides += 1; else faces.push({ source: face, sides: 1 });
    }
    return {
      empty: false,
      dimension: 2,
      corners,
      faces,
      edges,
      edgeLengths,
      shape: planeShapeName(outline, edgeLengths, corners),
      crossedEdges: corners.filter((c) => c.on.length === 2).map((c) => [c.on[0]!, c.on[1]!] as const)
    };
  }
}

/** A measured name for a cut polygon. `outline.shape` is the pinned module's own count-based name. */
function planeShapeName(outline: FlatlandOutline, sides: readonly number[], corners: readonly CutCorner[]): string {
  const n = corners.length;
  const equal = sides.every((s) => Math.abs(s - sides[0]!) < 0.011);
  if (n === 3) return equal ? 'an equilateral triangle' : 'a triangle';
  if (n === 4) {
    const right = corners.every((c, i) => {
      const a = corners[(i - 1 + n) % n]!.at;
      const b = corners[(i + 1) % n]!.at;
      const u = c.at.map((x, k) => a[k]! - x);
      const v = c.at.map((x, k) => b[k]! - x);
      return Math.abs(u.reduce((s, x, k) => s + x * v[k]!, 0)) < 1e-6;
    });
    if (right) return equal ? 'a square' : 'a rectangle';
    return 'a four-sided shape';
  }
  if (n === 6) return equal ? 'a regular hexagon' : 'a hexagon';
  if (n === 5) return 'a pentagon';
  // Anything else is said as the pinned module counts it.
  return outline.shape;
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
    if (section.cellCount === 0) {
      return { empty: true, dimension: null, corners: [], faces: [], edges: [], edgeLengths: [], shape: 'nothing', crossedEdges: [] };
    }
    const { lineage, vertexCount } = section;
    const corners: CutCorner[] = [];
    for (let v = 0; v < vertexCount; v++) {
      const from = lineage.offsets[v]!;
      const to = lineage.offsets[v + 1] ?? lineage.sourceVertices.length;
      const parents = Array.from(lineage.sourceVertices.slice(from, to));
      const weights = Array.from(lineage.weights.slice(from, to));
      const at = [section.chartPositions[v * 3]!, section.chartPositions[v * 3 + 1]!, section.chartPositions[v * 3 + 2]!];
      const corner = this.cutCornerOf(parents, weights, at);
      if (corner && !corners.some((c) => c.at.every((x, k) => Math.abs(x - at[k]!) <= 1e-9))) corners.push(corner);
    }
    // A face of the cut solid is the cut of one source cube, with its area: zero-area slivers are not faces.
    const area = new Map<number, number>();
    for (let p = 0; p < section.cellCount; p++) {
      const face = this.faceOfPrimitive(p);
      const [a, b, c] = [section.cells[p * 3]!, section.cells[p * 3 + 1]!, section.cells[p * 3 + 2]!];
      const P = (i: number): number[] => [section.chartPositions[i * 3]!, section.chartPositions[i * 3 + 1]!, section.chartPositions[i * 3 + 2]!];
      const u = P(b).map((x, k) => x - P(a)[k]!);
      const w = P(c).map((x, k) => x - P(a)[k]!);
      const cross = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
      area.set(face.ordinal, (area.get(face.ordinal) ?? 0) + Math.hypot(...cross) / 2);
    }
    const faces: { source: SourceFace; sides: number }[] = [];
    for (const [ordinal, a] of area) {
      if (a <= 1e-9) continue;
      const source = this.faces[ordinal]!;
      // The face's corners are the cut's corners lying in that cube: all their source corners share its fixed coordinate.
      const sides = corners.filter((c) => c.on.every((v) => Math.sign(this.source.positions[v * 4 + source.axis]!) === source.sign)).length;
      faces.push({ source, sides });
    }
    faces.sort((p, q) => p.source.ordinal - q.source.ordinal);
    // The cut's edges: pairs of corners lying together in two of its faces.
    const edges: CutEdge[] = [];
    for (let i = 0; i < corners.length; i++) {
      for (let j = i + 1; j < corners.length; j++) {
        const shared = faces.filter((f) => [corners[i]!, corners[j]!].every((c) => c.on.every((v) => Math.sign(this.source.positions[v * 4 + f.source.axis]!) === f.source.sign)));
        if (shared.length >= 2) {
          edges.push({ a: i, b: j, length: round2(Math.hypot(...corners[i]!.at.map((x, k) => x - corners[j]!.at[k]!))), on: shared.map((f) => f.source) });
        }
      }
    }
    const edgeLengths = edges.map((e) => e.length);
    return {
      empty: false,
      dimension: 3,
      corners,
      faces,
      edges,
      edgeLengths,
      shape: spaceShapeName(corners.length, faces, edgeLengths),
      crossedEdges: corners.filter((c) => c.on.length === 2).map((c) => [c.on[0]!, c.on[1]!] as const)
    };
  }
}

/** A measured name for a cut solid, from its counted corners and faces. Nothing is named that was not counted. */
function spaceShapeName(corners: number, faces: readonly { readonly sides: number }[], edges: readonly number[]): string {
  const F = faces.length;
  const sides = faces.map((f) => f.sides).sort((a, b) => a - b);
  const equal = edges.length > 0 && edges.every((e) => Math.abs(e - edges[0]!) < 0.011);
  const all = (n: number): boolean => sides.every((s) => s === n);
  if (corners === 8 && F === 6 && all(4)) return equal ? 'a cube' : 'a box';
  if (corners === 4 && F === 4 && all(3)) return equal ? 'a regular tetrahedron' : 'a tetrahedron';
  if (corners === 6 && F === 8 && all(3)) return equal ? 'a regular octahedron' : 'an octahedron';
  if (corners === 6 && F === 5 && sides.filter((s) => s === 3).length === 2) return 'a triangular prism';
  if (corners === 12 && F === 8 && sides.filter((s) => s === 6).length === 2 && sides.filter((s) => s === 4).length === 6) {
    return 'a hexagonal prism';
  }
  if (corners === 12 && F === 8 && sides.filter((s) => s === 3).length === 4 && sides.filter((s) => s === 6).length === 4) {
    return 'a tetrahedron with its corners cut off';
  }
  return `a solid with ${corners} corners and ${F} faces`;
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
