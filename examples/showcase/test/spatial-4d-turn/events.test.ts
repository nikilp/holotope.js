import { describe, expect, it } from 'vitest';
import { SCENE } from '../../src/spatial-4d-turn/scene.js';
import { EventScanner, scanOffsetEvents, scanTurnEvents } from '../../src/spatial-4d-turn/events.js';
import { createProducts } from '../../src/spatial-4d-turn/section.js';
import { REFERENCE_STATE, applyTo, createSlice, setTheta } from '../../src/spatial-4d-turn/turn-state.js';

const deg = (d: number): number => (d * Math.PI) / 180;

describe('the slider marks are found, not typed', () => {
  const events = scanTurnEvents(SCENE, 0.5);

  it('finds exactly one companion window, where the scene analysis says it is', () => {
    expect(events.companionWindows).toHaveLength(1);
    const w = events.companionWindows[0]!;
    expect(w.enter).toBeGreaterThan(0);
    expect(w.enter).toBeLessThan(6);
    expect(w.exit).toBeGreaterThan(24);
    expect(w.exit).toBeLessThan(28);
  });

  it('locates the flip at the diagonal, to within one grid step, on both sides', () => {
    // Independent prediction: the x ends leave and the w ends arrive where
    // tan(theta) = 1.6 / 2.2. Scanned upward from -90°, the negative-side change
    // reads gold→red (w-bounded at -90°, x-bounded past -36°) and the positive
    // side red→gold; both bracket the same angle in absolute value.
    const diagonal = (Math.atan(1.6 / 2.2) * 180) / Math.PI;
    expect(events.faceChanges).toHaveLength(2);
    const hasW = (names: readonly string[]) => names.some((n) => n.endsWith('w'));
    const hasX = (names: readonly string[]) => names.some((n) => n.endsWith('x'));
    for (const c of events.faceChanges) {
      const lo = Math.min(Math.abs(c.from), Math.abs(c.to));
      const hi = Math.max(Math.abs(c.from), Math.abs(c.to));
      expect(lo, `bracketed below at ${c.from}..${c.to}`).toBeLessThanOrEqual(diagonal);
      expect(hi, `bracketed above at ${c.from}..${c.to}`).toBeGreaterThanOrEqual(diagonal);
      expect(hi - lo).toBeCloseTo(0.5, 9);
      // Exactly one of x / w is present on each side of every change.
      expect(hasX(c.before) !== hasW(c.before)).toBe(true);
      expect(hasX(c.after) !== hasW(c.after)).toBe(true);
      expect(hasX(c.before)).not.toBe(hasX(c.after));
    }
    const positive = events.faceChanges.find((c) => c.to > 0)!;
    const negative = events.faceChanges.find((c) => c.to < 0)!;
    expect(hasX(positive.before) && hasW(positive.after), '+side: red → gold').toBe(true);
    expect(hasW(negative.before) && hasX(negative.after), '−side: gold → red').toBe(true);
  });

  it('records no face change other than the two flips', () => {
    expect(events.faceChanges).toHaveLength(2);
  });
});

describe('each object says why it looks the way it does', () => {
  const at = (d: number) => {
    const slice = createSlice();
    const products = createProducts(SCENE, slice);
    applyTo(slice, setTheta(REFERENCE_STATE, deg(d)));
    for (const p of products) p.update(slice);
    return products;
  };

  it('the block names which ends bound it, and which side of the transition it is on', () => {
    const [b0] = at(0); const [b50] = at(50);
    expect(b0!.explain()).toMatch(/−x and \+x ends \(red\)/);
    expect(b0!.explain()).toMatch(/w ends are not reached/);
    expect(b0!.explain()).not.toMatch(/far side of the transition/);
    expect(b50!.explain()).toMatch(/−w and \+w ends \(gold\)/);
    expect(b50!.explain()).toMatch(/far side of the transition/);
  });

  it('the companion gives distance against radius, and disclaims the block', () => {
    const [, c0] = at(0); const [, c14] = at(14);
    expect(c0!.explain()).toMatch(/Missed by/);
    expect(c0!.explain()).toMatch(/not about the block/);
    expect(c0!.explain()).toMatch(/0\.92/);
    expect(c14!.explain()).toMatch(/inside its radius/);
    expect(c14!.explain()).toMatch(/ball of radius/);
  });
});

