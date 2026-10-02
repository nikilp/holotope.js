import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VecN } from '@holotope/core';
import { BUTTONS, INSTRUMENTS, chapterAction, keyAction, nextFace, sliderKey } from '../../src/hidden-direction/bindings.js';
import { CHAPTERS, createExperience, kindOf, type Action, type ChapterId } from '../../src/hidden-direction/experience.js';
import { PRESETS, impactStepOf } from '../../src/spatial-4d-contact/simulation.js';
import viteConfig from '../../vite.config.js';

/**
 * The page binds exactly the binding table, and every binding does what its
 * kind says.
 *
 * Two kinds of evidence, kept apart:
 *
 * - BEHAVIOUR, through the controller. Every button's `act` and every
 *   instrument's `act` is run against a fresh `createExperience`, with the
 *   context derived from `view()` exactly as the page derives it, and the
 *   action is dispatched along the page's own path. What may change is read
 *   from the worlds' own objects, bitwise.
 * - SOURCE PINS, labelled as such. There is no DOM in this repository, so the
 *   markup census and the attach loop in `app.ts` can only be held as text:
 *   the ids in the two entry pages against the table, and the listener text in
 *   the comment-stripped source. They prove the text is present, not that it
 *   runs; the in-browser checks with genuine input cover execution.
 *
 * Not proved here: anything about pixels, pointer geometry on the map or the
 * gauge (`mapPoint`, `gaugeValueAt`), or the camera recovery's motion — those
 * need a browser.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (name: string): string => readFileSync(join(root, name), 'utf8');

const ENTRY_PAGES = ['spatial-4d-turn.html', 'spatial-4d-contact.html'] as const;

/** Source without comments; app.ts has one `//` only as a trailing comment, never inside a string. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
/** Whitespace-insensitive, so a call that spans a line break still counts. */
const flat = (source: string): string => source.replace(/\s+/g, '');
const appCode = flat(stripComments(read('src/hidden-direction/app.ts')));

/** Text of the block opened by the first `{` at or after `from`, up to its matching `}`. */
function blockAt(source: string, from: number): string {
  const open = source.indexOf('{', from);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error('unbalanced block');
}

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

type Experience = ReturnType<typeof createExperience>;
/** The page's own reading of the view model for a control's decision (app.ts `context`). */
const contextOf = (x: Experience) => {
  const v = x.view();
  return {
    playing: v.clock.playing, shadowOn: v.shadow.on, studyPlaying: v.study !== null && v.clock.playing,
    facesCut: v.facesCut, face: v.face?.ordinal ?? null
  };
};
const press = (x: Experience, id: string): Action | null => {
  const b = BUTTONS.find((c) => c.id === id);
  if (!b) throw new Error(`no binding ${id}`);
  const action = b.act(contextOf(x));
  if (action !== null) x.dispatch(action);
  return action;
};

/** The four scenes a control can be pressed in, each entered the way the page enters it. */
const SCENES: Readonly<Record<'turn' | 'contact' | 'study' | 'free', ChapterId>> = {
  turn: 'arrival', contact: 'collision', study: 'turning', free: 'free'
};

/* -------------------------------------------------------------------------- */

describe('the markup census: the entry pages hold exactly the bound controls (source pins; no DOM)', () => {
  const tableIds = [...new Set([...BUTTONS.map((b) => b.id), ...Object.values(INSTRUMENTS).map((i) => i.id)])].sort();

  it('the table names each control once, and the map is the one surface both map instruments share', () => {
    expect(new Set(BUTTONS.map((b) => b.id)).size).toBe(BUTTONS.length);
    expect(INSTRUMENTS.turn.id).toBe('hd-map');
    expect(INSTRUMENTS.slide.id).toBe('hd-map');
    expect(new Set(Object.values(INSTRUMENTS).map((i) => i.id))).toEqual(new Set(['hd-map', 'hd-gauge', 'hd-study-angle']));
  });

  for (const page of ENTRY_PAGES) {
    const html = read(page);

    it(`${page}: the ids on <button> and role="slider" elements are exactly the table's ids`, () => {
      const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
      const sliders = [...html.matchAll(/<[a-z][a-z0-9-]*\b[^>]*\brole="slider"[^>]*>/g)].map((m) => m[0]);
      const idOf = (tag: string): string | null => /\sid="([^"]+)"/.exec(tag)?.[1] ?? null;
      // A control without an id could not be in the table, so it would be bound to nothing.
      expect(buttons.filter((t) => idOf(t) === null), 'buttons without an id').toEqual([]);
      expect(sliders.filter((t) => idOf(t) === null), 'sliders without an id').toEqual([]);
      const ids = [...buttons, ...sliders].map((t) => idOf(t)!);
      expect(new Set(ids).size, 'no control id twice').toBe(ids.length);
      expect([...ids].sort()).toEqual(tableIds);
    });

    it(`${page}: no other form control exists to escape the census`, () => {
      expect(html).not.toMatch(/<(?:input|select|textarea)\b/);
    });

    it(`${page}: chapter buttons are generated, never written in the markup, into #hd-chapters`, () => {
      expect(html).not.toMatch(/<button\b[^>]*\bclass="[^"]*\bhd-chapter\b/);
      expect(count(html, 'id="hd-chapters"')).toBe(1);
      // And the page generates them, one per chapter, each sending its chapter action.
      const generator = appCode.indexOf('el.chapters.replaceChildren(...CHAPTERS.map(');
      expect(generator).toBeGreaterThan(-1);
      const body = blockAt(appCode, generator);
      expect(body).toContain("button.className='hd-chapter';");
      expect(body).toContain("button.addEventListener('click',()=>send(chapterAction(c.id)));");
    });

    it(`${page}: every element app.ts looks up by id exists, once`, () => {
      const looked = [...appCode.matchAll(/\$(?:<[A-Za-z]+>)?\('([a-z0-9-]+)'\)/g)].map((m) => m[1]!);
      const queried = [...appCode.matchAll(/querySelector<[A-Za-z]+>\('#([a-z0-9-]+)'\)/g)].map((m) => m[1]!);
      const all = [...new Set([...looked, ...queried])];
      expect(all.length).toBeGreaterThan(30);
      for (const id of all) expect(count(html, `id="${id}"`), `#${id}`).toBe(1);
    });
  }
});

