import {
  Rotor4,
  TransformN,
  VecN,
  createHyperrectangle,
  simplexizeCuboidGroupN,
  type CellComplex,
  type CellGroup,
  type HyperplaneSliceN
} from '@holotope/core';
import { sectionOfGlome4 } from '@holotope/physics';
import {
  SectionChart3D, representationHitFromSectionChart, type RepresentationIntersection3D
} from '@holotope/three';
import {
  BufferAttribute, DoubleSide, DynamicDrawUsage, Group, Mesh, MeshStandardMaterial,
  SphereGeometry, type Object3D
} from 'three';
import { nameCubes, type SourceFace } from './faces.js';
import { TURN_PLANE, positionAt, type GlomeObject, type HyperboxObject, type SceneObject } from './scene.js';

/**
 * Cutting the scene, once per update, by one hyperplane.
 *
 * ## Who computes the geometry
 *
 * The block's every drawn vertex comes from `SectionChart3D`, which poses the
 * authored complex with a `TransformN` and calls the library's own sectioner.
 * This module hands over the complex and the pose and reads the result back. It
 * does not transform a vertex, intersect an edge, or build a triangle.
 *
 * ## Who says which face a triangle came from
 *
 * The library, twice over. `simplexizeCuboidGroupN` is called directly rather
 * than through the `tetrahedralizeCuboidCells` wrapper because the wrapper
 * drops `sourceCellIndices` — the parent cube of every tetrahedron — and that
 * is exactly the provenance a face identity needs. `sourceCellOfPrimitive` then
 * names the tetrahedron each drawn triangle was cut from. Composing the two is
 * a table lookup; the colour on a face is the only thing added here.
 *
 * ## Persistent identity versus transient vertices
 *
 * The eight faces exist before any section and outlive every one. A cut vertex
 * exists only while the hyperplane crosses an edge OF THE SIMPLEXIZED MESH —
 * one of the block's 32 edges, or one of the diagonals the tetrahedralization
 * adds inside its squares and cubes (at the reference, 8 of the 26 lie on
 * block edges and 18 on diagonals) — and the set changes with the cut. The
 * count is a property of the display mesh, not of the block, and the product
 * reports both so the two are never confused.
 *
 * ## The companion
 *
 * `sectionOfGlome4` returns an EXACT chart centre and radius; a ball is not a
 * cell complex, so no library code turns those into a surface, and the sphere
 * on screen is a display tessellation of exact numbers. Exact tangency is the
 * library's own status at its DEFAULT tolerance, drawn as the library's tangent
 * point, marked. `GRAZE_EPSILON` (below) is a presentation band on the reported
 * distance and is never passed to the classifier.
 *
 * ## One evaluation each
 *
 * Exactly one section per object per update. Status, solid and readout are the
 * same evaluation. An object outside the hyperplane keeps its place, its name
 * and its colour and reports `outside`, with how far; it is never removed. An
 * object the hyperplane merely touches reports `tangent` and says what is not
 * drawn and why — an empty mesh is not the same statement as a miss (found in
 * review, at the block's −w face).
 */

export type SectionStatus = 'present' | 'tangent' | 'outside';

/**
 * The sectioner's default classification tolerance: `|signedDistance| <= 1e-9`
 * counts as on the hyperplane, and on-plane counts as non-negative
 * (`sectionSimplexGroupN`, option `epsilon`). Mirrored here so the corner
 * classification below agrees with the surface the library did or did not
 * emit; it is not passed anywhere.
 */
export const ON_PLANE_EPSILON = 1e-9;

/**
 * The block's corners against the slice, from the library's `signedDistance`
 * of each source vertex: how many lie strictly below, strictly above and on
 * the hyperplane, the signed distance of the nearest corner, and the source
 * 3-face lying wholly on the hyperplane if one does.
 *
 * This is what tells an empty section apart from a miss. The sectioner emits a
 * surface only for cells with a vertex strictly below the plane, so a slice
 * lying exactly on a face draws nothing from one side and the face from the
 * other; the corners say which situation an empty mesh is.
 */
export interface BlockBoundary {
  readonly on: number;
  readonly below: number;
  readonly above: number;
  readonly nearest: number;
  readonly face: SourceFace | null;
}