describe('the marks depend on the other control, and say which value they are for', () => {
  it('at offset 1.22 the companion window contains −12°, which it does not at offset 0', () => {
    // The reported defect: turn −12°, offset 1.22, ball visibly in the cut, band
    // still drawn for offset 0. The scan at the live offset must contain that angle.
    const at0 = scanTurnEvents(SCENE, 0.5, 0);
    const at122 = scanTurnEvents(SCENE, 0.5, 1.22);
    const contains = (ev: typeof at0, deg: number) =>
      ev.companionWindows.some((w) => w.enter <= deg && deg <= w.exit);
    expect(contains(at0, -12), 'offset 0 does not contain −12°').toBe(false);
    expect(contains(at122, -12), 'offset 1.22 does contain −12°').toBe(true);
    expect(at122.at.offset).toBe(1.22);
  });

  it('off-centre, the face flips are no longer symmetric about zero', () => {
    const ev = scanTurnEvents(SCENE, 0.5, 1.22);
    const positive = ev.faceChanges.filter((c) => c.to > 0).map((c) => (c.from + c.to) / 2);
    const negative = ev.faceChanges.filter((c) => c.to < 0).map((c) => -(c.from + c.to) / 2);
    expect(positive.length + negative.length).toBeGreaterThan(0);
    if (positive.length && negative.length) {
      expect(Math.abs(positive[0]! - negative[0]!)).toBeGreaterThan(0.5);
    }
  });

  it('along the offset at θ = 0, the block is present exactly for |d| ≤ 1.6 and the ball where predicted', () => {
    const ev = scanOffsetEvents(SCENE, 0.01, 0);
    expect(ev.blockWindows).toHaveLength(1);
    const b = ev.blockWindows[0]!;
    expect(b.enter).toBeCloseTo(-1.6, 1);
    expect(b.exit).toBeCloseTo(1.6, 1);
    // Companion centre w = 0.92, radius 0.72 → present for d in (0.20, 1.64), clipped at 1.6.
    expect(ev.companionWindows).toHaveLength(1);
    const c = ev.companionWindows[0]!;
    expect(c.enter).toBeCloseTo(0.2, 1);
    expect(c.exit).toBeCloseTo(1.6, 1);
    // The only recorded changes are the block entering and leaving the cut at
    // ±1.6 (empty set ↔ full set). Inside its window no bounding face changes.
    const flips = ev.faceChanges.filter((c) => c.before.length > 0 && c.after.length > 0);
    expect(flips, 'sliding parallel to a face changes no bounding faces').toHaveLength(0);
    for (const c of ev.faceChanges) expect(Math.abs((c.from + c.to) / 2)).toBeCloseTo(1.6, 1);
  });
});

describe('the marks are scanned at the phase the ball is actually at', () => {
  // Found in review: the page rounded the phase to a whole degree before
  // scanning, while playback leaves it fractional. Near an entry the two answer
  // differently: at offset −0.02 the ball enters the reference cut at
  // acos(0.70/0.92) = 40.46°, so 40.49° is inside and its rounding, 40°, is not.
  it('near an entry, the actual phase and its rounding answer differently', () => {
    const scanner = new EventScanner(SCENE);
    try {
      const inCutAtTurnZero = (phaseDeg: number): boolean =>
        scanner.turnEvents(-0.02, phaseDeg, 0.5).companionWindows.some((w) => w.enter <= 0 && 0 <= w.exit);
      expect(inCutAtTurnZero(40), 'the rounded phase').toBe(false);
      expect(inCutAtTurnZero(40.49), 'the actual phase').toBe(true);
      expect(scanner.turnEvents(-0.02, 40.49, 0.5).at.phase, 'the scan records the exact phase it was for')
        .toBe(40.49);
    } finally {
      scanner.dispose();
    }
  });
});
