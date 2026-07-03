import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  LineBasicMaterial,
  LineSegments,
  type Material
} from 'three';
import type { CellComplex, Projection, TransformN } from '@holotope/core';

export interface ProjectedEdges3DOptions {
  material?: Material;
}

/**
 * Render product: the 1-skeleton (edges) of an N-dimensional cell complex,
 * projected to 3D and rendered as three.js LineSegments.
 *
 * This is the CPU "golden path": N-D transform and projection happen in
 * Float64 on the CPU each update; only the final 3D positions are uploaded
 * to the GPU. Vertex order is preserved 1:1 through projection, so the
 * i-th rendered vertex always corresponds to source vertex i (provenance
 * for picking and debugging).
 */
export class ProjectedEdges3D {
  readonly complex: CellComplex;
  readonly projection: Projection;
  readonly geometry: BufferGeometry;
  readonly object: LineSegments;

  private readonly worldPositions: Float64Array;
  private readonly positionAttribute: BufferAttribute;

  constructor(complex: CellComplex, projection: Projection, options: ProjectedEdges3DOptions = {}) {
    if (complex.ambientDim !== projection.fromDim) {
      throw new Error(
        `ProjectedEdges3D: complex ambientDim ${complex.ambientDim} != projection fromDim ${projection.fromDim}`
      );
    }
    this.complex = complex;
    this.projection = projection;

    const edgeGroups = complex.cellsOfDim(1);
    if (edgeGroups.length === 0) {
      throw new Error('ProjectedEdges3D: cell complex has no edges (1-cells)');
    }
    let indexLength = 0;
    for (const g of edgeGroups) indexLength += g.indices.length;
    const index = new Uint32Array(indexLength);
    let offset = 0;
    for (const g of edgeGroups) {
      index.set(g.indices, offset);
      offset += g.indices.length;
    }

    this.worldPositions = new Float64Array(complex.positions.length);
    this.positionAttribute = new BufferAttribute(new Float32Array(complex.vertexCount * 3), 3);
    this.positionAttribute.setUsage(DynamicDrawUsage);

    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', this.positionAttribute);
    this.geometry.setIndex(new BufferAttribute(index, 1));

    const material = options.material ?? new LineBasicMaterial({ color: 0xffffff });
    this.object = new LineSegments(this.geometry, material);
    this.object.frustumCulled = false; // bounds change every update; skip stale-culling

    this.update();
  }

  /**
   * Recomputes projected positions, optionally applying an N-D world
   * transform first. Call once per frame (or whenever the transform,
   * projection parameters, or source positions change).
   */
  update(transform?: TransformN): void {
    const count = this.complex.vertexCount;
    if (transform) {
      transform.applyToPositions(this.complex.positions, this.worldPositions, count);
    } else {
      this.worldPositions.set(this.complex.positions);
    }
    this.projection.projectPositions(
      this.worldPositions,
      count,
      this.positionAttribute.array as Float32Array
    );
    this.positionAttribute.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    const material = this.object.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material.dispose();
  }
}
