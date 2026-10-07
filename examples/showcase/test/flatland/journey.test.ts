import { describe, expect, it } from 'vitest';
import { RUNGS } from '../../src/flatland/world.js';
import {
  ANA_KATA, ANA_KATA_GUIDED, CHAPTERS, FIRST_CUT_CLAUSES, OLD_HASHES, SLIDE_STEP, chapterById, chapterFromHash,
  createExperience, isRoute, nextLayer, tipStep, type Action, type ChapterId, type Experience, type View
} from '../../src/flatland/journey.js';
import { keyAction } from '../../src/flatland/bindings.js';
import { dimensionsSentence } from '../../src/flatland/copy.js';
import { crossings } from './analytic.js';

/**
 * The journey's state integrity: every transition between chapters, from any
 * state, lands on the stated state its setup sentence describes; a cold deep
 * link lands on the same; the page's earlier hashes still land on the lesson
 * they carried; the questions are answered only by the states they ask about.
 */

const guided = CHAPTERS.filter((c) => c.start !== null);

/** Disturb everything a visitor can disturb in the chapter they are in. */
function disturb(x: Experience): void {
  const steps: Action[] = [
    { type: 'slide-to', offset: 0.7 }, { type: 'tip-to', angle: 0.4 }, { type: 'shadow', on: !x.view().shadowOn },
    { type: 'show-object', on: false }, { type: 'predict', choice: 'square' }, { type: 'inspect', target: { kind: 'cut-corner', index: 0 } },
    { type: 'look' }, { type: 'play' }, { type: 'tick', dt: 0.1 }
  ];
  for (const s of steps) x.dispatch(s);
}

/** The parts of a view a chapter's stated state fixes. */
const stated = (v: View) => ({
  chapter: v.chapter.id, rung: v.rung, tip: v.tip, offset: v.offset, shadowOn: v.shadowOn, objectShown: v.objectShown,
  choice: v.prediction?.choice ?? null, revealed: v.prediction?.revealed ?? false, inspection: v.inspection, event: v.event,
  passing: v.passing, turning: v.turning, setup: v.setup, hint: v.hint, meeting: v.meeting, shape: v.cut.shape
});

describe('entering a guided chapter establishes its stated state, from anywhere', () => {
  for (const from of CHAPTERS) {
    for (const to of guided) {
      it(`${from.numeral} → ${to.numeral}`, () => {
        const x = createExperience(from.id, { instantTurns: true });
        disturb(x);
        x.dispatch({ type: 'chapter', id: to.id });
        const v = x.view();
        expect(v.chapter.id).toBe(to.id);
        expect(v.rung).toBe(to.rung);
        expect(v.tip).toBe(RUNGS[to.rung!].stops[to.start!.pose]);
        expect(v.pose).toBe(to.start!.pose);
        expect(v.offset).toBe(to.start!.offset);
        expect(v.shadowOn).toBe(to.start!.shadow);
        expect(v.objectShown).toBe(true);
        expect(v.prediction?.choice ?? null).toBeNull();
        expect(v.prediction?.revealed ?? false).toBe(false);
        expect(v.inspection).toBeNull();
        expect(v.event).toBeNull();
        expect(v.passing).toBe(false);
        expect(v.turning).toBe(false);
        // A cold deep link to the same chapter lands on the same view.
        expect(stated(v)).toEqual(stated(createExperience(to.id, { instantTurns: true }).view()));
      });
    }
  }

  it('keeps everything as it was left on entering free exploration', () => {
    for (const from of guided) {
      const x = createExperience(from.id, { instantTurns: true });
      x.dispatch({ type: 'slide-to', offset: 0.5 });
      x.dispatch({ type: 'tip-to', angle: 0.3 });
      const before = x.view();
      x.dispatch({ type: 'chapter', id: 'free' });
      const v = x.view();
      expect([v.rung, v.tip, v.offset, v.shadowOn]).toEqual([before.rung, before.tip, before.offset, before.shadowOn]);
    }
  });

  it('resets a chapter to its stated state', () => {
    for (const c of guided) {
      const x = createExperience(c.id, { instantTurns: true });
      const fresh = stated(x.view());
      disturb(x);
      x.dispatch({ type: 'reset' });
      expect(stated(x.view())).toEqual(fresh);
    }
  });
});

describe('each setup sentence is true of the state it sets up', () => {
  const at = (id: ChapterId): View => createExperience(id).view();

  it('I: a face toward the plane, the plane below, nothing cut', () => {
    const v = at('through');
    expect(v.pose).toBe('facet');
    expect(v.meeting).toMatchObject({ kind: 'apart', side: 'below' });
    expect(v.cut.empty).toBe(true);
    expect(v.setup).toContain('nothing is cut yet');
  });

  it('II: on its corner (− − −), the plane below it', () => {
    const v = at('corner');
    expect(v.meeting).toMatchObject({ kind: 'apart', side: 'below' });
    const lowest = v.corners.reduce((p, q) => (q.posed[2]! < p.posed[2]! ? q : p));
    expect(lowest.name).toBe('(− − −)');
    expect(v.setup).toContain('(− − −)');
  });

  it('III: on a corner, the plane through its middle, the light on', () => {
    const v = at('shadow');
    expect([v.pose, v.offset, v.shadowOn, v.meeting.kind]).toEqual(['corner', 0, true, 'crossing']);
    expect((v.extent[0] + v.extent[1]) / 2).toBeCloseTo(0, 12);
  });

  it('IV: the tesseract ana of your space, cell first, and beyond reach of a turn', () => {
    const v = at('up');
    expect(v.pose).toBe('facet');
    // The slice below the object along the missing axis: the object lies on its plus side, ana.
    expect(v.meeting).toMatchObject({ kind: 'apart', side: 'below' });
    expect(v.setup).toContain('lies ana of it, cell first');
    // Beyond the tesseract's farthest corner in every pose: a turn alone cuts nothing here.
    expect(Math.abs(v.offset)).toBeGreaterThan(Math.sqrt(4));
  });

  it('V: cell first, your space through its middle, the light on', () => {
    const v = at('up-shadow');
    expect([v.pose, v.offset, v.shadowOn, v.meeting.kind]).toEqual(['facet', 0, true, 'crossing']);
  });
});

