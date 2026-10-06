import { describe, expect, it } from 'vitest';
import { ACTION_KINDS, CHAPTERS, HAND_OF, createExperience, type Action, type Experience } from '../../src/flatland/journey.js';

/**
 * Four hands, four things. Each action may change only what its hand owns, and
 * a chapter that has not granted a hand ignores it. Worlds are compared
 * bitwise: the authored source, the pose, the slice, every posed corner, the
 * cut's corners and the shadow's points, in both rungs.
 */

const fingerprint = (x: Experience) => Object.fromEntries((['plane', 'space'] as const).map((rung) => {
  const w = x.worlds[rung];
  return [rung, {
    source: Array.from(w.source.positions),
    tip: w.tip,
    offset: w.offset,
    corners: w.corners().map((c) => [...c.posed]),
    cut: w.cut().corners.map((c) => [...c.at]),
    shadow: w.shadow().points.map((p) => [...p.at])
  }];
}));

/** A world state worth disturbing: something cut, the shadow cast, a pose between the named ones. */
function busy(): Experience {
  const x = createExperience('free', { instantTurns: true });
  x.dispatch({ type: 'tip-to', angle: 0.41 });
  x.dispatch({ type: 'slide-to', offset: 0.3 });
  x.dispatch({ type: 'shadow', on: true });
  return x;
}

describe('every action has a kind and a hand', () => {
  it('lists the same action types in both tables', () => {
    expect(Object.keys(HAND_OF).sort()).toEqual(Object.keys(ACTION_KINDS).sort());
  });
});

describe('looking, asking and casting change no world', () => {
  const quiet: Action[] = [
    { type: 'look' },
    { type: 'show-object', on: false },
    { type: 'show-object', on: true },
    { type: 'predict', choice: 'hexagon' },
    { type: 'inspect', target: { kind: 'cut-corner', index: 0 } },
    { type: 'inspect', target: { kind: 'shadow-point', index: 1 } },
    { type: 'inspect', target: { kind: 'corner', index: 2 } },
    { type: 'inspect', target: null },
    { type: 'shadow', on: false },
    { type: 'shadow', on: true },
    { type: 'stop' }
  ];

  for (const action of quiet) {
    it(`leaves both worlds bitwise as they were: ${JSON.stringify(action)}`, () => {
      for (const rung of ['plane', 'space'] as const) {
        const x = busy();
        x.dispatch({ type: 'rung', id: rung });
        const before = fingerprint(x);
        x.dispatch(action);
        expect(fingerprint(x)).toEqual(before);
        expect(['view', 'question', 'shadow', 'clock']).toContain(ACTION_KINDS[action.type]);
      }
    });
  }

  it('hides the cube from the picture only: the cut and the shadow are what they were', () => {
    const x = createExperience('shadow', { instantTurns: true });
    const before = x.view();
    x.dispatch({ type: 'show-object', on: false });
    const after = x.view();
    expect(after.objectShown).toBe(false);
    expect(after.cut).toEqual(before.cut);
    expect(after.shadow).toEqual(before.shadow);
    expect(after.meeting).toEqual(before.meeting);
  });
});

describe('sliding moves the slice and nothing else', () => {
  it('changes the offset, keeps the pose, the corners and the shadow’s place in the slice', () => {
    for (const rung of ['plane', 'space'] as const) {
      const x = busy();
      x.dispatch({ type: 'rung', id: rung });
      const before = fingerprint(x)[rung]!;
      for (const action of [{ type: 'slide-step', steps: 3 }, { type: 'slide-to', offset: -0.9 }, { type: 'slide-layer', direction: 1 }] as Action[]) {
        x.dispatch(action);
        const after = fingerprint(x)[rung]!;
        expect(after.source).toEqual(before.source);
        expect(after.tip).toBe(before.tip);
        expect(after.corners).toEqual(before.corners);
        const axis = rung === 'plane' ? 2 : 3;
        expect(after.shadow.map((p) => p.filter((_, k) => k !== axis))).toEqual(before.shadow.map((p) => p.filter((_, k) => k !== axis)));
      }
      expect(fingerprint(x)[rung]!.offset).not.toBe(before.offset);
    }
  });

  it('does not reach into the other rung', () => {
    const x = busy();
    const space = fingerprint(x).space;
    x.dispatch({ type: 'slide-step', steps: -4 });
    x.dispatch({ type: 'tip-step', steps: 2 });
    expect(fingerprint(x).space).toEqual(space);
  });
});

describe('turning poses the object and nothing else', () => {
  it('changes the pose, keeps the slice and every edge’s length', () => {
    for (const rung of ['plane', 'space'] as const) {
      const x = busy();
      x.dispatch({ type: 'rung', id: rung });
      const before = fingerprint(x)[rung]!;
      for (const action of [{ type: 'tip-step', steps: 2 }, { type: 'pose', pose: 'corner' }, { type: 'tip-to', angle: 1.1 }] as Action[]) {
        x.dispatch(action);
        const after = fingerprint(x)[rung]!;
        expect(after.source).toEqual(before.source);
        expect(after.offset).toBe(before.offset);
        expect(new Set(x.world().edgeLengths())).toEqual(new Set([2]));
      }
      expect(fingerprint(x)[rung]!.tip).not.toBe(before.tip);
    }
  });
});

describe('a chapter grants some hands and not others', () => {
  const byHand: Record<string, Action[]> = {
    turn: [{ type: 'tip-step', steps: 1 }, { type: 'tip-to', angle: 0.7 }, { type: 'pose', pose: 'edge' }],
    cast: [{ type: 'shadow', on: true }]
  };

  for (const chapter of CHAPTERS) {
    it(`ignores the hands chapter ${chapter.numeral} has not granted`, () => {
      for (const [hand, actions] of Object.entries(byHand)) {
        const x = createExperience(chapter.id, { instantTurns: true });
        const before = fingerprint(x);
        const view = x.view();
        for (const a of actions) x.dispatch(a);
        if (chapter.hands.includes(hand as never)) continue;
        expect(fingerprint(x)).toEqual(before);
        expect(x.view().shadowOn).toBe(view.shadowOn);
        expect(x.view().event).toEqual(view.event);
      }
    });
  }

  it('offers hiding the cube only in the plane rung, once the shadow can be cast', () => {
    for (const chapter of CHAPTERS) {
      const x = createExperience(chapter.id, { instantTurns: true });
      x.dispatch({ type: 'show-object', on: false });
      const v = x.view();
      const offered = v.rung === 'plane' && chapter.hands.includes('cast');
      expect(v.canHideObject).toBe(offered);
      expect(v.objectShown).toBe(!offered);
    }
  });
});

describe('looking is said once, and only that', () => {
  it('says that nothing moved the first time in a chapter, and is quiet after', () => {
    const x = createExperience('through');
    x.dispatch({ type: 'look' });
    const first = x.view();
    expect(first.event?.line).toBe('You moved the camera. Nothing in the world moved; only your view of it did.');
    x.dispatch({ type: 'look' });
    expect(x.view().eventId).toBe(first.eventId);
    x.dispatch({ type: 'chapter', id: 'corner' });
    x.dispatch({ type: 'look' });
    expect(x.view().event?.line).toBe(first.event?.line);
  });
});
