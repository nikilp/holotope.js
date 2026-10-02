import { VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import { CHAPTERS, createExperience, type Action, type ChapterId } from '../../src/hidden-direction/experience.js';

/**
 * A chapter establishes the state its setup sentence states — in full,
 * whatever came before — and retains nothing else.
 *
 * The oracle for "in full" is a FRESH experience created at that chapter: an
 * independent instance that has never been anywhere else. From four messy
 * prior states, each reached through `dispatch` — slices turned and slid in
 * both worlds, the shadow lifted, a body and a face singled out, every clock
 * running, the physics past its blow, the turning scene turned and playing,
 * the orbit advanced — entering a chapter must give:
 *
 * - the same `view(null)`, every field, bitwise (`toEqual` compares numbers by
 *   `Object.is`), with no event standing (`event` null, `eventId` 0);
 * - the same internals of the chapter's own world: the slice and the orbiting
 *   ball for the turning world, the slice and the whole physics state for the
 *   contact world, the angle, plane and clock of the turning scene; and the
 *   same scene-graph visibility for the page's three roots and shadows;
 * - the same continuation: the same actions taken next lead to the same state,
 *   so no hidden clock, accumulator or memory of what the visitor did survives.
 *
 * Then each chapter's setup sentence is read against the state it establishes,
 * with expectations written from the sentence and the authored scene — not
 * from a fresh experience. Chapter V ('turning') says the collision keeps its
 * state, and the free chapter says everything stays where you left it; both
 * are held to their word.
 *
 * What this does not prove: that the page paints the view it is given, or that
 * the chapter buttons dispatch these actions — the binding and browser checks.
 * The worlds a chapter does not name (the turning world when entering a
 * contact chapter, and vice versa) are not part of its stated state and are
 * not compared.
 */

type Experience = ReturnType<typeof createExperience>;

const tick: Action = { type: 'tick', seconds: 0.05 };
const ticks = (n: number): Action[] => Array.from({ length: n }, () => tick);
/** Leaves the physics accumulator holding most of a 1/120 s step, so a retained remainder would show. */
const partial: Action = { type: 'tick', seconds: 0.013 };

function run(x: Experience, actions: readonly Action[]): Experience {
  for (const a of actions) x.dispatch(a);
  return x;
}

/** Everything moving in every world, the turning world in front, in the free chapter. */
const MESS_TURN_FRONT: readonly Action[] = [
  { type: 'study-angle', degrees: 70 }, { type: 'study-mode', mode: 'ordinary' }, { type: 'study-play' }, ...ticks(2),
  { type: 'chapter', id: 'free' }, { type: 'world', world: 'contact' },
  { type: 'preset', id: 'off-centre' }, { type: 'jump-after' }, { type: 'step' }, { type: 'step' }, { type: 'step' },
  { type: 'cut-turn', degrees: -40 }, { type: 'cut-offset', value: -0.6 },
  { type: 'play' }, ...ticks(2), partial, { type: 'focus', body: 'box' },
  { type: 'world', world: 'turn' }, { type: 'play' }, ...ticks(4),
  { type: 'cut-turn', degrees: 25 }, { type: 'cut-offset', value: 0.4 },
  { type: 'focus-face', ordinal: 3 }, { type: 'focus', body: 'companion' }, { type: 'shadow', on: true }
];

interface Prior { readonly name: string; build(): Experience }

const PRIORS: readonly Prior[] = [
  {
    name: 'free, turning world in front, every clock running, both slices turned and slid',
    build: () => run(createExperience('turning'), MESS_TURN_FRONT)
  },
  {
    name: 'free, contact world in front past the blow, physics running, both slices turned and slid',
    build: () => run(createExperience('turning'), [
      ...MESS_TURN_FRONT, { type: 'world', world: 'contact' }, { type: 'focus', body: 'ball' }, ...ticks(2), partial
    ])
  },
  {
    name: 'inside the turning scene, turned in the ordinary plane and playing, both slices turned and slid',
    build: () => run(createExperience('turning'), [
      ...MESS_TURN_FRONT, { type: 'chapter', id: 'turning' },
      { type: 'study-angle', degrees: 200 }, { type: 'study-mode', mode: 'ordinary' }, { type: 'study-play' }, tick,
      { type: 'shadow', on: true }
    ])
  },
  {
    name: 'chapter IV mid-spin, slice turned and slid, after a turned and slid arrival',
    build: () => run(createExperience('arrival'), [
      { type: 'play' }, ...ticks(5), { type: 'cut-turn', degrees: -35 }, { type: 'cut-offset', value: -0.9 },
      { type: 'focus-face', ordinal: 6 }, { type: 'focus', body: 'block' },
      { type: 'chapter', id: 'spin' }, { type: 'jump-after' }, { type: 'step' }, { type: 'step' }, { type: 'step' },
      { type: 'cut-turn', degrees: 50 }, { type: 'cut-offset', value: 0.3 },
      { type: 'play' }, tick, partial, { type: 'shadow', on: true }, { type: 'focus', body: 'box' },
      { type: 'study-angle', degrees: 300 }, { type: 'study-play' }
    ])
  }
];

/* -------------------------------------------------------------------------- */
/* Snapshots, read from the worlds' own objects.                               */
/* -------------------------------------------------------------------------- */

const PROBES = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [0.3, -0.7, 0.2, 0.9]];

