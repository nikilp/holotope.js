import { sliceTetrahedra, type CellComplex } from '@holotope/core';
import {
  coreExperimentCompilerV0,
  compileExperimentDocumentV0,
  prepareExperimentDocumentV0,
  type ExperimentCompiledRepresentationV0,
  type ExperimentDocumentV0,
  type ExperimentSnapshotV0
} from '@holotope/experiment';
import { describe, expect, it } from 'vitest';
import { physicsExperimentCompilerV0 } from '../src/index.js';

const ANGULAR_MOMENTUM = [0.4, 0, 0, 0.9, 0, 0] as const;

const numberSchema = { type: 'number' } as const;
const stepArgs = {
  type: 'object',
  properties: { steps: { type: 'integer', minimum: 1 } },
  required: ['steps'],
  additionalProperties: false
} as const;

function bridgeDocument(): ExperimentDocumentV0 {
  return {
    schema: 'holotope.experiment/0',
    title: 'Action bridge',
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
        normal: [0, 0, 0, 1],
        offset: 0.12,
        frame: 'canonical'
      },
      perspective: {
        kind: 'core.representation.perspective',
        source: 'tesseract',
        fromDim: 4,
        viewDistance: 5.4,
        product: 'both'
      }
    },
    parameters: [{
      id: 'sliceOffset',
      label: 'Slice offset',
      value: { type: 'number', default: 0.12, min: -1, max: 1 },
      dimension: 'length',
      frame: { space: 'ambient', dim: 4 },
      unit: 'm',
      target: { kind: 'representation-field', ref: 'section', field: 'offset' }
    }],
    observations: [{
      id: 'sectionTriangles',
      title: 'Section triangles',
      outputSchema: numberSchema,
      dimension: 'dimensionless',
      frame: { space: 'ambient', dim: 4 },
      unit: '1',
      replayTolerance: 0,
      source: {
        kind: 'representation-count', ref: 'section', quantity: 'triangles'
      }
    }],
    actions: [
      {
        id: 'step',
        title: 'Advance',
        description: 'Advances the document clock.',
        inputSchema: stepArgs,
        outputSchema: { type: 'object' },
        readOnly: false, destructive: false, idempotent: false,
        deterministic: true, supportsPreview: true,
        budget: { maxSteps: 240 },
        operation: { kind: 'advance-clock' }
      },
      {
        id: 'setOffset',
        title: 'Set slice offset',
        description: 'Applies a new section offset.',
        inputSchema: {
          type: 'object',
          properties: { value: { type: 'number' } },
          required: ['value'],
          additionalProperties: false
        },
        outputSchema: { type: 'object' },
        readOnly: false, destructive: false, idempotent: true,
        deterministic: true, supportsPreview: true,
        budget: { maxMillis: 1000 },
        operation: { kind: 'set-parameter', parameter: 'sliceOffset' }
      },
      {
        id: 'probe',
        title: 'Probe',
        description: 'Reports headless evidence for a chart point.',
        inputSchema: {
          type: 'object',
          properties: {
            representation: { type: 'string' },
            point: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }
          },
          required: ['representation', 'point'],
          additionalProperties: false
        },
        outputSchema: { type: 'object' },
        readOnly: true, destructive: false, idempotent: true,
        deterministic: true, supportsPreview: false,
        budget: { maxMillis: 1000 },
        operation: { kind: 'probe' }
      },
      {
        id: 'reset',
        title: 'Reset',
        description: 'Restores the initial state.',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        readOnly: false, destructive: true, idempotent: true,
        deterministic: true, supportsPreview: false,
        budget: { maxMillis: 1000 },
        operation: { kind: 'reset' }
      },
      {
        id: 'documented',
        title: 'Documented only',
        description: 'Discoverable metadata with no operation binding.',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        readOnly: true, destructive: false, idempotent: true,
        deterministic: true, supportsPreview: false,
        budget: { maxMillis: 1000 }
      }
    ]
  } as unknown as ExperimentDocumentV0;
}

async function bridge(document: ExperimentDocumentV0 = bridgeDocument()) {
  const preparation = await prepareExperimentDocumentV0(document);
  if (!preparation.ok) throw new Error(JSON.stringify(preparation.failures));
  const result = compileExperimentDocumentV0(preparation.value, {
    compilers: [coreExperimentCompilerV0(), physicsExperimentCompilerV0()]
  });
  if (!result.ok) throw new Error(JSON.stringify(result.failures));
  return result.value;
}

const unwrap = <T>(result: { ok: boolean }): T => {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return (result as { value: T }).value;
};

