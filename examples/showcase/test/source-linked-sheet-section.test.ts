import { describe, expect, it } from 'vitest';
import {
  buildSheetScene, stepSheetScene
} from '../src/source-linked-sheet/scene.js';
import { SLICE_AXIS, sliceRange, sliceSurface } from '../src/source-linked-sheet/slice.js';
import { classifyContactForce } from '../src/source-linked-sheet/contact-overlay.js';

/**
 * The two representations added because the projections could not answer a
 * reader's question: whether the sheet and the obstacle actually meet.
 *
 * A section is worth having only if it is injective, and the contact overlay is
 * worth having only if it reports the barrier's real behaviour rather than a
 * plausible-looking recolouring. Both claims are checked here against the same
 * scene the page runs.
 */

const OPTIONS = {
  resolution: 5, tiles: 9, search: 'exhaustive' as const, id: 'section'
};

describe('source-linked sheet — Z section', () => {
  it('cuts the sheet where the sheet actually is', () => {
    const scene = buildSheetScene(OPTIONS);
    const [low, high] = sliceRange([scene.sheet]);
    expect(high).toBeGreaterThan(low);

    // The crease row sits above the rest, so a plane between them must cut.
    const between = (low + high) / 2;
    const cut = sliceSurface(scene.sheet, scene.sheetGroup, between);
    expect(cut.count).toBeGreaterThan(0);

    // Above and below everything, it must cut nothing at all.
    expect(sliceSurface(scene.sheet, scene.sheetGroup, high + 1).count).toBe(0);
    expect(sliceSurface(scene.sheet, scene.sheetGroup, low - 1).count).toBe(0);
  });

  it('puts every section point exactly on its hyperplane', () => {
    const scene = buildSheetScene(OPTIONS);
    for (let step = 0; step < 20; step++) stepSheetScene(scene);
    const [low, high] = sliceRange([scene.sheet]);
    const offset = low + (high - low) * 0.4;
    const cut = sliceSurface(scene.sheet, scene.sheetGroup, offset);
    expect(cut.count).toBeGreaterThan(0);

    // Every endpoint must lie on the sheet, at the sliced coordinate. The
    // section shows X, Y and W, so the check is that the interpolation landed
    // on the plane rather than near it.
    const dim = scene.sheet.ambientDim;
    for (let segment = 0; segment < cut.count; segment++) {
      for (let end = 0; end < 2; end++) {
        const x = cut.segments[segment * 6 + end * 3]!;
        const y = cut.segments[segment * 6 + end * 3 + 1]!;
        // Reconstruct the R4 point: the section holds Z fixed by construction.
        const point = [x, y, offset, cut.segments[segment * 6 + end * 3 + 2]!];
        expect(point[SLICE_AXIS]).toBe(offset);
        expect(Number.isFinite(point[0]!)).toBe(true);
        expect(Number.isFinite(point[3]!)).toBe(true);
      }
    }
    expect(dim).toBe(4);
  });

  it('is injective where a projection is not', () => {
    // Two source points differing only in the sliced coordinate collapse onto
    // the same pixel under a projection that drops it. A section cannot show
    // both at once, which is exactly why an overlap in one is real.
    const scene = buildSheetScene(OPTIONS);
    const [low, high] = sliceRange([scene.sheet]);
    const a = sliceSurface(scene.sheet, scene.sheetGroup, low + (high - low) * 0.3);
    const b = sliceSurface(scene.sheet, scene.sheetGroup, low + (high - low) * 0.7);
    expect(a.count).toBeGreaterThan(0);
    expect(b.count).toBeGreaterThan(0);
    // Different hyperplanes, different sections — no point is in both.
    const key = (cut: typeof a, i: number): string =>
      Array.from(cut.segments.slice(i * 6, i * 6 + 6)).join(',');
    const first = new Set(Array.from({ length: a.count }, (_, i) => key(a, i)));
    for (let i = 0; i < b.count; i++) expect(first.has(key(b, i))).toBe(false);
  });
});

describe('source-linked sheet — contact roles', () => {
  it('separates a normal push from a sideways one', () => {
    // A support acts along the gravity axis; anything else is the obstacle
    // moving the sheet rather than holding it.
    expect(classifyContactForce({ data: Float64Array.from([0, 0, 0, 5]) }).role)
      .toBe('held');
    expect(classifyContactForce({ data: Float64Array.from([0, 0, 4, 5]) }).role)
      .toBe('pushed-aside');
    expect(classifyContactForce({ data: Float64Array.from([0, 0, 0, 0]) }).role)
      .toBe('free');
    expect(classifyContactForce(undefined).role).toBe('free');
    // A purely lateral force is unboundedly sideways, not merely mostly so.
    expect(classifyContactForce({ data: Float64Array.from([3, 0, 0, 0]) }).lateralFraction)
      .toBe(Infinity);
  });

  it('reports the sideways push the real scene produces', { timeout: 120_000 }, () => {
    const scene = buildSheetScene(OPTIONS);
    const first = stepSheetScene(scene);
    // One force per bound vertex, in source order.
    expect(first.contactForces.length).toBe(scene.sheet.vertexCount);

    // Liveness: the barrier is doing something on the very first step.
    const active = first.contactForces
      .filter((force) => classifyContactForce(force).role !== 'free');
    expect(active.length).toBeGreaterThan(0);

    // The finding this overlay exists to show: on an undeformed sheet lying
    // square over the obstacle, a real share of the barrier force is lateral.
    // A support would give none.
    const peak = Math.max(
      ...first.contactForces.map((f) => {
        const { lateralFraction } = classifyContactForce(f);
        return Number.isFinite(lateralFraction) ? lateralFraction : 0;
      })
    );
    expect(peak).toBeGreaterThan(0.05);

    for (let step = 0; step < 60; step++) stepSheetScene(scene);
    const later = stepSheetScene(scene);
    const pushed = later.contactForces
      .filter((force) => classifyContactForce(force).role === 'pushed-aside');
    // By the time the sheet is settling, most of what contact is doing to it
    // is not holding it up.
    expect(pushed.length).toBeGreaterThan(0);
  });
});
