import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  type Material,
  type Object3D
} from 'three';
import {
  CellComplex,
  sectionSimplexGroupN,
  type CellGroup,
  type HyperplaneSliceN,
  type SectionSimplexGroupNResultN,
  type SourceAffineLineageN,
  type TransformN
} from '@holotope/core';

/** Construction options for a {@link SectionChart3D}. */
export interface SectionChart3DOptions {
  /**
   * Material for the emitted primitives. Caller-owned: the product never
   * disposes a material it was given. Omit it and the product creates and owns
   * a sensible default for the primitive kind instead.
   */
  readonly material?: Material;
  /**
   * Ancestry of the complex's vertices over an original source, for rendering
   * a *chained* section: pass the previous section's `lineage` and every
   * picked primitive still names the original vertices rather than the
   * intermediate complex's.
   */
  readonly lineage?: SourceAffineLineageN;
  /** Classification tolerance forwarded to the section. Default `1e-9`. */
  readonly epsilon?: number;
}

const OPTION_KEYS = ['material', 'lineage', 'epsilon'] as const;

/**
 * Render product: the exact section of one simplicial cell group, drawn in the
 * hyperplane's own chart.
 *
 * This is the adapter an RN section needs to reach a renderer at all —
 * `sectionSimplexGroupN` hands back `chartDim` Float64 coordinates and
 * `(k−1)`-simplices, which is neither triangles nor Float32. The product
 * performs **exactly one section evaluation per {@link update}**, writes the
 * chart coordinates into the display axes, and keeps the whole immutable
 * result observable as {@link section}, so diagnostics, parent cells, and
 * original-source lineage stay auditable after every update.
 *
 * The intrinsic cell dimension is fixed by the group — `group.dim - 1` — so
 * the product constructs the one three.js primitive that dimension needs and
 * `object` never changes identity: `Points` for 0-cells, `LineSegments` for
 * 1-cells, a double-sided `Mesh` for 2-cells. Charts above dimension 3 and
 * cells above dimension 2 are refused by name: they have no display axes left,
 * and pretending otherwise would be a projection, not a section.
 *
 * Emitted triangles are coherently wound per parent (the section is the
 * oriented boundary of the parent's below-plane region), so normal-based
 * shading shows no seam and reversing the slice normal visibly flips the
 * facing. Renderer primitive `p` is emitted cell `p`: its parent source cell
 * is `section.parentCells[p]`, and each corner's affine ancestry row is in
 * `section.lineage` — which is what `representationHitFromSectionChart` reads.
 *
 * @example
 * A tetrahedron group in R4 sectioned into its own 3D chart, swept through the
 * body, with the evidence read back at every step:
 * ```ts
 * const positions = Float64Array.from([
 *   0, 0, 0, -1,
 *   2, 0, 0, 1,
 *   0, 2, 0, 1,
 *   0, 0, 2, 1
 * ]);
 * const complex = new CellComplex(4, positions, [
 *   { dim: 3, verticesPerCell: 4, kind: 'simplex', indices: Uint32Array.from([0, 1, 2, 3]) }
 * ]);
 * const group = complex.groups[0];
 * if (group === undefined) throw new Error('expected the tetrahedron group');
 *
 * const chart = new SectionChart3D(complex, group, HyperplaneSliceN.axisAligned(4, 3, 0));
 * scene.add(chart.object);
 *
 * log('cells', chart.section.cellCount); // 1 — one coherently wound triangle
 * log('parent', chart.sourceCellOfPrimitive(0)); // 0 — the tetrahedron, exactly
 * // Each drawn corner is an affine blend of source vertices — the ancestry a
 * // projection cannot give.
 * const corner = chart.primitiveVertices(0)[0];
 * if (corner !== undefined) log('ancestry', chart.vertexAncestry(corner));
 *
 * // Sweep the hyperplane: one section evaluation per update, and the
 * // diagnostics say WHY a frame is empty rather than leaving it a guess.
 * onFrame((t) => {
 *   chart.slice.offset = Math.sin(t * 0.001) * 1.5;
 *   chart.update();
 *   const d = chart.section.diagnostics;
 *   if (chart.cellCount === 0) {
 *     log(d.cellsBelow ? 'plane above the body' : 'plane below the body');
 *   }
 * });
 * ```
 */
