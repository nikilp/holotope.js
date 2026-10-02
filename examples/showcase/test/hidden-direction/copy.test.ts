import { describe, expect, it } from 'vitest';
import { CHAPTERS, createExperience, type ChapterId } from '../../src/hidden-direction/experience.js';
import {
  EMPTY_HEADLINE, GAUGE_LEGEND, PLANE_LEGEND, SHADOW_LEGEND, absentReason, caption, clockName, drawingNote, distance, eventLine, hint, planeNote,
  pivotLine, side, strikeLine
} from '../../src/hidden-direction/copy.js';
import { homeCamera } from '../../src/hidden-direction/stage.js';

/**
 * The copy's truth rules, held over every sentence the experience can say.
 *
 * The census is exhaustive over the copy module's own inputs: every chapter's
 * title, setup and invitation; every hint for every chapter, every subset of
 * the visitor's marks and both states of the ball; every legend and note; and
 * every caption, reason, event, strike and clock line over all statuses,
 * frames, causes and a spread of signed gaps that includes the rounding edges.
 * A second census reads the sentences the controller actually composes from
 * the model along a scripted tour of all six chapters.
 *
 * Proved here: no sentence calls a body anything but rigid; none claims to
 * build intuition; ana and kata are the sides of the slice's normal, read from
 * the sign the model gives; nothing that is not at distance zero prints as
 * 0.00; slice, shadow and footprint are named apart; prescribed motion is
 * never called physics; the four ways a body can fail to appear are four
 * different sentences; and a hint never says something the model contradicts.
 *
 * Not proved here: whether a reader understands the sentences, or how the
 * page lays them out — those need a browser and a person.
 */

/* ------------------------------------------------------------------------ */
/* The census.                                                               */
/* ------------------------------------------------------------------------ */

/** Every mark the visitor can leave — the `Seen` type's members, written out. */
const MARKS = ['played', 'appeared', 'found', 'vanished', 'struck', 'turned', 'slid', 'shadow', 'frozen', 'studied', 'compared', 'faced'] as const;
type Mark = (typeof MARKS)[number];

/** Every model state a hint may read: ball drawn or not, clock running or not, orbit meeting the slice or not, and where the blow came from. */
const HINT_MODELS = [true, false].flatMap((ballInSlice) => [true, false].flatMap((playing) => [true, false].flatMap((orbitMeets) =>
  (['seen', 'hidden', null] as const).map((strike) => ({ ballInSlice, playing, orbitMeets, strike })))));

const STATUSES = ['present', 'tangent', 'outside'] as const;
const FRAMES = ['in', 'partial', 'out', null] as const;
const KINDS = ['appeared', 'vanished', 'touching', 'struck'] as const;
const CAUSES = ['orbit', 'physics', 'slice'] as const;
const NAMES = ['Ball', 'Box', 'Block'] as const;
/** Signed gaps, including both sides of the 0.005 rounding edge and values far below it. */
const NONZERO_GAPS = [
  1e-300, -1e-300, 1e-12, -1e-12, 1e-9, -1e-9, 0.001, -0.001, 0.004, -0.004, 0.0049999, -0.0049999,
  0.005, -0.005, 0.00500001, -0.00500001, 0.0051, -0.0051, 0.3, -0.3, 1.2345, -2.7
];
const GAPS = [0, ...NONZERO_GAPS];

function subsetsOf(marks: readonly Mark[]): Set<Mark>[] {
  const out: Set<Mark>[] = [];
  for (let bits = 0; bits < 1 << marks.length; bits++) {
    out.push(new Set(marks.filter((_, i) => (bits >> i) & 1)));
  }
  return out;
}

