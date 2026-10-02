import { describe, expect, it } from 'vitest';
import { Rotor4, VecN, type HyperplaneSliceN } from '@holotope/core';
import { PIVOT, SCENE, TURN_PLANE, normalAt } from '../../src/spatial-4d-turn/scene.js';
import {
  OFFSET_LIMIT, REFERENCE_STATE, TRANSPORT_STEP_LIMIT, TURN_LIMIT, applyTo, createSlice,
  distanceFromPivot, observerNote, reset, setOffset, setTheta
} from '../../src/spatial-4d-turn/turn-state.js';

const deg = (d: number): number => (d * Math.PI) / 180;
const box = SCENE.find((o) => o.kind === 'hyperbox')!;
const companion = SCENE.find((o) => o.kind === 'glome')!;

describe('the scene is authored once and never moves', () => {
  it('holds the source coordinates, so a drift shows up here first', () => {
    expect(box.kind === 'hyperbox' && box.halfExtents).toEqual([2.2, 1.3, 0.8, 1.6]);
    expect(companion.kind === 'glome' && companion.centre).toEqual([3.6, 1.05, 0, 0.92]);
    expect(companion.kind === 'glome' && companion.radius).toBe(0.72);
  });

  it('is asymmetric in all four axes, so a section identifies how it was cut', () => {
    const h = box.kind === 'hyperbox' ? box.halfExtents : [];
    expect(new Set(h).size, 'four distinct half-extents').toBe(4);
  });
});

describe('the pivot guarantee', () => {
  it('holds at every turn angle while the offset is zero', () => {
    const slice = createSlice();
    for (let d = -90; d <= 90; d += 1) {
      applyTo(slice, setTheta(REFERENCE_STATE, deg(d)));
      expect(Math.abs(distanceFromPivot(slice)), `${d}deg`).toBeLessThan(1e-12);
    }
  });

  it('is given up as soon as the offset is not zero, and by exactly the offset', () => {
    const slice = createSlice();
    for (const o of [-1.6, -0.4, 0.25, 1.6]) {
      for (const d of [-60, 0, 37, 90]) {
        applyTo(slice, setOffset(setTheta(REFERENCE_STATE, deg(d)), o));
        // The section is the parallel hyperplane at signed distance `o`; the
        // pivot is therefore exactly `-o` away from it, never 0.
        expect(distanceFromPivot(slice), `${d}deg @ ${o}`).toBeCloseTo(-o, 12);
      }
    }
  });

  it('keeps the normal a unit vector, because the rotor is an isometry', () => {
    for (let d = -90; d <= 90; d += 5) {
      expect(normalAt(deg(d)).length()).toBeCloseTo(1, 12);
    }
  });
});

describe('reset returns the one reference state', () => {
  it('restores both controls exactly, from anywhere', () => {
    const wandered = setOffset(setTheta(REFERENCE_STATE, deg(63)), 1.1);
    expect(reset()).toEqual(REFERENCE_STATE);
    expect(reset().theta).toBe(0);
    expect(reset().offset).toBe(0);
    expect(wandered).not.toEqual(REFERENCE_STATE);

    const slice = createSlice();
    applyTo(slice, wandered);
    applyTo(slice, reset());
    expect(Array.from(slice.normal.data)).toEqual([0, 0, 0, 1]);
    expect(slice.offset).toBe(0);
    expect(distanceFromPivot(slice)).toBe(0);
  });

  it('clamps both controls to their declared range', () => {
    expect(setTheta(REFERENCE_STATE, 99).theta).toBeCloseTo(TURN_LIMIT, 12);
    expect(setTheta(REFERENCE_STATE, -99).theta).toBeCloseTo(-TURN_LIMIT, 12);
    expect(setOffset(REFERENCE_STATE, 99).offset).toBe(OFFSET_LIMIT);
  });
});