describe('app.ts attaches by iterating the table, and dispatches nowhere else (source pins; no DOM)', () => {
  it('binds a click listener on $(b.id) for every entry of BUTTONS, and nothing but the camera skips the controller', () => {
    const loop = "for(constbofBUTTONS){$(b.id).addEventListener('click',";
    expect(count(appCode, loop)).toBe(1);
    const body = blockAt(appCode, appCode.indexOf(loop));
    expect(body).toContain("if(b.kind==='camera'){recentre();return;}");
    expect(body).toContain('send(b.act(context()));');
  });

  it('reads the control context from the painted view, as the tests here do', () => {
    expect(appCode).toContain(
      'constcontext=()=>({playing:view.clock.playing,shadowOn:view.shadow.on,studyPlaying:view.study!==null&&view.clock.playing,'
      + 'facesCut:view.facesCut,face:view.face?.ordinal??null});'
    );
  });

  for (const key of ['turn', 'slide', 'gauge', 'studyAngle'] as const) {
    it(`sends INSTRUMENTS.${key}.act`, () => {
      expect(count(appCode, `send(INSTRUMENTS.${key}.act(`)).toBeGreaterThanOrEqual(1);
    });
  }

  it('calls x.dispatch exactly twice: inside send(), and for the frame loop\'s tick', () => {
    expect(count(appCode, '.dispatch(')).toBe(2);
    const sendAt = appCode.indexOf('constsend=(action:Action|null):void=>{');
    expect(sendAt).toBeGreaterThan(-1);
    expect(count(blockAt(appCode, sendAt), 'x.dispatch(action);')).toBe(1);
    const frameAt = appCode.indexOf('constframe=(now:number):void=>{');
    expect(frameAt).toBeGreaterThan(-1);
    expect(count(blockAt(appCode, frameAt), "x.dispatch({type:'tick',seconds:dt});")).toBe(1);
  });

  it('the matcher refuses a loop that survives only in a comment', () => {
    const commented = "// for (const b of BUTTONS) { $(b.id).addEventListener('click', () => {}); }\n/* x.dispatch(a) */";
    expect(flat(stripComments(commented))).toBe('');
  });
});

/* -------------------------------------------------------------------------- */

/**
 * Everything a press might move, read from the worlds' own objects. Grouped by
 * what each kind of control may touch: the observer's slices, and the three
 * clocks' states (the orbit, the physics run, the separate study).
 */
function snapshot(x: Experience) {
  const turn = x.worlds.turn;
  const contact = x.worlds.contact;
  const companion = turn.products.find((p) => p.id === 'companion')!;
  const pose = contact.sim.boxPose();
  return {
    slices: {
      turn: [...Array.from(turn.slice.normal.data), turn.slice.offset],
      contact: [...Array.from(contact.slice.normal.data), contact.slice.offset]
    },
    orbit: Array.from(companion.position4()!),
    physics: {
      steps: contact.sim.steps,
      ball: Array.from(contact.sim.ball.position.data),
      box: [...Array.from(pose.position.data), ...Array.from(pose.applyToPoint(new VecN([1, 2, 3, 4])).data)]
    },
    study: { angle: contact.study.angle, mode: contact.study.mode }
  };
}

/** A scene with every state away from its reference, so an unwanted write cannot hide behind a zero. */
function busy(scene: keyof typeof SCENES): Experience {
  const x = createExperience(SCENES[scene]);
  if (scene === 'contact') {
    x.dispatch({ type: 'jump-after' });
    for (let k = 0; k < 5; k++) x.dispatch({ type: 'step' });
  }
  if (scene === 'study') {
    x.dispatch({ type: 'study-angle', degrees: 117 });
  } else {
    x.dispatch({ type: 'cut-turn', degrees: 23 });
    x.dispatch({ type: 'cut-offset', value: 0.3 });
  }
  x.dispatch({ type: 'orbit-phase', degrees: 47 });
  return x;
}

