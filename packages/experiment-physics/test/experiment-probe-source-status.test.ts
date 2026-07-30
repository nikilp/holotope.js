import { sliceTetrahedra, type CellComplex } from '@holotope/core';
import {
  coreExperimentCompilerV0,
  compileExperimentDocumentV0,
  prepareExperimentDocumentV0,
  type ExperimentCompilationV0,
  type ExperimentCompiledRepresentationV0,
  type ExperimentDocumentV0,
  type ExperimentSnapshotV0
} from '@holotope/experiment';
import { describe, expect, it } from 'vitest';
import { physicsExperimentCompilerV0 } from '../src/index.js';

/**
 * A probe must say why it could not name a source cell.
 *
 * The resolver already separates "the point is not on an emitted cell" from
 * "the point is on one, but its source coordinate does not reconcile at this
 * precision". The runtime used to answer both by leaving `sourceCell` out, so a
 * caller could not tell a miss from a refusal, and a renderer-derived point
 * looked like a successful probe of nothing. The second case is the one a
 * caller can act on.
 */

const PROBE_ARGS = {
  type: 'object',
  properties: {
    representation: { type: 'string' },
    point: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }
  },
  required: ['representation', 'point'],
  additionalProperties: false
} as const;

function probeDocument(): ExperimentDocumentV0 {
  return {
    schema: 'holotope.experiment/0',
    title: 'Probe source status',
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
        initialAngularMomentum: [0.4, 0, 0, 0.9, 0, 0],
        fixedStep: 1 / 120,
        substeps: 2
      }
    },
    representations: {
      section: {
        kind: 'core.representation.section4',
        source: 'tesseract',
        normal: [0, 0, 0, 1],
        offset: 0,
        frame: 'canonical'
      },
      perspective: {
        kind: 'core.representation.perspective',
        source: 'tesseract',
        fromDim: 4,
        viewDistance: 4,
        epsilon: 1e-6,
        product: 'both'
      }
    },
    actions: [
      {
        id: 'probe',
        title: 'Probe',
        description: 'Reports headless evidence for a chart point.',
        inputSchema: PROBE_ARGS,
        outputSchema: { type: 'object' },
        readOnly: true, destructive: false, idempotent: true,
        deterministic: true, supportsPreview: false,
        budget: { maxMillis: 1000 },
        operation: { kind: 'probe' }
      }
    ]
  };
}

async function compiled(): Promise<ExperimentCompilationV0> {
  const prepared = await prepareExperimentDocumentV0(probeDocument());
  if (!prepared.ok) throw new Error('document did not prepare');
  const compilation = compileExperimentDocumentV0(prepared.value, {
    compilers: [coreExperimentCompilerV0(), physicsExperimentCompilerV0()]
  });
  if (!compilation.ok) throw new Error('document did not compile');
  return compilation.value;
}

function unwrap<Value>(result: { ok: boolean; value?: unknown }): Value {
  if (!result.ok) throw new Error('expected a value');
  return result.value as Value;
}

/** First emitted section triangle, in chart coordinates. */
function emittedTriangle(compilation: ExperimentCompilationV0): {
  readonly centroid: number[];
  readonly vertex: number[];
  readonly normal: number[];
} {
  const centroid = emittedTriangleCentroid(compilation);
  const section = unwrap<ExperimentCompiledRepresentationV0>(
    compilation.get('section')
  );
  if (section.map.kind !== 'slice4') throw new Error('unreachable');
  const complex = unwrap<{ complex: CellComplex }>(
    compilation.get('tesseract')
  ).complex;
  const groups = complex.cellsOfDim(3)
    .filter((group) => group.kind === 'simplex' && group.verticesPerCell === 4);
  let length = 0;
  for (const group of groups) length += group.indices.length;
  const tets = new Uint32Array(length);
  let at = 0;
  for (const group of groups) {
    tets.set(group.indices, at);
    at += group.indices.length;
  }
  const emitted = new Float32Array((tets.length / 4) * 18);
  sliceTetrahedra(complex.positions, tets, section.map.slice, emitted);
  const corners = [0, 1, 2].map((corner) =>
    [0, 1, 2].map((axis) => emitted[corner * 3 + axis]!)
  );
  // Unit normal of the triangle's own plane, in chart coordinates.
  const edgeA = [0, 1, 2].map((axis) => corners[1]![axis]! - corners[0]![axis]!);
  const edgeB = [0, 1, 2].map((axis) => corners[2]![axis]! - corners[0]![axis]!);
  const cross = [
    edgeA[1]! * edgeB[2]! - edgeA[2]! * edgeB[1]!,
    edgeA[2]! * edgeB[0]! - edgeA[0]! * edgeB[2]!,
    edgeA[0]! * edgeB[1]! - edgeA[1]! * edgeB[0]!
  ];
  const norm = Math.hypot(cross[0]!, cross[1]!, cross[2]!);
  return {
    centroid,
    vertex: corners[0]!,
    normal: cross.map((component) => component / norm)
  };
}

