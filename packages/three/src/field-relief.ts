import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  type Material
} from 'three';
import {
  type FieldEvaluation4,
  type HyperplaneSlice4,
  type ImplicitField4,
  type Vec4f64
} from '@holotope/core';

type SliceAxis3 = 0 | 1 | 2;

export interface FieldReliefSample<Record extends FieldEvaluation4> {
  readonly record: Record;
  readonly point: Vec4f64;
  readonly u: number;
  readonly v: number;
}

export interface FieldRelief3DOptions<Record extends FieldEvaluation4> {
  /** Vertices along each side of the square grid. */
  resolution: number;
  /** Half-width of the sampled square in slice coordinates. */
  extent: number;
  /** Two in-slice basis axes spanning the sampled plane. Default [0, 1]. */
  planeAxes?: readonly [SliceAxis3, SliceAxis3];
  /** Coordinate along the remaining in-slice basis axis. Default 0. */
  planeOffset?: number;
  /** Maps a retained field record to rendered height. */
  heightFor: (sample: FieldReliefSample<Record>) => number;
  /** Optional packed RGB color for each retained field record. */
  colorFor?: (sample: FieldReliefSample<Record>) => number;
  material?: Material;
}

/**
 * Inspectable 2D field relief inside an affine 3-flat. It evaluates a declared
 * plane in R4 on the CPU, retains every source point and record, and presents
 * one scalar as height. This is a field encoding, not a geometric section of
 * the field's zero set.
 */
export class FieldRelief3D<Record extends FieldEvaluation4 = FieldEvaluation4> {
  readonly field: ImplicitField4<Record>;
  readonly slice: HyperplaneSlice4;
  readonly geometry = new BufferGeometry();
  readonly object: Mesh;
  readonly approximate = true;
  records: Record[] = [];
  sourcePoints = new Float64Array();
  heights = new Float32Array();

  private options: FieldRelief3DOptions<Record>;

  constructor(
    field: ImplicitField4<Record>,
    slice: HyperplaneSlice4,
    options: FieldRelief3DOptions<Record>
  ) {
    this.field = field;
    this.slice = slice;
    this.options = { ...options };
    const material =
      options.material ??
      new MeshStandardMaterial({
        color: 0xffffff,
        side: DoubleSide,
        roughness: 0.44,
        metalness: 0.08,
        vertexColors: options.colorFor !== undefined
      });
    this.object = new Mesh(this.geometry, material);
    this.object.frustumCulled = false;
    this.update();
  }

  update(options?: Partial<FieldRelief3DOptions<Record>>): void {
    if (options) this.options = { ...this.options, ...options };
    const { resolution, extent, heightFor, colorFor } = this.options;
    if (!Number.isSafeInteger(resolution) || resolution < 2 || resolution > 1024) {
      throw new Error('FieldRelief3D: resolution must be an integer in [2, 1024]');
    }
    if (!Number.isFinite(extent) || extent <= 0) {
      throw new Error('FieldRelief3D: extent must be positive and finite');
    }
    const planeOffset = this.options.planeOffset ?? 0;
    if (!Number.isFinite(planeOffset)) {
      throw new Error('FieldRelief3D: planeOffset must be finite');
    }
    const planeAxes = this.options.planeAxes ?? [0, 1];
    if (planeAxes[0] === planeAxes[1] || planeAxes.some((axis) => axis < 0 || axis > 2)) {
      throw new Error('FieldRelief3D: planeAxes must contain two distinct slice axes');
    }
    const depthAxis = ([0, 1, 2] as const).find((axis) => !planeAxes.includes(axis))!;
    const vertexCount = resolution * resolution;
    const positions = new Float32Array(vertexCount * 3);
    const colors = colorFor ? new Float32Array(vertexCount * 3) : null;
    this.sourcePoints = new Float64Array(vertexCount * 4);
    this.heights = new Float32Array(vertexCount);
    this.records = new Array<Record>(vertexCount);

    const normal = this.slice.normal.data;
    const uBasis = this.slice.basis[planeAxes[0]]!;
    const vBasis = this.slice.basis[planeAxes[1]]!;
    const depthBasis = this.slice.basis[depthAxis]!;
    const step = (extent * 2) / (resolution - 1);
    for (let row = 0; row < resolution; row++) {
      const v = -extent + row * step;
      for (let column = 0; column < resolution; column++) {
        const u = -extent + column * step;
        const index = row * resolution + column;
        const point: Vec4f64 = [
          normal[0]! * this.slice.offset + uBasis[0]! * u + vBasis[0]! * v + depthBasis[0]! * planeOffset,
          normal[1]! * this.slice.offset + uBasis[1]! * u + vBasis[1]! * v + depthBasis[1]! * planeOffset,
          normal[2]! * this.slice.offset + uBasis[2]! * u + vBasis[2]! * v + depthBasis[2]! * planeOffset,
          normal[3]! * this.slice.offset + uBasis[3]! * u + vBasis[3]! * v + depthBasis[3]! * planeOffset
        ];
        this.sourcePoints.set(point, index * 4);
        const record = this.field.evalCPU(point);
        this.records[index] = record;
        const sample = { record, point, u, v };
        const height = heightFor(sample);
        if (!Number.isFinite(height)) {
          throw new Error(`FieldRelief3D: heightFor returned a non-finite value at sample ${index}`);
        }
        this.heights[index] = height;
        positions.set([u, height, v], index * 3);
        if (colors && colorFor) {
          const color = colorFor(sample);
          if (!Number.isSafeInteger(color) || color < 0 || color > 0xffffff) {
            throw new Error(`FieldRelief3D: colorFor returned an invalid RGB value at sample ${index}`);
          }
          colors[index * 3] = ((color >> 16) & 0xff) / 255;
          colors[index * 3 + 1] = ((color >> 8) & 0xff) / 255;
          colors[index * 3 + 2] = (color & 0xff) / 255;
        }
      }
    }

    const indices = new Uint32Array((resolution - 1) ** 2 * 6);
    let cursor = 0;
    for (let row = 0; row < resolution - 1; row++) {
      for (let column = 0; column < resolution - 1; column++) {
        const a = row * resolution + column;
        const b = a + 1;
        const c = a + resolution;
        const d = c + 1;
        indices.set([a, c, b, b, c, d], cursor);
        cursor += 6;
      }
    }

    this.geometry.setAttribute('position', new BufferAttribute(positions, 3));
    this.geometry.setIndex(new BufferAttribute(indices, 1));
    if (colors) this.geometry.setAttribute('color', new BufferAttribute(colors, 3));
    else this.geometry.deleteAttribute('color');
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }

  get triangleCount(): number {
    const resolution = this.options.resolution;
    return (resolution - 1) ** 2 * 2;
  }

  dispose(): void {
    this.geometry.dispose();
    const material = this.object.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material.dispose();
  }
}
