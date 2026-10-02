import { describe, expect, it } from 'vitest';
import { REFERENCE_STATE, applyTo, createSlice, setOffset, setTheta } from '../../src/spatial-4d-turn/turn-state.js';
import { BALL, BOX, ContactSimulation, PRESETS, type ContactReport, type Preset } from '../../src/spatial-4d-contact/simulation.js';
import { ON_PLANE_EPSILON, SceneViews, inCut } from '../../src/spatial-4d-contact/views.js';

/**
 * The views against the authoritative state: they read it and change nothing;
 * their labels say what is in the cut and what is not; and the educational
 * claim — something absent from this section changed the motion of something
 * visible, and another view shows the cause — holds on the shipped products.
 */

const deg = (d: number): number => (d * Math.PI) / 180;
const preset = (id: Preset['id']): Preset => PRESETS.find((p) => p.id === id)!;

function snapshot(sim: ContactSimulation) {
  return { box: sim.state('box'), ball: sim.state('ball'), P: sim.totalMomentum(), L: sim.totalAngularMomentum(), t: sim.time };
}

describe('6. view independence', () => {
  it('the same run is bitwise identical with views absent, present, moved and toggled', () => {
    for (const p of PRESETS) {
      const bare = new ContactSimulation(p);
      const viewed = new ContactSimulation(p);
      const slice = createSlice();
      const views = new SceneViews(slice);
      let last: ContactReport | null = null;
      for (let k = 0; k < 180; k++) {
        bare.step();
        const rec = viewed.step();
        last = rec.contact.responded ? rec.contact : last;
        // Move the knife and the context around while the simulation runs.
        applyTo(slice, setOffset(setTheta(REFERENCE_STATE, deg((k % 37) * 4 - 72)), ((k % 11) - 5) * 0.3));
        views.context.setVisible(k % 2 === 0);
        views.update(viewed, last);
        expect(snapshot(viewed), `${p.id} step ${k}`).toEqual(snapshot(bare));
      }
      views.dispose();
    }
  });

  it('updating the views never writes the simulation', () => {
    const sim = new ContactSimulation(preset('off-centre'));
    for (let k = 0; k < 90; k++) sim.step();
    const slice = createSlice();
    const views = new SceneViews(slice);
    const before = snapshot(sim);
    for (const theta of [0, 30, -60, 90]) {
      applyTo(slice, setTheta(REFERENCE_STATE, deg(theta)));
      views.update(sim, sim.contact);
      views.context.setVisible(true);
      views.update(sim, sim.contact);
    }
    expect(snapshot(sim)).toEqual(before);
    views.dispose();
  });
});

