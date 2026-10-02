import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { createExperience, type Action } from '../../src/hidden-direction/experience.js';
import { BUTTONS, INSTRUMENTS } from '../../src/hidden-direction/bindings.js';
import { homeCamera } from '../../src/hidden-direction/stage.js';

/**
 * Replays, launches and the hints that remember a blow.
 *
 * The model chosen for the strike hint (the review's C3): a blow is an
 * OBSERVATION, recorded whenever the blow is on screen — when the clock steps
 * through it, or a replay from launch lands on it — with the slice it was seen
 * with, and quoted with that slice. So it stays true after the slice moves,
 * and a replay to the blow records it afresh with the slice you have then.
 * Before the blow there is nothing to remember: a replay that lands earlier, a
 * fresh launch and a new preset all forget it.
 *
 * Whether the run has been struck, and whether the box is turning, are facts
 * of the current run, read from the simulation (C4). A replay or a launch is
 * narrated as one — never as motion — and the physics clock's own steps are
 * narrated as motion (C5).
 *
 * Every action here is the one the page sends: a button's `act` from the
 * binding table, an instrument's `act`, or a recovery's `action` from the
 * empty view.
 */

type Experience = ReturnType<typeof createExperience>;

const context = (x: Experience) => {
  const v = x.view();
  return { playing: v.clock.playing, shadowOn: v.shadow.on, studyPlaying: false, facesCut: v.facesCut, face: v.face?.ordinal ?? null };
};
/** Press a button, as the page does: its binding's action for the view as it stands. */
const press = (x: Experience, id: string): void => {
  const a = BUTTONS.find((b) => b.id === id)!.act(context(x));
  if (a) x.dispatch(a);
};
const ball = (x: Experience) => x.view().bodies.find((b) => b.id === 'ball')!;
const box = (x: Experience) => x.view().bodies.find((b) => b.id === 'box')!;
const steps = (x: Experience): number => x.worlds.contact.sim.steps;
/** Play on with 1/60 s frames until a condition holds, as the page's loop does. */
function playUntil(x: Experience, done: () => boolean, limit = 2000): void {
  if (!x.view().clock.playing) press(x, 'hd-play');
  for (let k = 0; k < limit && !done(); k++) x.dispatch({ type: 'tick', seconds: 1 / 60 });
  expect(done(), 'the condition was reached').toBe(true);
  if (x.view().clock.playing) press(x, 'hd-play');
}
/** The empty view's recovery with this label, as its button would send it. */
const recovery = (x: Experience, label: string): Action => {
  const r = x.view(homeCamera(1.6)).empty?.recoveries.find((q) => q.label === label);
  expect(r, `the empty view offers “${label}”`).toBeDefined();
  return r!.action!;
};

