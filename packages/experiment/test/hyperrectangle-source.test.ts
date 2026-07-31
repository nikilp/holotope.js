import { describe, expect, it } from 'vitest';
import { createHyperrectangle } from '@holotope/core';
import {
  canonicalizeExperimentJsonV0,
  compileExperimentDocumentV0,
  coreExperimentCompilerV0,
  prepareExperimentDocumentV0,
  validateExperimentDocumentV0
} from '../src/index.js';

/**
 * A source kind is not finished when one capability knows about it.
 *
 * These cases check the generic machinery — validation pointers,
 * canonicalization, digests, and representation compilation — rather than a
 * hyperrectangle-specific path, because the point of matching hypercube
 * topology is that no such path should be needed.
 */

const EDGES = [2, 3, 5, 7];

/** A section, so every fixture is a complete document rather than a fragment. */
const SECTION = {
  kind: 'core.representation.section4',
  source: 'body',
  normal: [0, 0, 0, 1],
  offset: 0,
  frame: 'canonical'
};

const document = (source: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  schema: 'holotope.experiment/0',
  title: 'Hyperrectangle',
  ambientDim: 4,
  sources: { body: source },
  representations: { cut: SECTION },
  ...extra
});

const valid = (over: Record<string, unknown> = {}) =>
  document({
    kind: 'core.source.hyperrectangle',
    dim: 4,
    edgeLengths: EDGES,
    tetrahedralize: true,
    ...over
  });

const compile = async (json: unknown) => {
  const prepared = await prepareExperimentDocumentV0(json as never);
  expect(prepared.ok, JSON.stringify('failures' in prepared ? prepared.failures : '')).toBe(true);
  if (!prepared.ok) throw new Error('unreachable');
  const compiled = compileExperimentDocumentV0(prepared.value, {
    compilers: [coreExperimentCompilerV0()]
  });
  expect(compiled.ok, JSON.stringify('failures' in compiled ? compiled.failures : '')).toBe(true);
  if (!compiled.ok) throw new Error('unreachable');
  return compiled.value;
};

const pointers = (json: unknown): string[] => {
  const report = validateExperimentDocumentV0(json as never);
  return report.valid ? [] : report.failures.map((failure) => failure.pointer);
};

describe('core.source.hyperrectangle validation', () => {
  it('accepts a well-formed R4 descriptor', () => {
    expect(validateExperimentDocumentV0(valid() as never).valid).toBe(true);
  });

  it('points at edgeLengths when the count does not match the dimension', () => {
    expect(pointers(valid({ edgeLengths: [2, 3, 5] }))).toContain(
      '/sources/body/edgeLengths'
    );
  });

  it('points at the offending index for one invalid component', () => {
    for (const [axis, value] of [
      [0, 0],
      [1, -3],
      [2, Number.NaN],
      [3, Number.POSITIVE_INFINITY]
    ] as const) {
      const lengths = [...EDGES];
      lengths[axis] = value;
      expect(pointers(valid({ edgeLengths: lengths })), `axis ${axis}`).toContain(
        `/sources/body/edgeLengths/${axis}`
      );
    }
  });

  it('refuses a non-array edgeLengths', () => {
    expect(pointers(valid({ edgeLengths: 4 }))).toContain('/sources/body/edgeLengths');
  });

  it('refuses an unknown field rather than dropping it', () => {
    expect(pointers(valid({ size: 2 })).length).toBeGreaterThan(0);
  });

  it('refuses a non-boolean tetrahedralize', () => {
    expect(pointers(valid({ tetrahedralize: 'yes' }))).toContain(
      '/sources/body/tetrahedralize'
    );
  });

  it('requires the source dimension to equal ambientDim', () => {
    const json = valid();
    (json as { ambientDim: number }).ambientDim = 5;
    expect(pointers(json)).toContain('/sources/body/dim');
  });
});