/**
 * How close to the ball's edge the slice must pass for the ball to be drawn
 * hollow and called grazing.
 *
 * A PRESENTATION band on the library's reported distance, not a tolerance
 * handed to the classifier: `sectionOfGlome4` runs at its default epsilon, so
 * what is drawn is always the exact section — a ball of the exact radius, or
 * nothing. The band only decides how that exact section is drawn (hollow) and
 * whether, when there is no section at all, the nearest touching point is shown
 * so a near miss is visible as a near miss. At this value the hollow ball can be
 * as large as `√(2rε − ε²)` in section radius; the readout says so.
 */
export const GRAZE_EPSILON = 0.02;

export interface PickResult {
  readonly id: string;
  readonly name: string;
  /** The source 3-face the picked triangle was cut from; null for the companion. */
  readonly face: SourceFace | null;
}

export interface SectionProduct {
  readonly id: string;
  readonly name: string;
  readonly colour: string;
  readonly object: Object3D;
  readonly status: SectionStatus;
  readonly surface: 'exact-section' | 'display-tessellation';
  readonly signedDistance: number | null;
  readonly primitiveCount: number;
  /**
   * PRESENTATION flag: the slice is within GRAZE_EPSILON of this body's edge.
   * Not a membership decision — `status` is the library's word on that — but a
   * band on a library-reported distance, used only to draw the body hollow and
   * say "at the border". False for bodies where "edge" has no single distance.
   */
  readonly grazing: boolean;
  /** Persistent source faces, in ordinal order; empty for a body with none. */
  readonly faces: readonly SourceFace[];
  /** Ordinals of the faces the current section actually cuts. */
  readonly presentFaces: ReadonlySet<number>;
  /**
   * The cut faces of the two turn-plane families, by name — the faces the
   * explanation may name, and no others. Both empty for a body without faces.
   */
  boundingFamilies(): { readonly first: readonly string[]; readonly second: readonly string[] };
  /** Distinct cut vertices in the current section — transient by nature. */
  readonly cutVertexCount: number;
  /** The body's corners against the slice; null for a body without corners. */
  readonly boundary: BlockBoundary | null;
  /**
   * The authored complex this body is cut from — the object that exists in
   * R4, read live by the section AND by the projection context, so the two
   * pictures come from one source. Null for a body that is not a complex.
   */
  readonly complex: CellComplex | null;
  /** The authored radius of a ball; null for a body without one. */
  readonly sourceRadius: number | null;
  /**
   * Which source EDGES the current section cuts, one key per cut vertex, from
   * the library's affine lineage. This is what makes a cut vertex transient:
   * the count can hold steady across a turn while the set of edges it stands
   * on changes entirely. Empty for a body with no complex.
   */
  cutEdges(): readonly string[];
  /** One sentence saying WHY the readout shows what it shows, from the product's own numbers. */
  explain(): string;
  /** For a body on a stated path: move it to this phase. Others ignore it. */
  setPhase(phase: number): void;
  /** The body's current 4D position, where it has one point that names it. */
  position4(): readonly number[] | null;
  update(slice: HyperplaneSliceN): void;
  pick(intersection: RepresentationIntersection3D): PickResult | null;
  dispose(): void;
}

