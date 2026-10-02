import { describe, expect, it } from 'vitest';
import { CHAPTERS, createExperience } from '../../src/hidden-direction/experience.js';
import { ContactSimulation, PRESETS, impactStepOf, type Preset } from '../../src/spatial-4d-contact/simulation.js';

/**
 * Disappearance and hidden causes, as investigable events.
 *
 * Every event is checked against the model at the moment it is said, through
 * the path the page drives (`dispatch`, then `view`):
 *
 * - On the prescribed orbit, the ball "appears" on exactly the tick it is
 *   first drawn and "vanishes" on exactly the tick the library first calls it
 *   outside, and nothing is said on any other tick. The side a vanishing names
 *   is the sign of the ball's own gap, recomputed here from its centre's w and
 *   its authored radius 0.72.
 * - A view action that brings the ball in or out names the slice as the cause,
 *   never the orbit, and leaves the orbit where it was.
 * - The blow is described at the step it lands, with the ball where it was at
 *   that step — whether the clock got there by Step presses, by long ticks of
 *   eight steps, or by short ones. The independent oracle is a fresh replay of
 *   the preset to the impact step (`ContactSimulation.atStep`), whose ball
 *   centre gives the gap as n·c − r − offset.
 * - The jumps and Step back are replays from launch, bitwise.
 * - Entering any chapter clears the event.
 *
 * Not proved here: how the page shows the line, or for how long — that is
 * layout, and needs a browser.
 */

type Experience = ReturnType<typeof createExperience>;
const preset = (id: Preset['id']): Preset => PRESETS.find((p) => p.id === id)!;
const BALL_RADIUS = 0.5;
const ORBIT_RADIUS = 0.72;

const companion = (x: Experience) => x.view().bodies.find((b) => b.id === 'companion')!;
/** What the picture shows of the ball: drawn, touching, outside, or present but drawn as nothing. */
const shown = (x: Experience): string => {
  const b = companion(x);
  return b.status !== 'present' ? b.status : b.drawn > 0 ? 'drawn' : 'omitted';
};

/** The physics state, read from the simulation's own objects. */
const physics = (sim: ContactSimulation) => ({
  steps: sim.steps, time: sim.time, impacts: sim.impacts, ball: sim.state('ball'), box: sim.state('box'),
  ballPosition: Array.from(sim.ball.position.data), contact: sim.contact, lastImpact: sim.lastImpact
});

/** The strike line for a ball centre c, from the slice's normal and offset: the gap is n·c − r − offset when the ball is wholly ana. */
function expectedStrike(c: readonly number[], n: readonly number[], offset: number): string {
  const h = n.reduce((s, v, i) => s + v * c[i]!, 0);
  if (h - BALL_RADIUS > offset) return `The box was struck by something your slice cannot show: the ball, then ${(h - BALL_RADIUS - offset).toFixed(2)} ana of your slice.`;
  if (h + BALL_RADIUS < offset) return `The box was struck by something your slice cannot show: the ball, then ${(offset - h - BALL_RADIUS).toFixed(2)} kata of your slice.`;
  return 'The box was struck — by the ball, then in your slice.';
}

describe('the ball on its prescribed orbit appears and vanishes as events, at the tick they happen', () => {
  it('appears on the tick it is first drawn, vanishes on the tick it first leaves, on the side its own w gives, and nothing else is said', () => {
    const x = createExperience('arrival');
    expect(Array.from(x.worlds.turn.slice.normal.data)).toEqual([0, 0, 0, 1]);
    expect(x.worlds.turn.slice.offset).toBe(0);
    expect(x.view().event).toBeNull();
    const ball = x.worlds.turn.products.find((p) => p.id === 'companion')!;
    x.dispatch({ type: 'play' });
    let before = shown(x);
    let eventId = x.view().eventId;
    const said: { line: string; now: string; side: string | null }[] = [];
    // 760 ticks of 1/60 s is more than a full 12 s revolution.
    for (let k = 0; k < 760; k++) {
      x.dispatch({ type: 'tick', seconds: 1 / 60 });
      const v = x.view();
      const now = shown(x);
      if (now === before) {
        expect(v.eventId, `tick ${k}: nothing changed, nothing is said`).toBe(eventId);
        continue;
      }
      expect(v.eventId, `tick ${k}: ${before} → ${now} is said`).toBe(eventId + 1);
      if (now === 'drawn') {
        expect(v.event).toBe('Ball appeared — it moved along its prescribed orbit, and now your slice cuts it.');
        said.push({ line: v.event!, now, side: null });
      } else if (now === 'outside') {
        const w = ball.position4()![3]!;
        expect(Math.abs(w), 'independently outside').toBeGreaterThan(ORBIT_RADIUS);
        const gap = w > 0 ? w - ORBIT_RADIUS : w + ORBIT_RADIUS;
        const sideOfGap = gap > 0 ? 'ana' : 'kata';
        // The line stays up while the clock runs on, so it names no marker (the caption and the picture's tag do).
        expect(v.event).toBe(`Ball vanished from your slice — it moved along its prescribed orbit, out to the ${sideOfGap} side. It has not gone.`);
        said.push({ line: v.event!, now, side: sideOfGap });
      } else {
        said.push({ line: v.event ?? '', now, side: null });
      }
      before = now;
      eventId = v.eventId;
    }
    // Over one revolution: in on the descent, out through kata, in on the ascent, out through ana.
    const sequence = said.filter((s) => s.now === 'drawn' || s.now === 'outside').map((s) => s.side ?? 'appeared');
    expect(sequence.slice(0, 4)).toEqual(['appeared', 'kata', 'appeared', 'ana']);
    x.dispose();
  });
});

