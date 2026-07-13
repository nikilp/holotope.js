import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  type Material
} from 'three';
import {
  extractSampledIsosurface3,
  sampleFieldSlice3,
  type ExtractedIsosurface3,
  type FieldEvaluation4,
  type HyperplaneSlice4,
  type ImplicitField4,
  type SampledFieldSlice3,
  type SampleFieldSlice3Options
} from '@holotope/core';

export interface SampledSlicedField3DOptions extends SampleFieldSlice3Options {
  isoValue?: number;
  material?: Material;
  /** Optional packed RGB color for each interpolated escape-iteration value. */
  colorForIteration?: (iteration: number) => number;
}

/**
 * CPU render product for an implicit field restricted to a 3-flat in R4.
 * Sampling remains inspectable and deterministic; only the extracted mesh
 * is approximate, as declared by `surface.approximate`.
 */
export class SampledSlicedField3D<Record extends FieldEvaluation4 = FieldEvaluation4> {
  readonly field: ImplicitField4<Record>;
  readonly slice: HyperplaneSlice4;
  readonly geometry = new BufferGeometry();
  readonly object: Mesh;
  readonly approximate = true;
  sample!: SampledFieldSlice3<Record>;
  surface!: ExtractedIsosurface3;

  private options: SampledSlicedField3DOptions;

  constructor(
    field: ImplicitField4<Record>,
    slice: HyperplaneSlice4,
    options: SampledSlicedField3DOptions
  ) {
    this.field = field;
    this.slice = slice;
    this.options = { ...options };
    const material =
      options.material ??
      new MeshStandardMaterial({
        color: 0xffffff,
        side: DoubleSide,
        flatShading: false,
        vertexColors: options.colorForIteration !== undefined
      });
    this.object = new Mesh(this.geometry, material);
    this.object.frustumCulled = false;
    this.update();
  }

  /** Re-sample after changing the slice, or replace sampling options. */
  update(options?: Partial<SampledSlicedField3DOptions>): void {
    if (options) this.options = { ...this.options, ...options };
    this.sample = sampleFieldSlice3(this.field, this.slice, this.options);
    this.surface = extractSampledIsosurface3(this.sample, this.options.isoValue ?? 0);
    this.geometry.setAttribute('position', new BufferAttribute(this.surface.positions, 3));
    if (this.options.colorForIteration) {
      const colors = new Float32Array(this.surface.iterations.length * 3);
      for (let vertex = 0; vertex < this.surface.iterations.length; vertex++) {
        const hex = this.options.colorForIteration(this.surface.iterations[vertex]!);
        colors[vertex * 3] = ((hex >> 16) & 0xff) / 255;
        colors[vertex * 3 + 1] = ((hex >> 8) & 0xff) / 255;
        colors[vertex * 3 + 2] = (hex & 0xff) / 255;
      }
      this.geometry.setAttribute('color', new BufferAttribute(colors, 3));
    } else {
      this.geometry.deleteAttribute('color');
    }
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }

  get triangleCount(): number {
    return this.surface.triangleCount;
  }

  sourceCellOfFace(faceIndex: number): number {
    if (!Number.isSafeInteger(faceIndex) || faceIndex < 0 || faceIndex >= this.triangleCount) {
      throw new Error(`SampledSlicedField3D: faceIndex ${faceIndex} out of range`);
    }
    return this.surface.sourceCells[faceIndex]!;
  }

  dispose(): void {
    this.geometry.dispose();
    const material = this.object.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material.dispose();
  }
}