describe('every button executes through the controller, and touches only what its kind allows', () => {
  for (const b of BUTTONS) {
    for (const scene of Object.keys(SCENES) as (keyof typeof SCENES)[]) {
      it(`${b.id} (${b.kind}) in the ${scene} scene`, () => {
        const x = busy(scene);
        const before = snapshot(x);
        const action = b.act(contextOf(x));
        if (b.kind === 'camera') {
          // The camera is the page's: no action, so no model state can move.
          expect(action).toBeNull();
          x.dispose();
          return;
        }
        expect(action, 'only a camera control may return null').not.toBeNull();
        expect(kindOf(action!)).toBe(b.kind);
        expect(() => x.dispatch(action!)).not.toThrow();
        const after = snapshot(x);
        if (b.kind === 'view') {
          // The observer moves; no clock's state does.
          expect(after.orbit).toEqual(before.orbit);
          expect(after.physics).toEqual(before.physics);
          expect(after.study).toEqual(before.study);
        } else if (b.kind === 'time') {
          // A clock moves; the slices, and the separate study, do not.
          expect(after.slices).toEqual(before.slices);
          expect(after.study).toEqual(before.study);
        } else if (b.kind === 'study') {
          // The separate scene only: neither slice, nor the orbit, nor the collision.
          expect(after.slices).toEqual(before.slices);
          expect(after.orbit).toEqual(before.orbit);
          expect(after.physics).toEqual(before.physics);
        } else {
          // A world switch in free exploration: everything stays where it was left.
          expect(after).toEqual(before);
        }
        x.dispose();
      });
    }
  }
});

