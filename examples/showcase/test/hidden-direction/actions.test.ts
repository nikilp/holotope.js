import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import { createExperience, kindOf, type Action, type ActionKind } from '../../src/hidden-direction/experience.js';
import { stripComments } from '../spatial-4d-contact/source-pins.js';

/**
 * The four kinds of action are kept apart, from every kind of starting point.
 *
 * The controller sorts each action into a kind — view, time, study, chapter —
 * and the kind is a promise about what the action may touch:
 *
 * - view  ⇒ the physics simulation, the prescribed orbit and the prescribed
 *   turn's state are bitwise unchanged; the observer alone moves.
 * - time  ⇒ both worlds' slices, the shadow, the focus and the face are
 *   bitwise unchanged; a clock alone moves.
 * - study ⇒ the physics, the orbit, both slices, the shadow and the focus are
 *   bitwise unchanged; the separate turning scene alone moves.
 *
 * Each claim is checked through `dispatch`, the one entry point the page
 * drives, for one or more instances of every action variant, from seven prior
 * states that are themselves reached through `dispatch`: a fresh arrival, the
 * turning world mid-orbit with a turned and slid slice, the collision after
 * its first touch, the spin after its blow, the turning scene mid-turn, and the
 * free chapter in each world. State is read from the worlds' own objects —
 * the simulation's bodies and box pose, the orbiting product's 4D position,
 * the study's angle, the slices' normals and offsets — and compared with
 * `toEqual`, which treats numbers by `Object.is`: bitwise, signed zero
 * included.
 *
 * The kinds themselves are held against a literal table written here, not
 * read from `kindOf`, and the catalogue is held to cover every variant of the
 * `Action` union, read from the source because types are erased at run time.
 *
 * What this does not prove: anything about the DOM. Whether the page's
 * controls dispatch the actions their binding table names is the binding
 * tests' business, and whether the picture follows the model is the browser's.
 * Chapter actions are catalogued and kinded here; what they establish is
 * `chapters.test.ts`.
 */

type Experience = ReturnType<typeof createExperience>;

/* -------------------------------------------------------------------------- */
/* The catalogue: every variant, with the arguments that matter.               */
/* -------------------------------------------------------------------------- */

const CATALOGUE: readonly Action[] = [
  { type: 'chapter', id: 'arrival' },
  { type: 'chapter', id: 'cuts' },
  { type: 'chapter', id: 'collision' },
  { type: 'chapter', id: 'spin' },
  { type: 'chapter', id: 'turning' },
  { type: 'chapter', id: 'free' },
  { type: 'world', world: 'turn' },
  { type: 'world', world: 'contact' },
  { type: 'cut-offset', value: 0.8 },
  { type: 'cut-offset', value: -1.1 },
  { type: 'cut-nudge', delta: 0.2 },
  { type: 'cut-turn', degrees: 35 },
  { type: 'cut-turn-nudge', delta: -10 },
  { type: 'cut-reset' },
  { type: 'cut-to', body: 'block' },
  { type: 'cut-to', body: 'companion' },
  { type: 'cut-to', body: 'box' },
  { type: 'cut-to', body: 'ball' },
  { type: 'shadow', on: true },
  { type: 'shadow', on: false },
  { type: 'focus', body: 'ball' },
  { type: 'focus', body: null },
  { type: 'focus-face', ordinal: 5 },
  { type: 'focus-face', ordinal: null },
  { type: 'freeze' },
  { type: 'play' },
  { type: 'pause' },
  { type: 'step' },
  { type: 'step-back' },
  { type: 'jump-touch' },
  { type: 'jump-after' },
  { type: 'replay' },
  { type: 'preset', id: 'central' },
  { type: 'preset', id: 'off-centre' },
  { type: 'orbit-phase', degrees: 140 },
  { type: 'tick', seconds: 0.05 },
  { type: 'study-mode', mode: 'ordinary' },
  { type: 'study-mode', mode: 'fourth' },
  { type: 'study-angle', degrees: 120 },
  { type: 'study-play' },
  { type: 'study-pause' }
];

/** Every variant of the `Action` union, written out. */
const ACTION_TYPES = [
  'chapter', 'world',
  'cut-offset', 'cut-nudge', 'cut-turn', 'cut-turn-nudge', 'cut-reset', 'cut-to',
  'shadow', 'focus', 'focus-face', 'freeze',
  'play', 'pause', 'step', 'step-back', 'jump-touch', 'jump-after', 'replay', 'preset', 'orbit-phase', 'tick',
  'study-mode', 'study-angle', 'study-play', 'study-pause'
] as const;

