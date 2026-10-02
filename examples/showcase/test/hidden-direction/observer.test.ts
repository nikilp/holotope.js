import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createExperience, type Action, type ChapterId } from '../../src/hidden-direction/experience.js';
import { keyAction } from '../../src/hidden-direction/bindings.js';
import { stripComments } from '../spatial-4d-contact/source-pins.js';

/**
 * The observer note is computed from the live slice.
 *
 * The note says where your slice sits relative to the centre point it turns
 * about: through it, so turning pivots; or some distance from it, so turning
 * sweeps. The centre point is the origin and the slice is {p : n·p = offset}
 * with |n| = 1, so the distance is |n·0 − offset| / |n| = |offset| — the
 * expectation below is that, worked from the offset each test dispatched and
 * the unit normal the slice reports, formatted to two places by the test
 * itself. Nothing here reads the expected number from `pivotLine` or
 * `distanceFromPivot`.
 *
 * Part one drives the new experience through `dispatch`: a slid slice, a slid
 * and then turned slice (turning keeps the offset, so the note keeps its
 * distance), a turned and then slid slice, both worlds, a distance below the
 * print threshold, and back to zero. A note that ignored the live slice — the
 * call replaced by `pivotLine(0)`, or reading the other world's slice — fails
 * here. In the turning scene the slice in front is the scene's own, fixed at
 * w = 0, and the note must describe that one — after the collision's slice was
 * slid before entering, and after the arrow keys, which the page sends in every
 * scene.
 *
 * Part two pins the classic contact page, still shipped as
 * spatial-4d-contact-classic.html from src/spatial-4d-contact/main.ts. Its
 * pivot note had no test: no contact test names `observerNote`,
 * `distanceFromPivot` or `#pivot-note`, and with `observerNote(0)` in place of
 * the live call all 112 contact tests stay green. There is no DOM here, so the
 * pin is a comment-stripped source check, modelled on the turn page's
 * "main.ts writes the note from observerNote" pin: it proves the call and the
 * write are present in executable source — not that they run, and not what
 * the sentence says. `observerNote`'s behaviour, at both signs and at zero, is
 * held by test/spatial-4d-turn/turn.test.ts.
 */

type Experience = ReturnType<typeof createExperience>;

function reach(start: ChapterId, actions: readonly Action[]): Experience {
  const x = createExperience(start);
  for (const a of actions) x.dispatch(a);
  return x;
}

/** The slice in front, read from the world's own object. */
const frontSlice = (x: Experience) => (x.view(null).world === 'turn' ? x.worlds.turn.slice : x.worlds.contact.slice);

/**
 * The distance of the centre point (the origin) from {p : n·p = offset}, from
 * first principles: |n·0 − offset| / |n|. The normal is read from the slice,
 * the offset is the one the test dispatched.
 */
function expectedDistance(x: Experience, dispatchedOffset: number): number {
  const n = Array.from(frontSlice(x).normal.data);
  const length = Math.hypot(...n);
  expect(Math.abs(length - 1), 'the slice normal is a unit vector').toBeLessThanOrEqual(1e-15);
  return Math.abs(0 - dispatchedOffset) / length;
}

const PIVOTS = 'passes through the centre point, so turning pivots about it';

function expectSweeps(x: Experience, dispatchedOffset: number): void {
  const d = expectedDistance(x, dispatchedOffset);
  const pivot = x.view(null).cut.pivot;
  expect(pivot).toContain(`is ${d.toFixed(2)} from the centre point`);
  expect(pivot).toContain('sweeps');
  expect(pivot).not.toContain(PIVOTS);
}