describe('a view action that moves the ball in or out names your slice, not the orbit', () => {
  it('sliding to the ball says your slice moved; sliding back says it left to the ana side; the orbit never moved', () => {
    const x = createExperience('arrival');
    const ball = x.worlds.turn.products.find((p) => p.id === 'companion')!;
    const start = ball.position4();
    // At phase 0 the ball spans w ∈ [0.92 − 0.72, 0.92 + 0.72] = [0.2, 1.64].
    x.dispatch({ type: 'cut-offset', value: 0.5 });
    expect(x.view().event).toBe('Ball appeared — your slice moved, and now your slice cuts it.');
    expect(ball.position4()).toEqual(start);
    x.dispatch({ type: 'cut-offset', value: 0 });
    expect(x.view().event).toBe('Ball vanished from your slice — your slice moved, out to the ana side. It has not gone.');
    expect(ball.position4()).toEqual(start);
    x.dispose();
  });

  it('with the ball half an orbit on, at w = −0.92, the slide in and out names kata', () => {
    const x = createExperience('arrival');
    x.dispatch({ type: 'orbit-phase', degrees: 180 });
    // Both before and after, the ball is outside: nothing to say.
    expect(x.view().event).toBeNull();
    x.dispatch({ type: 'cut-offset', value: -0.5 });
    expect(x.view().event).toBe('Ball appeared — your slice moved, and now your slice cuts it.');
    x.dispatch({ type: 'cut-offset', value: 0 });
    expect(x.view().event).toBe('Ball vanished from your slice — your slice moved, out to the kata side. It has not gone.');
    x.dispose();
  });
});

describe('the blow is said at the step it lands, with the ball where it was then', () => {
  const chapterOf = (id: Preset['id']) => (id === 'central' ? 'collision' : 'spin');

  for (const id of ['central', 'off-centre'] as const) {
    describe(`launch ${id}`, () => {
      const impact = impactStepOf(preset(id))!;
      const atImpact = ContactSimulation.atStep(preset(id), impact);
      const UNTILTED = [0, 0, 0, 1];
      const line = expectedStrike(Array.from(atImpact.ball.position.data), UNTILTED, 0);

      it('the oracle: the blow lands at step 73, and the line there differs from the line eight steps later', () => {
        // Independent of the controller: a fresh replay. The eight-step
        // contrast is what lets the tick tests below tell "at the blow" from
        // "at the end of the frame that contained it".
        expect(impact).toBe(73);
        const later = ContactSimulation.atStep(preset(id), impact + 7);
        expect(expectedStrike(Array.from(later.ball.position.data), UNTILTED, 0)).not.toBe(line);
        expect(line).toMatch(/then \d\.\d\d ana of your slice\.$/);
      });

      it('by Step presses: nothing at 72, the strike at 73 exactly', () => {
        const x = createExperience(chapterOf(id));
        for (let k = 1; k < impact; k++) {
          x.dispatch({ type: 'step' });
          expect(x.view().event, `step ${k}`).toBeNull();
        }
        expect(x.worlds.contact.sim.impacts).toBe(0);
        x.dispatch({ type: 'step' });
        expect(x.worlds.contact.sim.steps).toBe(impact);
        expect(x.view().event).toBe(line);
        x.dispose();
      });

      it('by 0.1 s ticks of eight steps: said in the frame that holds step 73, with the ball as it was at 73', () => {
        const x = createExperience(chapterOf(id));
        x.dispatch({ type: 'play' });
        while (x.worlds.contact.sim.steps + 8 < impact) {
          x.dispatch({ type: 'tick', seconds: 0.1 });
          expect(x.view().event).toBeNull();
        }
        const from = x.worlds.contact.sim.steps;
        x.dispatch({ type: 'tick', seconds: 0.1 });
        const to = x.worlds.contact.sim.steps;
        expect(from).toBeLessThan(impact);
        expect(to).toBeGreaterThan(impact);
        expect(x.view().event).toBe(line);
        x.dispose();
      });

      it('by 1/60 s ticks of two steps: the same line', () => {
        const x = createExperience(chapterOf(id));
        x.dispatch({ type: 'play' });
        let ticks = 0;
        while (x.worlds.contact.sim.impacts === 0 && ticks < 200) { x.dispatch({ type: 'tick', seconds: 1 / 60 }); ticks++; }
        expect(x.worlds.contact.sim.steps).toBe(impact + 1);
        expect(x.view().event).toBe(line);
        x.dispose();
      });
    });
  }

  it('with the slice turned 20°, the gap is measured across the turned slice', () => {
    const x = createExperience('collision');
    x.dispatch({ type: 'cut-turn', degrees: 20 });
    x.dispatch({ type: 'jump-touch' });
    x.dispatch({ type: 'step' });
    const n = Array.from(x.worlds.contact.slice.normal.data);
    // The turn is in the x–w plane: the normal has no y or z part, and w = cos 20°.
    expect(n[1]).toBe(0);
    expect(n[2]).toBe(0);
    expect(n[3]).toBeCloseTo(Math.cos((20 * Math.PI) / 180), 12);
    const c = Array.from(ContactSimulation.atStep(preset('central'), 73).ball.position.data);
    expect(x.view().event).toBe(expectedStrike(c, n, x.worlds.contact.slice.offset));
    expect(x.view().event).toContain('then 0.91 ana');
    x.dispose();
  });

  it('with the slice slid to w = 1.2, the ball was in it at the blow, and the line says so', () => {
    const x = createExperience('collision');
    x.dispatch({ type: 'cut-offset', value: 1.2 });
    x.dispatch({ type: 'jump-touch' });
    x.dispatch({ type: 'step' });
    const c = Array.from(ContactSimulation.atStep(preset('central'), 73).ball.position.data);
    expect(Math.abs(c[3]! - 1.2)).toBeLessThan(BALL_RADIUS);
    expect(x.view().event).toBe('The box was struck — by the ball, then in your slice.');
    x.dispose();
  });
});

