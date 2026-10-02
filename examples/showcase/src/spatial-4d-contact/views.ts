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
import { ProjectedEdges3D, SectionChart3D } from '@holotope/three';
import {
  BufferAttribute, DoubleSide, DynamicDrawUsage, Group, LineBasicMaterial, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, SphereGeometry, type Object3D
} from 'three';
import { nameCubes, type SourceFace } from '../spatial-4d-turn/faces.js';
import { BallContext, ChartProjection } from '../spatial-4d-turn/context.js';
import { BALL, BOX, type ContactReport, type ContactSimulation } from './simulation.js';

/**
 * Three views of ONE authoritative simulation state — the bodies in R4, their
 * exact sections, and their projected context — for the interaction demo.
 *
 * Every view reads the simulation and writes nothing back: poses come from
 * `sim.boxPose()` (the collider's synced world transform, the same object the
 * contact query sees) and `sim.ball.position`. The section products are the
 * turn demo's construction repeated for a MOVING body — `SectionChart3D.update`
 * is given the pose every frame instead of the identity — so the two
 * experiments share the library calls and the face naming (`nameCubes`) but no
 * state. The context reuses the turn demo's `ChartProjection` adapter and
 * `BallContext` as they are.
 *
 * ## Labels
 *
 * A body's section is `present` (the sectioner emitted a surface), `tangent`
 * (corners of the box lie on the hyperplane but nothing was emitted — the same
 * disclosure the turn demo accepted), or `outside`. The projected contact
 * marker lives in the CONTEXT group only and carries its own signed distance
 * from the section: a projected point is not a point of the current cut.
 */

export type SectionStatus = 'present' | 'tangent' | 'outside';

/**
 * The sectioner's default classification tolerance, mirrored as in the turn
 * demo. It is also the predicate for "in this cut": a point is in the current
 * section when |signed distance| ≤ this, never when a rounded number displays
 * as 0.00.
 */
export const ON_PLANE_EPSILON = 1e-9;

export const inCut = (signedDistance: number): boolean => Math.abs(signedDistance) <= ON_PLANE_EPSILON;

export class BoxSectionView {
  readonly object: Object3D;
  readonly complex: CellComplex;
  readonly faces: readonly SourceFace[];
  status: SectionStatus = 'outside';
  primitiveCount = 0;
  cutVertexCount = 0;
  presentFaces: ReadonlySet<number> = new Set();
  cornersOnPlane = 0;
  nearestCorner = 0;
  private readonly chart: SectionChart3D;
  private readonly cubes: CellGroup;
  private readonly material: MeshStandardMaterial;
  private readonly sourceCellIndices: Uint32Array;
  private colourAttribute: BufferAttribute;
  private readonly corner = new VecN(4);

  constructor(slice: HyperplaneSliceN) {
    this.complex = createHyperrectangle({
      dim: 4,
      edgeLengths: Array.from(BOX.halfExtents, (h) => h * 2),
      maxCellDimension: 3
    });
    const cubes = this.complex.cellsOfDim(3).find((g) => g.kind === 'cuboid' && g.verticesPerCell === 8);
    if (cubes === undefined) throw new Error('BoxSectionView: no cubic 3-cell group to section');
    this.cubes = cubes;
    this.faces = nameCubes(this.complex, cubes);
    const simplexization = simplexizeCuboidGroupN(cubes);
    this.complex.addGroup(simplexization.simplexGroup);
    this.sourceCellIndices = simplexization.sourceCellIndices;
    this.material = new MeshStandardMaterial({ vertexColors: true, side: DoubleSide, roughness: 0.5, metalness: 0.04 });
    this.chart = new SectionChart3D(this.complex, simplexization.simplexGroup, slice, { material: this.material });
    this.object = this.chart.object;
    this.object.name = 'section:box';
    this.colourAttribute = new BufferAttribute(new Float32Array(3 * 64), 3);
    this.colourAttribute.setUsage(DynamicDrawUsage);
    this.chart.geometry.setAttribute('color', this.colourAttribute);
  }

