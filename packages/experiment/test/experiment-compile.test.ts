import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HyperplaneSlice4, Rotor4, TransformN, VecN, sliceTetrahedra, sliceTetrahedraAmbient } from '@holotope/core';
import {
  compileExperimentDocumentV0,
  coreExperimentCompilerV0,
  canonicalizeExperimentJsonV0,
  prepareExperimentDocumentV0,
  type ExperimentCompiledRepresentationV0,
  type ExperimentCompiledSourceV0,
  type ExperimentDocumentV0,
  type ExperimentJsonValue,
  type PreparedExperimentDocumentV0
} from '../src/index.js';

function headlessBridgeDocument(): ExperimentDocumentV0 {
  return {
    schema: 'holotope.experiment/0',
    title: 'Headless tesseract bridge',
    ambientDim: 4,
    sources: {
      tesseract: {
        kind: 'core.source.hypercube',
        dim: 4,
        size: 2,
        tetrahedralize: true
      }
    },
    representations: {
      perspective: {
        kind: 'core.representation.perspective',
        source: 'tesseract',
        fromDim: 4,
        viewDistance: 5.4,
        product: 'both'
      },
      section: {
        kind: 'core.representation.section4',
        source: 'tesseract',
        normal: [0, 0, 0, 2],
        offset: 0.12,
        frame: 'canonical'
      },
      xyw: {
        kind: 'core.representation.coordinate',
        source: 'tesseract',
        fromDim: 4,
        retainedAxes: [0, 1, 3],
        product: 'edges'
      }
    },
    backends: [{ backend: 'cpu', required: true }]
  };
}

async function prepared(
  document: ExperimentDocumentV0
): Promise<PreparedExperimentDocumentV0> {
  const result = await prepareExperimentDocumentV0(document);
  if (!result.ok) {
    throw new Error(result.failures[0]?.message ?? 'preparation failed');
  }
  return result.value;
}

function compiledEntry<Entry extends { readonly category: string }>(
  compilation: ReturnType<typeof compileExperimentDocumentV0>,
  id: string,
  category: Entry['category']
): Entry {
  if (!compilation.ok) {
    throw new Error(compilation.failures[0]?.message ?? 'compilation refused');
  }
  const entry = compilation.value.get(id);
  if (!entry.ok || entry.value.category !== category) {
    throw new Error(`expected compiled ${category} ${id}`);
  }
  return entry.value as unknown as Entry;
}

