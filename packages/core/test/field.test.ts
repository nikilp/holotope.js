import { describe, expect, it } from 'vitest';
import {
  BicomplexJuliaField,
  HyperplaneSlice4,
  QuaternionJuliaField,
  bicomplexToIdempotent,
  evaluateComplexQuadratic,
  extractSampledIsosurface3,
  idempotentToBicomplex,
  rotateQuaternionJuliaSymmetry,
  sampleFieldPoints4,
  sampleFieldSlice3,
  traceFieldSliceRay3,
  type FieldEvaluation4,
  type ImplicitField4
} from '@holotope/core';

describe('ImplicitField4 CPU contract', () => {
  it('matches the complex quadratic reference bit-for-bit on the symmetry plane', () => {
    const field = new QuaternionJuliaField({
      parameter: [0.27, 0, 0, -0.68],
      maxIterations: 48,
      escapeRadius: 4
    });
    for (let y = -8; y <= 8; y++) {
      for (let x = -8; x <= 8; x++) {
        const imaginary = x / 7;
        const real = y / 7;
        const quaternion = field.evalCPU([imaginary, 0, 0, real]);
        const complex = evaluateComplexQuadratic(
          [imaginary, real],
          [field.parameter[0], field.parameter[3]],
          field.options
        );
        expect(quaternion.escaped).toBe(complex.escaped);
        expect(quaternion.iterations).toBe(complex.iterations);
        expect(Object.is(quaternion.magnitude, complex.magnitude)).toBe(true);
        expect(Object.is(quaternion.potential, complex.potential)).toBe(true);
        expect(Object.is(quaternion.distance, complex.distance)).toBe(true);
        expect(Object.is(quaternion.finalPoint[0], complex.finalPoint[0])).toBe(true);
        expect(quaternion.finalPoint[1] === 0).toBe(true);
        expect(quaternion.finalPoint[2] === 0).toBe(true);
        expect(Object.is(quaternion.finalPoint[3], complex.finalPoint[1])).toBe(true);
      }
    }
  });

  it('is equivariant under the declared circle action in the j-k plane', () => {
    const field = new QuaternionJuliaField({
      parameter: [0.21, 0, 0, -0.71],
      maxIterations: 36
    });
    for (let sample = 0; sample < 80; sample++) {
      const point = [
        Math.sin(sample * 1.7),
        Math.cos(sample * 0.37) * 0.8,
        Math.sin(sample * 0.53) * 0.8,
        Math.cos(sample * 1.11)
      ] as const;
      const angle = sample * 0.239;
      const rotatedPoint = rotateQuaternionJuliaSymmetry(point, angle);
      const original = field.evalCPU(point);
      const rotated = field.evalCPU(rotatedPoint);
      expect(rotated.escaped).toBe(original.escaped);
      expect(rotated.iterations).toBe(original.iterations);
      expect(rotated.magnitude).toBeCloseTo(original.magnitude, 11);
      expect(rotated.potential).toBeCloseTo(original.potential, 11);
      expect(rotated.distance).toBeCloseTo(original.distance, 11);
      const expectedFinal = rotateQuaternionJuliaSymmetry(original.finalPoint, angle);
      for (let coordinate = 0; coordinate < 4; coordinate++) {
        expect(rotated.finalPoint[coordinate]).toBeCloseTo(expectedFinal[coordinate]!, 10);
      }
    }
  });

  it('rejects parameters that would invalidate its declared symmetry', () => {
    expect(
      () => new QuaternionJuliaField({ parameter: [0, 0.1, 0, -0.5] })
    ).toThrow(/real,i/);
  });

  it('gives identical scalar sections for every hyperplane containing the symmetry plane', () => {
    const field = new QuaternionJuliaField({
      parameter: [0.156, 0, 0, -0.8],
      maxIterations: 40,
      escapeRadius: 4
    });
    const reference = sampleFieldSlice3(
      field,
      new HyperplaneSlice4({ normal: [0, 0, 1, 0] }),
      { resolution: 7, extent: 1.25 }
    );
    for (const angle of [0.19, 0.73, 1.21, 2.18]) {
      const compared = sampleFieldSlice3(
        field,
        new HyperplaneSlice4({ normal: [0, Math.cos(angle), Math.sin(angle), 0] }),
        { resolution: 7, extent: 1.25 }
      );
      expect(compared.escaped).toEqual(reference.escaped);
      expect(compared.iterations).toEqual(reference.iterations);
      for (let index = 0; index < reference.count; index++) {
        expect(compared.values[index]).toBeCloseTo(reference.values[index]!, 11);
        expect(compared.distances[index]).toBeCloseTo(reference.distances[index]!, 11);
        expect(compared.potentials[index]).toBeCloseTo(reference.potentials[index]!, 11);
      }
    }
  });
});

