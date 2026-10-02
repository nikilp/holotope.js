import type { CellComplex, DisplayMap3D, HyperplaneSliceN } from '@holotope/core';
import { ProjectedEdges3D } from '@holotope/three';
import {
  BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineLoop, type Object3D
} from 'three';
import type { SectionProduct } from './section.js';

/**
 * Projection context: the whole objects, projected into the knife's chart.
 *
 * ## What it is
 *
 * The chart the section is drawn in is an orthonormal basis of the hyperplane.
 * `HyperplaneSliceN.projectPointToChart` maps ANY point of R4 to its three
 * coordinates in that basis and drops the fourth, the point's signed distance
 * from the hyperplane. Applied to the whole block, that is the block's
 * orthographic projection along the knife's normal, expressed in the very
 * frame the section uses — so the two sit in one picture with no alignment
 * step to get wrong. The offset does not enter this map: sliding the knife
 * moves the cut and leaves the projection where it was. Turning the knife
 * changes both, in their shared frame.
 *
 * ## What it is not
 *
 * - Not the outline of the projected solid. It is the projection of the
 *   block's EDGES; edges that land inside the silhouette are drawn as well.
 * - Not evidence of contact. Two projections can overlap while the objects
 *   lie far apart along the normal.
 * - Not "every cut at once". The union of the sections over ALL offsets is
 *   the projection, but the offset slider reaches only ±1.6, and with the
 *   knife turned some corners need more than that before the cut reaches them.
 *
 * ## Who computes what
 *
 * Every projected coordinate is the library's: `ProjectedEdges3D` drives the
 * chart projection through {@link ChartProjection}, an adapter whose two
 * methods do nothing but call `projectPointToChart`. The ball's projected
 * extent is a ball of the SOURCE radius at the projected centre — the one
 * closed-form fact this module states rather than computes (an orthogonal
 * projection of a ball is a ball of the same radius); its circles are display
 * tessellation, like the sphere the section draws. Nothing here rotates,
 * slices, or builds a hull.
 *
 * ## Where it lives
 *
 * On its own root, never under a product's object, so the section picker —
 * which walks the products' meshes — cannot report a context line as a hit on
 * the cut. Toggling it changes one `visible` flag and nothing else.
 */

/** The knife's chart as a display map. Every coordinate is `projectPointToChart`'s. */
export class ChartProjection implements DisplayMap3D {
  readonly fromDim: number;

  constructor(private readonly slice: HyperplaneSliceN) {
    this.fromDim = slice.ambientDim;
  }

  projectPoint(p: ArrayLike<number>): [number, number, number] {
    const { coordinates } = this.slice.projectPointToChart(p);
    return [coordinates[0]!, coordinates[1]!, coordinates[2]!];
  }

  projectPositions(src: Float64Array, count: number, dst: Float32Array): void {
    const n = this.fromDim;
    for (let i = 0; i < count; i++) {
      const { coordinates } = this.slice.projectPointToChart(src.subarray(i * n, (i + 1) * n));
      dst[i * 3] = coordinates[0]!;
      dst[i * 3 + 1] = coordinates[1]!;
      dst[i * 3 + 2] = coordinates[2]!;
    }
  }
}

/** The block's edges, projected: the library's render product on the SAME complex the section is cut from. */
export class BlockContext {
  readonly object: Object3D;
  private readonly edges: ProjectedEdges3D;
  private readonly material: LineBasicMaterial;

  constructor(readonly complex: CellComplex, projection: ChartProjection, colour: string) {
    this.material = new LineBasicMaterial({ color: colour, transparent: true, opacity: 0.4, depthWrite: false });
    this.edges = new ProjectedEdges3D(complex, projection, { material: this.material });
    this.object = this.edges.object;
    this.object.name = 'projection-context:block-edges';
  }

  /** Re-project after the knife moved. The block is posed at the origin with the identity rotor, so no transform is passed. */
  update(): void {
    this.edges.update();
  }

  /** Projected source edges in the live buffer — 32 for a hyperbox, whatever the section emitted. */
  edgeCount(): number {
    return this.edges.geometry.getIndex()!.count / 2;
  }

