import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshStandardMaterial,
  type Material
} from 'three';
import {
  sliceTetrahedra,
  type CellComplex,
  type HyperplaneSlice4,
  type TransformN
} from '@holotope/core';

export interface SlicedComplex3DOptions {
  material?: Material;
}

/**
 * Render product: the exact cross-section of a 4D cell complex with a
 * hyperplane, rendered as a three.js Mesh.
 *
 * The complex must carry tetrahedral 3-cells (run `tetrahedralizeCuboidCells`
 * on cuboid-celled complexes first). Each update transforms the vertices in
 * 4D (Float64 CPU golden path), runs marching tetrahedra against the
 * hyperplane, and uploads the resulting triangle soup expressed in the
 * slice's own display frame.
 *
 * Triangle winding is not globally consistent, so the default material is
 * double-sided; flat normals are recomputed per update.
 */
export class SlicedComplex3D {
  readonly complex: CellComplex;
  readonly slice: HyperplaneSlice4;
  readonly geometry: BufferGeometry;
  readonly object: Mesh;

  private readonly tets: Uint32Array;
  private readonly worldPositions: Float64Array;
  private readonly positionAttribute: BufferAttribute;

  constructor(
    complex: CellComplex,
    slice: HyperplaneSlice4,
    options: SlicedComplex3DOptions = {}
  ) {
    if (complex.ambientDim !== 4) {
      throw new Error(`SlicedComplex3D: requires ambientDim 4, got ${complex.ambientDim}`);
    }
    const tetGroups = complex
      .cellsOfDim(3)
      .filter((g) => g.kind === 'simplex' && g.verticesPerCell === 4);
    if (tetGroups.length === 0) {
      throw new Error(
        'SlicedComplex3D: complex has no tetrahedral 3-cells — call tetrahedralizeCuboidCells(complex) first'
      );
    }
    this.complex = complex;
    this.slice = slice;

    let tetIndexLength = 0;
    for (const g of tetGroups) tetIndexLength += g.indices.length;
    this.tets = new Uint32Array(tetIndexLength);
    let offset = 0;
    for (const g of tetGroups) {
      this.tets.set(g.indices, offset);
      offset += g.indices.length;
    }

    this.worldPositions = new Float64Array(complex.positions.length);
    const maxVertices = (this.tets.length / 4) * 6; // 2 triangles per tetra worst case
    this.positionAttribute = new BufferAttribute(new Float32Array(maxVertices * 3), 3);
    this.positionAttribute.setUsage(DynamicDrawUsage);

    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', this.positionAttribute);
    this.geometry.setAttribute(
      'normal',
      new BufferAttribute(new Float32Array(maxVertices * 3), 3).setUsage(DynamicDrawUsage)
    );

    const material =
      options.material ??
      new MeshStandardMaterial({ color: 0xff9d5c, side: DoubleSide, flatShading: true });
    this.object = new Mesh(this.geometry, material);
    this.object.frustumCulled = false; // section changes every update

    this.update();
  }

  /**
   * Recomputes the cross-section. Call whenever the 4D transform, the slice
   * offset/normal, or the source positions change.
   */
  update(transform?: TransformN): void {
    const count = this.complex.vertexCount;
    if (transform) {
      transform.applyToPositions(this.complex.positions, this.worldPositions, count);
    } else {
      this.worldPositions.set(this.complex.positions);
    }
    const vertexCount = sliceTetrahedra(
      this.worldPositions,
      this.tets,
      this.slice,
      this.positionAttribute.array as Float32Array
    );
    this.geometry.setDrawRange(0, vertexCount);
    this.positionAttribute.needsUpdate = true;
    if (vertexCount > 0) this.computeFlatNormals(vertexCount);
  }

  /** Per-face normals over the active draw range only. */
  private computeFlatNormals(vertexCount: number): void {
    const positions = this.positionAttribute.array as Float32Array;
    const normalAttribute = this.geometry.getAttribute('normal') as BufferAttribute;
    const normals = normalAttribute.array as Float32Array;
    for (let t = 0; t < vertexCount; t += 3) {
      const o = t * 3;
      const ux = positions[o + 3]! - positions[o]!;
      const uy = positions[o + 4]! - positions[o + 1]!;
      const uz = positions[o + 5]! - positions[o + 2]!;
      const vx = positions[o + 6]! - positions[o]!;
      const vy = positions[o + 7]! - positions[o + 1]!;
      const vz = positions[o + 8]! - positions[o + 2]!;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len > 0) {
        nx /= len;
        ny /= len;
        nz /= len;
      }
      for (let v = 0; v < 3; v++) {
        normals[o + v * 3] = nx;
        normals[o + v * 3 + 1] = ny;
        normals[o + v * 3 + 2] = nz;
      }
    }
    normalAttribute.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    const material = this.object.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material.dispose();
  }
}
