import { assert, describe, expect, it } from 'vitest';
import { createExperience, type Action } from '../../src/hidden-direction/experience.js';
import { BUTTONS, INSTRUMENTS, keyAction, sliderKey } from '../../src/hidden-direction/bindings.js';
import { PRESETS } from '../../src/spatial-4d-contact/simulation.js';
import type { Meeting } from '../../src/hidden-direction/worlds.js';

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
 * gap. A sentence that reports a change also says what came before: "appeared" (the slice did not meet it),
 * "now passes through" (it met it already), "vanished" (it was met), "is still not in your slice" (it was
 * outside, on the other side); that is checked against the reading before the action. Sentences about the past
 * (the blow, a replay) claim nothing about now and are skipped. A sentence the parser does not know fails, so a
 * change of wording cannot pass by claiming nothing.
 *
 * What a reading shows, for these checks, is its status, its meeting as a line names it, and its side outside
 * (`shownAs`). After every action of every sequence:
 *   - every claim of the line on screen holds;
 *   - a body whose shown meeting changed is spoken of in the new line, and if the line's own sentence for it is a
 *     full one, it names the new meeting — a drawn face as that face, not merely "in your slice";
 *   - a full sentence names what did it: "you moved your slice" for a view action, the orbit or "it moved" for the
 *     clocks, "the run was replayed from launch to step N" for a replay, "launch X was started afresh" for a launch;
 *   - when a body's status changed (or its side, outside), the line leads with such a body, and a change of the
 *     meeting alone follows;
 *   - when nothing shown changed, nothing new is said (a replay or a launch is always said, as itself).
 * The clock is held to the same, except that at the blow the blow's line may give the ball's state itself.
 *
 * The input is the page's own: arrows as `keyAction` and the focused gauge's `sliderKey` send them, gauge drags as
 * the series of offsets a pointer sends (`INSTRUMENTS.gauge.act`), ending where the pointer is released, map turns
 * as `INSTRUMENTS.turn.act`, and the clock's buttons as their bindings send them.
 *
 * Where the faces are (authored half extents): the contact box's w faces at ±1.0 at launch, its x faces at ±1.2
 * with the slice turned ±90°; the turning world's block w faces at ±1.6, which are the slider's own limits — so
 * the block's faces are reached from inside only, and from outside only in the contact world.
 */

type Experience = ReturnType<typeof createExperience>;
type Reading = ReturnType<Experience['view']>['bodies'][number];
type Side = 'ana' | 'kata';
/** The change a full sentence reports; null for the brief state said after another sentence. */
type Change = 'appeared' | 'entered' | 'face' | 'touching' | 'vanished' | 'crossed' | null;

/**
 * What the line claims about a body now. `meeting` is a phrase key (see `phraseKey`); null when the line names none.
 * `cause` is what a full sentence says did the change; null for a brief.
 */
type Claim = { readonly body: string; readonly change: Change; readonly cause: string | null } & (
  | { readonly kind: 'in' }
  | { readonly kind: 'through' }
  | { readonly kind: 'boundary'; readonly meeting: string | null; readonly drawn: boolean | null }
  | { readonly kind: 'point' }
  | { readonly kind: 'outside'; readonly side: Side }
);

