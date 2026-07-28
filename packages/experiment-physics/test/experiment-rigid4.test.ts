import { BivectorN, Rotor4, TransformN, VecN } from '@holotope/core';
import {
  PhysicsWorld4,
  RigidBody4,
  massPropertiesFromCellComplex4
} from '@holotope/physics';
import {
  coreExperimentCompilerV0,
  compileExperimentDocumentV0,
  prepareExperimentDocumentV0,
  type ExperimentCompiledModelV0,
  type ExperimentCompiledRepresentationV0,
  type ExperimentCompiledSourceV0,
  type ExperimentDocumentV0
} from '@holotope/experiment';
import { describe, expect, it } from 'vitest';
import {
  physicsExperimentCompilerV0,
  type ExperimentRigidModel4RuntimeV0
} from '../src/index.js';

const ANGULAR_MOMENTUM = [0.4, 0, 0, 0.9, 0, 0] as const;

function tumbleDocument(
  overrides: Partial<ExperimentDocumentV0> = {}
): ExperimentDocumentV0 {
  return {
    schema: 'holotope.experiment/0',
    title: 'Tumbling tesseract bridge',
    ambientDim: 4,
    sources: {
      tesseract: {
        kind: 'core.source.hypercube',
        dim: 4,
        size: 2,
        tetrahedralize: true
      }
    },
    models: {
      tumble: {
        kind: 'physics.model.rigid4',
        source: 'tesseract',
        initialAngularMomentum: ANGULAR_MOMENTUM,
        fixedStep: 1 / 120,
        substeps: 2
      }
    },
    representations: {
      perspective: {
        kind: 'core.representation.perspective',
        source: 'tesseract',
        fromDim: 4,
        viewDistance: 5.4,
        transform: { fromModel: 'tumble' },
        product: 'both'
      },
      section: {
        kind: 'core.representation.section4',
        source: 'tesseract',
        normal: [0, 0, 0, 2],
        offset: 0.12,
        frame: 'canonical',
        transform: { fromModel: 'tumble' }
      }
    },
    ...overrides
  } as ExperimentDocumentV0;
}

async function compiled(document: ExperimentDocumentV0) {
  const preparation = await prepareExperimentDocumentV0(document);
  if (!preparation.ok) throw new Error(JSON.stringify(preparation.failures));
  return compileExperimentDocumentV0(preparation.value, {
    compilers: [coreExperimentCompilerV0(), physicsExperimentCompilerV0()]
  });
}

function entry<T>(
  compilation: ReturnType<typeof compileExperimentDocumentV0>,
  id: string
): T {
  if (!compilation.ok) throw new Error(JSON.stringify(compilation.failures));
  const found = compilation.value.get(id);
  if (!found.ok) throw new Error(JSON.stringify(found.failures));
  return found.value as T;
}

/** The same body a document compiles, built directly from physics. */
function referenceBody(): { world: PhysicsWorld4; body: RigidBody4 } {
  const source = coreExperimentCompilerV0().compileSource!(
    { kind: 'core.source.hypercube', dim: 4, size: 2, tetrahedralize: true },
    {
      ambientDim: 4,
      id: 'tesseract',
      pointer: '/sources/tesseract',
      resolveSource: () => undefined,
      resolveModel: () => undefined
    }
  );
  if (!source.ok) throw new Error('reference source failed');
  const properties = massPropertiesFromCellComplex4(source.value.complex);
  const body = RigidBody4.fromMassProperties(properties, {
    angularMomentumWorld: new BivectorN(4, ANGULAR_MOMENTUM)
  });
  const world = new PhysicsWorld4({ gravity: new VecN([0, 0, 0, 0]) });
  world.addBody(body);
  return { world, body };
}

