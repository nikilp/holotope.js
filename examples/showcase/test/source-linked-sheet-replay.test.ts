import { describe, expect, it } from 'vitest';
import {
  buildSheetScene, sourceDigest, stepSheetScene
} from '../src/source-linked-sheet/scene.js';
import { createSheetReplay } from '../src/source-linked-sheet/replay.js';

/**
 * Replay is a viewing path, and the whole risk in it is that it stops being
 * one.
 *
 * A recording is stored at single precision because that is ample to look at.
 * That makes it categorically unfit to resume a solve from, so the tests below
 * are less about the frames being right than about the live configuration
 * surviving having been looked away from.
 */

const OPTIONS = {
  resolution: 5, tiles: 9, search: 'exhaustive' as const, id: 'replay'
};

/** Advances `steps` applied steps, recording each. */
function run(steps: number): {
  scene: ReturnType<typeof buildSheetScene>;
  replay: ReturnType<typeof createSheetReplay>;
} {
  const scene = buildSheetScene(OPTIONS);
  const replay = createSheetReplay(scene.sheet);
  for (let step = 0; step < steps; step++) {
    const report = stepSheetScene(scene);
    if (report.status === 'applied') replay.record(report);
  }
  return { scene, replay };
}

describe('source-linked sheet: replay', () => {
  it('leaves the trajectory untouched after a review', { timeout: 120_000 }, () => {
    // Reference: 70 steps, never looked away from.
    const plain = buildSheetScene(OPTIONS);
    for (let step = 0; step < 70; step++) stepSheetScene(plain);

    // Same run, interrupted by scrubbing back through it.
    const { scene, replay } = run(60);
    replay.review(20);
    replay.review(1);
    replay.review(45);
    replay.endReview();
    for (let step = 0; step < 10; step++) stepSheetScene(scene);

    expect(sourceDigest(scene)).toBe(sourceDigest(plain));
  });

  it('restores the live configuration bit for bit', () => {
    const { scene, replay } = run(30);
    const live = Float64Array.from(scene.sheet.positions);
    replay.review(5);
    // Liveness: the review has to have actually changed the source, or the
    // restoration below is being tested against a no-op.
    expect(Array.from(scene.sheet.positions)).not.toEqual(Array.from(live));
    replay.endReview();
    expect(Array.from(scene.sheet.positions)).toEqual(Array.from(live));
  });

  it('shows the configuration each step produced', () => {
    const scene = buildSheetScene(OPTIONS);
    const replay = createSheetReplay(scene.sheet);
    const lowestW: number[] = [];
    for (let step = 0; step < 40; step++) {
      const report = stepSheetScene(scene);
      if (report.status !== 'applied') break;
      replay.record(report);
      lowestW.push(report.wRange[0]);
    }
    expect(replay.length).toBe(40);

    for (const frame of [1, 17, 40]) {
      const report = replay.review(frame);
      let low = Infinity;
      for (let v = 0; v < scene.sheet.vertexCount; v++) {
        low = Math.min(low, scene.sheet.positions[v * 4 + 3]!);
      }
      // The frame's geometry and the report stored with it describe the same
      // step — a recording that drifted by one would still look plausible.
      expect(report.wRange[0]).toBeCloseTo(lowestW[frame - 1]!, 5);
      expect(low).toBeCloseTo(lowestW[frame - 1]!, 5);
    }
    replay.endReview();
  });

  it('refuses a frame it never recorded', () => {
    const { replay } = run(12);
    expect(() => replay.review(0)).toThrow(RangeError);
    expect(() => replay.review(13)).toThrow(RangeError);
    expect(replay.reviewing).toBe(false);
  });

  it('stops recording at its budget rather than growing without bound', () => {
    const { scene, replay } = run(0);
    expect(replay.capacity).toBeGreaterThan(3_000);
    expect(replay.truncated).toBe(false);
    // Reaching the real budget would take longer than the scene survives, so
    // the boundary is checked by filling it directly.
    const report = stepSheetScene(scene);
    for (let frame = 0; frame < replay.capacity + 5; frame++) {
      replay.record(report);
    }
    expect(replay.length).toBe(replay.capacity);
    expect(replay.truncated).toBe(true);
  });
});