describe('sections that can be predicted without running the sectioner', () => {
  /**
   * The block's section along the turn axis, worked out from the half-extents
   * rather than from the code: the hyperplane through the origin with normal
   * (-sin, 0, 0, cos) meets w = x tan(theta), so |x| <= min(2.2, 1.6/tan) and
   * the chart length is that over cos — min(2.2/cos, 1.6/sin).
   *
   * The two tests directly below hold properties of this PREDICTION — where it
   * peaks, what it is at a quarter turn. They touch no section product, so on
   * their own they could not tell a wrong sectioner from a right one (found in
   * review). `geometry.test.ts` holds the DRAWN vertices to the same formula
   * at every half degree; these stay as the statement of what that test
   * expects.
   */
  const predictedHalfLength = (theta: number): number =>
    theta === 0 ? 2.2 : Math.min(2.2 / Math.cos(theta), 1.6 / Math.sin(theta));

  it('reaches its widest where the two bounds cross, not at either end', () => {
    const crossing = Math.atan(1.6 / 2.2);
    const widest = predictedHalfLength(crossing);
    expect(widest).toBeGreaterThan(predictedHalfLength(0));
    expect(widest).toBeGreaterThan(predictedHalfLength(TURN_LIMIT));
    expect(widest).toBeCloseTo(Math.hypot(2.2, 1.6), 9);
  });

  it('is the w half-extent at a quarter turn, where x has dropped out', () => {
    expect(predictedHalfLength(TURN_LIMIT)).toBeCloseTo(1.6, 9);
    // At a quarter turn the normal is the x axis, so the section is the y-z-w box.
    const n = normalAt(TURN_LIMIT);
    expect(Math.abs(n.data[0]!)).toBeCloseTo(1, 12);
    expect(Math.abs(n.data[3]!)).toBeLessThan(1e-12);
  });

  it('the companion enters and leaves, within the range the control offers', () => {
    const slice = createSlice();
    const centre = companion.kind === 'glome' ? companion.centre : [];
    const radius = companion.kind === 'glome' ? companion.radius : 0;
    const inside: number[] = [];
    for (let d = -90; d <= 90; d += 1) {
      applyTo(slice, setTheta(REFERENCE_STATE, deg(d)));
      if (Math.abs(slice.signedDistance(centre as number[])) < radius) inside.push(d);
    }
    expect(inside.length, 'there is a window where it is present').toBeGreaterThan(5);
    expect(Math.min(...inside), 'it is absent at the reference state').toBeGreaterThan(0);
    expect(Math.max(...inside), 'and absent again before the end of the range')
      .toBeLessThan(90);
  });

  it('turns in the declared plane and no other', () => {
    expect(TURN_PLANE).toEqual({ i: 0, j: 3, label: 'x–w' });
    for (let d = -90; d <= 90; d += 10) {
      const n = normalAt(deg(d));
      // y and z are untouched by an x-w rotation, at every angle.
      expect(Math.abs(n.data[1]!), `${d}deg y`).toBeLessThan(1e-12);
      expect(Math.abs(n.data[2]!), `${d}deg z`).toBeLessThan(1e-12);
    }
  });

  it('the pivot is the origin, as declared', () => {
    expect(PIVOT).toEqual([0, 0, 0, 0]);
    expect(new VecN(PIVOT).length()).toBe(0);
  });
});

/** The reference frame x, y, z turned by the library's rotor in the turn plane. */
const rotorFrame = (theta: number): number[][] =>
  [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]].map((axis) =>
    Array.from(Rotor4.fromPlane(TURN_PLANE.i, TURN_PLANE.j, theta).applyToPoint(new VecN(axis)).data));
/** The slice's chart basis, with negative zeros folded so equality is about values. */
const frameOf = (slice: HyperplaneSliceN): number[][] =>
  slice.basis.map((row) => Array.from(row, (v) => (v === 0 ? 0 : v)));
const REFERENCE_FRAME = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];

