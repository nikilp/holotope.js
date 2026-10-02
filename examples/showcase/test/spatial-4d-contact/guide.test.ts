import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GUIDE, KIND_LABEL, actionLabel } from '../../src/spatial-4d-contact/guide.js';
import { BALL, BOX, ContactSimulation, DEFAULT_SETTINGS, PRESETS, impactStepOf, type Preset } from '../../src/spatial-4d-contact/simulation.js';
import { stripComments } from './source-pins.js';

/**
 * The guided exploration: its jumps in time are deterministic replays of the
 * same simulation, its landmarks are found by stepping rather than predicted,
 * and every action says which of the three things it touches — the observer,
 * the clock, or the separate study — and touches only that. Source pins are
 * labelled as such; behaviour needs a browser and genuine input.
 */

const here = dirname(fileURLToPath(import.meta.url));
const guideScript = readFileSync(join(here, '..', '..', 'src', 'spatial-4d-contact', 'GUIDE.md'), 'utf8');
const html = readFileSync(join(here, '..', '..', 'spatial-4d-contact.html'), 'utf8');

const preset = (id: Preset['id']): Preset => PRESETS.find((p) => p.id === id)!;
const snapshot = (sim: ContactSimulation) => ({
  t: sim.time, steps: sim.steps, impacts: sim.impacts,
  box: sim.state('box'), ball: sim.state('ball'),
  P: sim.totalMomentum(), L: sim.totalAngularMomentum(), K: sim.kineticEnergy(),
  contact: sim.contact, lastImpact: sim.lastImpact
});

describe('deterministic replay', () => {
  it('atStep(n) is bitwise the same state as n steps of a fresh simulation, for both presets', () => {
    for (const p of PRESETS) {
      for (const n of [0, 1, 40, 72, 73, 74, 150]) {
        const stepped = new ContactSimulation(p);
        for (let k = 0; k < n; k++) stepped.step();
        expect(snapshot(ContactSimulation.atStep(p, n)), `${p.id} step ${n}`).toEqual(snapshot(stepped));
      }
    }
  });

  it('stepping back is a replay to steps − 1: the state at step 73 then "back" equals the state reached forward at 72', () => {
    const p = preset('central');
    const forward = ContactSimulation.atStep(p, 73);
    const back = ContactSimulation.atStep(p, forward.steps - 1);
    expect(snapshot(back)).toEqual(snapshot(ContactSimulation.atStep(p, 72)));
    expect(back.impacts).toBe(0);
    expect(forward.impacts).toBe(1);
  });

  it('rejects a step count that is not a non-negative integer', () => {
    expect(() => ContactSimulation.atStep(preset('central'), -1)).toThrow();
    expect(() => ContactSimulation.atStep(preset('central'), 2.5)).toThrow();
  });
});

describe('the impact landmark is found by stepping, not predicted', () => {
  it('both presets first respond at step 73 (t = 0.608 s); the ball touches the +w face exactly at step 72 (t = 0.6 s)', () => {
    // Independent arithmetic: the ball starts at w = 2.7 moving at −2; its
    // surface reaches the face at w = 1.0 when its centre is at 1.5, after
    // 1.2 / 2 = 0.6 s = 72 steps of 1/120. The 73rd step is the one that
    // begins in contact and applies the impulse.
    const touchTime = (preset('central').ballStart[3] - BALL.radius - BOX.halfExtents[3]) / 2;
    expect(touchTime).toBeCloseTo(0.6, 12);
    expect(Math.round(touchTime / DEFAULT_SETTINGS.dt)).toBe(72);
    for (const p of PRESETS) {
      expect(impactStepOf(p), p.id).toBe(73);
      const before = ContactSimulation.atStep(p, 72);
      expect(before.impacts).toBe(0);
      const q = before.query();
      expect(Math.abs(q.gap!), `${p.id}: the gap at the touch step`).toBeLessThanOrEqual(1e-9);
      expect(['touching', 'separated', 'overlapping']).toContain(q.state);
      const after = ContactSimulation.atStep(p, 73);
      expect(after.impacts).toBe(1);
      expect(after.lastImpact?.responded).toBe(true);
    }
  });

  it('returns null when nothing responds within the search window', () => {
    const miss: Preset = { id: 'central', name: 'miss', summary: '', ballStart: [2.7, 0, 0, 1.7], ballVelocity: [-2, 0, 0, 0] };
    expect(impactStepOf(miss, DEFAULT_SETTINGS, 400)).toBeNull();
  });
});