/** Every clause a line uses to say what did a change, captured. */
const CAUSE = String.raw`(you moved your slice|it moved along its prescribed orbit|it moved|the run was replayed from launch to step \d+|launch [A-Z] was started afresh, at step 0)`;

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
  if (!key) assert.fail(`unknown meeting phrase: “${phrase}”`);
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
  { re: new RegExp(`^(\\w+) appeared — ${CAUSE}, and now your slice cuts it\\.`), claims: (m) => [{ body: m[1]!, change: 'appeared', cause: m[2]!, kind: 'in' }] },
  { re: new RegExp(`^(\\w+) now passes through your slice — ${CAUSE}, and its cut is drawn\\.`), claims: (m) => [{ body: m[1]!, change: 'entered', cause: m[2]!, kind: 'through' }] },
  {
    re: new RegExp(`^(\\w+) now meets your slice only on its boundary — ${CAUSE}\\. The meeting is (.+?), and its cut is drawn\\.`),
    claims: (m) => [{ body: m[1]!, change: 'face', cause: m[2]!, kind: 'boundary', meeting: phraseKey(m[3]!), drawn: true }]
  },
  {
    re: new RegExp(`^(\\w+) now meets your slice only on its boundary — ${CAUSE}\\. The meeting is (.+?); nothing is drawn for it\\.`),
    claims: (m) => [{ body: m[1]!, change: 'touching', cause: m[2]!, kind: 'boundary', meeting: phraseKey(m[3]!), drawn: false }]
  },
  { re: new RegExp(`^(\\w+) is touching your slice at a single point — ${CAUSE}\\. Only a marker is drawn\\.`), claims: (m) => [{ body: m[1]!, change: 'touching', cause: m[2]!, kind: 'point' }] },
  {
    re: new RegExp(`^(\\w+) vanished from your slice — ${CAUSE}; the (\\w+) now lies (ana|kata) of your slice\\. It has not gone\\.`),
    claims: (m) => [{ body: m[1]!, change: 'vanished', cause: m[2]!, kind: 'outside', side: m[4] as Side }]
  },
  {
    re: new RegExp(`^(\\w+) is still not in your slice — ${CAUSE}; the (\\w+) now lies (ana|kata) of your slice\\.`),
    claims: (m) => [{ body: m[1]!, change: 'crossed', cause: m[2]!, kind: 'outside', side: m[4] as Side }]
  },
  // What a change left a body as, said after another sentence.
  { re: /^The (\w+) now lies (ana|kata) of your slice\./, claims: (m) => [{ body: m[1]!, change: null, cause: null, kind: 'outside', side: m[2] as Side }] },
  { re: /^(\w+) is touching your slice at a single point\./, claims: (m) => [{ body: m[1]!, change: null, cause: null, kind: 'point' }] },
  { re: /^(\w+) now meets your slice only on its boundary: (.+?)\./, claims: (m) => [{ body: m[1]!, change: null, cause: null, kind: 'boundary', meeting: phraseKey(m[2]!), drawn: null }] },
  { re: /^(\w+) is in your slice\./, claims: (m) => [{ body: m[1]!, change: null, cause: null, kind: 'in' }] },
  // About the past, or about the run: nothing about now.
  { re: /^The box was struck — by the ball, then in your slice\./, claims: () => [] },
  { re: /^The box was struck by something your slice cannot show: the ball, then .+? (?:ana|kata) of your slice\./, claims: () => [] },
  { re: /^Replayed from launch to step \d+, the blow: the box was struck there — by the ball, then in your slice\./, claims: () => [] },
  { re: /^Replayed from launch to step \d+, the blow: the box was struck there by something your slice cannot show: the ball, then .+? (?:ana|kata) of your slice\./, claims: () => [] },
  { re: /^The run was replayed from launch to step \d+\./, claims: () => [] },
  { re: /^Launch [A-Z] was started afresh, at step 0\./, claims: () => [] }
];

/** Every claim a line makes about now, sentence by sentence. A sentence no form knows fails the test. */
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
    if (!matched) assert.fail(`a sentence the oracle does not know: “${rest}”`);
  }
  return out;
}

const sideOf = (b: Reading): Side => (b.gap > 0 ? 'ana' : 'kata');
const describe_ = (b: Reading): string => `${b.status}, ${b.drawn} drawn, meeting ${meetingKey(b.meeting) ?? b.meeting.kind}, gap ${b.gap}`;

/** Why a claim is false of a body's reading now, or null when it holds. */
function falsity(c: Claim, b: Reading): string | null {
  const now = describe_(b);
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
      return b.status === 'outside' && sideOf(b) === c.side ? null : `claims ${b.name} lies ${c.side} of the slice; it is ${now}`;
  }
}

/** Why what a full sentence says came before is false of the body's reading before the action, or null. */
function priorFalsity(c: Claim, was: Reading): string | null {
  const then = describe_(was);
  switch (c.change) {
    case 'appeared': return was.status === 'outside' ? null : `says ${was.name} appeared, but the slice met it before: ${then}`;
    case 'entered': return was.status !== 'outside' ? null : `says ${was.name} now passes through as if the slice met it before, but it was ${then}`;
    case 'vanished': return was.status !== 'outside' ? null : `says ${was.name} vanished, but it was already outside: ${then}`;
    case 'crossed':
      return was.status === 'outside' && c.kind === 'outside' && sideOf(was) !== c.side ? null : `says ${was.name} is still not in the slice, now on the other side, but it was ${then}`;
    default: return null;
  }
}

