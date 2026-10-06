import type { Layer, RungId } from './world.js';
import { RUNGS } from './world.js';
import type { Action, ChapterId } from './journey.js';

/**
 * Every control on the page, and what it does, with no DOM: the tests run the
 * very functions the page attaches. `app.ts` wires the buttons by iterating
 * `BUTTONS`, the instruments' drags through `gaugeValue` and `dialAngle`, and
 * their keys through `sliderKey`; the markup census holds the HTML to exactly
 * these ids.
 *
 * `kind` says what a control may touch:
 *   world   — the slice's place or the object's pose (Slide, Turn);
 *   shadow  — whether the shadow is shown (Cast);
 *   view    — what the picture includes; never a world (Look);
 *   camera  — the camera only; no model state at all (Look);
 *   chapter — establishes a chapter's stated state, or switches world in free exploration.
 */

/** The parts of the view a control's decision may read. */
export interface ControlContext {
  readonly passing: boolean;
  readonly shadowOn: boolean;
  readonly objectShown: boolean;
}

export type ControlKind = 'world' | 'shadow' | 'view' | 'camera' | 'chapter';

interface Binding {
  readonly id: string;
  readonly kind: ControlKind;
  /** The action this control dispatches now, or null for a camera-only control. */
  readonly act: (context: ControlContext) => Action | null;
}

export const BUTTONS: readonly Binding[] = [
  { id: 'om-pass', kind: 'world', act: (c) => ({ type: c.passing ? 'stop' : 'play' }) },
  { id: 'om-reset', kind: 'chapter', act: () => ({ type: 'reset' }) },
  { id: 'om-pose-facet', kind: 'world', act: () => ({ type: 'pose', pose: 'facet' }) },
  { id: 'om-pose-corner', kind: 'world', act: () => ({ type: 'pose', pose: 'corner' }) },
  { id: 'om-pose-edge', kind: 'world', act: () => ({ type: 'pose', pose: 'edge' }) },
  { id: 'om-shadow', kind: 'shadow', act: (c) => ({ type: 'shadow', on: !c.shadowOn }) },
  { id: 'om-hide', kind: 'view', act: (c) => ({ type: 'show-object', on: !c.objectShown }) },
  { id: 'om-recentre', kind: 'camera', act: () => null },
  { id: 'om-rung-plane', kind: 'chapter', act: () => ({ type: 'rung', id: 'plane' }) },
  { id: 'om-rung-space', kind: 'chapter', act: () => ({ type: 'rung', id: 'space' }) }
];

/** How close, in pixels, a drag on the gauge must come to a layer of corners to land on it exactly. */
export const LAYER_SNAP_PX = 7;
/** How close, in degrees, a drag on the dial must come to a named pose to land on it exactly. */
export const POSE_SNAP_DEG = 2.5;

/**
 * The gauge's value under the pointer. `fraction` runs from 0 at the top (the plus side) to 1 at the bottom; the
 * gauge spans ±`reach` over `heightPx` pixels. A value within `LAYER_SNAP_PX` of a layer of corners, or of the
 * middle, lands on it exactly, so a drag can reach the heights where the cut changes, and they are never
 * missed by a rounding.
 */
export function gaugeValue(fraction: number, reach: number, heightPx: number, layers: readonly Layer[]): number {
  const raw = reach - Math.min(1, Math.max(0, fraction)) * 2 * reach;
  const perPixel = (2 * reach) / Math.max(1, heightPx);
  const stops = [0, ...layers.map((l) => l.height)];
  let best: number | null = null;
  for (const h of stops) {
    if (Math.abs(h - raw) <= LAYER_SNAP_PX * perPixel && (best === null || Math.abs(h - raw) < Math.abs(best - raw))) best = h;
  }
  return best ?? raw;
}

