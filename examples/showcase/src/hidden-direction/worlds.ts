import { VecN, type HyperplaneSliceN } from '@holotope/core';
import { Group, type Object3D } from 'three';
import { SCENE, type GlomeObject } from '../spatial-4d-turn/scene.js';
import { createProducts, type SectionProduct } from '../spatial-4d-turn/section.js';
import { ContextLayer } from '../spatial-4d-turn/context.js';
import { applyTo, createSlice, type TurnState } from '../spatial-4d-turn/turn-state.js';
import {
  BALL, BOX, ContactSimulation, PRESETS, impactStepOf, type ContactReport, type Preset, type PresetId
} from '../spatial-4d-contact/simulation.js';
import { SceneViews } from '../spatial-4d-contact/views.js';
import { RotationStudy } from '../spatial-4d-contact/study.js';
import { ballFootprint, polytopeFootprint, type Footprint } from './plane.js';

/**
 * The two worlds the experience can show, each a thin owner of the existing,
 * tested modules — nothing here slices, projects, integrates or rotates. The
 * section, the projection, the physics and the prescribed turn are the
 * spatial pages' own modules, unchanged; this file only reads them, and adds
 * the one measurement the new instrument needs: where each body lies ACROSS
 * the cut.
 *
 * ## Height across the cut
 *
 * The cut is the hyperplane {p : n·p = offset}. A body's height across it is
 * the interval of n·p over the body: for a polytope, the least and greatest
 * n·v over its posed corners; for a ball, n·c ∓ r. The cut meets the body
 * exactly when the offset lies in that interval — for a convex body this is
 * the whole story, which is why the gauge can be trusted to say "in your
 * slice" or "beyond it". The values are the library's `signedDistance` plus
 * the offset, nothing else. When the cut turns, n turns, and every interval is
 * read again along the new normal: the gauge always measures across the cut
 * you have, never along a fixed axis.
 */

/** One body as seen by the instrument. */
export interface BodyReading {
  readonly id: string;
  readonly name: string;
  readonly colour: string;
  /** The library's word on membership: present, tangent (meets only on its boundary) or outside. */
  readonly status: 'present' | 'tangent' | 'outside';
  /** Primitives the renderer was handed for this body's section; 0 means nothing solid is drawn. */
  readonly drawn: number;
  /** Least and greatest height n·p over the body. */
  readonly low: number;
  readonly high: number;
  /** Signed distance of the body's nearest point from the cut: 0 when the cut meets it, else how far and to which side. */
  readonly gap: number;
  /** The section's own Object3D, for framing; the chart frame is the world frame. */
  readonly object: Object3D;
  /** A bound on where the body's section can appear in the chart: centre and radius. Null when nothing is drawn. */
  readonly drawnBound: { readonly centre: readonly [number, number, number]; readonly radius: number } | null;
  /** The body flattened onto the x–w plane along y and z, from the same corners or centre as low/high. */
  readonly footprint: Footprint;
  /**
   * A small marker the section modules draw that is not a cut: the point where a ball touches the
   * slice ('touch'), or, for the turning world's ball on a near miss, where the slice would first
   * touch it ('nearest'). Null when no marker is drawn.
   */
  readonly marker: 'touch' | 'nearest' | null;
  /** Where that marker is drawn, in chart coordinates: the foot of the perpendicular from the ball's centre. */
  readonly markerAt: readonly [number, number, number] | null;
  /** The turning world's ball, cut within the graze band of its edge, is drawn hollow (a display convention). */
  readonly hollow: boolean;
}

/**
 * The names a visitor reads. Presentation only: the modules keep their own ids
 * and names, and the turning scene's "companion" is simply the ball here.
 */
const DISPLAY_NAME: Readonly<Record<string, string>> = { block: 'Block', companion: 'Ball', box: 'Box', ball: 'Ball' };
const displayName = (id: string, fallback: string): string => DISPLAY_NAME[id] ?? fallback;

/** Height interval of a set of posed corners along the cut's normal. */
function cornerInterval(slice: HyperplaneSliceN, corners: readonly (readonly number[])[]): { low: number; high: number } {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const c of corners) {
    const h = slice.signedDistance(c) + slice.offset;
    if (h < low) low = h;
    if (h > high) high = h;
  }
  return { low, high };
}