describe('bicomplex product field', () => {
  it('round-trips the idempotent change of basis exactly', () => {
    const point = [1.5, -2.25, 0.75, 3.5] as const;
    const factors = bicomplexToIdempotent(point);
    expect(idempotentToBicomplex(factors.first, factors.second)).toEqual(point);
  });

  it('is exactly the product of its two complex reference iterations', () => {
    const field = new BicomplexJuliaField({
      parameter: [0.1, -0.2, 0.05, -0.65],
      maxIterations: 40
    });
    for (let sample = 0; sample < 60; sample++) {
      const point = [
        Math.sin(sample * 0.7),
        Math.cos(sample * 0.31),
        Math.sin(sample * 1.3) * 0.5,
        Math.cos(sample * 0.91)
      ] as const;
      const coordinates = bicomplexToIdempotent(point);
      const expectedFirst = evaluateComplexQuadratic(
        coordinates.first,
        field.factorParameters.first,
        field.options
      );
      const expectedSecond = evaluateComplexQuadratic(
        coordinates.second,
        field.factorParameters.second,
        field.options
      );
      const record = field.evalCPU(point);
      expect(record.factors[0]).toEqual(expectedFirst);
      expect(record.factors[1]).toEqual(expectedSecond);
      expect(record.finalPoint).toEqual(
        idempotentToBicomplex(expectedFirst.finalPoint, expectedSecond.finalPoint)
      );
      expect(record.distance).toBe(
        Math.hypot(
          expectedFirst.escaped ? expectedFirst.distance : 0,
          expectedSecond.escaped ? expectedSecond.distance : 0
        ) / Math.SQRT2
      );
    }
  });
});

describe('headless field probes and sampled slices', () => {
  const sphere: ImplicitField4 = {
    id: 'unit-four-sphere',
    symmetries: [],
    sliceTheorems: [],
    evalCPU(point): FieldEvaluation4 {
      const radius = Math.hypot(point[0]!, point[1]!, point[2]!, point[3]!);
      return {
        value: radius * radius - 1,
        escaped: radius > 1,
        iterations: Math.round(radius * 10),
        magnitude: radius,
        potential: Math.max(0, radius - 1),
        distance: Math.abs(radius - 1),
        orbitTrap: radius,
        finalPoint: [point[0]!, point[1]!, point[2]!, point[3]!]
      };
    }
  };

  it('batches packed R4 points without a browser or renderer', () => {
    const batch = sampleFieldPoints4(
      sphere,
      new Float64Array([0, 0, 0, 0, 2, 0, 0, 0])
    );
    expect(batch.count).toBe(2);
    expect([...batch.values]).toEqual([-1, 3]);
    expect([...batch.escaped]).toEqual([0, 1]);
    expect(batch.escapedCount).toBe(1);
    expect([...batch.finalPoints]).toEqual([0, 0, 0, 0, 2, 0, 0, 0]);
    expect(batch.records).toHaveLength(2);
    expect(batch.records[1]!.magnitude).toBe(2);
  });

  it('preserves family-specific records through slice sampling', () => {
    const field = new BicomplexJuliaField({
      parameter: idempotentToBicomplex([0, -1], [0.156, -0.8]),
      maxIterations: 16
    });
    const sample = sampleFieldSlice3(field, HyperplaneSlice4.axisAligned(3), {
      resolution: 3,
      extent: 0.25
    });
    expect(sample.records).toHaveLength(27);
    expect(sample.records[13]!.factors).toHaveLength(2);
    expect(sample.records[13]!.factors[0]).toEqual(
      evaluateComplexQuadratic([0, 0], field.factorParameters.first, field.options)
    );
  });

  it('samples an affine 3-flat and extracts an explicitly approximate surface', () => {
    const slice = HyperplaneSlice4.axisAligned(3, 0);
    const sample = sampleFieldSlice3(sphere, slice, { resolution: 17, extent: 1.4 });
    expect(sample.count).toBe(17 ** 3);
    expect(sample.shape).toEqual([17, 17, 17]);
    expect(sample.values[8 + 17 * (8 + 17 * 8)]).toBeCloseTo(-1, 14);
    const surface = extractSampledIsosurface3(sample);
    expect(surface.approximate).toBe(true);
    expect(surface.triangleCount).toBeGreaterThan(500);
    expect(surface.positions.length).toBe(surface.triangleCount * 9);
    expect(surface.iterations.length).toBe(surface.triangleCount * 3);
    expect(surface.sourceCells.length).toBe(surface.triangleCount);
    for (let vertex = 0; vertex < surface.positions.length / 3; vertex += 97) {
      const offset = vertex * 3;
      expect(
        Math.hypot(
          surface.positions[offset]!,
          surface.positions[offset + 1]!,
          surface.positions[offset + 2]!
        )
      ).toBeCloseTo(1, 1);
    }
  });
});