/**
 * The dial's angle under the pointer, in radians, from the pointer's offset from the dial's pivot: right and up
 * are positive. The dial runs a quarter turn, from the object's diagonal lying flat (0) to standing upright (π/2),
 * and lands exactly on a named pose within `POSE_SNAP_DEG`.
 */
export function dialAngle(rung: RungId, right: number, up: number): number {
  const angle = Math.min(Math.PI / 2, Math.max(0, Math.atan2(Math.max(0, up), Math.max(1e-9, right))));
  for (const stop of Object.values(RUNGS[rung].stops)) {
    if (Math.abs(stop - angle) <= (POSE_SNAP_DEG * Math.PI) / 180) return stop;
  }
  return angle;
}

/**
 * Keys on a focused instrument. Up and Right raise it, Down and Left lower it, Shift makes the step ten times
 * larger on the gauge and three times on the dial. Page Up and Page Down move the gauge to the next layer of
 * corners; Home puts the slice through the middle. On the dial, Home and End turn to the first and last named
 * poses.
 */
export function sliderKey(instrument: 'gauge' | 'dial', key: string, shift: boolean): Action | null {
  const up = key === 'ArrowUp' || key === 'ArrowRight';
  const down = key === 'ArrowDown' || key === 'ArrowLeft';
  if (instrument === 'gauge') {
    if (up) return { type: 'slide-step', steps: shift ? 10 : 1 };
    if (down) return { type: 'slide-step', steps: shift ? -10 : -1 };
    if (key === 'PageUp') return { type: 'slide-layer', direction: 1 };
    if (key === 'PageDown') return { type: 'slide-layer', direction: -1 };
    if (key === 'Home') return { type: 'slide-to', offset: 0 };
    return null;
  }
  if (up) return { type: 'tip-step', steps: shift ? 3 : 1 };
  if (down) return { type: 'tip-step', steps: shift ? -3 : -1 };
  if (key === 'Home') return { type: 'pose', pose: 'facet' };
  if (key === 'End') return { type: 'pose', pose: 'edge' };
  return null;
}

/** Chapter buttons are generated from the chapter list; each establishes its chapter. */
export const chapterAction = (id: ChapterId): Action => ({ type: 'chapter', id });

/** What a key may do to the camera: the page's, not the model's. */
export type CameraKey = 'camera' | 'orbit-left' | 'orbit-right' | 'zoom-in' | 'zoom-out';

/**
 * Keys, when no text field has focus. Up and Down slide, Page Up and Page Down slide to the next layer of
 * corners, Left and Right turn; Shift makes a slide ten times larger. Space passes through or stops, S casts the
 * shadow, H hides or shows the cube, R resets the chapter, Escape lets go of what you picked. Q and E turn the
 * camera about the scene, + and − bring it nearer or farther, C brings it home: camera only, never the model.
 */
export function keyAction(key: string, shift: boolean, context: ControlContext): Action | CameraKey | null {
  switch (key) {
    case 'q': case 'Q': return 'orbit-left';
    case 'e': case 'E': return 'orbit-right';
    case '+': case '=': return 'zoom-in';
    case '-': case '_': return 'zoom-out';
    case 'c': case 'C': return 'camera';
    case 'ArrowUp': return { type: 'slide-step', steps: shift ? 10 : 1 };
    case 'ArrowDown': return { type: 'slide-step', steps: shift ? -10 : -1 };
    case 'PageUp': return { type: 'slide-layer', direction: 1 };
    case 'PageDown': return { type: 'slide-layer', direction: -1 };
    case 'ArrowLeft': return { type: 'tip-step', steps: -1 };
    case 'ArrowRight': return { type: 'tip-step', steps: 1 };
    case ' ': return { type: context.passing ? 'stop' : 'play' };
    case 's': case 'S': return { type: 'shadow', on: !context.shadowOn };
    case 'h': case 'H': return { type: 'show-object', on: !context.objectShown };
    case 'r': case 'R': return { type: 'reset' };
    case 'Escape': return { type: 'inspect', target: null };
    default: return null;
  }
}