describe('@holotope/experiment compilation registry', () => {
  it('compiles the headless bridge into a deterministic registry of live objects', async () => {
    const compilation = compileExperimentDocumentV0(
      await prepared(headlessBridgeDocument()),
      { compilers: [coreExperimentCompilerV0()] }
    );

    expect(compilation.ok).toBe(true);
    if (!compilation.ok) return;
    expect(compilation.value.ids).toEqual([
      'tesseract',
      'perspective',
      'section',
      'xyw'
    ]);
    expect(new Set(compilation.value.ids).size).toBe(4);

    const source = compiledEntry<ExperimentCompiledSourceV0>(
      compilation,
      'tesseract',
      'source'
    );
    expect(source.dim).toBe(4);
    expect(source.complex.vertexCount).toBe(16);
    const counts = Object.fromEntries(source.complex.groups.map((group) => [
      `${group.kind}${group.dim}`,
      group.indices.length / group.verticesPerCell
    ]));
    expect(counts).toEqual({
      cuboid1: 32,
      cuboid2: 24,
      cuboid3: 8,
      simplex3: 48
    });

    const first = compilation.value.get('section');
    const second = compilation.value.get('section');
    expect(first.ok && second.ok && first.value === second.value).toBe(true);
  });

  it('defers valid presentation panes to a renderer without polluting the registry', async () => {
    const document: ExperimentDocumentV0 = {
      ...headlessBridgeDocument(),
      presentation: {
        panes: [
          {
            kind: 'three.pane.representation',
            id: 'rightPane',
            representation: 'section',
            title: 'Exact section',
            column: 1
          },
          {
            kind: 'three.pane.representation',
            id: 'leftPane',
            representation: 'perspective',
            title: 'Perspective',
            column: 0
          }
        ]
      }
    };
    const compilation = compileExperimentDocumentV0(
      await prepared(document),
      { compilers: [coreExperimentCompilerV0()] }
    );

    expect(compilation.ok).toBe(true);
    if (!compilation.ok) return;
    expect(compilation.value.ids).toEqual([
      'tesseract',
      'perspective',
      'section',
      'xyw'
    ]);
    expect(compilation.value.document.presentation?.panes.map((pane) => pane.id))
      .toEqual(['rightPane', 'leftPane']);
    expect(compilation.value.get('leftPane')).toMatchObject({
      ok: false,
      failures: [{ code: 'missing-reference' }]
    });
  });

  it('derives lineage witnesses from the constructed objects, never the descriptor', async () => {
    const compilation = compileExperimentDocumentV0(
      await prepared(headlessBridgeDocument()),
      { compilers: [coreExperimentCompilerV0()] }
    );

    const perspective = compiledEntry<ExperimentCompiledRepresentationV0>(
      compilation,
      'perspective',
      'representation'
    );
    expect(perspective.lineage).toEqual({
      sourceDim: 4,
      representationDim: 3,
      steps: [{
        kind: 'iterated-perspective-projection',
        fromDim: 4,
        toDim: 3,
        viewDistance: 5.4,
        epsilon: 1e-6
      }]
    });
    expect(perspective.capabilities).toEqual({
      pointForward: 'conditional',
      pointLift: 'conditional',
      inverseFibre: 'exact',
      attributeTransport: 'unavailable',
      sourceIdentity: 'preserved'
    });

    const coordinate = compiledEntry<ExperimentCompiledRepresentationV0>(
      compilation,
      'xyw',
      'representation'
    );
    expect(coordinate.lineage.steps).toEqual([{
      kind: 'coordinate-subspace-projection',
      fromDim: 4,
      toDim: 3,
      retainedAxes: [0, 1, 3]
    }]);
    expect(coordinate.capabilities.pointForward).toBe('exact');
    expect(coordinate.capabilities.pointLift).toBe('unavailable');

    const section = compiledEntry<ExperimentCompiledRepresentationV0>(
      compilation,
      'section',
      'representation'
    );
    // The authored normal [0, 0, 0, 2] is witnessed as the unit normal the
    // live slice actually carries, with its actually computed chart basis.
    expect(section.lineage.steps).toEqual([
      {
        kind: 'affine-section',
        fromDim: 4,
        toDim: 4,
        normal: [0, 0, 0, 1],
        offset: 0.12
      },
      {
        kind: 'affine-slice-chart',
        fromDim: 4,
        toDim: 3,
        normal: [0, 0, 0, 1],
        offset: 0.12,
        basis: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]
      }
    ]);
    expect(section.capabilities).toEqual({
      pointForward: 'conditional',
      pointLift: 'exact',
      inverseFibre: 'unavailable',
      attributeTransport: 'unavailable',
      sourceIdentity: 'preserved'
    });
    if (section.map.kind !== 'slice4') throw new Error('expected slice map');
    expect(section.map.frame).toBe('canonical');
  });

  it('never emits custom-projection from the closed experiment vocabulary', async () => {
    const compilation = compileExperimentDocumentV0(
      await prepared(headlessBridgeDocument()),
      { compilers: [coreExperimentCompilerV0()] }
    );

    expect(compilation.ok).toBe(true);
    if (!compilation.ok) return;
    for (const id of compilation.value.ids) {
      const entry = compilation.value.get(id);
      if (!entry.ok || entry.value.category !== 'representation') continue;
      for (const step of entry.value.lineage.steps) {
        expect(step.kind).not.toBe('custom-projection');
      }
    }
  });

  it('cuts the exact w = 0.12 section with conserved area and on-plane vertices', async () => {
    const compilation = compileExperimentDocumentV0(
      await prepared(headlessBridgeDocument()),
      { compilers: [coreExperimentCompilerV0()] }
    );
    const source = compiledEntry<ExperimentCompiledSourceV0>(
      compilation,
      'tesseract',
      'source'
    );
    const section = compiledEntry<ExperimentCompiledRepresentationV0>(
      compilation,
      'section',
      'representation'
    );
    if (section.map.kind !== 'slice4') throw new Error('expected slice map');
    const slice = section.map.slice;
    const tets = source.complex.groups.find(
      (group) => group.kind === 'simplex' && group.dim === 3
    )!.indices as Uint32Array;

    const ambient = new Float64Array((tets.length / 4) * 24);
    const vertexCount = sliceTetrahedraAmbient(
      source.complex.positions,
      tets,
      slice,
      ambient
    );
    // Measured marching-tetrahedra golden: the Kuhn decomposition emits 8
    // triangles per cut cube, so 6 cut cubes give 48 triangles, not the 12
    // ideal squares would suggest. The exact invariant is the area.
    expect(vertexCount / 3).toBe(48);

    let area = 0;
    let maxDistance = 0;
    for (let triangle = 0; triangle < vertexCount / 3; triangle++) {
      const at = (vertex: number, coordinate: number): number =>
        ambient[(triangle * 3 + vertex) * 4 + coordinate]!;
      const u = [0, 1, 2, 3].map((c) => at(1, c) - at(0, c));
      const v = [0, 1, 2, 3].map((c) => at(2, c) - at(0, c));
      const uu = u.reduce((sum, x) => sum + x * x, 0);
      const vv = v.reduce((sum, x) => sum + x * x, 0);
      const uv = u.reduce((sum, x, i) => sum + x * v[i]!, 0);
      area += 0.5 * Math.sqrt(Math.max(0, uu * vv - uv * uv));
      for (let vertex = 0; vertex < 3; vertex++) {
        maxDistance = Math.max(maxDistance, Math.abs(slice.signedDistance(
          at(vertex, 0),
          at(vertex, 1),
          at(vertex, 2),
          at(vertex, 3)
        )));
      }
    }
    expect(maxDistance).toBeLessThanOrEqual(1e-12);
    expect(Math.abs(area - 24)).toBeLessThanOrEqual(1e-9);

    // Chart output lifts back into the hyperplane exactly.
    const chart = new Float32Array((tets.length / 4) * 18);
    const chartCount = sliceTetrahedra(
      source.complex.positions,
      tets,
      slice,
      chart
    );
    expect(chartCount).toBe(vertexCount);
    for (let vertex = 0; vertex < 6; vertex++) {
      const lifted = slice.embedPoint([
        chart[vertex * 3]!,
        chart[vertex * 3 + 1]!,
        chart[vertex * 3 + 2]!
      ]);
      expect(Math.abs(slice.signedDistance(...lifted)))
        .toBeLessThanOrEqual(1e-12);
    }
  });

  it('keeps the R3 coordinate specialization exact without manufacturing R4 state', async () => {
    const document: ExperimentDocumentV0 = {
      schema: 'holotope.experiment/0',
      title: 'R3 control',
      ambientDim: 3,
      sources: {
        cube: { kind: 'core.source.hypercube', dim: 3, size: 2 }
      },
      representations: {
        xyz: {
          kind: 'core.representation.coordinate',
          source: 'cube',
          fromDim: 3,
          retainedAxes: [0, 1, 2],
          product: 'both'
        }
      }
    };
    const compilation = compileExperimentDocumentV0(
      await prepared(document),
      { compilers: [coreExperimentCompilerV0()] }
    );

    const source = compiledEntry<ExperimentCompiledSourceV0>(
      compilation,
      'cube',
      'source'
    );
    const representation = compiledEntry<ExperimentCompiledRepresentationV0>(
      compilation,
      'xyz',
      'representation'
    );
    expect(source.dim).toBe(3);
    expect(source.complex.ambientDim).toBe(3);
    if (representation.map.kind !== 'projection') {
      throw new Error('expected projection map');
    }
    for (let vertex = 0; vertex < source.complex.vertexCount; vertex++) {
      const point = [
        source.complex.positions[vertex * 3]!,
        source.complex.positions[vertex * 3 + 1]!,
        source.complex.positions[vertex * 3 + 2]!
      ];
      expect(representation.map.projection.projectPoint(point)).toEqual(point);
    }
    expect(representation.lineage.sourceDim).toBe(3);
    expect(representation.lineage.representationDim).toBe(3);
  });

  it('compiles literal transforms and matches the authored rotor differentially', async () => {
    const authored = Rotor4.fromPlane(0, 3, 0.4)
      .multiply(Rotor4.fromPlane(1, 2, 0.3));
    const document: ExperimentDocumentV0 = {
      ...headlessBridgeDocument(),
      representations: {
        spun: {
          kind: 'core.representation.perspective',
          source: 'tesseract',
          fromDim: 4,
          viewDistance: 5.4,
          transform: {
            translation: [0.25, 0, -0.5, 1],
            rotor4: [...authored.left, ...authored.right] as unknown as
              readonly [
                number, number, number, number,
                number, number, number, number
              ]
          },
          product: 'edges'
        }
      }
    };
    const compilation = compileExperimentDocumentV0(
      await prepared(document),
      { compilers: [coreExperimentCompilerV0()] }
    );
    const spun = compiledEntry<ExperimentCompiledRepresentationV0>(
      compilation,
      'spun',
      'representation'
    );

    expect(spun.pose.kind).toBe('static');
    if (spun.pose.kind !== 'static') throw new Error('unreachable');
    expect(spun.pose.transform).not.toBeNull();
    const samples = [
      [1, -1, 1, -1],
      [0.5, 0.25, -0.75, 2],
      [0, 0, 0, 1]
    ];
    for (const sample of samples) {
      const expected = authored
        .applyToPoint(new VecN(sample))
        .add(new VecN([0.25, 0, -0.5, 1]));
      const received = spun.pose.transform!.applyToPoint(new VecN(sample));
      for (let coordinate = 0; coordinate < 4; coordinate++) {
        expect(Math.abs(
          received.data[coordinate]! - expected.data[coordinate]!
        )).toBeLessThanOrEqual(1e-12);
      }
    }
  });

  it('refuses a non-unit rotor pair with typed out-of-range evidence', async () => {
    const document: ExperimentDocumentV0 = {
      ...headlessBridgeDocument(),
      representations: {
        spun: {
          kind: 'core.representation.perspective',
          source: 'tesseract',
          fromDim: 4,
          viewDistance: 5.4,
          transform: {
            rotor4: [1, 0, 0, 1, 0, 0, 0, 1]
          },
          product: 'edges'
        }
      }
    };
    const compilation = compileExperimentDocumentV0(
      await prepared(document),
      { compilers: [coreExperimentCompilerV0()] }
    );

    expect(compilation).toMatchObject({
      ok: false,
      failures: [{
        code: 'out-of-range',
        pointer: '/representations/spun/transform/rotor4'
      }]
    });
  });

  it('refuses unclaimed kinds, versions, and categories with collected typed evidence', async () => {
    const withModelAndPanes: ExperimentDocumentV0 = {
      ...headlessBridgeDocument(),
      models: {
        tumble: {
          kind: 'physics.model.rigid4',
          source: 'tesseract',
          fixedStep: 1 / 120
        }
      },
      presentation: {
        panes: [
          {
            kind: 'three.pane.representation',
            id: 'leftPane',
            representation: 'perspective',
            title: 'Perspective',
            column: 0
          },
          {
            kind: 'three.pane.representation',
            id: 'rightPane',
            representation: 'section',
            title: 'Section',
            column: 1
          }
        ]
      }
    };
    const core = coreExperimentCompilerV0();
    const bridge = compileExperimentDocumentV0(
      await prepared(withModelAndPanes),
      { compilers: [core] }
    );
    expect(bridge.ok).toBe(false);
    if (bridge.ok) return;
    expect(bridge.failures).toEqual([
      expect.objectContaining({
        code: 'capability-unavailable',
        pointer: '/models/tumble/kind'
      })
    ]);

    const polychoron: ExperimentDocumentV0 = {
      ...headlessBridgeDocument(),
      sources: {
        tesseract: { kind: 'core.source.polychoron', symbol: '8-cell' }
      }
    };
    expect(compileExperimentDocumentV0(
      await prepared(polychoron),
      { compilers: [core] }
    )).toMatchObject({
      ok: false,
      failures: [{
        code: 'capability-unavailable',
        pointer: '/sources/tesseract/kind'
      }]
    });

    const futureVersion = compileExperimentDocumentV0(
      await prepared(headlessBridgeDocument()),
      {
        compilers: [{
          ...core,
          kinds: { ...core.kinds, 'core.source.hypercube': 1 }
        }]
      }
    );
    expect(futureVersion).toMatchObject({
      ok: false,
      failures: [{
        code: 'kind-version-mismatch',
        pointer: '/sources/tesseract/kind',
        detail: { declared: 0, supported: 1 }
      }]
    });

    const nothing = compileExperimentDocumentV0(
      await prepared(headlessBridgeDocument()),
      { compilers: [] }
    );
    expect(nothing.ok).toBe(false);
    if (nothing.ok) return;
    expect(nothing.failures).toHaveLength(4);
    expect(new Set(nothing.failures.map((entry) => entry.code)))
      .toEqual(new Set(['capability-unavailable']));

    const claimsWithoutConstructor = compileExperimentDocumentV0(
      await prepared(headlessBridgeDocument()),
      {
        compilers: [{
          namespace: 'core',
          kinds: core.kinds
        }]
      }
    );
    expect(claimsWithoutConstructor.ok).toBe(false);
    if (claimsWithoutConstructor.ok) return;
    expect(claimsWithoutConstructor.failures[0]).toMatchObject({
      code: 'capability-unavailable',
      pointer: '/sources/tesseract/kind'
    });
    expect(claimsWithoutConstructor.failures[0]!.message)
      .toContain('no source constructor');
  });

  it('refuses a model-owned transform as an unavailable capability at the seam', () => {
    const core = coreExperimentCompilerV0();
    const source = core.compileSource!(
      { kind: 'core.source.hypercube', dim: 4, size: 2 },
      {
        ambientDim: 4,
        id: 'tesseract',
        pointer: '/sources/tesseract',
        resolveSource: () => undefined,
        resolveModel: () => undefined
      }
    );
    expect(source.ok).toBe(true);
    if (!source.ok) return;

    const refused = core.compileRepresentation!(
      {
        kind: 'core.representation.perspective',
        source: 'tesseract',
        fromDim: 4,
        viewDistance: 5.4,
        transform: { fromModel: 'tumble' },
        product: 'both'
      },
      {
        ambientDim: 4,
        id: 'perspective',
        pointer: '/representations/perspective',
        resolveSource: (id) => (id === 'tesseract' ? source.value : undefined),
        resolveModel: () => undefined
      }
    );
    expect(refused).toMatchObject({
      ok: false,
      failures: [{
        code: 'missing-reference',
        pointer: '/representations/perspective/transform/fromModel'
      }]
    });

    // With a model in the registry the same descriptor binds to it rather
    // than copying a pose the model owns.
    const bound = core.compileRepresentation!(
      {
        kind: 'core.representation.perspective',
        source: 'tesseract',
        fromDim: 4,
        viewDistance: 5.4,
        transform: { fromModel: 'tumble' },
        product: 'both'
      },
      {
        ambientDim: 4,
        id: 'perspective',
        pointer: '/representations/perspective',
        resolveSource: (id) => (id === 'tesseract' ? source.value : undefined),
        resolveModel: (id) => (id === 'tumble'
          ? ({
            category: 'model',
            id: 'tumble',
            kind: 'physics.model.rigid4',
            source: 'tesseract',
            pose: () => new TransformN(4),
            advanceModel: () => ({ ok: true, value: { modelStep: 0 } }),
            runtime: null
          } as never)
          : undefined)
      }
    );
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect(bound.value.pose).toEqual({ kind: 'model', model: 'tumble' });
  });

  it('isolates capability sets and compiled objects between compilations', async () => {
    const preparedDocument = await prepared(headlessBridgeDocument());
    const compilers = [coreExperimentCompilerV0()];
    const first = compileExperimentDocumentV0(
      preparedDocument,
      { compilers }
    );
    compilers.pop();
    const second = compileExperimentDocumentV0(
      preparedDocument,
      { compilers }
    );
    const third = compileExperimentDocumentV0(
      preparedDocument,
      { compilers: [coreExperimentCompilerV0()] }
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(third.ok).toBe(true);
    if (!first.ok || !third.ok) return;
    expect(first.value).not.toBe(third.value);
    const a = first.value.get('tesseract');
    const b = third.value.get('tesseract');
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value).not.toBe(b.value);
    expect((a.value as ExperimentCompiledSourceV0).complex)
      .not.toBe((b.value as ExperimentCompiledSourceV0).complex);
  });

  it('never mutates the prepared document', async () => {
    const preparedDocument = await prepared(headlessBridgeDocument());
    const before = canonicalizeExperimentJsonV0(
      preparedDocument.document as unknown as ExperimentJsonValue
    );

    const compilation = compileExperimentDocumentV0(
      preparedDocument,
      { compilers: [coreExperimentCompilerV0()] }
    );

    expect(compilation.ok).toBe(true);
    expect(canonicalizeExperimentJsonV0(
      preparedDocument.document as unknown as ExperimentJsonValue
    )).toBe(before);
    expect(Object.isFrozen(preparedDocument.document)).toBe(true);
    expect(Object.isFrozen(preparedDocument.document.sources)).toBe(true);
  });

  it('disposes exactly once and refuses lookups afterwards', async () => {
    const compilation = compileExperimentDocumentV0(
      await prepared(headlessBridgeDocument()),
      { compilers: [coreExperimentCompilerV0()] }
    );
    expect(compilation.ok).toBe(true);
    if (!compilation.ok) return;

    const lineage = compiledEntry<ExperimentCompiledRepresentationV0>(
      compilation,
      'section',
      'representation'
    ).lineage;

    const disposal = compilation.value.dispose();
    expect(disposal).toEqual({ ok: true, value: { released: 4 } });
    expect(compilation.value.disposed).toBe(true);
    expect(compilation.value.get('tesseract')).toMatchObject({
      ok: false,
      failures: [{ code: 'disposed' }]
    });
    expect(compilation.value.dispose()).toMatchObject({
      ok: false,
      failures: [{ code: 'disposed' }]
    });
    // Layer-3 evidence is a plain frozen value and survives disposal.
    expect(lineage.steps).toHaveLength(2);
  });

  it('refuses forged prepared inputs with typed evidence', async () => {
    const good = await prepared(headlessBridgeDocument());
    const forgedHash = compileExperimentDocumentV0(
      { ...good, documentHash: 'sha256:forged' as `sha256:${string}` },
      { compilers: [coreExperimentCompilerV0()] }
    );
    expect(forgedHash).toMatchObject({
      ok: false,
      failures: [{ code: 'invalid-value', pointer: '/documentHash' }]
    });

    const invalidDocument = JSON.parse(
      JSON.stringify(good.document)
    ) as Record<string, unknown>;
    (invalidDocument.representations as Record<string, { source: string }>)
      .section.source = 'missing';
    const revalidated = compileExperimentDocumentV0(
      {
        ...good,
        document: invalidDocument as unknown as ExperimentDocumentV0
      },
      { compilers: [coreExperimentCompilerV0()] }
    );
    expect(revalidated.ok).toBe(false);
    if (revalidated.ok) return;
    expect(revalidated.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing-reference' })
    ]));
  });

  it('stays headless: Node execution and a core-only static import graph', () => {
    expect(typeof globalThis.document).toBe('undefined');
    expect(typeof globalThis.window).toBe('undefined');

    const here = dirname(fileURLToPath(import.meta.url));
    for (const module of ['compile.ts', 'core-compiler.ts']) {
      const source = readFileSync(join(here, '../src', module), 'utf8');
      const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)]
        .map((match) => match[1]!);
      expect(specifiers.length).toBeGreaterThan(0);
      for (const specifier of specifiers) {
        expect(
          specifier === '@holotope/core' || specifier.startsWith('./')
        ).toBe(true);
      }
    }
  });
});