describe('the chart frame is the rotor frame, and a function of the state alone', () => {
  // Found in review: one 'continuous' transport of exactly a quarter turn drops
  // the basis vector that has become parallel to the new normal and the frame
  // comes out permuted — a direct jump to 90° gave y, z, w and Reset from there
  // gave y, z, x, so the block reappeared reoriented with no camera input.
  it('equals Rotor4 applied to x, y, z at every half degree, both ends included', () => {
    const slice = createSlice();
    for (let d = -90; d <= 90; d += 0.5) {
      applyTo(slice, setTheta(REFERENCE_STATE, deg(d)));
      const got = frameOf(slice);
      const want = rotorFrame(deg(d));
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 4; c++) expect(got[r]![c]!, `${d}° row ${r} col ${c}`).toBeCloseTo(want[r]![c]!, 12);
      }
    }
  });

  it('a direct jump to either end is bitwise the frame a half-degree drag reaches', () => {
    for (const end of [90, -90]) {
      const jumped = createSlice();
      applyTo(jumped, setTheta(REFERENCE_STATE, deg(end)));
      const dragged = createSlice();
      for (let k = 1; k <= 180; k++) applyTo(dragged, setTheta(REFERENCE_STATE, deg((end * k) / 180)));
      expect(frameOf(dragged), `${end}°`).toEqual(frameOf(jumped));
    }
  });

  it('is continuous into the ends: 90° sits next to 89.5°, and −90° next to −89.5°', () => {
    for (const end of [90, -90]) {
      const atEnd = createSlice();
      applyTo(atEnd, setTheta(REFERENCE_STATE, deg(end)));
      const before = createSlice();
      applyTo(before, setTheta(REFERENCE_STATE, deg(end - Math.sign(end) * 0.5)));
      const a = frameOf(atEnd);
      const b = frameOf(before);
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 4; c++) {
          expect(Math.abs(a[r]![c]! - b[r]![c]!), `${end}° row ${r} col ${c}`).toBeLessThan(0.01);
        }
      }
    }
  });

  it('Reset restores the reference frame exactly, from either end and after a drag', () => {
    const routes: number[][] = [[90], [-90], [37, 90], [-45, 61, -90]];
    routes.push(Array.from({ length: 180 }, (_unused, k) => (k + 1) / 2));
    for (const route of routes) {
      const slice = createSlice();
      for (const d of route) applyTo(slice, setTheta(REFERENCE_STATE, deg(d)));
      applyTo(slice, reset());
      expect(frameOf(slice), `after ${route.length} step(s) ending at ${route[route.length - 1]}°`)
        .toEqual(REFERENCE_FRAME);
      expect(Array.from(slice.normal.data, (v) => (v === 0 ? 0 : v))).toEqual([0, 0, 0, 1]);
    }
  });

  it('never transports by a quarter turn in one step', () => {
    expect(TRANSPORT_STEP_LIMIT).toBeGreaterThan(0);
    expect(TRANSPORT_STEP_LIMIT).toBeLessThan(TURN_LIMIT);
    expect(Math.ceil(TURN_LIMIT / TRANSPORT_STEP_LIMIT - 1e-12), 'two steps reach a slider end').toBe(2);
  });
});

describe('the pivot note names the observer’s actual side, from the sign', () => {
  // Found in review: a fixed "(negative: behind it)" annotation was printed at
  // every offset, so for every negative offset — where the observer point's
  // signed distance is positive — the page called a positive number negative.
  // The note is the same function the page calls, fed the same number.
  const noteAt = (thetaDeg: number, offset: number) => {
    const slice = createSlice();
    applyTo(slice, setOffset(setTheta(REFERENCE_STATE, deg(thetaDeg)), offset));
    return { distance: distanceFromPivot(slice), note: observerNote(distanceFromPivot(slice)) };
  };

  it('negative offsets: the observer is on the side the normal points to, at a positive signed distance', () => {
    for (const [thetaDeg, offset] of [[0, -1.6], [0, -0.8], [0, -0.01], [37, -1.6], [-60, -0.4], [90, -1.6]]) {
      const { distance, note } = noteAt(thetaDeg!, offset!);
      expect(distance, `${thetaDeg}° @ ${offset}: distance is −offset`).toBeCloseTo(-offset!, 12);
      expect(note.side, `${thetaDeg}° @ ${offset}`).toBe('positive-normal');
      expect(note.sentence).toContain('on the side its normal points to');
      expect(note.sentence).toContain(`is +${Math.abs(offset!).toFixed(2)}`);
      expect(note.sentence).not.toMatch(/behind/);
    }
  });

  it('positive offsets: the observer is on the side opposite the normal, at a negative signed distance', () => {
    for (const [thetaDeg, offset] of [[0, 1.6], [0, 0.8], [0, 0.01], [37, 1.6], [-60, 0.4], [90, 1.6]]) {
      const { note } = noteAt(thetaDeg!, offset!);
      expect(note.side, `${thetaDeg}° @ ${offset}`).toBe('negative-normal');
      expect(note.sentence).toContain('on the side opposite its normal');
      expect(note.sentence).toContain(`is −${Math.abs(offset!).toFixed(2)}`);
    }
  });

  it('zero offset: on the section, at every turn', () => {
    for (const thetaDeg of [-90, -36, 0, 36, 90]) {
      const { note } = noteAt(thetaDeg, 0);
      expect(note.side).toBe('on-section');
      expect(note.sentence).toMatch(/passes through the observer point/);
    }
  });

  it('says whose distance it is: the point’s from the section, with the offset as the opposite number', () => {
    const { note } = noteAt(0, -1.6);
    expect(note.sentence).toContain('The observer point lies 1.60 from the section');
    expect(note.sentence).toContain('measured from the section along the normal, is +1.60');
    expect(note.sentence).toContain('opposite number');
  });
});