describe('the strike hint quotes the blow it saw, with the slice it saw it with', () => {
  it('the review’s C3: played through at 0, slid to +1.50, stranded, replayed to the blow — the hint says the ball was in the slice, as the view shows', () => {
    const x = createExperience('collision');
    playUntil(x, () => steps(x) > 73);
    press(x, 'hd-shadow');
    x.dispatch(INSTRUMENTS.gauge.act(1.5));
    playUntil(x, () => {
      const e = x.view(homeCamera(1.6)).empty;
      return e !== null && e.recoveries.length > 0 && e.recoveries.every((r) => r.action?.type === 'jump-after' || r.action?.type === 'replay');
    });
    expect(steps(x)).toBeGreaterThan(300);
    x.dispatch(recovery(x, 'Replay to just after the blow'));
    expect(steps(x)).toBe(73);
    const v = x.view();
    expect(ball(x).drawn, 'the ball is drawn in the slice at the replayed blow').toBeGreaterThan(0);
    expect(ball(x).gap).toBe(0);
    expect(v.hint).toBe('At the blow, step 73, your slice was untilted, at +1.50, and the ball was in it. '
      + 'Freeze an instant to compare the slice with the shadow.');
    expect(v.hint).not.toMatch(/beyond/);
    expect(v.event).toBe('Replayed from launch to step 73, the blow: the box was struck there — by the ball, then in your slice.');
    x.dispose();
  });

  it('the hint stays true when the slice moves afterwards: it names the slice it was seen with', () => {
    const x = createExperience('collision');
    x.dispatch(INSTRUMENTS.gauge.act(1.5));
    press(x, 'hd-shadow');
    playUntil(x, () => steps(x) >= 74);
    expect(x.view().hint).toContain('your slice was untilted, at +1.50, and the ball was in it');
    // Back to 0, paused after the blow: the ball is not in the slice now, and the hint still says which slice saw it.
    x.dispatch(INSTRUMENTS.gauge.act(0));
    expect(ball(x).status).toBe('outside');
    expect(x.view().hint).toContain('your slice was untilted, at +1.50, and the ball was in it');
    x.dispose();
  });

  it('the seen case, mirrored: seen at +1.20, replayed to the blow at 0 — recorded afresh, beyond the slice, by the gap the view shows', () => {
    const x = createExperience('collision');
    x.dispatch(INSTRUMENTS.gauge.act(1.2));
    playUntil(x, () => steps(x) >= 74);
    expect(x.view().hint).toContain('your slice was untilted, at +1.20, and the ball was in it');
    x.dispatch(INSTRUMENTS.gauge.act(0));
    press(x, 'hd-shadow');
    x.dispatch({ type: 'jump-after' });
    expect(steps(x)).toBe(73);
    const gap = ball(x).gap;
    expect(gap).toBeGreaterThan(1);
    expect(x.view().hint).toBe(`At the blow, step 73, your slice was untilted, at 0.00, and the ball was ${gap.toFixed(2)} ana of it — `
      + 'beyond it, along the direction it cannot show. Freeze an instant to compare the slice with the shadow.');
    x.dispose();
  });

  it('Step −1 that lands on the blow records it with the slice you have then', () => {
    const x = createExperience('collision');
    press(x, 'hd-shadow');
    x.dispatch({ type: 'jump-after' });
    press(x, 'hd-step');
    expect(steps(x)).toBe(74);
    expect(x.view().hint).toContain('your slice was untilted, at 0.00, and the ball was');
    x.dispatch(INSTRUMENTS.gauge.act(1.5));
    press(x, 'hd-step-back');
    expect(steps(x)).toBe(73);
    expect(x.view().hint).toContain('your slice was untilted, at +1.50, and the ball was in it');
    x.dispose();
  });

  it('a turned slice is quoted turned', () => {
    const x = createExperience('collision');
    press(x, 'hd-shadow');
    x.dispatch(INSTRUMENTS.turn.act(-13.9));
    x.dispatch({ type: 'jump-after' });
    expect(x.view().hint).toMatch(/^At the blow, step 73, your slice was turned −13\.9°, at 0\.00, and the ball was \d\.\d\d ana of it/);
    x.dispose();
  });

  it('before the blow there is nothing to remember: Just before the blow, Replay launch and a new launch each forget it', () => {
    for (const forget of ['hd-jump', 'hd-replay', 'hd-preset-b'] as const) {
      const x = createExperience('collision');
      x.dispatch(INSTRUMENTS.gauge.act(1.5));
      playUntil(x, () => steps(x) >= 80);
      expect(x.view().hint, forget).toMatch(/^At the blow/);
      press(x, forget);
      const v = x.view();
      expect(x.worlds.contact.sim.impacts, forget).toBe(0);
      expect(v.cut.offset, `${forget}: the slice is kept`).toBe(1.5);
      expect(v.hint, forget).toBe('Press play and watch the box.');
      // One step at a time to the blow: recorded with the slice kept, and said as the clock's own step.
      while (x.worlds.contact.sim.impacts === 0) press(x, 'hd-step');
      expect(x.view().hint, forget).toContain('your slice was untilted, at +1.50, and the ball was in it');
      expect(x.view().event, forget).toBe('The box was struck — by the ball, then in your slice.');
      x.dispose();
    }
  });
});

describe('chapter IV says the box is turning only while it is', () => {
  const angular = (x: Experience): readonly number[] => x.worlds.contact.sim.state('box').angularVelocity;

  it('after Replay launch the box is at rest, and the hint no longer says it turns', () => {
    const x = createExperience('spin');
    playUntil(x, () => steps(x) >= 90);
    press(x, 'hd-freeze');
    expect(angular(x).some((c) => Math.abs(c) > 1e-6), 'turning after the blow').toBe(true);
    expect(x.view().hint).toBe('Its slice changes width as it turns; the box itself is rigid. Chapter V turns the same box by hand.');
    press(x, 'hd-replay');
    expect(angular(x).every((c) => c === 0), 'at rest at launch').toBe(true);
    expect(x.view().hint).toBe('Press play. The blow lands off-centre.');
    expect(x.view().hint).not.toMatch(/turn/);
    x.dispose();
  });

  it('with launch A chosen in chapter IV, the struck box does not turn, and the hint says so instead of describing a spin', () => {
    const x = createExperience('spin');
    press(x, 'hd-preset-a');
    expect(x.view().hint).toBe('Press play and watch the box.');
    playUntil(x, () => steps(x) >= 90);
    expect(angular(x).every((c) => Math.abs(c) <= 1e-12), 'the central blow leaves it unturned').toBe(true);
    expect(x.view().hint).toBe('This launch’s blow is central, so the box does not turn. Launch B lands it off-centre.');
    press(x, 'hd-freeze');
    expect(x.view().hint).not.toMatch(/turning|as it turns/);
    x.dispose();
  });

  it('chapter III forgets the blow on Replay launch: the hint asks for play again, not for the cause', () => {
    const x = createExperience('collision');
    playUntil(x, () => steps(x) >= 90);
    press(x, 'hd-shadow');
    expect(x.view().hint).toMatch(/^At the blow/);
    press(x, 'hd-replay');
    expect(x.view().hint).toBe('Press play and watch the box.');
    x.dispose();
  });
});

