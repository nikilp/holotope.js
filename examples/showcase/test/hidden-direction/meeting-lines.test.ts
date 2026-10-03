import { describe, expect, it } from 'vitest';
import { createExperience, type Action } from '../../src/hidden-direction/experience.js';
import { INSTRUMENTS, keyAction, sliderKey } from '../../src/hidden-direction/bindings.js';
import type { BodyReading, Meeting } from '../../src/hidden-direction/worlds.js';

/**
 * The event line says what a change left a body as, in the present tense — "now passes through your slice",
 * "the meeting is its +w face" — and it stays on screen until the next change is said. So a change of the
 * meeting a line names must be said, even when the library's status does not change: passing through a box and
 * lying on its drawn face are both `present` (re-check R2, C1).
 *
 * The oracle reads the line, not the code that decides when to speak. Each sentence is parsed for what it
 * claims about a body now — in the slice and drawn, passing through, on its boundary with a named meeting (drawn
 * or not), touching at a single point, or outside on a named side — and each claim is checked against that
 * body's current reading: its status, its drawn count, its meeting (kind, dimension, face) and the sign of its
 * gap. Sentences about the past (the blow, a replay) claim nothing about now and are skipped. A sentence the
 * parser does not know fails, so a change of wording cannot pass by claiming nothing.
 *
 * After every action of every sequence, the line's claims must hold. After an action that changes a body's
 * meeting, the line must also make a claim about that body — a line cleared, or left about another body, fails.
 * Actions that change nothing a line names say nothing.
 *
 * The input is the page's own: arrows as `keyAction` and the focused gauge's `sliderKey` send them, and gauge
 * drags as the series of offsets a pointer sends (`INSTRUMENTS.gauge.act`), ending where the pointer is released.
 *
 * Where the faces are (authored half extents): the contact box's w faces at ±1.0 at launch, its x faces at ±1.2
 * with the slice turned 90°; the turning world's block w faces at ±1.6, which are the slider's own limits — so
 * the block's faces are reached from inside only, and from outside only in the contact world.
 */

type Experience = ReturnType<typeof createExperience>;

/** What the line claims about a body now. `meeting` is a phrase key (see `phraseKey`); null when the line names none. */
type Claim =
  | { readonly body: string; readonly kind: 'in' }
  | { readonly body: string; readonly kind: 'through' }
  | { readonly body: string; readonly kind: 'boundary'; readonly meeting: string | null; readonly drawn: boolean | null }
  | { readonly body: string; readonly kind: 'point' }
  | { readonly body: string; readonly kind: 'outside'; readonly side: 'ana' | 'kata' };

/** Every clause a line uses to say what did a change. */
const CAUSE = String.raw`(?:you moved your slice|it moved along its prescribed orbit|it moved|the run was replayed from launch to step \d+|launch [A-Z] was started afresh, at step 0)`;

/** A meeting as named in a line, as a key: a named 3-face, or a dimension, or "not established". */
function phraseKey(phrase: string): string {
  const named = /^its (\S+) face, a solid cuboid$/.exec(phrase);
  if (named) return `face ${named[1]}`;
  const keys: Record<string, string> = {
    'one of its 3-faces, a solid cuboid': 'dim 3',
    'a flat rectangle, with no thickness': 'dim 2',
    'one of its edges': 'dim 1',
    'a single point': 'dim 0',
    'part of its boundary, of a dimension not established within 10⁻⁹': 'unsettled'
  };
  const key = keys[phrase];
  if (!key) throw new Error(`unknown meeting phrase: “${phrase}”`);
  return key;
}
/** The same key, from a body's reading. */
function meetingKey(m: Meeting): string | null {
  if (m.kind === 'unsettled') return 'unsettled';
  if (m.kind !== 'boundary') return null;
  return m.dim === 3 && m.face ? `face ${m.face}` : `dim ${m.dim}`;
}