describe('headless affine-slice ray hits', () => {
  const field = new QuaternionJuliaField({
    parameter: [0, 0, 0, 0],
    maxIterations: 40,
    escapeRadius: 4
  });
  const slice = HyperplaneSlice4.axisAligned(3);

  it('finds and retains an inspectable R4 record at the unit-ball boundary', () => {
    const result = traceFieldSliceRay3(field, slice, [2, 0, 0], [-1, 0, 0], {
      extent: 2.5,
      surfaceEpsilon: 1e-5,
      normalEpsilon: 1e-4,
      maxSteps: 256
    });
    expect(result.hit).toBe(true);
    if (!result.hit) return;
    expect(result.position[0]).toBeCloseTo(1, 4);
    expect(result.position[1]).toBe(0);
    expect(result.point4[0]).toBeCloseTo(result.position[0], 12);
    expect(result.point4.slice(1)).toEqual([0, 0, 0]);
    expect(result.normal[0]).toBeGreaterThan(0.99);
    expect(result.startedInside).toBe(false);
    expect(result.record).toEqual(field.evalCPU(result.point4));
  });

  it('reports box misses, bounded-volume exits, and starts inside explicitly', () => {
    expect(traceFieldSliceRay3(field, slice, [3, 3, 0], [1, 0, 0], { extent: 2 })).toEqual({
      hit: false,
      reason: 'box',
      steps: 0
    });
    const miss = traceFieldSliceRay3(field, slice, [2, 1.5, 0], [-1, 0, 0], {
      extent: 2.5,
      maxSteps: 256
    });
    expect(miss.hit).toBe(false);
    if (!miss.hit) expect(miss.reason).toBe('bounds');

    const inside = traceFieldSliceRay3(field, slice, [0, 0, 0], [1, 0, 0]);
    expect(inside.hit).toBe(true);
    if (inside.hit) {
      expect(inside.startedInside).toBe(true);
      expect(inside.distance).toBe(0);
      expect(inside.normal).toEqual([-1, 0, 0]);
    }
  });

  it('requires an explicit safety policy for undeclared distance estimators', () => {
    const undeclared: ImplicitField4 = {
      id: 'undeclared',
      symmetries: [],
      sliceTheorems: [],
      evalCPU: (point) => field.evalCPU(point)
    };
    expect(() => traceFieldSliceRay3(undeclared, slice, [2, 0, 0], [-1, 0, 0])).toThrow(
      /stepSafety/
    );
    expect(() =>
      traceFieldSliceRay3(undeclared, slice, [2, 0, 0], [-1, 0, 0], { stepSafety: 0.5 })
    ).not.toThrow();
  });
});
