import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripComments } from './source-pins.js';

/**
 * Source-level pins for the interaction page, labelled as such: there is no
 * DOM in this repository. They hold that every control has a listener, and
 * that the page never writes a body — motion comes from `sim.step()`, and
 * every jump in time is a fresh `ContactSimulation` replayed from launch. The
 * behaviour is checked in a browser, with genuine input.
 *
 * Three kinds of control, kept apart here as in the page:
 * - TIME — Play, Step ±1, Jump, Reset, presets: step, replay or relaunch.
 * - VIEW — the knife, the projection toggle, the camera: never touch `sim`.
 * - STUDY — a separate scene with its own object angle; never touches `sim`
 *   or the knife.
 */

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', '..', 'spatial-4d-contact.html'), 'utf8');
const main = readFileSync(join(here, '..', '..', 'src', 'spatial-4d-contact', 'main.ts'), 'utf8');

const flat = (source: string): string => source.replace(/\s+/g, '');
const code = flat(stripComments(main));

/** The body of an arrow assigned as `const NAME = (…) => { … };` — the text after the first `{` up to its matching `}`. */
export function arrowBody(source: string, name: string): string {
  const start = source.indexOf(`const${name}=`);
  if (start < 0) throw new Error(`no const ${name}`);
  const open = source.indexOf('{', source.indexOf('=>', start));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`unbalanced ${name}`);
}

/** The body of `function NAME(…): void { … }`. */
export function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function${name}(`);
  if (start < 0) throw new Error(`no function ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`unbalanced ${name}`);
}