/** Every sentence the copy module can produce, from its own inputs. */
function copyCensus(): string[] {
  const out = new Set<string>();
  for (const c of CHAPTERS) { out.add(c.title); out.add(c.setup); out.add(c.invite); }
  for (const id of [...CHAPTERS.map((c) => c.id), 'elsewhere']) {
    for (const seen of subsetsOf(MARKS)) for (const model of HINT_MODELS) out.add(hint(id, seen, model));
  }
  out.add(GAUGE_LEGEND);
  out.add(SHADOW_LEGEND);
  out.add(PLANE_LEGEND);
  out.add(planeNote(true));
  out.add(planeNote(false));
  out.add(EMPTY_HEADLINE);
  for (const marker of ['touch', 'nearest', null] as const) for (const hollow of [true, false]) out.add(drawingNote(marker, hollow));
  for (const d of [0, 1e-13, 0.8, -0.8, 1e-6]) out.add(pivotLine(d));
  for (const kind of KINDS) for (const cause of CAUSES) for (const gap of GAPS) for (const name of NAMES) out.add(eventLine(kind, name, gap, cause));
  for (const gap of GAPS) out.add(strikeLine(gap));
  for (const name of NAMES) {
    for (const status of STATUSES) {
      for (const gap of GAPS) {
        for (const drawn of [0, 1]) {
          out.add(caption(name, status, gap, drawn));
          for (const frame of FRAMES) for (const reachable of [true, false]) out.add(absentReason(name, status, gap, frame, reachable, drawn));
        }
      }
    }
  }
  for (const [dt, substeps] of [[1 / 120, 2], [1 / 60, 4]] as const) {
    out.add(clockName('orbit', dt, substeps));
    out.add(clockName('study', dt, substeps));
    out.add(clockName('physics', dt, substeps));
  }
  return [...out];
}

type Experience = ReturnType<typeof createExperience>;

/** The sentences one view model carries, by where they appear. */
function viewSentences(x: Experience, out: Map<string, string>): void {
  const v = x.view(homeCamera(1.6));
  const put = (where: string, s: string | null | undefined): void => { if (s) out.set(s, where); };
  put('hint', v.hint);
  put('chapter.title', v.chapter.title);
  put('chapter.setup', v.chapter.setup);
  put('chapter.invite', v.chapter.invite);
  put('cut.pivot', v.cut.pivot);
  for (const b of v.bodies) { put('caption', b.caption); put('reason', b.reason); }
  if (v.empty) {
    put('empty.headline', v.empty.headline);
    for (const r of v.empty.reasons) put('empty.reason', r.line);
    for (const r of v.empty.recoveries) put('empty.recovery', r.label);
  }
  put('clock.name', v.clock.name);
  put('clock.readout', v.clock.readout);
  put('shadow.legend', v.shadow.legend);
  put('gauge', v.gauge);
  put('plane.legend', v.plane.legend);
  put('plane.note', v.plane.note);
  put('event', v.event);
  put('study.description', v.study?.description);
}

/** A scripted tour of all six chapters; returns every sentence the view models carried, with where it appeared. */
function tourCensus(): Map<string, string> {
  const out = new Map<string, string>();
  const x = createExperience('arrival');
  const look = (): void => viewSentences(x, out);
  look();
  x.dispatch({ type: 'play' });
  for (let k = 0; k < 130; k++) { x.dispatch({ type: 'tick', seconds: 0.1 }); if (k % 5 === 0) look(); }
  x.dispatch({ type: 'cut-offset', value: 0.5 }); look();
  x.dispatch({ type: 'cut-offset', value: -1.6 }); look();
  x.dispatch({ type: 'chapter', id: 'cuts' }); look();
  for (const d of [-90, -40, 20, 60, 90]) { x.dispatch({ type: 'cut-turn', degrees: d }); look(); }
  x.dispatch({ type: 'shadow', on: true }); look();
  x.dispatch({ type: 'focus-face', ordinal: 0 }); look();
  for (const id of ['collision', 'spin'] as const) {
    x.dispatch({ type: 'chapter', id }); look();
    x.dispatch({ type: 'play' });
    for (let k = 0; k < 14; k++) { x.dispatch({ type: 'tick', seconds: 0.1 }); look(); }
    x.dispatch({ type: 'freeze' }); look();
    x.dispatch({ type: 'cut-offset', value: 1.6 }); look();
    x.dispatch({ type: 'cut-turn', degrees: 60 }); look();
    x.dispatch({ type: 'replay' }); look();
  }
  x.dispatch({ type: 'chapter', id: 'turning' }); look();
  x.dispatch({ type: 'study-angle', degrees: 50 }); look();
  x.dispatch({ type: 'study-mode', mode: 'ordinary' }); look();
  x.dispatch({ type: 'chapter', id: 'free' }); look();
  x.dispatch({ type: 'world', world: 'turn' }); look();
  x.dispatch({ type: 'world', world: 'contact' }); look();
  x.dispatch({ type: 'cut-offset', value: 1.6 }); look();
  x.dispatch({ type: 'cut-reset' }); look();
  x.dispose();
  return out;
}