/** Each sentence form, with what it claims. The body is named by its display name, or lower-case after "the". */
const FORMS: readonly { readonly re: RegExp; readonly claims: (m: RegExpExecArray) => Claim[] }[] = [
  { re: new RegExp(`^(\\w+) appeared — ${CAUSE}, and now your slice cuts it\\.`), claims: (m) => [{ body: m[1]!, kind: 'in' }] },
  { re: new RegExp(`^(\\w+) now passes through your slice — ${CAUSE}, and its cut is drawn\\.`), claims: (m) => [{ body: m[1]!, kind: 'through' }] },
  {
    re: new RegExp(`^(\\w+) now meets your slice only on its boundary — ${CAUSE}\\. The meeting is (.+?), and its cut is drawn\\.`),
    claims: (m) => [{ body: m[1]!, kind: 'boundary', meeting: phraseKey(m[2]!), drawn: true }]
  },
  {
    re: new RegExp(`^(\\w+) now meets your slice only on its boundary — ${CAUSE}\\. The meeting is (.+?); nothing is drawn for it\\.`),
    claims: (m) => [{ body: m[1]!, kind: 'boundary', meeting: phraseKey(m[2]!), drawn: false }]
  },
  { re: new RegExp(`^(\\w+) is touching your slice at a single point — ${CAUSE}\\. Only a marker is drawn\\.`), claims: (m) => [{ body: m[1]!, kind: 'point' }] },
  {
    re: new RegExp(`^(\\w+) vanished from your slice — ${CAUSE}; the (\\w+) now lies (ana|kata) of your slice\\. It has not gone\\.`),
    claims: (m) => [{ body: m[1]!, kind: 'outside', side: m[3] as 'ana' | 'kata' }]
  },
  {
    re: new RegExp(`^(\\w+) is still not in your slice — ${CAUSE}; the (\\w+) now lies (ana|kata) of your slice\\.`),
    claims: (m) => [{ body: m[1]!, kind: 'outside', side: m[3] as 'ana' | 'kata' }]
  },
  // What a change left a body as, said after another line.
  { re: /^The (\w+) now lies (ana|kata) of your slice\./, claims: (m) => [{ body: m[1]!, kind: 'outside', side: m[2] as 'ana' | 'kata' }] },
  { re: /^(\w+) is touching your slice at a single point\./, claims: (m) => [{ body: m[1]!, kind: 'point' }] },
  { re: /^(\w+) now meets your slice only on its boundary\./, claims: (m) => [{ body: m[1]!, kind: 'boundary', meeting: null, drawn: null }] },
  { re: /^(\w+) is in your slice\./, claims: (m) => [{ body: m[1]!, kind: 'in' }] },
  // About the past, or about the run: nothing about now.
  { re: /^The box was struck — by the ball, then in your slice\./, claims: () => [] },
  { re: /^The box was struck by something your slice cannot show: the ball, then .+? (?:ana|kata) of your slice\./, claims: () => [] },
  { re: /^Replayed from launch to step \d+, the blow: the box was struck there — by the ball, then in your slice\./, claims: () => [] },
  { re: /^Replayed from launch to step \d+, the blow: the box was struck there by something your slice cannot show: the ball, then .+? (?:ana|kata) of your slice\./, claims: () => [] },
  { re: /^The run was replayed from launch to step \d+\./, claims: () => [] },
  { re: /^Launch [A-Z] was started afresh, at step 0\./, claims: () => [] }
];

/** Every claim a line makes about now, sentence by sentence. A sentence no form knows is an error. */
function claimsOf(line: string): Claim[] {
  const out: Claim[] = [];
  let rest = line.trim();
  while (rest.length > 0) {
    let matched = false;
    for (const form of FORMS) {
      const m = form.re.exec(rest);
      if (!m) continue;
      out.push(...form.claims(m));
      rest = rest.slice(m[0].length).trim();
      matched = true;
      break;
    }
    if (!matched) throw new Error(`a sentence the oracle does not know: “${rest}”`);
  }
  return out;
}

