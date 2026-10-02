import { HyperplaneSliceN } from '@holotope/core';
import { PIVOT, REFERENCE_NORMAL, normalAt } from './scene.js';

/**
 * The two controls that move the section, and nothing else.
 *
 * The 3D camera is deliberately absent: orbiting changes where the section is
 * viewed from and never which hyperplane it is. Keeping the camera out of this
 * type is what lets a test assert that by construction rather than by hoping.
 */

export interface TurnState {
  /** Turn angle in the declared plane, radians. */
  readonly theta: number;
  /** Signed displacement along the current normal. */
  readonly offset: number;
  /** Where along its stated path the moving body is, radians in [0, 2π). */
  readonly phase: number;
}

export const TURN_LIMIT = Math.PI / 2;
export const OFFSET_LIMIT = 1.6;

/**
 * Largest single frame-transport step, radians.
 *
 * The library's `'continuous'` policy projects the previous chart basis into
 * the new hyperplane and re-orthonormalises it. A single step of exactly a
 * quarter turn in the turn plane sends the basis vector lying in that plane
 * onto the new normal: its projection vanishes, it loses rank, and the library
 * skips it — the remaining vectors shift up and the frame comes out PERMUTED.
 * Found in review: a direct jump to 90° gave y, z, w and Reset from there gave
 * y, z, x, so the block reappeared reoriented with no camera input. Under this
 * limit every candidate keeps at least cos(45°) of its length, and for a
 * rotation in one plane each step's transport is the rotor's own action on the
 * frame.
 */
export const TRANSPORT_STEP_LIMIT = Math.PI / 4;

export const REFERENCE_STATE: TurnState = { theta: 0, offset: 0, phase: 0 };

const TAU = 2 * Math.PI;

export const setPhase = (s: TurnState, phase: number): TurnState =>
  ({ ...s, phase: Number.isFinite(phase) ? ((phase % TAU) + TAU) % TAU : s.phase });

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const setTheta = (s: TurnState, theta: number): TurnState =>
  ({ ...s, theta: clamp(theta, -TURN_LIMIT, TURN_LIMIT) });

export const setOffset = (s: TurnState, offset: number): TurnState =>
  ({ ...s, offset: clamp(offset, -OFFSET_LIMIT, OFFSET_LIMIT) });

/** Back to the one reference state, exactly. */
export const reset = (): TurnState => REFERENCE_STATE;

/** A fresh slice at the reference state. */
export const createSlice = (): HyperplaneSliceN =>
  new HyperplaneSliceN({ normal: [...REFERENCE_NORMAL], offset: 0 });

/**
 * Point the slice at the state.
 *
 * The chart frame is re-derived from the reference on EVERY call, so it is a
 * function of the state and of nothing that happened before:
 *
 * 1. `setNormal(n0, 'canonical')`. For an axis-aligned normal the library's
 *    canonical frame is the remaining coordinate axes, unchanged — so this is
 *    the reference frame x, y, z, bitwise, and Reset needs nothing more.
 * 2. `setNormal(n(k·θ/steps), 'continuous')` for k = 1 … steps, with `steps`
 *    the fewest that keep every step within TRANSPORT_STEP_LIMIT. For a turn in
 *    one plane each step's transport equals the rotor's action on the frame, so
 *    the frame at θ is the reference frame turned by the same rotor as the
 *    normal — `turn.test.ts` holds that against `Rotor4` directly, at both
 *    slider ends, for a direct jump and for a drag, and after Reset.
 *
 * Which orthonormal basis of the same hyperplane is shown is presentation; it
 * changes no membership and no geometry.
 */
export function applyTo(slice: HyperplaneSliceN, state: TurnState): void {
  slice.setNormal(REFERENCE_NORMAL, 'canonical');
  if (state.theta !== 0) {
    const steps = Math.ceil(Math.abs(state.theta) / TRANSPORT_STEP_LIMIT - 1e-12);
    for (let k = 1; k <= steps; k++) {
      slice.setNormal(normalAt((state.theta * k) / steps), 'continuous');
    }
  }
  slice.offset = state.offset;
}

/**
 * How far the section currently lies from the observer pivot.
 *
 * Zero exactly when the offset is zero — which is the whole content of the
 * pivot guarantee, and the reason the readout shows this number rather than
 * asserting the guarantee in prose.
 */
export function distanceFromPivot(slice: HyperplaneSliceN): number {
  return slice.signedDistance(PIVOT);
}

/** Which side of the section the observer point is on, read from the sign. */
export type ObserverSide = 'positive-normal' | 'negative-normal' | 'on-section';

export interface ObserverNote {
  readonly side: ObserverSide;
  readonly sentence: string;
}

/**
 * The pivot note the page shows, from the observer point's signed distance
 * from the section — `distanceFromPivot(slice)`: the point's distance measured
 * from the section along the normal, positive on the side the normal points
 * to. It is the POINT'S distance from the section, not the section's
 * displacement from the point; that is the offset, the opposite number.
 *
 * The side is named from the sign on every call. A fixed annotation was wrong
 * on half the slider (found in review): at every negative offset the point
 * lies on the normal's side while the note still said "behind".
 */
export function observerNote(signedDistance: number): ObserverNote {
  if (Math.abs(signedDistance) < 1e-12) {
    return {
      side: 'on-section',
      sentence: 'The section passes through the observer point, and turning keeps it there.'
    };
  }
  const positive = signedDistance > 0;
  const magnitude = Math.abs(signedDistance).toFixed(2);
  return {
    side: positive ? 'positive-normal' : 'negative-normal',
    sentence: `The observer point lies ${magnitude} from the section, `
      + `${positive ? 'on the side its normal points to' : 'on the side opposite its normal'}: its signed `
      + `distance, measured from the section along the normal, is ${positive ? '+' : '−'}${magnitude} (the `
      + 'section’s own offset along the normal is the opposite number). At a non-zero offset the section no '
      + 'longer pivots about that point: turning sweeps hyperplanes of different normals that all keep this '
      + 'distance from it and share no common point. Only the offset slider moves between parallel sections.'
  };
}