describe('physicsExperimentCompilerV0', () => {
  it('compiles the paneless bridge end to end with an identity pose at rest', async () => {
    const compilation = await compiled(tumbleDocument());
    expect(compilation.ok).toBe(true);
    if (!compilation.ok) return;

    expect(compilation.value.ids).toEqual([
      'tesseract', 'tumble', 'perspective', 'section'
    ]);
    expect(compilation.value.step).toBe(0);

    const model = entry<ExperimentCompiledModelV0>(compilation, 'tumble');
    expect(model.category).toBe('model');
    expect(model.source).toBe('tesseract');
    const runtime = model.runtime as ExperimentRigidModel4RuntimeV0;
    expect(runtime.world.bodies).toHaveLength(1);
    expect(runtime.fixedStep).toBeCloseTo(1 / 120, 15);
    expect(runtime.substeps).toBe(2);

    // The tesseract is centred and principal-aligned, so the model pose at
    // step zero is exactly identity: source geometry is already world-framed.
    const pose = model.pose();
    for (const sample of [[1, -1, 1, -1], [0.5, 0.25, -0.75, 2]]) {
      const moved = pose.applyToPoint(new VecN(sample));
      for (let axis = 0; axis < 4; axis++) {
        expect(Math.abs(moved.data[axis]! - sample[axis]!)).toBeLessThanOrEqual(1e-12);
      }
    }
  });

  it('advances bitwise identically to direct physics construction', async () => {
    const compilation = await compiled(tumbleDocument());
    if (!compilation.ok) throw new Error('compilation failed');
    const model = entry<ExperimentCompiledModelV0>(compilation, 'tumble');
    const runtime = model.runtime as ExperimentRigidModel4RuntimeV0;

    const advanced = compilation.value.advance(120);
    expect(advanced.ok).toBe(true);
    expect(compilation.value.step).toBe(120);

    const reference = referenceBody();
    for (let index = 0; index < 120; index++) {
      reference.world.step(1 / 120, 2);
    }

    expect(Array.from(runtime.body.position.data))
      .toEqual(Array.from(reference.body.position.data));
    expect(Array.from(runtime.body.rotation.left))
      .toEqual(Array.from(reference.body.rotation.left));
    expect(Array.from(runtime.body.rotation.right))
      .toEqual(Array.from(reference.body.rotation.right));
    expect(Array.from(runtime.body.angularMomentumWorld.coeffs))
      .toEqual(Array.from(reference.body.angularMomentumWorld.coeffs));
  });

  it('conserves torque-free angular momentum and rotor orthonormality', async () => {
    const compilation = await compiled(tumbleDocument());
    if (!compilation.ok) throw new Error('compilation failed');
    const runtime = entry<ExperimentCompiledModelV0>(compilation, 'tumble')
      .runtime as ExperimentRigidModel4RuntimeV0;
    const before = Array.from(runtime.body.angularMomentumWorld.coeffs);
    const rotationBefore = Array.from(runtime.body.rotation.left);

    // liveness: the advance is asserted accepted for all 120 steps, and the
    // rotor is asserted to have changed.
    //
    // Both claims are about quantities that a refused advance leaves untouched:
    // conserved momentum stays conserved and an unturned rotor stays
    // orthonormal. The advance has to be witnessed as accepted, and as having
    // moved the body, before either assertion means anything.
    const advanced = compilation.value.advance(120);
    expect(advanced.ok).toBe(true);
    if (advanced.ok) expect(advanced.value.step).toBe(120);

    expect(Array.from(runtime.body.angularMomentumWorld.coeffs)).toEqual(before);
    expect(runtime.body.rotation.toMatrix().orthogonalityError())
      .toBeLessThanOrEqual(1e-12);
    expect(Array.from(runtime.body.rotation.left)).not.toEqual(rotationBefore);
  });

  it('binds representations to the model rather than copying its pose', async () => {
    const compilation = await compiled(tumbleDocument());
    if (!compilation.ok) throw new Error('compilation failed');

    for (const id of ['perspective', 'section']) {
      const representation =
        entry<ExperimentCompiledRepresentationV0>(compilation, id);
      expect(representation.pose).toEqual({ kind: 'model', model: 'tumble' });
    }

    const model = entry<ExperimentCompiledModelV0>(compilation, 'tumble');
    const first = model.pose();
    compilation.value.advance(30);
    const second = model.pose();
    // A binding reads through: the second pose reflects the advance, and the
    // first copy was not reached by it.
    expect(Array.from(second.rotation.left))
      .not.toEqual(Array.from(first.rotation.left));
  });

  it('pulls a section back through the model pose exactly', async () => {
    const compilation = await compiled(tumbleDocument());
    if (!compilation.ok) throw new Error('compilation failed');
    compilation.value.advance(45);

    const source = entry<ExperimentCompiledSourceV0>(compilation, 'tesseract');
    const model = entry<ExperimentCompiledModelV0>(compilation, 'tumble');
    const pose = model.pose();
    const normal = new VecN([0, 0, 0, 1]);
    const offset = 0.12;

    // Posing the geometry and cutting with (n, c) must agree with cutting the
    // unposed geometry using the pulled-back plane.
    const inverse = pose.inverse();
    const pulledNormal = inverse.rotation.applyToPoint(normal);
    const translation = pose.position;
    const pulledOffset = offset - normal.dot(translation);

    const count = source.complex.vertexCount;
    const posed = new Float64Array(count * 4);
    pose.applyToPositions(source.complex.positions, posed, count);

    for (let vertex = 0; vertex < count; vertex++) {
      const direct = posed[vertex * 4 + 3]! - offset;
      let pulled = -pulledOffset;
      for (let axis = 0; axis < 4; axis++) {
        pulled += pulledNormal.data[axis]! *
          source.complex.positions[vertex * 4 + axis]!;
      }
      expect(Math.abs(direct - pulled)).toBeLessThanOrEqual(1e-9);
    }
  });

  it('starts at an authored rotor and refuses a non-unit pair', async () => {
    const authored = Rotor4.fromPlane(0, 3, 0.4)
      .multiply(Rotor4.fromPlane(1, 2, 0.3));
    const compilation = await compiled(tumbleDocument({
      models: {
        tumble: {
          kind: 'physics.model.rigid4',
          source: 'tesseract',
          initialRotor4: [...authored.left, ...authored.right],
          fixedStep: 1 / 120
        }
      }
    } as Partial<ExperimentDocumentV0>));
    if (!compilation.ok) throw new Error('compilation failed');

    const pose = entry<ExperimentCompiledModelV0>(compilation, 'tumble').pose();
    for (const sample of [[1, -1, 1, -1], [0.5, 0.25, -0.75, 2]]) {
      const received = pose.applyToPoint(new VecN(sample));
      const expected = authored.applyToPoint(new VecN(sample));
      for (let axis = 0; axis < 4; axis++) {
        expect(Math.abs(received.data[axis]! - expected.data[axis]!))
          .toBeLessThanOrEqual(1e-12);
      }
    }

    const refused = await compiled(tumbleDocument({
      models: {
        tumble: {
          kind: 'physics.model.rigid4',
          source: 'tesseract',
          initialRotor4: [2, 0, 0, 0, 1, 0, 0, 0],
          fixedStep: 1 / 120
        }
      }
    } as Partial<ExperimentDocumentV0>));
    expect(refused).toMatchObject({
      ok: false,
      failures: [{
        code: 'out-of-range',
        pointer: '/models/tumble/initialRotor4'
      }]
    });
  });

  it('refuses a source without simplex 3-cells, naming the requirement', async () => {
    const refused = await compiled(tumbleDocument({
      sources: {
        tesseract: { kind: 'core.source.hypercube', dim: 4, size: 2 }
      }
    } as Partial<ExperimentDocumentV0>));
    expect(refused).toMatchObject({
      ok: false,
      failures: [{ code: 'invalid-value', pointer: '/models/tumble/source' }]
    });
    if (refused.ok) return;
    expect(refused.failures[0]!.message).toContain('tetrahedralize');
  });

  it('keeps the clock honest', async () => {
    const compilation = await compiled(tumbleDocument());
    if (!compilation.ok) throw new Error('compilation failed');

    for (const invalid of [0, -1, 1.5, Number.NaN, 2 ** 60]) {
      const result = compilation.value.advance(invalid);
      expect(result).toMatchObject({ ok: false, failures: [{ code: 'invalid-value' }] });
    }
    expect(compilation.value.step).toBe(0);

    compilation.value.advance(3);
    compilation.value.advance(4);
    expect(compilation.value.step).toBe(7);

    compilation.value.dispose();
    expect(compilation.value.advance(1))
      .toMatchObject({ ok: false, failures: [{ code: 'disposed' }] });
    expect(compilation.value.step).toBe(7);
  });

  it('advances a model-less document as a pure clock', async () => {
    const preparation = await prepareExperimentDocumentV0({
      schema: 'holotope.experiment/0',
      title: 'No models',
      ambientDim: 4,
      sources: {
        tesseract: { kind: 'core.source.hypercube', dim: 4, size: 2 }
      },
      representations: {
        perspective: {
          kind: 'core.representation.perspective',
          source: 'tesseract',
          fromDim: 4,
          viewDistance: 5.4,
          product: 'both'
        }
      }
    } as ExperimentDocumentV0);
    if (!preparation.ok) throw new Error('preparation failed');
    const compilation = compileExperimentDocumentV0(preparation.value, {
      compilers: [coreExperimentCompilerV0()]
    });
    if (!compilation.ok) throw new Error('compilation failed');

    expect(compilation.value.advance(5)).toMatchObject({ ok: true });
    expect(compilation.value.step).toBe(5);
  });

  it('returns fresh pose copies and isolates compilations', async () => {
    const document = tumbleDocument();
    const first = await compiled(document);
    const second = await compiled(document);
    if (!first.ok || !second.ok) throw new Error('compilation failed');

    const model = entry<ExperimentCompiledModelV0>(first, 'tumble');
    const pose = model.pose();
    pose.position.data[0] = 99;
    expect(model.pose().position.data[0]).not.toBe(99);

    first.value.advance(60);
    expect(first.value.step).toBe(60);
    expect(second.value.step).toBe(0);
    const secondRuntime = entry<ExperimentCompiledModelV0>(second, 'tumble')
      .runtime as ExperimentRigidModel4RuntimeV0;
    const firstRuntime = model.runtime as ExperimentRigidModel4RuntimeV0;
    expect(Array.from(secondRuntime.body.rotation.left))
      .not.toEqual(Array.from(firstRuntime.body.rotation.left));
  });

  it('still refuses a model document compiled core-only, at planning', async () => {
    const preparation = await prepareExperimentDocumentV0(tumbleDocument());
    if (!preparation.ok) throw new Error('preparation failed');
    const refused = compileExperimentDocumentV0(preparation.value, {
      compilers: [coreExperimentCompilerV0()]
    });
    expect(refused).toMatchObject({
      ok: false,
      failures: [{
        code: 'capability-unavailable',
        pointer: '/models/tumble/kind'
      }]
    });
  });
});
