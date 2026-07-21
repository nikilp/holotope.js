import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  LineBasicMaterial,
  LineSegments,
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
  private readonly edgeReferences: readonly SourceCellReferenceN[];
  private readonly homogeneousProjection: HomogeneousProjection | null;
  private readonly homogeneousPositions: Float64Array;
  private readonly homogeneousValidity: Uint8Array;

  constructor(complex: CellComplex, projection: Projection, options: ProjectedEdges3DOptions = {}) {
    if (complex.ambientDim !== projection.fromDim) {
      throw new Error(
        `ProjectedEdges3D: complex ambientDim ${complex.ambientDim} != projection fromDim ${projection.fromDim}`
      );
    }
    this.complex = complex;
    this.projection = projection;
    this.homogeneousProjection = isHomogeneousProjection(projection)
      ? projection
      : null;

    const edgeGroups = complex.cellsOfDim(1);
    if (edgeGroups.length === 0) {
      throw new Error('ProjectedEdges3D: cell complex has no edges (1-cells)');
    }
    let indexLength = 0;
    for (const g of edgeGroups) indexLength += g.indices.length;
    const index = new Uint32Array(indexLength);
    const edgeReferences: SourceCellReferenceN[] = [];
    let offset = 0;
    for (const g of edgeGroups) {
      index.set(g.indices, offset);
      offset += g.indices.length;
      const cellCount = g.indices.length / g.verticesPerCell;
      for (let cell = 0; cell < cellCount; cell++) {
        edgeReferences.push(createSourceCellReferenceN(complex, g, cell));
      }
    }
    this.edgeReferences = edgeReferences;

    this.worldPositions = new Float64Array(complex.positions.length);
    this.homogeneousPositions = new Float64Array(complex.vertexCount * 4);
    this.homogeneousValidity = new Uint8Array(complex.vertexCount);
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
    this.positionAttribute.needsUpdate = true;
  }

  /**
   * Provenance lookup for picking: the two source-complex vertex indices of
   * a rendered segment. For a `Raycaster` intersection with `object`, the
   * segment index is `intersection.index / 2` (three.js reports the index-
   * buffer position of the segment's first vertex).
   */
  edgeVertices(segmentIndex: number): [number, number] {
    const index = this.geometry.getIndex()!;
    if (segmentIndex < 0 || segmentIndex * 2 + 1 >= index.count) {
      throw new Error(`ProjectedEdges3D: segmentIndex ${segmentIndex} out of range`);
    }
    return [index.getX(segmentIndex * 2), index.getX(segmentIndex * 2 + 1)];
  }

  /** Lifecycle-aware reference to the source edge of a rendered segment. */
  sourceReferenceOfSegment(segmentIndex: number): SourceCellReferenceN {
    this.edgeVertices(segmentIndex);
    return this.edgeReferences[segmentIndex]!;
  }

  /**
   * Lifts one point on a rendered segment to the current ambient N-D edge.
   * The point must be in this object's local representation coordinates.
   */
  liftSegmentPoint(
    segmentIndex: number,
    pointLocal: ArrayLike<number>
  ): HomogeneousSimplexLiftN {
    if (this.homogeneousProjection === null) {
      return {
        kind: 'unavailable',
        reason: 'unsupported-projection',
        details: {}
      };
    }
    const [from, to] = this.edgeVertices(segmentIndex);
    return liftHomogeneousSimplexPointN(
      [this.homogeneousVertex(from), this.homogeneousVertex(to)],
      pointLocal,
      { tolerance: 1e-5 }
    );
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
