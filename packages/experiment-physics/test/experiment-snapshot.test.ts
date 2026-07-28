import {
  coreExperimentCompilerV0,
  compileExperimentDocumentV0,
  prepareExperimentDocumentV0,
  type ExperimentCompiledModelV0,
  type ExperimentCompiledRepresentationV0,
  type ExperimentDocumentV0,
  type ExperimentSnapshotV0
} from '@holotope/experiment';
import { describe, expect, it } from 'vitest';
import {
  physicsExperimentCompilerV0,
  type ExperimentRigidModel4RuntimeV0
} from '../src/index.js';

const ANGULAR_MOMENTUM = [0.4, 0, 0, 0.9, 0, 0] as const;

function traceDocument(
  frame: 'canonical' | 'continuous' = 'canonical',
  title = 'Snapshot bridge'
): ExperimentDocumentV0 {
  return {
    schema: 'holotope.experiment/0',
    title,
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
        frame,
        transform: { fromModel: 'tumble' }
      }
    },
    parameters: [
      {
        id: 'sliceOffset',
        label: 'Slice offset',
        value: { type: 'number', default: 0.12, min: -1, max: 1 },
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
      }
    ]
  } as unknown as ExperimentDocumentV0;
}

async function compiled(
  document: ExperimentDocumentV0 = traceDocument(),
  options: { readonly maxTraceEvents?: number } = {}
) {
  const preparation = await prepareExperimentDocumentV0(document);
  if (!preparation.ok) throw new Error(JSON.stringify(preparation.failures));
  const result = compileExperimentDocumentV0(preparation.value, {
    compilers: [coreExperimentCompilerV0(), physicsExperimentCompilerV0()],
    ...options
  });
  if (!result.ok) throw new Error(JSON.stringify(result.failures));
  return { compilation: result.value, prepared: preparation.value };
}

const unwrap = <T>(result: { ok: boolean }): T => {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return (result as { value: T }).value;
};

const snap = (c: { snapshot: () => unknown }): ExperimentSnapshotV0 =>
  unwrap<ExperimentSnapshotV0>(c.snapshot() as { ok: boolean });