class BoxSection implements SectionProduct {
  readonly object: Object3D;
  readonly surface = 'exact-section' as const;
  readonly signedDistance = null;
  readonly grazing = false;
  readonly faces: readonly SourceFace[];
  status: SectionStatus = 'outside';
  primitiveCount = 0;
  cutVertexCount = 0;
  presentFaces: ReadonlySet<number> = new Set();
  boundary: BlockBoundary = { on: 0, below: 0, above: 0, nearest: 0, face: null };
  readonly sourceRadius = null;
  readonly complex: CellComplex;
  private readonly chart: SectionChart3D;
  private readonly cubes: CellGroup;
  /** `tan θ = h_j / h_i` as text, from the authored half-extents. */
  private readonly ratioText: string;
  /** The centred transition angle in degrees, two decimals, derived not typed. */
  private readonly transitionDeg: string;
  private readonly material: MeshStandardMaterial;
  private readonly pose: TransformN;
  private readonly sourceCellIndices: Uint32Array;
  private colourAttribute: BufferAttribute;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly colour: string,
    halfExtents: readonly number[],
    slice: HyperplaneSliceN
  ) {
    const complex = createHyperrectangle({
      dim: 4,
      edgeLengths: Array.from(halfExtents, (h) => h * 2),
      maxCellDimension: 3
    });
    const cubes = complex.cellsOfDim(3)
      .find((g: CellGroup) => g.kind === 'cuboid' && g.verticesPerCell === 8);
    if (cubes === undefined) throw new Error(`${id}: no cubic 3-cell group to section`);
    this.faces = nameCubes(complex, cubes);
    this.complex = complex;
    this.cubes = cubes;
    // The centred transition the explanations speak of — where the turn-plane
    // families trade places, tan θ = h_j / h_i — is derived from the authored
    // half-extents, never typed: a typed "36.05°" was wrong (found in review;
    // atan(1.6/2.2) is 36.03°).
    const hi = halfExtents[TURN_PLANE.i]!;
    const hj = halfExtents[TURN_PLANE.j]!;
    this.ratioText = `${hj}/${hi}`;
    this.transitionDeg = ((Math.atan(hj / hi) * 180) / Math.PI).toFixed(2);

    // Direct call, not the wrapper: we need the parent-cube ordinal of every
    // tetrahedron, which the wrapper is documented to discard.
    const simplexization = simplexizeCuboidGroupN(cubes);
    complex.addGroup(simplexization.simplexGroup);
    this.sourceCellIndices = simplexization.sourceCellIndices;

    this.material = new MeshStandardMaterial({
      vertexColors: true, side: DoubleSide, roughness: 0.5, metalness: 0.04
    });
    this.chart = new SectionChart3D(
      complex, simplexization.simplexGroup, slice, { material: this.material }
    );
    this.object = this.chart.object;
    this.colourAttribute = new BufferAttribute(new Float32Array(3 * 64), 3);
    this.colourAttribute.setUsage(DynamicDrawUsage);
    this.chart.geometry.setAttribute('color', this.colourAttribute);
    // Authored at the origin in its own axes, and it stays there.
    this.pose = new TransformN(4, Rotor4.identity(), new VecN([0, 0, 0, 0]));
  }

  setPhase(_phase: number): void { /* the block never moves */ }
  position4(): readonly number[] | null { return null; }

  boundingFamilies(): { readonly first: readonly string[]; readonly second: readonly string[] } {
    // Negative end first, then positive, so a pair reads "−x and +x".
    const present = this.faces
      .filter((f) => this.presentFaces.has(f.ordinal))
      .sort((a, b) => a.sign - b.sign);
    return {
      first: present.filter((f) => f.axis === TURN_PLANE.i).map((f) => f.name),
      second: present.filter((f) => f.axis === TURN_PLANE.j).map((f) => f.name)
    };
  }

  explain(): string {
    // Only faces the section actually cuts are named. "Both x ends and both w
    // ends" was said whenever one of each family was present (found in review);
    // off-centre, one face of a family is the usual case. The sentence is scoped
    // to the x and w families, and the OTHER cut faces are named from the
    // complete set, so nothing implies the x and w faces are the only ones cut
    // (found in review: the y and z ends bound every one of these cuts).
    const { first: xs, second: ws } = this.boundingFamilies();
    const hasX = xs.length > 0;
    const hasW = ws.length > 0;
    const others = this.faces
      .filter((f) => this.presentFaces.has(f.ordinal) && f.axis !== TURN_PLANE.i && f.axis !== TURN_PLANE.j)
      .sort((a, b) => a.axis - b.axis || a.sign - b.sign)
      .map((f) => f.name);
    const list = (faces: readonly string[]): string => {
      const names = faces.length > 1
        ? `${faces.slice(0, -1).join(', ')} and ${faces[faces.length - 1]}`
        : faces[0] ?? '';
      return `${names} ${faces.length > 1 ? 'ends' : 'end'}`;
    };
    const alsoOthers = others.length > 0 ? ` Its ${list(others)} bound it as well.` : '';
    // Both turn directions: the families trade places where |tan θ| = h_w / h_x,
    // at about ±36.03°. That is the mathematical transition; what the sectioner
    // emits exactly there is its boundary convention, said separately below.
    const transition = `|tan θ| = ${this.ratioText}, at about ±${this.transitionDeg}°`;
    const b = this.boundary;
    if (this.status === 'outside') {
      return `The slice clears the block: its nearest corner is ${Math.abs(b.nearest).toFixed(2)} away, on the `
        + `${b.nearest > 0 ? 'side the normal points to' : 'side opposite the normal'}.`;
    }
    if (this.status === 'tangent') {
      const where = b.face ? `on its ${b.face.name} face`
        : b.on >= 4 ? 'along one of its square faces' : b.on === 2 ? 'along one of its edges' : 'at one of its corners';
      return `The slice touches the block ${where}: ${b.on} of its 16 corners lie on the slice and the rest to one `
        + 'side. Nothing is drawn — the sectioner emits a surface only for cells the slice passes strictly through, '
        + 'and by its tie-break a point on the slice counts as the far side — but the intersection is not empty. '
        + 'Move the offset inward and the surface appears.';
    }
    if (b.face) {
      return `The slice lies exactly on the block’s ${b.face.name} face; what is drawn is that face’s boundary. `
        + 'By the sectioner’s tie-break a point on the slice counts as the far side, so from this side the cells '
        + 'just inside are sectioned and the face is drawn; from the other side nothing would be.';
    }
    if (hasX && !hasW) {
      return `Of its x and w ends, this section cuts the block’s ${list(xs)} (red); the w ends are not reached, `
        + `lying along the direction the slice does not yet lean into.${alsoOthers} Centred, the w ends take `
        + `over from the x ends where ${transition}.`;
    }
    if (hasW && !hasX) {
      return `Of its x and w ends, this section cuts the block’s ${list(ws)} (gold); the x ends lie outside the `
        + `slice, and what was hidden along w is what bounds it.${alsoOthers} Centred, that is the far side of `
        + `the transition where ${transition}.`;
    }
    if (hasX && hasW) {
      return `Of its x and w ends, this section cuts the block’s ${list(xs)} (red) and its ${list(ws)} (gold).`
        + `${alsoOthers} Centred, the two families trade places where ${transition}; exactly there both can meet `
        + 'the plane, and which faces the sectioner emits depends on its tie-break. With an offset, a mix like '
        + 'this holds over a range of angles.';
    }
    return others.length > 0
      ? `No x or w end is cut; its ${list(others)} bound it.`
      : 'No bounding face is cut.';
  }

  cutEdges(): readonly string[] {
    const { lineage, vertexCount } = this.chart.section;
    const keys: string[] = [];
    for (let v = 0; v < vertexCount; v++) {
      const from = lineage.offsets[v]!;
      const to = lineage.offsets[v + 1] ?? lineage.sourceVertices.length;
      keys.push(Array.from(lineage.sourceVertices.subarray(from, to)).sort((a, b) => a - b).join('-'));
    }
    return keys.sort();
  }

  /** The cube a rendered primitive was cut from, by two library lookups. */
  private faceOfPrimitive(primitive: number): SourceFace {
    const tetrahedron = this.chart.sourceCellOfPrimitive(primitive);
    const cube = this.sourceCellIndices[tetrahedron];
    if (cube === undefined) throw new Error(`${this.id}: tetrahedron ${tetrahedron} has no parent`);
    return this.faces[cube]!;
  }

  /**
   * Every corner's signed distance, by the library, once per update. The block
   * is posed at the origin with the identity rotor, so the complex's stored
   * positions ARE its world positions; a block that moved would need the pose
   * applied first.
   */
  private classifyCorners(slice: HyperplaneSliceN): BlockBoundary {
    const point = new Float64Array(this.complex.ambientDim);
    const onPlane = new Set<number>();
    let below = 0;
    let above = 0;
    let nearest = Number.POSITIVE_INFINITY;
    for (let v = 0; v < this.complex.vertexCount; v++) {
      const d = slice.signedDistance(this.complex.getPosition(v, point));
      if (Math.abs(d) <= ON_PLANE_EPSILON) onPlane.add(v);
      else if (d < 0) below++;
      else above++;
      if (Math.abs(d) < Math.abs(nearest)) nearest = d;
    }
    let face: SourceFace | null = null;
    const per = this.cubes.verticesPerCell;
    if (onPlane.size >= per) {
      for (const candidate of this.faces) {
        let whole = true;
        for (let k = 0; k < per; k++) {
          if (!onPlane.has(this.cubes.indices[candidate.ordinal * per + k]!)) { whole = false; break; }
        }
        if (whole) { face = candidate; break; }
      }
    }
    return { on: onPlane.size, below, above, nearest, face };
  }

  update(slice: HyperplaneSliceN): void {
    this.chart.update(this.pose);
    const section = this.chart.section;
    this.primitiveCount = section.cellCount;
    this.cutVertexCount = section.vertexCount;
    this.boundary = this.classifyCorners(slice);
    // Present when the sectioner emitted a surface. Otherwise the corners say
    // whether the hyperplane touches the block — along a face, an edge or at a
    // corner, with nothing drawn by the sectioner's tie-break — or clears it.
    this.status = this.primitiveCount > 0 ? 'present' : this.boundary.on > 0 ? 'tangent' : 'outside';
    this.object.visible = this.primitiveCount > 0;

    // Colour every vertex slot by its primitive's source face. The chart lays
    // primitives out contiguously, `verticesPerCell` slots each, and sets the
    // draw range; the colour buffer mirrors that layout and nothing else.
    const per = section.verticesPerCell;
    const slots = this.primitiveCount * per;
    if (slots * 3 > this.colourAttribute.array.length) {
      let capacity = this.colourAttribute.array.length / 3;
      while (capacity < slots) capacity *= 2;
      this.colourAttribute = new BufferAttribute(new Float32Array(capacity * 3), 3);
      this.colourAttribute.setUsage(DynamicDrawUsage);
      this.chart.geometry.setAttribute('color', this.colourAttribute);
    }
    const target = this.colourAttribute.array as Float32Array;
    const present = new Set<number>();
    for (let p = 0; p < this.primitiveCount; p++) {
      const face = this.faceOfPrimitive(p);
      present.add(face.ordinal);
      for (let k = 0; k < per; k++) {
        const slot = (p * per + k) * 3;
        target[slot] = face.rgb[0];
        target[slot + 1] = face.rgb[1];
        target[slot + 2] = face.rgb[2];
      }
    }
    this.colourAttribute.needsUpdate = true;
    this.presentFaces = present;
  }

  pick(intersection: RepresentationIntersection3D): PickResult | null {
    if (this.primitiveCount === 0) return null;
    const hit = representationHitFromSectionChart(this.chart, intersection);
    if (hit.source.kind !== 'cell') return null;
    const cube = this.sourceCellIndices[hit.source.cellIndex];
    const face = cube === undefined ? null : this.faces[cube] ?? null;
    return { id: this.id, name: this.name, face };
  }

  dispose(): void {
    this.chart.dispose();
    this.material.dispose();
  }
}

