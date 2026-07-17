import { describe, expect, it } from 'vitest';
import {
  HyperplaneSlice4,
  type FieldEvaluation4,
  type ImplicitField4
} from '@holotope/core';
import { FieldRelief3D, sampleFractalPalette } from '@holotope/three';

describe('FieldRelief3D', () => {
  const field: ImplicitField4 = {
    id: 'radial-relief-test',
    symmetries: [],
    sliceTheorems: [],
    evalCPU(point): FieldEvaluation4 {
      const magnitude = Math.hypot(point[0]!, point[1]!, point[2]!, point[3]!);
      return {
        value: magnitude - 1,
        escaped: magnitude > 1,
        iterations: Math.round(magnitude * 10),
        magnitude,
        potential: Math.max(0, magnitude - 1),
        distance: Math.abs(magnitude - 1),
        orbitTrap: magnitude,
        finalPoint: [point[0]!, point[1]!, point[2]!, point[3]!]
      };
    }
  };

  it('retains every R4 source and record behind the relief mesh', () => {
    const slice = HyperplaneSlice4.axisAligned(3, 0.25);
    const relief = new FieldRelief3D(field, slice, {
      resolution: 9,
      extent: 1.2,
      planeAxes: [0, 2],
      planeOffset: -0.3,
      heightFor: ({ record }) => record.magnitude * 0.5,
      colorFor: ({ record }) => sampleFractalPalette('ember', record.magnitude / 2)
    });
    expect(relief.approximate).toBe(true);
    expect(relief.records).toHaveLength(9 ** 2);
    expect(relief.sourcePoints).toHaveLength(9 ** 2 * 4);
    expect(relief.heights).toHaveLength(9 ** 2);
    expect(relief.triangleCount).toBe(8 ** 2 * 2);
    expect(relief.geometry.getAttribute('position').count).toBe(9 ** 2);
    expect(relief.geometry.getAttribute('color').count).toBe(9 ** 2);
    expect(relief.geometry.index?.count).toBe(relief.triangleCount * 3);
    // Axis 3 is the slice normal; every retained source stays at w=0.25.
    for (let sample = 0; sample < relief.records.length; sample++) {
      expect(relief.sourcePoints[sample * 4 + 3]).toBeCloseTo(0.25, 12);
    }
    relief.dispose();
  });

  it('validates sampling and presentation callbacks', () => {
    const slice = HyperplaneSlice4.axisAligned(3);
    expect(
      () =>
        new FieldRelief3D(field, slice, {
          resolution: 1,
          extent: 1,
          heightFor: () => 0
        })
    ).toThrow(/resolution/);
    expect(
      () =>
        new FieldRelief3D(field, slice, {
          resolution: 3,
          extent: 1,
          planeAxes: [1, 1],
          heightFor: () => 0
        })
    ).toThrow(/planeAxes/);
    expect(
      () =>
        new FieldRelief3D(field, slice, {
          resolution: 3,
          extent: 1,
          heightFor: () => Number.NaN
        })
    ).toThrow(/non-finite/);
  });
});
