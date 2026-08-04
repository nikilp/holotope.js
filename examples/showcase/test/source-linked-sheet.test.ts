import { describe, expect, it } from 'vitest';
import {
  buildSheetScene,
  candidateIdentities,
  sourceDigest,
  stepSheetScene,
  type CandidateSearch,
  type SheetScene
} from '../src/source-linked-sheet/scene.js';
import { cellVertices, readSheetSelection } from '../src/source-linked-sheet/selection.js';

/**
 * The page's physics and its reading of a pick, exercised without a browser.
 *
 * Liveness comes before equivalence throughout. A sheet that never folds, never
 * touches the obstacle, or never moves would let every agreement assertion pass
 * while comparing nothing, which is the failure mode these witnesses exist to
 * rule out.
 */

const RESOLUTION = 5;
const TILES = 9;
const STEPS = 40;

function scene(search: CandidateSearch, id: string): SheetScene {
  return buildSheetScene({ resolution: RESOLUTION, tiles: TILES, search, id });
}

function run(target: SheetScene, steps: number): ReturnType<typeof stepSheetScene> {
  let report = stepSheetScene(target);
  for (let step = 1; step < steps; step++) report = stepSheetScene(target);
  return report;
}

describe('source-linked sheet — scene', () => {
  it('has the intended topology and fixed-vertex policy', () => {
    const target = scene('exhaustive', 'topology');
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

  it('starts folded, loads under deformation, and reaches the obstacle', { timeout: 60_000 }, () => {
    const target = scene('exhaustive', 'liveness');

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

    // Now stretch is materially loaded, and contact is doing work.
    expect(last.intrinsicEnergy).toBeGreaterThan(1e-6);
    expect(last.retainedPairs).toBeGreaterThan(0);
    expect(last.activeBarriers).toBeGreaterThan(0);
    expect(last.contactEnergy).toBeGreaterThan(0);
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
    const target = scene('exhaustive', 'after-contact');
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
    const a = scene('exhaustive', 'replay');
    const b = scene('exhaustive', 'replay');
    run(a, STEPS);
    run(b, STEPS);
    expect(sourceDigest(b)).toBe(sourceDigest(a));
  });

  it('reaches the same state under both candidate searches', { timeout: 180_000 }, () => {
    const plain = scene('exhaustive', 'search');
    const fast = scene('static-hierarchy', 'search');

    let sawActive = false;
    for (let step = 0; step < STEPS; step++) {
      const a = stepSheetScene(plain);
      const b = stepSheetScene(fast);
      expect(b.status, `step ${step}`).toBe(a.status);
      expect(b.condition, `step ${step}`).toBe(a.condition);
      expect(b.activeBarriers, `step ${step}`).toBe(a.activeBarriers);
      expect(b.retainedPairs, `step ${step}`).toBe(a.retainedPairs);
      if (step % 8 === 0 || step === STEPS - 1) {
        expect(candidateIdentities(fast), `step ${step}`)
          .toEqual(candidateIdentities(plain));
      }
      if (a.activeBarriers > 0) sawActive = true;
    }
    // The comparison is only worth anything once contact is live.
    expect(sawActive).toBe(true);
    expect(candidateIdentities(plain).length).toBeGreaterThan(0);
    expect(sourceDigest(fast)).toBe(sourceDigest(plain));

    // And the hierarchy really was doing tree work, not silently falling back.
    const accelerated = stepSheetScene(fast);
    expect(accelerated.hierarchyBoundTests).not.toBe(null);
    expect(stepSheetScene(plain).hierarchyBoundTests).toBe(null);
  });
});

describe('source-linked sheet — selection', () => {
  const group = scene('exhaustive', 'selection').sheetGroup;

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

  it('keeps candidate, barrier, and source identities distinct', { timeout: 60_000 }, () => {
    const target = scene('exhaustive', 'identities');
    run(target, 8);
    const candidates = candidateIdentities(target);
    expect(candidates.length).toBeGreaterThan(0);
    // A contact candidate names a sheet vertex and an obstacle cell; a source
    // selection names a sheet triangle. They must not be the same vocabulary.
    expect(candidates[0]).toMatch(/source-vertex/);
    expect(candidates[0]).toMatch(/obstacle-cell/);
    expect(cellVertices(target.sheetGroup, 0).length).toBe(3);
  });
});