/** Centroid of a real emitted section triangle, in chart coordinates. */
function emittedTriangleCentroid(compilation: ExperimentCompilationV0): number[] {
  const section = unwrap<ExperimentCompiledRepresentationV0>(
    compilation.get('section')
  );
  if (section.map.kind !== 'slice4') throw new Error('unreachable');
  const complex = unwrap<{ complex: CellComplex }>(
    compilation.get('tesseract')
  ).complex;
  const groups = complex.cellsOfDim(3)
    .filter((group) => group.kind === 'simplex' && group.verticesPerCell === 4);
  let length = 0;
  for (const group of groups) length += group.indices.length;
  const tets = new Uint32Array(length);
  let at = 0;
  for (const group of groups) {
    tets.set(group.indices, at);
    at += group.indices.length;
  }
  const emitted = new Float32Array((tets.length / 4) * 18);
  sliceTetrahedra(complex.positions, tets, section.map.slice, emitted);
  return [0, 1, 2].map((axis) =>
    (emitted[axis]! + emitted[3 + axis]! + emitted[6 + axis]!) / 3
  );
}

type ProbeOutput = {
  readonly ambientPointStatus: string;
  readonly sourceCellStatus: string;
  readonly sourceCell?: { groupKey: string; ordinal: number };
  readonly triangleIndex?: number;
  readonly sourceCoordinateStatus?: string;
  readonly sourceResidual?: number;
  readonly matchingTriangles?: number;
  readonly matchingSourceCells?: number;
};

function probe(
  compilation: ExperimentCompilationV0,
  representation: string,
  point: readonly number[]
): ProbeOutput {
  const result = compilation.invoke('probe', { representation, point: [...point] });
  expect(result.outcome).toBe('applied');
  return result.output as ProbeOutput;
}

describe('probe source-cell status', () => {
  it('reports a resolved cell with the primitive and residual that produced it', async () => {
    const compilation = await compiled();
    const output = probe(compilation, 'section', emittedTriangleCentroid(compilation));

    expect(output.sourceCellStatus).toBe('resolved');
    expect(output.sourceCell?.ordinal).toBeGreaterThanOrEqual(0);
    expect(output.triangleIndex).toBeGreaterThanOrEqual(0);
    expect(output.sourceCoordinateStatus).toBe('exact');
    expect(output.sourceResidual).toBeLessThan(1e-9);
  });

  it('distinguishes a point that misses every emitted cell', async () => {
    const compilation = await compiled();
    const output = probe(compilation, 'section', [50, 50, 50]);

    expect(output.ambientPointStatus).toBe('exact');
    expect(output.sourceCellStatus).toBe('not-on-emitted-cell');
    expect(output.sourceCell).toBeUndefined();
    expect(output.matchingTriangles).toBe(0);
    expect(output.matchingSourceCells).toBe(0);
  });

  it('separates precision refusal from a miss, just outside a section face', async () => {
    const compilation = await compiled();
    const { centroid, normal } = emittedTriangle(compilation);

    // Lift the triangle's own interior point off the plane of that triangle,
    // staying inside the chart. The source tetrahedron meets the cutting
    // hyperplane in exactly this polygon, so a point 3e-7 off its plane is
    // outside the tetrahedron by far more than the 1e-9 source tolerance while
    // remaining well inside the 1e-6 containment tolerance. An interior point
    // keeps the pick unambiguous, which a polygon corner would not.
    const outside = [0, 1, 2].map(
      (axis) => centroid[axis]! + normal[axis]! * 3e-7
    );

    const output = probe(compilation, 'section', outside);

    expect(output.ambientPointStatus).toBe('exact');
    expect(output.sourceCellStatus).toBe('precision-insufficient');
    expect(output.sourceCell).toBeUndefined();
    // It reached a triangle; it was refused on reconciliation, not containment.
    expect(output.matchingTriangles).toBeGreaterThan(0);
  });

  it('still resolves a chart point that survived a Float32 buffer', async () => {
    const compilation = await compiled();
    const rounded = [...new Float32Array(emittedTriangleCentroid(compilation))];
    const output = probe(compilation, 'section', rounded);

    // Recorded deliberately, because it corrects a plausible reading of the E8
    // reports. Float32 rounding alone does not deny a source cell here: the
    // source residual is measured against the 3-simplex, which is a solid, so a
    // displacement that stays within the hyperplane also stays inside the
    // tetrahedron. Whatever denied the workbench its cell is not reproduced by
    // rounding an interior chart point.
    expect(output.sourceCellStatus).toBe('resolved');
    expect(output.sourceResidual).toBeLessThan(1e-9);
  });

  it('reports that a projection carries no source-cell evidence', async () => {
    const compilation = await compiled();
    const output = probe(compilation, 'perspective', [0, 0, 0]);

    expect(output.ambientPointStatus).toBe('unavailable');
    expect(output.sourceCellStatus).toBe('unavailable-for-representation');
    expect(output.sourceCell).toBeUndefined();
  });

  it('never answers without a status, and stays pure', async () => {
    const compilation = await compiled();
    const before = unwrap<ExperimentSnapshotV0>(compilation.snapshot());
    const revision = compilation.revision;

    const points = [
      emittedTriangleCentroid(compilation),
      [...new Float32Array(emittedTriangleCentroid(compilation))],
      [50, 50, 50],
      [0, 0, 0]
    ];
    for (const representation of ['section', 'perspective']) {
      for (const point of points) {
        const output = probe(compilation, representation, point);
        expect(typeof output.sourceCellStatus).toBe('string');
        // A named cell and a refusal are mutually exclusive.
        expect(output.sourceCell !== undefined)
          .toBe(output.sourceCellStatus === 'resolved');
      }
    }

    expect(compilation.revision).toBe(revision);
    expect(unwrap<ExperimentSnapshotV0>(compilation.snapshot()).buffers)
      .toEqual(before.buffers);
  });
});