describe('the observer note is computed from the live slice', () => {
  it('at the reference the slice passes through the centre point, and the note says turning pivots', () => {
    for (const start of ['arrival', 'cuts', 'collision', 'spin'] as const) {
      const pivot = createExperience(start).view(null).cut.pivot;
      expect(pivot, start).toContain(PIVOTS);
      expect(pivot, start).not.toContain('sweeps');
    }
  });

  it('slid to 0.8 in the turning world: the note names 0.80 and says turning sweeps', () => {
    const x = reach('arrival', [{ type: 'cut-offset', value: 0.8 }]);
    expectSweeps(x, 0.8);
    expect(x.view(null).cut.pivot).toContain('0.80');
  });

  it('slid to −0.8: the note names the distance, 0.80, not the signed offset', () => {
    const x = reach('arrival', [{ type: 'cut-offset', value: -0.8 }]);
    expectSweeps(x, -0.8);
    expect(x.view(null).cut.pivot).not.toContain('-0.80');
    expect(x.view(null).cut.pivot).not.toContain('−0.80');
  });

  it('slid to −0.37 and then turned 33°: turning keeps the offset, so the note keeps 0.37', () => {
    const x = reach('cuts', [{ type: 'cut-offset', value: -0.37 }, { type: 'cut-turn', degrees: 33 }]);
    expect(x.view(null).cut.degrees).toBeCloseTo(33, 12);
    expectSweeps(x, -0.37);
  });

  it('turned −61° and then slid to 1.234: the note names 1.23', () => {
    const x = reach('cuts', [{ type: 'cut-turn', degrees: -61 }, { type: 'cut-offset', value: 1.234 }]);
    expectSweeps(x, 1.234);
    expect(x.view(null).cut.pivot).toContain('1.23');
  });

  it('nudged from 0.5 by 0.25: the note names the live 0.75, not the first 0.50', () => {
    const x = reach('arrival', [{ type: 'cut-offset', value: 0.5 }, { type: 'cut-nudge', delta: 0.25 }]);
    expectSweeps(x, 0.75);
    expect(x.view(null).cut.pivot).not.toContain('0.50');
  });

  it('in the contact world: slid to 1.25, then turned 45° and slid to −0.66', () => {
    const x = reach('collision', [{ type: 'cut-offset', value: 1.25 }]);
    expectSweeps(x, 1.25);
    x.dispatch({ type: 'cut-turn', degrees: 45 });
    x.dispatch({ type: 'cut-offset', value: -0.66 });
    expectSweeps(x, -0.66);
  });

  it('a distance below the print threshold still sweeps, and prints as its bound, never as 0.00', () => {
    // |0.003| is under 0.005, the threshold below which a non-zero distance prints as its bound.
    const x = reach('arrival', [{ type: 'cut-offset', value: 0.003 }]);
    const pivot = x.view(null).cut.pivot;
    expect(pivot).toContain('under 0.005');
    expect(pivot).toContain('sweeps');
    expect(pivot).not.toContain('0.00 ');
  });

  it('back through the centre point — by reset, or by sliding to 0 — the note says it pivots again', () => {
    const x = reach('spin', [{ type: 'cut-turn', degrees: 20 }, { type: 'cut-offset', value: 0.9 }]);
    expectSweeps(x, 0.9);
    x.dispatch({ type: 'cut-reset' });
    expect(x.view(null).cut.pivot).toContain(PIVOTS);
    x.dispatch({ type: 'cut-offset', value: -0.4 });
    expectSweeps(x, -0.4);
    x.dispatch({ type: 'cut-offset', value: 0 });
    expect(x.view(null).cut.pivot).toContain(PIVOTS);
  });

  it('the note follows the slice in front: each world keeps its own slice, and the note reads the one you see', () => {
    const x = reach('free', [
      { type: 'world', world: 'turn' }, { type: 'cut-offset', value: 0.8 },
      { type: 'world', world: 'contact' }, { type: 'cut-offset', value: -1.4 }
    ]);
    expectSweeps(x, -1.4);
    x.dispatch({ type: 'world', world: 'turn' });
    expectSweeps(x, 0.8);
    x.dispatch({ type: 'world', world: 'contact' });
    x.dispatch({ type: 'cut-reset' });
    expect(x.view(null).cut.pivot).toContain(PIVOTS);
    x.dispatch({ type: 'world', world: 'turn' });
    expectSweeps(x, 0.8);
  });

  it('in the turning scene the slice in front is fixed at w = 0, and the note says it passes through the centre point', () => {
    // The scene's slice is its own and never moves; the collision's slice, slid
    // before entering, is not the one in front. The page prints this note in
    // every scene, beside the map that reads "your slice is fixed at w = 0".
    const x = reach('collision', [{ type: 'cut-offset', value: 0.6 }, { type: 'chapter', id: 'turning' }]);
    expect(x.view(null).studyOpen).toBe(true);
    expect(Array.from(x.worlds.contact.study.slice.normal.data)).toEqual([0, 0, 0, 1]);
    expect(x.worlds.contact.study.slice.offset).toBe(0);
    expect(x.view(null).cut.pivot).toContain(PIVOTS);
  });

  it('in the turning scene the arrow keys leave the note on the fixed slice', () => {
    // The page's window key handler sends keyAction's result in every scene; ↑ and
    // ← are slice actions. In the turning scene the slice in front cannot move, so
    // whatever they do, the note must still describe the slice at w = 0.
    const x = createExperience('turning');
    const context = { playing: false, shadowOn: false, studyPlaying: false, facesCut: [], face: null };
    for (const key of ['ArrowUp', 'ArrowUp', 'ArrowLeft']) {
      const a = keyAction(key, true, context);
      expect(a, key).not.toBeNull();
      expect(a, key).not.toBe('camera');
      x.dispatch(a as Action);
    }
    expect(Array.from(x.worlds.contact.study.slice.normal.data)).toEqual([0, 0, 0, 1]);
    expect(x.worlds.contact.study.slice.offset).toBe(0);
    expect(x.view(null).cut.pivot).toContain(PIVOTS);
  });
});