/** The handler text of `BOUND.addEventListener('EVENT', …);` — everything after the event up to the closing `);`. */
export function handlerOf(source: string, bound: string, event: string): string {
  const needle = `${bound}.addEventListener('${event}',`;
  const start = source.indexOf(needle);
  if (start < 0) throw new Error(`no ${event} listener on ${bound}`);
  const from = start + needle.length;
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(' || ch === '{') depth++;
    else if (ch === ')' || ch === '}') {
      if (depth === 0) return source.slice(from, i);
      depth--;
    }
  }
  throw new Error(`unterminated listener on ${bound}`);
}

/** Anything that would change simulation time or the bodies. */
const TIME_WRITE = /sim=|sim\.step|stepOnce|jumpTo|stepBack|jumpToFirstTouch|jumpToAfterImpact|atStep|(?<![A-Za-z.])reset\(|setPlaying\(true\)/;
/** Anything that would move the observer. */
const VIEW_WRITE = /knife=|setTheta|setOffset|setContext|resetCamera|applyTo/;

type Kind = 'time' | 'view' | 'study';
const CONTROLS: Record<string, { bound: string; event: string; kind: Kind }> = {
  'preset-central': { bound: 'presetCentral', event: 'change', kind: 'time' },
  'preset-off-centre': { bound: 'presetOffCentre', event: 'change', kind: 'time' },
  play: { bound: 'playButton', event: 'click', kind: 'time' },
  'step-back': { bound: 'stepBackButton', event: 'click', kind: 'time' },
  step: { bound: 'stepButton', event: 'click', kind: 'time' },
  'jump-touch': { bound: 'jumpButton', event: 'click', kind: 'time' },
  reset: { bound: 'resetButton', event: 'click', kind: 'time' },
  turn: { bound: 'turn', event: 'input', kind: 'view' },
  offset: { bound: 'offset', event: 'input', kind: 'view' },
  context: { bound: 'contextToggle', event: 'change', kind: 'view' },
  'reset-view': { bound: "panel.querySelector<HTMLButtonElement>('#reset-view')!", event: 'click', kind: 'view' },
  'guide-prev': { bound: 'guidePrev', event: 'click', kind: 'view' },
  'guide-next': { bound: 'guideNext', event: 'click', kind: 'view' },
  study: { bound: 'studyToggle', event: 'change', kind: 'study' },
  'study-ordinary': { bound: 'studyOrdinary', event: 'change', kind: 'study' },
  'study-fourth': { bound: 'studyFourth', event: 'change', kind: 'study' },
  'study-angle': { bound: 'studyAngle', event: 'input', kind: 'study' },
  'study-play': { bound: 'studyPlay', event: 'click', kind: 'study' },
  'study-rate-slow': { bound: 'studyRateSlow', event: 'change', kind: 'study' },
  'study-rate-normal': { bound: 'studyRateNormal', event: 'change', kind: 'study' },
  'study-reset': { bound: 'studyReset', event: 'click', kind: 'study' }
};

describe('every control in the markup has a listener in the wiring', () => {
  it('lists every interactive control the page has', () => {
    const ids = [...html.matchAll(/<(?:input|button)[^>]*\bid="([^"]+)"/g)].map((m) => m[1]!);
    expect(ids.sort()).toEqual(Object.keys(CONTROLS).sort());
  });

  for (const [id, { bound, event }] of Object.entries(CONTROLS)) {
    it(`#${id} is bound and listens for ${event}`, () => {
      expect(code, `#${id} is selected`).toContain(flat(`'#${id}'`));
      const needle = flat(`${bound}.addEventListener('${event}'`);
      expect(code.includes(needle), `#${id} has a ${event} listener on ${bound}`).toBe(true);
    });
  }

  it('the markup labels the knife and the context as view-only and the study as a prescribed turn', () => {
    expect(html).toContain('Knife — section orientation (view only)');
    expect(html).toContain('Show projection context (view only)');
    expect(html).toContain('prescribed turn — not a physics simulation');
    expect(html).toContain('Reset view (camera only)');
    expect(html).toMatch(/Step −1[^<]*<\/button>/);
    expect(html).toContain('title="Replays from launch to the previous step"');
    expect(html).toContain('title="Replays from launch to the step before the impulse"');
  });
});

describe('the page never writes a body: motion is integration and contact only', () => {
  it('no velocity, momentum, position or impulse write appears in main.ts', () => {
    expect(code).not.toMatch(/linearVelocity\.(data\[|set|add|multiplyScalar)/);
    expect(code).not.toMatch(/angularMomentumWorld/);
    expect(code).not.toMatch(/setAngularVelocityWorld|applyImpulseAtWorldPoint|applyForce|applyTorque/);
    expect(code).not.toMatch(/\.position\.data\[[^\]]*\]=/);
    expect(code).not.toMatch(/rotation=/);
    expect(code, 'the knife is driven through the turn demo’s applyTo only; no slice is reoriented here').not.toMatch(/setNormal\(/);
  });

  it('the only way bodies advance is the simulation’s own step', () => {
    expect(code.match(/sim\.step\(\)/g)?.length, 'stepOnce and the play loop').toBe(2);
    expect(code).not.toMatch(/integratePoses|integrateVelocities|world\.step|pipeline\.solve/);
  });

  it('every change of simulation time is a fresh simulation: a launch, or a replay from launch', () => {
    // Three assignments and no other: the initial launch, reset(), and jumpTo()'s replay.
    const launches = code.match(/sim=newContactSimulation\(presetOf\((?:presetId|id)\)\);/g) ?? [];
    const replays = code.match(/sim=ContactSimulation\.atStep\(presetOf\(presetId\),steps\);/g) ?? [];
    expect(launches.length, 'initial and reset').toBe(2);
    expect(replays.length, 'jumpTo').toBe(1);
    const rest = code.replace(/sim=newContactSimulation\(/g, '').replace(/sim=ContactSimulation\.atStep\(/g, '');
    expect(rest).not.toMatch(/(?<![A-Za-z_$.])sim=/);
    // Step −1 and the jumps go through jumpTo; nothing rewinds a body.
    expect(functionBody(code, 'stepBack')).toContain('jumpTo(sim.steps-1,');
    expect(functionBody(code, 'jumpToFirstTouch')).toContain('jumpTo(n-1,');
    expect(functionBody(code, 'jumpToAfterImpact')).toContain('jumpTo(n,');
    expect(functionBody(code, 'jumpTo')).not.toMatch(VIEW_WRITE);
  });

  it('the knife and the context move the picture only', () => {
    expect(code).toContain("turn.addEventListener('input',()=>{knife=setTheta(knife,rad(Number(turn.value)));refresh();});");
    expect(code).toContain("offset.addEventListener('input',()=>{knife=setOffset(knife,Number(offset.value));refresh();});");
    expect(code).toContain("contextToggle.addEventListener('change',()=>{setContext(contextToggle.checked);});");
    expect(arrowBody(code, 'setContext')).not.toMatch(TIME_WRITE);
    expect(arrowBody(code, 'setContext')).not.toMatch(/study\.set|study\.reset|study\.advance/);
  });

  for (const [id, { bound, event, kind }] of Object.entries(CONTROLS)) {
    if (kind !== 'view') continue;
    it(`#${id} (view) never changes simulation time or the study’s angle`, () => {
      const handler = handlerOf(code, bound, event);
      expect(handler).not.toMatch(TIME_WRITE);
      expect(handler).not.toMatch(/study\.set|study\.reset|study\.advance/);
    });
  }

  it('reset builds a fresh simulation of the chosen preset and leaves the knife alone', () => {
    expect(code).toContain('sim=newContactSimulation(presetOf(id));');
    expect(functionBody(code, 'reset')).not.toMatch(VIEW_WRITE);
  });
});

describe('the rotation study is a separate scene', () => {
  for (const [id, { bound, event, kind }] of Object.entries(CONTROLS)) {
    if (kind !== 'study') continue;
    it(`#${id} (study) touches neither the simulation nor the knife`, () => {
      const handler = handlerOf(code, bound, event);
      expect(handler).not.toMatch(TIME_WRITE);
      expect(handler).not.toMatch(VIEW_WRITE);
      expect(handler).not.toMatch(/sim\./);
    });
  }

  it('opening or closing the study pauses the clocks but changes no state of either scene', () => {
    const body = arrowBody(code, 'setStudy');
    expect(body).not.toMatch(TIME_WRITE);
    expect(body).not.toMatch(/knife=|setTheta|setOffset|resetCamera|applyTo/);
    expect(body).not.toMatch(/study\.setAngle|study\.setMode|study\.reset|study\.advance/);
    expect(body, 'the knife sliders are disabled while the study is open').toContain('turn.disabled=open;offset.disabled=open;');
    expect(body).toContain('Sectionfixedatw=0whilethestudyisopen');
    expect(body, 'the collision scene is hidden, the study shown').toContain('collisionRoot.visible=!open;study.views.object.visible=open;');
  });

  it('the study advances in the play loop from the wall clock, never the simulation while it is open', () => {
    const loop = arrowBody(code, 'loop');
    const studyBranch = loop.slice(loop.indexOf("if(scene==='study')"), loop.indexOf('}elseif(playing)'));
    expect(studyBranch).toContain('study.advance(elapsed);');
    expect(studyBranch).not.toMatch(/sim\.step/);
  });

  it('the study’s slice is never reoriented and the camera is untouched by the study controls', () => {
    expect(code).not.toMatch(/study\.slice\.setNormal|study\.slice\.offset=/);
    for (const { bound, event, kind } of Object.values(CONTROLS)) {
      if (kind !== 'study') continue;
      expect(handlerOf(code, bound, event)).not.toMatch(/camera|resetCamera|viewport\./);
    }
  });
});
