import { Rotor4, VecN } from '@holotope/core';

/**
 * One fixed 4D scene, and the conventions that say what turning means.
 *
 * ## The scene
 *
 * Authored once in R4 and never altered. The block never moves. The ball moves
 * only along its STATED PATH (`positionAt`, below), which is itself authored
 * here once; nothing else moves an object, and the other thing that moves is
 * the 3D hyperplane we look through. If the block's shape on screen changes, it
 * changed because the section moved, not because the scene did — and
 * `turn.test.ts` ("the scene is authored once and never moves") holds the
 * source coordinates to that.
 *
 * ## Axes and pivot
 *
 * Ambient coordinates are (x, y, z, w) with indices 0..3. The OBSERVER PIVOT is
 * the origin. It is a declared choice, not a derived one.
 *
 * ## The reference section
 *
 * Normal `n0 = (0, 0, 0, 1)` and offset 0 — the hyperplane `w = 0`, which
 * contains the pivot.
 *
 * ## What the turn control does
 *
 * Angle `theta` rotates the SECTION NORMAL in the x–w plane, by
 * `Rotor4.fromPlane(0, 3, theta)` applied to `n0`. A rotor is an isometry
 * fixing the origin, so `n(theta)` stays a unit vector and the hyperplane
 * `{ p : n(theta) . p = 0 }` contains the pivot FOR EVERY theta. That is the
 * pivot guarantee, and it is a guarantee only at offset zero.
 *
 * ## What the offset control does, and does not
 *
 * Offset `d` selects `{ p : n(theta) . p = d }` — the parallel hyperplane at
 * signed distance `d` along the current normal. At `d != 0` the section NO
 * LONGER passes through the pivot, and turning then sweeps a family of
 * hyperplanes with no common point. The offset does not preserve the pivot
 * condition; it trades it for a parallel displacement. Saying otherwise would
 * be the easy lie here.
 *
 * ## Chart frame
 *
 * The 3D chart's basis is the reference frame x, y, z turned by the SAME rotor
 * that turns the normal, and it is re-derived from the reference at every
 * update — `applyTo` in `turn-state.ts` says how, and why a single transport
 * step of a quarter turn must never be taken (it permutes the frame; found in
 * review). The frame is therefore a function of theta alone: a jump and a slow
 * drag agree, and Reset returns exactly x, y, z. Which orthonormal basis of the
 * same hyperplane is shown is presentation; it changes no membership and no
 * geometry.
 */

/** The plane the turn control rotates in: x is axis 0, w is axis 3. */
export const TURN_PLANE = { i: 0, j: 3, label: 'x–w' } as const;

/** The section normal at theta = 0. */
export const REFERENCE_NORMAL: readonly number[] = [0, 0, 0, 1];

/** The observer point the section pivots about at zero offset. */
export const PIVOT: readonly number[] = [0, 0, 0, 0];

export interface HyperboxObject {
  readonly kind: 'hyperbox';
  readonly id: string;
  readonly name: string;
  readonly colour: string;
  /** Half-extents along x, y, z, w. Deliberately all different. */
  readonly halfExtents: readonly [number, number, number, number];
}

export interface GlomeObject {
  readonly kind: 'glome';
  readonly id: string;
  readonly name: string;
  readonly colour: string;
  /** Where the ball is at phase 0 — where it rests when not moving. */
  readonly centre: readonly [number, number, number, number];
  readonly radius: number;
  /**
   * The ball's STATED PATH: a circle about a fixed 4D centre, in one plane.
   *
   * This is authored motion, not simulated — no force acts, nothing is
   * integrated. The arm from the orbit centre to the rest position is rotated by
   * `Rotor4.fromPlane` through the phase, the same construction the knife's
   * turn uses; every frame is an exact section of the exact pose at that phase.
   */
  readonly orbit: {
    readonly plane: readonly [number, number];
    readonly centre: readonly [number, number, number, number];
  };
}

export type SceneObject = HyperboxObject | GlomeObject;

/**
 * The scene.
 *
 * The hyperbox is asymmetric in all four axes, so a section of it identifies
 * which way it is being cut: at theta = 0 the section is the 2.2 x 1.3 x 0.8
 * box, and turning changes its x-extent while leaving y and z alone.
 *
 * The companion sits away from the hyperbox in x and slightly off the reference
 * hyperplane in w. At theta = 0 it is OUTSIDE the section — its w-offset
 * exceeds its radius — and turning brings it through and out again, which is
 * the behaviour the scene exists to make visible.
 */
export const SCENE: readonly SceneObject[] = [
  {
    kind: 'hyperbox',
    id: 'block',
    name: 'Block',
    colour: '#4c7ff0',
    halfExtents: [2.2, 1.3, 0.8, 1.6]
  },
  {
    kind: 'glome',
    id: 'companion',
    name: 'Companion',
    colour: '#e0883a',
    centre: [3.6, 1.05, 0, 0.92],
    radius: 0.72,
    // Circling in the z–w plane about a point on the reference hyperplane. Its
    // x never changes, so the gap to the block (3.6 − 2.2 = 1.4) stays wider
    // than its radius at every phase: the two never touch. Its w is
    // 0.92·cos(phase), inside the reference cut where |w| < 0.72 — two arcs of
    // about 103° each, some 57% of the circle, not half; how much of the circle
    // any other knife pose reaches is that pose's own question, answered by the
    // phase slider's marks.
    orbit: { plane: [2, 3], centre: [3.6, 1.05, 0, 0] }
  }
];

/** The ball's centre at a phase along its path, by the library's rotor. */
export function positionAt(glome: GlomeObject, phase: number): readonly number[] {
  const o = glome.orbit.centre;
  const arm = new VecN(glome.centre.map((c, i) => c - o[i]!));
  const turned = Rotor4.fromPlane(glome.orbit.plane[0], glome.orbit.plane[1], phase)
    .applyToPoint(arm);
  return Array.from(turned.data, (v, i) => v + o[i]!);
}

/**
 * The section normal at a given turn angle.
 *
 * The rotation is the library's: a `Rotor4` in the declared plane, applied to
 * the reference normal. Nothing here writes a sine or a cosine.
 */
export function normalAt(theta: number): VecN {
  return Rotor4.fromPlane(TURN_PLANE.i, TURN_PLANE.j, theta)
    .applyToPoint(new VecN(REFERENCE_NORMAL));
}