  /** Re-section at the body's current pose, recolour by source face, classify the corners. */
  update(slice: HyperplaneSliceN, pose: TransformN): void {
    this.chart.update(pose);
    const section = this.chart.section;
    this.primitiveCount = section.cellCount;
    this.cutVertexCount = section.vertexCount;
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
      const cube = this.sourceCellIndices[this.chart.sourceCellOfPrimitive(p)]!;
      const face = this.faces[cube]!;
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

    // Corners against the hyperplane, at the posed positions, by the library's signed distance.
    let on = 0;
    let nearest = Number.POSITIVE_INFINITY;
    for (let v = 0; v < this.complex.vertexCount; v++) {
      const source = this.complex.getPosition(v);
      for (let c = 0; c < 4; c++) this.corner.data[c] = source[c]!;
      const world = pose.applyToPoint(this.corner);
      const d = slice.signedDistance(world.data);
      if (Math.abs(d) <= ON_PLANE_EPSILON) on++;
      if (Math.abs(d) < Math.abs(nearest)) nearest = d;
    }
    this.cornersOnPlane = on;
    this.nearestCorner = nearest;
    this.status = this.primitiveCount > 0 ? 'present' : on > 0 ? 'tangent' : 'outside';
    this.object.visible = this.primitiveCount > 0;
  }

  dispose(): void {
    this.chart.dispose();
    this.material.dispose();
  }
}

export class BallSectionView {
  readonly object: Group;
  status: SectionStatus = 'outside';
  primitiveCount = 0;
  signedDistance = 0;
  sectionRadius = 0;
  private readonly ball: Mesh;
  private readonly touch: Mesh;
  private readonly solid: MeshStandardMaterial;
  private readonly markerMaterial: MeshBasicMaterial;

  constructor() {
    this.solid = new MeshStandardMaterial({ color: BALL.colour, side: DoubleSide, roughness: 0.5, metalness: 0.04 });
    this.markerMaterial = new MeshBasicMaterial({ color: BALL.colour, wireframe: true });
    this.ball = new Mesh(new SphereGeometry(1, 32, 20), this.solid);
    this.touch = new Mesh(new SphereGeometry(0.05, 10, 8), this.markerMaterial);
    this.ball.visible = false;
    this.touch.visible = false;
    this.object = new Group();
    this.object.add(this.ball, this.touch);
    this.object.name = 'section:ball';
  }

  /** The exact section of the ball at its current centre, from the library, or nothing. */
  update(slice: HyperplaneSliceN, centre: readonly number[]): void {
    const pose = new TransformN(4, Rotor4.identity(), new VecN(centre));
    const section = sectionOfGlome4({ kind: 'glome', radius: BALL.radius }, { slice, pose });
    this.signedDistance = 'signedDistance' in section ? section.signedDistance : slice.signedDistance(centre);
    if (section.status === 'ball') {
      this.status = 'present';
      this.primitiveCount = 1;
      this.sectionRadius = section.radius;
      this.ball.visible = true;
      this.touch.visible = false;
      this.ball.scale.setScalar(section.radius);
      this.ball.position.set(section.chartCenter[0] ?? 0, section.chartCenter[1] ?? 0, section.chartCenter[2] ?? 0);
      return;
    }
    this.primitiveCount = 0;
    this.sectionRadius = 0;
    this.ball.visible = false;
    if (section.status === 'tangent') {
      this.status = 'tangent';
      this.touch.visible = true;
      this.touch.position.set(section.chartPositions[0] ?? 0, section.chartPositions[1] ?? 0, section.chartPositions[2] ?? 0);
      return;
    }
    this.status = 'outside';
    this.touch.visible = false;
  }

  dispose(): void {
    this.ball.geometry.dispose();
    this.touch.geometry.dispose();
    this.solid.dispose();
    this.markerMaterial.dispose();
  }
}

/**
 * Projection context for the moving scene: the box's edges at its current
 * pose, the ball's extent at its current centre, and — when the last step had a
 * contact — the contact point PROJECTED into the chart, labelled with its own
 * signed distance from the section. Own root; off by default.
 */
export class ContactContextView {
  readonly object = new Group();
  readonly projection: ChartProjection;
  readonly ball: BallContext;
  /** Signed distance of the projected contact point from the current section; null when none is shown. */
  contactSignedDistance: number | null = null;
  private readonly edges: ProjectedEdges3D;
  private readonly edgeMaterial: LineBasicMaterial;
  private readonly marker: Mesh;
  private readonly markerMaterial: MeshBasicMaterial;