/** The meeting a reading shows, as the line would name it: its status with the meeting, or a side outside. */
const shownAs = (b: Reading): string => b.status === 'outside' ? `outside ${sideOf(b)}` : `${b.status} ${meetingKey(b.meeting) ?? b.meeting.kind}`;

/** Why a full sentence about a changed body says less than the new meeting, or null: a drawn face is said as that face. */
function vagueness(c: Claim, b: Reading): string | null {
  if (c.change === null) return null;
  const face = b.status !== 'outside' && b.meeting.kind !== 'through';
  if (face && c.kind !== 'boundary' && c.kind !== 'point') return `says ${b.name} is ${c.kind}, but its new meeting is ${shownAs(b)}, which the line must name`;
  return null;
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

/** A reading's status, with its side when outside: what a change of status is, as against a change of meeting alone. */
const statusOf = (b: Reading): string => (b.status === 'outside' ? `outside ${sideOf(b)}` : b.status);
/** Sentences that open a line without a claim about now: the blow, a replay, a launch. */
const NO_CLAIM_LEAD = /^(The box was struck|Replayed from launch|The run was replayed|Launch [A-Z] was started)/;

/**
 * After one action or tick: the line holds now; a new line's report of a change agrees with what came before and
 * names what did it (`cause`); a body whose shown meeting changed is spoken of, and named if its sentence is a full
 * one; when a status changed, the line leads with it; and when nothing shown changed and `quiet`, nothing new is
 * said. `ballByBlow`: the blow's line may give the ball's state.
 */
function checkStep(x: Experience, before: readonly Reading[], idBefore: number, label: string, quiet: boolean, cause: RegExp, ballByBlow = false): void {
  const v = x.view();
  expect(wrongs(x), label).toEqual([]);
  const said = v.eventId !== idBefore;
  const claims = said && v.event !== null ? claimsOf(v.event) : [];
  const changed = v.bodies.filter((b) => { const was = before.find((q) => q.id === b.id); return was !== undefined && shownAs(was) !== shownAs(b); });
  if (said) {
    for (const c of claims) {
      const was = before.find((q) => q.name.toLowerCase() === c.body.toLowerCase());
      if (was) expect(priorFalsity(c, was), `${label}: “${v.event}”`).toBeNull();
      if (c.cause !== null) expect(c.cause, `${label}: what did it, in “${v.event}”`).toMatch(cause);
    }
    const restatused = changed.filter((b) => statusOf(before.find((q) => q.id === b.id)!) !== statusOf(b));
    if (restatused.length > 0 && v.event !== null && !NO_CLAIM_LEAD.test(v.event)) {
      const lead = claims[0]?.body.toLowerCase();
      expect(restatused.map((b) => b.name.toLowerCase()), `${label}: a change of status leads “${v.event}”`).toContain(lead);
    }
  }
  for (const b of changed) {
    const about = claims.filter((c) => c.body.toLowerCase() === b.name.toLowerCase());
    if (about.length === 0 && ballByBlow && b.id === 'ball' && /struck/.test(v.event ?? '')) continue;
    expect(about.length, `${label}: ${shownAs(before.find((q) => q.id === b.id)!)} → ${shownAs(b)} is said about the ${b.name.toLowerCase()} (line: ${said ? v.event : 'not new'})`).toBeGreaterThan(0);
    for (const c of about) expect(vagueness(c, b), `${label}: “${v.event}”`).toBeNull();
  }
  if (quiet && changed.length === 0) expect(said, `${label}: nothing shown changed, so nothing new is said (line: ${v.event})`).toBe(false);
}

/**
 * Dispatch view actions one at a time, as the page does, holding each to `checkStep`; with `truthOnly`, only the
 * line's truth now is held — the re-check's own sequences ask whether what stays on screen is true. Returns what
 * the body was shown as after each action.
 */
function run(x: Experience, id: string, actions: readonly Action[], label: string, truthOnly = false): string[] {
  const shown: string[] = [];
  for (const [k, a] of actions.entries()) {
    const before = x.view().bodies;
    const idBefore = x.view().eventId;
    x.dispatch(a);
    shown.push(shownAs(reading(x, id)));
    const at = `${label}, action ${k + 1} of ${actions.length} (${JSON.stringify(a)})`;
    if (truthOnly) expect(wrongs(x), at).toEqual([]);
    else checkStep(x, before, idBefore, at, true, /^you moved your slice$/);
  }
  return shown;
}

/** Play the clock in front for n ticks of 1/60 s, holding each tick to `checkStep`; returns what the body was shown as, and at which physics step. */
function play(x: Experience, id: string, ticks: number, label: string): { shown: string; step: number }[] {
  x.dispatch({ type: 'play' });
  const shown: { shown: string; step: number }[] = [];
  for (let k = 0; k < ticks; k++) {
    const before = x.view().bodies;
    const idBefore = x.view().eventId;
    const impacts = x.worlds.contact.sim.impacts;
    x.dispatch({ type: 'tick', seconds: 1 / 60 });
    const blow = x.worlds.contact.sim.impacts > impacts;
    shown.push({ shown: shownAs(reading(x, id)), step: x.worlds.contact.sim.steps });
    // The blow is said even where no body's shown meeting changes; any other new line answers a change.
    const cause = x.view().world === 'turn' ? /^it moved along its prescribed orbit$/ : /^it moved$/;
    checkStep(x, before, idBefore, `${label}, tick ${k}`, !blow, cause, blow);
  }
  return shown;
}

/** A clock button's action, as its binding sends it. */
const button = (id: string): Action => BUTTONS.find((b) => b.id === id)!.act({ playing: false, shadowOn: false, studyPlaying: false, facesCut: [], face: null })!;

/**
 * The collision's clock by its buttons: a step is motion; Step −1, *Just before the blow* and the empty view's
 * *Replay to just after the blow* are replays from launch to the step they land on; *Replay launch* and a launch
 * start a run afresh. A replay or a launch is always said, as itself or with what it changed; a step must be quiet
 * when nothing shown changed.
 */
function press(x: Experience, actions: readonly Action[], label: string): string[] {
  const shown: string[] = [];
  for (const [k, a] of actions.entries()) {
    const before = x.view().bodies;
    const idBefore = x.view().eventId;
    const impacts = x.worlds.contact.sim.impacts;
    x.dispatch(a);
    const steps = x.worlds.contact.sim.steps;
    const blow = x.worlds.contact.sim.impacts > impacts;
    shown.push(shownAs(reading(x, 'box')));
    const at = `${label}, action ${k + 1} (${JSON.stringify(a)})`;
    const letter = a.type === 'preset' ? PRESETS.find((p) => p.id === a.id)!.name.charAt(0) : null;
    const cause = a.type === 'step' ? /^it moved$/
      : letter !== null ? new RegExp(`^launch ${letter} was started afresh, at step 0$`)
      : new RegExp(`^the run was replayed from launch to step ${steps}$`);
    checkStep(x, before, idBefore, at, a.type === 'step' && !blow, cause, blow);
    if (a.type !== 'step') expect(x.view().eventId, `${at}: a replay or a launch is said`).not.toBe(idBefore);
  }
  return shown;
}

/** Arrows as the page sends them with no instrument focused. */
const arrow = (key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight', n: number, shift = false): Action[] =>
  Array.from({ length: n }, () => keyAction(key, shift, { playing: false, shadowOn: false, studyPlaying: false, facesCut: [], face: null }) as Action);
/** Arrows on the focused gauge. */
const gaugeKey = (key: 'ArrowUp' | 'ArrowDown', n: number, shift = false): Action[] =>
  Array.from({ length: n }, () => sliderKey('gauge', key, shift)!);
/** One drag of the gauge's line from one offset to another: the pointer's moves, evenly spaced, then the release point. */
const drag = (from: number, to: number, moves = 12): Action[] =>
  Array.from({ length: moves + 1 }, (_, k) => INSTRUMENTS.gauge.act(from + ((to - from) * k) / moves));
/** A turn of the slice on the map, degree by degree. */
const turns = (from: number, to: number): Action[] =>
  Array.from({ length: Math.abs(to - from) + 1 }, (_, k) => INSTRUMENTS.turn.act(from + Math.sign(to - from) * k));

describe('the oracle reads lines, and fails on a line that is false now', () => {
  it('parses every line form the copy says, and finds the stale lines the re-check found', () => {
    expect(claimsOf('Box now meets your slice only on its boundary — you moved your slice. The meeting is its +w face, a solid cuboid, and its cut is drawn.'))
      .toEqual([{ body: 'Box', change: 'face', cause: 'you moved your slice', kind: 'boundary', meeting: 'face +w', drawn: true }]);
    expect(claimsOf('Block now passes through your slice — you moved your slice, and its cut is drawn. Ball is in your slice.'))
      .toEqual([{ body: 'Block', change: 'entered', cause: 'you moved your slice', kind: 'through' }, { body: 'Ball', change: null, cause: null, kind: 'in' }]);
    expect(claimsOf('The box was struck by something your slice cannot show: the ball, then 0.01 ana of your slice. The box now lies kata of your slice.'))
      .toEqual([{ body: 'box', change: null, cause: null, kind: 'outside', side: 'kata' }]);
    expect(claimsOf('Ball appeared — you moved your slice, and now your slice cuts it. Box now meets your slice only on its boundary: its +x face, a solid cuboid.'))
      .toEqual([{ body: 'Ball', change: 'appeared', cause: 'you moved your slice', kind: 'in' }, { body: 'Box', change: null, cause: null, kind: 'boundary', meeting: 'face +x', drawn: null }]);
    expect(() => claimsOf('Box is somewhere.')).toThrow(/does not know/);
    // The re-check's two readings, with the lines that were left on screen.
    const through = { name: 'Box', status: 'present', drawn: 48, meeting: { kind: 'through' }, gap: 0 } as unknown as Reading;
    const face = { name: 'Block', status: 'present', drawn: 12, meeting: { kind: 'boundary', body: 'box', dim: 3, sides: [4.4, 2.6, 1.6], face: '+w', rest: 'kata' }, gap: 0 } as unknown as Reading;
    const said = 'you moved your slice';
    expect(falsity({ body: 'Box', change: 'face', cause: said, kind: 'boundary', meeting: 'face +w', drawn: true }, through)).toMatch(/meets it only on its boundary/);
    expect(falsity({ body: 'Block', change: 'entered', cause: said, kind: 'through' }, face)).toMatch(/passes through/);
    expect(falsity({ body: 'Block', change: 'face', cause: said, kind: 'boundary', meeting: 'face +w', drawn: true }, face)).toBeNull();
    // What came before: an appearance from a face, and a drawn face said only as "in your slice".
    expect(priorFalsity({ body: 'Block', change: 'appeared', cause: said, kind: 'in' }, face)).toMatch(/met it before/);
    expect(vagueness({ body: 'Block', change: 'appeared', cause: said, kind: 'in' }, face)).toMatch(/must name/);
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

  it('the same keys, with every change said and named', () => {
    const x = createExperience('collision');
    run(x, 'box', [...arrow('ArrowUp', 50), ...arrow('ArrowUp', 1), ...arrow('ArrowDown', 1), ...arrow('ArrowDown', 1)], 'chapter III keys');
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

  it('one map move from +90° to −90° keeps the offset and changes only the face: drawn −x to +x at +1.2, touching +x to −x at −1.2, and back', () => {
    // The map folds a turn into ±90°, and a pointer on its centre column reads exactly +90 above the centre and −90
    // below it, so one move takes the slice from one to the other.
    const x = createExperience('collision');
    run(x, 'box', [INSTRUMENTS.turn.act(90), INSTRUMENTS.gauge.act(1.2)], 'onto −x');
    expect(run(x, 'box', [INSTRUMENTS.turn.act(-90), INSTRUMENTS.turn.act(90)], 'flip at +1.2')).toEqual(['present face +x', 'present face −x']);
    expect(x.view().event).toBe('Box now meets your slice only on its boundary — you moved your slice. The meeting is its −x face, a solid cuboid, and its cut is drawn.');
    run(x, 'box', [INSTRUMENTS.gauge.act(-1.2)], 'onto +x, not drawn');
    expect(run(x, 'box', [INSTRUMENTS.turn.act(-90), INSTRUMENTS.turn.act(90)], 'flip at −1.2')).toEqual(['tangent face −x', 'tangent face +x']);
    expect(x.view().event).toBe('Box now meets your slice only on its boundary — you moved your slice. The meeting is its +x face, a solid cuboid; nothing is drawn for it.');
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

  it('the same drag, with every change said and named', () => {
    const x = createExperience('cuts');
    run(x, 'block', arrow('ArrowDown', 8, true), 'to the kata limit');
    run(x, 'block', [...drag(-1.6, 2.6, 2), ...drag(1.6, -2.6, 2)], 'across and back');
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

describe('a change of status leads; a change of the meeting alone follows it', () => {
  it('one press above the ana limit in chapter I: the ball appears, and the block’s face follows as a brief', () => {
    const x = createExperience('arrival');
    run(x, 'block', [INSTRUMENTS.gauge.act(2)], 'past the limit');
    expect(x.view().event).toBe('Ball appeared — you moved your slice, and now your slice cuts it. Block now meets your slice only on its boundary: its +w face, a solid cuboid.');
    x.dispose();
  });

  it('back to the centre from the +w face: the ball vanishes, and the block passing through follows as a brief', () => {
    const x = createExperience('arrival');
    run(x, 'block', [...arrow('ArrowUp', 8, true), { type: 'cut-reset' }], 'up and reset');
    expect(x.view().event).toBe('Ball vanished from your slice — you moved your slice; the ball now lies ana of your slice. It has not gone. Block is in your slice.');
    x.dispose();
  });
});

describe('the contact world: a change of status leads, and a face-to-face brief names the new face', () => {
  it('turned 90° on the −x face, then R: the ball crossing to the ana side leads, and the box passing through follows', () => {
    const x = createExperience('collision');
    run(x, 'box', [...arrow('ArrowRight', 9, true), ...arrow('ArrowUp', 60), { type: 'cut-reset' }], 'turn, up, reset');
    expect(x.view().event).toBe('Ball is still not in your slice — you moved your slice; the ball now lies ana of your slice. Box is in your slice.');
    x.dispose();
  });

  it('chapter IV, on the +x face at −1.2, nothing drawn: one map move to −90° and back — the ball vanishes and appears, and the touching box’s brief names its face', () => {
    const x = createExperience('spin');
    run(x, 'box', [INSTRUMENTS.turn.act(90), INSTRUMENTS.gauge.act(-1.2)], 'onto +x, not drawn');
    run(x, 'box', [INSTRUMENTS.turn.act(-90)], 'flip');
    expect(x.view().event).toBe('Ball vanished from your slice — you moved your slice; the ball now lies ana of your slice. It has not gone. Box now meets your slice only on its boundary: its −x face, a solid cuboid.');
    run(x, 'box', [INSTRUMENTS.turn.act(90)], 'flip back');
    expect(x.view().event).toBe('Ball appeared — you moved your slice, and now your slice cuts it. Box now meets your slice only on its boundary: its +x face, a solid cuboid.');
    x.dispose();
  });

  it('chapter IV, on the −x face at +1.2, one map move to −90°: the ball appears, and the box’s brief names its +x face', () => {
    const x = createExperience('spin');
    run(x, 'box', [INSTRUMENTS.turn.act(90), INSTRUMENTS.gauge.act(1.2), INSTRUMENTS.turn.act(-90)], 'onto −x, then flip');
    expect(x.view().event).toBe('Ball appeared — you moved your slice, and now your slice cuts it. Box now meets your slice only on its boundary: its +x face, a solid cuboid.');
    x.dispose();
  });
});

describe('the clock’s buttons: a step is motion, a replay or a launch says itself, and every change is said', () => {
  it('chapter III at its start: Replay launch and a launch that change nothing shown, Step +1 until the moving box lies on the slice, Step −1, Just before the blow, Replay launch, each launch, and the empty view’s replay to just after the blow', () => {
    const x = createExperience('collision');
    const step = button('hd-step');
    // At launch nothing a body line names changes, so each is said as itself.
    expect(x.worlds.contact.presetId, 'chapter III opens on launch A').toBe('central');
    const at = x.view().eventId;
    press(x, [button('hd-replay'), button('hd-preset-a')], 'at launch');
    expect(x.view().eventId, 'both are said').toBe(at + 2);
    const shown = press(x, Array.from({ length: 162 }, () => step), 'steps');
    expect(shown.at(-1), 'the box comes to lie on the slice by the clock').toBe('present face +w');
    expect(x.view().event).toBe('Box now meets your slice only on its boundary — it moved. The meeting is its +w face, a solid cuboid, and its cut is drawn.');
    press(x, [button('hd-step-back')], 'step back');
    expect(x.view().event).toBe('Box now passes through your slice — the run was replayed from launch to step 161, and its cut is drawn.');
    press(x, [...Array.from({ length: 2 }, () => step), button('hd-jump'), ...Array.from({ length: 100 }, () => step),
      button('hd-replay'), ...Array.from({ length: 162 }, () => step), button('hd-preset-a'), ...Array.from({ length: 162 }, () => step),
      button('hd-preset-b')], 'buttons');
    expect(x.view().event).toMatch(/launch B was started afresh, at step 0/);
    // Stepped on until the bodies are beyond the slider's reach, the empty view offers the replay; its button sends
    // the action the view gives.
    const offered = (): Action | null => x.view().empty?.recoveries.find((r) => r.label === 'Replay to just after the blow')?.action ?? null;
    let stepped = 0;
    while (offered() === null && stepped < 2000) { press(x, [step], `launch B, step ${++stepped}`); }
    const replay = offered();
    expect(replay, 'the empty view offers the replay').not.toBeNull();
    press(x, [replay!], 'the empty view’s replay');
    expect(x.view().event).toMatch(/^Replayed from launch to step \d+, the blow/);
    x.dispose();
  });

  it('chapter III with the slice at +1.6: the clock carries the ball from touching to passing through, said as such', () => {
    const x = createExperience('collision');
    run(x, 'box', arrow('ArrowUp', 8, true), 'to +1.6');
    play(x, 'ball', 240, 'chapter III at +1.6');
    x.dispose();
  });

  it('a turned slice set on the box’s greatest height meets a drawn flat face; a step in passes through it', () => {
    const x = createExperience('collision');
    run(x, 'box', [INSTRUMENTS.turn.act(30)], 'turn 30°');
    const high = reading(x, 'box').high;
    expect(run(x, 'box', [INSTRUMENTS.gauge.act(high), INSTRUMENTS.gauge.act(high - 0.1), INSTRUMENTS.gauge.act(high)], 'ridge'))
      .toEqual(['present dim 2', 'present through', 'present dim 2']);
    x.dispose();
  });
});

describe('what changes nothing a line names says nothing', () => {
  it('steps inside the box, the same offset again, and the face re-entered by the same offset, say nothing new', () => {
    const x = createExperience('collision');
    run(x, 'box', arrow('ArrowUp', 49), 'inside');
    expect(x.view().event, 'nothing named has changed since launch').toBeNull();
    run(x, 'box', [...arrow('ArrowUp', 1), INSTRUMENTS.gauge.act(1), INSTRUMENTS.gauge.act(1 + 1e-12), INSTRUMENTS.gauge.act(1 - 1e-12)], 'onto the face, and again');
    x.dispose();
  });

  it('turns degree by degree inside both bodies, where the drawn cut changes its primitives but not its meeting, say nothing', () => {
    for (const [chapter, id] of [['collision', 'box'], ['cuts', 'block']] as const) {
      for (const offset of [0, 0.5, -0.5, 0.9, -0.9]) {
        const x = createExperience(chapter);
        run(x, id, [INSTRUMENTS.gauge.act(offset), ...turns(0, 90), ...turns(90, -90), ...arrow('ArrowRight', 9, true)], `${chapter} at ${offset}`);
        x.dispose();
      }
    }
  });

  it('the physics clock with the slice on the box’s +w face: quiet but for the ball’s touch before the blow, and every change after it said', () => {
    const x = createExperience('collision');
    run(x, 'box', arrow('ArrowUp', 50), 'onto the face');
    const impact = x.worlds.contact.impactStep()!;
    const shown = play(x, 'box', 900, 'chapter III');
    const before = shown.filter((s) => s.step < impact);
    expect(before.length).toBeGreaterThan(30);
    expect(before.every((s) => s.shown === 'present face +w'), 'before the blow the box rests on the slice').toBe(true);
    x.dispose();
  });

  it('chapter IV, from its start and from the box’s +w face: the turning box’s every change is said, and nothing else', () => {
    const from = createExperience('spin');
    play(from, 'box', 900, 'chapter IV from its start');
    from.dispose();
    const x = createExperience('spin');
    run(x, 'box', arrow('ArrowUp', 50), 'onto the face');
    const shown = new Set(play(x, 'box', 900, 'chapter IV from the face').map((s) => s.shown));
    expect(shown.size, `the box was shown as ${[...shown].join(', ')}`).toBeGreaterThan(1);
    x.dispose();
  });

  it('the orbit in chapter I: the ball’s every change is said, and nothing else', () => {
    const x = createExperience('arrival');
    play(x, 'companion', 760, 'chapter I');
    x.dispose();
  });
});
