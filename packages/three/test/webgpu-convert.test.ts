import { describe, expect, it } from 'vitest';
import { Vector4 } from 'three';
import { Matrix4 } from 'three';
import { MatN, Rotor4, TransformN, VecN, rotationFromPlanes } from '@holotope/core';
import { transformToGpuUniforms } from '../src/webgpu/convert.js';

describe('transformToGpuUniforms', () => {
  it.each(['matrix', 'rotor'] as const)(
    'GPU mat4 · vec4 + translation matches TransformN.applyToPoint (%s backend)',
    (backend) => {
      const planes = [
        { i: 0, j: 3, angle: 0.8 },
        { i: 1, j: 2, angle: -1.3 },
        { i: 0, j: 1, angle: 0.4 }
      ];
      const rotation = backend === 'rotor' ? Rotor4.fromPlanes(planes) : rotationFromPlanes(4, planes);
      const transform = new TransformN(4, rotation, new VecN([0.5, -1, 2, -0.25]));

      const m4 = new Matrix4();
      const t4 = new Vector4();
      transformToGpuUniforms(transform, m4, t4);

      for (let trial = 0; trial < 10; trial++) {
        const p = [0, 0, 0, 0].map(() => Math.random() * 4 - 2);
        // Emulate the shader: rotation * p4 + translation.
        const gpu = new Vector4(p[0], p[1], p[2], p[3]).applyMatrix4(m4).add(t4);
        const cpu = transform.applyToPoint(new VecN(p));
        expect(gpu.x).toBeCloseTo(cpu.data[0]!, 10);
        expect(gpu.y).toBeCloseTo(cpu.data[1]!, 10);
        expect(gpu.z).toBeCloseTo(cpu.data[2]!, 10);
        expect(gpu.w).toBeCloseTo(cpu.data[3]!, 10);
      }
    }
  );

  it('rejects non-4D transforms', () => {
    expect(() =>
      transformToGpuUniforms(new TransformN(3, MatN.identity(3)), new Matrix4(), new Vector4())
    ).toThrow(/4D/);
  });
});