/**
 * The kind of each variant, as the design states it. Typed over the union, so
 * a variant added to `Action` without a row here fails the typecheck.
 * `world` is chapter-kind: it changes which scene is in front, which is the
 * chapter's business, and moves neither a clock nor a slice (held below).
 * `freeze` is view-kind: it stops the clocks where they stand and lifts the
 * shadow, and moves no state (held below).
 */
const KIND: Record<Action['type'], ActionKind> = {
  chapter: 'chapter', world: 'chapter',
  'cut-offset': 'view', 'cut-nudge': 'view', 'cut-turn': 'view', 'cut-turn-nudge': 'view', 'cut-reset': 'view',
  'cut-to': 'view', shadow: 'view', focus: 'view', 'focus-face': 'view', freeze: 'view',
  play: 'time', pause: 'time', step: 'time', 'step-back': 'time', 'jump-touch': 'time', 'jump-after': 'time',
  replay: 'time', preset: 'time', 'orbit-phase': 'time', tick: 'time',
  'study-mode': 'study', 'study-angle': 'study', 'study-play': 'study', 'study-pause': 'study'
};

const label = (a: Action): string => {
  const { type, ...rest } = a as Action & Record<string, unknown>;
  const args = Object.values(rest).map((v) => String(v)).join(' ');
  return args ? `${type} ${args}` : type;
};

/* -------------------------------------------------------------------------- */
/* Prior states, each reached through dispatch.                                */
/* -------------------------------------------------------------------------- */

const tick: Action = { type: 'tick', seconds: 0.05 };
const ticks = (n: number): Action[] => Array.from({ length: n }, () => tick);
/**
 * A tick that leaves the physics accumulator holding most of a step: after
 * whole steps are taken, 0.013 s leaves about 0.0047 s of the 1/120 s step.
 * A prior that ends on it makes the accumulator's remainder observable.
 */
const partial: Action = { type: 'tick', seconds: 0.013 };
/**
 * The twin runs' ticks. The first two are shorter than a step, so whether a
 * step lands depends on the remainder the prior left: about 0.0047 + 0.006
 * crosses 1/120 s, 0.006 alone does not.
 */
const TWIN_TICKS: readonly Action[] = [
  { type: 'tick', seconds: 0.003 }, { type: 'tick', seconds: 0.003 }, { type: 'tick', seconds: 0.05 }
];

function reach(start: Parameters<typeof createExperience>[0], actions: readonly Action[]): Experience {
  const x = createExperience(start);
  for (const a of actions) x.dispatch(a);
  return x;
}

interface Prior { readonly name: string; build(): Experience }

const PRIORS: readonly Prior[] = [
  { name: 'a fresh arrival', build: () => createExperience('arrival') },
  {
    name: 'the turning world mid-orbit and playing, slice at 25° and 0.4, shadow, focus and face on',
    build: () => reach('arrival', [
      { type: 'play' }, ...ticks(7),
      { type: 'cut-turn', degrees: 25 }, { type: 'cut-offset', value: 0.4 },
      { type: 'shadow', on: true }, { type: 'focus', body: 'block' }, { type: 'focus-face', ordinal: 2 }
    ])
  },
  {
    name: 'the collision after its first touch and three steps, playing, slice turned',
    build: () => reach('collision', [
      { type: 'jump-touch' }, { type: 'step' }, { type: 'step' }, { type: 'step' },
      { type: 'cut-turn', degrees: -30 }, { type: 'cut-offset', value: -0.3 },
      { type: 'focus', body: 'box' }, { type: 'play' }, tick, partial
    ])
  },
  {
    name: 'the spin after its blow, playing, slice turned, shadow on',
    build: () => reach('spin', [
      { type: 'jump-after' }, { type: 'step' }, { type: 'step' }, { type: 'step' }, { type: 'step' },
      { type: 'cut-turn', degrees: 40 }, { type: 'shadow', on: true }, { type: 'focus', body: 'ball' },
      { type: 'play' }, ...ticks(2), partial
    ])
  },
  {
    name: 'the turning scene at 70° and playing',
    build: () => reach('turning', [{ type: 'study-angle', degrees: 70 }, { type: 'study-play' }, tick, { type: 'shadow', on: true }])
  },
  {
    name: 'free exploration in the turning world, orbit playing, slice turned and slid',
    build: () => reach('arrival', [
      { type: 'play' }, ...ticks(3), { type: 'chapter', id: 'free' }, { type: 'play' }, tick,
      { type: 'cut-turn', degrees: -15 }, { type: 'cut-offset', value: 1.2 }, { type: 'focus', body: 'companion' }
    ])
  },
  {
    name: 'free exploration in the contact world, physics playing past the blow, slice turned',
    build: () => reach('collision', [
      { type: 'chapter', id: 'free' }, { type: 'jump-after' }, { type: 'play' }, ...ticks(2), partial,
      { type: 'cut-turn', degrees: 60 }, { type: 'cut-offset', value: 0.5 }, { type: 'focus', body: 'ball' },
      { type: 'shadow', on: true }
    ])
  }
];

