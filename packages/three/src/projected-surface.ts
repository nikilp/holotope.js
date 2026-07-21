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
  VecN,
  createSourceCellReferenceN,
  isHomogeneousProjection,
  liftHomogeneousSimplexPointN,
  type CellComplex,
  type HomogeneousProjection,
  type HomogeneousSimplexLiftN,
  type HomogeneousSimplexVertexN,
  type Projection,
  type SourceCellReferenceN,
  type TransformN
} from '@holotope/core';

export interface ProjectedSurface3DOptions {
  material?: Material;
}

/**
 * Render product: the 2-skeleton (faces) of an N-dimensional cell complex,
 * projected to 3D and rendered as a shaded Mesh.
 *
 * Faces come from the complex's 2-cell groups — simplex triangles directly;
 * cuboid quads and polygon loops fan-triangulated from their first corner.
 * The projected boundary of a 4D object overlaps
 * itself in 3D (cells in front of and behind the hidden axis project onto
 * each other), so the default material is translucent and double-sided;
 * flat normals are recomputed per update over the triangle soup.
 *
 * Provenance: `sourceFaceOfTriangle` maps a Raycaster faceIndex back to
 * the source 2-cell, and `faceVertices` to its source vertex indices.
 */
export class ProjectedSurface3D {
  readonly complex: CellComplex;
  readonly projection: Projection;
  readonly geometry: BufferGeometry;
  readonly object: Mesh;

  private readonly worldPositions: Float64Array;
  private readonly projectedVertices: Float32Array;
  private readonly soupToVertex: Uint32Array;
  private readonly triangleToFace: Uint32Array;
  private readonly faceReferences: readonly SourceCellReferenceN[];
  private readonly positionAttribute: BufferAttribute;
  private readonly normalAttribute: BufferAttribute;
  private readonly homogeneousProjection: HomogeneousProjection | null;
  private readonly homogeneousPositions: Float64Array;
  private readonly homogeneousValidity: Uint8Array;

  constructor(
    complex: CellComplex,
    projection: Projection,
    options: ProjectedSurface3DOptions = {}
  ) {
    if (complex.ambientDim !== projection.fromDim) {
      throw new Error(
        `ProjectedSurface3D: complex ambientDim ${complex.ambientDim} != projection fromDim ${projection.fromDim}`
      );
    }
    this.complex = complex;
    this.projection = projection;
    this.homogeneousProjection = isHomogeneousProjection(projection)
      ? projection
      : null;

    const faceGroups = complex.cellsOfDim(2);
    if (faceGroups.length === 0) {
      throw new Error('ProjectedSurface3D: cell complex has no faces (2-cells)');
    }

    // Expand faces into a triangle soup, remembering the source vertex of
    // every soup vertex and the source 2-cell of every triangle.
    const soupToVertex: number[] = [];
    const triangleToFace: number[] = [];
    const faceReferences: SourceCellReferenceN[] = [];
    let faceOffset = 0;
    for (const g of faceGroups) {
      const cellCount = g.indices.length / g.verticesPerCell;
      for (let cell = 0; cell < cellCount; cell++) {
        faceReferences.push(createSourceCellReferenceN(complex, g, cell));
        const base = cell * g.verticesPerCell;
        const corner = (k: number): number => g.indices[base + k]!;
        if (g.verticesPerCell < 3) {
          throw new Error(
            `ProjectedSurface3D: 2-cell arity ${g.verticesPerCell} cannot form a face`
          );
        }
        // Triangles pass through; quads and polygon loops (cyclic vertex
        // order) fan-triangulate from their first corner.
        for (let k = 1; k < g.verticesPerCell - 1; k++) {
          soupToVertex.push(corner(0), corner(k), corner(k + 1));
          triangleToFace.push(faceOffset + cell);
        }
      }
      faceOffset += cellCount;
    }
    this.soupToVertex = Uint32Array.from(soupToVertex);
    this.triangleToFace = Uint32Array.from(triangleToFace);
    this.faceReferences = faceReferences;

    this.worldPositions = new Float64Array(complex.positions.length);
    this.projectedVertices = new Float32Array(complex.vertexCount * 3);
    this.homogeneousPositions = new Float64Array(complex.vertexCount * 4);
    this.homogeneousValidity = new Uint8Array(complex.vertexCount);
    this.positionAttribute = new BufferAttribute(new Float32Array(soupToVertex.length * 3), 3);
    this.positionAttribute.setUsage(DynamicDrawUsage);
    this.normalAttribute = new BufferAttribute(new Float32Array(soupToVertex.length * 3), 3);
    this.normalAttribute.setUsage(DynamicDrawUsage);

    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', this.positionAttribute);
    this.geometry.setAttribute('normal', this.normalAttribute);

    const material =
      options.material ??
      new MeshStandardMaterial({
        color: 0x7fd4ff,
        side: DoubleSide,
        flatShading: true,
        transparent: true,
        opacity: 0.45,
        depthWrite: false
      });
    this.object = new Mesh(this.geometry, material);
    this.object.frustumCulled = false;

    this.update();
  }