class GlomeSection implements SectionProduct {
  readonly object: Object3D;
  readonly surface = 'display-tessellation' as const;
  readonly faces: readonly SourceFace[] = [];
  readonly presentFaces: ReadonlySet<number> = new Set();
  readonly cutVertexCount = 0;
  readonly boundary = null;
  readonly complex = null;
  readonly sourceRadius: number;
  status: SectionStatus = 'outside';
  grazing = false;
  primitiveCount = 0;
  signedDistance: number | null = null;
  cutEdges(): readonly string[] { return []; }
  boundingFamilies(): { readonly first: readonly string[]; readonly second: readonly string[] } {
    return { first: [], second: [] };
  }
  private sectionRadius = 0;
  private readonly ball: Mesh;
  private readonly touch: Mesh;
  private readonly solidMaterial: MeshStandardMaterial;
  private readonly hollowMaterial: MeshStandardMaterial;
  private phase = 0;
  private readonly radius: number;

  constructor(private readonly glome: GlomeObject) {
    this.radius = glome.radius;
    this.sourceRadius = glome.radius;
    this.solidMaterial = new MeshStandardMaterial({
      color: glome.colour, side: DoubleSide, roughness: 0.5, metalness: 0.04
    });
    // Hollow: the same ball, drawn without its surface, which is the reader's
    // own reading of "at the border" — kept, and made exact.
    this.hollowMaterial = new MeshStandardMaterial({ color: glome.colour, wireframe: true });
    this.ball = new Mesh(new SphereGeometry(1, 32, 20), this.solidMaterial);
    // The nearest touching point, for a near miss: the slice has no section of
    // the ball, and drawing one would be a lie, but where it WOULD touch is a
    // library fact (the foot of the perpendicular from the centre), shown small.
    this.touch = new Mesh(new SphereGeometry(0.05, 10, 8), this.hollowMaterial);
    this.ball.visible = false;
    this.touch.visible = false;
    const group = new Group();
    group.add(this.ball, this.touch);
    this.object = group;
  }

