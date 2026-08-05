import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import config from '../vite.config';
import {
  buildSheetScene,
  isRefusedReport,
  sourceDigest,
  stepSheetScene,
  type SheetScene
} from '../src/source-linked-sheet/scene.js';
import { cellVertices, readSheetSelection } from '../src/source-linked-sheet/selection.js';
import {
  STEP_SCOPED_LABELS,
  refusalNoteText,
  stepScopedValues
} from '../src/source-linked-sheet/panel.js';

/**
 * The page's physics and its reading of a pick, exercised without a browser.
 *
 * Liveness comes before equivalence throughout. A sheet that never folds, never
 * touches the obstacle, or never moves would let every agreement assertion pass
 * while comparing nothing, which is the failure mode these witnesses exist to
 * rule out.
 */

const RESOLUTION = 5;
const STEPS = 40;

function scene(id: string): SheetScene {
  return buildSheetScene({ resolution: RESOLUTION, id });
}

function run(target: SheetScene, steps: number): ReturnType<typeof stepSheetScene> {
  let report = stepSheetScene(target);
  for (let step = 1; step < steps; step++) report = stepSheetScene(target);
  return report;
}

describe('source-linked sheet — scene', () => {
  it('has the intended topology and fixed-vertex policy', () => {
    const target = scene('topology');
    expect(target.binding.particles.length).toBe(RESOLUTION * RESOLUTION);
    expect(target.fixedVertices).toEqual([0, RESOLUTION - 1]);
    const fixed = target.binding.vertices
      .filter((vertex) => vertex.fixed)
      .map((vertex) => vertex.sourceVertexIndex);
    expect(fixed).toEqual([0, RESOLUTION - 1]);

    const first = stepSheetScene(target);
    // Two triangles per quad over a 4x4 grid of quads.
    expect(first.elementCount).toBe(2 * (RESOLUTION - 1) * (RESOLUTION - 1));
    expect(first.hingeCount).toBeGreaterThan(0);
    // The obstacle's contact group is tetrahedra; its face group is separate.
    expect(target.obstacleGroup.dim).toBe(3);
    expect(target.obstacle.cellsOfDim(2).length).toBe(1);
  });

  it('refines the mesh without growing the sheet', () => {
    // Raising the resolution must add elements over the same patch of R4. A
    // sheet whose spacing were fixed instead would grow with its resolution,
    // walking out of frame and off an obstacle that had not moved with it.
    const extent = (resolution: number): {
      span: [number, number]; corner: number; vertices: number;
    } => {
      const target = buildSheetScene({ resolution, id: `refine-${resolution}` });
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let vertex = 0; vertex < target.sheet.vertexCount; vertex++) {
        maxX = Math.max(maxX, target.sheet.positions[vertex * 4]!);
        maxY = Math.max(maxY, target.sheet.positions[vertex * 4 + 1]!);
      }
      const pinned = target.fixedVertices[1]!;
      return {
        span: [maxX, maxY],
        corner: target.sheet.positions[pinned * 4]!,
        vertices: target.sheet.vertexCount
      };
    };

    const coarse = extent(5);
    for (const resolution of [8, 12, 16]) {
      const finer = extent(resolution);
      expect(finer.span[0], `${resolution} width`).toBeCloseTo(coarse.span[0], 12);
      expect(finer.span[1], `${resolution} depth`).toBeCloseTo(coarse.span[1], 12);
      // The free pin stays where it was, so the sheet hangs from the same place.
      expect(finer.corner, `${resolution} pin`).toBeCloseTo(coarse.corner, 12);
      // Liveness: something did change, or the span check proves nothing.
      expect(finer.vertices).toBeGreaterThan(coarse.vertices);
    }
  });

  it('starts folded, loads under deformation, and reaches the obstacle', { timeout: 60_000 }, () => {
    const target = scene('liveness');

    // At the authored rest state, before anything is advanced: stretch is
    // relaxed because the sheet's rest shape *is* its initial shape. An
    // `> 0` assertion here would pass on ~1e-32 and prove nothing, so the
    // honest witness is that it is roundoff now and material later.
    expect(target.material.evaluate().potentialEnergy).toBeLessThan(1e-20);
    // Bending is genuinely loaded from the start: the sheet is creased against
    // a flat rest, so this is a real threshold rather than a bare `> 0`.
    expect(target.bending.evaluate().potentialEnergy).toBeGreaterThan(1);

    const first = stepSheetScene(target);
    expect(first.bendingEnergy).toBeGreaterThan(1);

    const before = target.binding.particles.map((p) => p.position.data[3] ?? 0);
    const last = run(target, STEPS - 1);

    // Now stretch is materially loaded, and contact is doing work: one
    // certified set query per sheet vertex, some of them inside the band.
    expect(last.intrinsicEnergy).toBeGreaterThan(1e-6);
    expect(last.setQueries).toBe(RESOLUTION * RESOLUTION);
    expect(last.hullVertexCount).toBe(8);
    expect(last.activeBarriers).toBeGreaterThan(0);
    expect(last.contactEnergy).toBeGreaterThan(0);
    // Every active barrier carries a source-retained witness, and interior
    // closest features push along the support normal.
    expect(last.contactWitnesses.length).toBe(last.activeBarriers);
    expect(last.interiorBarriers + last.edgeBarriers).toBe(last.activeBarriers);
    if (last.interiorBarriers > 0) {
      expect(last.peakInteriorLateralShare).toBeLessThanOrEqual(1e-12);
    }
    for (const witness of last.contactWitnesses) {
      expect(witness.sourceVertices.length).toBeGreaterThan(0);
      expect(witness.distance).toBeGreaterThan(0.04);
    }
    expect(last.status).toBe('applied');
    expect(last.condition).toBe('progressed');

    // A free vertex moved; the pinned corners did not.
    const after = target.binding.particles.map((p) => p.position.data[3] ?? 0);
    const centre = Math.floor((RESOLUTION * RESOLUTION) / 2);
    expect(Math.abs(after[centre]! - before[centre]!)).toBeGreaterThan(1e-6);
    for (const pinned of target.fixedVertices) {
      expect(after[pinned]).toBe(before[pinned]);
    }

    // The source buffer followed the particles, which is what both views read.
    for (let vertex = 0; vertex < target.binding.particles.length; vertex++) {
      expect(target.sheet.positions[vertex * 4 + 3])
        .toBe(target.binding.particles[vertex]!.position.data[3]);
    }
  });

  it('applies a step after contact has activated', { timeout: 60_000 }, () => {
    const target = scene('after-contact');
    let activated = 0;
    let appliedAfterContact = 0;
    for (let step = 0; step < STEPS; step++) {
      const report = stepSheetScene(target);
      if (report.activeBarriers > 0) {
        activated++;
        if (report.status === 'applied') appliedAfterContact++;
      }
    }
    expect(activated).toBeGreaterThan(0);
    expect(appliedAfterContact).toBeGreaterThan(0);
  });

  it('replays deterministically from a fresh build', { timeout: 120_000 }, () => {
    const a = scene('replay');
    const b = scene('replay');
    run(a, STEPS);
    run(b, STEPS);
    expect(sourceDigest(b)).toBe(sourceDigest(a));
  });

  it('answers contact from one set, not from the decomposition', { timeout: 60_000 }, () => {
    // The predecessor page compared two broadphase organisations of a per-cell
    // sum. The corrected model has no per-cell anything to organise: the six
    // Kuhn tetrahedra only select the slab's eight corner vertices, and the
    // family answers one certified closest-point query per sheet vertex. The
    // witness worth pinning is that query count and the witness identities —
    // every named source vertex is one of the hull's authoritative corners.
    const target = scene('one-set');
    let sawActive = false;
    for (let step = 0; step < STEPS; step++) {
      const report = stepSheetScene(target);
      expect(report.setQueries, `step ${step}`).toBe(RESOLUTION * RESOLUTION);
      if (report.activeBarriers > 0) {
        sawActive = true;
        for (const witness of report.contactWitnesses) {
          for (const vertex of witness.sourceVertices) {
            expect(target.contact.hullSourceVertices).toContain(vertex);
          }
        }
      }
    }
    expect(sawActive).toBe(true);
  });
});