/* -------------------------------------------------------------------------- */
/* Snapshots, read from the worlds' own objects.                               */
/* -------------------------------------------------------------------------- */

/** Points carried through the box's world pose: its four axes and one point in general position. */
const PROBES = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [0.3, -0.7, 0.2, 0.9]];

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

function orbit(x: Experience) {
  const companion = x.worlds.turn.products.find((p) => p.id === 'companion')!;
  return { companion: companion.position4() };
}

function study(x: Experience) {
  const s = x.worlds.contact.study;
  return { angle: s.angle, mode: s.mode, playing: s.playing, rate: s.rate };
}

function sliceOf(slice: { normal: { data: ArrayLike<number> }; offset: number }) {
  return { normal: Array.from(slice.normal.data), offset: slice.offset };
}

function slices(x: Experience) {
  return {
    turn: sliceOf(x.worlds.turn.slice),
    contact: sliceOf(x.worlds.contact.slice),
    study: sliceOf(x.worlds.contact.study.slice)
  };
}

function observer(x: Experience) {
  const v = x.view(null);
  return {
    slices: slices(x),
    shadow: v.shadow.on,
    focus: v.bodies.map((b) => [b.id, b.focused]),
    face: v.face
  };
}

/* -------------------------------------------------------------------------- */
/* The catalogue is complete, and the kinds are the stated ones.               */
/* -------------------------------------------------------------------------- */

describe('the catalogue covers every action, and every action has its stated kind', () => {
  it('every variant of the Action union appears in the catalogue', () => {
    expect([...new Set(CATALOGUE.map((a) => a.type))].sort()).toEqual([...ACTION_TYPES].sort());
  });

  it('the written list of variants is the union in experience.ts, read from its source', () => {
    // A source read, labelled as such: the union is a type, erased at run time,
    // and kindOf sends any type it does not name to 'time' by default — so a new
    // variant would otherwise arrive silently, kinded and untested.
    const source = stripComments(readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'hidden-direction', 'experience.ts'), 'utf8'));
    const start = source.indexOf('export type Action =');
    expect(start, 'the Action union is declared').toBeGreaterThanOrEqual(0);
    const union = source.slice(start, source.indexOf(';', source.lastIndexOf("type: 'tick'")) + 1);
    const declared = [...union.matchAll(/type:\s*'([^']+)'/g)].map((m) => m[1]!);
    expect(declared.sort()).toEqual([...ACTION_TYPES].sort());
  });

  for (const a of CATALOGUE) {
    it(`${label(a)} is a ${KIND[a.type]} action`, () => {
      expect(kindOf(a)).toBe(KIND[a.type]);
    });
  }
});

/* -------------------------------------------------------------------------- */
/* The kind boundaries, from every prior state.                                */
/* -------------------------------------------------------------------------- */

const ofKind = (kind: ActionKind): readonly Action[] => CATALOGUE.filter((a) => KIND[a.type] === kind);

describe('a view action moves the observer only: physics, orbit and the turning scene are bitwise unchanged', () => {
  for (const prior of PRIORS) {
    for (const a of ofKind('view')) {
      it(`${label(a)}, from ${prior.name}`, () => {
        const x = prior.build();
        const simBefore = x.worlds.contact.sim;
        const before = { physics: physics(x), orbit: orbit(x), study: study(x), clock: x.view(null).clock.playing };
        x.dispatch(a);
        expect(x.worlds.contact.sim, 'the simulation is the same object, never replaced').toBe(simBefore);
        expect(physics(x), 'physics').toEqual(before.physics);
        expect(orbit(x), 'orbit').toEqual(before.orbit);
        const s = study(x);
        expect({ angle: s.angle, mode: s.mode, rate: s.rate }, 'turning scene').toEqual(
          { angle: before.study.angle, mode: before.study.mode, rate: before.study.rate });
        if (a.type !== 'freeze') {
          // Freeze is the one view action that touches a clock: it stops them all (held below).
          expect(s.playing, 'the turning scene runs or rests as before').toBe(before.study.playing);
          expect(x.view(null).clock.playing, 'the clock in front runs or rests as before').toBe(before.clock);
        }
      });
    }
  }
});

