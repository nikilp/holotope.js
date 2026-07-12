import {
  BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LineSegments,
  Matrix4,
  Vector4
} from 'three';
import { LineBasicNodeMaterial } from 'three/webgpu';
import { attribute, uniform } from 'three/tsl';
import type { CellComplex, TransformN } from '@holotope/core';
import { transformToGpuUniforms } from './convert.js';

export interface ProjectedEdgesInstancedGPUOptions {
  /** Number of instances. */
  count: number;
  color?: number;
  /** Iterated-perspective view distance along w. Default 4. */
  viewDistance?: number;
  /** Denominator clamp guarding the perspective divide. Default 1e-4. */
  epsilon?: number;
}

/**
 * Instanced GPU render product: many rigid copies of one 4D cell
 * complex's 1-skeleton, projected 4D → 3D in the vertex shader.
 *
 * The 4D positions upload once, shared by all instances; each instance
 * carries its own rigid transform as five instanced vec4 attributes —
 * the four **columns** of the SO(4) rotation matrix plus the
 * translation. The vertex stage reconstructs
 *
 *   world = c₀·x + c₁·y + c₂·z + c₃·w + t
 *
 * (the matrix–vector product expressed over columns, which avoids
 * assembling a mat4 from attributes) and then applies the shared
 * perspective divide. One draw call renders every copy; updating an
 * instance writes 20 floats.
 *
 * Column storage means `Matrix4.elements` (column-major) copies
 * straight into the attribute with no transpose.
 */
export class ProjectedEdgesInstancedGPU {
  readonly complex: CellComplex;
  readonly count: number;
  readonly geometry: InstancedBufferGeometry;
  readonly object: LineSegments;
  readonly viewDistanceUniform;

  private readonly columns: InstancedBufferAttribute[];
  private readonly translations: InstancedBufferAttribute;
  private readonly scratchMatrix = new Matrix4();
  private readonly scratchTranslation = new Vector4();

  constructor(complex: CellComplex, options: ProjectedEdgesInstancedGPUOptions) {
    if (complex.ambientDim !== 4) {
      throw new Error(
        `ProjectedEdgesInstancedGPU: requires ambientDim 4, got ${complex.ambientDim}`
      );
    }
    if (!Number.isInteger(options.count) || options.count < 1) {
      throw new Error(`ProjectedEdgesInstancedGPU: count must be a positive integer`);
    }
    this.complex = complex;
    this.count = options.count;
    this.viewDistanceUniform = uniform(options.viewDistance ?? 4);
    const epsilon = options.epsilon ?? 1e-4;

    const edgeGroups = complex.cellsOfDim(1);
    if (edgeGroups.length === 0) {
      throw new Error('ProjectedEdgesInstancedGPU: cell complex has no edges (1-cells)');
    }
    let indexLength = 0;
    for (const g of edgeGroups) indexLength += g.indices.length;
    const index = new Uint32Array(indexLength);
    let offset = 0;
    for (const g of edgeGroups) {
      index.set(g.indices, offset);
      offset += g.indices.length;
    }

    const vertexCount = complex.vertexCount;
    const position4 = new Float32Array(complex.positions.length);
    position4.set(complex.positions);
    const placeholder = new Float32Array(vertexCount * 3);
    for (let v = 0; v < vertexCount; v++) {
      for (let c = 0; c < 3; c++) placeholder[v * 3 + c] = complex.positions[v * 4 + c]!;
    }

    this.geometry = new InstancedBufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(placeholder, 3));
    this.geometry.setAttribute('position4', new BufferAttribute(position4, 4));
    this.geometry.setIndex(new BufferAttribute(index, 1));
    this.geometry.instanceCount = this.count;

    // Identity transforms by default: columns eᵢ, zero translation.
    this.columns = [0, 1, 2, 3].map((col) => {
      const data = new Float32Array(this.count * 4);
      for (let i = 0; i < this.count; i++) data[i * 4 + col] = 1;
      const attr = new InstancedBufferAttribute(data, 4);
      this.geometry.setAttribute(`instanceRotationColumn${col}`, attr);
      return attr;
    });
    this.translations = new InstancedBufferAttribute(new Float32Array(this.count * 4), 4);
    this.geometry.setAttribute('instanceTranslation', this.translations);

    const material = new LineBasicNodeMaterial({ color: options.color ?? 0xffffff });
    const p4 = attribute<'vec4'>('position4', 'vec4');
    const c0 = attribute<'vec4'>('instanceRotationColumn0', 'vec4');
    const c1 = attribute<'vec4'>('instanceRotationColumn1', 'vec4');
    const c2 = attribute<'vec4'>('instanceRotationColumn2', 'vec4');
    const c3 = attribute<'vec4'>('instanceRotationColumn3', 'vec4');
    const t = attribute<'vec4'>('instanceTranslation', 'vec4');
    const world = c0
      .mul(p4.x)
      .add(c1.mul(p4.y))
      .add(c2.mul(p4.z))
      .add(c3.mul(p4.w))
      .add(t);
    const scale = this.viewDistanceUniform.div(
      this.viewDistanceUniform.sub(world.w).max(epsilon)
    );
    material.positionNode = world.xyz.mul(scale);

    this.object = new LineSegments(this.geometry, material);
    this.object.frustumCulled = false;
  }

  /** Writes one instance's rigid transform (20 floats). */
  setInstanceTransform(instance: number, transform: TransformN): void {
    if (instance < 0 || instance >= this.count) {
      throw new Error(`ProjectedEdgesInstancedGPU: instance ${instance} out of range`);
    }
    transformToGpuUniforms(transform, this.scratchMatrix, this.scratchTranslation);
    const e = this.scratchMatrix.elements; // column-major: column c at e[4c..4c+3]
    for (let col = 0; col < 4; col++) {
      const attr = this.columns[col]!;
      (attr.array as Float32Array).set(e.slice(col * 4, col * 4 + 4), instance * 4);
      attr.needsUpdate = true;
    }
    const tr = this.translations.array as Float32Array;
    tr[instance * 4] = this.scratchTranslation.x;
    tr[instance * 4 + 1] = this.scratchTranslation.y;
    tr[instance * 4 + 2] = this.scratchTranslation.z;
    tr[instance * 4 + 3] = this.scratchTranslation.w;
    this.translations.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    const material = this.object.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material.dispose();
  }
}