const COPY = copyCensus();
const TOUR = tourCensus();

/**
 * Words that would say a body itself changes: grows, shrinks, deforms,
 * stretches, squashes, morphs, or changes shape. Word-bounded, any inflection.
 */
const BODY_CHANGES = new RegExp(
  String.raw`\b(?:grow|grows|grown|growing|grew|shrink|shrinks|shrinking|shrank|shrunk|deform\w*|stretch\w*|squash\w*|morph\w*)\b`
  + String.raw`|\bchang(?:e|es|ed|ing)\s+(?:its\s+|their\s+)?shape\b|\bchange\s+of\s+shape\b|\bshape\s+chang\w*`,
  'i'
);
const INTUITION = /intuition|see in 4D|see four dimensions|visuali[sz]e 4D/i;

describe('the census is the whole copy', () => {
  it('covers every chapter, every model state and every mark subset, and reaches every hint branch', () => {
    // 7 chapter ids × 2^12 subsets × 24 model states; distinct sentences collapse far below that.
    const hints = new Set<string>();
    for (const id of [...CHAPTERS.map((c) => c.id), 'elsewhere']) {
      for (const seen of subsetsOf(MARKS)) for (const model of HINT_MODELS) hints.add(hint(id, seen, model));
    }
    // Counted by hand from copy.ts: arrival 7, cuts 4, collision 6, spin 4 (one of them, “Watch the box.”,
    // shared with collision), turning 3, default 1 — twenty-four distinct sentences.
    expect(hints.size).toBe(24);
    expect(CHAPTERS.map((c) => c.id)).toEqual(['arrival', 'cuts', 'collision', 'spin', 'turning', 'free']);
  });

  it('the tour reached every place the page shows a sentence', () => {
    const places = new Set(TOUR.values());
    for (const where of [
      'hint', 'chapter.title', 'chapter.setup', 'chapter.invite', 'cut.pivot', 'caption', 'reason', 'empty.headline',
      'empty.reason', 'empty.recovery', 'clock.name', 'clock.readout', 'shadow.legend', 'gauge', 'plane.legend',
      'plane.note', 'event', 'study.description'
    ]) expect(places.has(where), where).toBe(true);
  });
});

