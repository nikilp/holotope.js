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
  sliceTetrahedraAmbient,
  type CellComplex,
  type HyperplaneSlice4,
  type Projection,
  type TransformN
} from '@holotope/core';

export interface SlicedComplex3DOptions {
  material?: Material;
  /**
   * When set, the section is rendered **through this projection** — the
   * same 3D space as `ProjectedEdges3D` output — instead of the slice's
   * own display frame. Use it to overlay the cut inside a projected
   * wireframe of the same object.
   */
  projection?: Projection;
  /**
   * Per-cell coloring: hex color for each source tetrahedron, refreshed
   * from provenance after every remarch. Map tets to the polytope's own
   * cells (e.g. `Math.floor(tet / tetsPerCell)`) to paint the section as
   * an assembly of cells. Requires a material with `vertexColors: true`
   * to be visible; results are cached per tet index.
   */
  colorForTet?: (tetIndex: number) => number;
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
  private readonly projection: Projection | undefined;
  private readonly ambientSection: Float64Array | undefined;
  private readonly provenance: Uint32Array;
  private readonly colorAttribute: BufferAttribute | undefined;
  private readonly tetColors: Float32Array | undefined;

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

    this.projection = options.projection;
    if (this.projection && this.projection.fromDim !== 4) {
      throw new Error(
        `SlicedComplex3D: projection fromDim must be 4, got ${this.projection.fromDim}`
      );
    }

    this.worldPositions = new Float64Array(complex.positions.length);
    const maxVertices = (this.tets.length / 4) * 6; // 2 triangles per tetra worst case
    this.ambientSection = this.projection ? new Float64Array(maxVertices * 4) : undefined;
    this.provenance = new Uint32Array((this.tets.length / 4) * 2);
    this.positionAttribute = new BufferAttribute(new Float32Array(maxVertices * 3), 3);
    this.positionAttribute.setUsage(DynamicDrawUsage);

    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', this.positionAttribute);
    this.geometry.setAttribute(
      'normal',
      new BufferAttribute(new Float32Array(maxVertices * 3), 3).setUsage(DynamicDrawUsage)
    );

    if (options.colorForTet) {
      // Bake the per-tet palette once — provenance then indexes straight
      // into it on every remarch.
      const tetCount = this.tets.length / 4;
      this.tetColors = new Float32Array(tetCount * 3);
      for (let t = 0; t < tetCount; t++) {
        const hex = options.colorForTet(t);
        this.tetColors[t * 3] = ((hex >> 16) & 0xff) / 255;
        this.tetColors[t * 3 + 1] = ((hex >> 8) & 0xff) / 255;
        this.tetColors[t * 3 + 2] = (hex & 0xff) / 255;
      }
      this.colorAttribute = new BufferAttribute(new Float32Array(maxVertices * 3), 3);
      this.colorAttribute.setUsage(DynamicDrawUsage);
      this.geometry.setAttribute('color', this.colorAttribute);
    }

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
    let vertexCount: number;
    if (this.projection && this.ambientSection) {
      // Section as ambient 4D points, then through the projection — lands
      // in the same 3D space as ProjectedEdges3D of the same object.
      vertexCount = sliceTetrahedraAmbient(
        this.worldPositions,
        this.tets,
        this.slice,
        this.ambientSection,
        undefined,
        this.provenance
      );
      this.projection.projectPositions(
        this.ambientSection,
        vertexCount,
        this.positionAttribute.array as Float32Array
      );
    } else {
      vertexCount = sliceTetrahedra(
        this.worldPositions,
        this.tets,
        this.slice,
        this.positionAttribute.array as Float32Array,
        undefined,
        this.provenance
      );
    }
    this.geometry.setDrawRange(0, vertexCount);
    this.positionAttribute.needsUpdate = true;
    if (vertexCount > 0) this.computeFlatNormals(vertexCount);

    if (this.colorAttribute && this.tetColors) {
      const colors = this.colorAttribute.array as Float32Array;
      for (let f = 0; f < vertexCount / 3; f++) {
        const c = this.provenance[f]! * 3;
        for (let v = 0; v < 3; v++) {
          colors[f * 9 + v * 3] = this.tetColors[c]!;
          colors[f * 9 + v * 3 + 1] = this.tetColors[c + 1]!;
          colors[f * 9 + v * 3 + 2] = this.tetColors[c + 2]!;
        }
      }
      this.colorAttribute.needsUpdate = true;
    }
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

  /** Number of triangles in the current section. */
  get triangleCount(): number {
    return this.geometry.drawRange.count / 3;
  }

  /**
   * Provenance lookup for picking: the source tetrahedron of a rendered
   * triangle. `faceIndex` is what `Raycaster` reports when intersecting
   * `object`; the returned index counts into this complex's concatenated
   * tetrahedral cells.
   */
  sourceTetOfFace(faceIndex: number): number {
    if (faceIndex < 0 || faceIndex >= this.triangleCount) {
      throw new Error(`SlicedComplex3D: faceIndex ${faceIndex} out of range`);
    }
    return this.provenance[faceIndex]!;
  }

  /** The four source-complex vertex indices of a tetrahedron by index. */
  sourceTetVertices(tetIndex: number): [number, number, number, number] {
    const base = tetIndex * 4;
    return [this.tets[base]!, this.tets[base + 1]!, this.tets[base + 2]!, this.tets[base + 3]!];
  }

  dispose(): void {
    this.geometry.dispose();
    const material = this.object.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material.dispose();
  }
}
