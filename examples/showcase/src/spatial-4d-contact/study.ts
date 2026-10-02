import { Rotor4, TransformN, VecN, type HyperplaneSliceN } from '@holotope/core';
import { ProjectedEdges3D } from '@holotope/three';
import { Group, LineBasicMaterial, type Object3D } from 'three';
import { ChartProjection } from '../spatial-4d-turn/context.js';
import { createSlice } from '../spatial-4d-turn/turn-state.js';
import { BOX } from './simulation.js';
import { BoxSectionView } from './views.js';

/**
 * The rotation study: a centred rigid hyperbox with a PRESCRIBED orientation,
 * a fixed section, no translation and no collision. Not a physics simulation.
 *
 * Two modes turn the same source box, with the same authored proportions as
 * the interaction scene, about the same centre:
 *
 * - **Ordinary turn** — the x–y plane, which lies inside the fixed `w = 0`
 *   section. The visible section is the same 3D box rigidly rotated within
 *   x, y, z: geometric motion of the same 4D source object, not a separately
 *   simulated 3D body with a mass or an inertia of its own.
 * - **Turn through the fourth direction** — the x–w plane. The source box
 *   stays rigid; the section changes its x extent and which source faces bound
 *   it, because it cuts different parts of the object — not because the
 *   object deforms. For this centred family the section is always a cuboid
 *   with the authored y and z extents; its x half-extent is
 *   `min(h_x/|cos α|, h_w/|sin α|)`, bounded by the x faces below
 *   `|tan α| = h_w/h_x` and by the w faces above it, widest at that transition.
 *   Nothing else changes: no topology change, no other face family.
 *
 * ## Who computes what
 *
 * The orientation is the library's `Rotor4.fromPlane`; the pose a `TransformN`;
 * the section `SectionChart3D.update(pose)` through the interaction demo's
 * `BoxSectionView`; the context `ProjectedEdges3D.update(pose)` through the
 * turn demo's `ChartProjection`. The slice is created once at the reference
 * and NEVER reoriented — the object turns, the knife does not — so there is no
 * frame transport and no frame jump anywhere in a revolution. The analytic
 * extents above are stated for the reader and derived independently in the
 * tests; nothing here computes them.
 *
 * ## What is separate
 *
 * The study has its own angle, clock and slice. It never reads or writes the
 * collision simulation; entering and leaving it leaves that state where it
 * was, and the page holds that in a test.
 */

export type StudyMode = 'ordinary' | 'fourth';

export const STUDY_PLANES = {
  ordinary: { i: 0, j: 1, label: 'x–y', name: 'Ordinary turn (x–y plane, inside the section)' },
  fourth: { i: 0, j: 3, label: 'x–w', name: 'Turn through the fourth direction (x–w plane)' }
} as const;

export const FULL_TURN = 2 * Math.PI;

/** Object-angle rates, radians per second: a full revolution in 12 s, or in 48 s. */
export const STUDY_RATES = { normal: FULL_TURN / 12, slow: FULL_TURN / 48 } as const;
export type StudyRate = keyof typeof STUDY_RATES;

export interface StudyLandmark {
  readonly id: string;
  readonly name: string;
  /** Object angle, radians. */
  readonly angle: number;
  readonly note: string;
}

/** The angle at which, in the x–w mode, the section stops being bounded by the x faces: tan α = h_w / h_x. */
export function transitionAngle(): number {
  return Math.atan(BOX.halfExtents[3] / BOX.halfExtents[0]);
}

/** A few angles worth stopping at, from the authored half-extents. */
export function studyLandmarks(): readonly StudyLandmark[] {
  const t = transitionAngle();
  const deg = (r: number): string => `${((r * 180) / Math.PI).toFixed(1)}°`;
  return [
    { id: 'reference', name: `0° — reference`, angle: 0, note: 'The authored box, unrotated: the section is its x·y·z box.' },
    { id: 'transition', name: `${deg(t)} — face transition (x–w mode)`, angle: t, note: `In the x–w mode the x faces and the w faces trade places here; the section is widest, √(h_x² + h_w²) = ${Math.hypot(BOX.halfExtents[0], BOX.halfExtents[3]).toFixed(3)}. In the x–y mode nothing special happens.` },
    { id: 'quarter', name: '90° — quarter turn', angle: Math.PI / 2, note: 'x–w mode: the section is the box’s y·z·w extent — its x half-extent is now h_w = 1.0. x–y mode: the box has turned a right angle within the section.' },
    { id: 'half', name: '180° — half turn', angle: Math.PI, note: 'Both modes: the same shape as at 0°; the box has turned end for end.' },
    { id: 'full', name: '360° — full revolution', angle: FULL_TURN, note: 'Back to the reference geometry, with the section frame untouched throughout.' }
  ];
}

/** Section and context of the study box over one fixed slice, updated from one pose. */
export class StudyViews {
  readonly object = new Group();
  readonly box: BoxSectionView;
  readonly context = new Group();
  private readonly edges: ProjectedEdges3D;
  private readonly edgeMaterial: LineBasicMaterial;

