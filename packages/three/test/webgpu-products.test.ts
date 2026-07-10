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
