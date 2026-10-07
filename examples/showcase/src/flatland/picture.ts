import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Group, InstancedMesh, LineDashedMaterial, LineSegments,
  Matrix4, Mesh, MeshBasicMaterial, SphereGeometry, Vector3, type Object3D
} from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { DRAW_ORDER } from './draw-order.js';
import type { Experience, InspectTarget, View } from './journey.js';

/**
 * The picture: three.js objects drawn from the controller's view and the
 * library's own products, with no renderer, so tests can build it and read
 * back exactly what it would draw.
 *
 * ## What is drawn, and from what
 *
 * - **The cut** is the library's section, cell for cell. In the plane rung it
 *   is the triangles of `sectionOutline`'s result, filled, with each side in
 *   the colour of the cube face it lies on. In the space rung it is the
 *   `SectionChart3D` mesh itself, each triangle in the colour of the
 *   tesseract cell it was cut from.
 * - **The shadow** is every source edge, dropped by the slice's own
 *   `projectPointToChart` (`View.shadow`), with a dot where corners land.
 * - **The cube** is drawn only in the plane rung, and only while shown: it is
 *   the outside view the space rung has no equivalent of.
 *
 * Nothing here computes geometry. Every position is read from `View` or from a
 * world's section product.
 *
 * ## Frames
 *
 * Model coordinates are the worlds' own: x, y and z, with the plane rung's
 * missing direction on z. The root turns them so that z is up on screen:
 * three.js (X, Y, Z) = (x, z, −y). In the space rung, z is a direction your
 * space has; the missing direction w is not in the picture at all.
 *
 * ## Draw order
 *
 * `draw-order.ts` explains why the order is fixed and why the cube's faces are
 * the only transparent object: the plane is lines, the cut is opaque. The
 * space rung's shadow is drawn over the cut without a depth test, so a shadow
 * lying exactly on the cut (cell first, through the middle) still shows as a
 * second thing in the same place.
 */

const SLICE = '#f1dfae';
const CUT_FILL = '#ead7a2';
const PLANE_FRAME = '#bcae86';
const PLANE_GRID = '#39372f';
const CUBE_EDGE = '#8a93a6';
const CUBE_EDGE_BELOW = '#454c5c';
const CROSSED = '#f1dfae';
const CROSSED_BELOW = '#8d8160';
const HIGHLIGHT = '#ffffff';
const CORNER = '#c9c6bf';
const CUT_CORNER = '#fffaf0';
const SHADOW = '#b7c4ff';
const SHADOW_POINT = '#dfe6ff';
const DROP = '#4d566c';
const SOLID_EDGE = '#0e1118';

/** Half the side of the plane's drawn square. The plane goes on; the drawing stops. */
export const SHEET_HALF = 2.6;

/** Model coordinates (x, y, z) to three.js: z up, y away. The root applies the same turn to everything inside it. */
export function modelToThree(p: readonly number[]): Vector3 {
  return new Vector3(p[0]!, p[2]!, -p[1]!);
}

const flat = (points: readonly (readonly number[])[]): Float32Array => {
  const out = new Float32Array(points.length * 3);
  points.forEach((p, i) => { out[i * 3] = p[0]!; out[i * 3 + 1] = p[1]!; out[i * 3 + 2] = p[2]!; });
  return out;
};

/** Thick lines, opaque, one colour per segment. Hidden when there is nothing to draw. */
class Lines {
  readonly object: LineSegments2;
  readonly material: LineMaterial;
  private readonly geometry = new LineSegmentsGeometry();