  constructor(readonly slice: HyperplaneSliceN) {
    this.box = new BoxSectionView(slice);
    this.edgeMaterial = new LineBasicMaterial({ color: BOX.colour, transparent: true, opacity: 0.4, depthWrite: false });
    this.edges = new ProjectedEdges3D(this.box.complex, new ChartProjection(slice), { material: this.edgeMaterial });
    this.edges.object.name = 'study-context:box-edges';
    this.context.name = 'study-context';
    this.context.add(this.edges.object);
    this.context.visible = false;
    this.object.name = 'rotation-study';
    this.object.add(this.box.object, this.context);
  }

  /** One pose for both views. */
  update(pose: TransformN): void {
    this.box.update(this.slice, pose);
    this.edges.update(pose);
  }

  /** The drawn section vertices, embedded back into R4 by the slice — the live range only. */
  sectionVertices(): number[][] {
    const mesh = this.box.object as unknown as { geometry: { getAttribute(name: string): { getX(i: number): number; getY(i: number): number; getZ(i: number): number }; drawRange: { count: number } } };
    const position = mesh.geometry.getAttribute('position');
    const out: number[][] = [];
    for (let i = 0; i < mesh.geometry.drawRange.count; i++) {
      out.push(this.slice.embedPoint([position.getX(i), position.getY(i), position.getZ(i)]));
    }
    return out;
  }

  /** The projected source corners from the live context buffer, chart coordinates. */
  contextVertices(): number[][] {
    const position = this.edges.geometry.getAttribute('position');
    const out: number[][] = [];
    for (let i = 0; i < this.box.complex.vertexCount; i++) out.push([position.getX(i), position.getY(i), position.getZ(i)]);
    return out;
  }

  dispose(): void {
    this.box.dispose();
    this.edges.dispose();
    this.edgeMaterial.dispose();
  }
}

export class RotationStudy {
  mode: StudyMode = 'ordinary';
  /** Object angle, radians, in [0, 2π]. */
  angle = 0;
  playing = false;
  rate: StudyRate = 'slow';
  /** Created once at the reference and never reoriented: the section is fixed. */
  readonly slice: HyperplaneSliceN = createSlice();
  readonly views: StudyViews;

  constructor() {
    this.views = new StudyViews(this.slice);
    this.update();
  }

  /** The box's pose: the library's rotor in the mode's plane, about the origin, no translation. */
  pose(): TransformN {
    const plane = STUDY_PLANES[this.mode];
    return new TransformN(4, Rotor4.fromPlane(plane.i, plane.j, this.angle), VecN.zero(4));
  }

  setAngle(angle: number): void {
    if (!Number.isFinite(angle)) return;
    this.angle = Math.min(FULL_TURN, Math.max(0, angle));
    this.update();
  }

  /** Change the rotation plane, keeping the object angle; says what changed. */
  setMode(mode: StudyMode): string {
    const from = STUDY_PLANES[this.mode].label;
    this.mode = mode;
    this.update();
    return from === STUDY_PLANES[mode].label
      ? `Still turning in the ${from} plane at ${this.angleDegrees().toFixed(1)}°.`
      : `Same object angle, ${this.angleDegrees().toFixed(1)}°, now measured in the ${STUDY_PLANES[mode].label} plane instead of ${from}. The section frame and the camera did not move.`;
  }

  setPlaying(on: boolean): void {
    this.playing = on;
  }

  setRate(rate: StudyRate): void {
    this.rate = rate;
  }

  /** Advance the object angle by the elapsed wall-clock time while playing; wraps at a full revolution. */
  advance(seconds: number): void {
    if (!this.playing || !(seconds > 0)) return;
    const next = this.angle + STUDY_RATES[this.rate] * seconds;
    this.angle = next >= FULL_TURN ? next - FULL_TURN : next;
    this.update();
  }

  /** The known reference: angle 0, paused; the mode is kept. */
  reset(): void {
    this.playing = false;
    this.angle = 0;
    this.update();
  }

  angleDegrees(): number {
    return (this.angle * 180) / Math.PI;
  }

  update(): void {
    this.views.update(this.pose());
  }

  /** What the reader is looking at, for the current mode. */
  describe(): string {
    const [hx, hy, hz, hw] = BOX.halfExtents;
    const t = ((transitionAngle() * 180) / Math.PI).toFixed(1);
    if (this.mode === 'ordinary') {
      return `Prescribed turn — not a physics simulation. The box turns in the x–y plane, which lies inside the fixed `
        + `w = 0 section. What you see is the same rigid 3D box (${hx} × ${hy} × ${hz}) rotating within x, y, z: ordinary `
        + 'three-dimensional motion of the same 4D source object. Its shape and its bounding faces never change.';
    }
    return `Prescribed turn — not a physics simulation. The box turns in the x–w plane; the section stays at w = 0. `
      + 'The source box is rigid; the section changes shape because it cuts different parts of the object — not '
      + `because the object deforms. Its x half-extent runs from ${hx} (bounded by the x faces) through `
      + `${Math.hypot(hx, hw).toFixed(3)} at the ${t}° transition to ${hw} at 90° (bounded by the w faces); y and z stay `
      + `${hy} and ${hz}. Nothing else happens in this family: no new face kinds, no change of topology.`;
  }

  dispose(): void {
    this.views.dispose();
  }
}

export type { Object3D };