export class SectionChart3D {
  /** The authoritative complex. Read live at each update, never mutated. */
  readonly complex: CellComplex;
  /** The simplicial group being sectioned. */
  readonly group: CellGroup;
  /** The live chart: set `offset` or `setNormal(...)`, then {@link update}. */
  readonly slice: HyperplaneSliceN;
  /** Intrinsic dimension of the drawn cells: `group.dim - 1`. */
  readonly cellDim: number;
  readonly geometry: BufferGeometry;
  /** `Points`, `LineSegments`, or `Mesh`, fixed at construction. */
  readonly object: Object3D;

  private readonly lineage: SourceAffineLineageN | undefined;
  private readonly epsilon: number | undefined;
  private readonly posed: CellComplex;
  private readonly ownsMaterial: boolean;
  private readonly material: Material;
  private positionAttribute: BufferAttribute;
  private latest: SectionSimplexGroupNResultN;

  constructor(
    complex: CellComplex,
    group: CellGroup,
    slice: HyperplaneSliceN,
    options: SectionChart3DOptions = {}
  ) {
    const unknownOptions = Object.keys(options).filter(
      (key) => !(OPTION_KEYS as readonly string[]).includes(key)
    );
    if (unknownOptions.length > 0) {
      throw new Error(
        `SectionChart3D: unknown option${unknownOptions.length === 1 ? '' : 's'} ` +
        unknownOptions.map((key) => `"${key}"`).join(', ')
      );
    }
    if (slice.chartDim > 3) {
      throw new Error(
        `SectionChart3D: chart dimension ${slice.chartDim} has no display axes left; ` +
        'charts of dimension 1…3 are renderable'
      );
    }
    const cellDim = group.dim - 1;
    if (cellDim > 2) {
      throw new Error(
        `SectionChart3D: section cells of dimension ${cellDim} are not renderable; ` +
        'points, segments, and triangles are (cell dimension 0…2)'
      );
    }
    this.complex = complex;
    this.group = group;
    this.slice = slice;
    this.cellDim = cellDim;
    if (options.lineage !== undefined) this.lineage = options.lineage;
    if (options.epsilon !== undefined) this.epsilon = options.epsilon;
    // The posed copy: same topology, product-private positions, so a transform
    // never mutates the authoritative complex.
    this.posed = new CellComplex(
      complex.ambientDim,
      new Float64Array(complex.positions),
      [group]
    );

    this.geometry = new BufferGeometry();
    this.positionAttribute = new BufferAttribute(new Float32Array(3 * 64), 3);
    this.positionAttribute.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttribute);
    this.geometry.setDrawRange(0, 0);

    this.ownsMaterial = options.material === undefined;
    this.material =
      options.material ??
      (cellDim >= 2
        ? new MeshStandardMaterial({ flatShading: true, side: DoubleSide, roughness: 0.45 })
        : cellDim === 1
          ? new LineBasicMaterial({ color: 0xffffff })
          : new PointsMaterial({ size: 0.05, color: 0xffffff }));
    this.object =
      cellDim >= 2
        ? new Mesh(this.geometry, this.material)
        : cellDim === 1
          ? new LineSegments(this.geometry, this.material)
          : new Points(this.geometry, this.material);
    // Bounds are recomputed on every update; a culler holding the previous
    // frame's sphere would blank a section that just moved into view.
    this.object.frustumCulled = false;

