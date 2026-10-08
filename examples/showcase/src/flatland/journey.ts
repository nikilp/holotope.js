import {
  ON_PLANE_EPSILON, RUNGS, createPlaneWorld, createSpaceWorld,
  type Corner, type CutSummary, type Layer, type Meeting, type PlaneWorldT, type RungId, type Shadow, type SpaceWorldT, type World
} from './world.js';
import type { SectionSimplexGroupNDiagnosticsN } from '@holotope/core';
import {
  WORDS, capitalise, cornerReason, cornerSentence, count, cutPhrase, distance, eventLine, meetingSentence,
  poseInSentence, shadowSentence, type Cause, type PoseName
} from './copy.js';

/**
 * The journey's controller: chapters, hands, predictions and the event line,
 * with no DOM and no renderer, so that every claim the page makes can be held
 * by a test against the same numbers the page draws.
 *
 * ## Four hands, four things
 *
 * - **Look** (`look`, `show-object`) is the camera, and what the picture
 *   includes. The camera lives in the stage, not here; `look` exists so the
 *   page can say, once, that looking changed nothing, and `show-object` hides
 *   the cube from the picture, never from the world. Neither touches a world.
 * - **Turn** (`tip-to`, `tip-step`, `pose`) poses the object, rigidly.
 * - **Slide** (`slide-to`, `slide-step`, `slide-layer`, `play`) moves the
 *   slice along the missing direction.
 * - **Cast** (`shadow`) shows or hides the shadow. The shadow does not depend on
 *   where the slice is, only on the pose.
 *
 * A chapter grants some hands and not others; an action for a hand it has not
 * granted does nothing. `actions.test.ts` holds each hand to the things it may
 * change, bitwise.
 *
 * ## Chapters establish their stated state
 *
 * Entering a guided chapter, from anywhere and by any route, sets its rung,
 * pose, slide and shadow exactly as its setup sentence says, shows the object,
 * and clears its prediction. Free exploration keeps everything as it was left.
 * The camera is never reset by a chapter: "camera as you left it" is said every
 * time.
 */

export type ChapterId = 'through' | 'corner' | 'shadow' | 'up' | 'up-shadow' | 'free';
export type Hand = 'look' | 'turn' | 'slide' | 'cast';
export type PredictionId = 'middle-cut' | 'shadow-centre' | 'first-solid' | 'shadow-corner';

/** The slide's keyboard step. Steps land on the grid exactly: `k / 10`, never a running sum. */
export const SLIDE_STEP = 0.1;
/** The turn's keyboard step, in degrees; a step that would cross a named pose stops on it. */
export const TIP_STEP_DEG = 5;
/** How fast a passage moves the slice, in units per second. */
export const PASS_SPEED = 0.8;
/** How long a named pose takes to reach, in seconds; instant when motion is reduced. */
export const TURN_SECONDS = 0.7;
/**
 * How long a passage holds the slice at the object's middle, in seconds. The middle is where chapters II and IV look
 * for their answers (the regular hexagon, the octahedron), and a slice gliding past it would show it for no frame.
 */
export const MIDDLE_HOLD = 0.9;
/** Under reduced motion a passage moves in steps on the slide grid, one every this many seconds, and never glides. */
export const STEP_SECONDS = 0.35;

export interface ChapterSpec {
  readonly id: ChapterId;
  readonly numeral: string;
  readonly title: string;
  /** The chapter's rung; null in free exploration, where the rung is as left. */
  readonly rung: RungId | null;
  /** The stated state; null in free exploration. */
  readonly start: { readonly pose: PoseName; readonly offset: number; readonly shadow: boolean } | null;
  readonly hands: readonly Hand[];
  readonly prediction: PredictionId | null;
}

export const CHAPTERS: readonly ChapterSpec[] = [
  { id: 'through', numeral: 'I', title: 'Through the plane', rung: 'plane',
    start: { pose: 'facet', offset: -1.6, shadow: false }, hands: ['look', 'slide'], prediction: null },
  { id: 'corner', numeral: 'II', title: 'Stand it on a corner', rung: 'plane',
    start: { pose: 'corner', offset: -1.9, shadow: false }, hands: ['look', 'slide', 'turn'], prediction: 'middle-cut' },
  { id: 'shadow', numeral: 'III', title: 'Light from the missing direction', rung: 'plane',
    start: { pose: 'corner', offset: 0, shadow: true }, hands: ['look', 'slide', 'turn', 'cast'], prediction: 'shadow-centre' },
  // IV starts beyond the tesseract's farthest corner in every pose (2 from its centre), so a turn alone cuts nothing
  // and the question's slide is the visitor's to make.
  { id: 'up', numeral: 'IV', title: 'One rung up', rung: 'space',
    start: { pose: 'facet', offset: -2.1, shadow: false }, hands: ['look', 'slide', 'turn'], prediction: 'first-solid' },
  { id: 'up-shadow', numeral: 'V', title: 'Its shadow, one rung up', rung: 'space',
    start: { pose: 'facet', offset: 0, shadow: true }, hands: ['look', 'slide', 'turn', 'cast'], prediction: 'shadow-corner' },
  { id: 'free', numeral: '∞', title: 'Explore freely', rung: null, start: null, hands: ['look', 'slide', 'turn', 'cast'], prediction: null }
];

export const chapterById = (id: ChapterId): ChapterSpec => CHAPTERS.find((c) => c.id === id)!;

/** The page's earlier hashes, kept working: each lands on the chapter that carries its lesson now. */
export const OLD_HASHES: Readonly<Record<string, ChapterId>> = { section: 'corner', projection: 'shadow', tesseract: 'up' };