/* -------------------------------------------------------------------------- */
/* The classic contact page: a source pin, labelled as such.                   */
/* -------------------------------------------------------------------------- */

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, '..', '..', 'src', 'spatial-4d-contact', 'main.ts'), 'utf8');
const html = readFileSync(join(here, '..', '..', 'spatial-4d-contact-classic.html'), 'utf8');

/** Whitespace-insensitive, so a call that spans a line break still counts. */
const flat = (source: string): string => source.replace(/\s+/g, '');
const code = flat(stripComments(main));

/** The body of `function NAME(…): void { … }` in flattened source: the text inside its outermost braces. */
function functionBody(source: string, name: string): string {
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

const LIVE_CALL = flat('const note = observerNote(distanceFromPivot(slice));');
const WRITE = flat('pivotNote.textContent = note.sentence;');

describe('the classic contact page writes its pivot note from the live slice', () => {
  it('the page has the note element, and main.ts binds it', () => {
    expect(html).toMatch(/<p[^>]*\bid="pivot-note"/);
    expect(code).toContain(flat("const pivotNote = panel.querySelector<HTMLElement>('#pivot-note')!;"));
  });

  it('main.ts imports observerNote and distanceFromPivot from the tested turn-state module', () => {
    const imports = [...code.matchAll(/import\{([^}]*)\}from'([^']+)';/g)]
      .filter((m) => m[2] === '../spatial-4d-turn/turn-state.js')
      .flatMap((m) => m[1]!.split(','));
    expect(imports).toContain('observerNote');
    expect(imports).toContain('distanceFromPivot');
  });

  it('main.ts computes the note as observerNote(distanceFromPivot(slice)) and writes note.sentence', () => {
    expect(code).toContain(LIVE_CALL);
    expect(code).toContain(WRITE);
    // The write follows the computation it reads.
    expect(code.indexOf(WRITE)).toBeGreaterThan(code.indexOf(LIVE_CALL));
  });

  it('the live slice is the one refresh() has just pointed at the knife', () => {
    // The call sits in refresh(), after applyTo(slice, knife), so the note reads
    // the slice as it is now, not as it was.
    const body = functionBody(code, 'refresh');
    const applied = body.indexOf(flat('applyTo(slice, knife);'));
    expect(applied, 'refresh() points the slice at the knife').toBeGreaterThanOrEqual(0);
    expect(body.indexOf(LIVE_CALL), 'refresh() computes the note after it').toBeGreaterThan(applied);
    expect(body).toContain(WRITE);
  });
});

