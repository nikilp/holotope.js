import { describe, expect, it } from 'vitest';
import {
  create600Cell,
  createCliffordCurve,
  createHypercube,
  create120Cell,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import { ProjectedSurfaceGPU } from '../src/webgpu/projected-surface-gpu.js';

// Construction-only tests: the node graph and static buffers build fine
// without a GPU; rendering is verified in the browser showcase.
describe('ProjectedSurfaceGPU', () => {
  it('fan-triangulates all face kinds into a static 4D soup', () => {
    // Tesseract: 24 cuboid quads -> 48 triangles.
    const cube = new ProjectedSurfaceGPU(tetrahedralizeCuboidCells(createHypercube({ dim: 4 })));
    expect(cube.triangleCount).toBe(48);
    expect(cube.geometry.getAttribute('position4').count).toBe(48 * 3);

    // 600-cell: 1200 simplex triangles pass through.
    expect(new ProjectedSurfaceGPU(create600Cell()).triangleCount).toBe(1200);

    // 120-cell: 720 polygon pentagons -> 3 fan triangles each.
    expect(new ProjectedSurfaceGPU(create120Cell()).triangleCount).toBe(720 * 3);
  });

  it('rejects complexes without 2-cells', () => {
    expect(() => new ProjectedSurfaceGPU(createCliffordCurve())).toThrow(/no faces/);
  });
});

describe('ProjectedEdgesInstancedGPU', () => {
  it('shares one geometry across instances with identity defaults', async () => {
    const { create600Cell } = await import('@holotope/core');
    const { ProjectedEdgesInstancedGPU } = await import(
      '../src/webgpu/projected-edges-instanced-gpu.js'
    );
    const product = new ProjectedEdgesInstancedGPU(create600Cell(), { count: 8 });
    expect(product.geometry.instanceCount).toBe(8);
    // Identity default: column c of instance i is e_c.
    for (let i = 0; i < 8; i++) {
      for (let col = 0; col < 4; col++) {
        const a = product.geometry.getAttribute(`instanceRotationColumn${col}`);
        for (let c = 0; c < 4; c++) {
          expect(a.array[i * 4 + c]).toBe(c === col ? 1 : 0);
        }
      }
    }
  });

  it('setInstanceTransform writes columns that reproduce applyToPoint', async () => {
    const { Rotor4, TransformN, VecN, createHypercube } = await import('@holotope/core');
    const { ProjectedEdgesInstancedGPU } = await import(
      '../src/webgpu/projected-edges-instanced-gpu.js'
    );
    const product = new ProjectedEdgesInstancedGPU(createHypercube({ dim: 4 }), { count: 3 });
    const transform = new TransformN(
      4,
      Rotor4.fromPlanes([
        { i: 0, j: 3, angle: 0.8 },
        { i: 1, j: 2, angle: -0.5 }
      ]),
      new VecN([0.5, -1, 2, -0.25])
    );
    product.setInstanceTransform(1, transform);

    const col = (k: number, c: number): number =>
      product.geometry.getAttribute(`instanceRotationColumn${k}`).array[1 * 4 + c]!;
    const tr = (c: number): number =>
      product.geometry.getAttribute('instanceTranslation').array[1 * 4 + c]!;
    for (let trial = 0; trial < 5; trial++) {
      const p = [0, 0, 0, 0].map(() => Math.random() * 2 - 1);
      // The shader's column form: sum_k column_k * p_k + t.
      const gpu = [0, 1, 2, 3].map(
        (c) => col(0, c) * p[0]! + col(1, c) * p[1]! + col(2, c) * p[2]! + col(3, c) * p[3]! + tr(c)
      );
      const cpu = transform.applyToPoint(new VecN(p));
      for (let c = 0; c < 4; c++) expect(gpu[c]).toBeCloseTo(cpu.data[c]!, 5);
    }
    expect(() => product.setInstanceTransform(3, transform)).toThrow(/out of range/);
  });
});