describe('each button does what it says, read back through view()', () => {
  it('hd-face-next follows each face the slice cuts in turn, then none — the keyboard path to what a click on the block does', () => {
    const x = createExperience('cuts');
    x.dispatch({ type: 'cut-turn', degrees: 30 });
    const cut = [...x.block.presentFaces].sort((a, b) => a - b);
    expect(cut.length).toBeGreaterThan(1);
    expect(x.view().facesCut).toEqual(cut);
    const followed: (number | null)[] = [];
    for (let k = 0; k <= cut.length; k++) {
      press(x, 'hd-face-next');
      const face = x.view().face;
      followed.push(face === null ? null : face.ordinal);
      if (face !== null) {
        // The same face a pick would name: the block's own face record, by ordinal.
        expect(face.name).toBe(x.block.faces[face.ordinal]!.name);
        expect(x.faceShadow.sourceEdges()).toHaveLength(12);
      }
    }
    expect(followed).toEqual([...cut, null]);
    expect(x.faceShadow.sourceEdges()).toHaveLength(0);
    x.dispose();
  });

  it('nextFace: the next cut face in ordinal order, then none; a face no longer cut restarts at the first', () => {
    expect(nextFace([], null)).toBeNull();
    expect(nextFace([], 3)).toBeNull();
    expect(nextFace([1, 4, 6], null)).toBe(1);
    expect(nextFace([1, 4, 6], 1)).toBe(4);
    expect(nextFace([1, 4, 6], 6)).toBeNull();
    expect(nextFace([1, 4, 6], 5)).toBe(1);
  });

  it('hd-play toggles the clock of the scene in front, using the context the page reads', () => {
    for (const [scene, kind] of [['turn', 'orbit'], ['contact', 'physics'], ['study', 'study']] as const) {
      const x = createExperience(SCENES[scene]);
      expect(x.view().clock.kind).toBe(kind);
      expect(x.view().clock.playing).toBe(false);
      expect(press(x, 'hd-play')).toEqual({ type: 'play' });
      expect(x.view().clock.playing, `${scene} playing`).toBe(true);
      expect(press(x, 'hd-play')).toEqual({ type: 'pause' });
      expect(x.view().clock.playing, `${scene} paused`).toBe(false);
      x.dispose();
    }
  });

  it('hd-shadow toggles the shadow, in every scene', () => {
    for (const scene of ['turn', 'contact', 'study'] as const) {
      const x = createExperience(SCENES[scene]);
      expect(x.view().shadow.on).toBe(false);
      press(x, 'hd-shadow');
      expect(x.view().shadow.on, scene).toBe(true);
      press(x, 'hd-shadow');
      expect(x.view().shadow.on, scene).toBe(false);
      x.dispose();
    }
  });

  it('hd-freeze stops the running clock and lifts the shadow', () => {
    const x = createExperience('arrival');
    press(x, 'hd-play');
    press(x, 'hd-freeze');
    expect(x.view().clock.playing).toBe(false);
    expect(x.view().shadow.on).toBe(true);
    x.dispose();
  });

  it('hd-reset-cut returns the slice in front to untilted, through the centre point', () => {
    const x = createExperience('arrival');
    x.dispatch({ type: 'cut-turn', degrees: 40 });
    x.dispatch({ type: 'cut-offset', value: 0.7 });
    press(x, 'hd-reset-cut');
    expect(x.view().cut.degrees).toBe(0);
    expect(x.view().cut.offset).toBe(0);
    expect(Array.from(x.worlds.turn.slice.normal.data)).toEqual([0, 0, 0, 1]);
    x.dispose();
  });

  it('hd-preset-a and hd-preset-b set the launch, at clock 0', () => {
    const x = createExperience('collision');
    press(x, 'hd-step');
    press(x, 'hd-preset-b');
    expect(x.view().preset?.id).toBe('off-centre');
    expect(x.worlds.contact.sim.steps).toBe(0);
    expect(Array.from(x.worlds.contact.sim.ball.position.data)).toEqual([0.8, 0, 0, 2.7]);
    press(x, 'hd-preset-a');
    expect(x.view().preset?.id).toBe('central');
    expect(Array.from(x.worlds.contact.sim.ball.position.data)).toEqual([0, 0, 0, 2.7]);
    x.dispose();
  });

  it('hd-step advances the physics clock by exactly one step; hd-step-back takes exactly one back', () => {
    const x = createExperience('collision');
    expect(x.worlds.contact.sim.steps).toBe(0);
    for (let k = 1; k <= 3; k++) {
      press(x, 'hd-step');
      expect(x.worlds.contact.sim.steps).toBe(k);
    }
    press(x, 'hd-step-back');
    expect(x.worlds.contact.sim.steps).toBe(2);
    // The step back is a replay from launch, so it lands where two forward steps from a fresh launch land.
    const fresh = createExperience('collision');
    press(fresh, 'hd-step');
    press(fresh, 'hd-step');
    expect(Array.from(x.worlds.contact.sim.ball.position.data)).toEqual(Array.from(fresh.worlds.contact.sim.ball.position.data));
    x.dispose();
    fresh.dispose();
  });

  it('hd-jump lands one step before the blow, for both launches', () => {
    for (const [chapter, preset] of [['collision', 'central'], ['spin', 'off-centre']] as const) {
      const x = createExperience(chapter);
      press(x, 'hd-jump');
      // The gap 2.7 − 1.0 − 0.5 = 1.2 closes at speed 2 in 0.6 s, 72 steps of 1/120 s, for both launches;
      // a fresh replay of the accepted simulation finds the first responding step at 73.
      expect(x.worlds.contact.sim.steps, chapter).toBe(72);
      expect(impactStepOf(PRESETS.find((p) => p.id === preset)!)).toBe(73);
      expect(x.worlds.contact.sim.impacts).toBe(0);
      press(x, 'hd-step');
      expect(x.worlds.contact.sim.impacts, `${chapter}: the next step is the blow`).toBe(1);
      x.dispose();
    }
  });

  it('hd-replay returns the physics clock to 0 at the same launch', () => {
    const x = createExperience('spin');
    for (let k = 0; k < 4; k++) press(x, 'hd-step');
    press(x, 'hd-replay');
    expect(x.worlds.contact.sim.steps).toBe(0);
    expect(x.view().preset?.id).toBe('off-centre');
    expect(Array.from(x.worlds.contact.sim.ball.position.data)).toEqual([0.8, 0, 0, 2.7]);
    x.dispose();
  });

  it('hd-study-xy and hd-study-xw set the study\'s plane; hd-study-play toggles the study clock', () => {
    const x = createExperience('turning');
    expect(x.view().study?.mode).toBe('fourth');
    press(x, 'hd-study-xy');
    expect(x.view().study?.mode).toBe('ordinary');
    press(x, 'hd-study-xw');
    expect(x.view().study?.mode).toBe('fourth');
    expect(press(x, 'hd-study-play')).toEqual({ type: 'study-play' });
    expect(x.view().clock.playing).toBe(true);
    expect(x.worlds.contact.study.playing).toBe(true);
    expect(press(x, 'hd-study-play')).toEqual({ type: 'study-pause' });
    expect(x.view().clock.playing).toBe(false);
    expect(x.worlds.contact.study.playing).toBe(false);
    x.dispose();
  });

  it('hd-world-contact and hd-world-turn switch the world in front, and close the study', () => {
    const x = createExperience('free');
    expect(x.view().world).toBe('turn');
    press(x, 'hd-world-contact');
    expect(x.view().world).toBe('contact');
    expect(x.view().studyOpen).toBe(false);
    press(x, 'hd-world-turn');
    expect(x.view().world).toBe('turn');
    const y = createExperience('turning');
    expect(y.view().studyOpen).toBe(true);
    press(y, 'hd-world-contact');
    expect(y.view().studyOpen).toBe(false);
    expect(y.view().world).toBe('contact');
    x.dispose();
    y.dispose();
  });
});