describe('the guide data', () => {
  it('has five stages in the commissioned order, each with one prediction or observation', () => {
    expect(GUIDE.map((s) => s.id)).toEqual(['familiar', 'hold', 'context', 'return', 'offcentre']);
    for (const stage of GUIDE) {
      expect(stage.ask.length, stage.id).toBeGreaterThan(20);
      expect(stage.actions.length, stage.id).toBeGreaterThan(0);
    }
  });

  it('labels every action with its kind, in words', () => {
    for (const stage of GUIDE) {
      for (const action of stage.actions) {
        expect(actionLabel(action)).toBe(`${action.label} (${KIND_LABEL[action.kind]})`);
      }
    }
    expect(KIND_LABEL.view).toBe('view only');
    expect(KIND_LABEL.time).toBe('changes simulation time');
    expect(KIND_LABEL.study).toContain('separate scene');
  });

  it('never turns the knife for the reader by animation: the knife actions are single settings, and A starts at 90°', () => {
    const knifeActions = GUIDE.flatMap((s) => s.actions).filter((a) => a.id.startsWith('knife-'));
    expect(knifeActions.map((a) => a.id)).toEqual(['knife-90', 'knife-0']);
    for (const a of knifeActions) expect(a.kind).toBe('view');
    expect(GUIDE[0]!.actions.map((a) => a.id)).toEqual(['preset-a', 'knife-90', 'play']);
  });

  it('no stage claims a 4D solid lies inside the 3D section — only the centres do', () => {
    // Geometric fact of the authored scene, not a style rule. At the 90° knife
    // the section is the hyperplane x = 0; preset A launches the ball at x = 0
    // and the box is centred at the origin, so both CENTRES lie in it — but the
    // box spans x ∈ [−1.2, 1.2] and the ball has radius 0.5, so neither SOLID
    // is contained in it. Copy that says the bodies lie in the section asserts
    // exactly the confusion the page exists to dispel: a 4D solid becoming 3D
    // (found in review).
    expect(preset('central').ballStart[0], 'the ball’s centre is in the x = 0 section').toBe(0);
    expect(BOX.halfExtents[0], 'the box extends out of that section').toBeGreaterThan(0);
    expect(BALL.radius, 'the ball extends out of that section').toBeGreaterThan(0);

    const stageA = GUIDE.find((s) => s.id === 'familiar')!;
    expect(stageA.text).toContain('Both bodies’ centres lie in this section');
    expect(stageA.text).toContain('the cut passes through the middle of each');
    expect(stageA.text).toContain('Their 4D bodies extend beyond it');
    expect(guideScript).toContain('Both bodies’ centres lie in this section');
    expect(guideScript).toContain('Their 4D bodies extend beyond it');

    // Every reader-facing surface: the stage data, the printed script, the page.
    const copy = [...GUIDE.map((s) => `${s.text} ${s.ask}`), guideScript, html].join('\n');
    for (const claim of [
      /bodies\s+(?:both\s+)?(?:sit|lie|are|fit)\s+in\s+(?:it|this|the)\b/i,
      /(?:box|ball|bodies|solids?)\s+(?:is|are)\s+(?:wholly\s+|entirely\s+)?(?:contained|inside)\s+(?:in\s+|within\s+)?(?:it|this|the)\s*(?:section|cut|hyperplane|slice)?\b/i,
      /(?:both\s+bodies|the\s+solids?)\s+(?:sit|live|lie)\s+(?:in|inside|within)\b/i
    ]) {
      expect(copy, `containment claim: ${claim}`).not.toMatch(claim);
    }
  });

  it('the stage texts state the measured figures: the touch at 0.6 s, the ball’s nearest approach, the reference viewing window', () => {
    // Measured by stepping: preset A's box leaves the
    // reference cut at step 163 (1.358 s), 0.750 s after the impact; preset B's
    // at step 230 (1.917 s), 1.308 s after it. The ball's centre never comes
    // nearer than 1.5 to w = 0.
    const returnStage = GUIDE.find((s) => s.id === 'return')!;
    expect(returnStage.text).toContain('centre never comes closer than 1.5 to the knife');
    expect(returnStage.ask).toContain('struck at 0.61 s');
    const last = GUIDE.find((s) => s.id === 'offcentre')!;
    expect(last.text).toContain('about 1.3 s after the impact');
    expect(last.text).not.toMatch(/oscillat/i);
    for (const stage of GUIDE) {
      expect(`${stage.text} ${stage.ask}`).not.toMatch(/impossible|lower-dimensional|cannot exist|proves?\b/i);
    }
  });
});

describe('source pins: the page binds every guide action, and each touches only what its kind says', () => {
  const code = stripComments(readFileSync(join(here, '..', '..', 'src', 'spatial-4d-contact', 'main.ts'), 'utf8')).replace(/\s+/g, '');
  const start = code.indexOf('constguideRun:Record<string,()=>void>={');
  const end = code.indexOf('};functionrenderGuide');
  const block = code.slice(start, end);
  const ids = [...new Set(GUIDE.flatMap((s) => s.actions.map((a) => a.id)))];
  const keyAt = (id: string): number => {
    const quoted = block.indexOf(`'${id}':`);
    if (quoted >= 0) return quoted;
    const bare = block.search(new RegExp(`[{,]${id}:`));
    return bare >= 0 ? bare + 1 : -1;
  };
  const entries = new Map<string, string>();
  const positions = ids.map((id) => ({ id, at: keyAt(id) })).sort((a, b) => a.at - b.at);
  positions.forEach(({ id, at }, k) => {
    const next = positions[k + 1]?.at ?? block.length;
    entries.set(id, block.slice(at, next));
  });

  it('every action id in the guide has a handler', () => {
    expect(start).toBeGreaterThan(0);
    for (const id of ids) expect(keyAt(id), id).toBeGreaterThanOrEqual(0);
  });

  const TIME = /reset\(|stepOnce|jumpTo|stepBack|jumpToFirstTouch|jumpToAfterImpact|atStep|setPlaying\(true\)/;
  const VIEW = /knife=|setTheta|setOffset|setContext|offset\.focus|resetCamera/;
  for (const stage of GUIDE) {
    for (const action of stage.actions) {
      it(`${stage.id}/${action.id} is a ${action.kind} action and touches only that`, () => {
        const entry = entries.get(action.id)!;
        if (action.kind === 'view') {
          expect(entry).toMatch(VIEW);
          expect(entry).not.toMatch(TIME);
          expect(entry).not.toMatch(/setStudy|study\./);
        } else if (action.kind === 'time') {
          expect(entry).toMatch(TIME);
          expect(entry).not.toMatch(VIEW);
          // A time action may bring the collision scene back into view; it never sets the study's angle or mode.
          expect(entry).not.toMatch(/setStudy\(true\)|study\./);
        } else {
          expect(entry).toContain('setStudy(true)');
          expect(entry).not.toMatch(TIME);
          expect(entry).not.toMatch(VIEW);
        }
      });
    }
  }
});