  get triangleCount(): number {
    return this.triangleToFace.length;
  }

  /** Source 2-cell (index into the concatenated face cells) of a triangle. */
  sourceFaceOfTriangle(faceIndex: number): number {
    if (faceIndex < 0 || faceIndex >= this.triangleToFace.length) {
      throw new Error(`ProjectedSurface3D: faceIndex ${faceIndex} out of range`);
    }
    return this.triangleToFace[faceIndex]!;
  }

  /** Source-complex vertex indices of a rendered triangle. */
  faceVertices(faceIndex: number): [number, number, number] {
    this.sourceFaceOfTriangle(faceIndex);
    const base = faceIndex * 3;
    return [
      this.soupToVertex[base]!,
      this.soupToVertex[base + 1]!,
      this.soupToVertex[base + 2]!
    ];
  }

  /** Lifecycle-aware reference to the source 2-cell of a rendered triangle. */
  sourceReferenceOfTriangle(faceIndex: number): SourceCellReferenceN {
    return this.faceReferences[this.sourceFaceOfTriangle(faceIndex)]!;
  }

  /**
   * Lifts one point on a rendered triangle to its current ambient N-D source
   * simplex. The point must be in this object's local representation frame.
   */
  liftTrianglePoint(
    faceIndex: number,
    pointLocal: ArrayLike<number>
  ): HomogeneousSimplexLiftN {
    if (this.homogeneousProjection === null) {
      return {
        kind: 'unavailable',
        reason: 'unsupported-projection',
        details: {}
      };
    }
    return liftHomogeneousSimplexPointN(
      this.faceVertices(faceIndex).map((vertex) => this.homogeneousVertex(vertex)),
      pointLocal,
      { tolerance: 1e-5 }
    );
  }

  /** Recomputes projected positions and flat normals. Call per frame. */
  update(transform?: TransformN): void {
    const count = this.complex.vertexCount;
    if (transform) {
      transform.applyToPositions(this.complex.positions, this.worldPositions, count);
    } else {
      this.worldPositions.set(this.complex.positions);
    }
    this.projection.projectPositions(this.worldPositions, count, this.projectedVertices);
    if (this.homogeneousProjection !== null) {
      this.homogeneousProjection.projectHomogeneousPositions(
        this.worldPositions,
        count,
        this.homogeneousPositions,
        this.homogeneousValidity
      );
    } else {
      this.homogeneousValidity.fill(0);
    }

    const positions = this.positionAttribute.array as Float32Array;
    for (let s = 0; s < this.soupToVertex.length; s++) {
      const v = this.soupToVertex[s]!;
      positions[s * 3] = this.projectedVertices[v * 3]!;
      positions[s * 3 + 1] = this.projectedVertices[v * 3 + 1]!;
      positions[s * 3 + 2] = this.projectedVertices[v * 3 + 2]!;
    }
    this.positionAttribute.needsUpdate = true;

    const normals = this.normalAttribute.array as Float32Array;
    for (let t = 0; t < this.triangleToFace.length; t++) {
      const o = t * 9;
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
      for (let k = 0; k < 3; k++) {
        normals[o + k * 3] = nx;
        normals[o + k * 3 + 1] = ny;
        normals[o + k * 3 + 2] = nz;
      }
    }
    this.normalAttribute.needsUpdate = true;
  }

  private homogeneousVertex(vertex: number): HomogeneousSimplexVertexN {
    const ambientDim = this.complex.ambientDim;
    const sourceOffset = vertex * ambientDim;
    const projectedOffset = vertex * 4;
    return {
      sourcePoint: new VecN(
        this.worldPositions.subarray(sourceOffset, sourceOffset + ambientDim)
      ),
      coordinates: this.homogeneousPositions.subarray(
        projectedOffset,
        projectedOffset + 4
      ),
      valid: this.homogeneousValidity[vertex] === 1
    };
  }

  dispose(): void {
    this.geometry.dispose();
    const material = this.object.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material.dispose();
  }
}