describe('the instruments: what a value on each one means', () => {
  it('each instrument\'s kind agrees with the controller\'s kind of its action', () => {
    expect(kindOf(INSTRUMENTS.turn.act(30))).toBe(INSTRUMENTS.turn.kind);
    expect(kindOf(INSTRUMENTS.slide.act(0.5))).toBe(INSTRUMENTS.slide.kind);
    expect(kindOf(INSTRUMENTS.gauge.act(0.5))).toBe(INSTRUMENTS.gauge.kind);
    expect(kindOf(INSTRUMENTS.studyAngle.act(100))).toBe(INSTRUMENTS.studyAngle.kind);
    expect([INSTRUMENTS.turn.kind, INSTRUMENTS.slide.kind, INSTRUMENTS.gauge.kind, INSTRUMENTS.studyAngle.kind])
      .toEqual(['view', 'view', 'view', 'study']);
  });

  it('the map\'s turn sets the slice\'s angle in degrees, and the slice\'s normal turns with it', () => {
    const x = createExperience('arrival');
    x.dispatch(INSTRUMENTS.turn.act(30));
    // Held in radians, read back in degrees: exact up to the round trip.
    expect(x.view().cut.degrees).toBeCloseTo(30, 12);
    const n = Array.from(x.worlds.turn.slice.normal.data);
    // n(θ) = (−sin θ, 0, 0, cos θ): the reference normal w, turned in the x–w plane.
    expect(n[0]).toBeCloseTo(-0.5, 14);
    expect(n[1]).toBe(0);
    expect(n[2]).toBe(0);
    expect(n[3]).toBeCloseTo(Math.sqrt(3) / 2, 14);
    // A value on the map is an angle, not a step: a second drag to 10° reads 10°, not 40°.
    x.dispatch(INSTRUMENTS.turn.act(10));
    expect(x.view().cut.degrees).toBeCloseTo(10, 12);
    x.dispose();
  });

  it('the map\'s slide and the gauge both set the offset along the slice\'s own normal', () => {
    const x = createExperience('arrival');
    x.dispatch(INSTRUMENTS.slide.act(0.5));
    expect(x.view().cut.offset).toBe(0.5);
    expect(x.worlds.turn.slice.offset).toBe(0.5);
    const y = createExperience('collision');
    y.dispatch(INSTRUMENTS.gauge.act(0.5));
    expect(y.view().cut.offset).toBe(0.5);
    expect(y.worlds.contact.slice.offset).toBe(0.5);
    // The other world's slice is its own, and stays where it was.
    expect(y.worlds.turn.slice.offset).toBe(0);
    // A value is a place, not a step: a second drag to 0.2 reads 0.2, not 0.7.
    x.dispatch(INSTRUMENTS.slide.act(0.2));
    expect(x.view().cut.offset).toBe(0.2);
    y.dispatch(INSTRUMENTS.gauge.act(0.2));
    expect(y.view().cut.offset).toBe(0.2);
    x.dispose();
    y.dispose();
  });

  it('values beyond the instruments\' reach clamp to ±90° and ±1.6', () => {
    const x = createExperience('arrival');
    x.dispatch(INSTRUMENTS.turn.act(120));
    expect(x.view().cut.degrees).toBe(90);
    x.dispatch(INSTRUMENTS.turn.act(-400));
    expect(x.view().cut.degrees).toBe(-90);
    x.dispatch(INSTRUMENTS.slide.act(5));
    expect(x.view().cut.offset).toBe(1.6);
    x.dispatch(INSTRUMENTS.gauge.act(-5));
    expect(x.view().cut.offset).toBe(-1.6);
    expect(x.view().cut.turnLimit).toBe(90);
    expect(x.view().cut.offsetLimit).toBe(1.6);
    x.dispose();
  });

  it('the study\'s angle sets the separate scene\'s prescribed turn, and nothing of the slice', () => {
    const x = createExperience('turning');
    const slice = [...Array.from(x.worlds.contact.slice.normal.data), x.worlds.contact.slice.offset];
    x.dispatch(INSTRUMENTS.studyAngle.act(100));
    expect(x.view().study?.degrees).toBeCloseTo(100, 12);
    expect(x.worlds.contact.study.angle).toBeCloseTo((100 * Math.PI) / 180, 15);
    expect([...Array.from(x.worlds.contact.slice.normal.data), x.worlds.contact.slice.offset]).toEqual(slice);
    x.dispose();
  });
});