describe('actions, budgets, and the headless probe', () => {
  it('lists frozen action declarations in authored order', async () => {
    const compilation = await bridge();
    const actions = compilation.listActions();
    expect(actions.map((action) => action.id)).toEqual([
      'step',
      'setOffset',
      'probe',
      'reset',
      'documented'
    ]);
    expect(Object.isFrozen(actions)).toBe(true);
    expect(compilation.revision).toBe(1);
  });

  it('dispatches each operation to exactly its primitive', async () => {
    const viaAction = await bridge();
    const direct = await bridge();

    viaAction.invoke('step', { steps: 30 });
    direct.advance(30);
    expect(viaAction.step).toBe(direct.step);
    expect(unwrap<ExperimentSnapshotV0>(viaAction.snapshot()).buffers)
      .toEqual(unwrap<ExperimentSnapshotV0>(direct.snapshot()).buffers);

    const applied = viaAction.invoke('setOffset', { value: 0.62 });
    expect(applied.outcome).toBe('applied');
    expect(applied.output).toMatchObject({ previous: 0.12 });
    direct.setParameter('sliceOffset', 0.62);
    expect(unwrap<ExperimentSnapshotV0>(viaAction.snapshot()).buffers)
      .toEqual(unwrap<ExperimentSnapshotV0>(direct.snapshot()).buffers);
  });

  it('refuses over budget with nothing executed', async () => {
    const compilation = await bridge();
    const before = unwrap<ExperimentSnapshotV0>(compilation.snapshot());
    const revision = compilation.revision;

    const refused = compilation.invoke('step', { steps: 241 });
    expect(refused.outcome).toBe('refused');
    expect(refused.failure?.code).toBe('budget-exceeded');
    expect(refused.failure?.detail).toMatchObject({ requested: 241, maxSteps: 240 });
    expect(compilation.step).toBe(0);
    expect(compilation.revision).toBe(revision);
    expect(unwrap<ExperimentSnapshotV0>(compilation.snapshot()).buffers)
      .toEqual(before.buffers);

    // At the bound it runs.
    expect(compilation.invoke('step', { steps: 240 }).outcome).toBe('applied');
  });

  it('makes preview unobservable', async () => {
    const compilation = await bridge();
    compilation.advance(12);
    const before = unwrap<ExperimentSnapshotV0>(compilation.snapshot());
    const revision = compilation.revision;
    const step = compilation.step;
    const trace = JSON.stringify(unwrap(compilation.trace()));

    const previewed = compilation.invoke('step', { steps: 40 }, { mode: 'preview' });
    expect(previewed.outcome).toBe('previewed');
    expect(previewed.output).toMatchObject({ step: step + 40 });

    // Nothing the caller can see changed.
    expect(compilation.step).toBe(step);
    expect(compilation.revision).toBe(revision);
    expect(unwrap<ExperimentSnapshotV0>(compilation.snapshot()).buffers)
      .toEqual(before.buffers);
    expect(JSON.stringify(unwrap(compilation.trace()))).toBe(trace);

    const offset = compilation.invoke('setOffset', { value: 0.9 }, { mode: 'preview' });
    expect(offset.outcome).toBe('previewed');
    expect(unwrap<ExperimentSnapshotV0>(compilation.snapshot()).buffers)
      .toEqual(before.buffers);

    // A declaration that does not support preview refuses.
    expect(compilation.invoke('probe', {
      representation: 'section', point: [0, 0, 0]
    }, { mode: 'preview' }).failure?.code).toBe('capability-unavailable');
  });

  // The E5 gap: a restore that recorded nothing made every later trace lie.
  it('records a restore so a replayed run stays faithful', async () => {
    const document = bridgeDocument();
    const a = await bridge(document);

    a.advance(24);
    const checkpoint = unwrap<ExperimentSnapshotV0>(a.snapshot());
    a.setParameter('sliceOffset', 0.8);
    a.advance(12);
    a.restore(checkpoint);          // the event E5 dropped
    a.setParameter('sliceOffset', -0.3);
    a.advance(6);

    const trace = unwrap<{ events: readonly { kind: string }[] }>(a.trace());
    expect(trace.events.map((event) => event.kind))
      .toEqual(['advance', 'set-parameter', 'advance', 'restore', 'set-parameter', 'advance']);

    const b = await bridge(document);
    unwrap(b.replay(trace as never));
    expect(unwrap<ExperimentSnapshotV0>(b.snapshot()).buffers)
      .toEqual(unwrap<ExperimentSnapshotV0>(a.snapshot()).buffers);
    expect(b.step).toBe(a.step);
  });

  it('probes a section exactly and names the cut tetrahedron', async () => {
    const compilation = await bridge();
    compilation.invoke('setOffset', { value: 0.62 });
    const section = unwrap<ExperimentCompiledRepresentationV0>(
      compilation.get('section')
    );
    if (section.map.kind !== 'slice4') throw new Error('unreachable');

    const before = unwrap<ExperimentSnapshotV0>(compilation.snapshot());
    const revision = compilation.revision;

    // A marched section is the cross-section's *surface*, so a point "inside
    // the cut" means on an emitted triangle, not at the solid's centre. The
    // centroid of a real emitted triangle is the honest probe target.
    const complex = unwrap<{ complex: CellComplex }>(
      compilation.get('tesseract')
    ).complex;
    const groups = complex.cellsOfDim(3)
      .filter((group) => group.kind === 'simplex' && group.verticesPerCell === 4);
    let length = 0;
    for (const group of groups) length += group.indices.length;
    const tets = new Uint32Array(length);
    let at = 0;
    for (const group of groups) { tets.set(group.indices, at); at += group.indices.length; }
    const emitted = new Float32Array((tets.length / 4) * 18);
    sliceTetrahedra(complex.positions, tets, section.map.slice, emitted);
    const centroid = [0, 1, 2].map((axis) =>
      (emitted[axis]! + emitted[3 + axis]! + emitted[6 + axis]!) / 3
    );

    const hit = compilation.invoke('probe', {
      representation: 'section', point: centroid
    });
    expect(hit.outcome).toBe('applied');
    const output = hit.output as {
      ambientPointStatus: string;
      ambientPoint: readonly number[];
      sourceCell?: { groupKey: string; ordinal: number };
    };
    expect(output.ambientPointStatus).toBe('exact');
    // The lift lands on the cutting hyperplane, whatever the geometry does.
    const normal = section.map.slice.normal.data;
    let signed = 0;
    for (let axis = 0; axis < 4; axis++) {
      signed += normal[axis]! * output.ambientPoint[axis]!;
    }
    expect(Math.abs(signed - section.map.slice.offset)).toBeLessThanOrEqual(1e-12);
    expect(output.ambientPoint[3]).toBeCloseTo(0.62, 12);
    expect(output.sourceCell?.ordinal).toBeGreaterThanOrEqual(0);

    // Far outside every emitted triangle: the lift is still exact, but no cell.
    const miss = compilation.invoke('probe', {
      representation: 'section', point: [50, 50, 50]
    });
    const missed = miss.output as { ambientPointStatus: string; sourceCell?: unknown };
    expect(missed.ambientPointStatus).toBe('exact');
    expect(missed.sourceCell).toBeUndefined();

    // A probe is pure.
    expect(compilation.revision).toBe(revision);
    expect(unwrap<ExperimentSnapshotV0>(compilation.snapshot()).buffers)
      .toEqual(before.buffers);
  });

  it('refuses to invent a point for a projection', async () => {
    const compilation = await bridge();
    const result = compilation.invoke('probe', {
      representation: 'perspective', point: [0, 0, 0]
    });
    expect(result.outcome).toBe('applied');
    const output = result.output as {
      ambientPointStatus: string; sourceCell?: unknown; lineageKind: string;
    };
    // Many-to-one, and headlessly there is no ray to disambiguate it.
    expect(output.ambientPointStatus).toBe('unavailable');
    expect(output.sourceCell).toBeUndefined();
    expect(typeof output.lineageKind).toBe('string');
  });

  it('resets by restoring the initial snapshot', async () => {
    const compilation = await bridge();
    const initial = unwrap<{ initial: ExperimentSnapshotV0 }>(compilation.trace()).initial;
    compilation.invoke('step', { steps: 60 });
    compilation.invoke('setOffset', { value: -0.5 });

    expect(compilation.invoke('reset').outcome).toBe('applied');
    expect(compilation.step).toBe(0);
    expect(unwrap<ExperimentSnapshotV0>(compilation.snapshot()).buffers)
      .toEqual(initial.buffers);
  });

  it('refuses metadata-only, unknown, malformed, and disposed', async () => {
    const compilation = await bridge();

    expect(compilation.invoke('documented').failure?.code)
      .toBe('capability-unavailable');
    expect(compilation.invoke('nope').failure?.code).toBe('missing-reference');

    const malformed = compilation.invoke('probe', {
      representation: 'section', point: [0, 0]
    });
    expect(malformed.outcome).toBe('refused');
    expect(malformed.failure?.pointer).toMatch(/^\/arguments/);

    compilation.dispose();
    expect(compilation.invoke('step', { steps: 1 }).failure?.code).toBe('disposed');
  });
});
