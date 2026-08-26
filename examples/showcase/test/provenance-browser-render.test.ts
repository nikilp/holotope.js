import { beforeEach, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  CellComplex, CoordinateProjection, VecN,
  createRepresentationLineageN, createSourceCellIdN, createSourceCellReferenceN,
  type RepresentationHitN
} from '@holotope/core';
import {
  ProjectedSurface3D, representationHitFromProjectedSurface
} from '@holotope/three';
import { observationRows, presentObservation } from '../src/provenance-observation.js';
import { reportCounts } from '../src/viewer-ui.js';

/**
 * What the provenance browser actually paints.
 *
 * The real `reportCounts` runs against a minimal DOM stub, because the defect
 * this covers lived entirely in `replaceChildren()`: the page painted the
 * source record and then painted over it. Asserting the pure decision would
 * have missed that, so these read the container back.
 */

interface StubNode { textContent: string; readonly children: StubNode[] }
let painted: StubNode[];

beforeEach(() => {
  painted = [];
  const stats = {
    replaceChildren: (): void => { painted.length = 0; },
    append: (...nodes: unknown[]): void => {
      for (const node of nodes) {
        painted.push(typeof node === 'string'
          ? { textContent: node, children: [] }
          : node as StubNode);
      }
    }
  };
  (globalThis as { document?: unknown }).document = {
    getElementById: (id: string) => (id === 'stats' ? stats : null),
    createElement: (): StubNode => ({ textContent: '', children: [] })
  };
});

/** Everything currently in #stats, as one string. */
const readBack = (): string => painted.map((node) => node.textContent).join(' ');

const INSTRUCTION = 'click a rendered surface to inspect its source';

/** A complex of independent triangles; no vertex shared between cells. */
function trianglesComplex(triangles: readonly (readonly number[][])[]): CellComplex {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const triangle of triangles) {
    for (const vertex of triangle) {
      indices.push(positions.length / 4);
      positions.push(vertex[0]!, vertex[1]!, vertex[2]!, vertex[3]!);
    }
  }
  return new CellComplex(4, Float64Array.from(positions), [
    { key: 'faces', dim: 2, verticesPerCell: 3, kind: 'simplex',
      indices: Uint32Array.from(indices) }
  ]);
}

const flatTriangle = (w: number): number[][] =>
  [[-1, -1, 0, w], [1, -1, 0, w], [0, 1, 0, w]];

/** A real hit, adapted from a real product rather than written by hand. */
function realHit(w: number): RepresentationHitN {
  const surface = new ProjectedSurface3D(
    trianglesComplex([flatTriangle(w)]),
    new CoordinateProjection({ fromDim: 4, axes: [0, 1, 2] })
  );
  surface.update();
  const hit = representationHitFromProjectedSurface(surface, {
    point: new Vector3(0, 0, 0), faceIndex: 0
  });
  surface.dispose();
  return hit;
}

/** A second complex, so two hits name two sources. */
function handMadeHit(complex: CellComplex, cellIndex: number): RepresentationHitN {
  const reference = createSourceCellReferenceN(complex, complex.groups[0]!, cellIndex);
  return {
    representation: 'projected-surface', point3: [0, 0, 0], ambientDim: 4,
    ambientPointStatus: 'exact', ambientPoint: new VecN([1, 2, 3, 4]),
    ambiguity: 'projection-overlap', lineage: createRepresentationLineageN(4, []),
    source: { kind: 'cell', complex, intrinsicDim: 2, cellIndex,
      vertexIndices: [cellIndex * 3, cellIndex * 3 + 1, cellIndex * 3 + 2],
      reference, id: createSourceCellIdN(reference) }
  } as RepresentationHitN;
}

const PROVENANCE_LABELS = [
  'representation', 'source kind', 'source cell index', 'source cell dimension',
  'source vertices', 'ambient point', 'in R⁴', 'ambiguity'
] as const;

/**
 * Labels that appear only in the provenance rows.
 *
 * `'ambiguity'` is excluded because the presentation's own `point ambiguity`
 * row contains it as a substring — a looser check would pass for the wrong
 * reason.
 */
const PROVENANCE_ONLY = [
  'representation', 'source kind', 'source cell index', 'source cell dimension',
  'source vertices', 'ambient point', 'in R⁴'
] as const;

