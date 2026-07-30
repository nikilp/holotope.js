import { VecN } from '@holotope/core';
import {
  coreExperimentCompilerV0,
  compileExperimentDocumentV0,
  prepareExperimentDocumentV0,
  type ExperimentCompiledModelV0,
  type ExperimentCompiledRepresentationV0,
  type ExperimentDocumentV0
} from '@holotope/experiment';
import { describe, expect, it } from 'vitest';
import {
  physicsExperimentCompilerV0,
  type ExperimentRigidModel4RuntimeV0
} from '../src/index.js';

const ANGULAR_MOMENTUM = [0.4, 0, 0, 0.9, 0, 0] as const;

function controlDocument(): ExperimentDocumentV0 {
  return {
    schema: 'holotope.experiment/0',
    title: 'Controlled tesseract bridge',
    ambientDim: 4,
    sources: {
      tesseract: {
        kind: 'core.source.hypercube', dim: 4, size: 2, tetrahedralize: true
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
      section: {
        kind: 'core.representation.section4',
        source: 'tesseract',
        normal: [0, 0, 0, 2],
        offset: 0.12,
        frame: 'canonical',
        transform: { fromModel: 'tumble' }
      }
    },
    parameters: [
      {
        id: 'sliceOffset',
        label: 'Slice offset',
        value: { type: 'number', default: 0.12, min: -1, max: 1, step: 0.01 },
        dimension: 'length',
        frame: { space: 'ambient', dim: 4 },
        unit: 'm',
        target: { kind: 'representation-field', ref: 'section', field: 'offset' }
      },
      {
        id: 'sliceNormal',
        label: 'Slice normal',
        value: { type: 'vector', default: [0, 0, 0, 1], length: 4 },
        dimension: 'dimensionless',
        frame: { space: 'ambient', dim: 4 },
        unit: '1',
        target: { kind: 'representation-field', ref: 'section', field: 'normal' }
      },
      {
        id: 'substeps',
        label: 'Solver substeps',
        value: { type: 'number', default: 2, min: 1, max: 8, step: 1 },
        dimension: 'dimensionless',
        frame: { space: 'ambient', dim: 4 },
        unit: '1',
        target: { kind: 'model-field', ref: 'tumble', field: 'substeps' }
      },
      {
        id: 'gravity',
        label: 'Gravity',
        value: { type: 'vector', default: [0, 0, 0, 0], length: 4 },
        dimension: 'acceleration',
        frame: { space: 'ambient', dim: 4 },
        unit: 'm/s^2',
        target: { kind: 'model-field', ref: 'tumble', field: 'gravity' }
      },
      {
        id: 'playing',
        label: 'Playing',
        value: { type: 'boolean', default: false },
        dimension: 'dimensionless',
        frame: { space: 'internal', dim: 1 },
        unit: '1',
        target: { kind: 'clock', field: 'running' }
      }
    ],
    observations: [
      {
        id: 'angularMomentum',
        title: 'Angular momentum',
        outputSchema: { type: 'array', items: { type: 'number' } },
        dimension: 'dimensionless',
        frame: { space: 'ambient', dim: 4 },
        unit: 'kg m^2/s',
        replayTolerance: 0,
        source: {
          kind: 'model-invariant', ref: 'tumble', quantity: 'angular-momentum'
        }
      },
      {
        id: 'kineticEnergy',
        title: 'Kinetic energy',
        outputSchema: { type: 'number' },
        dimension: 'dimensionless',
        frame: { space: 'ambient', dim: 4 },
        unit: 'J',
        replayTolerance: 0,
        source: {
          kind: 'model-invariant', ref: 'tumble', quantity: 'kinetic-energy'
        }
      },
      {
        id: 'sectionTriangles',
        title: 'Section triangles',
        outputSchema: { type: 'number' },
        dimension: 'dimensionless',
        frame: { space: 'ambient', dim: 4 },
        unit: '1',
        replayTolerance: 0,
        source: {
          kind: 'representation-count', ref: 'section', quantity: 'triangles'
        }
      },
      {
        id: 'sectionEdges',
        title: 'Section edges',
        outputSchema: { type: 'number' },
        dimension: 'dimensionless',
        frame: { space: 'ambient', dim: 4 },
        unit: '1',
        replayTolerance: 0,
        source: {
          kind: 'representation-count', ref: 'section', quantity: 'edges'
        }
      },
      {
        id: 'sectionLineage',
        title: 'Section lineage',
        outputSchema: { type: 'object' },
        dimension: 'dimensionless',
        frame: { space: 'ambient', dim: 4 },
        unit: '1',
        replayTolerance: 0,
        source: { kind: 'lineage', ref: 'section' }
      },
      {
        id: 'selected',
        title: 'Selection',
        outputSchema: { type: 'object' },
        dimension: 'dimensionless',
        frame: { space: 'ambient', dim: 4 },
        unit: '1',
        replayTolerance: 0,
        source: { kind: 'selection' }
      }
    ]
  } as unknown as ExperimentDocumentV0;
}

async function control() {
  const preparation = await prepareExperimentDocumentV0(controlDocument());
  if (!preparation.ok) throw new Error(JSON.stringify(preparation.failures));
  const compilation = compileExperimentDocumentV0(preparation.value, {
    compilers: [coreExperimentCompilerV0(), physicsExperimentCompilerV0()]
  });
  if (!compilation.ok) throw new Error(JSON.stringify(compilation.failures));
  return { compilation: compilation.value, prepared: preparation.value };
}

const got = <T>(result: { ok: boolean }): T => {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return (result as { value: T }).value;
};

describe('parameters, observations, and the revision counter', () => {
  it('reproduces the transcript: apply, then refuse out of range', async () => {
    const { compilation } = await control();
    expect(compilation.revision).toBe(1);

    const applied = compilation.setParameter('sliceOffset', 0.62);
    expect(applied.outcome).toBe('applied');
    expect(applied.previous).toBe(0.12);
    expect(applied.revision).toBe(2);

    const section = got<ExperimentCompiledRepresentationV0>(
      compilation.get('section')
    );
    if (section.map.kind !== 'slice4') throw new Error('unreachable');
    expect(section.map.slice.offset).toBe(0.62);

    const refused = compilation.setParameter('sliceOffset', 1.4);
    expect(refused.outcome).toBe('refused');
    expect(refused.failure?.code).toBe('out-of-range');
    expect(refused.failure?.detail).toMatchObject({ min: -1, max: 1 });
    expect(refused.previous).toBeUndefined();
    // A refusal changes nothing at all.
    expect(compilation.revision).toBe(2);
    expect(section.map.slice.offset).toBe(0.62);
  });

  it('lists declarations for discovery without inventing information', async () => {
    const { compilation } = await control();
    expect(compilation.listParameters().map((p) => p.id))
      .toEqual(['sliceOffset', 'sliceNormal', 'substeps', 'gravity', 'playing']);
    expect(compilation.listActions()).toEqual([]);
    expect(compilation.listObservations().map((o) => o.id)).toContain('angularMomentum');
  });

  it('reads live parameter targets without mutating state', async () => {
    const { compilation } = await control();

    expect(got<{ value: unknown; revision: number }>(
      compilation.readParameter('sliceOffset')
    )).toEqual({ id: 'sliceOffset', value: 0.12, revision: 1 });
    expect(got<{ value: unknown; revision: number }>(
      compilation.readParameter('sliceNormal')
    ).value).toEqual([0, 0, 0, 1]);
    expect(got<{ value: unknown; revision: number }>(
      compilation.readParameter('substeps')
    ).value).toBe(2);
    expect(got<{ value: unknown; revision: number }>(
      compilation.readParameter('gravity')
    ).value).toEqual([0, 0, 0, 0]);
    expect(compilation.revision).toBe(1);

    compilation.setParameter('sliceOffset', 0.62);
    compilation.setParameter('sliceNormal', [0, 2, 0, 0]);
    compilation.setParameter('substeps', 4);
    compilation.setParameter('gravity', [0, -9.81, 0, 0]);

    expect(got<{ value: unknown; revision: number }>(
      compilation.readParameter('sliceOffset')
    )).toEqual({ id: 'sliceOffset', value: 0.62, revision: 5 });
    expect(got<{ value: unknown }>(
      compilation.readParameter('sliceNormal')
    ).value).toEqual([0, 1, 0, 0]);
    expect(got<{ value: unknown }>(
      compilation.readParameter('substeps')
    ).value).toBe(4);
    expect(got<{ value: unknown }>(
      compilation.readParameter('gravity')
    ).value).toEqual([0, -9.81, 0, 0]);
    expect(compilation.revision).toBe(5);
  });

  it('reads restored and replayed parameter state rather than remembered defaults', async () => {
    const { compilation } = await control();
    const initial = got<any>(compilation.snapshot());

    compilation.setParameter('sliceOffset', 0.62);
    compilation.setParameter('substeps', 4);
    const trace = got<any>(compilation.trace());

    expect(got<{ value: unknown }>(
      compilation.readParameter('sliceOffset')
    ).value).toBe(0.62);
    expect(got<{ value: unknown }>(
      compilation.readParameter('substeps')
    ).value).toBe(4);

    got(compilation.restore(initial));
    expect(got<{ value: unknown }>(
      compilation.readParameter('sliceOffset')
    ).value).toBe(0.12);
    expect(got<{ value: unknown }>(
      compilation.readParameter('substeps')
    ).value).toBe(2);

    got(compilation.replay(trace));
    expect(got<{ value: unknown }>(
      compilation.readParameter('sliceOffset')
    ).value).toBe(0.62);
    expect(got<{ value: unknown }>(
      compilation.readParameter('substeps')
    ).value).toBe(4);
  });

  it('stamps observations with the state they were computed at', async () => {
    const { compilation } = await control();
    const model = got<ExperimentCompiledModelV0>(compilation.get('tumble'));
    const runtime = model.runtime as ExperimentRigidModel4RuntimeV0;

    const before = got<{ value: unknown; revision: number; step: number }>(
      compilation.observe('angularMomentum')
    );
    expect(before.revision).toBe(1);
    expect(before.step).toBe(0);

    compilation.advance(120);
    const after = got<{ value: unknown; revision: number; step: number }>(
      compilation.observe('angularMomentum')
    );
    expect(after.step).toBe(120);
    expect(after.revision).toBe(2);
    // Torque-free: the invariant survives the advance bitwise.
    expect(after.value).toEqual(before.value);
    expect(after.value).toEqual(Array.from(runtime.body.angularMomentumWorld.coeffs));

    // Staleness is the caller's comparison, not a flag we invent.
    expect(before.revision).toBeLessThan(compilation.revision);
  });

  it('counts what the product actually emits', async () => {
    const { compilation } = await control();
    const atRest = got<{ value: number }>(compilation.observe('sectionTriangles'));
    expect(atRest.value).toBe(48);

    compilation.setParameter('sliceOffset', 0.62);
    const moved = got<{ value: number }>(compilation.observe('sectionTriangles'));
    expect(moved.value).toBe(48);

    // A marched section is a triangle soup, so an edge count is a refusal
    // rather than a number nothing produced.
    expect(compilation.observe('sectionEdges')).toMatchObject({
      ok: false, failures: [{ code: 'invalid-value' }]
    });
  });

  it('reports lineage derived from the constructed map', async () => {
    const { compilation } = await control();
    const section = got<ExperimentCompiledRepresentationV0>(
      compilation.get('section')
    );
    const observed = got<{ value: unknown }>(compilation.observe('sectionLineage'));
    expect(observed.value).toEqual(section.lineage);
    expect(JSON.stringify(observed.value)).not.toContain('custom-projection');
  });

  it('applies model fields through the capability seam', async () => {
    const { compilation } = await control();
    const runtime = got<ExperimentCompiledModelV0>(compilation.get('tumble'))
      .runtime as ExperimentRigidModel4RuntimeV0;

    const substeps = compilation.setParameter('substeps', 4);
    expect(substeps.outcome).toBe('applied');
    expect(substeps.previous).toBe(2);
    expect(runtime.substeps).toBe(4);

    const gravity = compilation.setParameter('gravity', [0, -9.81, 0, 0]);
    expect(gravity.outcome).toBe('applied');
    expect(gravity.previous).toEqual([0, 0, 0, 0]);
    expect(Array.from(runtime.world.gravity.data)).toEqual([0, -9.81, 0, 0]);
  });

  it('normalizes a section normal and refuses a zero vector', async () => {
    const { compilation } = await control();
    const section = got<ExperimentCompiledRepresentationV0>(
      compilation.get('section')
    );
    if (section.map.kind !== 'slice4') throw new Error('unreachable');

    const applied = compilation.setParameter('sliceNormal', [0, 0, 2, 0]);
    expect(applied.outcome).toBe('applied');
    // `previous` reports the stored normalized normal, not what was written.
    expect(applied.previous).toEqual([0, 0, 0, 1]);
    expect(Array.from(section.map.slice.normal.data)).toEqual([0, 0, 1, 0]);

    const zero = compilation.setParameter('sliceNormal', [0, 0, 0, 0]);
    expect(zero.outcome).toBe('refused');
    expect(zero.failure?.code).toBe('invalid-value');
    expect(Array.from(section.map.slice.normal.data)).toEqual([0, 0, 1, 0]);
  });

  it('refuses unimplemented surfaces by naming the seam', async () => {
    const { compilation } = await control();
    expect(compilation.readParameter('playing')).toMatchObject({
      ok: false, failures: [{ code: 'capability-unavailable' }]
    });
    const clock = compilation.setParameter('playing', true);
    expect(clock.outcome).toBe('refused');
    expect(clock.failure?.code).toBe('capability-unavailable');

    expect(compilation.observe('selected')).toMatchObject({
      ok: false, failures: [{ code: 'capability-unavailable' }]
    });
    expect(compilation.revision).toBe(1);
  });

  it('refuses unknown ids and everything after disposal', async () => {
    const { compilation } = await control();
    expect(compilation.readParameter('nope')).toMatchObject({
      ok: false, failures: [{ code: 'missing-reference' }]
    });
    expect(compilation.setParameter('nope', 1).failure?.code).toBe('missing-reference');
    expect(compilation.observe('nope')).toMatchObject({
      ok: false, failures: [{ code: 'missing-reference' }]
    });

    compilation.dispose();
    expect(compilation.readParameter('sliceOffset')).toMatchObject({
      ok: false, failures: [{ code: 'disposed' }]
    });
    expect(compilation.setParameter('sliceOffset', 0.3).failure?.code).toBe('disposed');
    expect(compilation.observe('angularMomentum')).toMatchObject({
      ok: false, failures: [{ code: 'disposed' }]
    });
  });

  it('validates every declared domain', async () => {
    const { compilation } = await control();
    expect(compilation.setParameter('sliceOffset', 'x' as never).failure?.code)
      .toBe('invalid-type');
    expect(compilation.setParameter('playing', 1 as never).failure?.code)
      .toBe('invalid-type');
    expect(compilation.setParameter('sliceNormal', [1, 0, 0] as never).failure?.code)
      .toBe('invalid-value');
    expect(compilation.setParameter('substeps', 99).failure?.code)
      .toBe('out-of-range');
    expect(compilation.revision).toBe(1);
  });

  it('never mutates the prepared document', async () => {
    const { compilation, prepared } = await control();
    const before = prepared.canonicalJson;
    compilation.setParameter('sliceOffset', 0.4);
    compilation.setParameter('gravity', [0, -1, 0, 0]);
    compilation.advance(10);
    compilation.observe('sectionTriangles');
    compilation.observe('kineticEnergy');
    expect(prepared.canonicalJson).toBe(before);
  });

  it('observes kinetic energy exactly as the body reports it', async () => {
    const { compilation } = await control();
    compilation.advance(60);
    const runtime = got<ExperimentCompiledModelV0>(compilation.get('tumble'))
      .runtime as ExperimentRigidModel4RuntimeV0;
    const observed = got<{ value: number }>(compilation.observe('kineticEnergy'));
    expect(observed.value).toBe(runtime.body.kineticEnergy());
  });

  it('resolves the model pose when counting a bound section', async () => {
    const { compilation } = await control();
    const restCount = got<{ value: number }>(
      compilation.observe('sectionTriangles')
    ).value;
    compilation.advance(37);
    const turnedCount = got<{ value: number }>(
      compilation.observe('sectionTriangles')
    ).value;
    // The count is recomputed against the advanced pose, not a remembered one.
    expect(Number.isInteger(turnedCount)).toBe(true);
    expect(restCount).toBe(48);
    expect(turnedCount).toBeGreaterThan(0);
  });
});