/** Why a claim is false of a body's reading now, or null when it holds. */
function falsity(c: Claim, b: BodyReading): string | null {
  const now = `${b.status}, ${b.drawn} drawn, meeting ${meetingKey(b.meeting) ?? b.meeting.kind}, gap ${b.gap}`;
  switch (c.kind) {
    case 'in':
      return b.status === 'present' && b.drawn > 0 ? null : `claims ${b.name} is in the slice and drawn; it is ${now}`;
    case 'through':
      return b.status === 'present' && b.drawn > 0 && b.meeting.kind === 'through' ? null : `claims ${b.name} passes through; it is ${now}`;
    case 'boundary': {
      const onBoundary = b.status !== 'outside' && (b.meeting.kind === 'boundary' || b.meeting.kind === 'unsettled');
      const named = c.meeting === null || meetingKey(b.meeting) === c.meeting;
      const drawn = c.drawn === null || (c.drawn ? b.status === 'present' && b.drawn > 0 : b.drawn === 0);
      return onBoundary && named && drawn ? null : `claims ${b.name} meets it only on its boundary (${c.meeting ?? 'unnamed'}, ${c.drawn === null ? 'drawn or not' : c.drawn ? 'drawn' : 'not drawn'}); it is ${now}`;
    }
    case 'point':
      return b.status === 'tangent' && b.meeting.kind === 'boundary' && b.meeting.dim === 0 ? null : `claims ${b.name} touches at a point; it is ${now}`;
    case 'outside':
      return b.status === 'outside' && (b.gap > 0 ? 'ana' : 'kata') === c.side ? null : `claims ${b.name} lies ${c.side} of the slice; it is ${now}`;
  }
}

/** Everything wrong with the line on screen now, against the bodies' current readings. */
function wrongs(x: Experience): string[] {
  const v = x.view();
  if (v.event === null) return [];
  const out: string[] = [];
  for (const c of claimsOf(v.event)) {
    const b = v.bodies.find((q) => q.name.toLowerCase() === c.body.toLowerCase());
    if (!b) out.push(`claims something of “${c.body}”, which is not in this world`);
    else {
      const why = falsity(c, b);
      if (why) out.push(`${why} — line: “${v.event}”`);
    }
  }
  return out;
}

const reading = (x: Experience, id: string) => x.view().bodies.find((b) => b.id === id)!;
/** The meeting a reading shows, as the line would name it: through, a named boundary meeting, or a side outside. */
const shownAs = (b: BodyReading): string => b.status === 'outside' ? `outside ${b.gap > 0 ? 'ana' : 'kata'}` : `${b.status} ${meetingKey(b.meeting) ?? b.meeting.kind}`;

/**
 * Dispatch actions one at a time, as the page does, and hold the line to the readings after each. When the
 * body's meeting changed, the line must also make a claim about that body, unless `truthOnly` — the re-check's
 * own sequences ask only whether what stays on screen is true. Returns what the body was shown as after each
 * action.
 */
function run(x: Experience, id: string, actions: readonly Action[], label: string, truthOnly = false): string[] {
  const shown: string[] = [];
  for (const [k, a] of actions.entries()) {
    const before = shownAs(reading(x, id));
    x.dispatch(a);
    const b = reading(x, id);
    const after = shownAs(b);
    shown.push(after);
    expect(wrongs(x), `${label}, action ${k + 1} of ${actions.length} (${JSON.stringify(a)})`).toEqual([]);
    if (after !== before && !truthOnly) {
      const line = x.view().event;
      const about = line === null ? [] : claimsOf(line).filter((c) => c.body.toLowerCase() === b.name.toLowerCase());
      expect(about.length, `${label}, action ${k + 1}: ${before} → ${after} is said about the ${b.name.toLowerCase()} (line: ${line})`).toBeGreaterThan(0);
    }
  }
  return shown;
}