const sliceOf = (slice: { normal: { data: ArrayLike<number> }; offset: number }) =>
  ({ normal: Array.from(slice.normal.data), offset: slice.offset });

function physics(x: Experience) {
  const contact = x.worlds.contact;
  const sim = contact.sim;
  const pose = sim.boxPose();
  return {
    presetId: contact.presetId,
    steps: sim.steps,
    time: sim.time,
    impacts: sim.impacts,
    ballPosition: Array.from(sim.ball.position.data),
    ballVelocity: Array.from(sim.ball.linearVelocity.data),
    box: sim.state('box'),
    ball: sim.state('ball'),
    boxPose: PROBES.map((p) => Array.from(pose.applyToPoint(new VecN(p)).data)),
    lastImpact: sim.lastImpact
  };
}

const companion = (x: Experience) => x.worlds.turn.products.find((p) => p.id === 'companion')!.position4();

function study(x: Experience) {
  const s = x.worlds.contact.study;
  return { angle: s.angle, mode: s.mode, playing: s.playing, slice: sliceOf(s.slice) };
}

/** What the page's scene graph shows: the three roots, the three shadows, the face highlight. */
function visibility(x: Experience) {
  return {
    roots: x.roots.map((r) => r.visible),
    turnShadow: x.worlds.turn.context.object.visible,
    contactShadow: x.worlds.contact.views.context.object.visible,
    studyShadow: x.worlds.contact.study.views.context.visible,
    face: { visible: x.faceShadow.object.visible, edges: x.faceShadow.sourceEdges() }
  };
}

/** The internals of a chapter's own world. */
function internals(x: Experience, id: ChapterId) {
  const world = CHAPTERS.find((c) => c.id === id)!.world;
  if (id === 'turning') return { study: study(x), visibility: visibility(x) };
  if (world === 'turn') return { slice: sliceOf(x.worlds.turn.slice), companion: companion(x), visibility: visibility(x) };
  return { slice: sliceOf(x.worlds.contact.slice), physics: physics(x), visibility: visibility(x) };
}

/** Next steps for each chapter: its clock run, its slice moved, its shadow lifted. */
const CONTINUATION: Readonly<Record<Exclude<ChapterId, 'free'>, readonly Action[]>> = {
  arrival: [{ type: 'play' }, ...ticks(6), partial, { type: 'cut-turn', degrees: 20 }, ...ticks(3), { type: 'shadow', on: true }],
  cuts: [{ type: 'cut-turn-nudge', delta: 10 }, { type: 'focus-face', ordinal: 1 }, { type: 'play' }, ...ticks(4)],
  collision: [{ type: 'play' }, partial, ...ticks(14), { type: 'cut-turn', degrees: 30 }, ...ticks(2)],
  spin: [{ type: 'play' }, partial, ...ticks(16), { type: 'freeze' }],
  turning: [{ type: 'play' }, ...ticks(3), { type: 'study-mode', mode: 'ordinary' }, partial]
};

