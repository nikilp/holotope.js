import { describe, expect, it } from 'vitest';
import { Ray, Vector3, type Node } from 'three/webgpu';
import { dot, max, select, vec4 } from 'three/tsl';
import {
  create600Cell,
  createCliffordCurve,
  createHypercube,
  create120Cell,
  tetrahedralizeCuboidCells,
  type FieldEvaluation4,
  type ImplicitField4
} from '@holotope/core';
import { ProjectedSurfaceGPU } from '../src/webgpu/projected-surface-gpu.js';
import { QuaternionJuliaGPU, compareQuaternionJuliaGPU } from '../src/webgpu/quaternion-julia-gpu.js';
import { RaymarchedQuaternionJulia3D } from '../src/webgpu/raymarched-quaternion-julia.js';
import { BicomplexJuliaGPU } from '../src/webgpu/bicomplex-julia-gpu.js';
import { RaymarchedBicomplexJulia3D } from '../src/webgpu/raymarched-bicomplex-julia.js';
import type { ImplicitFieldNode4 } from '../src/webgpu/implicit-field-node4.js';
import { RaymarchedField3D } from '../src/webgpu/raymarched-field.js';
import { intersectRaymarchedRepresentation } from '../src/webgpu/representation-hit.js';
import { SettledSamplingState } from '../src/webgpu/settled-supersampling.js';

// Construction-only tests: the node graph and static buffers build fine
// without a GPU; rendering is verified in the browser showcase.

class UnitSphereField4 implements ImplicitField4 {
  readonly id = 'test-unit-sphere';
  readonly symmetries = [];
  readonly sliceTheorems = [];

  evalCPU(point: ArrayLike<number>): FieldEvaluation4 {
    const coordinates = [point[0]!, point[1]!, point[2]!, point[3]!] as const;
    const magnitude = Math.hypot(...coordinates);
    const distance = Math.max(0, magnitude - 1);
    return {
      value: magnitude - 1,
      escaped: magnitude > 1,
      iterations: 1,
      magnitude,
      potential: distance,
      distance,
      orbitTrap: magnitude,
      finalPoint: coordinates
    };
  }
}

class UnitSphereNode4 implements ImplicitFieldNode4 {
  readonly field = new UnitSphereField4();
  readonly iterationLimit = 1;
  readonly recommendedStepSafety = 0.9;

  evaluate(point: Node<'vec4'>): Node<'vec4'> {
    const signedDistance = dot(point, point).sqrt().sub(1);
    const outside = signedDistance.greaterThan(0);
    return vec4(max(signedDistance, 0), 1, point.w, select(outside, 1, 0));
  }
}

describe('SettledSamplingState', () => {
  it('settles only after the requested number of unchanged frames', () => {
    const state = new SettledSamplingState(2);
    expect(state.observe([1, 2, 3])).toBe(false);
    expect(state.observe([1, 2, 3])).toBe(false);
    expect(state.observe([1, 2, 3])).toBe(true);
    expect(state.stableFrames).toBe(2);

    expect(state.observe([1, 2, 4])).toBe(false);
    expect(state.stableFrames).toBe(0);
    expect(state.settled).toBe(false);
  });

  it('invalidates explicitly and rejects unstable signatures', () => {
    const state = new SettledSamplingState(0);
    expect(state.observe([7])).toBe(true);
    state.invalidate();
    expect(state.settled).toBe(false);
    expect(state.stableFrames).toBe(0);
    expect(() => state.observe([Number.NaN])).toThrow(/finite/);
    expect(() => new SettledSamplingState(-1)).toThrow(/non-negative integer/);
    expect(() => new SettledSamplingState(2, -1)).toThrow(/epsilon/);
  });

  it('can treat asymptotic camera damping as stable within an explicit tolerance', () => {
    const state = new SettledSamplingState(1, 1e-6);
    expect(state.observe([1, 2])).toBe(false);
    expect(state.observe([1 + 5e-7, 2 - 5e-7])).toBe(true);
    expect(state.observe([1 + 2e-5, 2])).toBe(false);
  });
});

