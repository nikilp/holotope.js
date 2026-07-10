import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, Vector4 } from 'three';
import { MeshStandardNodeMaterial, StorageBufferAttribute } from 'three/webgpu';
import { float, instanceIndex, storage, uint, uniform, wgslFn } from 'three/tsl';
import type { CellComplex, HyperplaneSlice4, TransformN } from '@holotope/core';
import { sliceToGpuUniforms, transformToGpuUniforms } from './convert.js';

export interface SlicedComplexGPUOptions {
  /** Material for the section mesh; positionNode is installed on it. */
  material?: MeshStandardNodeMaterial;
  /**
   * Signed-distance snap threshold for the degeneracy policy. The kernel
   * runs in Float32, so the default is coarser than the CPU slicer's 1e-9.
   */
  epsilon?: number;
}

/** Minimal slice of the WebGPURenderer API this product needs. */
export interface ComputeCapableRenderer {
  compute(node: unknown): void;
  getArrayBufferAsync(attribute: unknown): Promise<ArrayBuffer>;
}

/**
 * GPU render product: marching-tetrahedra cross-sections computed **in a
 * compute shader**. The tetrahedra and 4D positions upload once; each
 * frame a WGSL kernel classifies every tet against the hyperplane and
 * writes the section triangles into a storage buffer that the vertex
 * stage reads directly — the geometry never round-trips through the CPU.
 *
 * Instead of atomic compaction, every tetrahedron owns a fixed window of
 * 6 output vertices (2 triangles worst case). Non-crossing tets write
 * zeros: degenerate zero-area triangles the rasterizer discards for
 * free. This keeps the kernel atomic-free and makes provenance implicit
 * — triangle `f` came from tet `f >> 1`, matching the CPU slicer's
 * emission order exactly (same epsilon snap, same crossing-edge order),
 * so the two paths are comparable triangle-for-triangle.
 *
 * Output vertices are in the slice's own display frame (like
 * `SlicedComplex3D` without a projection), with the source tet index in
 * each vertex's w component for readback verification.
 *
 * Requires a true WebGPU backend — compute shaders have no WebGL2
 * fallback. Check `renderer.backend.isWebGPUBackend` before constructing.
 */
export class SlicedComplexGPU {
  readonly complex: CellComplex;
  readonly slice: HyperplaneSlice4;
  readonly geometry: BufferGeometry;
  readonly object: Mesh;
  /** Number of tetrahedra marched per dispatch. */
  readonly tetCount: number;

  private readonly computeNode: unknown;
  private readonly triangleBuffer: StorageBufferAttribute;
  private readonly rotationUniform = uniform(new Matrix4());
  private readonly translationUniform = uniform(new Vector4(0, 0, 0, 0));
  private readonly frameUniform = uniform(new Matrix4());
  private readonly offsetUniform = uniform(0);
  private readonly identity = new Matrix4();

