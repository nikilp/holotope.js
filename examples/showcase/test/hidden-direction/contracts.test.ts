import { VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import { createExperience } from '../../src/hidden-direction/experience.js';
import {
  BALL, BOX, ContactSimulation, DEFAULT_SETTINGS, FRICTION, PRESETS, RESTITUTION, impactStepOf, type Preset
} from '../../src/spatial-4d-contact/simulation.js';
import { SCENE } from '../../src/spatial-4d-turn/scene.js';
import { OFFSET_LIMIT, TURN_LIMIT } from '../../src/spatial-4d-turn/turn-state.js';

/**
 * The authored contracts the experience stands on, pinned by literal: the
 * collision's material and solver settings, its two launches, its two bodies,
 * the turning scene, the slice's limits — and the experience's own clocks,
 * read through behaviour (the orbit's period, the longest frame credited, the
 * most physics steps per frame).
 *
 * A literal here is the number as authored, written out; nothing is read back
 * from the module under test to build an expectation. Where a constant lives
 * inside the controller and is not exported, it is pinned through what it
 * does to the state the page renders.
 *
 * The last section holds that the experience never builds a simulation of its
 * own: after every launch, replay, jump and step-back, its simulation is
 * bitwise the state of an independent replay of the same preset to the same
 * step, with the same settings.
 *
 * Not proved here: that the physics is right (the contact suite's simulation
 * tests do that against independent closed forms), nor that the page's
 * animation loop feeds `tick` with wall-clock seconds (that needs a browser).
 */

const preset = (id: Preset['id']): Preset => PRESETS.find((p) => p.id === id)!;

/** Everything a simulation's state is, read from its own objects. */
function snapshot(sim: ContactSimulation) {
  const pose = sim.boxPose();
  return {
    steps: sim.steps, time: sim.time, impacts: sim.impacts,
    ball: sim.state('ball'), box: sim.state('box'),
    ballPosition: Array.from(sim.ball.position.data),
    // The posed box, probed at its origin and at an asymmetric point.
    pose: [Array.from(pose.applyToPoint(new VecN([0, 0, 0, 0])).data), Array.from(pose.applyToPoint(new VecN([1.2, -0.9, 0.7, 1])).data)],
    contact: sim.contact, lastImpact: sim.lastImpact,
    settings: sim.settings, preset: sim.preset.id
  };
}

const AUTHORED_SETTINGS = { dt: 1 / 120, substeps: 2, solver: { iterations: 16, restitutionThreshold: 0, baumgarte: 0, warmStart: false } };

describe('the collision’s material and solver contract', () => {
  it('restitution is exactly 1 and friction exactly 0', () => {
    expect(RESTITUTION).toBe(1);
    expect(FRICTION).toBe(0);
  });

  it('the default settings are 1/120 s steps, two substeps, sixteen iterations, no restitution threshold, no Baumgarte, no warm start', () => {
    expect(DEFAULT_SETTINGS).toEqual(AUTHORED_SETTINGS);
  });

  it('the simulation the experience runs carries those numbers on its live colliders and solver', () => {
    const x = createExperience('collision');
    const sim = x.worlds.contact.sim;
    expect(sim.settings).toEqual(AUTHORED_SETTINGS);
    for (const collider of [sim.ballCollider, sim.boxCollider]) {
      expect(collider.restitution).toBe(1);
      expect(collider.friction).toBe(0);
    }
    expect(sim.pipeline.solver.iterations).toBe(16);
    expect(sim.pipeline.solver.restitutionThreshold).toBe(0);
    expect(sim.pipeline.solver.baumgarte).toBe(0);
    expect(sim.pipeline.solver.warmStart).toBe(false);
    x.dispose();
  });
});

describe('the two launches and the two bodies, as authored', () => {
  it('launch A drops the ball straight down w from w = 2.7 at speed 2; launch B is the same drop 0.8 to the side in x', () => {
    expect(PRESETS.map((p) => ({ id: p.id, ballStart: p.ballStart, ballVelocity: p.ballVelocity }))).toEqual([
      { id: 'central', ballStart: [0, 0, 0, 2.7], ballVelocity: [0, 0, 0, -2] },
      { id: 'off-centre', ballStart: [0.8, 0, 0, 2.7], ballVelocity: [0, 0, 0, -2] }
    ]);
    expect(preset('central').name).toBe('A. Central impact along w');
    expect(preset('off-centre').name).toBe('B. Off-centre impact');
    expect(preset('central').summary).toContain('Masses 1 and 2, restitution 1');
    expect(preset('off-centre').summary).toContain('0.8 to the side in x');
    expect(preset('off-centre').summary).toContain('x–w plane');
  });

  it('the box is 1.2 × 0.9 × 0.7 × 1.0 in half-extents, mass 2; the ball is radius 0.5, mass 1', () => {
    expect(BOX).toEqual({ id: 'box', name: 'Box', colour: '#4c7ff0', halfExtents: [1.2, 0.9, 0.7, 1.0], mass: 2 });
    expect(BALL).toEqual({ id: 'ball', name: 'Ball', colour: '#e0883a', radius: 0.5, mass: 1 });
  });

  it('the experience’s simulation is built from those bodies and that launch', () => {
    const x = createExperience('collision');
    const sim = x.worlds.contact.sim;
    expect(sim.ball.mass).toBe(1);
    expect(sim.box.mass).toBe(2);
    expect(sim.ballCollider.shape.radius).toBe(0.5);
    expect(Array.from(sim.boxCollider.shape.halfExtents)).toEqual([1.2, 0.9, 0.7, 1.0]);
    expect(Array.from(sim.ball.position.data)).toEqual([0, 0, 0, 2.7]);
    expect(Array.from(sim.ball.linearVelocity.data)).toEqual([0, 0, 0, -2]);
    expect(Array.from(sim.box.position.data)).toEqual([0, 0, 0, 0]);
    expect(Array.from(sim.box.linearVelocity.data)).toEqual([0, 0, 0, 0]);
    x.dispatch({ type: 'chapter', id: 'spin' });
    expect(Array.from(x.worlds.contact.sim.ball.position.data)).toEqual([0.8, 0, 0, 2.7]);
    x.dispose();
  });
});

describe('the turning scene and the slice’s reach, as authored', () => {
  it('the block is 2.2 × 1.3 × 0.8 × 1.6 in half-extents', () => {
    const block = SCENE.find((o) => o.id === 'block')!;
    expect(block.kind).toBe('hyperbox');
    expect(block.kind === 'hyperbox' ? block.halfExtents : null).toEqual([2.2, 1.3, 0.8, 1.6]);
  });

  it('the ball rests at (3.6, 1.05, 0, 0.92), radius 0.72, circling in the z–w plane about (3.6, 1.05, 0, 0)', () => {
    const ball = SCENE.find((o) => o.id === 'companion')!;
    expect(ball.kind).toBe('glome');
    if (ball.kind !== 'glome') return;
    expect(ball.centre).toEqual([3.6, 1.05, 0, 0.92]);
    expect(ball.radius).toBe(0.72);
    expect(ball.orbit.plane).toEqual([2, 3]);
    expect(ball.orbit.centre).toEqual([3.6, 1.05, 0, 0]);
  });

  it('the slice slides at most 1.6 and turns at most a quarter turn, and the experience clamps to exactly that', () => {
    expect(OFFSET_LIMIT).toBe(1.6);
    expect(TURN_LIMIT).toBe(Math.PI / 2);
    const x = createExperience('arrival');
    expect(x.view().cut.offsetLimit).toBe(1.6);
    expect(x.view().cut.turnLimit).toBe(90);
    x.dispatch({ type: 'cut-offset', value: 5 });
    expect(x.worlds.turn.slice.offset).toBe(1.6);
    x.dispatch({ type: 'cut-offset', value: -5 });
    expect(x.worlds.turn.slice.offset).toBe(-1.6);
    x.dispatch({ type: 'cut-turn', degrees: 200 });
    expect(x.view().cut.degrees).toBe(90);
    x.dispatch({ type: 'cut-turn', degrees: -200 });
    expect(x.view().cut.degrees).toBe(-90);
    x.dispose();
  });
});

describe('the experience’s clocks', () => {
  const companionOf = (x: ReturnType<typeof createExperience>) => x.worlds.turn.products.find((p) => p.id === 'companion')!;
  const near = (a: readonly number[], b: readonly number[], tol: number): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= tol);

  it('the orbit turns once in 12 s of ticks: a twelfth at 1 s, a quarter at 3 s, a half at 6 s, home at 12 s', () => {
    // The arm is 0.92 along w from the orbit centre, turned in the z–w plane;
    // the accepted path turns it from +w toward −z as the phase grows.
    const x = createExperience('arrival');
    x.dispatch({ type: 'play' });
    const at: Record<number, readonly number[]> = {};
    for (let k = 1; k <= 120; k++) {
      x.dispatch({ type: 'tick', seconds: 0.1 });
      if (k === 10 || k === 30 || k === 60 || k === 120) at[k] = companionOf(x).position4()!;
      if (k === 30) expect(x.view().clock.readout).toBe('orbit at 90°');
    }
    expect(near(at[10]!, [3.6, 1.05, -0.92 * Math.sin(Math.PI / 6), 0.92 * Math.cos(Math.PI / 6)], 1e-9), `${at[10]}`).toBe(true);
    expect(near(at[30]!, [3.6, 1.05, -0.92, 0], 1e-9), `${at[30]}`).toBe(true);
    expect(near(at[60]!, [3.6, 1.05, 0, -0.92], 1e-9), `${at[60]}`).toBe(true);
    expect(near(at[120]!, [3.6, 1.05, 0, 0.92], 1e-9), `${at[120]}`).toBe(true);
    x.dispose();
  });

  it('a tick longer than 0.1 s moves the orbit exactly as far as a tick of 0.1 s, and a negative tick not at all', () => {
    const long = createExperience('arrival');
    const short = createExperience('arrival');
    const back = createExperience('arrival');
    const still = createExperience('arrival');
    for (const x of [long, short, back]) x.dispatch({ type: 'play' });
    long.dispatch({ type: 'tick', seconds: 5 });
    short.dispatch({ type: 'tick', seconds: 0.1 });
    back.dispatch({ type: 'tick', seconds: -1 });
    expect(companionOf(long).position4()).toEqual(companionOf(short).position4());
    expect(companionOf(short).position4()).not.toEqual(companionOf(still).position4());
    expect(companionOf(back).position4()).toEqual(companionOf(still).position4());
    for (const x of [long, short, back, still]) x.dispose();
  });

  it('a paused orbit does not move under ticks', () => {
    const x = createExperience('arrival');
    const fresh = createExperience('arrival');
    for (let k = 0; k < 10; k++) x.dispatch({ type: 'tick', seconds: 0.1 });
    expect(companionOf(x).position4()).toEqual(companionOf(fresh).position4());
    x.dispose();
    fresh.dispose();
  });

  it('a 0.1 s tick is 12 physics steps by time, capped at 8; a 1/60 s tick is 2', () => {
    const a = createExperience('collision');
    a.dispatch({ type: 'play' });
    a.dispatch({ type: 'tick', seconds: 0.1 });
    expect(a.worlds.contact.sim.steps).toBe(8);
    const b = createExperience('collision');
    b.dispatch({ type: 'play' });
    b.dispatch({ type: 'tick', seconds: 1 / 60 });
    expect(b.worlds.contact.sim.steps).toBe(2);
    a.dispose();
    b.dispose();
  });

  it('a long frame is credited to the physics clock as 0.1 s, exactly as a 0.1 s frame, and leaves no backlog to burst through', () => {
    // 5 s is credited as 0.1 s: 8 steps now (the per-frame cap), and of the
    // 0.1 − 8/120 left over at most one step's worth is kept. A following
    // 1/60 s tick (two steps of its own) then takes at most three, not the six
    // a carried backlog would pay off in one burst.
    const long = createExperience('collision');
    const short = createExperience('collision');
    for (const x of [long, short]) x.dispatch({ type: 'play' });
    long.dispatch({ type: 'tick', seconds: 5 });
    short.dispatch({ type: 'tick', seconds: 0.1 });
    expect(long.worlds.contact.sim.steps).toBe(8);
    long.dispatch({ type: 'tick', seconds: 1 / 60 });
    short.dispatch({ type: 'tick', seconds: 1 / 60 });
    expect(long.worlds.contact.sim.steps - 8).toBeGreaterThanOrEqual(2);
    expect(long.worlds.contact.sim.steps - 8).toBeLessThanOrEqual(3);
    expect(snapshot(long.worlds.contact.sim)).toEqual(snapshot(short.worlds.contact.sim));
    long.dispose();
    short.dispose();
  });

  it('a run of slow frames slows the physics clock instead of piling up steps owed', () => {
    // Twenty frames of 0.1 s each credit 2 s, 240 steps of time; the clock takes 8 per frame.
    // Afterwards, ten frames of 1/120 s take one step each, plus at most the one kept step.
    const x = createExperience('collision');
    x.dispatch({ type: 'play' });
    for (let k = 0; k < 20; k++) x.dispatch({ type: 'tick', seconds: 0.1 });
    expect(x.worlds.contact.sim.steps).toBe(160);
    for (let k = 0; k < 10; k++) x.dispatch({ type: 'tick', seconds: 1 / 120 });
    expect(x.worlds.contact.sim.steps - 160).toBeGreaterThanOrEqual(9);
    expect(x.worlds.contact.sim.steps - 160).toBeLessThanOrEqual(11);
    x.dispose();
  });

  it('a paused physics clock does not step under ticks', () => {
    const x = createExperience('collision');
    for (let k = 0; k < 10; k++) x.dispatch({ type: 'tick', seconds: 0.1 });
    expect(x.worlds.contact.sim.steps).toBe(0);
    expect(x.view().clock.readout).toBe('0.000 s · step 0 · paused');
    x.dispose();
  });
});

