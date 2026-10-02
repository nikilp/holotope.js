import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments } from 'three';
import type { CellComplex } from '@holotope/core';
import type { ChartProjection } from '../spatial-4d-turn/context.js';

/**
 * One source face, followed across representations.
 *
 * In the slice, a triangle is coloured by the source cube it was cut from —
 * the library's `sourceCellOfPrimitive` lineage, read by the section modules.
 * In the shadow, the same cube is its own edges: the complex's 1-cells whose
 * two endpoints are both among that cube's eight vertices, projected by the
 * very map the shadow draws with. Nothing here guesses adjacency from
 * positions; membership is read from the complex's own index lists.
 *
 * Overlap in the shadow is not identity: two projected edges can cross on
 * screen while belonging to faces that never meet in four dimensions. The
 * highlight therefore draws exactly one face's edges, never "what is under the
 * pointer".
 */

/** The source edges of one cube of the complex: pairs of vertex indices, from the complex's own 1-cells. */
export function faceEdges(complex: CellComplex, cubeOrdinal: number): [number, number][] {
  const cubes = complex.cellsOfDim(3).find((g) => g.kind === 'cuboid' && g.verticesPerCell === 8);
  const edges = complex.cellsOfDim(1).find((g) => g.verticesPerCell === 2);
  if (!cubes || !edges) return [];
  const members = new Set<number>();
  for (let k = 0; k < 8; k++) members.add(cubes.indices[cubeOrdinal * 8 + k]!);
  const out: [number, number][] = [];
  for (let e = 0; e < edges.indices.length; e += 2) {
    const a = edges.indices[e]!;
    const b = edges.indices[e + 1]!;
    if (members.has(a) && members.has(b)) out.push([a, b]);
  }
  return out;
}

/** A highlight of one face's shadow: its edges, projected by the shadow's own map. */
export class FaceShadow {
  readonly object: LineSegments;
  private readonly geometry = new BufferGeometry();
  private readonly material: LineBasicMaterial;
  private edges: [number, number][] = [];

  constructor(private readonly complex: CellComplex, private readonly projection: ChartProjection) {
    this.material = new LineBasicMaterial({ color: '#f1dfae', transparent: true, opacity: 0.95, depthWrite: false });
    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array(12 * 2 * 3), 3));
    this.object = new LineSegments(this.geometry, this.material);
    this.object.name = 'shadow:face-highlight';
    this.object.visible = false;
    this.object.renderOrder = 3;
  }

  /** Show one face (by cube ordinal), or none. */
  show(cubeOrdinal: number | null, colour: string | null): void {
    if (cubeOrdinal === null) { this.object.visible = false; this.edges = []; return; }
    this.edges = faceEdges(this.complex, cubeOrdinal);
    if (colour) this.material.color.set(colour);
    this.update();
    this.object.visible = true;
  }

  /** Re-project after the slice moved: the same map, the same source vertices. */
  update(): void {
    const position = this.geometry.getAttribute('position') as BufferAttribute;
    this.edges.forEach(([a, b], i) => {
      const pa = this.projection.projectPoint(this.complex.getPosition(a));
      const pb = this.projection.projectPoint(this.complex.getPosition(b));
      position.setXYZ(i * 2, pa[0], pa[1], pa[2]);
      position.setXYZ(i * 2 + 1, pb[0], pb[1], pb[2]);
    });
    this.geometry.setDrawRange(0, this.edges.length * 2);
    position.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  /** The highlighted edges' projected endpoints, as drawn — for verification. */
  drawnEndpoints(): number[][] {
    const position = this.geometry.getAttribute('position') as BufferAttribute;
    const out: number[][] = [];
    for (let i = 0; i < this.edges.length * 2; i++) out.push([position.getX(i), position.getY(i), position.getZ(i)]);
    return out;
  }

  /** The source vertex pairs currently drawn. */
  sourceEdges(): readonly (readonly [number, number])[] {
    return this.edges;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
