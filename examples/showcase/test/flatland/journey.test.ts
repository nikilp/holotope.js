import { describe, expect, it } from 'vitest';
import { RUNGS } from '../../src/flatland/world.js';
import {
  CHAPTERS, OLD_HASHES, chapterById, chapterFromHash, createExperience, isRoute, nextLayer, tipStep,
  type Action, type ChapterId, type Experience, type View
} from '../../src/flatland/journey.js';

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

  it('IV: the tesseract just ana of your space, cell first', () => {
    const v = at('up');
    expect(v.pose).toBe('facet');
    // The slice below the object along the missing axis: the object lies on its plus side, ana.
    expect(v.meeting).toMatchObject({ kind: 'apart', side: 'below' });
    expect(v.setup).toContain('ana of it');
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
    expect(v.prediction?.reveal).toContain('three edges');
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
    expect(e.headline).toBe('Your space meets nothing of the tesseract. The tesseract is still there: its nearest corner is 0.60 ana of your space.');
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

describe('the passage and the steps', () => {
  it('passes from below to just beyond the top, and stops there', () => {
    const x = createExperience('through');
    x.dispatch({ type: 'play' });
    const shapes = new Set<string>();
    for (let k = 0; k < 400 && x.view().passing; k++) { x.dispatch({ type: 'tick', dt: 1 / 60 }); shapes.add(x.view().cut.shape); }
    expect(x.view().passing).toBe(false);
    expect(x.view().offset).toBe(1.3);
    expect([...shapes].sort()).toEqual(['a square', 'nothing']);
  });

  it('starts again from below when it is already past the top', () => {
    const x = createExperience('through');
    x.dispatch({ type: 'slide-to', offset: 1.9 });
    x.dispatch({ type: 'play' });
    expect(x.view().offset).toBe(-1.3);
    expect(x.view().passing).toBe(true);
    x.dispatch({ type: 'stop' });
    expect(x.view().passing).toBe(false);
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
    x.dispatch(x.view().prediction!.test!.action);
    x.dispatch({ type: 'shadow', on: false });
    x.dispatch({ type: 'shadow', on: true });
    expect(x.view().event?.line).toContain('its 8 corners land on 7 points');
  });

  it('withholds only in the chapters whose question is about pile-ups', () => {
    for (const c of CHAPTERS) expect(createExperience(c.id).view().withhold, c.id).toBe(c.prediction === 'shadow-centre' || c.prediction === 'shadow-corner');
  });
});