describe('the experience never builds a simulation of its own', () => {
  const sameAsReplay = (x: ReturnType<typeof createExperience>, id: Preset['id'], steps: number, label: string): void => {
    const sim = x.worlds.contact.sim;
    expect(sim.steps, label).toBe(steps);
    expect(sim.settings, label).toEqual(AUTHORED_SETTINGS);
    expect(snapshot(sim), label).toEqual(snapshot(ContactSimulation.atStep(preset(id), steps)));
  };

  it('a chapter’s launch and a preset’s launch are fresh launches with the authored settings', () => {
    const x = createExperience('collision');
    sameAsReplay(x, 'central', 0, 'collision chapter');
    x.dispatch({ type: 'preset', id: 'off-centre' });
    sameAsReplay(x, 'off-centre', 0, 'preset B');
    x.dispatch({ type: 'chapter', id: 'spin' });
    sameAsReplay(x, 'off-centre', 0, 'spin chapter');
    x.dispatch({ type: 'preset', id: 'central' });
    sameAsReplay(x, 'central', 0, 'preset A');
    x.dispose();
  });

  it('replay returns to launch, whatever ran before', () => {
    const x = createExperience('spin');
    for (let k = 0; k < 90; k++) x.dispatch({ type: 'step' });
    x.dispatch({ type: 'replay' });
    sameAsReplay(x, 'off-centre', 0, 'replay');
    x.dispose();
  });

  it('the jumps land on independent replays one step before the blow and at it', () => {
    // The blow, from the authored numbers: the ball's near side starts at
    // w = 2.7 − 0.5 = 2.2, the box's +w face is at 1.0, the closing speed is 2,
    // so they touch after 0.6 s = 72 steps of 1/120 s; the solver first
    // responds in the next step, 73.
    for (const id of ['central', 'off-centre'] as const) {
      expect(impactStepOf(preset(id)), id).toBe(73);
      const x = createExperience(id === 'central' ? 'collision' : 'spin');
      x.dispatch({ type: 'jump-touch' });
      sameAsReplay(x, id, 72, `${id} jump-touch`);
      x.dispatch({ type: 'jump-after' });
      sameAsReplay(x, id, 73, `${id} jump-after`);
      x.dispose();
    }
  });

  it('steps, ticks and step-back all leave the simulation bitwise on an independent replay', () => {
    const x = createExperience('collision');
    for (let k = 0; k < 5; k++) x.dispatch({ type: 'step' });
    sameAsReplay(x, 'central', 5, 'five steps');
    x.dispatch({ type: 'play' });
    for (let k = 0; k < 10; k++) x.dispatch({ type: 'tick', seconds: 0.1 });
    sameAsReplay(x, 'central', 85, 'five steps then ten 0.1 s ticks');
    x.dispatch({ type: 'step-back' });
    sameAsReplay(x, 'central', 84, 'step-back');
    x.dispose();
  });
});