describe('a replay is narrated as a replay; a step of the clock as motion', () => {
  it('the box carried out of the slice by physics is said to have moved; Replay launch brings it back, said as a replay', () => {
    const x = createExperience('collision');
    playUntil(x, () => box(x).status === 'outside');
    expect(x.view().event).toBe('Box vanished from your slice — it moved; the box now lies kata of your slice. It has not gone.');
    press(x, 'hd-replay');
    expect(x.view().event).toBe('Box appeared — the run was replayed from launch to step 0, and now your slice cuts it.');
    x.dispose();
  });

  it('Step −1 back across the box’s exit says the run was replayed to that step', () => {
    const x = createExperience('collision');
    playUntil(x, () => box(x).status === 'outside');
    // A frame holds two steps; step back until the box is in the slice again — one or two presses.
    for (let k = 0; k < 3 && box(x).status === 'outside'; k++) press(x, 'hd-step-back');
    expect(box(x).status).not.toBe('outside');
    expect(x.view().event).toBe(`Box appeared — the run was replayed from launch to step ${steps(x)}, and now your slice cuts it.`);
    press(x, 'hd-step');
    expect(x.view().event).toBe('Box vanished from your slice — it moved; the box now lies kata of your slice. It has not gone.');
    x.dispose();
  });

  it('a new launch is said as a fresh launch', () => {
    const x = createExperience('collision');
    playUntil(x, () => box(x).status === 'outside');
    press(x, 'hd-preset-b');
    expect(x.view().event).toBe('Box appeared — launch B was started afresh, at step 0, and now your slice cuts it.');
    x.dispose();
  });

  it('no replay path, from any of several states, narrates motion', () => {
    const paths: (readonly string[])[] = [['hd-replay'], ['hd-jump'], ['hd-step-back'], ['hd-preset-a'], ['hd-preset-b']];
    let said = 0;
    for (const offset of [0, 1.2, -1.1]) {
      for (const until of [80, 170, 320]) {
        for (const path of [...paths, ['jump-after']]) {
          const x = createExperience('collision');
          x.dispatch(INSTRUMENTS.gauge.act(offset));
          playUntil(x, () => steps(x) >= until);
          const before = x.view().eventId;
          for (const id of path) {
            if (id === 'jump-after') x.dispatch({ type: 'jump-after' });
            else press(x, id);
          }
          const v = x.view();
          if (v.eventId !== before) {
            said++;
            expect(v.event, `${offset}/${until}/${path}`).toMatch(/replayed from launch|started afresh/i);
            expect(v.event, `${offset}/${until}/${path}`).not.toMatch(/\bit moved\b|prescribed orbit|you moved/);
          }
          x.dispose();
        }
      }
    }
    expect(said, 'replays changed the picture often enough to be heard').toBeGreaterThan(10);
  });
});

describe('a body only the camera has lost is never said to have moved', () => {
  it('looking away empties the view as “outside the camera’s view”; no event is said, and the slice and the clocks stand still', () => {
    const x = createExperience('cuts');
    const away = new PerspectiveCamera(50, 1.6, 0.1, 200);
    away.position.set(0, 0, 40);
    away.lookAt(0, 0, 80);
    const before = x.view(homeCamera(1.6));
    const v = x.view(away);
    expect(v.eventId).toBe(before.eventId);
    expect(v.event).toBe(before.event);
    expect(v.empty!.reasons.find((r) => r.id === 'block')!.line).toBe('Block is in your slice, but outside the camera’s view.');
    expect(v.cut).toEqual(before.cut);
    expect(x.view(homeCamera(1.6)).empty).toBeNull();
    x.dispose();
  });
});