describe('a view action leaves the clocks running as they were: the next ticks advance exactly as without it', () => {
  // Twin runs from the same prior: one takes the view action, both then take the
  // same ticks. Any view action that stopped, started or re-phased a clock — the
  // orbit, the physics accumulator, the turning scene — would part them. The
  // physics priors end on a partial tick, so even a cleared accumulator shows.
  const runningPriors = PRIORS.filter((p) => p.name !== 'a fresh arrival');
  for (const prior of runningPriors) {
    for (const a of ofKind('view').filter((v) => v.type !== 'freeze')) {
      it(`${label(a)}, from ${prior.name}`, () => {
        const viewed = prior.build();
        const bare = prior.build();
        viewed.dispatch(a);
        for (const t of TWIN_TICKS) { viewed.dispatch(t); bare.dispatch(t); }
        expect(physics(viewed), 'physics').toEqual(physics(bare));
        expect(orbit(viewed), 'orbit').toEqual(orbit(bare));
        expect(study(viewed), 'turning scene').toEqual(study(bare));
      });
    }
  }
});

describe('the twin comparison can see a clock disturbed', () => {
  // Calibration of the instrument above, through the released path: pause then
  // play clears the physics accumulator and nothing else, and that alone must
  // part the twins — from every prior where the physics clock runs. Pause and
  // the orbit: pause alone must part them where the orbit runs.
  it('a cleared physics accumulator changes the step count after the twin ticks', () => {
    for (const prior of [PRIORS[2]!, PRIORS[3]!, PRIORS[6]!]) {
      const disturbed = prior.build();
      const bare = prior.build();
      disturbed.dispatch({ type: 'pause' });
      disturbed.dispatch({ type: 'play' });
      for (const t of TWIN_TICKS) { disturbed.dispatch(t); bare.dispatch(t); }
      expect(disturbed.worlds.contact.sim.steps, prior.name).not.toBe(bare.worlds.contact.sim.steps);
    }
  });

  it('a stopped orbit or turning scene changes the snapshot after the twin ticks', () => {
    for (const prior of [PRIORS[1]!, PRIORS[4]!, PRIORS[5]!]) {
      const disturbed = prior.build();
      const bare = prior.build();
      disturbed.dispatch({ type: 'pause' });
      for (const t of TWIN_TICKS) { disturbed.dispatch(t); bare.dispatch(t); }
      expect({ orbit: orbit(disturbed), study: study(disturbed) }, prior.name).not.toEqual({ orbit: orbit(bare), study: study(bare) });
    }
  });
});

describe('freeze stops every clock where it stands, lifts the shadow, and moves nothing', () => {
  for (const prior of PRIORS) {
    it(`from ${prior.name}`, () => {
      const x = prior.build();
      const before = { physics: physics(x), orbit: orbit(x), study: study(x), slices: slices(x) };
      x.dispatch({ type: 'freeze' });
      const frozen = { physics: physics(x), orbit: orbit(x), study: study(x) };
      expect(frozen.physics).toEqual(before.physics);
      expect(frozen.orbit).toEqual(before.orbit);
      expect({ ...frozen.study, playing: before.study.playing }).toEqual(before.study);
      expect(frozen.study.playing, 'the turning scene is stopped').toBe(false);
      expect(slices(x), 'no slice moves').toEqual(before.slices);
      const v = x.view(null);
      expect(v.clock.playing, 'the clock in front is stopped').toBe(false);
      expect(v.shadow.on, 'the shadow is lifted').toBe(true);
      // Stopped, not merely relabelled: a later tick advances no clock.
      x.dispatch(tick);
      x.dispatch(tick);
      expect(physics(x)).toEqual(frozen.physics);
      expect(orbit(x)).toEqual(frozen.orbit);
      expect(study(x)).toEqual(frozen.study);
    });
  }
});

describe('a time action moves a clock only: both slices, the shadow, the focus and the face are bitwise unchanged', () => {
  for (const prior of PRIORS) {
    for (const a of ofKind('time')) {
      it(`${label(a)}, from ${prior.name}`, () => {
        const x = prior.build();
        const before = observer(x);
        x.dispatch(a);
        expect(observer(x)).toEqual(before);
      });
    }
  }
});

