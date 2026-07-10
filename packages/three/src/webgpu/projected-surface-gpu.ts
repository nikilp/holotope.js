import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, Vector4 } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, uniform } from 'three/tsl';
import type { CellComplex, TransformN } from '@holotope/core';
import { transformToGpuUniforms } from './convert.js';

export interface ProjectedSurfaceGPUOptions {
  color?: number;
  opacity?: number;
  /** Iterated-perspective view distance along w. Default 4. */
  viewDistance?: number;
  /** Denominator clamp guarding the perspective divide. Default 1e-4. */
  epsilon?: number;
  /** Material to install the projection node on (overrides color/opacity). */
  material?: MeshStandardNodeMaterial;
}

/**
 * GPU render product: the 2-faces of a 4D cell complex, projected
 * 4D → 3D **in the vertex shader** via TSL — the surface counterpart of
 * `ProjectedEdgesGPU`.
 *
 * Faces expand once, at construction, into a static triangle soup of 4D
 * positions (simplex triangles directly; cuboid quads and polygon loops
 * fan-triangulated from their first corner, matching ProjectedSurface3D).
 * Each `update` writes only the rotation/translation uniforms. Flat
 * shading comes from fragment derivatives, so normals need no CPU
 * recomputation either — the entire per-frame cost is a handful of
 * uniforms.
 *
 * Requires `WebGPURenderer` (WGSL or its WebGL2/GLSL fallback — both
 * compile from the same node graph).
 */
export class ProjectedSurfaceGPU {
  readonly complex: CellComplex;
  readonly geometry: BufferGeometry;
  readonly object: Mesh;
  readonly triangleCount: number;

  private readonly rotationUniform = uniform(new Matrix4());
  private readonly translationUniform = uniform(new Vector4(0, 0, 0, 0));
  readonly viewDistanceUniform;
  private readonly identity = new Matrix4();

  constructor(complex: CellComplex, options: ProjectedSurfaceGPUOptions = {}) {
    if (complex.ambientDim !== 4) {
      throw new Error(`ProjectedSurfaceGPU: requires ambientDim 4, got ${complex.ambientDim}`);
    }
    this.complex = complex;
    this.viewDistanceUniform = uniform(options.viewDistance ?? 4);
    const epsilon = options.epsilon ?? 1e-4;

    const faceGroups = complex.cellsOfDim(2);
    if (faceGroups.length === 0) {
      throw new Error('ProjectedSurfaceGPU: cell complex has no faces (2-cells)');
    }

    // Fan-triangulate into a soup of source vertex indices.
    const soupToVertex: number[] = [];
    for (const g of faceGroups) {
      if (g.verticesPerCell < 3) {
        throw new Error(`ProjectedSurfaceGPU: 2-cell arity ${g.verticesPerCell} cannot form a face`);
      }
      const cellCount = g.indices.length / g.verticesPerCell;
      for (let cell = 0; cell < cellCount; cell++) {
        const base = cell * g.verticesPerCell;
        for (let k = 1; k < g.verticesPerCell - 1; k++) {
          soupToVertex.push(g.indices[base]!, g.indices[base + k]!, g.indices[base + k + 1]!);
        }
      }
    }
    this.triangleCount = soupToVertex.length / 3;

    // Static 4D soup positions; placeholder vec3 attributes exist only
    // for three's bookkeeping (positionNode overrides, flatShading
    // derives normals in the fragment stage).
    const position4 = new Float32Array(soupToVertex.length * 4);
    const placeholder = new Float32Array(soupToVertex.length * 3);
    for (let s = 0; s < soupToVertex.length; s++) {
      const v = soupToVertex[s]!;
      for (let c = 0; c < 4; c++) position4[s * 4 + c] = complex.positions[v * 4 + c]!;
      for (let c = 0; c < 3; c++) placeholder[s * 3 + c] = complex.positions[v * 4 + c]!;
    }

    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(placeholder, 3));
    this.geometry.setAttribute('position4', new BufferAttribute(position4, 4));

    const material =
      options.material ??
      new MeshStandardNodeMaterial({
        color: options.color ?? 0x7fd4ff,
        side: DoubleSide,
        flatShading: true,
        transparent: true,
        opacity: options.opacity ?? 0.45,
        depthWrite: false
      });
    const p4 = attribute<'vec4'>('position4', 'vec4');
    const world = this.rotationUniform.mul(p4).add(this.translationUniform);
    const scale = this.viewDistanceUniform.div(
      this.viewDistanceUniform.sub(world.w).max(epsilon)
    );
    material.positionNode = world.xyz.mul(scale);

    this.object = new Mesh(this.geometry, material);
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