/** The gap from an interval to the cut: 0 inside, negative below, positive above. */
function gapOf(low: number, high: number, offset: number): number {
  if (offset < low) return low - offset;
  if (offset > high) return high - offset;
  return 0;
}

/** The foot of the perpendicular from a point to the slice, in chart coordinates — the library's own projection. */
function footOf(slice: HyperplaneSliceN, point: readonly number[]): [number, number, number] {
  const c = slice.projectPointToChart(point).coordinates;
  return [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];
}

/** World-frame bound of a drawn Object3D (identity-posed products only), or null when it draws nothing. */
function drawnBoundOf(object: Object3D, fallbackRadius = 0): BodyReading['drawnBound'] {
  let found: BodyReading['drawnBound'] = null;
  object.traverse((child) => {
    if (found || !child.visible) return;
    const mesh = child as unknown as { geometry?: { boundingSphere: { center: { x: number; y: number; z: number }; radius: number } | null; computeBoundingSphere(): void; drawRange?: { count: number } } };
    const g = mesh.geometry;
    if (!g) return;
    if (g.boundingSphere === null) g.computeBoundingSphere();
    const s = g.boundingSphere;
    if (!s || !Number.isFinite(s.radius) || s.radius < 0) return;
    const p = child.getWorldPosition(child.position.clone());
    const scale = child.scale.x;
    found = {
      centre: [p.x + s.center.x * scale, p.y + s.center.y * scale, p.z + s.center.z * scale],
      radius: Math.max(s.radius * scale, fallbackRadius)
    };
  });
  return found;
}

/* -------------------------------------------------------------------------- */
/* The turning world: an unmoving block and a ball on a prescribed orbit.      */
/* -------------------------------------------------------------------------- */

export class TurnWorld {
  readonly kind = 'turn' as const;
  readonly slice: HyperplaneSliceN = createSlice();
  readonly products: readonly SectionProduct[];
  readonly context: ContextLayer;
  /** Every Object3D this world draws, sections and shadow, under one root. */
  readonly root = new Group();

  constructor() {
    this.products = createProducts(SCENE, this.slice);
    this.context = new ContextLayer(this.products, this.slice);
    for (const p of this.products) this.root.add(p.object);
    this.root.add(this.context.object);
    this.root.name = 'world:turn';
  }

  /** Apply the knife and the orbit phase, then re-cut and re-project. */
  apply(state: TurnState): void {
    applyTo(this.slice, state);
    for (const p of this.products) { p.setPhase(state.phase); p.update(this.slice); }
    this.context.update();
  }

  bodies(): BodyReading[] {
    return this.products.map((p) => {
      let low: number;
      let high: number;
      let footprint: Footprint;
      if (p.complex) {
        const corners: number[][] = [];
        for (let v = 0; v < p.complex.vertexCount; v++) corners.push(Array.from(p.complex.getPosition(v)));
        ({ low, high } = cornerInterval(this.slice, corners));
        footprint = polytopeFootprint(corners);
      } else {
        const centre = p.position4()!;
        const h = this.slice.signedDistance(centre) + this.slice.offset;
        const r = (SCENE.find((o) => o.id === p.id) as GlomeObject).radius;
        low = h - r;
        high = h + r;
        footprint = ballFootprint(centre, r);
      }
      const marker = p.complex !== null ? null : p.status === 'tangent' ? 'touch' : p.status === 'outside' && p.grazing ? 'nearest' : null;
      return {
        id: p.id, name: displayName(p.id, p.name), colour: p.colour, status: p.status, drawn: p.primitiveCount,
        low, high, gap: gapOf(low, high, this.slice.offset), object: p.object,
        drawnBound: p.primitiveCount > 0 ? drawnBoundOf(p.object) : null,
        footprint,
        // As the section product draws it: a touch point when tangent, a nearest point on a near miss.
        marker,
        markerAt: marker === null ? null : footOf(this.slice, p.position4()!),
        hollow: p.complex === null && p.status === 'present' && p.grazing
      };
    });
  }

  dispose(): void {
    for (const p of this.products) p.dispose();
    this.context.dispose();
  }
}

/* -------------------------------------------------------------------------- */
/* The contact world: a box and a ball, one physical impact per launch.        */
/* -------------------------------------------------------------------------- */

const presetOf = (id: PresetId): Preset => PRESETS.find((p) => p.id === id)!;