/** Whether a hash names a chapter, now or by one of the page's earlier names. Other hashes are in-page anchors. */
export function isRoute(hash: string): boolean {
  const key = hash.replace(/^#/, '');
  return CHAPTERS.some((c) => c.id === key) || Object.prototype.hasOwnProperty.call(OLD_HASHES, key);
}

/** A route: a chapter id, or one of the page's earlier hashes; anything else starts at the beginning. */
export function chapterFromHash(hash: string): ChapterId {
  const key = hash.replace(/^#/, '');
  if (CHAPTERS.some((c) => c.id === key)) return key as ChapterId;
  return Object.prototype.hasOwnProperty.call(OLD_HASHES, key) ? OLD_HASHES[key]! : 'through';
}

export interface PredictionChoice { readonly id: string; readonly label: string; }

export interface PredictionSpec {
  readonly id: PredictionId;
  readonly question: string;
  readonly choices: readonly PredictionChoice[];
}

export const PREDICTIONS: Record<PredictionId, PredictionSpec> = {
  'middle-cut': {
    id: 'middle-cut',
    question: 'Stood on a corner, halfway up: what will the plane meet?',
    choices: [{ id: 'triangle', label: 'A triangle' }, { id: 'square', label: 'A square' }, { id: 'hexagon', label: 'A hexagon' }]
  },
  'shadow-centre': {
    id: 'shadow-centre',
    question: 'How many of the cube’s corners land on the centre of its shadow?',
    choices: [{ id: '0', label: 'None' }, { id: '1', label: 'One' }, { id: '2', label: 'Two' }]
  },
  'first-solid': {
    id: 'first-solid',
    question: 'Corner first, just past that first corner: what will your space hold?',
    choices: [{ id: 'triangle', label: 'A triangle' }, { id: 'tetrahedron', label: 'A tetrahedron' }, { id: 'cube', label: 'A cube' }]
  },
  'shadow-corner': {
    id: 'shadow-corner',
    question: 'This shadow is a cube. How many of the tesseract’s corners land on each of its corners?',
    choices: [{ id: '1', label: 'One' }, { id: '2', label: 'Two' }, { id: '4', label: 'Four' }]
  }
};

/**
 * The corner rule, with its condition. Stood on one corner, an object meets the slice at that corner alone, and just
 * past it the slice crosses only that corner's edges: three for a cube, four for a tesseract. Face (cell) first or
 * edge first, several corners arrive together instead. The reveals say this, and stay on screen while the visitor
 * turns to the other poses, so `journey.test.ts` holds every clause to the first cut in each named pose.
 */
export const FIRST_CUT_CLAUSES = {
  plane: 'Stood on one corner, the cube meets the plane at that corner alone, so just past it the plane crosses only that corner’s '
    + 'three edges and the cut is a triangle; past the next three corners it crosses six. Face first or edge first, several corners '
    + 'arrive together, and the first cut is a square or a rectangle.',
  space: 'Turned corner first, the tesseract meets your space at that one corner alone, and a tesseract’s corner has four edges: just '
    + 'past it your space crosses those four, and four corners make a tetrahedron, as the cube’s three made a triangle in the plane. '
    + 'Cell first or edge first, several corners arrive together, and the first cut is a cube or a triangular prism.'
} as const;

/**
 * Ana and kata, as free exploration introduces them whenever its space is on show: a visitor may arrive there cold,
 * without chapter IV, whose setup says the same more briefly ({@link ANA_KATA_GUIDED}). The gauge and the dial draw
 * ana toward their top; the sentence says that is the drawing's convention, not a direction in the picture.
 */
export const ANA_KATA = 'Its two ways along the fourth direction, w, are called ana and kata; they are not up and down. The gauge and '
  + 'the dial draw ana toward their top, a convention of the drawing, not a direction in the picture.';

/**
 * The guided path's shorter introduction, in chapter IV's setup: the same three facts (ana and kata are the two ways
 * along w; they are not up and down; the gauge and the dial draw ana at their top, by the drawing's convention) in one
 * sentence, so the card's first action stays on the first screen at every supported size.
 */
export const ANA_KATA_GUIDED = 'Its two ways along the fourth, w, are ana and kata, not up and down, though the gauge and dial draw ana at the top.';

export type InspectTarget =
  | { readonly kind: 'cut-corner'; readonly index: number }
  | { readonly kind: 'shadow-point'; readonly index: number }
  | { readonly kind: 'corner'; readonly index: number };

export type Action =
  | { readonly type: 'chapter'; readonly id: ChapterId }
  | { readonly type: 'rung'; readonly id: RungId }
  | { readonly type: 'slide-to'; readonly offset: number }
  | { readonly type: 'slide-step'; readonly steps: number }
  | { readonly type: 'slide-layer'; readonly direction: 1 | -1 }
  | { readonly type: 'tip-to'; readonly angle: number }
  | { readonly type: 'tip-step'; readonly steps: number }
  | { readonly type: 'pose'; readonly pose: PoseName }
  | { readonly type: 'shadow'; readonly on: boolean }
  | { readonly type: 'show-object'; readonly on: boolean }
  | { readonly type: 'play' }
  | { readonly type: 'stop' }
  | { readonly type: 'tick'; readonly dt: number }
  | { readonly type: 'predict'; readonly choice: string }
  | { readonly type: 'inspect'; readonly target: InspectTarget | null }
  /** Point a point out, without picking it: it is marked, and what lands there stays unsaid. */
  | { readonly type: 'attend'; readonly target: InspectTarget | null }
  | { readonly type: 'look' }
  | { readonly type: 'reset' };

/** What each action may touch. Held apart by `actions.test.ts`: a view action changes nothing in any world. */
export const ACTION_KINDS: Record<Action['type'], 'chapter' | 'world' | 'shadow' | 'clock' | 'question' | 'view'> = {
  chapter: 'chapter', rung: 'chapter', reset: 'chapter',
  'slide-to': 'world', 'slide-step': 'world', 'slide-layer': 'world', 'tip-to': 'world', 'tip-step': 'world', pose: 'world', play: 'world',
  stop: 'clock', tick: 'clock',
  shadow: 'shadow',
  predict: 'question', inspect: 'question', attend: 'question',
  look: 'view', 'show-object': 'view'
};

/** The hand an action needs, or null when it needs none. A chapter that has not granted the hand ignores the action. */
export const HAND_OF: Record<Action['type'], Hand | null> = {
  chapter: null, rung: null, reset: null, stop: null, tick: null, predict: null, inspect: null, attend: null,
  'slide-to': 'slide', 'slide-step': 'slide', 'slide-layer': 'slide', play: 'slide',
  'tip-to': 'turn', 'tip-step': 'turn', pose: 'turn',
  shadow: 'cast',
  look: 'look', 'show-object': 'look'
};

export interface Inspection {
  readonly target: InspectTarget;
  readonly text: string;
  /** Source edges to light, as corner pairs. */
  readonly edges: readonly (readonly [number, number])[];
  /** Source corners to light. */
  readonly corners: readonly number[];
}

export interface EmptyNote {
  readonly headline: string;
  readonly ways: readonly { readonly label: string; readonly action: Action }[];
}

/** The dimensions on show, said apart: the world's, the slice's, the object's, the cut's and the shadow's. */
export interface Dimensions {
  readonly world: number;
  readonly slice: number;
  readonly object: number;
  /** The cut's own dimension; null when nothing is cut. */
  readonly cut: number | null;
  readonly shadow: number;
}

export interface View {
  readonly chapter: ChapterSpec;
  readonly rung: RungId;
  readonly words: (typeof WORDS)[RungId];
  /** The tip, radians, and the named pose it sits on exactly, if any. */
  readonly tip: number;
  readonly pose: PoseName | null;
  readonly offset: number;
  readonly reach: number;
  readonly extent: readonly [number, number];
  /** Where the corners lie along the missing direction: the heights where the cut can change. */
  readonly layers: readonly Layer[];
  readonly meeting: Meeting;
  readonly cut: CutSummary;
  /** The section's own accounting: the cells it examined, cut, passed over, and found collapsed. */
  readonly accounting: SectionSimplexGroupNDiagnosticsN;
  readonly corners: readonly Corner[];
  readonly shadowOn: boolean;
  /** The shadow, whether or not it is shown: it is a property of the pose, and the page measures it either way. */
  readonly shadow: Shadow;
  /**
   * While a question about how many corners land on a point of the shadow is open, the page does not count the
   * pile-ups for you: no badge, no larger dot, no count in a sentence. Picking a point is how you find out.
   */
  readonly withhold: boolean;
  /** Whether the picture includes the object itself: the plane rung's outside view. Never the world. */
  readonly objectShown: boolean;
  /** Whether this chapter offers hiding the object: the plane rung, once the shadow can be cast. */
  readonly canHideObject: boolean;
  readonly dimensions: Dimensions;
  /** One edge length, measured: the rigid invariant every turn keeps. */
  readonly edge: number;
  readonly setup: string;
  readonly invitation: string;
  readonly hint: string;
  readonly prediction: {
    readonly spec: PredictionSpec;
    readonly choice: string | null;
    readonly revealed: boolean;
    readonly reveal: string | null;
    /** The next step toward finding out, as one action the page offers beside the visitor's own hands; null once revealed. */
    readonly test: { readonly label: string; readonly action: Action } | null;
  } | null;
  readonly inspection: Inspection | null;
  /** A point the page has pointed out, unpicked: marked in the picture, its answer not given. */
  readonly attention: InspectTarget | null;
  readonly event: { readonly line: string; readonly at: number } | null;
  readonly eventId: number;
  /** Set only when the picture is blank: nothing cut, no shadow, no object drawn. */
  readonly empty: EmptyNote | null;
  readonly passing: boolean;
  readonly turning: boolean;
  readonly status: string;
}

export interface Experience {
  view(): View;
  dispatch(action: Action): void;
  readonly worlds: { readonly plane: PlaneWorldT; readonly space: SpaceWorldT };
  /** The world on show. */
  world(): World;
}

type Milestone = 'cut' | 'passed' | 'looked' | 'turned' | 'turned-corner' | 'predicted' | 'revealed' | 'after-reveal' | 'triangle' | 'hid' | 'octahedron';

interface State {
  chapter: ChapterId;
  rung: RungId;
  tip: Record<RungId, number>;
  offset: Record<RungId, number>;
  shadow: boolean;
  objectShown: boolean;
  choice: string | null;
  revealed: boolean;
  /** The reveal as it read when the discovery was made: later moves do not rewrite it. */
  revealText: string | null;
  inspect: InspectTarget | null;
  attention: InspectTarget | null;
  /** A passage: where it ends, how long it still holds at the middle, whether it has, and time towards its next step. */
  pass: { to: number; hold: number; heldMiddle: boolean; wait: number } | null;
  /** A turn to a named pose; `slid` when the slice was slid while it turned, so its last line can say so. */
  turn: { from: number; to: number; t: number; slid: boolean } | null;
  milestones: Set<Milestone>;
  event: { line: string; at: number } | null;
  sequence: number;
}

const DEG = Math.PI / 180;

/** The slide grid, exactly: the nearest k/10. */
const onGrid = (x: number): number => Math.round(x * 10) / 10;

/** The pose a tip sits on exactly, if any. */
function poseAt(rung: RungId, tip: number): PoseName | null {
  const stops = RUNGS[rung].stops;
  if (Math.abs(tip - stops.facet) < 1e-12) return 'facet';
  if (Math.abs(tip - stops.corner) < 1e-12) return 'corner';
  if (Math.abs(tip - stops.edge) < 1e-12) return 'edge';
  return null;
}

/** One keyboard step of the turn: 5°, stopping on a named pose it would cross. */
export function tipStep(rung: RungId, tip: number, steps: number): number {
  const stops = Object.values(RUNGS[rung].stops).sort((a, b) => a - b);
  let angle = tip;
  for (let k = 0; k < Math.abs(steps); k++) {
    const dir = Math.sign(steps);
    const next = angle + dir * TIP_STEP_DEG * DEG;
    const crossed = stops.filter((s) => (dir > 0 ? s > angle + 1e-12 && s <= next + 1e-12 : s < angle - 1e-12 && s >= next - 1e-12));
    angle = crossed.length > 0 ? (dir > 0 ? crossed[0]! : crossed[crossed.length - 1]!) : next;
    angle = Math.min(Math.PI / 2, Math.max(0, angle));
  }
  return angle;
}

/** The next layer of corners strictly beyond `offset` in `direction`, or null when there is none. */
export function nextLayer(layers: readonly Layer[], offset: number, direction: 1 | -1): number | null {
  const beyond = layers.map((l) => l.height).filter((h) => (direction > 0 ? h > offset + ON_PLANE_EPSILON : h < offset - ON_PLANE_EPSILON));
  if (beyond.length === 0) return null;
  return direction > 0 ? Math.min(...beyond) : Math.max(...beyond);
}

/**
 * `instantTurns`: a named pose is reached at once (reduced motion). `steppedPass`: a passage moves in grid steps,
 * one every {@link STEP_SECONDS}, instead of gliding (reduced motion). Either way it holds at the middle.
 */
export function createExperience(start: ChapterId = 'through', options: { readonly instantTurns?: boolean; readonly steppedPass?: boolean } = {}): Experience {
  const worlds = { plane: createPlaneWorld(), space: createSpaceWorld() };
  const state: State = {
    chapter: start, rung: 'plane',
    tip: { plane: 0, space: 0 }, offset: { plane: -1.6, space: -1.6 },
    shadow: false, objectShown: true, choice: null, revealed: false, revealText: null, inspect: null, attention: null, pass: null, turn: null,
    milestones: new Set(), event: null, sequence: 0
  };

  const world = (): World => worlds[state.rung];
  const sync = (rung: RungId): void => {
    const w = worlds[rung];
    if (w.tip !== state.tip[rung]) w.setTip(state.tip[rung]);
    if (w.offset !== state.offset[rung]) w.setSlice(state.offset[rung]);
  };
  const granted = (hand: Hand | null): boolean => hand === null || chapterById(state.chapter).hands.includes(hand);
  const canHide = (): boolean => state.rung === 'plane' && chapterById(state.chapter).hands.includes('cast');

  const snapshot = (): { meeting: Meeting; cut: CutSummary; key: string } => {
    const w = world();
    const meeting = w.meeting();
    const cut = w.cut();
    // What a line names: the meeting, and the cut's counted shape. Its size changes silently; the readout carries it.
    const key = `${meeting.kind}|${meeting.kind === 'touching' ? `${meeting.feature}:${meeting.drawn}:${meeting.undrawn}` : ''}|${cut.shape}|${cut.corners.length}`;
    return { meeting, cut, key };
  };

  const say = (line: string): void => {
    state.sequence += 1;
    state.event = { line, at: state.sequence };
  };

  /**
   * Apply a change to the world on show, and say what it changed: a line when what it names changed, or when
   * `settled` marks the end of a turn, which always says the object is the same object.
   */
  const change = (cause: Cause, mutate: () => void, settled = false): void => {
    const before = snapshot();
    mutate();
    sync(state.rung);
    state.inspect = null;
    state.attention = null;
    const after = snapshot();
    if (after.meeting.kind === 'crossing' || (after.meeting.kind === 'touching' && after.meeting.drawn)) state.milestones.add('cut');
    if (after.cut.corners.length === 3 && state.rung === 'plane') state.milestones.add('triangle');
    if (after.cut.shape === 'a regular octahedron') state.milestones.add('octahedron');
    if (before.meeting.kind !== 'apart' && after.meeting.kind === 'apart' && state.milestones.has('cut')) state.milestones.add('passed');
    if (state.milestones.has('revealed') && (cause === 'slide' || cause === 'pass' || cause === 'turn' || cause === 'turn-slide')) state.milestones.add('after-reveal');
    if (cause === 'turn' || cause === 'turn-slide') {
      state.milestones.add('turned');
      if (poseAt(state.rung, state.tip[state.rung]) === 'corner') state.milestones.add('turned-corner');
    }
    if (before.key !== after.key || settled) {
      const edge = world().edgeLengths()[0]!;
      say(eventLine(state.rung, before, after, cause, edge));
    }
    checkReveal(cause);
  };

  const enter = (id: ChapterId): void => {
    const spec = chapterById(id);
    state.chapter = id;
    state.pass = null;
    state.turn = null;
    state.inspect = null;
    state.attention = null;
    state.choice = null;
    state.revealed = false;
    state.revealText = null;
    state.milestones = new Set();
    state.event = null;
    if (spec.start && spec.rung) {
      state.rung = spec.rung;
      state.tip[spec.rung] = RUNGS[spec.rung].stops[spec.start.pose];
      state.offset[spec.rung] = spec.start.offset;
      state.shadow = spec.start.shadow;
      state.objectShown = true;
    }
    sync(state.rung);
    checkReveal('chapter');
  };

  /**
   * Whether the question is answered now. Chapters II and IV ask what a slide will meet, so their answers come only
   * from a slide or a passage: a turn that lands in the answer shows the cut, and the question stays open until the
   * slice is slid. Chapters III and V ask what lands on a point, so theirs come only from picking it.
   */
  const checkReveal = (cause: Cause | 'inspect'): void => {
    const spec = chapterById(state.chapter);
    if (spec.prediction === null || state.revealed) return;
    const w = world();
    const pose = poseAt(state.rung, state.tip[state.rung]);
    const cut = w.cut();
    const slid = cause === 'slide' || cause === 'pass';
    let found = false;
    switch (spec.prediction) {
      case 'middle-cut': found = slid && state.rung === 'plane' && pose === 'corner' && cut.corners.length === 6; break;
      case 'first-solid': found = slid && state.rung === 'space' && pose === 'corner' && cut.corners.length === 4 && cut.dimension === 3; break;
      case 'shadow-centre':
      case 'shadow-corner': {
        const target = state.inspect;
        if (target?.kind === 'shadow-point') {
          const point = w.shadow().points[target.index];
          found = point !== undefined && (spec.prediction === 'shadow-centre' ? point.corners.length >= 2 && pose === 'corner' : pose === 'facet');
        }
        break;
      }
    }
    if (found) {
      state.revealed = true;
      state.revealText = revealText();
      state.milestones.add('revealed');
    }
  };

  /** The reveal, from the world's own numbers at the moment of discovery. */
  const revealText = (): string | null => {
    const spec = chapterById(state.chapter);
    if (spec.prediction === null) return null;
    const w = world();
    const words = WORDS[state.rung];
    switch (spec.prediction) {
      case 'middle-cut': {
        const cut = w.cut();
        const regular = cut.shape === 'a regular hexagon' ? ` Here, at the middle, all six sides are equal: ${cutPhrase('plane', cut)}.` : '';
        return `A hexagon, all the while the plane lies between the cube’s two middle layers of corners. ${cornerReason('plane', cut)} `
          + `${FIRST_CUT_CLAUSES.plane}${regular}`;
      }
      case 'first-solid': {
        const cut = w.cut();
        return `${capitalise(cutPhrase('space', cut))}. ${cornerReason('space', cut)} ${FIRST_CUT_CLAUSES.space}`;
      }
      case 'shadow-centre':
      case 'shadow-corner': {
        const target = state.inspect;
        const points = w.shadow().points;
        const point = target?.kind === 'shadow-point' ? points[target.index] : undefined;
        const piled = point?.corners.length ?? 0;
        const n = capitalise(count(piled, 'corner'));
        if (spec.prediction === 'shadow-centre') {
          return `${n}. The light comes straight along ${words.missing}, and these corners lie on one line along it. `
            + 'They share a point of the shadow; they are different corners.';
        }
        const every = points.every((p) => p.corners.length === piled);
        return `${n}. ${every ? `Every corner of this cube-shaped shadow carries ${count(piled, 'corner')} of the tesseract’s` : `This corner carries ${count(piled, 'corner')}`}: `
          + `the two ends of an edge that runs straight along ${words.missing}. Face first, the cube’s shadow in the plane was a square, `
          + 'and each of its corners carried two corners too: the two ends of an upright edge.';
      }
    }
  };

  /** The next step toward the answer, as one action, while the question is open. */
  const testFor = (): { label: string; action: Action } | null => {
    const spec = chapterById(state.chapter);
    if (spec.prediction === null || state.revealed) return null;
    const pose = poseAt(state.rung, state.tip[state.rung]);
    const facetLabel = state.rung === 'plane' ? 'Face first' : 'Cell first';
    switch (spec.prediction) {
      case 'middle-cut': {
        if (pose !== 'corner') return { label: 'Corner first', action: { type: 'pose', pose: 'corner' } };
        // The cut near the corner first, then the middle: the triangle is half of what the answer explains.
        if (!state.milestones.has('triangle')) {
          const first = world().layers()[0]!.height;
          return { label: 'Slide just past its lowest corner', action: { type: 'slide-to', offset: onGrid(first + 0.2) } };
        }
        return { label: 'Slide to the middle', action: { type: 'slide-to', offset: 0 } };
      }
      case 'first-solid': {
        // Turning cuts nothing from the chapter's start; the slide past the corner is the act the question asks for.
        if (pose !== 'corner') return { label: 'Corner first', action: { type: 'pose', pose: 'corner' } };
        const [lo, hi] = world().extent();
        const target = state.offset[state.rung] > 0 ? onGrid(hi - 0.5) : onGrid(lo + 0.5);
        return { label: 'Slide in, just past its first corner', action: { type: 'slide-to', offset: target } };
      }
      case 'shadow-centre':
      case 'shadow-corner': {
        // First point the place out, unpicked; only a second, plainly named press shows what lands there.
        const want = spec.prediction === 'shadow-centre' ? 'corner' : 'facet';
        if (pose !== want) return want === 'corner' ? { label: 'Corner first', action: { type: 'pose', pose: 'corner' } } : { label: facetLabel, action: { type: 'pose', pose: 'facet' } };
        const index = world().shadow().points.findIndex((p) => p.corners.length >= 2);
        if (index === -1) return null;
        const target: InspectTarget = { kind: 'shadow-point', index };
        if (state.attention?.kind !== 'shadow-point' || state.attention.index !== index) {
          return { label: spec.prediction === 'shadow-centre' ? 'Point out the centre' : 'Point out a corner of the shadow', action: { type: 'attend', target } };
        }
        return { label: 'Show me what lands there', action: { type: 'inspect', target } };
      }
    }
  };

  /** The hint for the state now: `cut` is the cut on show, so a hint that names it is true of it. */
  const hintFor = (cut: CutSummary): string => {
    const m = state.milestones;
    const pose = poseAt(state.rung, state.tip[state.rung]);
    switch (state.chapter) {
      case 'through':
        if (m.has('looked') && m.has('passed')) return 'Looking moved only your view: the cube, the plane and the cut are as they were. Next, stand the cube on a corner.';
        if (m.has('passed')) return 'The plane has passed the cube. Now look around: drag the picture, or press Q and E.';
        if (m.has('cut')) return 'That square is all the plane can meet of the cube: the place where the cube crosses it. Keep going.';
        return 'Press Pass through, tap or drag the gauge, or press ↑.';
      // A hint that names what is on show stands only while it is on show; a rule it gives carries its condition.
      // The question is asked of the cube stood on a corner, so in any other pose the hint says how to get back.
      case 'corner':
        if (m.has('after-reveal')) return 'Turn the cube with the dial and slide again: each pose cuts it differently, and the cube never changes.';
        if (m.has('revealed')) return 'Six edges, six corners. Keep sliding: past the middle it comes back to a triangle, turned the other way.';
        if (pose !== 'corner') return 'The question stands the cube on a corner: press Corner first, then slide the plane.';
        if (m.has('triangle') && cut.corners.length === 3) return 'A triangle: stood on one corner, the plane just past it crosses only that corner’s three edges. Keep going.';
        return 'Guess first, if you like, then slide the plane up.';
      case 'shadow':
        if (m.has('hid')) return 'That is all the plane holds of the cube: a cut and a shadow. One rung up, that is all there is to see.';
        // Sliding never changes the shadow's shape, but whether it changes the cut depends on the pose: face first the
        // cut is the same square the whole way through. So the hint asks for the comparison and promises no change.
        if (m.has('after-reveal')) return 'Slide the plane: the shadow keeps its shape; compare the cut with it. Then turn the cube and compare again. Then hide the cube.';
        if (m.has('revealed')) return 'Now slide the plane, and turn the cube, and watch which of the two changes.';
        if (state.attention) return 'The ringed dot is the shadow’s centre. Pick it, with a click or a tap, to see what lands there.';
        return 'The filled shape is the cut, the lines the shadow; Hide the cube leaves only those two. Guess, then pick the dot at the shadow’s centre.';
      case 'up':
        if (m.has('octahedron')) return 'Corner first, at the very middle, six of the tesseract’s corners lie in your space at once, and the cut is an octahedron: for that one position only.';
        if (m.has('revealed')) return 'Keep sliding, and count the cut’s corners each time your space passes a layer of the tesseract’s corners. The gauge marks the layers.';
        if (m.has('turned-corner')) return 'Guess first, if you like, then slide your space in, just past the tesseract’s nearest corner. The gauge marks where its corners lie.';
        if (m.has('passed')) return 'Cell first, the cut is a cube the whole way through, as the cube’s cut in the plane was a square the whole way. Now turn the tesseract corner first.';
        if (m.has('cut')) return cut.shape === 'a cube' ? 'A cube. Keep going: does it change as your space moves on?' : 'Keep going: does the cut change as your space moves on?';
        return 'Press Pass through, tap or drag the gauge, or press ↑.';
      case 'up-shadow':
        if (m.has('after-reveal')) return 'Turn the tesseract corner first: its shadow’s centre carries two corners, as the cube’s hexagonal shadow’s did.';
        if (m.has('revealed')) return 'Now turn the tesseract, and watch the shadow change while the tesseract stays the same.';
        if (state.attention) return 'The ringed dot is one corner of the shadow. Pick it, with a click or a tap, to see what lands there.';
        // The shadow lies over the cut only cell first, and only while something is cut; the visitor may turn or slide
        // before answering. So the opening hint names the shadow alone, true in every pose and at every place.
        return 'The lines are the shadow. Guess, then pick a dot at one of its corners.';
      default:
        return 'Every hand works here, in both worlds. Nothing is reset when you come back.';
    }
  };

  const setupFor = (): string => {
    switch (state.chapter) {
      case 'through': return 'A cube hangs above a flat world, one face toward it. The plane lies below it; nothing is cut yet. Camera as you left it.';
      case 'corner': return 'The same cube, turned to stand on its corner (− − −). The plane lies below it. Camera as you left it.';
      case 'shadow': return 'The cube stands on a corner, the plane passes through its middle, and light comes straight along the missing direction. Camera as you left it.';
      // The guided introduction says in one sentence what free exploration's full one says (ANA_KATA): kept short,
      // because on a phone the card's first action must stay on the first screen.
      case 'up': return `Now your whole picture is the slice, three directions inside four. ${ANA_KATA_GUIDED} A tesseract, the four-dimensional cube, lies ana of it, cell first. Camera as you left it.`;
      case 'up-shadow': return 'The tesseract, cell first, with your space through its middle, and light along the direction your space lacks. Camera as you left it.';
      default: return state.rung === 'space' ? `Both worlds, as you left them. In this one your whole picture is the slice. ${ANA_KATA}` : 'Both worlds, as you left them.';
    }
  };

  const invitationFor = (): string => {
    switch (state.chapter) {
      case 'through': return 'Slide the plane up through the cube.';
      case 'corner': return 'Slide the plane up through it again.';
      case 'shadow': return 'Compare the cut with the shadow.';
      case 'up': return 'Slide your space through the tesseract, as the plane passed through the cube.';
      case 'up-shadow': return 'Compare the cut with the shadow, one rung up.';
      default: return 'Switch worlds, turn, slide, cast and look.';
    }
  };

  const inspectionFor = (): Inspection | null => {
    const target = state.inspect;
    if (target === null) return null;
    const w = world();
    const words = WORDS[state.rung];
    const corners = w.corners();
    if (target.kind === 'cut-corner') {
      const corner = w.cut().corners[target.index];
      if (!corner) return null;
      if (corner.on.length === 1) {
        const c = corners[corner.on[0]!]!;
        return { target, text: `This corner of the cut is ${words.theObject}’s own corner ${c.name}, lying in ${words.slice}.`, edges: [], corners: [c.index] };
      }
      const [a, b] = [corners[corner.on[0]!]!, corners[corner.on[1]!]!];
      const percent = Math.round(corner.along * 100);
      return {
        target,
        text: `This corner of the cut lies ${percent}% of the way along the edge from ${a.name} to ${b.name}: ${words.slice} crosses that edge here.`,
        edges: [[a.index, b.index]],
        corners: []
      };
    }
    if (target.kind === 'shadow-point') {
      const point = w.shadow().points[target.index];
      if (!point) return null;
      const list = point.corners.map((i) => corners[i]!);
      const named = list.map((c) => `${c.name}, ${Math.abs(c.height) < ON_PLANE_EPSILON ? `in ${words.slice}` : `${distance(c.height)} ${c.height > 0 ? words.plusSide : words.minusSide}`}`);
      const text = list.length === 1
        ? `One corner lands here: ${named[0]}.`
        : `${capitalise(count(list.length, 'corner'))} land here: ${named.join('; and ')}. One point of the shadow, ${count(list.length, 'different corner')}.`;
      return { target, text, edges: [], corners: list.map((c) => c.index) };
    }
    const c = corners[target.index];
    if (!c) return null;
    return { target, text: cornerSentence(state.rung, c.name, c.height), edges: [], corners: [c.index] };
  };

  /**
   * The note for a blank picture: nothing cut, no shadow cast, and no object drawn. While anything is drawn (the cube
   * from outside, or a shadow), the picture is not empty and the card's status line says what the slice meets.
   */
  const emptyFor = (meeting: Meeting): EmptyNote | null => {
    if (meeting.kind === 'crossing' || (meeting.kind === 'touching' && meeting.drawn)) return null;
    if (state.shadow || (state.rung === 'plane' && state.objectShown)) return null;
    const w = world();
    const [lo, hi] = w.extent();
    const middle = onGrid((lo + hi) / 2);
    return {
      headline: meetingSentence(state.rung, meeting, w.cut()),
      ways: [
        { label: 'Pass through', action: { type: 'play' } },
        { label: `Slide to the ${WORDS[state.rung].object}’s middle`, action: { type: 'slide-to', offset: Math.abs(middle) < 1e-12 ? 0 : middle } }
      ]
    };
  };

  const withholding = (): boolean => {
    const p = chapterById(state.chapter).prediction;
    return (p === 'shadow-centre' || p === 'shadow-corner') && !state.revealed;
  };

  const dimensionsFor = (cut: CutSummary): Dimensions => {
    const d = RUNGS[state.rung].dim;
    return { world: d, slice: d - 1, object: d, cut: cut.dimension, shadow: d - 1 };
  };

  /**
   * One frame of a passage. Gliding, it moves PASS_SPEED a second; stepped (reduced motion), one grid step every
   * STEP_SECONDS. Either way, a passage that would cross the middle lands on it exactly and holds MIDDLE_HOLD there.
   */
  const advancePass = (dt: number): void => {
    const pass = state.pass!;
    const rung = state.rung;
    if (pass.hold > 0) { pass.hold = Math.max(0, pass.hold - dt); return; }
    let next: number;
    if (options.steppedPass) {
      pass.wait += dt;
      if (pass.wait < STEP_SECONDS) return;
      pass.wait = 0;
      next = Math.min(pass.to, onGrid(state.offset[rung] + SLIDE_STEP));
    } else {
      next = Math.min(pass.to, state.offset[rung] + PASS_SPEED * dt);
    }
    if (!pass.heldMiddle && state.offset[rung] < 0 && next >= 0) {
      next = 0;
      pass.heldMiddle = true;
      pass.hold = MIDDLE_HOLD;
    }
    const done = next >= pass.to - 1e-12;
    change('pass', () => { state.offset[rung] = done ? pass.to : next; });
    if (done) state.pass = null;
  };

  enter(start);

  return {
    worlds,
    world,
    view(): View {
      const w = world();
      const meeting = w.meeting();
      const cut = w.cut();
      const spec = chapterById(state.chapter);
      const predictionSpec = spec.prediction ? PREDICTIONS[spec.prediction] : null;
      return {
        chapter: spec,
        rung: state.rung,
        words: WORDS[state.rung],
        tip: state.tip[state.rung],
        pose: poseAt(state.rung, state.tip[state.rung]),
        offset: state.offset[state.rung],
        reach: RUNGS[state.rung].reach,
        extent: w.extent(),
        layers: w.layers(),
        meeting,
        cut,
        accounting: w.diagnostics(),
        corners: w.corners(),
        shadowOn: state.shadow,
        shadow: w.shadow(),
        withhold: withholding(),
        objectShown: state.objectShown,
        canHideObject: canHide(),
        dimensions: dimensionsFor(cut),
        edge: w.edgeLengths()[0]!,
        setup: setupFor(),
        invitation: invitationFor(),
        hint: hintFor(cut),
        prediction: predictionSpec
          ? { spec: predictionSpec, choice: state.choice, revealed: state.revealed, reveal: state.revealText, test: testFor() }
          : null,
        inspection: inspectionFor(),
        attention: state.attention,
        event: state.event,
        eventId: state.sequence,
        empty: emptyFor(meeting),
        passing: state.pass !== null,
        turning: state.turn !== null,
        status: meetingSentence(state.rung, meeting, cut)
      };
    },
    dispatch(action: Action): void {
      if (!granted(HAND_OF[action.type])) return;
      const rung = state.rung;
      const reach = RUNGS[rung].reach;
      switch (action.type) {
        case 'chapter': enter(action.id); return;
        case 'reset': enter(state.chapter); return;
        case 'rung':
          if (state.chapter !== 'free' || action.id === state.rung) return;
          state.rung = action.id;
          state.pass = null;
          state.turn = null;
          state.inspect = null;
          sync(state.rung);
          return;
        case 'slide-to':
          state.pass = null;
          if (state.turn) state.turn.slid = true;
          change('slide', () => { state.offset[rung] = Math.max(-reach, Math.min(reach, action.offset)); });
          return;
        case 'slide-step':
          state.pass = null;
          if (state.turn) state.turn.slid = true;
          change('slide', () => { state.offset[rung] = Math.max(-reach, Math.min(reach, onGrid(state.offset[rung] + action.steps * SLIDE_STEP))); });
          return;
        case 'slide-layer': {
          const to = nextLayer(world().layers(), state.offset[rung], action.direction);
          if (to === null) return;
          state.pass = null;
          if (state.turn) state.turn.slid = true;
          change('slide', () => { state.offset[rung] = to; });
          return;
        }
        // A turn stops a passage: the slice never slides on by itself while the object turns. A turn that would leave
        // the tip where it is (the dial's end, a key pushing past it, the pose already held) stops the passage and
        // says nothing: no turn happened, so none is reported, and nothing picked is let go.
        case 'tip-to': {
          const to = Math.max(0, Math.min(Math.PI / 2, action.angle));
          state.turn = null;
          state.pass = null;
          if (to === state.tip[rung]) return;
          change('turn', () => { state.tip[rung] = to; });
          return;
        }
        case 'tip-step': {
          const to = tipStep(rung, state.tip[rung], action.steps);
          state.turn = null;
          state.pass = null;
          if (to === state.tip[rung]) return;
          change('turn', () => { state.tip[rung] = to; }, true);
          return;
        }
        case 'pose': {
          const to = RUNGS[rung].stops[action.pose];
          state.pass = null;
          if (to === state.tip[rung]) { state.turn = null; return; }
          if (options.instantTurns) { state.turn = null; change('turn', () => { state.tip[rung] = to; }, true); return; }
          state.turn = { from: state.tip[rung], to, t: 0, slid: false };
          return;
        }
        case 'shadow':
          if (state.shadow === action.on) return;
          state.shadow = action.on;
          state.inspect = null;
          if (action.on) {
            const shadow = world().shadow();
            say(withholding()
              ? `The shadow is all of ${WORDS[rung].theObject}, dropped straight along ${WORDS[rung].missing}. Pick a point of it to see what lands there.`
              : shadowSentence(rung, shadow.points.length, shadow.points.filter((p) => p.corners.length > 1).map((p) => p.corners.length)));
          } else {
            say('The shadow is hidden. The cut is as it was: hiding a shadow changes nothing else.');
          }
          return;
        case 'show-object':
          if (!canHide() || state.objectShown === action.on) return;
          state.objectShown = action.on;
          if (!action.on) state.milestones.add('hid');
          if (state.inspect?.kind === 'corner') state.inspect = null;
          say(action.on
            ? 'The cube is shown again. Nothing in the world moved.'
            : 'The cube is hidden from the picture, not from the world: the cut and the shadow are what the plane holds of it.');
          return;
        case 'play': {
          // A passage runs from beyond the object's farthest corner in any pose to beyond it on the other side, so a
          // turn made after it, or before it, cuts nothing until the slice is slid again.
          const [, hi] = world().extent();
          const far = Math.sqrt(RUNGS[rung].dim);
          if (state.offset[rung] >= hi - 1e-12) change('slide', () => { state.offset[rung] = Math.max(-reach, onGrid(-far - 0.3)); });
          state.pass = {
            to: Math.min(reach, onGrid(far + 0.3)), hold: 0, heldMiddle: state.offset[rung] >= 0,
            wait: options.steppedPass ? STEP_SECONDS : 0
          };
          return;
        }
        case 'stop': state.pass = null; state.turn = null; return;
        case 'tick': {
          if (state.pass) advancePass(action.dt);
          if (state.turn) {
            const turn = state.turn;
            turn.t = Math.min(1, turn.t + action.dt / TURN_SECONDS);
            const eased = turn.t < 1 ? turn.from + (turn.to - turn.from) * (1 - (1 - turn.t) ** 3) : turn.to;
            const settled = turn.t >= 1;
            change(settled && turn.slid ? 'turn-slide' : 'turn', () => { state.tip[rung] = eased; }, settled);
            if (settled) state.turn = null;
          }
          return;
        }
        case 'predict':
          state.choice = action.choice;
          state.milestones.add('predicted');
          return;
        case 'inspect':
          state.inspect = action.target;
          state.attention = null;
          checkReveal('inspect');
          return;
        // Pointing a place out lets go of any earlier pick: its line was about another point, and must not stand
        // beside a ring round this one. A pick, in turn, takes the ring away.
        case 'attend':
          state.attention = action.target;
          state.inspect = null;
          return;
        case 'look':
          if (!state.milestones.has('looked')) {
            say('You moved the camera. Nothing in the world moved; only your view of it did.');
          }
          state.milestones.add('looked');
          return;
      }
    }
  };
}

/** Which named poses a rung offers, in order. */
export const POSES: readonly PoseName[] = ['facet', 'corner', 'edge'];

/** A pose in a sentence, for the page's readouts. */
export function poseReadout(view: View): string {
  return poseInSentence(view.rung, view.pose, (view.tip * 180) / Math.PI);
}