  constructor(width: number, options: { depthTest?: boolean; renderOrder?: number } = {}) {
    this.material = new LineMaterial({ linewidth: width, vertexColors: true, worldUnits: false });
    this.material.depthTest = options.depthTest ?? true;
    this.object = new LineSegments2(this.geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = options.renderOrder ?? 0;
    this.object.visible = false;
  }

  /** Segments as endpoint pairs in model coordinates, each with its colour. */
  set(segments: readonly (readonly [readonly number[], readonly number[]])[], colours: readonly string[]): void {
    if (segments.length === 0) { this.object.visible = false; return; }
    const positions: number[][] = [];
    const rgb: number[] = [];
    const c = new Color();
    segments.forEach(([a, b], i) => {
      positions.push([...a.slice(0, 3)], [...b.slice(0, 3)]);
      c.set(colours[i] ?? colours[0]!);
      rgb.push(c.r, c.g, c.b, c.r, c.g, c.b);
    });
    this.geometry.setPositions(flat(positions));
    this.geometry.setColors(Float32Array.from(rgb));
    this.object.visible = true;
  }

  /** The segments currently drawn, in model coordinates: for tests that read back the picture. */
  drawn(): number[][] {
    if (!this.object.visible) return [];
    const start = this.geometry.getAttribute('instanceStart');
    const end = this.geometry.getAttribute('instanceEnd');
    const out: number[][] = [];
    for (let i = 0; i < start.count; i++) out.push([start.getX(i), start.getY(i), start.getZ(i), end.getX(i), end.getY(i), end.getZ(i)]);
    return out;
  }
}

/** Round dots, opaque, each with its own size and colour. */
class Dots {
  readonly object: InstancedMesh;
  private readonly matrix = new Matrix4();
  private readonly colour = new Color();

  constructor(capacity: number, options: { depthTest?: boolean; renderOrder?: number } = {}) {
    const material = new MeshBasicMaterial({ color: '#ffffff' });
    material.depthTest = options.depthTest ?? true;
    this.object = new InstancedMesh(new SphereGeometry(1, 14, 10), material, capacity);
    this.object.instanceMatrix.setUsage(DynamicDrawUsage);
    this.object.frustumCulled = false;
    this.object.renderOrder = options.renderOrder ?? 0;
    this.object.count = 0;
  }

  set(points: readonly { readonly at: readonly number[]; readonly radius: number; readonly colour: string }[]): void {
    const n = Math.min(points.length, this.object.instanceMatrix.count);
    points.slice(0, n).forEach((p, i) => {
      this.matrix.makeScale(p.radius, p.radius, p.radius).setPosition(p.at[0]!, p.at[1]!, p.at[2]!);
      this.object.setMatrixAt(i, this.matrix);
      this.object.setColorAt(i, this.colour.set(p.colour));
    });
    this.object.count = n;
    this.object.instanceMatrix.needsUpdate = true;
    if (this.object.instanceColor) this.object.instanceColor.needsUpdate = true;
  }

