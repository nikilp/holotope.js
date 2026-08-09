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
  type DisplayMap3D,
  type SourceCellReferenceN,
  type TransformN
} from '@holotope/core';

export interface ProjectedEdges3DOptions {
  /** Default material colour when `material` is omitted. */
  color?: number;
  material?: Material;
}

/**
 * Render product: the 1-skeleton (edges) of an N-dimensional cell complex,
 * projected to 3D and rendered as three.js LineSegments.
 *
 * This is the CPU "golden path": N-D transform and projection happen in
 * Float64 on the CPU each update; only the final 3D positions are uploaded
 * to the GPU. The geometry is indexed: its position attribute contains one
 * projected entry per source vertex, while its index buffer contains the
 * segment endpoints. It is not a flattened endpoint list. Vertex order is
 * preserved 1:1 through projection, so the i-th position still corresponds
 * to source vertex i (provenance for picking and debugging).
 */
export class ProjectedEdges3D {
  readonly complex: CellComplex;
  /**
   * The display map applied on every update. Historically named `projection`
   * (renaming a shipped field is an API break); it accepts any
   * `DisplayMap3D`, lossy or injective — an embedded R2 complex draws through
   * exactly the same path as a projected R4 one.
   */
  readonly projection: DisplayMap3D;
  readonly geometry: BufferGeometry;
  readonly object: LineSegments;

  private readonly worldPositions: Float64Array;
  private readonly positionAttribute: BufferAttribute;
  private readonly edgeReferences: readonly SourceCellReferenceN[];
  private readonly homogeneousProjection: HomogeneousProjection | null;
  private readonly homogeneousPositions: Float64Array;
  private readonly homogeneousValidity: Uint8Array;

  /**
   * Builds the render product and allocates its geometry once; updates
   * thereafter rewrite the position buffer in place.
   *
   * @param complex - Source complex. Its 1-cells become the line segments;
   * a complex with no 1-cells is rejected, since there would be nothing to
   * draw.
   * @param projection - Map applied on every update. Its `fromDim` must equal
   * the complex's `ambientDim`, and the mismatch is rejected here rather than
   * at the first update.
   * @param options - A default material colour or a complete material
   * override. They are mutually exclusive. Unknown keys are rejected;
   * WebGL ignores line width, so `linewidth` is not an accepted styling
   * option and visual weight should be expressed through colour and opacity.
   *
   * @example
   * A rotating tesseract. The transform is applied in R⁴ and the projection
   * recomputed, which is what makes the wireframe change shape; rotating
   * `product.object` instead would only turn its shadow.
   * ```ts
   * const product = new ProjectedEdges3D(
   *   createHypercube({ dim: 4 }),
   *   new PerspectiveProjection({ fromDim: 4, viewDistance: 4 })
   * );
   * scene.add(product.object);
   *
   * const angle = Math.PI / 6;
   * product.update(new TransformN(4, rotationFromPlanes(4, [{ i: 0, j: 3, angle }])));
   * ```
   */
  constructor(complex: CellComplex, projection: DisplayMap3D, options: ProjectedEdges3DOptions = {}) {
    const unknownOptions = Object.keys(options).filter(
      (key) => key !== 'color' && key !== 'material'
    );
    if (unknownOptions.length > 0) {
      throw new Error(
        `ProjectedEdges3D: unknown option${unknownOptions.length === 1 ? '' : 's'} ` +
        unknownOptions.map((key) => `"${key}"`).join(', ')
      );
    }
    if (options.color !== undefined) {
      if (!Number.isSafeInteger(options.color) || options.color < 0 || options.color > 0xffffff) {
        throw new Error('ProjectedEdges3D: color must be an integer from 0x000000 to 0xffffff');
      }
      if (options.material !== undefined) {
        throw new Error('ProjectedEdges3D: color and material are mutually exclusive');
      }
    }
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

    const material = options.material ?? new LineBasicMaterial({ color: options.color ?? 0xffffff });
    this.object = new LineSegments(this.geometry, material);
    this.object.frustumCulled = false; // bounds change every update; skip stale-culling

    this.update();
  }

  /**
   * Recomputes projected positions, optionally applying an N-D world
   * transform first. Call once per frame (or whenever the transform,
   * projection parameters, or source positions change).
   *
   * @param transform - Optional transform in the source complex's ambient
   * dimension. A mismatch is rejected before any render buffer is changed.
   */
  update(transform?: TransformN): void {
    if (transform !== undefined && transform.dim !== this.complex.ambientDim) {
      throw new Error(
        `ProjectedEdges3D.update: transform is R${transform.dim}, source complex is in R${this.complex.ambientDim}`
      );
    }
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
    // Same reason as the surface product: a stale sphere silently drops
    // intersections against geometry that has moved.
    this.geometry.computeBoundingSphere();
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