describe('the labels say what is and is not in the cut', () => {
  it('at launch: the box is in the reference section, the ball is hidden from it, and the two overlap in projection while apart in w', () => {
    const sim = new ContactSimulation(preset('central'));
    const slice = createSlice();
    const views = new SceneViews(slice);
    views.update(sim, null);
    expect(views.box.status).toBe('present');
    expect(views.ball.status).toBe('outside');
    expect(Math.abs(views.ball.signedDistance)).toBeCloseTo(preset('central').ballStart[3], 12);
    // Projected overlap without contact: the ball's projected centre sits inside the box's shadow …
    const centre = views.context.ball.chartCentre();
    const shadow = views.context.vertexPositions();
    for (let axis = 0; axis < 3; axis++) {
      const lo = Math.min(...shadow.map((v) => v[axis]!));
      const hi = Math_max(shadow.map((v) => v[axis]!));
      expect(centre[axis]!).toBeGreaterThan(lo);
      expect(centre[axis]!).toBeLessThan(hi);
    }
    // … while the true gap along w is the authored one.
    const q = sim.query();
    expect(q.state).toBe('separated');
    expect(q.gap).toBeCloseTo(2.7 - BALL.radius - BOX.halfExtents[3], 12);
    views.dispose();
  });

  it('the cause is hidden in the reference section and revealed by turning the knife toward w', () => {
    // Central preset, reference knife: the ball is never in the w = 0 cut, yet the box leaves it.
    const sim = new ContactSimulation(preset('central'));
    const slice = createSlice();
    const views = new SceneViews(slice);
    let ballEverPresent = false;
    let boxLeftAt: number | null = null;
    let last: ContactReport | null = null;
    while (sim.time < 2.0) {
      const rec = sim.step();
      last = rec.contact.responded ? rec.contact : last;
      views.update(sim, last);
      if (views.ball.status !== 'outside') ballEverPresent = true;
      if (boxLeftAt === null && views.box.status === 'outside') boxLeftAt = sim.time;
    }
    expect(sim.impacts, 'the impact happened').toBe(1);
    expect(ballEverPresent, 'the ball was never in the reference cut').toBe(false);
    expect(boxLeftAt, 'the box left the reference cut after being struck').not.toBeNull();
    expect(boxLeftAt!).toBeGreaterThan(0.6);
    // The same state seen through a knife turned a quarter turn (normal along x): the ball is in that cut.
    applyTo(slice, setTheta(REFERENCE_STATE, deg(90)));
    views.update(sim, last);
    expect(views.ball.status).toBe('present');
    views.dispose();
  });

  it('the projected contact marker carries its own signed distance and does not claim the current cut', () => {
    const sim = new ContactSimulation(preset('off-centre'));
    const slice = createSlice();
    const views = new SceneViews(slice);
    let last: ContactReport | null = null;
    while (sim.impacts === 0 && sim.time < 2) {
      const rec = sim.step();
      last = rec.contact.responded ? rec.contact : last;
    }
    views.update(sim, last);
    expect(last?.pointOnBox).toBeTruthy();
    // The contact point lies on the box's +w face at w ≈ 1.0: not in the w = 0 section.
    expect(views.context.contactSignedDistance).not.toBeNull();
    expect(views.context.contactSignedDistance!).toBeCloseTo(last!.pointOnBox![3]!, 9);
    expect(Math.abs(views.context.contactSignedDistance!)).toBeGreaterThan(0.5);
    expect(views.context.describe()).toMatch(/not a point of the current cut/);
    // Before any impact there is no marker.
    const fresh = new SceneViews(createSlice());
    fresh.update(new ContactSimulation(preset('central')), null);
    expect(fresh.context.contactSignedDistance).toBeNull();
    fresh.dispose();
    views.dispose();
  });

  it('the box’s context follows its pose: after the off-centre impact its projected corners have turned', () => {
    const sim = new ContactSimulation(preset('off-centre'));
    const slice = createSlice();
    const views = new SceneViews(slice);
    views.update(sim, null);
    const before = views.context.vertexPositions();
    expect(views.context.edgeCount()).toBe(32);
    while (sim.time < 1.5) sim.step();
    views.update(sim, sim.contact);
    const after = views.context.vertexPositions();
    expect(views.context.edgeCount()).toBe(32);
    expect(after).not.toEqual(before);
    // The box's section is still present and its face set has changed with the turn in x–w.
    expect(Math.abs(sim.state('box').angularVelocity[2]!)).toBeGreaterThan(0.5);
    views.dispose();
  });
});

function Math_max(values: number[]): number {
  return Math.max(...values);
}

describe('9. the projected contact marker: in-cut is the geometric predicate, never the rounded display', () => {
  it('at |d| = 0.004 the number displays as 0.00 yet the marker is not in the cut; where d vanishes to 1e−9 it is', () => {
    const slice = createSlice();
    const views = new SceneViews(slice);
    const sim = ContactSimulation.atStep(preset('central'), 73);
    const contact = sim.lastImpact!;
    expect(contact.pointOnBox![3]).toBeCloseTo(BOX.halfExtents[3], 6);
    // Reference knife, offset 0.996: the contact point's signed distance is +0.004 — displayed "0.00".
    applyTo(slice, setOffset(REFERENCE_STATE, 0.996));
    views.update(sim, contact);
    const d = views.context.contactSignedDistance!;
    expect(d).toBeCloseTo(0.004, 6);
    expect(d.toFixed(2)).toBe('0.00');
    expect(views.context.contactInCut()).toBe(false);
    expect(views.context.describe()).toContain('is 0.00: it is not a point of the current cut');
    // Knife turned to 90°: the hyperplane x = 0 contains the point (0, 0, 0, 1) to the library's precision.
    applyTo(slice, setTheta(REFERENCE_STATE, deg(90)));
    views.update(sim, contact);
    expect(Math.abs(views.context.contactSignedDistance!)).toBeLessThanOrEqual(ON_PLANE_EPSILON);
    expect(views.context.contactInCut()).toBe(true);
    expect(views.context.describe()).toContain('it lies in the current cut');
    // The predicate itself, at its edge — the sectioner's own classification tolerance.
    expect(ON_PLANE_EPSILON).toBe(1e-9);
    expect(inCut(1e-9)).toBe(true);
    expect(inCut(-1e-9)).toBe(true);
    expect(inCut(1.01e-9)).toBe(false);
    expect(inCut(0.004)).toBe(false);
    views.dispose();
  });
});
