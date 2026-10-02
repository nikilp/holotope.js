import type { Action, ChapterId } from './experience.js';

/**
 * Every control the page has, and what it does — DOM-free, so the tests run
 * the very functions the page attaches. The page binds nothing that is not in
 * this table (`app.ts` attaches by iterating it), and the markup census in the
 * tests holds the HTML to exactly these ids.
 *
 * `kind` says what the control may touch:
 *   view    — the observer: the slice, the shadow, the focus. Never a clock.
 *   time    — a clock: the prescribed orbit, or the physics clock (forward or replay from launch).
 *   study   — the separate prescribed-turn scene.
 *   chapter — establishes a chapter's stated state.
 *   camera  — the page's camera only; no model state at all.
 */

/** The parts of the view model a control's decision may read. */
interface ControlContext {
  readonly playing: boolean;
  readonly shadowOn: boolean;
  readonly studyPlaying: boolean;
  /** Ordinals of the source faces the slice cuts now, ascending; empty outside the turning world. */
  readonly facesCut: readonly number[];
  /** The face being followed, or null. */
  readonly face: number | null;
}

/**
 * The keyboard's way to follow a face (the picture takes a click): the next face the slice cuts,
 * in ordinal order, then none, then round again.
 */
export function nextFace(facesCut: readonly number[], face: number | null): number | null {
  if (facesCut.length === 0) return null;
  const at = face === null ? -1 : facesCut.indexOf(face);
  if (face !== null && at === -1) return facesCut[0]!;
  return at + 1 < facesCut.length ? facesCut[at + 1]! : null;
}

export type ControlKind = 'view' | 'time' | 'study' | 'chapter' | 'camera';

interface Binding {
  readonly id: string;
  readonly kind: ControlKind;
  /** The action this control dispatches now, or null for a camera-only control. */
  readonly act: (context: ControlContext) => Action | null;
}

export const BUTTONS: readonly Binding[] = [
  { id: 'hd-play', kind: 'time', act: (c) => ({ type: c.playing ? 'pause' : 'play' }) },
  { id: 'hd-step', kind: 'time', act: () => ({ type: 'step' }) },
  { id: 'hd-step-back', kind: 'time', act: () => ({ type: 'step-back' }) },
  { id: 'hd-jump', kind: 'time', act: () => ({ type: 'jump-touch' }) },
  { id: 'hd-replay', kind: 'time', act: () => ({ type: 'replay' }) },
  { id: 'hd-preset-a', kind: 'time', act: () => ({ type: 'preset', id: 'central' }) },
  { id: 'hd-preset-b', kind: 'time', act: () => ({ type: 'preset', id: 'off-centre' }) },
  { id: 'hd-shadow', kind: 'view', act: (c) => ({ type: 'shadow', on: !c.shadowOn }) },
  { id: 'hd-freeze', kind: 'view', act: () => ({ type: 'freeze' }) },
  { id: 'hd-reset-cut', kind: 'view', act: () => ({ type: 'cut-reset' }) },
  { id: 'hd-face-next', kind: 'view', act: (c) => ({ type: 'focus-face', ordinal: nextFace(c.facesCut, c.face) }) },
  { id: 'hd-recentre', kind: 'camera', act: () => null },
  { id: 'hd-world-turn', kind: 'chapter', act: () => ({ type: 'world', world: 'turn' }) },
  { id: 'hd-world-contact', kind: 'chapter', act: () => ({ type: 'world', world: 'contact' }) },
  { id: 'hd-study-xy', kind: 'study', act: () => ({ type: 'study-mode', mode: 'ordinary' }) },
  { id: 'hd-study-xw', kind: 'study', act: () => ({ type: 'study-mode', mode: 'fourth' }) },
  { id: 'hd-study-play', kind: 'study', act: (c) => ({ type: c.studyPlaying ? 'study-pause' : 'study-play' }) }
];

/** The instruments you drag: what a value on each one means. */
export const INSTRUMENTS = {
  /** The hidden-plane map, by its bright ends: the slice's turn in the x–w plane, in degrees. */
  turn: { id: 'hd-map', kind: 'view' as const, act: (degrees: number): Action => ({ type: 'cut-turn', degrees }) },
  /** The hidden-plane map, anywhere else: the slice's offset along its own normal, read where you put the line. */
  slide: { id: 'hd-map', kind: 'view' as const, act: (offset: number): Action => ({ type: 'cut-offset', value: offset }) },
  /** The gauge's line: the slice's offset along its own normal. */
  gauge: { id: 'hd-gauge', kind: 'view' as const, act: (offset: number): Action => ({ type: 'cut-offset', value: offset }) },
  /** The study's angle: the prescribed turn of the separate scene, in degrees. */
  studyAngle: { id: 'hd-study-angle', kind: 'study' as const, act: (degrees: number): Action => ({ type: 'study-angle', degrees }) }
} as const;

/** Chapter buttons are generated from the chapter list; each establishes its chapter. */
export const chapterAction = (id: ChapterId): Action => ({ type: 'chapter', id });

/**
 * Keys, when no text field has focus. Arrows move the slice — left/right turn
 * it, up/down slide it ana/kata — and Shift makes the step ten times larger.
 */
export function keyAction(key: string, shift: boolean, context: ControlContext): Action | 'camera' | null {
  const k = shift ? 10 : 1;
  switch (key) {
    case 'ArrowLeft': return { type: 'cut-turn-nudge', delta: -1 * k };
    case 'ArrowRight': return { type: 'cut-turn-nudge', delta: 1 * k };
    case 'ArrowUp': return { type: 'cut-nudge', delta: 0.02 * k };
    case 'ArrowDown': return { type: 'cut-nudge', delta: -0.02 * k };
    case ' ': return { type: context.playing ? 'pause' : 'play' };
    case '.': return { type: 'step' };
    case ',': return { type: 'step-back' };
    case 's': case 'S': return { type: 'shadow', on: !context.shadowOn };
    case 'f': case 'F': return { type: 'freeze' };
    case 'r': case 'R': return { type: 'cut-reset' };
    case 'c': case 'C': return 'camera';
    default: return null;
  }
}