describe('RaymarchedField3D contract', () => {
  it('accepts a third field without copying a family-specific renderer', async () => {
    const { HyperplaneSlice4 } = await import('@holotope/core');
    const fieldNode = new UnitSphereNode4();
    const slice = HyperplaneSlice4.axisAligned(3);
    const product = new RaymarchedField3D(fieldNode, slice);

    expect(product.field).toBe(fieldNode.field);
    expect(product.fieldNode).toBe(fieldNode);
    expect(product.slice).toBe(slice);
    expect(product.stepSafety).toBe(fieldNode.recommendedStepSafety);
    expect(product.object.geometry.getAttribute('position').count).toBe(24);
    const revision = product.revision;
    slice.offset = 0.25;
    expect(() => product.update()).not.toThrow();
    expect(product.revision).toBe(revision + 1);
    product.object.position.x = 10;
    const intersection = product.intersectRay(
      new Ray(new Vector3(12, 0, 0), new Vector3(-1, 0, 0))
    );
    const sectionRadius = Math.sqrt(1 - slice.offset * slice.offset);
    expect(intersection).not.toBeNull();
    expect(intersection!.point.x).toBeCloseTo(10 + sectionRadius, 2);
    expect(intersection!.pointLocal.x).toBeCloseTo(sectionRadius, 2);
    expect(intersection!.point4[0]).toBeCloseTo(sectionRadius, 2);
    expect(intersection!.normal.x).toBeGreaterThan(0.99);
    expect(intersection!.record).toEqual(fieldNode.field.evalCPU(intersection!.point4));
    const representationHit = intersectRaymarchedRepresentation(
      product,
      new Ray(new Vector3(12, 0, 0), new Vector3(-1, 0, 0))
    );
    expect(representationHit).not.toBeNull();
    expect(representationHit!.ambientPointStatus).toBe('approximate');
    expect(representationHit!.ambiguity).toBe('first-ray-hit');
    expect(representationHit!.ambientPoint!.data[0]).toBeCloseTo(sectionRadius, 2);
    expect(representationHit!.source.kind).toBe('field-record');
    if (representationHit!.source.kind === 'field-record') {
      expect(representationHit!.source.field).toBe(fieldNode.field);
      expect(representationHit!.source.record).toEqual(
        fieldNode.field.evalCPU(representationHit!.ambientPoint!.data)
      );
    }
    expect(product.writeDepth).toBe(true);
    expect(product.object.material).not.toBeInstanceOf(Array);
    if (!Array.isArray(product.object.material)) {
      expect(product.object.material.depthWrite).toBe(true);
    }
    product.dispose();
  });

  it('validates transport declarations independently of a field family', async () => {
    const { HyperplaneSlice4 } = await import('@holotope/core');
    const slice = HyperplaneSlice4.axisAligned(3);
    const invalidIterations = { ...new UnitSphereNode4(), iterationLimit: 0 };
    expect(() => new RaymarchedField3D(invalidIterations, slice)).toThrow(/iterationLimit/);
    expect(() => new RaymarchedField3D(new UnitSphereNode4(), slice, { stepSafety: 1.1 })).toThrow(
      /stepSafety/
    );
  });
});

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

describe('QuaternionJuliaGPU', () => {
  it('builds a packed compute evaluation and validates input shape', async () => {
    const { QuaternionJuliaField } = await import('@holotope/core');
    const field = new QuaternionJuliaField({
      parameter: [0.156, 0, 0, -0.8],
      maxIterations: 32,
      escapeRadius: 4
    });
    const product = new QuaternionJuliaGPU(
      field,
      new Float32Array([0, 0, 0, 0, 1.25, -0.5, 0.25, 0.75])
    );
    expect(product.count).toBe(2);
    expect(product.field).toBe(field);
    expect(() => new QuaternionJuliaGPU(field, [])).toThrow(/positive multiple/);
    expect(() => new QuaternionJuliaGPU(field, [0, 1, 2])).toThrow(/positive multiple/);
    expect(() => new QuaternionJuliaGPU(field, [0, 0, 0, Number.NaN])).toThrow(/finite/);
  });

  it('summarizes CPU-vs-GPU record errors without hiding classification mismatches', async () => {
    const { QuaternionJuliaField } = await import('@holotope/core');
    const field = new QuaternionJuliaField({ parameter: [0, 0, 0, -1], maxIterations: 12 });
    const points = new Float32Array([2, 0, 0, 0]);
    const cpu = field.evalCPU(points);
    const gpu = {
      count: 1,
      values: new Float32Array([cpu.value]),
      magnitudes: new Float32Array([cpu.magnitude]),
      potentials: new Float32Array([cpu.potential]),
      distances: new Float32Array([cpu.distance]),
      iterations: new Uint32Array([cpu.iterations]),
      escaped: new Uint8Array([cpu.escaped ? 1 : 0]),
      orbitTraps: new Float32Array([cpu.orbitTrap]),
      derivativeBounds: new Float32Array([cpu.derivativeBound]),
      finalPoints: new Float32Array(cpu.finalPoint)
    };
    const exact = compareQuaternionJuliaGPU(field, points, gpu);
    expect(exact.escapeMismatches).toBe(0);
    expect(exact.iterationMismatches).toBe(0);
    expect(exact.maxFinalPointError).toBeLessThan(1e-6);

    gpu.escaped[0] = gpu.escaped[0] ? 0 : 1;
    gpu.iterations[0]! += 1;
    const mismatch = compareQuaternionJuliaGPU(field, points, gpu);
    expect(mismatch.escapeMismatches).toBe(1);
    expect(mismatch.iterationMismatches).toBe(1);
  });
});