describe('snapshots, traces, and honest replay', () => {
  // Release-gate test 1: capture completeness.
  it('round-trips complete state after further mutation', async () => {
    const { compilation } = await compiled();
    compilation.advance(120);
    const taken = snap(compilation);
    const momentumAt = unwrap<{ value: unknown }>(compilation.observe('angularMomentum'));
    const trianglesAt = unwrap<{ value: number }>(compilation.observe('sectionTriangles'));

    // Diverge well away from the captured state.
    compilation.advance(80);
    compilation.setParameter('sliceOffset', 0.62);

    const restored = unwrap<{ step: number; level: string }>(
      compilation.restore(taken)
    );
    expect(restored.step).toBe(120);
    expect(restored.level).toBe('exact-cpu');

    // A re-taken snapshot is byte-identical, and every observation matches.
    const again = snap(compilation);
    expect(again.entries).toEqual(taken.entries);
    expect(again.buffers).toEqual(taken.buffers);
    expect(again.step).toBe(taken.step);
    expect(unwrap<{ value: unknown }>(compilation.observe('angularMomentum')).value)
      .toEqual(momentumAt.value);
    expect(unwrap<{ value: number }>(compilation.observe('sectionTriangles')).value)
      .toBe(trianglesAt.value);
  });

  // Release-gate test 2: bitwise replay across compilations.
  it('replays a trace bitwise onto a second compilation', async () => {
    const document = traceDocument();
    const a = (await compiled(document)).compilation;
    const b = (await compiled(document)).compilation;

    a.advance(120);
    a.setParameter('sliceOffset', 0.62);
    a.advance(80);

    const trace = unwrap<{ events: readonly unknown[] }>(a.trace());
    expect(trace.events).toHaveLength(3);

    const replayed = unwrap<{ step: number }>(b.replay(trace as never));
    expect(replayed.step).toBe(200);

    const left = snap(a);
    const right = snap(b);
    expect(right.buffers).toEqual(left.buffers);
    expect(right.entries).toEqual(left.entries);
    expect(unwrap<{ value: unknown }>(b.observe('angularMomentum')).value)
      .toEqual(unwrap<{ value: unknown }>(a.observe('angularMomentum')).value);
  });

  it('restores a transported continuous-frame basis bitwise', async () => {
    const document = traceDocument('continuous', 'Continuous bridge');
    const a = (await compiled(document)).compilation;

    // Drive the normal through a history; the basis is transported, so it
    // depends on the path rather than on the final normal alone.
    a.setParameter('sliceNormal', [0, 1, 0, 0]);
    a.advance(30);
    a.setParameter('sliceNormal', [0, 0, 1, 0]);
    a.setParameter('sliceNormal', [0, 0, 1, 1]);
    const taken = snap(a);
    const section = unwrap<ExperimentCompiledRepresentationV0>(a.get('section'));
    if (section.map.kind !== 'slice4') throw new Error('unreachable');
    const transported = section.map.slice.basis.map((row) => Array.from(row));

    // The transport must actually have gone somewhere a canonical frame would
    // not, or the test would pass without exercising history at all.
    const canonical = (await compiled(traceDocument('canonical', 'Canonical bridge')))
      .compilation;
    canonical.setParameter('sliceNormal', [0, 0, 1, 1]);
    const plain = unwrap<ExperimentCompiledRepresentationV0>(canonical.get('section'));
    if (plain.map.kind !== 'slice4') throw new Error('unreachable');
    expect(plain.map.slice.basis.map((row) => Array.from(row))).not.toEqual(transported);

    // A fresh compilation has never seen that history.
    const b = (await compiled(document)).compilation;
    unwrap(b.restore(taken));
    const restoredSection = unwrap<ExperimentCompiledRepresentationV0>(b.get('section'));
    if (restoredSection.map.kind !== 'slice4') throw new Error('unreachable');
    expect(restoredSection.map.slice.basis.map((row) => Array.from(row)))
      .toEqual(transported);
  });

  it('binds a snapshot to its document by hash', async () => {
    const taken = snap((await compiled()).compilation);
    const other = (await compiled(traceDocument('canonical', 'Different title')))
      .compilation;
    expect(other.restore(taken)).toMatchObject({
      ok: false,
      failures: [{ code: 'snapshot-incompatible' }]
    });
  });

  it('negotiates replay levels', async () => {
    const { compilation } = await compiled();
    const taken = snap(compilation);
    expect(compilation.restore(taken, { require: 'exact-cpu' })).toMatchObject({ ok: true });

    const weakened = { ...taken, level: 'presentation-only' as const };
    expect(compilation.restore(weakened, { require: 'exact-cpu' })).toMatchObject({
      ok: false,
      failures: [{ code: 'replay-level-unmet' }]
    });
  });

  it('rolls back a refused restore exactly', async () => {
    const { compilation } = await compiled();
    compilation.advance(45);
    const before = snap(compilation);

    // The model entry must pass validation and then be refused by the
    // capability, so the earlier representation entry has already been
    // written when the failure happens. A same-total layout with a wrong
    // field name does exactly that.
    const entries = before.entries.map((entry) => entry.category === 'model'
      ? { ...entry, layout: [{ field: 'bogus', length: 38 }] }
      : entry);
    const doctored = { ...before, entries, step: 10 } as ExperimentSnapshotV0;

    const refused = compilation.restore(doctored);
    expect(refused).toMatchObject({ ok: false, failures: [{ code: 'invalid-value' }] });
    const after = snap(compilation);
    expect(after.buffers).toEqual(before.buffers);
    expect(after.step).toBe(before.step);
  });

  it('sets step and bumps revision, and resets by restoring the initial', async () => {
    const { compilation } = await compiled();
    const initial = unwrap<{ initial: ExperimentSnapshotV0 }>(compilation.trace()).initial;
    expect(initial.step).toBe(0);

    compilation.advance(60);
    compilation.setParameter('sliceOffset', 0.4);
    const beforeRestore = compilation.revision;

    const outcome = unwrap<{ step: number; revision: number }>(
      compilation.restore(initial)
    );
    expect(outcome.step).toBe(0);
    expect(compilation.step).toBe(0);
    // Revision is this process's counter, not state: it moves forward.
    expect(outcome.revision).toBe(beforeRestore + 1);

    const runtime = unwrap<ExperimentCompiledModelV0>(compilation.get('tumble'))
      .runtime as ExperimentRigidModel4RuntimeV0;
    expect(Array.from(runtime.body.angularMomentumWorld.coeffs))
      .toEqual([...ANGULAR_MOMENTUM]);
  });

  it('refuses a truncated trace rather than returning one', async () => {
    const { compilation } = await compiled(traceDocument(), { maxTraceEvents: 2 });
    compilation.advance(1);
    compilation.advance(1);
    // Recording stops here, but mutation continues normally.
    compilation.advance(1);
    expect(compilation.step).toBe(3);
    expect(compilation.trace()).toMatchObject({
      ok: false,
      failures: [{ code: 'resource-limit' }]
    });
  });

  it('carries cleared accumulators at a step boundary', async () => {
    const { compilation } = await compiled();
    compilation.advance(10);
    const taken = snap(compilation);
    const model = taken.entries.find((entry) => entry.category === 'model')!;
    const runtime = unwrap<ExperimentCompiledModelV0>(compilation.get('tumble'))
      .runtime as ExperimentRigidModel4RuntimeV0;
    expect(Array.from(runtime.body.force.data)).toEqual([0, 0, 0, 0]);
    expect(Array.from(runtime.body.torque.coeffs)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(model.layout.map((field) => field.field)).toContain('force');
  });

  it('never mutates the prepared document, and refuses after disposal', async () => {
    const { compilation, prepared } = await compiled();
    const canonical = prepared.canonicalJson;
    const taken = snap(compilation);
    compilation.advance(5);
    compilation.restore(taken);
    compilation.replay(unwrap(compilation.trace()));
    expect(prepared.canonicalJson).toBe(canonical);

    compilation.dispose();
    for (const call of [
      () => compilation.snapshot(),
      () => compilation.trace(),
      () => compilation.restore(taken),
      () => compilation.replay({ schema: 'holotope.trace/0' } as never)
    ]) {
      expect(call()).toMatchObject({ ok: false, failures: [{ code: 'disposed' }] });
    }
  });
});