  get id(): string { return this.glome.id; }
  get name(): string { return this.glome.name; }
  get colour(): string { return this.glome.colour; }

  setPhase(phase: number): void { this.phase = phase; }
  position4(): readonly number[] { return positionAt(this.glome, this.phase); }

  explain(): string {
    const d = Math.abs(this.signedDistance ?? 0);
    const r = this.radius;
    const inside = r - d;
    if (this.status === 'present') {
      const edge = this.grazing
        ? ` That is within ${GRAZE_EPSILON} of the edge, so the ball is drawn hollow.`
        : '';
      return `The slice passes ${d.toFixed(2)} from the ball’s centre, ${inside.toFixed(2)} inside `
        + `its radius ${r}: the cut is a ball of radius ${this.sectionRadius.toFixed(2)}.${edge}`;
    }
    if (this.status === 'tangent') {
      return `The slice touches the ball at exactly one point, ${d.toFixed(4)} from its centre.`;
    }
    if (this.grazing) {
      return `The slice passes ${d.toFixed(2)} from the ball’s centre — ${(-inside).toFixed(2)} outside `
        + `its radius ${r}. There is no cut; the small marker is where the slice would first touch.`;
    }
    return `The slice passes ${d.toFixed(2)} from the ball’s centre; its radius is ${r}. `
      + `Missed by ${(-inside).toFixed(2)}, so the ball is not in this cut at all — that is a `
      + `fact about where the slice is, not about the block.`;
  }