describe('keys: a literal table', () => {
  const idle = { playing: false, shadowOn: false, studyPlaying: false, facesCut: [], face: null };
  const running = { playing: true, shadowOn: true, studyPlaying: false, facesCut: [], face: null };

  it('arrows turn (left/right) and slide (up/down) the slice; Shift makes the step ten times larger', () => {
    expect(keyAction('ArrowLeft', false, idle)).toEqual({ type: 'cut-turn-nudge', delta: -1 });
    expect(keyAction('ArrowRight', false, idle)).toEqual({ type: 'cut-turn-nudge', delta: 1 });
    expect(keyAction('ArrowUp', false, idle)).toEqual({ type: 'cut-nudge', delta: 0.02 });
    expect(keyAction('ArrowDown', false, idle)).toEqual({ type: 'cut-nudge', delta: -0.02 });
    expect(keyAction('ArrowLeft', true, idle)).toEqual({ type: 'cut-turn-nudge', delta: -10 });
    expect(keyAction('ArrowRight', true, idle)).toEqual({ type: 'cut-turn-nudge', delta: 10 });
    expect(keyAction('ArrowUp', true, idle)).toEqual({ type: 'cut-nudge', delta: 0.2 });
    expect(keyAction('ArrowDown', true, idle)).toEqual({ type: 'cut-nudge', delta: -0.2 });
  });

  it('space plays when paused and pauses when playing; Shift changes nothing else', () => {
    expect(keyAction(' ', false, idle)).toEqual({ type: 'play' });
    expect(keyAction(' ', false, running)).toEqual({ type: 'pause' });
    expect(keyAction(' ', true, idle)).toEqual({ type: 'play' });
  });

  it('the letter and punctuation keys, in both cases', () => {
    expect(keyAction('.', false, idle)).toEqual({ type: 'step' });
    expect(keyAction(',', false, idle)).toEqual({ type: 'step-back' });
    for (const k of ['s', 'S']) {
      expect(keyAction(k, false, idle)).toEqual({ type: 'shadow', on: true });
      expect(keyAction(k, false, running)).toEqual({ type: 'shadow', on: false });
    }
    for (const k of ['f', 'F']) expect(keyAction(k, false, idle)).toEqual({ type: 'freeze' });
    for (const k of ['r', 'R']) expect(keyAction(k, false, idle)).toEqual({ type: 'cut-reset' });
    for (const k of ['c', 'C']) expect(keyAction(k, false, idle)).toBe('camera');
  });

  it('anything else is not a binding', () => {
    for (const k of ['x', 'Enter', 'Escape', 'Tab', '1', 'Home', 'p', '']) expect(keyAction(k, false, idle), k).toBeNull();
  });

  it('every key action is of the kind its control says: arrows, s, f, r view; space, ., , time', () => {
    const kinds = (['ArrowLeft', 'ArrowUp', 's', 'f', 'r', ' ', '.', ','] as const)
      .map((k) => kindOf(keyAction(k, false, idle) as Action));
    expect(kinds).toEqual(['view', 'view', 'view', 'view', 'view', 'time', 'time', 'time']);
  });
});

describe('a fixed slice is fixed to every control, keys included', () => {
  /**
   * In the study the slice is fixed: the map says "Here your slice is fixed at
   * w = 0", refuses a drag or a key (`plane.movable` is false), and the dial
   * and offset readouts are held at 0. The global slice keys reach the
   * controller without that guard, so the same must hold there: a slice key
   * pressed in the study moves no slice — neither the study's own, nor the
   * collision's, which would otherwise be found turned on the way back to it.
   */
  it('in the study, where the slice is fixed, the slice keys move no slice', () => {
    // The visitor leaves the collision's slice turned and slid, then opens the study.
    const x = createExperience('collision');
    x.dispatch(INSTRUMENTS.turn.act(30));
    x.dispatch(INSTRUMENTS.gauge.act(0.4));
    x.dispatch(chapterAction('turning'));
    expect(x.view().studyOpen).toBe(true);
    expect(x.view().plane.movable).toBe(false);
    const slices = () => [
      ...Array.from(x.worlds.contact.slice.normal.data), x.worlds.contact.slice.offset,
      ...Array.from(x.worlds.contact.study.slice.normal.data), x.worlds.contact.study.slice.offset
    ];
    const before = slices();
    // Arrows that do not cancel, then the reset key: whichever of them moves a slice leaves it changed.
    for (const k of ['ArrowLeft', 'ArrowUp', 'r']) {
      for (const shift of [false, true]) {
        const a = keyAction(k, shift, contextOf(x));
        if (a !== null && typeof a !== 'string') x.dispatch(a);
      }
    }
    expect(slices()).toEqual(before);
    // Back in the collision's world, by free exploration's world switch, the slice is where the visitor left it.
    x.dispatch(chapterAction('free'));
    press(x, 'hd-world-contact');
    expect(x.view().studyOpen).toBe(false);
    expect(x.view().cut.degrees).toBeCloseTo(30, 12);
    expect(x.view().cut.offset).toBe(0.4);
    x.dispose();
  });
});

/* -------------------------------------------------------------------------- */