  constructor(complex: CellComplex, slice: HyperplaneSlice4, options: SlicedComplexGPUOptions = {}) {
    if (complex.ambientDim !== 4) {
      throw new Error(`SlicedComplexGPU: requires ambientDim 4, got ${complex.ambientDim}`);
    }
    const tetGroups = complex
      .cellsOfDim(3)
      .filter((g) => g.kind === 'simplex' && g.verticesPerCell === 4);
    if (tetGroups.length === 0) {
      throw new Error(
        'SlicedComplexGPU: complex has no tetrahedral 3-cells — call tetrahedralizeCuboidCells(complex) first'
      );
    }
    this.complex = complex;
    this.slice = slice;

    let tetIndexLength = 0;
    for (const g of tetGroups) tetIndexLength += g.indices.length;
    const tets = new Uint32Array(tetIndexLength);
    let offset = 0;
    for (const g of tetGroups) {
      tets.set(g.indices, offset);
      offset += g.indices.length;
    }
    this.tetCount = tets.length / 4;
    const maxVertices = this.tetCount * 6;

    const positions4 = new Float32Array(complex.positions.length);
    positions4.set(complex.positions);
    const positionBuffer = new StorageBufferAttribute(positions4, 4);
    const tetBuffer = new StorageBufferAttribute(tets, 4);
    this.triangleBuffer = new StorageBufferAttribute(new Float32Array(maxVertices * 4), 4);

    // Crossing point on edge a→b (same interpolation as the CPU
    // emitCrossing), expressed in the slice display frame (rows 0–2 of
    // the frame matrix) and tagged with the source tet index in w.
    const crossing = wgslFn(/* wgsl */ `
      fn crossing(frame: mat4x4f, a: vec4f, b: vec4f, sa: f32, sb: f32, tet: u32) -> vec4f {
        let t = sa / (sa - sb);
        let p = mix(a, b, t);
        return vec4f(dot(frame[0], p), dot(frame[1], p), dot(frame[2], p), f32(tet));
      }
    `);

    // The marching kernel, one thread per tetrahedron. A direct WGSL
    // transcription of sliceTetrahedra's inner loop: same signed-distance
    // snap, same neg/nonneg partition order, same crossing-edge emission
    // order and quad triangulation — parity with the CPU golden path is
    // the whole point.
    const march = wgslFn(
      /* wgsl */ `
      fn march(
        positions: ptr<storage, array<vec4f>, read_write>,
        tets: ptr<storage, array<vec4u>, read_write>,
        tris: ptr<storage, array<vec4f>, read_write>,
        rotation: mat4x4f,
        translation: vec4f,
        frame: mat4x4f,
        planeOffset: f32,
        epsilon: f32,
        tetCount: u32,
        index: u32
      ) -> void {
        if (index >= tetCount) { return; }
        let tet = tets[index];
        let base = index * 6u;

        var world: array<vec4f, 4>;
        var dist: array<f32, 4>;
        var neg: array<u32, 4>;
        var nonneg: array<u32, 4>;
        var nn = 0u;
        var np = 0u;
        for (var v = 0u; v < 4u; v++) {
          let p = rotation * positions[tet[v]] + translation;
          world[v] = p;
          var d = dot(frame[3], p) - planeOffset;
          if (abs(d) <= epsilon) { d = 0.0; }
          dist[v] = d;
          if (d < 0.0) { neg[nn] = v; nn++; } else { nonneg[np] = v; np++; }
        }

        // Empty by default: zero slots collapse to degenerate triangles.
        for (var s = 0u; s < 6u; s++) { tris[base + s] = vec4f(0.0); }
        if (nn == 0u || nn == 4u) { return; }

        if (nn == 1u) {
          for (var k = 0u; k < 3u; k++) {
            tris[base + k] = crossing(frame, world[neg[0]], world[nonneg[k]], dist[neg[0]], dist[nonneg[k]], index);
          }
        } else if (nn == 3u) {
          for (var k = 0u; k < 3u; k++) {
            tris[base + k] = crossing(frame, world[neg[k]], world[nonneg[0]], dist[neg[k]], dist[nonneg[0]], index);
          }
        } else {
          // 2-2 split: quad (n0,p0) (n0,p1) (n1,p1) (n1,p0) as two triangles.
          tris[base] = crossing(frame, world[neg[0]], world[nonneg[0]], dist[neg[0]], dist[nonneg[0]], index);
          tris[base + 1u] = crossing(frame, world[neg[0]], world[nonneg[1]], dist[neg[0]], dist[nonneg[1]], index);
          tris[base + 2u] = crossing(frame, world[neg[1]], world[nonneg[1]], dist[neg[1]], dist[nonneg[1]], index);
          tris[base + 3u] = tris[base];
          tris[base + 4u] = tris[base + 2u];
          tris[base + 5u] = crossing(frame, world[neg[1]], world[nonneg[0]], dist[neg[1]], dist[nonneg[0]], index);
        }
      }
    `,
      // The wgslFn proxy forwards build() to its FunctionNode, satisfying
      // CodeNodeInclude at runtime; the typings only miss the proxying.
      [crossing] as unknown as Parameters<typeof wgslFn>[1]
    );

    this.computeNode = (
      march({
        positions: storage(positionBuffer, 'vec4', complex.vertexCount),
        tets: storage(tetBuffer, 'uvec4', this.tetCount),
        tris: storage(this.triangleBuffer, 'vec4', maxVertices),
        rotation: this.rotationUniform,
        translation: this.translationUniform,
        frame: this.frameUniform,
        planeOffset: this.offsetUniform,
        epsilon: float(options.epsilon ?? 1e-6),
        tetCount: uint(this.tetCount),
        index: instanceIndex
      }) as unknown as { compute(count: number): unknown }
    ).compute(this.tetCount);

    // Placeholder attribute for three's draw-count bookkeeping; the
    // vertex stage reads real positions straight from the storage buffer
    // (toAttribute binds it as a per-vertex attribute for the render pass).
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array(maxVertices * 3), 3));

    const material =
      options.material ??
      new MeshStandardNodeMaterial({ color: 0xff9d5c, side: DoubleSide, flatShading: true });
    material.positionNode = storage(this.triangleBuffer, 'vec4', maxVertices).toAttribute().xyz;

    this.object = new Mesh(this.geometry, material);
    this.object.frustumCulled = false; // positions live on the GPU

    this.update();
  }

  /**
   * Writes the 4D transform and slice frame to uniforms, then dispatches
   * the marching kernel — no CPU geometry work, no buffer re-upload.
   * Without a renderer this only updates uniforms (useful for tests).
   */
  update(transform?: TransformN, renderer?: ComputeCapableRenderer): void {
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
    sliceToGpuUniforms(this.slice, this.frameUniform.value as Matrix4);
    this.offsetUniform.value = this.slice.offset;
    if (renderer) renderer.compute(this.computeNode);
  }

  /**
   * Reads the section back from the GPU: packed vec4 vertices (xyz =
   * slice-frame position, w = source tet index), 6 per tetrahedron with
   * all-zero padding for non-emitted slots. For verification against the
   * CPU slicer, not for the render path.
   */
  async readSection(renderer: ComputeCapableRenderer): Promise<Float32Array> {
    return new Float32Array(await renderer.getArrayBufferAsync(this.triangleBuffer));
  }

  /** Uniform snapshot of the hyperplane frame — rows b0, b1, b2, normal. */
  get frameMatrix(): Matrix4 {
    return this.frameUniform.value as Matrix4;
  }

  dispose(): void {
    this.geometry.dispose();
    const material = this.object.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material.dispose();
  }
}