describe('the bodies are rigid in every sentence', () => {
  it('no sentence of the copy says a body grows, shrinks, deforms, stretches, squashes, morphs or changes shape', () => {
    // Not even in a negation: the copy says what changes is where the slice cuts.
    const offenders = COPY.filter((s) => BODY_CHANGES.test(s));
    expect(offenders).toEqual([]);
  });

  it('no sentence the controller composed along the tour says so either, outside the accepted study’s explicit denial', () => {
    // The study's description is the accepted module's own text. It uses the
    // words only to deny them of the body ("not because the object deforms")
    // and to say the SECTION changes; with those two phrases removed, nothing
    // of the kind remains anywhere.
    const allowed = [/not because the object deforms/g, /the section changes shape/g];
    const offenders: string[] = [];
    for (const [s, where] of TOUR) {
      let text = s;
      if (where === 'study.description') for (const a of allowed) text = text.replace(a, '');
      if (BODY_CHANGES.test(text)) offenders.push(`${where}: ${s}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the matcher itself catches every forbidden form', () => {
    for (const s of ['it grows', 'the ball shrank', 'it deforms', 'stretched', 'squashes', 'morphing', 'the box changes shape', 'its shape changes', 'a change of shape']) {
      expect(BODY_CHANGES.test(s), s).toBe(true);
    }
    for (const s of ['the slice changes width', 'its shape and its bounding faces never change', 'growth-free']) {
      expect(BODY_CHANGES.test(s), s).toBe(false);
    }
  });
});

describe('no claim to build four-dimensional intuition', () => {
  it('no sentence promises intuition or seeing in 4D', () => {
    expect(COPY.filter((s) => INTUITION.test(s))).toEqual([]);
    expect([...TOUR.keys()].filter((s) => INTUITION.test(s))).toEqual([]);
  });
});

describe('ana and kata are the sides of your slice’s normal', () => {
  it('a positive gap is ana and a negative gap is kata, however small', () => {
    for (const g of [1e-300, 1e-12, 0.004, 0.3, 2.7]) expect(side(g), `${g}`).toBe('ana');
    for (const g of [-1e-300, -1e-12, -0.004, -0.3, -2.7]) expect(side(g), `${g}`).toBe('kata');
  });

  it('the gauge legend defines ana as the side the normal points to, and kata as the other', () => {
    expect(GAUGE_LEGEND).toContain('Ana is the side your slice’s normal points to, kata the other.');
  });

  it('no single sentence makes ana or kata a direction in space', () => {
    for (const s of [...COPY, ...TOUR.keys()]) {
      for (const sentence of s.split(/(?<=\.)\s+/)) {
        if (/\b(ana|kata)\b/i.test(sentence)) expect(sentence, s).not.toMatch(/\b(up|down|above|below|upward|downward|higher|lower)\b/i);
      }
    }
  });

  it('an outside body is always captioned with a non-zero distance, on the side its own n·c says, across turns, slides and phases', () => {
    // The ball's side is recomputed here from the slice's normal and the ball's
    // centre: n·c − r above the offset is ana, n·c + r below it is kata.
    const x = createExperience('arrival');
    const ball = x.worlds.turn.products.find((p) => p.id === 'companion')!;
    let outsides = 0;
    let ballOutsides = 0;
    const sidesMet = new Set<string>();
    for (const phase of [0, 90, 180, 270]) {
      x.dispatch({ type: 'orbit-phase', degrees: phase });
      for (const turn of [-90, -45, -20, 0, 20, 45, 90]) {
        x.dispatch({ type: 'cut-turn', degrees: turn });
        for (const offset of [-1.6, -0.8, -0.2, 0, 0.2, 0.8, 1.6]) {
          x.dispatch({ type: 'cut-offset', value: offset });
          const n = Array.from(x.worlds.turn.slice.normal.data);
          const d = x.worlds.turn.slice.offset;
          const c = ball.position4()!;
          const h = n.reduce((s, v, i) => s + v * c[i]!, 0);
          for (const b of x.view().bodies) {
            if (b.status !== 'outside') continue;
            outsides++;
            expect(b.gap === 0, `${b.id} gap at ${phase}/${turn}/${offset}`).toBe(false);
            expect(b.caption).toMatch(/ — not in your slice: (under 0\.005|\d+\.\d\d) (ana|kata) of it$/);
            expect(b.caption).not.toMatch(/: 0(\.00)? /);
            if (b.id === 'companion') {
              ballOutsides++;
              const expected = h - 0.72 > d ? 'ana' : 'kata';
              sidesMet.add(expected);
              expect(h - 0.72 > d || h + 0.72 < d, 'independently outside').toBe(true);
              expect(b.caption.endsWith(`${expected} of it`), `${b.caption} at ${phase}/${turn}/${offset}`).toBe(true);
            }
          }
        }
      }
    }
    expect(outsides, 'the sweep met outside bodies').toBeGreaterThan(50);
    expect(ballOutsides, 'the sweep met the ball outside').toBeGreaterThan(30);
    expect([...sidesMet].sort(), 'on both sides').toEqual(['ana', 'kata']);
    x.dispose();
  });
});

describe('nothing present prints as 0.00', () => {
  it('a distance reads as its bound below 0.005, as two places above it, and as 0 only at zero', () => {
    expect(distance(0)).toBe('0');
    expect(distance(-0)).toBe('0');
    expect(distance(1e-300)).toBe('under 0.005');
    expect(distance(1e-12)).toBe('under 0.005');
    expect(distance(0.004)).toBe('under 0.005');
    expect(distance(0.0049999)).toBe('under 0.005');
    expect(distance(-0.004)).toBe('under 0.005');
    // 0.005 as a double is 0.005000000000000000104…, nearer 0.01 than 0.00.
    expect(distance(0.005)).toBe('0.01');
    expect(distance(-0.005)).toBe('0.01');
    expect(distance(0.006)).toBe('0.01');
    expect(distance(-0.25)).toBe('0.25');
    expect(distance(0.8)).toBe('0.80');
    expect(distance(2.7)).toBe('2.70');
  });

  it('no distance of a non-zero value prints 0.00 or 0, across a dense sweep of small values', () => {
    for (let e = -320; e <= -1; e += 0.25) {
      const v = 10 ** e;
      if (v === 0) continue;
      for (const s of [v, -v]) {
        expect(distance(s), `${s}`).not.toBe('0.00');
        expect(distance(s), `${s}`).not.toBe('0');
      }
    }
    for (let k = 0; k <= 1000; k++) {
      const v = 0.004 + k * 0.000002;
      expect(distance(v), `${v}`).not.toBe('0.00');
    }
  });

  it('no caption, reason, event or strike line for a non-zero gap contains 0.00', () => {
    // "0.00" as a printed number — not the bound "under 0.005", which contains those characters.
    const ZERO_PRINTED = /(?<![\d.])0\.00(?!\d)/;
    expect('under 0.005').not.toMatch(ZERO_PRINTED);
    expect('then 0.00 ana').toMatch(ZERO_PRINTED);
    for (const gap of NONZERO_GAPS) {
      for (const name of NAMES) {
        for (const status of STATUSES) {
          for (const drawn of [0, 1]) {
            expect(caption(name, status, gap, drawn)).not.toMatch(ZERO_PRINTED);
            for (const frame of FRAMES) for (const reachable of [true, false]) {
              expect(absentReason(name, status, gap, frame, reachable, drawn)).not.toMatch(ZERO_PRINTED);
            }
          }
        }
        for (const kind of KINDS) for (const cause of CAUSES) expect(eventLine(kind, name, gap, cause)).not.toMatch(ZERO_PRINTED);
      }
      expect(strikeLine(gap), `${gap}`).not.toMatch(ZERO_PRINTED);
      expect(pivotLine(gap), `${gap}`).not.toMatch(ZERO_PRINTED);
    }
  });

  it('a ball a millionth beyond the slice is captioned under 0.005, ana — not 0.00', () => {
    // At phase 0 the ball's centre is at w = 0.92, radius 0.72: its near side is w = 0.2.
    const x = createExperience('arrival');
    x.dispatch({ type: 'cut-offset', value: 0.2 - 1e-6 });
    const ball = x.view().bodies.find((b) => b.id === 'companion')!;
    expect(ball.status).toBe('outside');
    // A millionth is inside the section module's 0.02 graze band, so it draws the nearest point small;
    // the caption and the reason say what that marker is.
    expect(ball.caption).toBe('Ball — not in your slice: under 0.005 ana of it. '
      + 'The small marker is where your slice would first touch it — not a cut.');
    expect(ball.reason).toBe('Ball is not in your slice. All of it lies under 0.005 ana of your slice — still there, '
      + 'just elsewhere along the direction your slice cannot show. '
      + 'The small marker is where your slice would first touch it — not a cut.');
    x.dispose();
  });

  it('the pivot line says the slice passes through the centre only at zero, and gives the distance otherwise', () => {
    expect(pivotLine(0)).toBe('Your slice passes through the centre point, so turning pivots about it.');
    expect(pivotLine(0.8)).toBe('Your slice is 0.80 from the centre point, so turning now sweeps rather than pivots.');
    expect(pivotLine(-0.8)).toBe('Your slice is 0.80 from the centre point, so turning now sweeps rather than pivots.');
    expect(pivotLine(1e-6)).toBe('Your slice is under 0.005 from the centre point, so turning now sweeps rather than pivots.');
  });
});

describe('slice, shadow and footprint are named apart', () => {
  it('the shadow legend names the shadow and the slice separately, and denies that overlap is contact', () => {
    expect(SHADOW_LEGEND).toMatch(/\bshadow\b/);
    expect(SHADOW_LEGEND).toMatch(/\bslice\b/);
    expect(SHADOW_LEGEND).toContain('Overlapping shadows are not contact.');
    expect(SHADOW_LEGEND).toContain('all of it, flattened onto your view');
    expect(SHADOW_LEGEND).toContain('exactly the part your view crosses');
  });

  it('the plane legend calls the flattening a footprint, not its shadow', () => {
    expect(PLANE_LEGEND).toContain('its footprint, not its shadow');
    expect(planeNote(false)).toContain('Footprints, not shadows.');
  });
});

describe('prescribed motion is called prescribed; physics is called physics', () => {
  it('the orbit and the study clocks are prescribed and say they are not physics', () => {
    for (const kind of ['orbit', 'study'] as const) {
      const name = clockName(kind, 1 / 120, 2);
      expect(name).toContain('Prescribed');
      expect(name).toMatch(/no physics|not a physics/);
      expect(name).not.toMatch(/Physics clock/);
    }
  });

  it('the physics clock reads its step and substeps from its arguments', () => {
    const a = clockName('physics', 1 / 120, 2);
    expect(a).toContain('1/120');
    expect(a).toContain('2 substeps');
    const b = clockName('physics', 1 / 60, 4);
    expect(b).toContain('1/60');
    expect(b).toContain('4 substeps');
    expect(a).not.toContain('Prescribed');
  });

  it('each world in front names its own clock in the view', () => {
    const names: Record<ChapterId, string> = {
      arrival: 'Prescribed orbit — no physics',
      cuts: 'Prescribed orbit — no physics',
      collision: 'Physics clock — fixed steps of 1/120 s, 2 substeps each',
      spin: 'Physics clock — fixed steps of 1/120 s, 2 substeps each',
      turning: 'Prescribed turn — not a physics simulation',
      free: 'Prescribed orbit — no physics'
    };
    for (const c of CHAPTERS) {
      const x = createExperience(c.id);
      expect(x.view().clock.name, c.id).toBe(names[c.id]);
      x.dispose();
    }
  });

  it('an orbit event says prescribed orbit; a physics event does not', () => {
    expect(eventLine('appeared', 'Ball', 0, 'orbit')).toContain('prescribed orbit');
    expect(eventLine('vanished', 'Ball', 0.3, 'physics')).not.toMatch(/prescribed/i);
    expect(eventLine('vanished', 'Ball', 0.3, 'slice')).toContain('your slice moved');
  });
});

describe('the four ways a body can fail to appear are never merged', () => {
  it('present and drawn, present but drawn as nothing, touching, and outside are four different captions', () => {
    const four = [
      caption('Ball', 'present', 0, 1),
      caption('Ball', 'present', 0, 0),
      caption('Ball', 'tangent', 0, 0),
      caption('Ball', 'outside', 0.3, 0)
    ];
    expect(new Set(four).size).toBe(4);
    expect(four).toEqual([
      'Ball — in your slice',
      'Ball — in your slice, but the renderer drew nothing for it',
      'Ball — touching your slice, only along its boundary',
      'Ball — not in your slice: 0.30 ana of it'
    ]);
    expect(caption('Ball', 'outside', -0.3, 0)).toBe('Ball — not in your slice: 0.30 kata of it');
  });

  it('present, omitted, touching, outside and out of the camera are five different reasons', () => {
    const five = [
      absentReason('Ball', 'present', 0, 'in', true, 1),
      absentReason('Ball', 'present', 0, 'in', true, 0),
      absentReason('Ball', 'tangent', 0, null, true, 0),
      absentReason('Ball', 'outside', 0.3, null, true, 0),
      absentReason('Ball', 'present', 0, 'out', true, 1)
    ];
    expect(new Set(five).size).toBe(5);
  });

  it('the renderer omission never says “not in your slice”, and blames the picture, not the world', () => {
    for (const frame of FRAMES) for (const reachable of [true, false]) {
      const r = absentReason('Ball', 'present', 0, frame, reachable, 0);
      expect(r).not.toContain('not in your slice');
      expect(r).toContain('renderer');
      expect(r).toContain('not an absence in the world');
    }
    expect(caption('Ball', 'present', 0, 0)).not.toContain('not in your slice');
    expect(caption('Ball', 'present', 0, 0)).toContain('renderer');
  });

  it('the outside text names a side and a distance; it says when the slider cannot reach', () => {
    const r = absentReason('Ball', 'outside', -0.3, null, true, 0);
    expect(r).toContain('0.30 kata of your slice');
    expect(r).not.toContain('cannot slide that far');
    expect(absentReason('Ball', 'outside', 2.2, null, false, 0)).toContain('2.20 ana of your slice');
    expect(absentReason('Ball', 'outside', 2.2, null, false, 0)).toContain('Your slice cannot slide that far along this normal.');
  });

  it('the touching text names the boundary and the 10⁻⁹ tolerance', () => {
    const r = absentReason('Ball', 'tangent', 0, null, true, 0);
    expect(r).toContain('boundary');
    expect(r).toContain('10⁻⁹');
    expect(r).toContain('nothing is missing');
    expect(caption('Ball', 'tangent', 0, 0)).toContain('boundary');
  });

  it('a body drawn but outside the camera says so, and only then', () => {
    expect(absentReason('Box', 'present', 0, 'out', true, 4)).toBe('Box is in your slice, but outside the camera’s view.');
    for (const frame of ['in', 'partial', null] as const) {
      expect(absentReason('Box', 'present', 0, frame, true, 4)).not.toContain('outside the camera');
    }
  });
});

describe('every hint stays true however the chapter was reached', () => {
  it('a ball the orbit brought in is not credited to a slide that went nowhere', () => {
    // Nudge the slice up and back (offset exactly 0 again), then let the
    // prescribed orbit carry the ball in. The event line says the orbit moved
    // it; the hint must not say the visitor moved the slice to it.
    const x = createExperience('arrival');
    x.dispatch({ type: 'cut-nudge', delta: 0.02 });
    x.dispatch({ type: 'cut-nudge', delta: -0.02 });
    expect(x.worlds.turn.slice.offset).toBe(0);
    x.dispatch({ type: 'play' });
    for (let k = 0; k < 200 && x.view().bodies.find((b) => b.id === 'companion')!.drawn === 0; k++) {
      x.dispatch({ type: 'tick', seconds: 1 / 60 });
    }
    const v = x.view();
    expect(v.bodies.find((b) => b.id === 'companion')!.drawn).toBeGreaterThan(0);
    expect(v.event).toBe('Ball appeared — it moved along its prescribed orbit, and now your slice cuts it.');
    expect(v.hint).not.toMatch(/You moved your slice, not the ball/);
    x.dispose();
  });

  it('a slice turned to where the ball can never pass is not told the ball is about to cross it', () => {
    // At 90° the normal is along x; the ball's x is 3.6 at every phase, so
    // |n·c| − r = 3.6 − 0.72 = 2.88 > 1.6 ≥ |offset|: no orbit phase meets the slice.
    const x = createExperience('arrival');
    x.dispatch({ type: 'cut-turn', degrees: 90 });
    x.dispatch({ type: 'play' });
    const ball = x.worlds.turn.products.find((p) => p.id === 'companion')!;
    for (let k = 0; k < 120; k++) {
      x.dispatch({ type: 'tick', seconds: 0.1 });
      const n = Array.from(x.worlds.turn.slice.normal.data);
      const c = ball.position4()!;
      expect(Math.abs(n.reduce((s, v, i) => s + v * c[i]!, 0)) - 0.72).toBeGreaterThan(1.6);
    }
    expect(x.view().hint).not.toMatch(/about to cross your line/);
    x.dispose();
  });

  it('a blow struck with the ball in the slice is not said to come from beyond it', () => {
    // Slide the slice to w = 1.2: at the blow the ball's centre is near w = 1.5,
    // radius 0.5, so the ball is in the slice and the strike line says so.
    const x = createExperience('collision');
    x.dispatch({ type: 'cut-offset', value: 1.2 });
    x.dispatch({ type: 'shadow', on: true });
    x.dispatch({ type: 'play' });
    for (let k = 0; k < 40 && x.worlds.contact.sim.impacts === 0; k++) x.dispatch({ type: 'tick', seconds: 1 / 60 });
    const v = x.view();
    expect(v.event).toBe('The box was struck — by the ball, then in your slice.');
    expect(v.hint).not.toMatch(/beyond your slice/);
    x.dispose();
  });
});