describe('the jumps and Step back are replays from launch', () => {
  it('jump-touch lands one step before the blow, with no impact and nothing said; one Step then says the strike', () => {
    const x = createExperience('collision');
    x.dispatch({ type: 'jump-touch' });
    expect(x.worlds.contact.sim.steps).toBe(72);
    expect(x.worlds.contact.sim.impacts).toBe(0);
    expect(x.view().event).toBeNull();
    expect(physics(x.worlds.contact.sim)).toEqual(physics(ContactSimulation.atStep(preset('central'), 72)));
    x.dispatch({ type: 'step' });
    expect(x.worlds.contact.sim.steps).toBe(73);
    expect(x.worlds.contact.sim.impacts).toBe(1);
    expect(x.view().event).toBe(expectedStrike(Array.from(ContactSimulation.atStep(preset('central'), 73).ball.position.data), [0, 0, 0, 1], 0));
    x.dispose();
  });

  it('after k steps, Step back is bitwise the replay to k − 1, before and after the blow', () => {
    for (const k of [1, 10, 73, 80]) {
      const x = createExperience('spin');
      for (let s = 0; s < k; s++) x.dispatch({ type: 'step' });
      x.dispatch({ type: 'step-back' });
      expect(physics(x.worlds.contact.sim), `k = ${k}`).toEqual(physics(ContactSimulation.atStep(preset('off-centre'), k - 1)));
      x.dispose();
    }
  });

  it('Step back at launch stays at launch', () => {
    const x = createExperience('collision');
    x.dispatch({ type: 'step-back' });
    expect(physics(x.worlds.contact.sim)).toEqual(physics(ContactSimulation.atStep(preset('central'), 0)));
    x.dispose();
  });

  it('Step back stops a running clock', () => {
    const x = createExperience('collision');
    x.dispatch({ type: 'play' });
    x.dispatch({ type: 'tick', seconds: 0.1 });
    x.dispatch({ type: 'step-back' });
    const steps = x.worlds.contact.sim.steps;
    x.dispatch({ type: 'tick', seconds: 0.1 });
    expect(x.worlds.contact.sim.steps).toBe(steps);
    expect(x.view().clock.playing).toBe(false);
    x.dispose();
  });
});

describe('entering a chapter clears the event', () => {
  it('from a strike, every chapter starts with nothing said', () => {
    for (const c of CHAPTERS) {
      const x = createExperience('collision');
      x.dispatch({ type: 'jump-touch' });
      x.dispatch({ type: 'step' });
      expect(x.view().event, 'a strike was said').not.toBeNull();
      x.dispatch({ type: 'chapter', id: c.id });
      expect(x.view().event, c.id).toBeNull();
      expect(x.view().eventId, c.id).toBe(0);
      x.dispose();
    }
  });

  it('from an appearance, every chapter starts with nothing said', () => {
    for (const c of CHAPTERS) {
      const x = createExperience('arrival');
      x.dispatch({ type: 'cut-offset', value: 0.5 });
      expect(x.view().event, 'an appearance was said').not.toBeNull();
      x.dispatch({ type: 'chapter', id: c.id });
      expect(x.view().event, c.id).toBeNull();
      x.dispose();
    }
  });
});
