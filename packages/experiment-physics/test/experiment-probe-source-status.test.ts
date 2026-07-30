import {
  createAffineSectionCellChart4N,
  sliceTetrahedra,
  type CellComplex
} from '@holotope/core';
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
 *
 * It is also the case the runtime can now settle itself. Where exactly one
 * source cell matches, the residual bound is evaluated at renderer precision
 * and the answer resolves, reporting which bound produced it. These tests pin
 * both halves: what the widening rescues, and what it must still refuse.
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

/**
 * Midpoint of a section edge shared by triangles from different source cells.
 *
 * These are not rare — most of a tesseract section's edges are cross-cell — but
 * the neighbourhood where the resolver cannot choose between them is only a
 * containment tolerance wide, so it has to be constructed rather than stumbled
 * upon.
 */
function crossCellEdgeMidpoint(compilation: ExperimentCompilationV0): number[] {
  const section = unwrap<ExperimentCompiledRepresentationV0>(
    compilation.get('section')
  );
  if (section.map.kind !== 'slice4') throw new Error('unreachable');
  const complex = unwrap<{ complex: CellComplex }>(
    compilation.get('tesseract')
  ).complex;
  const chart = createAffineSectionCellChart4N(complex, section.map.slice);
  const positions = chart.trianglePositions;
  const corner = (triangle: number, index: number): number[] =>
    [0, 1, 2].map((axis) => positions[triangle * 9 + index * 3 + axis]!);
  const label = (triangle: number, index: number): string =>
    corner(triangle, index).map((value) => value.toFixed(9)).join(',');

  const edges = new Map<string, { a: number[]; b: number[]; cells: Set<number> }>();
  for (let triangle = 0; triangle < chart.triangleCount; triangle += 1) {
    for (const [from, to] of [[0, 1], [1, 2], [2, 0]]) {
      const key = [label(triangle, from), label(triangle, to)].sort().join('|');
      const entry = edges.get(key)
        ?? { a: corner(triangle, from), b: corner(triangle, to), cells: new Set<number>() };
      entry.cells.add(chart.sourceCellIndices[triangle]!);
      edges.set(key, entry);
    }
  }
  for (const entry of edges.values()) {
    if (entry.cells.size > 1) {
      return [0, 1, 2].map((axis) => (entry.a[axis]! + entry.b[axis]!) / 2);
    }
  }
  throw new Error('no section edge joins two source cells');
}

type ProbeOutput = {
  readonly ambientPointStatus: string;
  readonly sourceCellStatus: string;
  readonly sourceCellPrecision?: string;
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

  it('resolves a renderer-precision point and says which bound did it', async () => {
    const compilation = await compiled();
    const { centroid, normal } = emittedTriangle(compilation);

    // A ray hit lands on the Float32 triangle, whose plane is about 1e-7 off
    // the exact one, so the point is slightly off the true surface. Exactly one
    // source cell contains it, so there is nothing it could be misattributed to.
    const rendererPoint = [0, 1, 2].map(
      (axis) => centroid[axis]! + normal[axis]! * 3e-7
    );
    const output = probe(compilation, 'section', rendererPoint);

    expect(output.sourceCellStatus).toBe('resolved');
    expect(output.sourceCell?.ordinal).toBeGreaterThanOrEqual(0);
    expect(output.sourceCellPrecision).toBe('renderer');
    // The widened bound is reported, not hidden: the residual is well above the
    // exact tolerance and well below the renderer one.
    expect(output.sourceResidual).toBeGreaterThan(1e-9);
    expect(output.sourceResidual).toBeLessThan(1e-6);
  });

  it('says when a resolution needed no widening at all', async () => {
    const compilation = await compiled();
    const output = probe(compilation, 'section', emittedTriangleCentroid(compilation));

    expect(output.sourceCellStatus).toBe('resolved');
    expect(output.sourceCellPrecision).toBe('exact');
  });

  it('is bounded by the section surface itself', async () => {
    const compilation = await compiled();
    const { centroid, normal } = emittedTriangle(compilation);
    const off = (distance: number): ProbeOutput => probe(
      compilation,
      'section',
      [0, 1, 2].map((axis) => centroid[axis]! + normal[axis]! * distance)
    );

    // The renderer bound is the containment bound, so a point the resolver
    // still considers to be on a triangle reconciles once there is a single
    // candidate, and a point past that is simply not on the section any more.
    // The widening cannot reach it: nothing attaches a distant point to a cell.
    expect(off(3e-7).sourceCellStatus).toBe('resolved');
    expect(off(1e-3).sourceCellStatus).toBe('not-on-emitted-cell');
    expect(off(1e-3).sourceCell).toBeUndefined();
    expect(off(50).sourceCellStatus).toBe('not-on-emitted-cell');
  });

  it('refuses to widen where more than one source cell matches', async () => {
    const compilation = await compiled();

    // A point on an edge shared by triangles from different source cells. The
    // tight tolerance is doing real work here, so the retry must not fire.
    const output = probe(compilation, 'section', crossCellEdgeMidpoint(compilation));

    expect(output.sourceCellStatus).toBe('ambiguous-primitive');
    expect(output.sourceCell).toBeUndefined();
    expect(output.matchingSourceCells).toBeGreaterThan(1);
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