  constructor(complex: CellComplex, slice: HyperplaneSliceN) {
    this.projection = new ChartProjection(slice);
    this.edgeMaterial = new LineBasicMaterial({ color: BOX.colour, transparent: true, opacity: 0.4, depthWrite: false });
    this.edges = new ProjectedEdges3D(complex, this.projection, { material: this.edgeMaterial });
    this.edges.object.name = 'context:box-edges';
    this.ball = new BallContext(BALL.radius, BALL.colour);
    this.markerMaterial = new MeshBasicMaterial({ color: '#f4f1ea', transparent: true, opacity: 0.85 });
    this.marker = new Mesh(new SphereGeometry(0.06, 12, 8), this.markerMaterial);
    this.marker.name = 'context:projected-contact-point';
    this.marker.visible = false;
    this.object.name = 'projection-context';
    this.object.add(this.edges.object, this.ball.object, this.marker);
    this.object.visible = false;
  }

  update(slice: HyperplaneSliceN, boxPose: TransformN, ballCentre: readonly number[], contact: ContactReport | null): void {
    this.edges.update(boxPose);
    this.ball.update(slice, ballCentre);
    if (contact?.pointOnBox) {
      const projected = slice.projectPointToChart(contact.pointOnBox);
      this.marker.position.set(projected.coordinates[0]!, projected.coordinates[1]!, projected.coordinates[2]!);
      this.marker.visible = true;
      this.contactSignedDistance = projected.signedDistance;
    } else {
      this.marker.visible = false;
      this.contactSignedDistance = null;
    }
  }

  /** Whether the shown contact point lies in the current cut, by the geometric predicate; null when none is shown. */
  contactInCut(): boolean | null {
    return this.contactSignedDistance === null ? null : inCut(this.contactSignedDistance);
  }

  edgeCount(): number {
    return this.edges.geometry.getIndex()!.count / 2;
  }

  vertexPositions(): number[][] {
    const position = this.edges.geometry.getAttribute('position');
    const out: number[][] = [];
    for (let i = 0; i < this.edges.complex.vertexCount; i++) out.push([position.getX(i), position.getY(i), position.getZ(i)]);
    return out;
  }

  setVisible(on: boolean): void {
    this.object.visible = on;
  }

  get visible(): boolean {
    return this.object.visible;
  }

  describe(): string {
    // In-cut or not is the geometric predicate on the exact signed distance,
    // never a reading of the rounded number (found in review: the sentence
    // once hung on "unless that reads 0").
    const marker = this.contactSignedDistance === null
      ? ''
      : ` The small pale sphere is the last contact point PROJECTED into this chart. Its own signed distance from the `
        + `section is ${this.contactSignedDistance.toFixed(2)}: ${inCut(this.contactSignedDistance)
          ? 'it lies in the current cut' : 'it is not a point of the current cut'}.`;
    return `Faint lines in the box’s colour: its ${this.edgeCount()} edges at its current pose, projected along the knife’s normal `
      + 'into this same chart — the projection of the edges, not the outline of the projected solid. Faint circles in the '
      + `ball’s colour: its projected extent, radius ${BALL.radius} at its projected centre, shown whether or not the knife `
      + 'cuts it. Overlap here is not contact in 4D; the readout gives the true gap along the contact normal. The offset '
      + `slider does not reach every cut that would fill this projection.${marker}`;
  }

  dispose(): void {
    this.edges.dispose();
    this.edgeMaterial.dispose();
    this.ball.dispose();
    this.marker.geometry.dispose();
    this.markerMaterial.dispose();
  }
}

/** All three views over one simulation, updated together from its state. */
export class SceneViews {
  readonly box: BoxSectionView;
  readonly ball: BallSectionView;
  readonly context: ContactContextView;

  constructor(private readonly slice: HyperplaneSliceN) {
    this.box = new BoxSectionView(slice);
    this.ball = new BallSectionView();
    this.context = new ContactContextView(this.box.complex, slice);
  }

  /** Read the simulation; write only the views. */
  update(sim: ContactSimulation, lastContact: ContactReport | null): void {
    const boxPose = sim.boxPose();
    const ballCentre = Array.from(sim.ball.position.data);
    this.box.update(this.slice, boxPose);
    this.ball.update(this.slice, ballCentre);
    this.context.update(this.slice, boxPose, ballCentre, lastContact);
  }

  dispose(): void {
    this.box.dispose();
    this.ball.dispose();
    this.context.dispose();
  }
}
