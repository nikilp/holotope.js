import { BufferAttribute, BufferGeometry, LineSegments, Matrix4, Vector4 } from 'three';
import { LineBasicNodeMaterial } from 'three/webgpu';
import { attribute, uniform } from 'three/tsl';
import type { CellComplex, TransformN } from '@holotope/core';
import { transformToGpuUniforms } from './convert.js';

export interface ProjectedEdgesGPUOptions {
  color?: number;
  /** Iterated-perspective view distance along w. Default 4. */
  viewDistance?: number;
  /** Denominator clamp guarding the perspective divide. Default 1e-4. */
  epsilon?: number;
}

/**
 * GPU render product: the 1-skeleton of a 4D cell complex, projected
 * 4D → 3D **in the vertex shader** via TSL.
 *
 * The 4D positions upload once as a static `position4` attribute; each
 * `update` only writes a mat4 rotation, a vec4 translation, and the
 * projection uniforms — no per-frame CPU projection, no buffer re-upload.
 * SO(4) being a linear map on R^4 is what makes this exact: the whole 4D
 * rigid transform fits native GPU types.
 *
 * Requires `WebGPURenderer` (which itself falls back to WebGL2); the node
 * material compiles to WGSL or GLSL through the same TSL graph. Numerics
 * are Float32 on the GPU versus the CPU products' Float64 — for
 * unit-scale polytopes the difference is far below a pixel, and the CPU
 * path remains the golden reference.
 */
export class ProjectedEdgesGPU {
  readonly complex: CellComplex;
  readonly geometry: BufferGeometry;
  readonly object: LineSegments;

  private readonly rotationUniform = uniform(new Matrix4());
  private readonly translationUniform = uniform(new Vector4(0, 0, 0, 0));
  readonly viewDistanceUniform;
  private readonly identity = new Matrix4();

  constructor(complex: CellComplex, options: ProjectedEdgesGPUOptions = {}) {
    if (complex.ambientDim !== 4) {
      throw new Error(`ProjectedEdgesGPU: requires ambientDim 4, got ${complex.ambientDim}`);
    }
    this.complex = complex;
    this.viewDistanceUniform = uniform(options.viewDistance ?? 4);
    const epsilon = options.epsilon ?? 1e-4;

    const edgeGroups = complex.cellsOfDim(1);
    if (edgeGroups.length === 0) {
      throw new Error('ProjectedEdgesGPU: cell complex has no edges (1-cells)');
    }
    let indexLength = 0;
    for (const g of edgeGroups) indexLength += g.indices.length;
    const index = new Uint32Array(indexLength);
    let offset = 0;
    for (const g of edgeGroups) {
      index.set(g.indices, offset);
      offset += g.indices.length;
    }

    // Static 4D positions; the vec3 'position' attribute exists only for
    // three's draw-count bookkeeping (positionNode overrides it entirely).
    const count = complex.vertexCount;
    const position4 = new Float32Array(complex.positions.length);
    position4.set(complex.positions);
    const placeholder = new Float32Array(count * 3);
    for (let v = 0; v < count; v++) {
      placeholder[v * 3] = complex.positions[v * 4]!;
      placeholder[v * 3 + 1] = complex.positions[v * 4 + 1]!;
      placeholder[v * 3 + 2] = complex.positions[v * 4 + 2]!;
    }

    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(placeholder, 3));
    this.geometry.setAttribute('position4', new BufferAttribute(position4, 4));
    this.geometry.setIndex(new BufferAttribute(index, 1));

    // The whole 4D pipeline as a TSL node graph, evaluated per vertex:
    // rotate, translate, then the iterated perspective divide through w.
    const material = new LineBasicNodeMaterial({ color: options.color ?? 0xffffff });
    const p4 = attribute<'vec4'>('position4', 'vec4');
    const world = this.rotationUniform.mul(p4).add(this.translationUniform);
    const scale = this.viewDistanceUniform.div(
      this.viewDistanceUniform.sub(world.w).max(epsilon)
    );
    material.positionNode = world.xyz.mul(scale);

    this.object = new LineSegments(this.geometry, material);
    this.object.frustumCulled = false;
  }

  /** Uploads the 4D transform to the GPU — uniforms only, O(1). */
  update(transform?: TransformN): void {
    if (transform) {
      transformToGpuUniforms(
        transform,
        this.rotationUniform.value as Matrix4,
        this.translationUniform.value as Vector4
      );
    } else {
      (this.rotationUniform.value as Matrix4).copy(this.identity);
      (this.translationUniform.value as Vector4).set(0, 0, 0, 0);
    }
  }

  dispose(): void {
    this.geometry.dispose();
    const material = this.object.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material.dispose();
  }
}