export class ContactWorld {
  readonly kind = 'contact' as const;
  readonly slice: HyperplaneSliceN = createSlice();
  readonly views: SceneViews;
  readonly root = new Group();
  readonly study = new RotationStudy();
  presetId: PresetId = 'central';
  sim: ContactSimulation;
  private readonly impactCache = new Map<PresetId, number | null>();

  constructor() {
    this.views = new SceneViews(this.slice);
    this.sim = new ContactSimulation(presetOf(this.presetId));
    this.root.add(this.views.box.object, this.views.ball.object, this.views.context.object);
    this.root.name = 'world:contact';
    this.study.views.object.visible = false;
  }

  /** A fresh launch of a preset: the only way the clock goes back to zero. */
  launch(id: PresetId): void {
    this.presetId = id;
    this.sim = new ContactSimulation(presetOf(id));
  }

  /** A replay to a fixed step count, from launch — never a rewind of the running state. */
  replayTo(steps: number): void {
    this.sim = ContactSimulation.atStep(presetOf(this.presetId), Math.max(0, Math.round(steps)));
  }

  /** One fixed step of the physics clock: the only way time moves forward. */
  step(): ContactReport {
    return this.sim.step().contact;
  }

  /** The first responding step for the current preset, found by stepping a fresh simulation, and cached. */
  impactStep(): number | null {
    if (!this.impactCache.has(this.presetId)) this.impactCache.set(this.presetId, impactStepOf(presetOf(this.presetId)));
    return this.impactCache.get(this.presetId)!;
  }

  /** Apply the knife (its phase is unused here) and re-read every view from the simulation. */
  apply(knife: TurnState): void {
    applyTo(this.slice, knife);
    // As on the accepted page: the views read the simulation and its last impact, and write nothing back.
    this.views.update(this.sim, this.sim.lastImpact);
  }

  bodies(): BodyReading[] {
    const pose = this.sim.boxPose();
    const corners: number[][] = [];
    const complex = this.views.box.complex;
    const v4 = new VecN(4);
    for (let v = 0; v < complex.vertexCount; v++) {
      const source = complex.getPosition(v);
      for (let c = 0; c < 4; c++) v4.data[c] = source[c]!;
      corners.push(Array.from(pose.applyToPoint(v4).data));
    }
    const box = cornerInterval(this.slice, corners);
    const centre = Array.from(this.sim.ball.position.data);
    const h = this.slice.signedDistance(centre) + this.slice.offset;
    const boxView = this.views.box;
    const ballView = this.views.ball;
    return [
      {
        id: 'box', name: BOX.name, colour: BOX.colour, status: boxView.status, drawn: boxView.primitiveCount,
        low: box.low, high: box.high, gap: gapOf(box.low, box.high, this.slice.offset), object: boxView.object,
        drawnBound: boxView.primitiveCount > 0 ? drawnBoundOf(boxView.object) : null,
        footprint: polytopeFootprint(corners),
        marker: null,
        markerAt: null,
        hollow: false
      },
      {
        id: 'ball', name: BALL.name, colour: BALL.colour, status: ballView.status, drawn: ballView.primitiveCount,
        low: h - BALL.radius, high: h + BALL.radius, gap: gapOf(h - BALL.radius, h + BALL.radius, this.slice.offset),
        object: ballView.object,
        drawnBound: ballView.primitiveCount > 0 ? drawnBoundOf(ballView.object) : null,
        footprint: ballFootprint(centre, BALL.radius),
        // The contact page's ball view marks only the touching point; it draws nothing for a near miss.
        marker: ballView.status === 'tangent' ? 'touch' : null,
        markerAt: ballView.status === 'tangent' ? footOf(this.slice, centre) : null,
        hollow: false
      }
    ];
  }

  /** The turning scene's box flattened onto the x–w plane: its own complex, posed by the study's own rotor. */
  studyFootprint(): Footprint {
    const pose = this.study.pose();
    const complex = this.study.views.box.complex;
    const v4 = new VecN(4);
    const corners: number[][] = [];
    for (let v = 0; v < complex.vertexCount; v++) {
      const source = complex.getPosition(v);
      for (let c = 0; c < 4; c++) v4.data[c] = source[c]!;
      corners.push(Array.from(pose.applyToPoint(v4).data));
    }
    return polytopeFootprint(corners);
  }

  dispose(): void {
    this.views.dispose();
    this.study.dispose();
  }
}

