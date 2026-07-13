import { describe, expect, it } from 'vitest';
import {
  HyperplaneSlice4,
  type FieldEvaluation4,
  type ImplicitField4
} from '@holotope/core';
import { SampledSlicedField3D } from '@holotope/three';

describe('SampledSlicedField3D', () => {
  it('keeps its headless sample and approximate surface inspectable', () => {
    const field: ImplicitField4 = {
      id: 'sphere',
      symmetries: [],
      sliceTheorems: [],
      evalCPU(point): FieldEvaluation4 {
        const magnitude = Math.hypot(point[0]!, point[1]!, point[2]!, point[3]!);
        return {
          value: magnitude * magnitude - 1,
          escaped: magnitude > 1,
          iterations: Math.round(magnitude * 8),
          magnitude,
          potential: Math.max(0, magnitude - 1),
          distance: Math.abs(magnitude - 1),
          orbitTrap: magnitude,
          finalPoint: [point[0]!, point[1]!, point[2]!, point[3]!]
        };
      }
    };
    const product = new SampledSlicedField3D(
      field,
      HyperplaneSlice4.axisAligned(3),
      {
        resolution: 13,
        extent: 1.3,
        colorForIteration: (iteration) => (iteration > 6 ? 0xff8844 : 0x4488ff)
      }
    );
    expect(product.approximate).toBe(true);
    expect(product.sample.count).toBe(13 ** 3);
    expect(product.sample.records).toHaveLength(13 ** 3);
    expect(product.triangleCount).toBeGreaterThan(200);
    expect(product.geometry.getAttribute('position').count).toBe(product.triangleCount * 3);
    expect(product.geometry.getAttribute('color').count).toBe(product.triangleCount * 3);
    expect(product.sourceCellOfFace(0)).toBeGreaterThanOrEqual(0);
    expect(() => product.sourceCellOfFace(product.triangleCount)).toThrow(/out of range/);
    product.dispose();
  });
});