describe('a study action moves the turning scene only: physics, orbit, both slices, shadow and focus are bitwise unchanged', () => {
  for (const prior of PRIORS) {
    for (const a of ofKind('study')) {
      it(`${label(a)}, from ${prior.name}`, () => {
        const x = prior.build();
        const simBefore = x.worlds.contact.sim;
        const before = { physics: physics(x), orbit: orbit(x), observer: observer(x) };
        x.dispatch(a);
        expect(x.worlds.contact.sim, 'the simulation is the same object, never replaced').toBe(simBefore);
        expect(physics(x), 'physics').toEqual(before.physics);
        expect(orbit(x), 'orbit').toEqual(before.orbit);
        expect(observer(x), 'observer').toEqual(before.observer);
      });
    }
  }
});

describe('switching worlds moves neither a clock nor a slice', () => {
  for (const prior of PRIORS) {
    for (const a of CATALOGUE.filter((c) => c.type === 'world')) {
      it(`${label(a)}, from ${prior.name}`, () => {
        const x = prior.build();
        const before = { physics: physics(x), orbit: orbit(x), study: study(x), slices: slices(x), shadow: x.view(null).shadow.on };
        x.dispatch(a);
        expect(physics(x), 'physics').toEqual(before.physics);
        expect(orbit(x), 'orbit').toEqual(before.orbit);
        expect(study(x), 'turning scene').toEqual(before.study);
        expect(slices(x), 'slices').toEqual(before.slices);
        expect(x.view(null).shadow.on, 'shadow').toBe(before.shadow);
      });
    }
  }
});

describe('the prior states are what their names say', () => {
  // Guards against a prior that silently collapsed to a trivial one, which would
  // make every boundary claim above hold vacuously.
  it('the mid-orbit turning world is turned, slid, shadowed, focused and playing', () => {
    const x = PRIORS[1]!.build();
    const v = x.view(null);
    expect(v.world).toBe('turn');
    expect(v.clock.playing).toBe(true);
    expect(x.worlds.turn.slice.offset).toBe(0.4);
    expect(x.worlds.turn.slice.normal.data[0]).not.toBe(0);
    expect(v.shadow.on).toBe(true);
    expect(v.bodies.find((b) => b.id === 'block')!.focused).toBe(true);
    expect(v.face).not.toBeNull();
    expect(orbit(x).companion).not.toEqual([3.6, 1.05, 0, 0.92]);
  });

  it('the collision prior is past its first touch and playing; the spin prior is past its blow', () => {
    const collision = PRIORS[2]!.build();
    expect(collision.view(null).clock.playing).toBe(true);
    expect(collision.worlds.contact.sim.steps).toBeGreaterThan(0);
    expect(collision.worlds.contact.slice.normal.data[0]).not.toBe(0);
    const spin = PRIORS[3]!.build();
    expect(spin.worlds.contact.presetId).toBe('off-centre');
    expect(spin.worlds.contact.sim.impacts).toBeGreaterThan(0);
    expect(spin.view(null).clock.playing).toBe(true);
  });

  it('the turning-scene prior is open, past 70° and playing', () => {
    const x = PRIORS[4]!.build();
    const v = x.view(null);
    expect(v.studyOpen).toBe(true);
    expect(x.worlds.contact.study.playing).toBe(true);
    expect(x.worlds.contact.study.angle).toBeGreaterThan((70 * Math.PI) / 180);
  });

  it('the free priors are in the free chapter, one in each world, with a clock running', () => {
    const turn = PRIORS[5]!.build().view(null);
    const contact = PRIORS[6]!.build();
    expect([turn.chapter.id, turn.world, turn.clock.playing]).toEqual(['free', 'turn', true]);
    const cv = contact.view(null);
    expect([cv.chapter.id, cv.world, cv.clock.playing]).toEqual(['free', 'contact', true]);
    expect(contact.worlds.contact.sim.impacts).toBeGreaterThan(0);
  });
});

describe('a clock is never moved out of sight', () => {
  it('the orbit, left playing, holds still while the collision is in front, and runs again when its world returns', () => {
    const x = createExperience('free');
    x.dispatch({ type: 'play' });
    const ball = x.worlds.turn.products.find((p) => p.id === 'companion')!;
    x.dispatch({ type: 'tick', seconds: 0.05 });
    x.dispatch({ type: 'world', world: 'contact' });
    const held = ball.position4()!.slice();
    for (let k = 0; k < 10; k++) x.dispatch({ type: 'tick', seconds: 0.05 });
    expect(ball.position4()).toEqual(held);
    x.dispatch({ type: 'world', world: 'turn' });
    x.dispatch({ type: 'tick', seconds: 0.05 });
    expect(ball.position4()).not.toEqual(held);
    x.dispose();
  });
});