describe('the two entry pages are one template (source pins)', () => {
  const turn = read('spatial-4d-turn.html');
  const contact = read('spatial-4d-contact.html');

  /** The three known differences, replaced by placeholders. */
  const normalise = (html: string): string => html
    .replace(/<title>Holotope\.js — The Hidden Direction: [^<]*<\/title>/, '<title>TITLE</title>')
    .replace(/<body class="hz hd" data-start="[a-z]+">/, '<body class="hz hd" data-start="START">')
    .replaceAll(/\.\/spatial-4d-(?:turn|contact)-classic\.html/g, 'CLASSIC');

  it('differ only in the title, the arrival chapter and the classic link — byte for byte otherwise', () => {
    expect(normalise(turn)).toBe(normalise(contact));
    // The normalisation must have bitten, or the comparison above says nothing.
    expect(normalise(turn)).not.toBe(turn);
    expect(count(normalise(turn), 'CLASSIC')).toBe(2);
  });

  it('each page names its own arrival: title, data-start and classic link agree', () => {
    expect(turn).toContain('<title>Holotope.js — The Hidden Direction: something passes through</title>');
    expect(contact).toContain('<title>Holotope.js — The Hidden Direction: a collision you cannot see</title>');
    expect(turn).toContain('<body class="hz hd" data-start="arrival">');
    expect(contact).toContain('<body class="hz hd" data-start="collision">');
    expect(count(turn, './spatial-4d-turn-classic.html')).toBe(2);
    expect(count(contact, './spatial-4d-contact-classic.html')).toBe(2);
    expect(turn).not.toContain('spatial-4d-contact-classic.html');
    expect(contact).not.toContain('spatial-4d-turn-classic.html');
  });

  it('data-start values are chapter ids, and each starts the chapter it names', () => {
    const ids = CHAPTERS.map((c) => c.id) as string[];
    for (const [html, expected] of [[turn, 'arrival'], [contact, 'collision']] as const) {
      const start = /data-start="([^"]+)"/.exec(html)![1]!;
      expect(start).toBe(expected);
      expect(ids).toContain(start);
      const x = createExperience(start as ChapterId);
      expect(x.view().chapter.id).toBe(expected);
      x.dispose();
    }
  });

  it('both load the one app module, on the body that carries data-start', () => {
    for (const html of [turn, contact]) {
      const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
      expect(scripts.length).toBe(1);
      expect(flat(scripts[0]![1]!)).toBe(flat("import { createApp } from './src/hidden-direction/app.ts'; createApp(document.body);"));
    }
    expect(existsSync(join(root, 'src/hidden-direction/app.ts'))).toBe(true);
  });
});

