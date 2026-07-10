import { describe, expect, it } from 'vitest';
import { Vector4 } from 'three';
import { Matrix4 } from 'three';
import { HyperplaneSlice4, MatN, Rotor4, TransformN, VecN, rotationFromPlanes } from '@holotope/core';
import { sliceToGpuUniforms, transformToGpuUniforms } from '../src/webgpu/convert.js';

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

describe('sliceToGpuUniforms', () => {
  it('frame · p gives the slice-frame coords in xyz and the normal dot in w', () => {
    const slice = new HyperplaneSlice4({ normal: new VecN([1, -2, 0.5, 3]), offset: 0.4 });
    const frame = new Matrix4();
    sliceToGpuUniforms(slice, frame);

    for (let trial = 0; trial < 10; trial++) {
      const p = [0, 0, 0, 0].map(() => Math.random() * 4 - 2);
      const gpu = new Vector4(p[0], p[1], p[2], p[3]).applyMatrix4(frame);
      for (let k = 0; k < 3; k++) {
        const bk = slice.basis[k]!;
        const expected = bk[0]! * p[0]! + bk[1]! * p[1]! + bk[2]! * p[2]! + bk[3]! * p[3]!;
        expect(gpu.getComponent(k)).toBeCloseTo(expected, 10);
      }
      // w minus the offset is exactly the slicer's signed distance.
      expect(gpu.w - slice.offset).toBeCloseTo(
        slice.signedDistance(p[0]!, p[1]!, p[2]!, p[3]!),
        10
      );
    }
  });

  it('tracks setNormal reorientation', () => {
    const slice = HyperplaneSlice4.axisAligned(3, 0);
    const frame = new Matrix4();
    slice.setNormal([0, 1, 1, 1]);
    sliceToGpuUniforms(slice, frame);
    const e = frame.elements; // column-major; row 3 = elements[3,7,11,15]
    const s = Math.sqrt(3);
    expect(e[3]).toBeCloseTo(0, 12);
    expect(e[7]).toBeCloseTo(1 / s, 12);
    expect(e[11]).toBeCloseTo(1 / s, 12);
    expect(e[15]).toBeCloseTo(1 / s, 12);
  });
});