  /** The dots currently drawn: centre and radius, model coordinates. */
  drawn(): { at: number[]; radius: number }[] {
    const out: { at: number[]; radius: number }[] = [];
    const m = new Matrix4();
    const p = new Vector3();
    for (let i = 0; i < this.object.count; i++) {
      this.object.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      out.push({ at: [p.x, p.y, p.z], radius: Math.hypot(m.elements[0]!, m.elements[1]!, m.elements[2]!) });
    }
    return out;
  }
}

/** A pickable point, in model coordinates. */
export interface Pickable {
  readonly target: InspectTarget;
  readonly at: readonly number[];
}

/**
 * Where a name tag may go, in model coordinates, and what it says. `at` lists the places it may sit; the page
 * chooses among them on screen (`placeOn`): the leftmost for the cut, the lowest for the shadow, so a tag sits at
 * the thing's edge and not over its middle, where other things gather.
 */
export interface Anchor {
  readonly id: 'plane' | 'cube' | 'cut' | 'shadow' | 'pile';
  readonly text: string;
  readonly at: readonly (readonly number[])[];
  readonly placeOn: 'only' | 'leftmost' | 'lowest';
}

export interface Picture {
  /** Everything drawn; add it to a scene once. */
  readonly root: Group;
  update(view: View): void;
  /** What a click can pick, nearest first by kind: the cut's corners, then the shadow's points, then the cube's corners. */
  pickables(view: View): readonly Pickable[];
  anchors(view: View): readonly Anchor[];
  /** The canvas size in CSS pixels, which thick lines need to know. */
  setResolution(width: number, height: number): void;
  /** Read back what is drawn, in model coordinates. For tests: the picture's own buffers, not the view's numbers. */
  readonly probe: {
    cutTriangles(): number[][];
    cutSides(): number[][];
    shadowEdges(): number[][];
    shadowPoints(): { at: number[]; radius: number }[];
    cubeEdges(): number[][];
    /** The cube's edges the plane crosses, drawn lit. */
    crossedEdges(): number[][];
    cutCorners(): { at: number[]; radius: number }[];
    highlighted(): number[][];
    /** The ring round a point pointed out, segment by segment. */
    attention(): number[][];
    transparentObjects(): Object3D[];
    renderOrders(): Record<string, number>;
  };
}

export function createPicture(experience: Experience): Picture {
  const plane = experience.worlds.plane;
  const space = experience.worlds.space;

  const root = new Group();
  root.name = 'one-more-direction';
  root.rotation.x = -Math.PI / 2;

  /* ---------- the plane rung ---------- */
  const planeGroup = new Group();
  planeGroup.name = 'plane rung';
  const sheet = new Lines(1.3);
  sheet.object.name = 'the plane';
  sheet.object.renderOrder = DRAW_ORDER.planeFrame;
  {
    const sheetSegments: [number[], number[]][] = [];
    const sheetColours: string[] = [];
    const H = SHEET_HALF;
    const corners = [[-H, -H], [H, -H], [H, H], [-H, H]];
    for (let i = 0; i < 4; i++) {
      sheetSegments.push([[...corners[i]!, 0], [...corners[(i + 1) % 4]!, 0]]);
      sheetColours.push(PLANE_FRAME);
    }
    for (let k = -2; k <= 2; k++) {
      sheetSegments.push([[k, -H, 0], [k, H, 0]], [[-H, k, 0], [H, k, 0]]);
      sheetColours.push(PLANE_GRID, PLANE_GRID);
    }
    sheet.set(sheetSegments, sheetColours);
  }
  const cutGeometry = new BufferGeometry();
  const cutFill = new Mesh(cutGeometry, new MeshBasicMaterial({
    color: CUT_FILL, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
  }));
  cutFill.name = 'the cut';
  cutFill.renderOrder = DRAW_ORDER.section;
  cutFill.frustumCulled = false;
  const cutSides = new Lines(4);
  cutSides.object.name = 'the cut, sides';
  cutSides.object.renderOrder = DRAW_ORDER.section;

  const cubeFacesGeometry = new BufferGeometry();
  const cubeFaces = new Mesh(cubeFacesGeometry, new MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.13, depthWrite: false, side: DoubleSide
  }));
  cubeFaces.name = 'the cube, faces';
  cubeFaces.renderOrder = DRAW_ORDER.cubeFaces;
  cubeFaces.frustumCulled = false;
  const cubeEdges = new Lines(1.6);
  cubeEdges.object.name = 'the cube, edges';
  cubeEdges.object.renderOrder = DRAW_ORDER.cubeEdges;
  const crossed = new Lines(3);
  crossed.object.name = 'the edges the plane crosses';
  crossed.object.renderOrder = DRAW_ORDER.cubeEdges;
  const cubeCorners = new Dots(8);
  cubeCorners.object.name = 'the cube, corners';
  const drops = new LineSegments(new BufferGeometry(), new LineDashedMaterial({ color: DROP, dashSize: 0.08, gapSize: 0.07 }));
  drops.name = 'the light, along the missing direction';
  drops.frustumCulled = false;
  planeGroup.add(sheet.object, cutFill, cutSides.object, cubeFaces, cubeEdges.object, crossed.object, cubeCorners.object, drops);

  /* ---------- the space rung ---------- */
  const spaceGroup = new Group();
  spaceGroup.name = 'space rung';
  const solid = space.chart.object;
  solid.name = 'the cut';
  solid.renderOrder = DRAW_ORDER.section;
  const solidEdges = new Lines(2);
  solidEdges.object.name = 'the cut, edges';
  solidEdges.object.renderOrder = DRAW_ORDER.section;
  spaceGroup.add(solid, solidEdges.object);
  let colourAttribute = new BufferAttribute(new Float32Array(3 * 64), 3);
  colourAttribute.setUsage(DynamicDrawUsage);
  space.chart.geometry.setAttribute('color', colourAttribute);

  /* ---------- both rungs: the cut's corners, the shadow, the highlight ---------- */
  const cutCorners = new Dots(16);
  cutCorners.object.name = 'the cut, corners';
  const cutCornerMaterial = cutCorners.object.material as MeshBasicMaterial;
  const shadowEdges = new Lines(2);
  shadowEdges.object.name = 'the shadow';
  const shadowPoints = new Dots(16);
  const shadowPointMaterial = shadowPoints.object.material as MeshBasicMaterial;
  shadowPoints.object.name = 'the shadow, points';
  const highlight = new Lines(5);
  highlight.object.name = 'what you picked';
  // A point pointed out, not picked: a ring round it, in the slice's colour, and nothing said about what lands there.
  const attention = new Lines(2.5);
  attention.object.name = 'the point pointed out';
  root.add(planeGroup, spaceGroup, cutCorners.object, shadowEdges.object, shadowPoints.object, highlight.object, attention.object);

  const lines = [sheet, cutSides, cubeEdges, crossed, solidEdges, shadowEdges, highlight, attention];

  /** A ring of radius r round a point: in the plane (one circle), or one rung up three crossed circles. */
  const ringAround = (at: readonly number[], spaceRung: boolean): (readonly [number[], number[]])[] => {
    const r = 0.17;
    const n = 40;
    const planes: [number, number][] = spaceRung ? [[0, 1], [1, 2], [0, 2]] : [[0, 1]];
    const out: (readonly [number[], number[]])[] = [];
    for (const [i, j] of planes) {
      for (let k = 0; k < n; k++) {
        const point = (a: number): number[] => { const p = [at[0]!, at[1]!, at[2]!]; p[i] = p[i]! + r * Math.cos(a); p[j] = p[j]! + r * Math.sin(a); return p; };
        out.push([point((2 * Math.PI * k) / n), point((2 * Math.PI * (k + 1)) / n)]);
      }
    }
    return out;
  };

  /** The space rung's mesh, each triangle in the colour of the cell it was cut from: the chart's own layout, mirrored. */
  const colourSolid = (): void => {
    const section = space.chart.section;
    const per = section.verticesPerCell;
    const slots = section.cellCount * per;
    if (slots * 3 > colourAttribute.array.length) {
      let capacity = colourAttribute.array.length / 3;
      while (capacity < slots) capacity *= 2;
      colourAttribute = new BufferAttribute(new Float32Array(capacity * 3), 3);
      colourAttribute.setUsage(DynamicDrawUsage);
      space.chart.geometry.setAttribute('color', colourAttribute);
    }
    const target = colourAttribute.array as Float32Array;
    for (let p = 0; p < section.cellCount; p++) {
      const face = space.faceOfPrimitive(p);
      for (let k = 0; k < per; k++) target.set(face.rgb, (p * per + k) * 3);
    }
    colourAttribute.needsUpdate = true;
  };

  const updatePlane = (view: View): void => {
    // The plane's drawing rides at the slice's height; the cut and the shadow arrive there in world coordinates.
    sheet.object.position.set(0, 0, view.offset);
    // The cut: the section's own triangles, drawn by cell, never by bare vertex.
    const result = plane.drawn.result;
    if (result.cellCount > 0) {
      cutGeometry.setAttribute('position', new BufferAttribute(Float32Array.from(result.ambientPositions), 3));
      cutGeometry.setIndex(new BufferAttribute(Uint32Array.from(result.cells.subarray(0, result.cellCount * 3)), 1));
      cutFill.visible = true;
    } else {
      cutFill.visible = false;
    }
    cutSides.set(
      view.cut.edges.map((e) => [view.cut.corners[e.a]!.at, view.cut.corners[e.b]!.at] as const),
      view.cut.edges.map((e) => e.on[0]?.colour ?? SLICE)
    );
    // The cube, when shown: its faces in their colours, its edges, the ones the plane crosses lit.
    const shown = view.objectShown;
    cubeFaces.visible = shown;
    cubeEdges.object.visible = shown;
    cubeCorners.object.visible = shown;
    if (shown) {
      const positions: number[] = [];
      const colours: number[] = [];
      for (const face of plane.faces) {
        const four = view.corners.filter((c) => Math.sign(plane.source.positions[c.index * 3 + face.axis]!) === face.sign);
        // A quad's corners in order around it: by the signs of the other two coordinates.
        const [b, c] = [0, 1, 2].filter((k) => k !== face.axis) as [number, number];
        const at = (sb: number, sc: number) => four.find((q) => Math.sign(plane.source.positions[q.index * 3 + b]!) === sb && Math.sign(plane.source.positions[q.index * 3 + c]!) === sc)!.posed;
        const quad = [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
        for (const k of [0, 1, 2, 0, 2, 3]) { positions.push(...quad[k]!); colours.push(...face.rgb); }
      }
      cubeFacesGeometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3));
      cubeFacesGeometry.setAttribute('color', new BufferAttribute(Float32Array.from(colours), 3));
      // Each edge is drawn in two parts, split where it meets the plane: the part below is dimmer, so where the plane
      // passes through the cube reads at a glance. The edges the plane crosses are lit: one per corner of the cut.
      const crossing = new Set(view.cut.crossedEdges.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`));
      const split = (edges: readonly (readonly [number, number])[], above: string, below: string) => {
        const segments: (readonly [readonly number[], readonly number[]])[] = [];
        const colours: string[] = [];
        for (const [a, b] of edges) {
          const p = view.corners[a]!.posed;
          const q = view.corners[b]!.posed;
          const [hp, hq] = [p[2]! - view.offset, q[2]! - view.offset];
          if (hp * hq < 0) {
            const t = hp / (hp - hq);
            const m = p.map((x, k) => x + t * (q[k]! - x));
            segments.push([p, m], [m, q]);
            colours.push(hp > 0 ? above : below, hq > 0 ? above : below);
          } else {
            segments.push([p, q]);
            colours.push(hp + hq >= 0 ? above : below);
          }
        }
        return { segments, colours };
      };
      const base = split(plane.edges.filter(([a, b]) => !crossing.has(`${Math.min(a, b)}-${Math.max(a, b)}`)), CUBE_EDGE, CUBE_EDGE_BELOW);
      const lit = split(plane.edges.filter(([a, b]) => crossing.has(`${Math.min(a, b)}-${Math.max(a, b)}`)), CROSSED, CROSSED_BELOW);
      cubeEdges.set(base.segments, base.colours);
      crossed.set(lit.segments, lit.colours);
      const picked = new Set(view.inspection?.corners ?? []);
      cubeCorners.set(view.corners.map((c) => ({ at: c.posed, radius: picked.has(c.index) ? 0.075 : 0.04, colour: picked.has(c.index) ? SLICE : CORNER })));
    } else {
      crossed.object.visible = false;
    }
    // The light: from each corner straight along the missing direction to where it lands.
    if (view.shadowOn) {
      const ends: number[] = [];
      view.shadow.points.forEach((p) => {
        for (const i of p.corners) ends.push(...view.corners[i]!.posed, ...p.at);
      });
      drops.geometry.setAttribute('position', new BufferAttribute(Float32Array.from(ends), 3));
      drops.computeLineDistances();
      drops.visible = shown;
    } else {
      drops.visible = false;
    }
  };

  const updateSpace = (view: View): void => {
    colourSolid();
    solid.visible = space.chart.cellCount > 0;
    solidEdges.set(
      view.cut.edges.map((e) => [view.cut.corners[e.a]!.at, view.cut.corners[e.b]!.at] as const),
      [SOLID_EDGE]
    );
  };

  const updateShared = (view: View): void => {
    const picked = view.inspection?.target ?? null;
    cutCorners.set(view.cut.corners.map((c, i) => {
      const on = picked?.kind === 'cut-corner' && picked.index === i;
      return { at: c.at, radius: on ? 0.08 : 0.045, colour: on ? SLICE : CUT_CORNER };
    }));
    const spaceRung = view.rung === 'space';
    const attended = view.attention?.kind === 'shadow-point' && view.shadowOn ? view.shadow.points[view.attention.index] : undefined;
    if (attended) attention.set(ringAround(attended.at, spaceRung), [SLICE]); else attention.object.visible = false;
    attention.material.depthTest = !spaceRung;
    attention.object.renderOrder = spaceRung ? DRAW_ORDER.shadowOver : DRAW_ORDER.section;
    // In the space rung the shadow is drawn over the cut, without a depth test: a second thing in the same place.
    // The cut solid's corners too, so every corner can be counted, the far ones included.
    const over = spaceRung ? DRAW_ORDER.shadowOver : DRAW_ORDER.section;
    for (const m of [shadowEdges.material, shadowPointMaterial, cutCornerMaterial]) m.depthTest = !spaceRung;
    for (const o of [shadowEdges.object, shadowPoints.object, cutCorners.object]) o.renderOrder = over;
    if (view.shadowOn) {
      shadowEdges.set(view.shadow.segments, [SHADOW]);
      shadowPoints.set(view.shadow.points.map((p, i) => {
        const on = picked?.kind === 'shadow-point' && picked.index === i;
        // A larger dot says several corners land here, unless the question that asks how many is still open.
        const piled = p.corners.length > 1 && !view.withhold;
        return { at: p.at, radius: on ? 0.09 : piled ? 0.07 : 0.045, colour: on ? SLICE : SHADOW_POINT };
      }));
    } else {
      shadowEdges.object.visible = false;
      shadowPoints.set([]);
    }
    // What a pick lights: on the cube, its source edge; one rung up, where the cube is not drawn, that edge's shadow.
    // A point of the shadow lights the light's path to it from every corner that lands there, while the cube is shown.
    if (picked?.kind === 'shadow-point' && !spaceRung && view.objectShown) {
      const point = view.shadow.points[picked.index];
      const paths = (point?.corners ?? []).map((i) => [view.corners[i]!.posed, point!.at] as const);
      if (paths.length > 0) highlight.set(paths, [SLICE]); else highlight.object.visible = false;
      highlight.material.depthTest = true;
      highlight.object.renderOrder = DRAW_ORDER.cubeEdges;
      return;
    }
    const edges = view.inspection?.edges ?? [];
    if (edges.length === 0) { highlight.object.visible = false; return; }
    if (!spaceRung && view.objectShown) {
      highlight.set(edges.map(([a, b]) => [view.corners[a]!.posed, view.corners[b]!.posed] as const), [HIGHLIGHT]);
    } else if (view.shadowOn) {
      const segments = edges.map(([a, b]) => {
        const k = view.shadow.edges.findIndex(([p, q]) => (p === a && q === b) || (p === b && q === a));
        return view.shadow.segments[k]!;
      });
      highlight.set(segments, [HIGHLIGHT]);
    } else {
      highlight.object.visible = false;
    }
    highlight.material.depthTest = !spaceRung;
    highlight.object.renderOrder = spaceRung ? DRAW_ORDER.shadowOver : DRAW_ORDER.cubeEdges;
  };

  const picture: Picture = {
    root,
    update(view: View): void {
      const planeRung = view.rung === 'plane';
      planeGroup.visible = planeRung;
      spaceGroup.visible = !planeRung;
      if (planeRung) updatePlane(view); else updateSpace(view);
      updateShared(view);
    },
    pickables(view: View): readonly Pickable[] {
      const out: Pickable[] = view.cut.corners.map((c, index) => ({ target: { kind: 'cut-corner', index }, at: c.at }));
      if (view.shadowOn) view.shadow.points.forEach((p, index) => out.push({ target: { kind: 'shadow-point', index }, at: p.at }));
      if (view.rung === 'plane' && view.objectShown) view.corners.forEach((c, index) => out.push({ target: { kind: 'corner', index }, at: c.posed }));
      return out;
    },
    anchors(view: View): readonly Anchor[] {
      const out: Anchor[] = [];
      if (view.rung === 'plane') {
        out.push({ id: 'plane', text: 'the plane', at: [[-SHEET_HALF * 0.8, -SHEET_HALF * 0.8, view.offset]], placeOn: 'only' });
        if (view.objectShown) {
          const top = view.corners.reduce((p, q) => (q.posed[2]! > p.posed[2]! ? q : p));
          out.push({ id: 'cube', text: 'the cube', at: [top.posed], placeOn: 'only' });
        }
      }
      if (!view.cut.empty) out.push({ id: 'cut', text: 'the cut', at: view.cut.corners.map((c) => c.at), placeOn: 'leftmost' });
      if (view.shadowOn && view.shadow.points.length > 0) {
        out.push({ id: 'shadow', text: 'the shadow', at: view.shadow.points.map((p) => p.at), placeOn: 'lowest' });
        if (!view.withhold) for (const p of view.shadow.points) if (p.corners.length > 1) out.push({ id: 'pile', text: `×${p.corners.length}`, at: [p.at], placeOn: 'only' });
      }
      return out;
    },
    setResolution(width: number, height: number): void {
      for (const l of lines) l.material.resolution.set(width, height);
    },
    probe: {
      cutTriangles: () => {
        if (!cutFill.visible || !planeGroup.visible) return [];
        const position = cutGeometry.getAttribute('position');
        const index = cutGeometry.getIndex()!;
        const out: number[][] = [];
        for (let t = 0; t < index.count; t += 3) {
          const tri: number[] = [];
          for (let k = 0; k < 3; k++) { const v = index.getX(t + k); tri.push(position.getX(v), position.getY(v), position.getZ(v)); }
          out.push(tri);
        }
        return out;
      },
      cutSides: () => (planeGroup.visible ? cutSides.drawn() : solidEdges.drawn()),
      shadowEdges: () => shadowEdges.drawn(),
      shadowPoints: () => shadowPoints.drawn(),
      cubeEdges: () => (planeGroup.visible && cubeEdges.object.visible ? [...cubeEdges.drawn(), ...crossed.drawn()] : []),
      crossedEdges: () => (planeGroup.visible && crossed.object.visible ? crossed.drawn() : []),
      cutCorners: () => cutCorners.drawn(),
      highlighted: () => highlight.drawn(),
      attention: () => attention.drawn(),
      transparentObjects: () => {
        const out: Object3D[] = [];
        root.traverse((o) => {
          const m = (o as { material?: { transparent?: boolean } | { transparent?: boolean }[] }).material;
          const list = Array.isArray(m) ? m : m ? [m] : [];
          if (list.some((x) => x.transparent)) out.push(o);
        });
        return out;
      },
      renderOrders: () => {
        const out: Record<string, number> = {};
        root.traverse((o) => { if (o.name && o !== root) out[o.name] = o.renderOrder; });
        return out;
      }
    }
  };
  return picture;
}