describe('the pin itself', () => {
  it('rejects the constant note that previously passed every contact test', () => {
    const mutated = main.replace('observerNote(distanceFromPivot(slice))', 'observerNote(0)');
    expect(mutated).not.toBe(main);
    expect(flat(stripComments(mutated)).includes(LIVE_CALL)).toBe(false);
  });

  it('rejects the call when it survives only inside a comment', () => {
    expect(flat(stripComments('// const note = observerNote(distanceFromPivot(slice));')).includes(LIVE_CALL)).toBe(false);
    expect(flat(stripComments('/* const note = observerNote(distanceFromPivot(slice)); */')).includes(LIVE_CALL)).toBe(false);
  });

  it('accepts the call across a line break', () => {
    expect(flat(stripComments('const note =\n  observerNote(\n    distanceFromPivot(slice));')).includes(LIVE_CALL)).toBe(true);
  });
});

describe('keyboard steps that come back to zero land on zero; a drag is never snapped', () => {
  // The review's N2.4 and C6: three steps up and three down left the offset at −6.9·10⁻¹⁸ and the dial at
  // −0.0°. A step that brings the offset or the turn back within 10⁻¹² of zero now lands on zero exactly,
  // so every readout prints zero without a sign and agrees with the pivot note.
  const keys = { playing: false, shadowOn: false, studyPlaying: false, facesCut: [], face: null };
  const send = (x: Experience, key: string, shift: boolean, times: number): void => {
    for (let k = 0; k < times; k++) x.dispatch(keyAction(key, shift, keys) as Action);
  };

  it('the review’s sequences, ↑↑↑↓↓↓ and Shift+→ ×3 then Shift+← ×3, leave the offset and the turn at exactly +0', () => {
    for (const start of ['cuts', 'collision'] as const) {
      const x = createExperience(start);
      send(x, 'ArrowUp', false, 3);
      send(x, 'ArrowDown', false, 3);
      expect(Object.is(frontSlice(x).offset, 0), `${start}: offset ${frontSlice(x).offset}`).toBe(true);
      send(x, 'ArrowRight', true, 3);
      send(x, 'ArrowLeft', true, 3);
      const v = x.view(null);
      expect(Object.is(v.cut.degrees, 0), `${start}: turn ${v.cut.degrees}`).toBe(true);
      expect(v.cut.normal).toEqual([0, 0, 0, 1]);
      expect(v.cut.pivot).toContain(PIVOTS);
      x.dispose();
    }
  });

  it('longer and mixed sequences that sum to zero land on zero too, by the arrows and by the focused instruments’ own keys', () => {
    const x = createExperience('cuts');
    const seqs: [string, boolean, number][][] = [
      [['ArrowUp', true, 4], ['ArrowDown', false, 40]],
      [['ArrowDown', false, 7], ['ArrowUp', false, 2], ['ArrowUp', false, 5]],
      [['ArrowRight', false, 17], ['ArrowLeft', true, 1], ['ArrowLeft', false, 7]],
      [['ArrowLeft', true, 2], ['ArrowRight', false, 20]]
    ];
    for (const seq of seqs) {
      for (const [key, shift, times] of seq) send(x, key, shift, times);
      const v = x.view(null);
      expect([Object.is(v.cut.offset, 0), Object.is(v.cut.degrees, 0)], JSON.stringify(seq)).toEqual([true, true]);
    }
    x.dispose();
  });

  it('a small displacement made on purpose is kept, and steps around it do not erase it', () => {
    const x = createExperience('cuts');
    x.dispatch({ type: 'cut-offset', value: 0.003 });
    send(x, 'ArrowUp', false, 3);
    send(x, 'ArrowDown', false, 3);
    expect(frontSlice(x).offset).toBeCloseTo(0.003, 15);
    expect(x.view(null).cut.pivot).toContain('is under 0.005 from the centre point');
    x.dispatch({ type: 'cut-offset', value: 1e-13 });
    expect(frontSlice(x).offset, 'a drag is never snapped').toBe(1e-13);
    // And the note agrees with the readouts: not through the centre point, by under 0.005.
    expect(x.view(null).cut.pivot).toContain('is under 0.005 from the centre point');
    x.dispatch({ type: 'cut-turn', degrees: -0.04 });
    expect(x.view(null).cut.degrees).toBeCloseTo(-0.04, 12);
    x.dispose();
  });
});