  update(slice: HyperplaneSliceN): void {
    // The pose at this phase, then the default tolerance: what comes back is
    // the exact section of the exact pose, or none.
    const centre = this.position4();
    const pose = new TransformN(4, Rotor4.identity(), new VecN(centre));
    const section = sectionOfGlome4({ kind: 'glome', radius: this.radius }, { slice, pose });
    const d = 'signedDistance' in section
      ? section.signedDistance
      : slice.signedDistance(centre);
    this.signedDistance = d;
    this.grazing = Math.abs(Math.abs(d) - this.radius) <= GRAZE_EPSILON;

    if (section.status === 'ball') {
      this.status = 'present';
      this.primitiveCount = 1;
      this.sectionRadius = section.radius;
      this.ball.visible = true;
      this.touch.visible = false;
      this.ball.material = this.grazing ? this.hollowMaterial : this.solidMaterial;
      this.ball.scale.setScalar(section.radius);
      this.ball.position.set(
        section.chartCenter[0] ?? 0, section.chartCenter[1] ?? 0, section.chartCenter[2] ?? 0
      );
      return;
    }
    this.sectionRadius = 0;
    this.primitiveCount = 0;
    this.ball.visible = false;
    if (section.status === 'tangent') {
      this.status = 'tangent';
      this.touch.visible = true;
      this.touch.position.set(
        section.chartPositions[0] ?? 0, section.chartPositions[1] ?? 0, section.chartPositions[2] ?? 0
      );
      return;
    }
    this.status = 'outside';
    if (this.grazing) {
      const foot = slice.projectPointToChart(centre);
      this.touch.visible = true;
      this.touch.position.set(
        foot.coordinates[0] ?? 0, foot.coordinates[1] ?? 0, foot.coordinates[2] ?? 0
      );
    } else {
      this.touch.visible = false;
    }
  }

  pick(_intersection: RepresentationIntersection3D): PickResult | null {
    return this.ball.visible || this.touch.visible
      ? { id: this.id, name: this.name, face: null } : null;
  }

  dispose(): void {
    this.ball.geometry.dispose();
    this.touch.geometry.dispose();
    this.solidMaterial.dispose();
    this.hollowMaterial.dispose();
  }
}

export function createProducts(
  scene: readonly SceneObject[],
  slice: HyperplaneSliceN
): SectionProduct[] {
  return scene.map((object) => {
    if (object.kind === 'hyperbox') {
      const box = object as HyperboxObject;
      return new BoxSection(box.id, box.name, box.colour, box.halfExtents, slice);
    }
    return new GlomeSection(object as GlomeObject);
  });
}

export function grazeRadiusOf(radius: number): number {
  return Math.sqrt(2 * radius * GRAZE_EPSILON - GRAZE_EPSILON ** 2);
}