describe('source-linked sheet — withheld from the built gallery', () => {
  /**
   * The scene is a working consumer of the library and its contract is pinned
   * above; what it is not is a publishable demonstration.
   *
   * Its contact model constrains vertices, and a certified triangle-to-hull
   * audit of the complete run shows the *surface* crossing the support after
   * the sheet drapes past that support's finite edge — with every vertex still
   * legally outside. A gallery page that shows material passing through its own
   * support while saying its ending is honest teaches the wrong thing, so the
   * page has no build entry and no card.
   *
   * This is asserted rather than left to intention because the omission is one
   * line in a list of twenty-seven, and a well-meaning reader would restore it.
   *
   * Both sets are pinned whole rather than probed for one absent name. An
   * independent review deleted an *unrelated* route and an unrelated card and a
   * name-probing version of this test passed both times: it proved this page
   * was absent, but not that nothing else had gone missing with it, which is
   * a weaker guarantee than a page withdrawal wants.
   */
  it('has no build entry and no gallery card', async () => {
    const input = config.build?.rollupOptions?.input;
    const built = Object.values(
      (typeof input === 'object' && input !== null ? input : {}) as Record<string, string>
    ).map((entry) => entry.slice(entry.lastIndexOf('/') + 1)).sort();

    expect(built).toEqual([
      'akn.html', 'ammann-beenker.html', 'bicomplex-julia.html', 'compute.html',
      'dimension-bridge.html', 'duoprisms.html', 'e8.html', 'elser-sloane.html',
      'gpu.html', 'hopf.html', 'index.html', 'knots.html',
      'mechanics-workbench.html', 'nd-contact.html', 'penrose.html',
      'physics-browser.html', 'platonic-brots.html', 'playground.html',
      'polychora.html', 'polytope-browser.html', 'product-browser.html',
      'provenance-browser.html', 'quaternion-julia.html', 'rigid-body4.html',
      'scene.html', 'tesseract.html', 'wythoff.html'
    ]);
    expect(built).not.toContain('source-linked-sheet.html');

    // Every page the gallery links must be a page the build emits, and the
    // withdrawn one must be linked from nowhere.
    const gallery = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const linked = [...new Set(
      [...gallery.matchAll(/href="\.\/([a-z0-9-]+\.html)"/g)].map((match) => match[1]!)
    )].sort();
    expect(linked.length).toBe(20);
    expect(linked.filter((page) => !built.includes(page))).toEqual([]);
    expect(linked).not.toContain('source-linked-sheet.html');
  });

  it('states the vertex-versus-surface boundary on the page itself', async () => {
    // The page remains in the repository and is served by `vite dev`, so its
    // own prose has to carry the finding rather than relying on a note
    // elsewhere: a reader driving it should be told what the certificate covers
    // before they watch the surface cross the support.
    // Collapsed, because the claim is the sentence rather than its wrapping.
    const page = (await readFile(
      new URL('../source-linked-sheet.html', import.meta.url), 'utf8'
    )).replace(/\s+/g, ' ');
    expect(page).toContain('<em>vertex</em>-to-set');
    expect(page).toContain('edge- and face-level contact candidates');
    expect(page).toContain('certified disjoint until step 575');
  });
});