describe('routes: every chapter has a hash, and the page’s earlier hashes still land', () => {
  it('reads every chapter’s own hash', () => {
    for (const c of CHAPTERS) {
      expect(chapterFromHash(`#${c.id}`)).toBe(c.id);
      expect(isRoute(`#${c.id}`)).toBe(true);
    }
  });

  it('sends the earlier hashes to the chapters that carry their lessons now', () => {
    expect(chapterFromHash('#section')).toBe('corner');
    expect(chapterFromHash('#projection')).toBe('shadow');
    expect(chapterFromHash('#tesseract')).toBe('up');
    for (const old of Object.keys(OLD_HASHES)) expect(isRoute(`#${old}`)).toBe(true);
  });

  it('treats any other hash as an anchor, and starts at the beginning', () => {
    // The earlier page's own bogus cases, '#Section' and '#tesseract2', among them.
    for (const hash of ['', '#', '#om-card', '#nope', '#Section', '#tesseract2', '#constructor', '#__proto__', '#toString', '#hasOwnProperty']) {
      expect(isRoute(hash)).toBe(false);
      expect(chapterFromHash(hash)).toBe('through');
    }
  });

  it('builds a working experience from every route', () => {
    for (const hash of [...CHAPTERS.map((c) => `#${c.id}`), ...Object.keys(OLD_HASHES).map((h) => `#${h}`)]) {
      const v = createExperience(chapterFromHash(hash)).view();
      expect(v.chapter.id).toBe(chapterFromHash(hash));
      expect(v.setup.length).toBeGreaterThan(20);
    }
  });
});

describe('a question is answered only by the state it asks about', () => {
  it('II: a hexagon, found while it is a hexagon and not before', () => {
    const x = createExperience('corner', { instantTurns: true });
    x.dispatch({ type: 'slide-to', offset: -1.2 });
    expect(x.view().cut.corners.length).toBe(3);
    expect(x.view().prediction?.revealed).toBe(false);
    x.dispatch({ type: 'slide-to', offset: 0 });
    const v = x.view();
    expect(v.prediction?.revealed).toBe(true);
    expect(v.prediction?.reveal).toContain('Six edges of the cube cross the plane');
    expect(v.prediction?.reveal).toContain('a regular hexagon, 1.41 on each side');
  });

  it('II: a turn that lands in the hexagon shows it, and the question waits for a slide', () => {
    const x = createExperience('corner', { instantTurns: true });
    x.dispatch({ type: 'pose', pose: 'facet' });
    x.dispatch({ type: 'slide-to', offset: 0 });
    expect(x.view().prediction?.revealed).toBe(false);
    x.dispatch({ type: 'pose', pose: 'corner' });
    expect(x.view().cut.shape).toBe('a regular hexagon');
    expect(x.view().prediction?.revealed).toBe(false);
    x.dispatch({ type: 'slide-step', steps: 1 });
    expect(x.view().prediction?.revealed).toBe(true);
  });

  it('III: two corners on the centre, found by asking at the corner pose only', () => {
    const x = createExperience('shadow', { instantTurns: true });
    const single = x.view().shadow.points.findIndex((p) => p.corners.length === 1);
    x.dispatch({ type: 'inspect', target: { kind: 'shadow-point', index: single } });
    expect(x.view().prediction?.revealed).toBe(false);
    x.dispatch({ type: 'pose', pose: 'facet' });
    const pile = x.view().shadow.points.findIndex((p) => p.corners.length === 2);
    x.dispatch({ type: 'inspect', target: { kind: 'shadow-point', index: pile } });
    expect(x.view().prediction?.revealed).toBe(false);
    x.dispatch({ type: 'pose', pose: 'corner' });
    const centre = x.view().shadow.points.findIndex((p) => p.corners.length === 2);
    x.dispatch({ type: 'inspect', target: { kind: 'shadow-point', index: centre } });
    expect(x.view().prediction?.revealed).toBe(true);
    expect(x.view().prediction?.reveal).toMatch(/^Two corners\./);
  });

  it('IV: a tetrahedron near a corner, carried up from the triangle; not the cube, not the solid between', () => {
    const x = createExperience('up', { instantTurns: true });
    for (let k = 0; k < 40; k++) x.dispatch({ type: 'slide-step', steps: 1 });
    expect(x.view().prediction?.revealed).toBe(false);
    x.dispatch({ type: 'pose', pose: 'corner' });
    x.dispatch({ type: 'slide-to', offset: -0.5 });
    expect(x.view().cut.corners.length).toBe(12);
    expect(x.view().prediction?.revealed).toBe(false);
    x.dispatch({ type: 'slide-to', offset: -1.5 });
    const v = x.view();
    expect(v.prediction?.revealed).toBe(true);
    expect(v.prediction?.reveal).toContain('Four edges of the tesseract cross your space');
    expect(v.prediction?.reveal).toContain(FIRST_CUT_CLAUSES.space);
  });

  it('V: two corners on each corner of the shadow, cell first', () => {
    const x = createExperience('up-shadow', { instantTurns: true });
    const pile = x.view().shadow.points.findIndex((p) => p.corners.length === 2);
    x.dispatch({ type: 'inspect', target: { kind: 'shadow-point', index: pile } });
    expect(x.view().prediction?.revealed).toBe(true);
    expect(x.view().prediction?.reveal).toMatch(/^Two corners\. Every corner of this cube-shaped shadow carries two corners of the tesseract’s/);
  });

  it('keeps a reveal as it read when found, whatever happens next', () => {
    const x = createExperience('corner', { instantTurns: true });
    x.dispatch({ type: 'slide-to', offset: 0 });
    const reveal = x.view().prediction?.reveal;
    x.dispatch({ type: 'slide-to', offset: 0.4 });
    x.dispatch({ type: 'pose', pose: 'edge' });
    expect(x.view().prediction?.reveal).toBe(reveal);
  });

  it('never makes a guess a condition: the offered next step reaches every answer without one', () => {
    for (const c of guided.filter((g) => g.prediction !== null)) {
      const x = createExperience(c.id, { instantTurns: true });
      for (let k = 0; k < 4 && !x.view().prediction!.revealed; k++) {
        const test = x.view().prediction!.test;
        expect(test, `${c.id}: a next step while the question is open`).not.toBeNull();
        x.dispatch(test!.action);
      }
      expect(x.view().prediction!.revealed, c.id).toBe(true);
      expect(x.view().prediction!.choice).toBeNull();
      expect(x.view().prediction!.test).toBeNull();
    }
  });
});