  /** The projected source vertices, chart coordinates, from the live buffer. */
  vertexPositions(): number[][] {
    const position = this.edges.geometry.getAttribute('position');
    const out: number[][] = [];
    for (let i = 0; i < this.complex.vertexCount; i++) out.push([position.getX(i), position.getY(i), position.getZ(i)]);
    return out;
  }

  dispose(): void {
    this.edges.dispose();
  }
}

/** The ball's projected extent: a ball of the source radius at the projected centre, drawn as three circles. */
export class BallContext {
  readonly object: Group;
  private readonly geometry: BufferGeometry;
  private readonly material: LineBasicMaterial;
  private centre: [number, number, number] = [0, 0, 0];

  constructor(readonly radius: number, colour: string) {
    this.material = new LineBasicMaterial({ color: colour, transparent: true, opacity: 0.55, depthWrite: false });
    const segments = 64;
    const points: number[] = [];
    for (let k = 0; k < segments; k++) {
      const a = (2 * Math.PI * k) / segments;
      points.push(Math.cos(a), Math.sin(a), 0);
    }
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
    const xy = new LineLoop(this.geometry, this.material);
    const yz = new LineLoop(this.geometry, this.material);
    yz.rotation.y = Math.PI / 2;
    const zx = new LineLoop(this.geometry, this.material);
    zx.rotation.x = Math.PI / 2;
    this.object = new Group();
    this.object.add(xy, yz, zx);
    // The projected extent of a ball is a ball of the same radius: the source
    // radius, unchanged by the knife's pose or by the offset.
    this.object.scale.setScalar(radius);
    this.object.name = 'projection-context:ball-extent';
  }

  update(slice: HyperplaneSliceN, centre4: readonly number[]): void {
    const { coordinates } = slice.projectPointToChart(centre4);
    this.centre = [coordinates[0]!, coordinates[1]!, coordinates[2]!];
    this.object.position.set(this.centre[0], this.centre[1], this.centre[2]);
  }

  chartCentre(): readonly number[] {
    return this.centre;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** The toggleable layer: one root, the block's edges and the ball's extent, following the knife and the path. */
export class ContextLayer {
  readonly object = new Group();
  readonly projection: ChartProjection;
  readonly block: BlockContext | null;
  readonly ball: BallContext | null;
  private readonly mover: SectionProduct | null;

  constructor(products: readonly SectionProduct[], private readonly slice: HyperplaneSliceN) {
    this.projection = new ChartProjection(slice);
    const withComplex = products.find((p) => p.complex !== null) ?? null;
    this.block = withComplex === null ? null : new BlockContext(withComplex.complex!, this.projection, withComplex.colour);
    this.mover = products.find((p) => p.sourceRadius !== null) ?? null;
    this.ball = this.mover === null ? null : new BallContext(this.mover.sourceRadius!, this.mover.colour);
    this.object.name = 'projection-context';
    if (this.block) this.object.add(this.block.object);
    if (this.ball) this.object.add(this.ball.object);
    this.object.visible = false;
  }

  /** Follow the knife and the path. Called from the page's update, whether or not the layer is shown. */
  update(): void {
    this.block?.update();
    if (this.ball && this.mover) {
      const centre = this.mover.position4();
      if (centre) this.ball.update(this.slice, centre);
    }
  }

  /** Show or hide. Touches this root's `visible` flag and nothing else. */
  setVisible(on: boolean): void {
    this.object.visible = on;
  }

  get visible(): boolean {
    return this.object.visible;
  }

  /** What the faint geometry is, and what it is not — from the layer's own numbers. */
  describe(): string {
    const parts: string[] = [];
    if (this.block) {
      parts.push(`Faint lines in the block’s colour: its ${this.block.edgeCount()} edges, projected along the knife’s `
        + 'normal into this same chart — the projection of the edges, not the outline of the projected solid.');
    }
    if (this.ball) {
      parts.push(`Faint circles in the ball’s colour: its projected extent, a ball of its own radius ${this.ball.radius} `
        + 'at its projected centre, shown whether or not the knife cuts it.');
    }
    parts.push('Neither moves when the offset changes; both turn with the knife. Overlap here is not contact in 4D, '
      + 'and the offset slider does not reach every cut that would fill this projection.');
    return parts.join(' ');
  }

  dispose(): void {
    this.block?.dispose();
    this.ball?.dispose();
  }
}