describe('RaymarchedQuaternionJulia3D', () => {
  it('builds a TSL fragment product from the CPU field and live slice', async () => {
    const { HyperplaneSlice4, QuaternionJuliaField } = await import('@holotope/core');
    const field = new QuaternionJuliaField({ parameter: [0.156, 0, 0, -0.8] });
    const slice = HyperplaneSlice4.axisAligned(2);
    const product = new RaymarchedQuaternionJulia3D(field, slice, {
      extent: 1.7,
      maxSteps: 96
    });
    expect(product.field).toBe(field);
    expect(product.slice).toBe(slice);
    expect(product.palette).toBe('classic');
    expect(product.object.geometry.getAttribute('position').count).toBe(24);
    slice.setNormal([0, 0, 0.5, 1]);
    slice.offset = 0.2;
    expect(() => product.update()).not.toThrow();
    product.dispose();
    expect(() => new RaymarchedQuaternionJulia3D(field, slice, { maxSteps: 0 })).toThrow(
      /maxSteps/
    );
    expect(() => new RaymarchedQuaternionJulia3D(field, slice, { stepSafety: 1.2 })).toThrow(
      /stepSafety/
    );
  });

  it('accepts an additive artistic palette without changing the field contract', async () => {
    const { HyperplaneSlice4, QuaternionJuliaField } = await import('@holotope/core');
    const field = new QuaternionJuliaField({ parameter: [0, 0, 0, -0.8] });
    const product = new RaymarchedQuaternionJulia3D(
      field,
      HyperplaneSlice4.axisAligned(2),
      { palette: 'ember' }
    );
    expect(product.palette).toBe('ember');
    expect(product.field).toBe(field);
    product.dispose();
  });
});

describe('BicomplexJuliaGPU', () => {
  it('builds two explicit complex factor pipelines from packed bicomplex points', async () => {
    const { BicomplexJuliaField, idempotentToBicomplex } = await import('@holotope/core');
    const field = new BicomplexJuliaField({
      parameter: idempotentToBicomplex([0.745, -0.123], [0.156, -0.8]),
      maxIterations: 32
    });
    const product = new BicomplexJuliaGPU(
      field,
      new Float32Array([0, 0, 0, 0, 0.5, -0.25, 0.75, -1])
    );
    expect(product.count).toBe(2);
    expect(product.field).toBe(field);
    expect(() => new BicomplexJuliaGPU(field, [])).toThrow(/positive multiple/);
    expect(() => new BicomplexJuliaGPU(field, [0, 0, 0, Number.POSITIVE_INFINITY])).toThrow(
      /finite/
    );
  });
});

describe('RaymarchedBicomplexJulia3D', () => {
  it('builds a product-distance TSL graph from two complex factors', async () => {
    const { BicomplexJuliaField, HyperplaneSlice4, idempotentToBicomplex } = await import(
      '@holotope/core'
    );
    const field = new BicomplexJuliaField({
      parameter: idempotentToBicomplex([0.745, -0.123], [0.156, -0.8])
    });
    const slice = HyperplaneSlice4.axisAligned(3);
    const product = new RaymarchedBicomplexJulia3D(field, slice, {
      extent: 1.7,
      maxSteps: 128
    });
    expect(product.field).toBe(field);
    expect(product.slice).toBe(slice);
    expect(product.stepSafety).toBe(field.distanceEstimator.recommendedStepSafety);
    expect(product.palette).toBe('classic');
    expect(product.object.geometry.getAttribute('position').count).toBe(24);
    slice.setNormal([0, 0, 0.5, 1]);
    slice.offset = -0.15;
    expect(() => product.update()).not.toThrow();
    product.dispose();
    expect(() => new RaymarchedBicomplexJulia3D(field, slice, { maxSteps: 0 })).toThrow(
      /maxSteps/
    );
    expect(() => new RaymarchedBicomplexJulia3D(field, slice, { stepSafety: 1.1 })).toThrow(
      /stepSafety/
    );
  });

  it('accepts an additive artistic product palette', async () => {
    const { BicomplexJuliaField, HyperplaneSlice4 } = await import('@holotope/core');
    const field = new BicomplexJuliaField({ parameter: [0, 0, 0, 0] });
    const product = new RaymarchedBicomplexJulia3D(
      field,
      HyperplaneSlice4.axisAligned(3),
      { palette: 'spectral' }
    );
    expect(product.palette).toBe('spectral');
    product.dispose();
  });
});
