import { describe, expect, it } from 'vitest';
import { SCENE, positionAt, type GlomeObject, type HyperboxObject } from '../../src/spatial-4d-turn/scene.js';
import { scanPhaseEvents, scanTurnEvents } from '../../src/spatial-4d-turn/events.js';
import { REFERENCE_STATE, reset, setPhase } from '../../src/spatial-4d-turn/turn-state.js';

const ball = SCENE.find((o) => o.kind === 'glome') as GlomeObject;
const box = SCENE.find((o) => o.kind === 'hyperbox') as HyperboxObject;
const rad = (d: number): number => (d * Math.PI) / 180;

describe('the ball’s stated path', () => {
  it('starts where the ball rests', () => {
    expect(positionAt(ball, 0).map((v) => Number(v.toFixed(12)))).toEqual([...ball.centre]);
  });

  it('circles the orbit centre at constant radius, in the declared plane only', () => {
    const o = ball.orbit.centre;
    const armLength = Math.hypot(...ball.centre.map((c, i) => c - o[i]!));
    for (let d = 0; d < 360; d += 5) {
      const p = positionAt(ball, rad(d));
      expect(Math.hypot(...p.map((v, i) => v - o[i]!)), `${d}° radius`).toBeCloseTo(armLength, 9);
      // The plane is z–w: x and y never change.
      expect(p[0], `${d}° x`).toBeCloseTo(ball.centre[0], 9);
      expect(p[1], `${d}° y`).toBeCloseTo(ball.centre[1], 9);
    }
  });

  it('never touches the block, at any phase', () => {
    // Distance from a point to the axis-aligned box, from the half-extents.
    const h = box.halfExtents;
    for (let d = 0; d < 360; d += 1) {
      const p = positionAt(ball, rad(d));
      const gap = Math.hypot(...p.map((v, i) => Math.max(0, Math.abs(v) - h[i]!)));
      expect(gap, `${d}°`).toBeGreaterThan(ball.radius + 0.5);
    }
  });

  it('is in the reference cut on two predicted arcs', () => {
    // w = 0.92 cos(phase) is within the radius 0.72 when |cos| < 0.72/0.92:
    // phase in (38.5°, 141.5°) and (218.5°, 321.5°).
    const bound = (Math.acos(ball.radius / 0.92) * 180) / Math.PI;
    const ev = scanPhaseEvents(SCENE, 1, 0, 0);
    expect(ev.companionWindows).toHaveLength(2);
    // On a 1° grid the first sample inside lies in (bound, bound + 1] and the
    // last sample inside in [exit − 1, exit): bracket each edge by one step.
    const step = ev.gridStep;
    const within = (sample: number, edge: number, side: 'after' | 'before') => {
      if (side === 'after') { expect(sample).toBeGreaterThan(edge); expect(sample - edge).toBeLessThanOrEqual(step + 1e-9); }
      else { expect(sample).toBeLessThan(edge); expect(edge - sample).toBeLessThanOrEqual(step + 1e-9); }
    };
    const [a, b] = ev.companionWindows;
    within(a!.enter, bound, 'after');          within(a!.exit, 180 - bound, 'before');
    within(b!.enter, 180 + bound, 'after');    within(b!.exit, 360 - bound, 'before');
    expect(ev.blockWindows, 'the block does not move, so it is in the cut at every phase')
      .toEqual([{ enter: 0, exit: 359 }]);
  });
});

describe('phase is mathematical state', () => {
  it('wraps into one revolution and is zeroed by reset', () => {
    expect(setPhase(REFERENCE_STATE, rad(370)).phase).toBeCloseTo(rad(10), 12);
    expect(setPhase(REFERENCE_STATE, rad(-10)).phase).toBeCloseTo(rad(350), 12);
    expect(reset().phase).toBe(0);
  });

  it('changes what the knife’s marks say, because the ball has moved', () => {
    const rest = scanTurnEvents(SCENE, 0.5, 0, 0);
    const halfway = scanTurnEvents(SCENE, 0.5, 0, 90);   // ball at w = 0: in the reference cut
    expect(rest.companionWindows.some((w) => w.enter <= 0 && 0 <= w.exit)).toBe(false);
    expect(halfway.companionWindows.some((w) => w.enter <= 0 && 0 <= w.exit)).toBe(true);
    expect(halfway.at.phase).toBe(90);
  });
});