describe('the classic routes survive beside the new pages', () => {
  const classics = [
    ['spatial-4d-turn-classic.html', './src/spatial-4d-turn/main.ts'],
    ['spatial-4d-contact-classic.html', './src/spatial-4d-contact/main.ts']
  ] as const;

  for (const [page, entry] of classics) {
    it(`${page} exists and still loads its accepted entry module ${entry}`, () => {
      expect(existsSync(join(root, page))).toBe(true);
      const html = read(page);
      const scripts = [...html.matchAll(/<script\b[^>]*\btype="module"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
      expect(scripts.length).toBe(1);
      const imported = [...scripts[0]!.matchAll(/import\s*\{[^}]*\}\s*from\s*'([^']+)'/g)].map((m) => m[1]!);
      expect(imported).toEqual([entry]);
      expect(existsSync(resolve(root, entry))).toBe(true);
      expect(html).not.toContain('hidden-direction');
    });
  }

  it('the build lists all four pages as inputs', () => {
    const input = viteConfig.build?.rollupOptions?.input as Record<string, string>;
    const pages = new Set(Object.values(input));
    for (const page of ['spatial-4d-turn.html', 'spatial-4d-contact.html', 'spatial-4d-turn-classic.html', 'spatial-4d-contact-classic.html']) {
      expect(pages.has(join(root, page)), page).toBe(true);
      expect(existsSync(join(root, page)), page).toBe(true);
    }
  });
});

describe('every chapter is reachable by hash', () => {
  it('the chapters are exactly these six, in this order', () => {
    expect(CHAPTERS.map((c) => c.id)).toEqual(['arrival', 'cuts', 'collision', 'spin', 'turning', 'free']);
  });

  it('each chapter id starts the experience in that chapter, in its stated world', () => {
    const worlds: Record<ChapterId, [string, boolean]> = {
      arrival: ['turn', false], cuts: ['turn', false], collision: ['contact', false],
      spin: ['contact', false], turning: ['contact', true], free: ['turn', false]
    };
    for (const c of CHAPTERS) {
      const x = createExperience(c.id);
      const v = x.view();
      expect(v.chapter.id).toBe(c.id);
      expect([v.world, v.studyOpen], c.id).toEqual(worlds[c.id]);
      x.dispose();
      // And a chapter action, as a hash change sends it, lands in the same chapter from anywhere.
      const y = createExperience('free');
      y.dispatch(chapterAction(c.id));
      expect(y.view().chapter.id).toBe(c.id);
      expect(kindOf(chapterAction(c.id))).toBe('chapter');
      y.dispose();
    }
  });

  it('app.ts reads location.hash and admits it only if it is a chapter id (source pin; no DOM)', () => {
    expect(appCode).toContain('constCHAPTER_IDS=CHAPTERS.map((c)=>c.id);');
    expect(appCode).toContain('constisChapter=(s:string):sisChapterId=>(CHAPTER_IDSasreadonlystring[]).includes(s);');
    expect(appCode).toContain("constfromHash=location.hash.replace('#','');");
    expect(appCode).toContain("conststart:ChapterId=isChapter(fromHash)?fromHash:isChapter(startAttr)?startAttr:'arrival';");
    expect(appCode).toContain('constx=createExperience(start);');
    const hashAt = appCode.indexOf("window.addEventListener('hashchange',");
    expect(hashAt).toBeGreaterThan(-1);
    const onHash = blockAt(appCode, hashAt);
    expect(onHash).toContain("constid=location.hash.replace('#','');");
    expect(onHash).toContain('if(isChapter(id)&&id!==view.chapter.id)send(chapterAction(id));');
    // Keys 1–6 name the six chapters in order.
    expect(appCode).toContain('if(/^[1-6]$/.test(e.key)){send(chapterAction(CHAPTER_IDS[Number(e.key)-1]!));return;}');
  });
});

describe('keys on a focused instrument, and the camera keys: literal tables', () => {
  it('the gauge slides the slice: ↑/→ raise, ↓/← lower, Shift ten times, Home to zero', () => {
    expect(sliderKey('gauge', 'ArrowUp', false)).toEqual({ type: 'cut-nudge', delta: 0.02 });
    expect(sliderKey('gauge', 'ArrowRight', true)).toEqual({ type: 'cut-nudge', delta: 0.2 });
    expect(sliderKey('gauge', 'ArrowDown', false)).toEqual({ type: 'cut-nudge', delta: -0.02 });
    expect(sliderKey('gauge', 'ArrowLeft', true)).toEqual({ type: 'cut-nudge', delta: -0.2 });
    expect(sliderKey('gauge', 'Home', false)).toEqual({ type: 'cut-offset', value: 0 });
    expect(sliderKey('gauge', 'x', false)).toBeNull();
  });

  it('the map turns the slice: ↑/→ raise, ↓/← lower, Shift ten times, Home to zero', () => {
    expect(sliderKey('map', 'ArrowRight', false)).toEqual({ type: 'cut-turn-nudge', delta: 1 });
    expect(sliderKey('map', 'ArrowUp', true)).toEqual({ type: 'cut-turn-nudge', delta: 10 });
    expect(sliderKey('map', 'ArrowLeft', false)).toEqual({ type: 'cut-turn-nudge', delta: -1 });
    expect(sliderKey('map', 'Home', false)).toEqual({ type: 'cut-turn', degrees: 0 });
    expect(sliderKey('map', 'End', false)).toBeNull();
  });

  it('the study dial turns the box from where it is, within 0°–360°', () => {
    expect(sliderKey('studyAngle', 'ArrowRight', false, 40)).toEqual({ type: 'study-angle', degrees: 41 });
    expect(sliderKey('studyAngle', 'ArrowDown', true, 40)).toEqual({ type: 'study-angle', degrees: 30 });
    expect(sliderKey('studyAngle', 'ArrowUp', true, 355)).toEqual({ type: 'study-angle', degrees: 360 });
    expect(sliderKey('studyAngle', 'ArrowLeft', true, 4)).toEqual({ type: 'study-angle', degrees: 0 });
    expect(sliderKey('studyAngle', 'Home', false, 200)).toEqual({ type: 'study-angle', degrees: 0 });
  });

  it('each slider key executes through the controller and is a view (gauge, map) or study (dial) action', () => {
    const turn = createExperience('cuts');
    turn.dispatch(sliderKey('gauge', 'ArrowUp', true)!);
    turn.dispatch(sliderKey('map', 'ArrowRight', true)!);
    expect(turn.view().cut.offset).toBeCloseTo(0.2, 12);
    expect(turn.view().cut.degrees).toBeCloseTo(10, 12);
    expect(kindOf(sliderKey('gauge', 'ArrowUp', false)!)).toBe('view');
    expect(kindOf(sliderKey('map', 'ArrowUp', false)!)).toBe('view');
    turn.dispose();
    const study = createExperience('turning');
    study.dispatch(sliderKey('studyAngle', 'ArrowRight', true, study.view().study!.degrees)!);
    expect(study.view().study!.degrees).toBeCloseTo(10, 12);
    expect(kindOf(sliderKey('studyAngle', 'ArrowUp', false, 0)!)).toBe('study');
    study.dispose();
  });

  it('Q, E, + and − move the camera only: they return camera keys, never actions', () => {
    const idle = { playing: false, shadowOn: false, studyPlaying: false, facesCut: [], face: null };
    expect(keyAction('q', false, idle)).toBe('orbit-left');
    expect(keyAction('E', false, idle)).toBe('orbit-right');
    expect(keyAction('+', false, idle)).toBe('zoom-in');
    expect(keyAction('=', false, idle)).toBe('zoom-in');
    expect(keyAction('-', false, idle)).toBe('zoom-out');
    expect(keyAction('c', false, idle)).toBe('camera');
  });
});