/** Whether any row carries exactly this label, read structurally. */
const hasLabel = (
  rows: readonly (readonly [number | string, string])[],
  label: string
): boolean => rows.some(([, text]) => text === label);

describe('the provenance browser paints one observation once', () => {
  it('a unique exact cell target keeps target, point ambiguity AND all provenance', () => {
    const hit = realHit(1.5);
    expect(hit.ambientPointStatus).toBe('exact');
    const presentation = presentObservation([hit], 1);
    expect(presentation.outcome).toBe('unique');

    reportCounts(observationRows(presentation, INSTRUCTION));
    const shown = readBack();

    // Both readings the presentation carries…
    expect(shown).toContain('target');
    expect(shown).toContain('point ambiguity');
    // …and every provenance row the source record establishes.
    for (const row of PROVENANCE_LABELS) {
      expect(shown, `provenance row "${row}"`).toContain(row);
    }
    // Including the recovered ambient point, which is the row the module
    // JSDoc promises and the defect removed.
    expect(shown).toContain('in R⁴');
    expect(observationRows(presentation, INSTRUCTION)).toHaveLength(2 + 8);
  });

  it('FALSIFIER: restoring the second overwriting render loses the provenance', () => {
    // The defect, reproduced against the real reportCounts. This is what makes
    // the assertion above load-bearing rather than incidental.
    const presentation = presentObservation([realHit(1.5)], 1);
    reportCounts(observationRows(presentation, INSTRUCTION));
    expect(readBack()).toContain('source vertices');

    // The removed second call.
    reportCounts(presentation.rows.map(([label, value]): [string, string] => [label, value]));
    const afterOverwrite = readBack();
    for (const row of PROVENANCE_ONLY) {
      expect(afterOverwrite, `"${row}" survived an overwrite`).not.toContain(row);
    }
  });

  it('multiple candidates list every candidate and describe none', () => {
    const first = trianglesComplex([flatTriangle(-1.5)]);
    const second = trianglesComplex([flatTriangle(2.25)]);
    const presentation = presentObservation(
      [handMadeHit(first, 0), handMadeHit(second, 0)], 2);
    expect(presentation.outcome).toBe('multiple');
    expect(presentation.highlightHit).toBeNull();

    reportCounts(observationRows(presentation, INSTRUCTION));
    const shown = readBack();
    expect(shown).toContain('candidate #1');
    expect(shown).toContain('candidate #2');
    expect(shown).toContain('selects none');
    // No provenance is painted, because no candidate was chosen.
    for (const row of PROVENANCE_ONLY) {
      expect(shown, `"${row}" painted without a chosen candidate`).not.toContain(row);
    }
  });

  it('an incomplete adaptation shows the refusal and no partial provenance', () => {
    const presentation = presentObservation([realHit(1.5)], 2,
      'ProjectedSurface3D: faceIndex 999 out of range');
    expect(presentation.outcome).toBe('incomplete');
    const rows = observationRows(presentation, INSTRUCTION);
    reportCounts(rows);
    const shown = readBack();
    expect(shown).toContain('incomplete');
    expect(shown).toContain('faceIndex 999 out of range');
    // No target is named — checked on the row labels, because the incomplete
    // message itself contains the word "target".
    expect(hasLabel(rows, 'target')).toBe(false);
    for (const row of PROVENANCE_ONLY) {
      expect(shown, `"${row}" leaked from a partial observation`).not.toContain(row);
    }
  });

  it('a fail-closed refusal shows the reason and no provenance', () => {
    const alien = { source: { kind: 'not-a-real-kind' } } as unknown as RepresentationHitN;
    const presentation = presentObservation([alien], 1);
    expect(presentation.outcome).toBe('refused');
    reportCounts(observationRows(presentation, INSTRUCTION));
    const shown = readBack();
    expect(shown).toContain('unsupported source kind');
    expect(shown).not.toContain('source vertices');
  });

  it('an empty observation keeps the page instruction', () => {
    const presentation = presentObservation([], 0);
    expect(presentation.outcome).toBe('empty');
    reportCounts(observationRows(presentation, INSTRUCTION));
    expect(readBack()).toContain(INSTRUCTION);
  });
});