    this.latest = this.evaluate(undefined);
    this.write();
  }

  /**
   * The latest immutable section result: geometry, `parentCells`, `lineage`,
   * and `diagnostics` — including `collapsedSectionCells`, which is how an
   * empty draw range is told apart from a plane that missed the complex.
   * Replaced whole by each {@link update}; safe to retain and compare.
   */
  get section(): SectionSimplexGroupNResultN {
    return this.latest;
  }

  /** Emitted cells in the latest section; `0` draws nothing. */
  get cellCount(): number {
    return this.latest.cellCount;
  }

  /**
   * Re-sections the current pose and rewrites the drawn buffers.
   *
   * @param transform - Optional pose in the source's ambient dimension,
   *   applied into a product-private buffer; the authoritative complex is
   *   never mutated.
   */
  update(transform?: TransformN): void {
    if (transform !== undefined && transform.dim !== this.complex.ambientDim) {
      throw new Error(
        `SectionChart3D.update: transform is R${transform.dim}, ` +
        `source complex is in R${this.complex.ambientDim}`
      );
    }
    this.latest = this.evaluate(transform);
    this.write();
  }

  /** Parent source cell of one rendered primitive, exactly. */
  sourceCellOfPrimitive(primitive: number): number {
    const parent = this.latest.parentCells[primitive];
    if (parent === undefined) {
      throw new Error(
        `SectionChart3D.sourceCellOfPrimitive: primitive ${primitive} is outside ` +
        `0…${this.latest.cellCount - 1}`
      );
    }
    return parent;
  }

  /** Emitted section-vertex indices of one rendered primitive, in draw order. */
  primitiveVertices(primitive: number): number[] {
    if (!Number.isSafeInteger(primitive) || primitive < 0 || primitive >= this.latest.cellCount) {
      throw new Error(
        `SectionChart3D.primitiveVertices: primitive ${primitive} is outside ` +
        `0…${this.latest.cellCount - 1}`
      );
    }
    const per = this.latest.verticesPerCell;
    const out: number[] = [];
    for (let corner = 0; corner < per; corner++) {
      out.push(this.latest.cells[primitive * per + corner]!);
    }
    return out;
  }

  /**
   * Original-source ancestry of one emitted section vertex: parallel arrays of
   * source vertex indices and affine weights, from the latest result.
   */
  vertexAncestry(vertex: number): { sourceVertices: number[]; weights: number[] } {
    const lineage = this.latest.lineage;
    const from = lineage.offsets[vertex];
    const to = lineage.offsets[vertex + 1];
    if (from === undefined || to === undefined) {
      throw new Error(
        `SectionChart3D.vertexAncestry: vertex ${vertex} is outside ` +
        `0…${this.latest.vertexCount - 1}`
      );
    }
    return {
      sourceVertices: Array.from(lineage.sourceVertices.subarray(from, to)),
      weights: Array.from(lineage.weights.subarray(from, to))
    };
  }

  /**
   * Releases the geometry, and the material only if the product created it —
   * a caller-supplied material is caller-owned. (This deliberately differs
   * from `ProjectedEdges3D`, which disposes whatever it was handed.)
   */
  dispose(): void {
    this.geometry.dispose();
    if (this.ownsMaterial) this.material.dispose();
  }

  private evaluate(transform: TransformN | undefined): SectionSimplexGroupNResultN {
    const count = this.complex.positions.length / this.complex.ambientDim;
    if (transform !== undefined) {
      transform.applyToPositions(this.complex.positions, this.posed.positions, count);
    } else {
      this.posed.positions.set(this.complex.positions);
    }
    return sectionSimplexGroupN({
      complex: this.posed,
      group: this.group,
      slice: this.slice,
      ...(this.epsilon !== undefined ? { epsilon: this.epsilon } : {}),
      ...(this.lineage !== undefined ? { lineage: this.lineage } : {})
    });
  }

  private write(): void {
    const section = this.latest;
    const vertexSlots = section.cells.length;
    if (vertexSlots * 3 > this.positionAttribute.array.length) {
      let capacity = this.positionAttribute.array.length / 3;
      while (capacity < vertexSlots) capacity *= 2;
      this.positionAttribute = new BufferAttribute(new Float32Array(capacity * 3), 3);
      this.positionAttribute.setUsage(DynamicDrawUsage);
      this.geometry.setAttribute('position', this.positionAttribute);
    }
    const target = this.positionAttribute.array as Float32Array;
    const chartDim = section.chartDim;
    for (let slot = 0; slot < vertexSlots; slot++) {
      const vertex = section.cells[slot]!;
      target[slot * 3] = section.chartPositions[vertex * chartDim]!;
      target[slot * 3 + 1] = chartDim > 1 ? section.chartPositions[vertex * chartDim + 1]! : 0;
      target[slot * 3 + 2] = chartDim > 2 ? section.chartPositions[vertex * chartDim + 2]! : 0;
    }
    this.geometry.setDrawRange(0, vertexSlots);
    this.positionAttribute.needsUpdate = true;
    // A stale bounding volume silently rejects rays where the section now is,
    // and keeps accepting them where it used to be.
    this.geometry.computeBoundingSphere();
    this.geometry.computeBoundingBox();
    if (this.cellDim >= 2 && vertexSlots > 0) this.geometry.computeVertexNormals();
  }
}