describe('source-linked sheet — selection', () => {
  const group = scene('selection').sheetGroup;

  it('recovers the source vertices of a cell for cross-view highlighting', () => {
    const vertices = cellVertices(group, 0);
    expect(vertices.length).toBe(3);
    expect(cellVertices(group, -1)).toEqual([]);
    expect(cellVertices(group, 10_000)).toEqual([]);
  });

  it('never claims an exact R4 point for an ambiguous pick', () => {
    const selection = readSheetSelection({
      representation: 'projected-surface',
      source: { kind: 'cell', complex: undefined as never, group: undefined as never,
        cellIndex: 7, vertices: [0, 1, 5] } as never,
      ambient: {
        claim: 'on-selected-primitive',
        point: undefined as never,
        ambiguity: 'projection-overlap'
      } as never,
      lineageKinds: ['iterated-perspective-projection']
    } as never, group);

    expect(selection.exactPointJustified).toBe(false);
    expect(selection.claim).toBe('on-selected-primitive');
    expect(selection.ambiguity).toBe('projection-overlap');
    expect(selection.sourceCellIndex).toBe(7);
    expect(selection.sourceVertices).toEqual(cellVertices(group, 7));
    // The sentence must not offer a single R4 point.
    expect(selection.sentence).toMatch(/several R4 points/);
    expect(selection.sentence).not.toMatch(/determines one R4 point/);
  });

  it('permits an exact point only for a unique claim', () => {
    const selection = readSheetSelection({
      representation: 'projected-surface',
      source: { kind: 'cell', complex: undefined as never, group: undefined as never,
        cellIndex: 2, vertices: [0, 1, 5] } as never,
      ambient: { claim: 'unique', point: undefined as never } as never,
      lineageKinds: ['affine-section']
    } as never, group);

    expect(selection.exactPointJustified).toBe(true);
    expect(selection.ambiguity).toBe(null);
    expect(selection.sentence).toMatch(/determines one R4 point/);
  });

  it('keeps barrier and source identities distinct', { timeout: 60_000 }, () => {
    const target = scene('identities');
    let report = stepSheetScene(target);
    // Contact activates once the fall crosses the 0.6 band, ~40 steps in.
    for (let step = 1; step < 90 && report.activeBarriers === 0; step++) {
      report = stepSheetScene(target);
    }
    expect(report.activeBarriers).toBeGreaterThan(0);
    // An active barrier names a dynamic sheet vertex; its witness names static
    // obstacle vertices; a source selection names a sheet triangle. Three
    // vocabularies, none interchangeable.
    const witness = report.contactWitnesses[0]!;
    expect(witness.sourceVertexIndex).toBeGreaterThanOrEqual(0);
    expect(witness.sourceVertices.length).toBeGreaterThan(0);
    expect(cellVertices(target.sheetGroup, 0).length).toBe(3);
  });
  it('classifies an applied step and a typed refusal apart', { timeout: 60_000 }, () => {
    const target = scene('refusal-predicate');
    const applied = stepSheetScene(target);
    // Liveness: the fixture must actually apply, or the negative case below is
    // comparing against nothing.
    expect(applied.status).toBe('applied');
    expect(isRefusedReport(applied)).toBe(false);

    // Every non-applied status is a refusal the page must stop on. Synthesised
    // rather than driven, because reaching the real one takes ~2,775 steps.
    for (const status of ['refused', 'rejected', 'not-converged']) {
      expect(isRefusedReport({ ...applied, status })).toBe(true);
    }
  });

  it('advances the source on an applied step, which is why a refusal is idempotent', () => {
    // The pause rule rests on two facts. This one is cheap: an applied step
    // moves the source, so the next step solves a different configuration.
    const target = scene('refusal-rationale');
    const before = sourceDigest(target);
    const report = stepSheetScene(target);
    expect(report.status).toBe('applied');
    expect(sourceDigest(target)).not.toBe(before);

    // The other fact is the contrapositive: a refusal applies nothing, so the
    // source is unchanged and re-solving it must refuse the same way. Reaching
    // a real refusal on this scene takes ~2,775 steps (~80 s), which is too
    // slow for the suite; it is measured and recorded in the independent-review
    // closure note instead, where re-stepping the refused state six times
    // returned `refused / iteration-limit / 128` every time.
    expect(isRefusedReport({ ...report, status: 'refused' })).toBe(true);
  }, 60_000);

  it('clears every step-scoped inspector value when there is no step', () => {
    // The reset defect: twelve of these fifteen rows kept a previous scene's
    // numbers, because the clearing branch enumerated three of them by hand.
    const cleared = stepScopedValues(null);
    expect(Object.keys(cleared).sort()).toEqual([...STEP_SCOPED_LABELS].sort());
    for (const label of STEP_SCOPED_LABELS) {
      expect(cleared[label], label).toBe('—');
    }
  });

  it('populates exactly the same labels it clears', { timeout: 60_000 }, () => {
    const target = scene('panel-labels');
    run(target, 6);
    const report = stepSheetScene(target);
    const populated = stepScopedValues(report);

    // Same key set in both directions, so neither branch can gain or lose a row
    // without the other. This is what drifted.
    expect(Object.keys(populated).sort())
      .toEqual(Object.keys(stepScopedValues(null)).sort());

    // Liveness: a populated report must not look like a cleared one, or the
    // assertion above would pass on an all-dashes result.
    const dashes = STEP_SCOPED_LABELS.filter((l) => populated[l] === '—');
    expect(dashes).toEqual([]);
    // The label set is closed, so a row retired with the search-mode control
    // cannot linger here as an assertion that reads `undefined` and passes.
    expect(Object.keys(populated)).not.toContain('hierarchy bound tests');
  });
});