/** The parts of the view a continuation must reproduce: everything but the event's serial number, which counts on. */
function continued(x: Experience, id: ChapterId) {
  const { eventId: _serial, ...rest } = x.view(null);
  return { view: rest, internals: internals(x, id) };
}

const GUIDED = CHAPTERS.filter((c) => c.id !== 'free');

/* -------------------------------------------------------------------------- */
/* Entering a chapter equals arriving at it fresh.                             */
/* -------------------------------------------------------------------------- */

describe('entering a chapter from anywhere gives exactly the fresh chapter', () => {
  for (const chapter of GUIDED) {
    describe(`${chapter.numeral}. ${chapter.title}`, () => {
      for (const prior of PRIORS) {
        it(`the view equals a fresh one, from ${prior.name}`, () => {
          const x = prior.build();
          x.dispatch({ type: 'chapter', id: chapter.id });
          const fresh = createExperience(chapter.id);
          const v = x.view(null);
          expect(v).toEqual(fresh.view(null));
          expect([v.event, v.eventId], 'no event stands on arrival').toEqual([null, 0]);
        });

        if (chapter.id === 'turning') {
          it(`apart from the cut readouts, the view equals a fresh one, from ${prior.name}`, () => {
            // Separates the cut readouts, held whole in the test above and in the
            // setup-sentence test below, from everything else the scene shows.
            const x = prior.build();
            x.dispatch({ type: 'chapter', id: chapter.id });
            const { cut: _cut, ...rest } = x.view(null);
            const { cut: _freshCut, ...fresh } = createExperience(chapter.id).view(null);
            expect(rest).toEqual(fresh);
          });
        }

        it(`the chapter's world equals a fresh one, from ${prior.name}`, () => {
          const x = prior.build();
          x.dispatch({ type: 'chapter', id: chapter.id });
          expect(internals(x, chapter.id)).toEqual(internals(createExperience(chapter.id), chapter.id));
        });

        it(`what follows equals what follows a fresh one, from ${prior.name}`, () => {
          const x = prior.build();
          x.dispatch({ type: 'chapter', id: chapter.id });
          const fresh = createExperience(chapter.id);
          const next = CONTINUATION[chapter.id as Exclude<ChapterId, 'free'>];
          run(x, next);
          run(fresh, next);
          const a = continued(x, chapter.id);
          const b = continued(fresh, chapter.id);
          // Only the chapter's own world is compared: the other world keeps what it had.
          if (chapter.id === 'turning') {
            // The page's cut readouts are compared on arrival above; here the clocks and the scene.
            const pick = (c: typeof a) => ({ clock: c.view.clock, study: c.view.study, hint: c.view.hint, event: c.view.event, internals: c.internals });
            expect(pick(a)).toEqual(pick(b));
          } else {
            expect(a).toEqual(b);
          }
        });
      }
    });
  }

  it('the priors are messy: both slices off the reference, a clock running, the physics past its blow', () => {
    // Guards against a prior that collapsed to a clean state, which would make the comparisons above vacuous.
    for (const prior of PRIORS) {
      const x = prior.build();
      expect(x.worlds.turn.slice.offset, prior.name).not.toBe(0);
      expect(x.worlds.turn.slice.normal.data[0], prior.name).not.toBe(0);
      expect(x.worlds.contact.slice.offset, prior.name).not.toBe(0);
      expect(x.worlds.contact.slice.normal.data[0], prior.name).not.toBe(0);
      expect(x.worlds.contact.sim.impacts, prior.name).toBeGreaterThan(0);
      expect(x.worlds.contact.study.angle, prior.name).toBeGreaterThan(0);
      expect(x.view(null).shadow.on, prior.name).toBe(true);
      expect(x.view(null).clock.playing, prior.name).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The retained-offset regression, said directly.                             */
/* -------------------------------------------------------------------------- */

describe('a guided chapter never inherits a slid slice', () => {
  const zero = (x: Experience, world: 'turn' | 'contact') => {
    const v = x.view(null);
    expect(v.cut.offset, 'the readout offset').toBe(0);
    expect(v.cut.degrees, 'the readout angle').toBe(0);
    expect(x.worlds[world].slice.offset, 'the slice itself').toBe(0);
    expect(Array.from(x.worlds[world].slice.normal.data), 'the slice normal is +w').toEqual([0, 0, 0, 1]);
  };

  it('turned and slid in chapter I, then chapter II: offset 0, angle 0', () => {
    const x = run(createExperience('arrival'), [{ type: 'cut-turn', degrees: 30 }, { type: 'cut-offset', value: 0.7 }]);
    x.dispatch({ type: 'chapter', id: 'cuts' });
    zero(x, 'turn');
  });

  it('turned and slid in chapter II, then chapter I: offset 0, angle 0', () => {
    const x = run(createExperience('cuts'), [{ type: 'cut-turn-nudge', delta: -50 }, { type: 'cut-nudge', delta: -1.3 }]);
    x.dispatch({ type: 'chapter', id: 'arrival' });
    zero(x, 'turn');
  });

  it('turned and slid in chapter III, then chapter IV: offset 0, angle 0', () => {
    const x = run(createExperience('collision'), [{ type: 'cut-turn', degrees: -20 }, { type: 'cut-offset', value: 0.9 }]);
    x.dispatch({ type: 'chapter', id: 'spin' });
    zero(x, 'contact');
  });

  it('turned and slid in chapter IV, then chapter III: offset 0, angle 0', () => {
    const x = run(createExperience('spin'), [{ type: 'cut-turn', degrees: 70 }, { type: 'cut-offset', value: -1.6 }]);
    x.dispatch({ type: 'chapter', id: 'collision' });
    zero(x, 'contact');
  });

  it('slid in the free chapter in the contact world, then chapter III from the turning world: offset 0, angle 0', () => {
    const x = run(createExperience('free'), [
      { type: 'world', world: 'contact' }, { type: 'cut-turn', degrees: 15 }, { type: 'cut-offset', value: 1.1 },
      { type: 'world', world: 'turn' }
    ]);
    x.dispatch({ type: 'chapter', id: 'collision' });
    zero(x, 'contact');
  });
});

/* -------------------------------------------------------------------------- */
/* Each setup sentence, read against the state it establishes.                 */
/* -------------------------------------------------------------------------- */

const setupOf = (id: ChapterId): string => CHAPTERS.find((c) => c.id === id)!.setup;
const messy = (): Experience => PRIORS[1]!.build();

describe('each setup sentence is true of the state its chapter establishes', () => {
  for (const id of ['arrival', 'cuts'] as const) {
    it(`${id}: "${setupOf(id)}"`, () => {
      expect(setupOf(id)).toContain('Slice untilted, through the centre point.');
      expect(setupOf(id)).toContain('orbit at its start, paused');
      const x = messy();
      x.dispatch({ type: 'chapter', id });
      const v = x.view(null);
      // Untilted: the reference normal +w; through the centre point: offset 0, and the note says it pivots.
      expect([v.cut.degrees, v.cut.offset]).toEqual([0, 0]);
      expect(v.cut.normal).toEqual([0, 0, 0, 1]);
      expect(v.cut.pivot).toContain('passes through the centre point');
      // The orbit at its start: the ball at its authored rest position (3.6, 1.05, 0, 0.92).
      expect(companion(x)).toEqual([3.6, 1.05, 0, 0.92]);
      // Paused: the clock says so, and a tick moves nothing.
      expect([v.world, v.clock.kind, v.clock.playing]).toEqual(['turn', 'orbit', false]);
      x.dispatch(tick);
      expect(companion(x)).toEqual([3.6, 1.05, 0, 0.92]);
    });
  }

  it(`collision: "${setupOf('collision')}"`, () => {
    expect(setupOf('collision')).toContain('Launch A, physics clock at 0, paused.');
    const x = messy();
    x.dispatch({ type: 'chapter', id: 'collision' });
    const v = x.view(null);
    expect([v.cut.degrees, v.cut.offset]).toEqual([0, 0]);
    expect(v.cut.normal).toEqual([0, 0, 0, 1]);
    expect(v.cut.pivot).toContain('passes through the centre point');
    // Launch A: the ball straight down w from (0, 0, 0, 2.7) at speed 2; the box at the origin, at rest.
    expect(v.preset?.id).toBe('central');
    const sim = x.worlds.contact.sim;
    expect([sim.steps, sim.time, sim.impacts]).toEqual([0, 0, 0]);
    expect(sim.state('ball').position).toEqual([0, 0, 0, 2.7]);
    expect(sim.state('ball').velocity).toEqual([0, 0, 0, -2]);
    expect(sim.state('box').position).toEqual([0, 0, 0, 0]);
    expect(sim.state('box').velocity).toEqual([0, 0, 0, 0]);
    expect([v.world, v.clock.kind, v.clock.playing]).toEqual(['contact', 'physics', false]);
    x.dispatch(tick);
    expect(x.worlds.contact.sim.steps, 'paused: a tick takes no step').toBe(0);
  });

  it(`spin: "${setupOf('spin')}"`, () => {
    expect(setupOf('spin')).toContain('Launch B — the same drop, 0.8 to the side — clock at 0, paused.');
    const x = messy();
    x.dispatch({ type: 'chapter', id: 'spin' });
    const v = x.view(null);
    expect([v.cut.degrees, v.cut.offset]).toEqual([0, 0]);
    expect(v.cut.normal).toEqual([0, 0, 0, 1]);
    expect(v.preset?.id).toBe('off-centre');
    const sim = x.worlds.contact.sim;
    expect([sim.steps, sim.time, sim.impacts]).toEqual([0, 0, 0]);
    // The same drop as Launch A — (0, 0, 0, 2.7) at −2 along w — moved 0.8 along x.
    expect(sim.state('ball').position).toEqual([0.8, 0, 0, 2.7]);
    expect(sim.state('ball').velocity).toEqual([0, 0, 0, -2]);
    expect(sim.state('box').velocity).toEqual([0, 0, 0, 0]);
    expect([v.world, v.clock.kind, v.clock.playing]).toEqual(['contact', 'physics', false]);
    x.dispatch(tick);
    expect(x.worlds.contact.sim.steps, 'paused: a tick takes no step').toBe(0);
  });

  it(`turning: "${setupOf('turning')}" — a separate scene, through the fourth direction, starting at 0°`, () => {
    expect(setupOf('turning')).toContain('through the fourth direction, starting at 0°');
    const x = messy();
    x.dispatch({ type: 'chapter', id: 'turning' });
    const v = x.view(null);
    expect(v.studyOpen).toBe(true);
    expect(v.bodies, 'the collision is not in front').toEqual([]);
    const s = x.worlds.contact.study;
    expect([s.angle, s.mode, s.playing]).toEqual([0, 'fourth', false]);
    expect(v.study?.mode).toBe('fourth');
    expect(v.study?.degrees).toBe(0);
    expect(v.clock.kind).toBe('study');
  });

  it('turning: "The slice is fixed at w = 0" — the study slice and the map are the reference cut, and cannot be moved', () => {
    expect(setupOf('turning')).toContain('The slice is fixed at w = 0.');
    const x = messy();
    x.dispatch({ type: 'chapter', id: 'turning' });
    const v = x.view(null);
    expect(sliceOf(x.worlds.contact.study.slice)).toEqual({ normal: [0, 0, 0, 1], offset: 0 });
    expect(v.plane.line).toEqual({ n: [0, 1], offset: 0 });
    expect(v.plane.movable).toBe(false);
  });

  it('turning: "The slice is fixed at w = 0" — the cut readouts the page prints describe that slice', () => {
    // view().cut feeds the pivot note and the slice-normal and offset numbers,
    // which the page prints in every scene, the turning scene included.
    const x = messy();
    x.dispatch({ type: 'chapter', id: 'turning' });
    const v = x.view(null);
    expect(v.cut.normal).toEqual([0, 0, 0, 1]);
    expect([v.cut.degrees, v.cut.offset]).toEqual([0, 0]);
    expect(v.cut.pivot).toContain('passes through the centre point');
  });

  it('turning: "The collision keeps its state, untouched" — on entry, and while the scene turns', () => {
    expect(setupOf('turning')).toContain('The collision keeps its state, untouched.');
    // While the scene is in front, the clock keys still reach the controller —
    // space plays and pauses, '.' and ',' step — so they are taken here too.
    const inScene: Action[] = [
      { type: 'play' }, ...ticks(4), { type: 'step' }, { type: 'step-back' },
      { type: 'study-angle', degrees: 45 }, { type: 'study-mode', mode: 'ordinary' }, ...ticks(2), { type: 'pause' }, { type: 'step' }
    ];
    for (const prior of PRIORS) {
      const x = prior.build();
      const sim = x.worlds.contact.sim;
      const before = physics(x);
      x.dispatch({ type: 'chapter', id: 'turning' });
      expect(x.worlds.contact.sim, `${prior.name}: the same simulation`).toBe(sim);
      expect(physics(x), `${prior.name}: on entry`).toEqual(before);
      run(x, inScene);
      expect(x.worlds.contact.sim, `${prior.name}: still the same simulation`).toBe(sim);
      expect(physics(x), `${prior.name}: while the scene turns`).toEqual(before);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The free chapter keeps everything.                                          */
/* -------------------------------------------------------------------------- */

describe('free: "Everything stays where you left it"', () => {
  it('the setup sentence says so', () => {
    expect(setupOf('free')).toContain('Everything stays where you left it');
  });

  for (const prior of PRIORS) {
    it(`keeps the scene in front, both slices and the shadow, from ${prior.name}`, () => {
      const x = prior.build();
      const v0 = x.view(null);
      const slices = () => ({
        turn: sliceOf(x.worlds.turn.slice), contact: sliceOf(x.worlds.contact.slice), study: sliceOf(x.worlds.contact.study.slice)
      });
      const before = { world: v0.world, studyOpen: v0.studyOpen, slices: slices(), shadow: v0.shadow.on, cut: v0.cut };
      x.dispatch({ type: 'chapter', id: 'free' });
      const v = x.view(null);
      expect({ world: v.world, studyOpen: v.studyOpen, slices: slices(), shadow: v.shadow.on, cut: v.cut }).toEqual(before);
    });

    it(`keeps the focused body and the followed face, from ${prior.name}`, () => {
      const x = prior.build();
      const v0 = x.view(null);
      const before = { focus: v0.bodies.map((b) => [b.id, b.focused]), face: v0.face, edges: x.faceShadow.sourceEdges().length };
      x.dispatch({ type: 'chapter', id: 'free' });
      const v = x.view(null);
      expect({ focus: v.bodies.map((b) => [b.id, b.focused]), face: v.face, edges: x.faceShadow.sourceEdges().length }).toEqual(before);
    });

    it(`keeps the physics, the orbit and the turning scene, and their clocks run on, from ${prior.name}`, () => {
      const x = prior.build();
      const twin = prior.build();
      const before = { physics: physics(x), companion: companion(x), study: study(x), playing: x.view(null).clock.playing };
      x.dispatch({ type: 'chapter', id: 'free' });
      expect({ physics: physics(x), companion: companion(x), study: study(x), playing: x.view(null).clock.playing }).toEqual(before);
      const later: Action[] = [{ type: 'tick', seconds: 0.003 }, { type: 'tick', seconds: 0.003 }, ...ticks(3)];
      run(x, later);
      run(twin, later);
      expect({ physics: physics(x), companion: companion(x), study: study(x) })
        .toEqual({ physics: physics(twin), companion: companion(twin), study: study(twin) });
    });
  }
});