describe('core.source.hyperrectangle canonicalization', () => {
  const digest = async (json: unknown): Promise<string> => {
    const prepared = await prepareExperimentDocumentV0(json as never);
    if (!prepared.ok) throw new Error(JSON.stringify(prepared.failures));
    return prepared.value.documentHash;
  };

  it('is unchanged by object key order', async () => {
    const ordered = valid();
    const shuffled = document({
      tetrahedralize: true,
      edgeLengths: EDGES,
      dim: 4,
      kind: 'core.source.hyperrectangle'
    });
    expect(await digest(shuffled)).toBe(await digest(ordered));
  });

  it('changes when edge lengths are permuted, because axes are ordered', async () => {
    const swapped = valid({ edgeLengths: [3, 2, 5, 7] });
    expect(await digest(swapped)).not.toBe(await digest(valid()));
  });

  it('retains edge-length array order through canonical JSON', () => {
    const canonical = canonicalizeExperimentJsonV0(valid() as never);
    expect(canonical).toContain('"edgeLengths":[2,3,5,7]');
  });
});

describe('core.source.hyperrectangle compilation', () => {
  it('builds the same complex as the direct constructor', async () => {
    const compilation = await compile(valid({ tetrahedralize: false }));
    const entry = compilation.get('body');
    expect(entry.ok).toBe(true);
    if (!entry.ok || entry.value.category !== 'source') throw new Error('unreachable');

    const direct = createHyperrectangle({ dim: 4, edgeLengths: EDGES });
    expect(Array.from(entry.value.complex.positions)).toEqual(
      Array.from(direct.positions)
    );
    expect(entry.value.complex.groups.length).toBe(direct.groups.length);
    expect(entry.value.kind).toBe('core.source.hyperrectangle');
    compilation.dispose();
  });

  it('tetrahedralize: true adds the simplex 3-cells, as the hypercube path does', async () => {
    const withSimplices = await compile(valid({ tetrahedralize: true }));
    const withoutSimplices = await compile(valid({ tetrahedralize: false }));

    const vocabulary = (compilation: Awaited<ReturnType<typeof compile>>): string[] => {
      const entry = compilation.get('body');
      if (!entry.ok || entry.value.category !== 'source') throw new Error('unreachable');
      return entry.value.complex.groups.map((group) => `${group.dim}:${group.kind}`).sort();
    };

    expect(vocabulary(withSimplices)).toEqual([
      '1:cuboid',
      '2:cuboid',
      '3:cuboid',
      '3:simplex'
    ]);
    expect(vocabulary(withoutSimplices)).toEqual(['1:cuboid', '2:cuboid', '3:cuboid']);
    withSimplices.dispose();
    withoutSimplices.dispose();
  });

  it('compiles a section and a projection with no source-specific branch', async () => {
    const compilation = await compile(
      valid()
    );
    compilation.dispose();

    const withViews = await compile({
      ...valid(),
      representations: {
        cut: {
          kind: 'core.representation.section4',
          source: 'body',
          normal: [0, 0, 0, 1],
          offset: 0,
          frame: 'canonical'
        },
        shadow: {
          kind: 'core.representation.perspective',
          source: 'body',
          fromDim: 4,
          viewDistance: 12,
          product: 'both'
        }
      }
    });
    for (const id of ['cut', 'shadow']) {
      const entry = withViews.get(id);
      expect(entry.ok, `${id} did not compile`).toBe(true);
      if (!entry.ok) continue;
      expect(entry.value.category).toBe('representation');
    }
    withViews.dispose();
  });

  it('refuses tetrahedralize below R3, as the hypercube source does', () => {
    // Exercised at the compiler rather than through a document: a valid
    // document must declare a representation, every representation requires
    // `fromDim >= 3`, and source dim must equal ambientDim -- so no valid R2
    // document exists to carry this descriptor. The guard is still the right
    // thing for the compiler to hold, since a capability is reachable by more
    // than one document shape over time.
    const compiler = coreExperimentCompilerV0();
    const result = compiler.compileSource(
      {
        kind: 'core.source.hyperrectangle',
        dim: 2,
        edgeLengths: [2, 3],
        tetrahedralize: true
      },
      {
        ambientDim: 2,
        id: 'body' as never,
        pointer: '/sources/body',
        resolveSource: () => undefined,
        resolveModel: () => undefined
      } as never
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map((failure) => failure.pointer)).toContain(
      '/sources/body/tetrahedralize'
    );
    expect(result.failures[0]?.message).toMatch(/cuboid 3-cells/);
  });
});