describe('a picked point names its own source', () => {
  it('names, for every corner of every cut, the very edge or corner it lies on', () => {
    let checked = 0;
    for (const rung of ['plane', 'space'] as const) {
      const x = createExperience('free', { instantTurns: true });
      x.dispatch({ type: 'rung', id: rung });
      for (const pose of ['facet', 'corner', 'edge'] as const) {
        x.dispatch({ type: 'pose', pose });
        for (const h of [-1.3, -0.4, 0.2, 0.9]) {
          x.dispatch({ type: 'slide-to', offset: h });
          const cut = x.view().cut;
          cut.corners.forEach((c, index) => {
            x.dispatch({ type: 'inspect', target: { kind: 'cut-corner', index } });
            const v = x.view();
            const names = c.on.map((i) => v.corners[i]!.name);
            for (const name of names) expect(v.inspection!.text).toContain(name);
            expect(v.inspection!.edges).toEqual(c.on.length === 2 ? [[c.on[0], c.on[1]]] : []);
            expect(v.inspection!.corners).toEqual(c.on.length === 1 ? [c.on[0]] : []);
            checked += 1;
          });
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('names, for every point of every shadow, every corner that lands there and none that does not', () => {
    for (const rung of ['plane', 'space'] as const) {
      const x = createExperience('free', { instantTurns: true });
      x.dispatch({ type: 'rung', id: rung });
      x.dispatch({ type: 'shadow', on: true });
      for (const pose of ['facet', 'corner', 'edge'] as const) {
        x.dispatch({ type: 'pose', pose });
        x.view().shadow.points.forEach((p, index) => {
          x.dispatch({ type: 'inspect', target: { kind: 'shadow-point', index } });
          const v = x.view();
          expect(v.inspection!.corners).toEqual(p.corners);
          for (const c of v.corners) expect(v.inspection!.text.includes(c.name)).toBe(p.corners.includes(c.index));
        });
      }
    }
  });
});

describe('the empty picture', () => {
  it('is announced only when nothing at all is drawn: no cut, no shadow, no object', () => {
    expect(createExperience('through').view().empty).toBeNull();
    expect(createExperience('corner').view().empty).toBeNull();
    const up = createExperience('up').view();
    expect(up.empty).not.toBeNull();
    const x = createExperience('shadow', { instantTurns: true });
    x.dispatch({ type: 'slide-to', offset: 2.0 });
    expect(x.view().empty).toBeNull();
    x.dispatch({ type: 'shadow', on: false });
    expect(x.view().empty).toBeNull();
    x.dispatch({ type: 'show-object', on: false });
    expect(x.view().empty).not.toBeNull();
  });

  it('says the object is still there, how far and on which side, never that it is gone', () => {
    const x = createExperience('up', { instantTurns: true });
    const e = x.view().empty!;
    expect(e.headline).toBe('Your space meets nothing of the tesseract. The tesseract is still there: its nearest corner is 1.10 ana of your space.');
    x.dispatch({ type: 'slide-to', offset: 1.4 });
    expect(x.view().empty!.headline).toContain('0.40 kata of your space');
  });

  it('offers ways back that work', () => {
    for (const label of ['Pass through', 'Slide to the tesseract’s middle']) {
      const x = createExperience('up', { instantTurns: true });
      const way = x.view().empty!.ways.find((w) => w.label === label)!;
      x.dispatch(way.action);
      for (let k = 0; k < 40 && x.view().meeting.kind !== 'crossing'; k++) x.dispatch({ type: 'tick', dt: 0.05 });
      expect(x.view().meeting.kind).toBe('crossing');
      expect(x.view().empty).toBeNull();
    }
  });
});

/** One frame of the page's clock, as its animation loop sends ticks. */
const FRAME = 1 / 60;

/**
 * A passage run to its end in ticks of one frame: the time of every change of the slice's place, with the place and the
 * cut. The first entry is the start, at time 0. Times count frames, so no rounding accumulates.
 */
function timeline(x: Experience): { t: number; offset: number; shape: string }[] {
  const out = [{ t: 0, offset: x.view().offset, shape: x.view().cut.shape }];
  for (let k = 1; k <= 6000 && x.view().passing; k++) {
    x.dispatch({ type: 'tick', dt: FRAME });
    const v = x.view();
    if (!Object.is(v.offset, out[out.length - 1]!.offset)) out.push({ t: k * FRAME, offset: v.offset, shape: v.cut.shape });
  }
  return out;
}

describe('the passage and the steps', () => {
  it('passes from below to beyond the object’s farthest corner in any pose, and stops there', () => {
    const x = createExperience('through');
    x.dispatch({ type: 'play' });
    const shapes = new Set<string>();
    for (let k = 0; k < 600 && x.view().passing; k++) { x.dispatch({ type: 'tick', dt: 1 / 60 }); shapes.add(x.view().cut.shape); }
    expect(x.view().passing).toBe(false);
    // √3 + 0.3, on the grid: beyond the cube in every pose, so a turn made now cuts nothing.
    expect(x.view().offset).toBe(2);
    expect([...shapes].sort()).toEqual(['a square', 'nothing']);
  });

  it('starts again from below when it is already past the top', () => {
    const x = createExperience('through');
    x.dispatch({ type: 'slide-to', offset: 1.9 });
    x.dispatch({ type: 'play' });
    expect(x.view().offset).toBe(-2);
    expect(x.view().passing).toBe(true);
    x.dispatch({ type: 'stop' });
    expect(x.view().passing).toBe(false);
  });

  it('lands a passage on the exact middle, and rests there 0.9 s, as the guide says, in both rungs, gliding or stepped', () => {
    for (const steppedPass of [false, true]) {
      for (const [chapter, middle] of [['corner', 'a regular hexagon'], ['up', 'a regular octahedron']] as const) {
        const x = createExperience(chapter, { instantTurns: true, steppedPass });
        x.dispatch({ type: 'pose', pose: 'corner' });
        x.dispatch({ type: 'play' });
        const changes = timeline(x);
        const land = changes.findIndex((c) => Object.is(c.offset, 0));
        expect(land, `${chapter}, stepped ${steppedPass}`).toBeGreaterThan(0);
        expect(changes[land]!.shape).toBe(middle);
        const atMiddle = changes[land + 1]!.t - changes[land]!.t;
        // Gliding, the slice leaves on the first frame after the rest; stepped, it rests and then waits one step's
        // 0.35 s. Each is held to the guide's numbers, with up to two frames for where the ticks fall.
        const expected = steppedPass ? 0.9 + 0.35 : 0.9;
        expect(atMiddle, `${chapter}, stepped ${steppedPass}`).toBeGreaterThanOrEqual(expected - 1e-9);
        expect(atMiddle, `${chapter}, stepped ${steppedPass}`).toBeLessThanOrEqual(expected + 2 * FRAME + 1e-9);
      }
    }
  });

  it('under reduced motion, moves one step every 0.35 s, as the guide says, by the scheduler’s own clock, and rests 0.9 s more at the middle (B-5)', () => {
    for (const chapter of ['corner', 'up'] as const) {
      const x = createExperience(chapter, { instantTurns: true, steppedPass: true });
      x.dispatch({ type: 'pose', pose: 'corner' });
      x.dispatch({ type: 'play' });
      const changes = timeline(x);
      expect(x.view().passing).toBe(false);
      const land = changes.findIndex((c) => Object.is(c.offset, 0));
      // Every step but the one off the middle: the documented 0.35 s, and at most one frame more, since a step comes
      // on the first frame at or after it. Enough of them that no steady interval but 0.35 s could pass.
      const steps = changes.slice(2).map((c, i) => ({ gap: c.t - changes[i + 1]!.t, fromMiddle: i + 1 === land }));
      const ordinary = steps.filter((s) => !s.fromMiddle).map((s) => s.gap);
      expect(ordinary.length, chapter).toBeGreaterThan(30);
      for (const gap of ordinary) {
        expect(gap, chapter).toBeGreaterThanOrEqual(0.35 - 1e-9);
        expect(gap, chapter).toBeLessThanOrEqual(0.35 + FRAME + 1e-9);
      }
      // The step off the middle waits the rest and then one step: 0.9 s more than an ordinary step, within two frames.
      const offMiddle = steps.find((s) => s.fromMiddle)!.gap;
      expect(offMiddle - 0.35, chapter).toBeGreaterThanOrEqual(0.9 - 1e-9);
      expect(offMiddle - 0.35, chapter).toBeLessThanOrEqual(0.9 + 2 * FRAME + 1e-9);
    }
  });

  it('under reduced motion, steps a passage on the grid, through the same cuts the arrow keys visit', () => {
    const stepped = createExperience('corner', { instantTurns: true, steppedPass: true });
    stepped.dispatch({ type: 'play' });
    const visited: number[] = [stepped.view().offset];
    const shapes: string[] = [stepped.view().cut.shape];
    for (let k = 0; k < 2000 && stepped.view().passing; k++) {
      stepped.dispatch({ type: 'tick', dt: 1 / 60 });
      const v = stepped.view();
      if (v.offset !== visited[visited.length - 1]) { visited.push(v.offset); shapes.push(v.cut.shape); }
    }
    // Never between grid points, and never more than one step at a time.
    for (const o of visited) expect(Math.round(o * 10) / 10).toBe(o);
    for (let i = 1; i < visited.length; i++) expect(visited[i]! - visited[i - 1]!).toBeCloseTo(SLIDE_STEP, 12);
    // The arrow keys from the same start, over the same span.
    const keys = createExperience('corner', { instantTurns: true });
    const keyShapes: string[] = [keys.view().cut.shape];
    for (let k = 0; k < 100 && keys.view().offset < visited[visited.length - 1]!; k++) { keys.dispatch({ type: 'slide-step', steps: 1 }); keyShapes.push(keys.view().cut.shape); }
    expect(shapes).toEqual(keyShapes);
    expect(shapes).toContain('a regular hexagon');
  });

  it('steps the slice on its grid exactly, and to the next layer of corners exactly', () => {
    const x = createExperience('corner');
    for (let k = 0; k < 19; k++) x.dispatch({ type: 'slide-step', steps: 1 });
    expect(x.view().offset).toBe(0);
    const layers = x.view().layers.map((l) => l.height);
    x.dispatch({ type: 'slide-layer', direction: 1 });
    expect(x.view().offset).toBe(layers[2]);
    x.dispatch({ type: 'slide-layer', direction: 1 });
    expect(x.view().offset).toBe(layers[3]);
    x.dispatch({ type: 'slide-layer', direction: 1 });
    expect(x.view().offset).toBe(layers[3]);
    expect(nextLayer(x.view().layers, layers[3]!, 1)).toBeNull();
  });

  it('turns in five-degree steps that stop on every named pose', () => {
    for (const rung of ['plane', 'space'] as const) {
      const stops = Object.values(RUNGS[rung].stops);
      let tip = 0;
      const seen: number[] = [];
      for (let k = 0; k < 30; k++) { tip = tipStep(rung, tip, 1); seen.push(tip); }
      for (const s of stops) expect(seen.filter((t) => t === s).length + (s === 0 ? 1 : 0)).toBeGreaterThan(0);
      expect(tip).toBe(Math.PI / 2);
    }
  });

  it('names a chapter for every id, and a numeral for every chapter', () => {
    for (const c of CHAPTERS) expect(chapterById(c.id).numeral).toBe(c.numeral);
  });
});

describe('an open question about pile-ups is not answered in words either', () => {
  it('casts the shadow without counting it, until the question is answered', () => {
    const x = createExperience('shadow', { instantTurns: true });
    x.dispatch({ type: 'shadow', on: false });
    x.dispatch({ type: 'shadow', on: true });
    expect(x.view().event?.line).toBe('The shadow is all of the cube, dropped straight along the direction the plane lacks. Pick a point of it to see what lands there.');
    expect(x.view().event?.line).not.toMatch(/\b(two|seven|eight)\b/);
    // The step points the centre out, then shows what lands there.
    for (let k = 0; k < 8 && !x.view().prediction!.revealed; k++) x.dispatch(x.view().prediction!.test!.action);
    expect(x.view().prediction!.revealed).toBe(true);
    x.dispatch({ type: 'shadow', on: false });
    x.dispatch({ type: 'shadow', on: true });
    expect(x.view().event?.line).toContain('its 8 corners land on 7 points');
  });

  it('withholds only in the chapters whose question is about pile-ups', () => {
    for (const c of CHAPTERS) expect(createExperience(c.id).view().withhold, c.id).toBe(c.prediction === 'shadow-centre' || c.prediction === 'shadow-corner');
  });
});

describe('the corner rule keeps its condition (C2)', () => {
  /** The first layer of corners, and the cut just past it, counted from the definition (analytic.ts), not by the page. */
  const firstCut = (x: Experience): { firstLayer: number; crossingCorners: number; shape: string } => {
    const w = x.world();
    const first = w.layers()[0]!;
    x.dispatch({ type: 'slide-to', offset: first.height + 0.05 });
    const corners = w.corners().map((c) => [...c.posed]);
    const axis = w.rung.extraAxis;
    return { firstLayer: first.corners.length, crossingCorners: crossings(corners, w.edges, axis, first.height + 0.05).length, shape: x.view().cut.shape };
  };

  for (const [chapter, rung] of [['corner', 'plane'], ['up', 'space']] as const) {
    it(`${chapter === 'corner' ? 'II' : 'IV'}: says the rule only of the pose it holds for, and every clause stays true in every named pose`, () => {
      const x = createExperience(chapter, { instantTurns: true });
      for (let k = 0; k < 4 && !x.view().prediction!.revealed; k++) x.dispatch(x.view().prediction!.test!.action);
      const said = x.view().prediction!.reveal!;
      expect(said).toContain(FIRST_CUT_CLAUSES[rung]);
      // The unconditional wording the review found is gone.
      expect(said).not.toMatch(/Near a corner|so near a corner/);
      const facts: Record<string, { firstLayer: number; crossingCorners: number; shape: string }> = {};
      for (const pose of ['corner', 'facet', 'edge'] as const) {
        x.dispatch({ type: 'pose', pose });
        facts[pose] = firstCut(x);
        // The reveal stays as it was said; so each of its clauses must hold here.
        expect(x.view().prediction!.reveal).toBe(said);
      }
      // "Stood on one corner ... at that corner alone ... a triangle" / "a tetrahedron".
      expect(facts.corner!.firstLayer).toBe(1);
      expect(facts.corner!.crossingCorners).toBe(rung === 'plane' ? 3 : 4);
      expect(facts.corner!.shape).toBe(rung === 'plane' ? 'an equilateral triangle' : 'a regular tetrahedron');
      // "Face (cell) first or edge first, several corners arrive together, and the first cut is a square or a rectangle"
      // (plane) / "a cube or a triangular prism" (space).
      expect(facts.facet!.firstLayer).toBe(rung === 'plane' ? 4 : 8);
      expect(facts.edge!.firstLayer).toBe(2);
      expect(facts.facet!.shape).toBe(rung === 'plane' ? 'a square' : 'a cube');
      expect(facts.edge!.shape).toBe(rung === 'plane' ? 'a rectangle' : 'a triangular prism');
      expect(facts.facet!.crossingCorners).toBe(rung === 'plane' ? 4 : 8);
      expect(facts.edge!.crossingCorners).toBe(rung === 'plane' ? 4 : 6);
    });
  }
});

describe('the steps leave the discovery to the visitor (D-1)', () => {
  it('IV: no turn, from the start or after a passage, answers the question; the step’s slide does', () => {
    const x = createExperience('up', { instantTurns: true });
    for (const pose of ['corner', 'edge', 'facet'] as const) {
      x.dispatch({ type: 'pose', pose });
      expect(x.view().meeting.kind, pose).toBe('apart');
      expect(x.view().prediction!.revealed).toBe(false);
    }
    x.dispatch({ type: 'play' });
    for (let k = 0; k < 2000 && x.view().passing; k++) x.dispatch({ type: 'tick', dt: 1 / 30 });
    for (const pose of ['corner', 'edge', 'facet', 'corner'] as const) {
      x.dispatch({ type: 'pose', pose });
      expect(x.view().meeting.kind, `after the passage, ${pose}`).toBe('apart');
    }
    expect(x.view().prediction!.revealed).toBe(false);
    const step = x.view().prediction!.test!;
    expect(step.label).toBe('Slide in, just past its first corner');
    x.dispatch(step.action);
    expect(x.view().prediction!.revealed).toBe(true);
  });

  it('IV: a turn that lands in the answer shows the cut, and leaves the question open until a slide', () => {
    const x = createExperience('up', { instantTurns: true });
    x.dispatch({ type: 'slide-to', offset: 1.8 });
    x.dispatch({ type: 'pose', pose: 'corner' });
    expect(x.view().cut.corners.length).toBe(4);
    expect(x.view().prediction!.revealed).toBe(false);
    x.dispatch({ type: 'slide-step', steps: -1 });
    expect(x.view().prediction!.revealed).toBe(true);
  });

  it('IV: the step slides into the answer, past the first corner and short of the second layer (RM4)', () => {
    for (const from of [-2.1, 2.3]) {
      const x = createExperience('up', { instantTurns: true });
      x.dispatch({ type: 'slide-to', offset: from });
      x.dispatch({ type: 'pose', pose: 'corner' });
      const step = x.view().prediction!.test!;
      expect(step.action.type).toBe('slide-to');
      const target = (step.action as Extract<Action, { type: 'slide-to' }>).offset;
      const layers = x.view().layers.map((l) => l.height);
      if (from < 0) { expect(target).toBeGreaterThan(layers[0]!); expect(target).toBeLessThan(layers[1]!); }
      else { expect(target).toBeLessThan(layers[layers.length - 1]!); expect(target).toBeGreaterThan(layers[layers.length - 2]!); }
      x.dispatch(step.action);
      expect(x.view().cut.corners.length).toBe(4);
      expect(x.view().prediction!.revealed).toBe(true);
    }
  });

  it('IV: answers only in the pose its question names, not wherever a tetrahedron appears (RM5)', () => {
    const x = createExperience('up', { instantTurns: true });
    x.dispatch({ type: 'tip-to', angle: (50 * Math.PI) / 180 });
    const first = x.view().layers[0]!.height;
    x.dispatch({ type: 'slide-to', offset: first + 0.05 });
    expect(x.view().cut.corners.length).toBe(4);
    expect(x.view().pose).toBeNull();
    expect(x.view().prediction!.revealed).toBe(false);
  });

  it('II: the step offers the cut near the corner before the middle', () => {
    const x = createExperience('corner', { instantTurns: true });
    const first = x.view().prediction!.test!;
    expect(first.label).toBe('Slide just past its lowest corner');
    x.dispatch(first.action);
    expect(x.view().cut.shape).toBe('an equilateral triangle');
    expect(x.view().prediction!.revealed).toBe(false);
    const second = x.view().prediction!.test!;
    expect(second.label).toBe('Slide to the middle');
    x.dispatch(second.action);
    expect(x.view().prediction!.revealed).toBe(true);
  });

  it('II: says "a triangle" when, and only when, a triangle has been on show (RM6)', () => {
    const x = createExperience('corner', { instantTurns: true });
    expect(x.view().hint).not.toMatch(/^A triangle/);
    x.dispatch({ type: 'slide-to', offset: -1.8 });
    expect(x.view().cut.empty).toBe(true);
    expect(x.view().hint).not.toMatch(/^A triangle/);
    x.dispatch({ type: 'slide-to', offset: -1.5 });
    expect(x.view().cut.corners.length).toBe(3);
    expect(x.view().hint).toMatch(/^A triangle: stood on one corner, the plane just past it crosses only that corner’s three edges/);
    // A four-cornered cut is not a triangle: turned face first, the square never sets it.
    const y = createExperience('corner', { instantTurns: true });
    y.dispatch({ type: 'pose', pose: 'facet' });
    y.dispatch({ type: 'slide-to', offset: 0 });
    expect(y.view().cut.corners.length).toBe(4);
    expect(y.view().hint).not.toMatch(/^A triangle/);
  });

  for (const [chapter, point, pose] of [['shadow', 'Point out the centre', 'corner'], ['up-shadow', 'Point out a corner of the shadow', 'facet']] as const) {
    it(`${chapter === 'shadow' ? 'III' : 'V'}: points the place out first, and only a plainly named second press shows what lands there`, () => {
      const x = createExperience(chapter, { instantTurns: true });
      const one = x.view().prediction!.test!;
      expect(one.label).toBe(point);
      expect(one.action.type).toBe('attend');
      x.dispatch(one.action);
      let v = x.view();
      expect(v.attention).toEqual((one.action as Extract<Action, { type: 'attend' }>).target);
      expect(v.inspection).toBeNull();
      expect(v.prediction!.revealed).toBe(false);
      expect(v.withhold).toBe(true);
      const two = v.prediction!.test!;
      expect(two.label).toBe('Show me what lands there');
      x.dispatch(two.action);
      v = x.view();
      expect(v.prediction!.revealed).toBe(true);
      expect(v.attention).toBeNull();
      expect(v.pose).toBe(pose);
    });
  }
});

describe('a turn, or Escape, stops a passage (B-1)', () => {
  const passing = (): Experience => {
    const x = createExperience('free');
    x.dispatch({ type: 'slide-to', offset: -2 });
    x.dispatch({ type: 'play' });
    for (let k = 0; k < 10; k++) x.dispatch({ type: 'tick', dt: 1 / 60 });
    expect(x.view().passing).toBe(true);
    return x;
  };

  it('stops on a named pose, a dial turn and a turning key, and the slice stays put while the object turns', () => {
    for (const turn of [{ type: 'pose', pose: 'edge' }, { type: 'tip-to', angle: 0.3 }, { type: 'tip-step', steps: 1 }] as Action[]) {
      const x = passing();
      x.dispatch(turn);
      expect(x.view().passing, turn.type).toBe(false);
      const offset = x.view().offset;
      for (let k = 0; k < 60; k++) x.dispatch({ type: 'tick', dt: 1 / 60 });
      expect(x.view().offset, turn.type).toBe(offset);
    }
  });

  it('stops on Escape while passing; Escape lets go of a pick otherwise', () => {
    const x = passing();
    const context = { passing: x.view().passing, shadowOn: x.view().shadowOn, objectShown: x.view().objectShown };
    const esc = keyAction('Escape', false, context) as Action;
    expect(esc).toEqual({ type: 'stop' });
    x.dispatch(esc);
    expect(x.view().passing).toBe(false);
    expect(keyAction('Escape', false, { ...context, passing: false })).toEqual({ type: 'inspect', target: null });
  });

  it('restarts from where it stopped, and a chapter or a reset ends it', () => {
    const x = passing();
    x.dispatch({ type: 'stop' });
    const at = x.view().offset;
    x.dispatch({ type: 'play' });
    expect(x.view().offset).toBe(at);
    expect(x.view().passing).toBe(true);
    x.dispatch({ type: 'chapter', id: 'through' });
    expect(x.view().passing).toBe(false);
    x.dispatch({ type: 'play' });
    x.dispatch({ type: 'reset' });
    expect(x.view().passing).toBe(false);
  });
});

describe('a slide made while the object turns is named (B-3)', () => {
  it('says both when the turn settles', () => {
    const x = createExperience('corner');
    x.dispatch({ type: 'pose', pose: 'edge' });
    x.dispatch({ type: 'tick', dt: 0.1 });
    x.dispatch({ type: 'slide-step', steps: 3 });
    for (let k = 0; k < 60 && x.view().turning; k++) x.dispatch({ type: 'tick', dt: 1 / 30 });
    expect(x.view().event?.line).toContain('you turned the cube and slid the plane while it turned.');
    expect(x.view().event?.line).toContain('every edge is still 2.00 long');
  });
});

describe('ana and kata are introduced on every path into the space rung (C4)', () => {
  const introduced = (v: View): boolean => v.setup.includes(ANA_KATA);

  it('in free exploration, cold, from chapter I, and on every return to the space rung', () => {
    const cold = createExperience('free');
    expect(cold.view().rung).toBe('plane');
    expect(cold.view().setup).not.toMatch(/\b(ana|kata)\b/);
    cold.dispatch({ type: 'rung', id: 'space' });
    expect(introduced(cold.view())).toBe(true);
    // The introduction comes before ana is used in the card's status or the picture's note.
    expect(cold.view().status).toMatch(/\bana\b/);
    cold.dispatch({ type: 'rung', id: 'plane' });
    expect(cold.view().setup).not.toMatch(/\b(ana|kata)\b/);
    cold.dispatch({ type: 'rung', id: 'space' });
    expect(introduced(cold.view())).toBe(true);
    const fromI = createExperience('through');
    fromI.dispatch({ type: 'chapter', id: 'free' });
    fromI.dispatch({ type: 'rung', id: 'space' });
    expect(introduced(fromI.view())).toBe(true);
    // Chapter IV says the same in one sentence on the guided path; free exploration's full sentence serves a cold visitor.
    expect(createExperience('up').view().setup).toContain(ANA_KATA_GUIDED);
    expect(ANA_KATA).toMatch(/they are not up and down/);
    expect(ANA_KATA).toMatch(/a convention of the drawing, not a direction in the picture/);
  });

  it('in chapter IV, by a cold link and by the guided path, before any action and after a passage: along w, not up and down, and drawn at the top (C4-a)', () => {
    expect(ANA_KATA_GUIDED).toMatch(/along the fourth, w, are ana and kata, not up and down/);
    expect(ANA_KATA_GUIDED).toMatch(/though the gauge and dial draw ana at the top/);
    const cold = createExperience('up', { instantTurns: true });
    const guidedIn = createExperience('through', { instantTurns: true });
    for (const c of ['corner', 'shadow', 'up'] as const) guidedIn.dispatch({ type: 'chapter', id: c });
    for (const x of [cold, guidedIn]) {
      expect(x.view().chapter.id).toBe('up');
      expect(x.view().setup).toContain(ANA_KATA_GUIDED);
      // The introduction comes before any other use of ana in the setup.
      expect(x.view().setup.indexOf('are ana and kata')).toBeLessThan(x.view().setup.indexOf('ana of it'));
      x.dispatch({ type: 'play' });
      for (let k = 0; k < 2000 && x.view().passing; k++) x.dispatch({ type: 'tick', dt: FRAME });
      expect(x.view().passing).toBe(false);
      expect(x.view().setup).toContain(ANA_KATA_GUIDED);
    }
  });
});

describe('a hint that names what is on show names what is on show; a rule it states carries its condition (C2-a)', () => {
  const TRIANGLE = 'A triangle: stood on one corner, the plane just past it crosses only that corner’s three edges. Keep going.';
  const BACK = 'The question stands the cube on a corner: press Corner first, then slide the plane.';
  const OPEN = 'Guess first, if you like, then slide the plane up.';

  it('II: the triangle’s hint stands only over a triangle at Corner first; Face first and Edge first say how to get back; return and reset', () => {
    const x = createExperience('corner', { instantTurns: true });
    expect(x.view().hint).toBe(OPEN);
    x.dispatch({ type: 'slide-to', offset: -1.5 });
    expect(x.view().cut.corners.length).toBe(3);
    expect(x.view().hint).toBe(TRIANGLE);
    for (const [pose, shape] of [['facet', 'a square'], ['edge', 'a rectangle']] as const) {
      x.dispatch({ type: 'pose', pose });
      // Just past the first layer of corners, where the cut begins in this pose.
      x.dispatch({ type: 'slide-to', offset: x.view().layers[0]!.height + 0.05 });
      expect(x.view().cut.shape, pose).toBe(shape);
      expect(x.view().hint, pose).toBe(BACK);
      expect(x.view().hint, pose).not.toMatch(/triangle|one corner|three edges/);
    }
    // Back on the corner, just past it: the triangle and its hint again; below it, nothing cut, the open hint.
    x.dispatch({ type: 'pose', pose: 'corner' });
    x.dispatch({ type: 'slide-to', offset: x.view().layers[0]!.height + 0.2 });
    expect(x.view().cut.corners.length).toBe(3);
    expect(x.view().hint).toBe(TRIANGLE);
    x.dispatch({ type: 'slide-to', offset: -1.9 });
    expect(x.view().cut.empty).toBe(true);
    expect(x.view().hint).toBe(OPEN);
    // Reset: the chapter's start, and its open hint.
    x.dispatch({ type: 'slide-to', offset: -1.5 });
    expect(x.view().hint).toBe(TRIANGLE);
    x.dispatch({ type: 'reset' });
    expect(x.view().hint).toBe(OPEN);
  });

  it('IV: "A cube." only over a cube; the passage’s and the middle’s rules carry their poses, true in every pose', () => {
    const x = createExperience('up', { instantTurns: true });
    x.dispatch({ type: 'slide-to', offset: -0.5 });
    expect(x.view().cut.shape).toBe('a cube');
    expect(x.view().hint).toBe('A cube. Keep going: does it change as your space moves on?');
    x.dispatch({ type: 'pose', pose: 'edge' });
    expect(x.view().cut.shape).not.toBe('a cube');
    expect(x.view().hint).toBe('Keep going: does the cut change as your space moves on?');
    // A passage made edge first: the hint's cube is the cell-first one, and says so.
    x.dispatch({ type: 'slide-to', offset: 2.3 });
    expect(x.view().meeting.kind).toBe('apart');
    expect(x.view().hint).toMatch(/^Cell first, the cut is a cube the whole way through/);
    // The octahedron, seen corner first at the middle, then the pose left: its hint still names its condition.
    x.dispatch({ type: 'pose', pose: 'corner' });
    x.dispatch({ type: 'slide-to', offset: 0 });
    expect(x.view().cut.shape).toBe('a regular octahedron');
    x.dispatch({ type: 'pose', pose: 'facet' });
    expect(x.view().cut.shape).toBe('a cube');
    expect(x.view().hint).toMatch(/^Corner first, at the very middle, six of the tesseract’s corners lie in your space at once/);
  });

  it('never names a cut that is not on show: every pose and slide, after every milestone, in II and IV', () => {
    let checked = 0;
    for (const chapter of ['corner', 'up'] as const) {
      const x = createExperience(chapter, { instantTurns: true });
      // Gather the milestones a visitor gathers: a passage, a turn to the corner, a slide past it, the middle.
      x.dispatch({ type: 'play' });
      for (let k = 0; k < 2000 && x.view().passing; k++) x.dispatch({ type: 'tick', dt: FRAME });
      x.dispatch({ type: 'pose', pose: 'corner' });
      for (const h of [-1.5, 0, 1.5]) x.dispatch({ type: 'slide-to', offset: h });
      for (const pose of ['facet', 'corner', 'edge'] as const) {
        x.dispatch({ type: 'pose', pose });
        for (let k = -24; k <= 24; k++) {
          x.dispatch({ type: 'slide-to', offset: k / 10 });
          const v = x.view();
          checked += 1;
          if (/^A triangle/.test(v.hint)) { expect(v.cut.corners.length).toBe(3); expect(v.pose).toBe('corner'); }
          if (/^A cube\./.test(v.hint)) expect(v.cut.shape).toBe('a cube');
          if (/^Six edges, six corners/.test(v.hint)) expect(v.cut.corners.length).toBe(6);
          // A rule about one corner, a passage or the middle is said with the pose it holds for.
          if (/crosses only that corner|the whole way through|at the very middle/.test(v.hint)) expect(v.hint).toMatch(/^(A triangle: stood on one corner|Cell first|Corner first)/);
        }
      }
    }
    expect(checked).toBe(2 * 3 * 49);
  });
});

describe('pointing a place out lets go of an earlier pick, so no line about one point stands beside a ring round another (D-8)', () => {
  it('III: a pick that does not answer, then Point out the centre: the ring, no stale line; Show me answers; reset and re-entry clear both', () => {
    const x = createExperience('shadow', { instantTurns: true });
    const single = x.view().shadow.points.findIndex((p) => p.corners.length === 1);
    x.dispatch({ type: 'inspect', target: { kind: 'shadow-point', index: single } });
    expect(x.view().inspection?.text).toMatch(/^One corner lands here/);
    expect(x.view().prediction!.revealed).toBe(false);
    expect(x.view().prediction!.test!.label).toBe('Point out the centre');
    x.dispatch(x.view().prediction!.test!.action);
    expect(x.view().attention).not.toBeNull();
    expect(x.view().inspection).toBeNull();
    expect(x.view().prediction!.revealed).toBe(false);
    expect(x.view().hint).toMatch(/^The ringed dot is the shadow’s centre/);
    expect(x.view().prediction!.test!.label).toBe('Show me what lands there');
    x.dispatch(x.view().prediction!.test!.action);
    expect(x.view().prediction!.revealed).toBe(true);
    expect(x.view().attention).toBeNull();
    expect(x.view().inspection?.text).toMatch(/^Two corners land here/);
    x.dispatch({ type: 'reset' });
    expect(x.view().inspection).toBeNull();
    expect(x.view().attention).toBeNull();
    expect(x.view().prediction!.revealed).toBe(false);
    // Re-entry: away to V and back, a wrong pick and the ring again; the same rule.
    x.dispatch({ type: 'chapter', id: 'up-shadow' });
    x.dispatch({ type: 'chapter', id: 'shadow' });
    x.dispatch({ type: 'inspect', target: { kind: 'shadow-point', index: single } });
    x.dispatch(x.view().prediction!.test!.action);
    expect(x.view().attention).not.toBeNull();
    expect(x.view().inspection).toBeNull();
  });

  it('V: the same rule, and Point out still answers nothing while Show me does', () => {
    const x = createExperience('up-shadow', { instantTurns: true });
    // A pick in a pose the question is not about answers nothing; back cell first, the ring lets that pick go.
    x.dispatch({ type: 'pose', pose: 'corner' });
    x.dispatch({ type: 'inspect', target: { kind: 'shadow-point', index: 0 } });
    expect(x.view().inspection).not.toBeNull();
    expect(x.view().prediction!.revealed).toBe(false);
    const ring = { kind: 'shadow-point', index: 0 } as const;
    x.dispatch({ type: 'attend', target: ring });
    expect(x.view().inspection).toBeNull();
    x.dispatch({ type: 'pose', pose: 'facet' });
    expect(x.view().prediction!.test!.label).toBe('Point out a corner of the shadow');
    x.dispatch(x.view().prediction!.test!.action);
    expect(x.view().attention).not.toBeNull();
    expect(x.view().inspection).toBeNull();
    expect(x.view().prediction!.revealed).toBe(false);
    expect(x.view().withhold).toBe(true);
    x.dispatch(x.view().prediction!.test!.action);
    expect(x.view().prediction!.revealed).toBe(true);
    expect(x.view().inspection?.text).toMatch(/^Two corners land here/);
  });
});

describe('a turn that changes nothing says nothing (no-op turns)', () => {
  /** The event counter and line, the tip, and what is picked. */
  const mark = (x: Experience) => ({ id: x.view().eventId, line: x.view().event?.line ?? null, tip: x.view().tip, inspection: x.view().inspection?.text ?? null });

  it('at both ends of the dial and on a pose already held, in both rungs: no line, no turn, nothing let go; a real turn still speaks', () => {
    for (const rung of ['plane', 'space'] as const) {
      for (const instantTurns of [true, false]) {
        const x = createExperience('free', { instantTurns });
        x.dispatch({ type: 'rung', id: rung });
        x.dispatch({ type: 'slide-to', offset: 0 });
        x.dispatch({ type: 'pose', pose: 'facet' });
        for (let k = 0; k < 60 && x.view().turning; k++) x.dispatch({ type: 'tick', dt: FRAME });
        for (const [end, past] of [['facet', -1], ['edge', 1]] as const) {
          if (end === 'edge') {
            const before = mark(x);
            x.dispatch({ type: 'pose', pose: 'edge' });
            for (let k = 0; k < 60 && x.view().turning; k++) x.dispatch({ type: 'tick', dt: FRAME });
            const after = mark(x);
            expect(after.id, `${rung} real turn`).toBeGreaterThan(before.id);
            expect(after.line, `${rung} real turn`).toMatch(/you turned/);
          }
          x.dispatch({ type: 'inspect', target: { kind: 'cut-corner', index: 0 } });
          const held = mark(x);
          expect(held.inspection).not.toBeNull();
          for (const a of [
            { type: 'tip-step', steps: past }, { type: 'tip-step', steps: 3 * past }, { type: 'tip-to', angle: past * 3 },
            { type: 'pose', pose: end }
          ] as Action[]) {
            x.dispatch(a);
            for (let k = 0; k < 60; k++) x.dispatch({ type: 'tick', dt: FRAME });
            expect(mark(x), `${rung} ${end} ${JSON.stringify(a)} instant ${instantTurns}`).toEqual(held);
            expect(x.view().turning).toBe(false);
          }
        }
        // A real step off the end speaks.
        const before = mark(x);
        x.dispatch({ type: 'tip-step', steps: -1 });
        expect(mark(x).id).toBeGreaterThan(before.id);
        expect(mark(x).line).toMatch(/you turned/);
      }
    }
  });

  it('a pose already held stops a passage and says no turn', () => {
    for (const instantTurns of [true, false]) {
      const x = createExperience('corner', { instantTurns });
      x.dispatch({ type: 'play' });
      for (let k = 0; k < 30; k++) x.dispatch({ type: 'tick', dt: FRAME });
      expect(x.view().passing).toBe(true);
      const at = x.view().offset;
      const before = mark(x);
      x.dispatch({ type: 'pose', pose: 'corner' });
      for (let k = 0; k < 60; k++) x.dispatch({ type: 'tick', dt: FRAME });
      expect(x.view().passing).toBe(false);
      expect(x.view().turning).toBe(false);
      expect(x.view().offset).toBe(at);
      expect(mark(x)).toEqual(before);
    }
  });
});

describe('each dimension is said for what it is (RM10)', () => {
  it('names the world’s, the slice’s, the object’s, the cut’s and the shadow’s dimensions, in both rungs, cut or not', () => {
    const x = createExperience('free', { instantTurns: true });
    const seen = new Set<string>();
    for (const rung of ['plane', 'space'] as const) {
      x.dispatch({ type: 'rung', id: rung });
      for (const h of [-2.3, -0.4, 0.3]) {
        x.dispatch({ type: 'slide-to', offset: h });
        const v = x.view();
        const [world, slice] = rung === 'plane' ? [3, 2] : [4, 3];
        const cut = v.cut.empty ? 'nothing is cut just now' : `the cut is ${slice}-dimensional, ${rung === 'plane' ? 'a flat shape' : 'a solid'}`;
        expect(dimensionsSentence(v.rung, v.dimensions)).toBe(`The world has ${world} directions and ${v.words.slice} has ${slice}. `
          + `${v.words.TheObject} is ${world}-dimensional; ${cut}; the shadow is ${slice}-dimensional. Your screen is flat: it shows `
          + `${rung === 'plane' ? 'all of this' : 'your space'} in perspective, so a length on screen is not a length in the world.`);
        seen.add(`${rung}:${v.cut.empty}`);
      }
    }
    expect(seen.size).toBe(4);
  });

  it('gives a cut, whenever there is one, the slice’s own dimension: the reason RM10 changes no sentence', () => {
    // RM10 replaces the cut's dimension with the slice's inside the clause said only when a cut exists. That is the
    // same number in every state the page can reach, so the mutant is equivalent; this is the demonstration.
    const x = createExperience('free', { instantTurns: true });
    let cuts = 0;
    for (const rung of ['plane', 'space'] as const) {
      x.dispatch({ type: 'rung', id: rung });
      for (let deg = 0; deg <= 90; deg += 5) {
        x.dispatch({ type: 'tip-to', angle: (deg * Math.PI) / 180 });
        for (const layer of x.view().layers) for (const d of [0, 0.05, -0.05]) {
          x.dispatch({ type: 'slide-to', offset: layer.height + d });
          const v = x.view();
          expect(v.dimensions.cut === null || v.dimensions.cut === v.dimensions.slice).toBe(true);
          if (v.dimensions.cut !== null) cuts += 1;
        }
      }
    }
    expect(cuts).toBeGreaterThan(300);
  });
});
