import { describe, expect, it } from 'vitest';
import { createHyperrectangle, tetrahedralizeCuboidCells } from '@holotope/core';
import { massPropertiesFromCellComplex4 } from '@holotope/physics';
import {
  compileExperimentDocumentV0,
  coreExperimentCompilerV0,
  prepareExperimentDocumentV0,
  type ExperimentDocumentV0
} from '@holotope/experiment';
import { physicsExperimentCompilerV0 } from '../src/index.js';

/**
 * A descriptor-authored orthotope really reaches the anisotropic dynamics.
 *
 * The analytic mass test in `@holotope/physics` proves the geometry and the
 * integration are right. This proves the document path arrives at that same
 * body rather than at something with a similar silhouette, and that advancing
 * it exercises the existing momentum-primary integrator.
 *
 * Angular-velocity magnitude is deliberately not asserted. It is constant for
 * the isotropic cube the older smoke test uses, and is simply not an invariant
 * of this body — asserting it would be asserting the bug.
 */

const EDGES = [2, 3, 5, 7] as const;

/** Several planes at once, so the motion is a genuine R4 tumble. */
const ANGULAR_MOMENTUM = [0.4, 0.15, 0, 0.9, -0.3, 0] as const;

function orthotopeDocument(): ExperimentDocumentV0 {
  return {
    schema: 'holotope.experiment/0',
    title: 'Tumbling orthotope',
    ambientDim: 4,
    sources: {
      body: {
        kind: 'core.source.hyperrectangle',
        dim: 4,
        edgeLengths: [...EDGES],
        tetrahedralize: true
      }
    },
    models: {
      tumble: {
        kind: 'physics.model.rigid4',
        source: 'body',
        initialAngularMomentum: ANGULAR_MOMENTUM,
        fixedStep: 1 / 120,
        substeps: 2
      }
    },
    representations: {
      shadow: {
        kind: 'core.representation.perspective',
        source: 'body',
        fromDim: 4,
        viewDistance: 14,
        transform: { fromModel: 'tumble' },
        product: 'both'
      }
    }
  } as ExperimentDocumentV0;
}

async function compileDocument(document: ExperimentDocumentV0) {
  const prepared = await prepareExperimentDocumentV0(document);
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.failures));
  const compiled = compileExperimentDocumentV0(prepared.value, {
    compilers: [coreExperimentCompilerV0(), physicsExperimentCompilerV0()]
  });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.failures));
  return compiled.value;
}

function runtimeOf(compilation: Awaited<ReturnType<typeof compileDocument>>) {
  const entry = compilation.get('tumble');
  if (!entry.ok || entry.value.category !== 'model') {
    throw new Error('the orthotope model did not compile');
  }
  return entry.value.runtime as {
    body: {
      rotation: { left: Float64Array; right: Float64Array };
      position: { data: Float64Array };
      angularMomentumWorld: { coeffs: Float64Array };
      angularVelocityWorld(): { coeffs: Float64Array };
    };
  };
}

const norm = (values: ArrayLike<number>): number =>
  Math.hypot(...Array.from(values as ArrayLike<number> as number[]));

describe('core.source.hyperrectangle reaches physics.model.rigid4', () => {
  it('compiles to the same mass shape as direct construction', async () => {
    const compilation = await compileDocument(orthotopeDocument());
    const source = compilation.get('body');
    if (!source.ok || source.value.category !== 'source') throw new Error('unreachable');

    const throughDocument = massPropertiesFromCellComplex4(source.value.complex);
    const direct = massPropertiesFromCellComplex4(
      tetrahedralizeCuboidCells(
        createHyperrectangle({ dim: 4, edgeLengths: [...EDGES], maxCellDimension: 3 })
      )
    );
    expect(throughDocument.volume).toBeCloseTo(direct.volume, 9);
    expect(Array.from(throughDocument.inertiaDiagonal)).toEqual(
      Array.from(direct.inertiaDiagonal)
    );
    // The body the document produced is the non-isotropic one.
    const inertia = Array.from(throughDocument.inertiaDiagonal);
    expect(Math.max(...inertia) - Math.min(...inertia)).toBeGreaterThan(1);
    compilation.dispose();
  });

  it('advances, and the orientation actually changes', async () => {
    const compilation = await compileDocument(orthotopeDocument());
    const runtime = runtimeOf(compilation);
    const before = Array.from(runtime.body.rotation.left);

    // Liveness first: a conservation assertion over zero steps is vacuous.
    const advanced = compilation.advance(240);
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) return;
    expect(advanced.value.step).toBe(240);
    expect(compilation.step).toBe(240);

    const after = Array.from(runtime.body.rotation.left);
    expect(after).not.toEqual(before);
    for (const value of [...after, ...Array.from(runtime.body.position.data)]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    compilation.dispose();
  });

  it('conserves world angular momentum under torque-free motion', async () => {
    const compilation = await compileDocument(orthotopeDocument());
    const runtime = runtimeOf(compilation);
    const before = Array.from(runtime.body.angularMomentumWorld.coeffs);
    expect(norm(before)).toBeGreaterThan(0);

    compilation.advance(240);

    const after = Array.from(runtime.body.angularMomentumWorld.coeffs);
    for (let plane = 0; plane < 6; plane += 1) {
      expect(after[plane]!).toBeCloseTo(before[plane]!, 9);
    }
    compilation.dispose();
  });

  it('tumbles: angular velocity changes even as momentum is conserved', async () => {
    // The distinguishing property of a non-isotropic body. For a cube the
    // angular velocity would be a fixed multiple of the momentum and this
    // would not move at all.
    const compilation = await compileDocument(orthotopeDocument());
    const runtime = runtimeOf(compilation);
    const before = Array.from(runtime.body.angularVelocityWorld().coeffs);

    compilation.advance(240);

    const after = Array.from(runtime.body.angularVelocityWorld().coeffs);
    const change = Math.hypot(...after.map((value, index) => value - before[index]!));
    expect(change).toBeGreaterThan(1e-6);
    compilation.dispose();
  });
});
