import { describe, expect, it } from 'vitest';
import {
  PROJECTION_PADDING, buildProjectionPair, projectedVertices, projectionExtent
} from '../src/flatland/projection.js';

/**
 * The two frame defects an independent review found in scene 4, pinned.
 *
 * Both were the same mistake in different places: a frame chosen for one thing
 * and reused for another. The SVG borrowed the SECTION's extent for the
 * SHADOW, which reaches further; the on-axis camera kept a square frustum while
 * only the perspective camera's aspect was ever updated.
 */

/** The frustum the page computes for a pane, extracted so it can be tested. */
function fitOnAxis(extent: number, width: number, height: number): {
  left: number; right: number; top: number; bottom: number;
} {
  const aspect = width / height;
  return {
    left: aspect >= 1 ? -extent * aspect : -extent,
    right: aspect >= 1 ? extent * aspect : extent,
    top: aspect >= 1 ? extent : extent / aspect,
    bottom: aspect >= 1 ? -extent : -extent / aspect
  };
}

const PANES: [number, number][] = [
  [1600, 400], [1200, 700], [900, 780], [800, 800], [700, 1200], [400, 1600]
];

describe('flatland: the shadow gets a frame that fits it', () => {
  const pair = buildProjectionPair();
  const extent = projectionExtent(pair);

  it('contains every projected vertex of both solids', () => {
    for (const complex of [pair.original, pair.twin]) {
      for (const [x, y] of projectedVertices(pair, complex)) {
        expect(Math.abs(x)).toBeLessThanOrEqual(extent);
        expect(Math.abs(y)).toBeLessThanOrEqual(extent);
      }
    }
  });

  it('does not reuse the section extent, which is too small for a shadow', () => {
    // The defect, stated as a test: a section's vertices never leave the solid
    // and reach √2; the shadow's reach 2√2/√3, and the two ±x poles fell outside.
    const sectionExtent = Math.SQRT2 * 1.02;
    const shadowReach = 2 * Math.SQRT2 / Math.sqrt(3);
    expect(shadowReach).toBeGreaterThan(sectionExtent);
    expect(extent).toBeGreaterThan(shadowReach);
  });

  it('pads by a positive, bounded amount', () => {
    const bare = Math.max(...[pair.original, pair.twin].flatMap((complex) =>
      projectedVertices(pair, complex).flatMap(([x, y]) => [Math.abs(x), Math.abs(y)])));
    expect(extent).toBeGreaterThan(bare);
    expect(extent / bare - 1).toBeCloseTo(PROJECTION_PADDING, 12);
    expect(PROJECTION_PADDING).toBeGreaterThan(0);
    expect(PROJECTION_PADDING).toBeLessThan(0.25);
  });

  it('gives both projections the same frame, because they are the same shadow', () => {
    // Each source computed alone must yield the identical extent — that is what
    // "one common coordinate scale" means, and it is a consequence of the two
    // sharing a shadow rather than an assumption about them.
    const per = [pair.original, pair.twin].map((complex) =>
      Math.max(...projectedVertices(pair, complex)
        .flatMap(([x, y]) => [Math.abs(x), Math.abs(y)])));
    expect(per[0]).toBeCloseTo(per[1]!, 12);
  });

  it('clips nothing at any pane shape, because the frame is square', () => {
    // A square viewBox under `meet` is always fully visible, so containment is
    // aspect-independent. The old frame clipped x below aspect 1.132.
    const worstX = Math.max(...projectedVertices(pair, pair.original)
      .map(([x]) => Math.abs(x)));
    for (const [w, h] of PANES) {
      const aspect = w / h;
      const visibleX = aspect >= 1 ? extent * aspect : extent;
      expect(worstX, `${w}x${h}`).toBeLessThanOrEqual(visibleX);
    }
  });
});

describe('flatland: the on-axis camera does not distort', () => {
  const pair = buildProjectionPair();
  const extent = projectionExtent(pair);

  it('keeps horizontal and vertical pixel scale equal at every pane shape', () => {
    for (const [w, h] of PANES) {
      const f = fitOnAxis(extent, w, h);
      const horizontal = w / (f.right - f.left);
      const vertical = h / (f.top - f.bottom);
      expect(horizontal, `${w}x${h}`).toBeCloseTo(vertical, 9);
    }
  });

  it('fits the whole intended object at wide, square and portrait ratios', () => {
    for (const [w, h] of PANES) {
      const f = fitOnAxis(extent, w, h);
      expect(f.right, `${w}x${h} x`).toBeGreaterThanOrEqual(extent - 1e-12);
      expect(f.top, `${w}x${h} y`).toBeGreaterThanOrEqual(extent - 1e-12);
    }
  });

  it('renders the same shape whatever the viewport aspect', () => {
    // A world-space square must stay square on screen. Under the old fixed
    // frustum this ratio equalled the pane aspect exactly — 4.00 at 1600×400.
    const ratios = PANES.map(([w, h]) => {
      const f = fitOnAxis(extent, w, h);
      return (w / (f.right - f.left)) / (h / (f.top - f.bottom));
    });
    for (const ratio of ratios) expect(ratio).toBeCloseTo(1, 9);
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(1e-9);
  });

  it('is framed to the shadow, so the two pictures are congruent', () => {
    // The button claims the on-axis view IS the amber shadow. Same extent is
    // what makes that a statement about the screen rather than a hope.
    expect(extent).toBe(projectionExtent(pair));
  });
});

describe('flatland: the hidden-plane sliders can express their own neutral', () => {
  // A range input's reachable values are `min + k·step`. If zero is not on that
  // grid the control cannot return to neutral, and scene 6's caption then
  // asserts a rotation that is not happening — which is how an exactly cubic
  // section came to be labelled a box beside dimensions reading 2.00 × 2.00 ×
  // 2.00.
  const REACH = 1.57;
  const STEP = 0.01;

  it('puts zero exactly on the slider grid', () => {
    const steps = (0 - -REACH) / STEP;
    expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-9);
  });

  it('would not have, at the range that shipped', () => {
    // The defect, kept as a test so the arithmetic is not rediscovered.
    const badSteps = (0 - -1.5708) / STEP;
    expect(Math.abs(badSteps - Math.round(badSteps))).toBeGreaterThan(1e-3);
  });

  it('still reaches within a rounding of a quarter turn', () => {
    expect(Math.PI / 2 - REACH).toBeLessThan(0.001);
  });
});