/** Arrows as the page sends them with no instrument focused. */
const arrow = (key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight', n: number, shift = false): Action[] =>
  Array.from({ length: n }, () => keyAction(key, shift, { playing: false, shadowOn: false, studyPlaying: false, facesCut: 0, face: null }) as Action);
/** Arrows on the focused gauge. */
const gaugeKey = (key: 'ArrowUp' | 'ArrowDown', n: number, shift = false): Action[] =>
  Array.from({ length: n }, () => sliderKey('gauge', key, shift)!);
/** One drag of the gauge's line from one offset to another: the pointer's moves, evenly spaced, then the release point. */
const drag = (from: number, to: number, moves = 12): Action[] =>
  Array.from({ length: moves + 1 }, (_, k) => INSTRUMENTS.gauge.act(from + ((to - from) * k) / moves));

describe('the oracle reads lines, and fails on a line that is false now', () => {
  it('parses every line form the copy says, and finds the stale lines the re-check found', () => {
    expect(claimsOf('Box now meets your slice only on its boundary — you moved your slice. The meeting is its +w face, a solid cuboid, and its cut is drawn.'))
      .toEqual([{ body: 'Box', kind: 'boundary', meeting: 'face +w', drawn: true }]);
    expect(claimsOf('Block now passes through your slice — you moved your slice, and its cut is drawn. Ball is in your slice.'))
      .toEqual([{ body: 'Block', kind: 'through' }, { body: 'Ball', kind: 'in' }]);
    expect(claimsOf('The box was struck by something your slice cannot show: the ball, then 0.01 ana of your slice. The box now lies kata of your slice.'))
      .toEqual([{ body: 'box', kind: 'outside', side: 'kata' }]);
    expect(() => claimsOf('Box is somewhere.')).toThrow(/does not know/);
    // The re-check's two readings, with the lines that were left on screen.
    const through = { name: 'Box', status: 'present', drawn: 48, meeting: { kind: 'through' }, gap: 0 } as unknown as BodyReading;
    const face = { name: 'Block', status: 'present', drawn: 12, meeting: { kind: 'boundary', body: 'box', dim: 3, sides: [4.4, 2.6, 1.6], face: '+w', rest: 'kata' }, gap: 0 } as unknown as BodyReading;
    expect(falsity({ body: 'Box', kind: 'boundary', meeting: 'face +w', drawn: true }, through)).toMatch(/meets it only on its boundary/);
    expect(falsity({ body: 'Block', kind: 'through' }, face)).toMatch(/passes through/);
    expect(falsity({ body: 'Block', kind: 'boundary', meeting: 'face +w', drawn: true }, face)).toBeNull();
  });
});

describe('a change between passing through and lying on a face is said, in the contact world', () => {
  it('the re-check’s keys: ↑ ×50 onto the +w face from inside, ↑ out, ↓ back on from outside, ↓ in — each line holds', () => {
    const x = createExperience('collision');
    const shown = run(x, 'box', [...arrow('ArrowUp', 50), ...arrow('ArrowUp', 1), ...arrow('ArrowDown', 1), ...arrow('ArrowDown', 1)], 'chapter III keys', true);
    expect(shown.slice(48)).toEqual(['present through', 'present face +w', 'outside kata', 'present face +w', 'present through']);
    expect(x.view().event).toBe('Box now passes through your slice — you moved your slice, and its cut is drawn.');
    x.dispose();
  });

  it('from the +w face, inward and down to the −w face, then back in: through, face and touching are each said', () => {
    const x = createExperience('collision');
    run(x, 'box', arrow('ArrowUp', 50), 'onto +w');
    const shown = run(x, 'box', [...arrow('ArrowDown', 100), ...arrow('ArrowUp', 1)], 'down to −w and back');
    expect(shown[0]).toBe('present through');
    expect(shown[99]).toBe('tangent face −w');
    expect(shown[100]).toBe('present through');
    x.dispose();
  });

  it('the focused gauge’s own arrows, Shift ×5 onto the +w face and one step back: the same', () => {
    const x = createExperience('collision');
    const shown = run(x, 'box', [...gaugeKey('ArrowUp', 5, true), ...gaugeKey('ArrowDown', 1)], 'gauge keys');
    expect(shown).toEqual(['present through', 'present through', 'present through', 'present through', 'present face +w', 'present through']);
    x.dispose();
  });

  it('a drag released on the +w face from inside, and from outside; then a drag back in', () => {
    const x = createExperience('collision');
    expect(run(x, 'box', drag(0, 1), 'drag up onto +w').at(-1)).toBe('present face +w');
    expect(run(x, 'box', drag(1, 0.3), 'drag in').at(-1)).toBe('present through');
    expect(run(x, 'box', drag(0.3, 1.5), 'drag out').at(-1)).toBe('outside kata');
    expect(run(x, 'box', drag(1.5, 1), 'drag back onto +w from outside').at(-1)).toBe('present face +w');
    expect(run(x, 'box', drag(1, 0.9, 3), 'short drag in').at(-1)).toBe('present through');
    x.dispose();
  });

  it('one drag from the kata limit to the face at +1.0, and the return: touching −w, through, face +w, and back', () => {
    const x = createExperience('collision');
    expect(run(x, 'box', drag(0, -1), 'to −w').at(-1)).toBe('tangent face −w');
    const there = run(x, 'box', drag(-1, 1), 'across');
    expect(there[1]).toBe('present through');
    expect(there.at(-1)).toBe('present face +w');
    const back = run(x, 'box', drag(1, -1), 'return');
    expect(back[1]).toBe('present through');
    expect(back.at(-1)).toBe('tangent face −w');
    x.dispose();
  });

  it('direct endpoint transitions, each one action: through → face, face → through, touching → face, face → touching, outside → face', () => {
    const x = createExperience('collision');
    const g = INSTRUMENTS.gauge.act;
    expect(run(x, 'box', [g(1), g(0.5), g(1), g(-1), g(1), g(1.4), g(1)], 'direct'))
      .toEqual(['present face +w', 'present through', 'present face +w', 'tangent face −w', 'present face +w', 'outside kata', 'present face +w']);
    x.dispose();
  });

  it('turned 90°: the slice onto the −x face from inside and from outside, and in again', () => {
    const x = createExperience('collision');
    run(x, 'box', arrow('ArrowRight', 9, true), 'turn to 90°');
    const shown = run(x, 'box', [...arrow('ArrowUp', 60), ...arrow('ArrowUp', 1), ...arrow('ArrowDown', 1), ...arrow('ArrowDown', 1)], 'turned keys');
    expect(shown.slice(58)).toEqual(['present through', 'present face −x', 'outside kata', 'present face −x', 'present through']);
    x.dispose();
  });
});

describe('a change between passing through and lying on a face is said, in the turning world', () => {
  it('the re-check’s drag: Shift+↓ ×8 to the kata limit, then one drag to the ana limit — the line names the +w face', () => {
    const x = createExperience('cuts');
    expect(run(x, 'block', arrow('ArrowDown', 8, true), 'to the kata limit', true).at(-1)).toBe('tangent face −w');
    // As in the re-check, the pointer's first move takes the slice into the block and past the ball's near side
    // (w = 0.2) at once; it is dragged on past the gauge's end, and the slice stops at the slider's limit, on the face.
    const shown = run(x, 'block', drag(-1.6, 2.6, 2), 'across to the ana limit', true);
    expect(shown).toEqual(['tangent face −w', 'present through', 'present face +w']);
    expect(x.view().event).toBe('Block now meets your slice only on its boundary — you moved your slice. The meeting is its +w face, a solid cuboid, and its cut is drawn.');
    const back = run(x, 'block', drag(1.6, -2.6, 2), 'the return', true);
    expect(back).toEqual(['present face +w', 'present through', 'tangent face −w']);
    x.dispose();
  });

  it('a drag of twelve moves from the kata limit to the ana limit, and back: every change of the block’s meeting is said', () => {
    const x = createExperience('cuts');
    run(x, 'block', arrow('ArrowDown', 8, true), 'to the kata limit');
    const shown = run(x, 'block', drag(-1.6, 3), 'across to the ana limit');
    expect(shown[1]).toBe('present through');
    expect(shown.at(-1)).toBe('present face +w');
    const back = run(x, 'block', drag(1.6, -3), 'the return');
    expect(back[1]).toBe('present through');
    expect(back.at(-1)).toBe('tangent face −w');
    x.dispose();
  });

  it('keys from inside onto the +w face, a step in, and back on by small steps', () => {
    const x = createExperience('cuts');
    const shown = run(x, 'block', [...arrow('ArrowUp', 8, true), ...arrow('ArrowDown', 1, true), ...arrow('ArrowUp', 10)], 'keys');
    expect(shown[7]).toBe('present face +w');
    expect(shown[8]).toBe('present through');
    expect(shown.at(-1)).toBe('present face +w');
    x.dispose();
  });

  it('direct endpoint transitions: through → face, face → through, touching → face, face → touching', () => {
    const x = createExperience('cuts');
    const g = INSTRUMENTS.gauge.act;
    expect(run(x, 'block', [g(1.6), g(1), g(1.6), g(-1.6), g(1.6), g(-1.6), g(0)], 'direct'))
      .toEqual(['present face +w', 'present through', 'present face +w', 'tangent face −w', 'present face +w', 'tangent face −w', 'present through']);
    x.dispose();
  });
});

describe('what changes nothing a line names says nothing', () => {
  it('steps inside the box, the same offset again, and the face re-entered by the same offset, say nothing new', () => {
    const x = createExperience('collision');
    run(x, 'box', arrow('ArrowUp', 49), 'inside');
    expect(x.view().event, 'nothing named has changed since launch').toBeNull();
    run(x, 'box', arrow('ArrowUp', 1), 'onto the face');
    const id = x.view().eventId;
    for (const a of [INSTRUMENTS.gauge.act(1), INSTRUMENTS.gauge.act(1 + 1e-12), INSTRUMENTS.gauge.act(1 - 1e-12)]) {
      x.dispatch(a);
      expect(x.view().eventId, `${JSON.stringify(a)}: still the +w face, nothing new is said`).toBe(id);
    }
    x.dispose();
  });

  it('the physics clock with the slice on the box’s +w face: the resting box is not said again before the blow, and every line holds', () => {
    const x = createExperience('collision');
    run(x, 'box', arrow('ArrowUp', 50), 'onto the face');
    x.dispatch({ type: 'play' });
    const impact = x.worlds.contact.impactStep()!;
    let ballSaid = 0;
    for (let k = 0; k < 900; k++) {
      const id = x.view().eventId;
      x.dispatch({ type: 'tick', seconds: 1 / 60 });
      const v = x.view();
      expect(wrongs(x), `tick ${k}`).toEqual([]);
      if (x.worlds.contact.sim.steps >= impact) continue;
      expect(shownAs(reading(x, 'box')), `tick ${k}: before the blow the box rests on the slice`).toBe('present face +w');
      if (v.eventId === id) continue;
      // The ball comes to touch the slice one step before the blow; that line is about the ball alone.
      expect(claimsOf(v.event!).map((c) => c.body.toLowerCase()), `tick ${k}: ${v.event}`).toEqual(['ball']);
      ballSaid++;
    }
    expect(ballSaid, 'the ball’s touch before the blow was said once').toBe(1);
    x.dispose();
  });

  it('chapter IV with the slice on the box’s +w face: the turning box leaves the face, and every line holds', () => {
    const x = createExperience('spin');
    run(x, 'box', arrow('ArrowUp', 50), 'onto the face');
    expect(shownAs(reading(x, 'box'))).toBe('present face +w');
    x.dispatch({ type: 'play' });
    const seen = new Set<string>();
    for (let k = 0; k < 900; k++) {
      x.dispatch({ type: 'tick', seconds: 1 / 60 });
      seen.add(shownAs(reading(x, 'box')));
      expect(wrongs(x), `tick ${k}`).toEqual([]);
    }
    expect(seen.size, `the box was shown as ${[...seen].join(', ')}`).toBeGreaterThan(1);
    x.dispose();
  });
});