describe('source-linked sheet — the refusal note names its evidence', () => {
  const base = {
    status: 'refused',
    condition: 'line-search-refused',
    refusalReason: 'not-converged',
    acceptedIterations: 0,
    intrinsicEnergy: 1, bendingEnergy: 1, contactEnergy: 0, totalPotential: 2,
    hullVertexCount: 8, setQueries: 25, queryIterations: 100,
    activeBarriers: 0, interiorBarriers: 0, edgeBarriers: 0,
    peakInteriorLateralShare: 0,
    hingeCount: 40, elementCount: 32, minimumConormalHeight: 0.009,
    wRange: [0.1, 0.9] as const,
    contactForces: [], contactWitnesses: [],
    diagnosticsSource: 'unchanged-live-state' as const
  };

  it('quotes a closed domain gate: term, reason, cell, and zero trials', () => {
    // The fold term's gate, exactly as the old scene's terminal produced it
    // and as the A1 historical fixture still reproduces it.
    const note = refusalNoteText({
      ...base,
      refusalEvidence: {
        minimizationStatus: 'line-search-refused',
        blockingFilterId: 'sheet-bend/bending-measure-filter',
        filterReason: 'initial-measure-violation',
        blockingIndex: 17,
        trialsEvaluated: 0
      }
    });
    expect(note).toContain('sheet-bend/bending-measure-filter');
    expect(note).toContain('initial-measure-violation');
    expect(note).toContain('cell 17');
    expect(note).toContain('degenerated past the fold term');
    expect(note).toContain('No line-search trial ran');
    expect(note).toContain('unchanged state');
  });

  it('reports a compute-budget refusal as one, with no gate blamed', () => {
    const note = refusalNoteText({
      ...base,
      condition: 'iteration-limit',
      refusalEvidence: {
        minimizationStatus: 'iteration-limit',
        blockingFilterId: null,
        filterReason: null,
        blockingIndex: null,
        trialsEvaluated: 0
      }
    });
    expect(note).toContain('exhausted its iteration budget');
    expect(note).toContain('no domain gate closed');
    expect(note).not.toContain('blocking term');
  });

  it('distinguishes an uncertifiable segment from a degenerate start', () => {
    const note = refusalNoteText({
      ...base,
      refusalEvidence: {
        minimizationStatus: 'line-search-refused',
        blockingFilterId: 'sheet-bend/bending-measure-filter',
        filterReason: 'no-certifiable-prefix',
        blockingIndex: 9,
        trialsEvaluated: 0
      }
    });
    expect(note).toContain('could not certify any admissible prefix');
    expect(note).not.toContain('degenerated past the fold term');
  });
});
