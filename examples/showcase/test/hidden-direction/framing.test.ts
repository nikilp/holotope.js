import { describe, expect, it } from 'vitest';
import { Vector3, type BufferGeometry, type Object3D, type PerspectiveCamera } from 'three';
import { VecN } from '@holotope/core';
import { createExperience } from '../../src/hidden-direction/experience.js';
import { SCENE_RADIUS, homeCamera, verticalFovFor } from '../../src/hidden-direction/stage.js';
import { SCENE, positionAt, type GlomeObject, type HyperboxObject } from '../../src/spatial-4d-turn/scene.js';
import { BOX } from '../../src/spatial-4d-contact/simulation.js';

/**
 * The home frame holds what the turning world draws.
 *
 * What this file proves:
 * - the field of view keeps at least 52° across at every aspect from phone
 *   portrait up, and is the base 38° wherever that already suffices;
 * - SCENE_RADIUS is an honest and tight bound on the turning world, computed
 *   here from the authored scene, not from the stage;
 * - on a grid of turn, slide and orbit phase, at phone through wide aspects,
 *   every drawn body is wholly inside the home camera's view — twice over: the
 *   controller's `frame` says 'in', and every vertex the renderer is handed
 *   projects inside the view volume, read from the geometry itself;
 * - the contact world is held from launch to 60 steps past the blow with the
 *   slice untilted;
 * - the known limit, at a concrete state: after the blow, with the slice turned
 *   toward w, the struck box is carried out of any fixed frame while still in
 *   the slice, and the controller says so and offers a camera-only recovery.
 *
 * What it does not prove: anything the renderer does with these vertices
 * (pixels, fog, name tags), the camera's motion when the recovery is followed
 * (`stage.frame` needs WebGL), or framing at grid points not sampled. The grid
 * is a sample; the scene bound and the orbit's closed form say why it is a
 * representative one for the ball.
 *
 * A note on the bound: SCENE_RADIUS is not by itself why the frame holds.
 * Vertically, at aspects where the base 38° applies, a sphere of that radius
 * about the centre point would not fit (it subtends 2·asin(4.6 / 11.49) ≈ 47°
 * from the home position); the drawn sections fit because they do not fill
 * that sphere in the camera's vertical. The sampled grid is what carries the
 * claim there.
 */

const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;
const horizontalFov = (verticalDeg: number, aspect: number): number => deg(2 * Math.atan(Math.tan(rad(verticalDeg) / 2) * aspect));

/**
 * Every vertex the renderer is handed for an object: the live draw range of
 * each visible geometry in the subtree, in world coordinates. Read from the
 * buffers, independent of the controller's bound and of its frame test.
 */
function drawnPoints(object: Object3D): Vector3[] {
  object.updateWorldMatrix(true, true);
  const out: Vector3[] = [];
  object.traverseVisible((child) => {
    const g = (child as { geometry?: BufferGeometry }).geometry;
    const pos = g?.getAttribute('position');
    if (!g || !pos) return;
    // An indexed display mesh (the ball's tessellation) draws every vertex; a section chart draws its live range.
    const start = g.index ? 0 : g.drawRange.start;
    const end = g.index ? pos.count : Math.min(pos.count, g.drawRange.start + g.drawRange.count);
    for (let i = start; i < end; i++) out.push(new Vector3().fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld));
  });
  return out;
}

/** Inside the camera's view volume, by three's own projection: normalised device coordinates within the unit cube. */
function inView(p: Vector3, camera: PerspectiveCamera): boolean {
  const q = p.clone().project(camera);
  return Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1 && q.z >= -1 && q.z <= 1;
}

type Experience = ReturnType<typeof createExperience>;

/** The Object3D the renderer draws for a body of the world in front. */
function objectOf(x: Experience, id: string): Object3D {
  if (id === 'box') return x.worlds.contact.views.box.object;
  if (id === 'ball') return x.worlds.contact.views.ball.object;
  return x.worlds.turn.products.find((p) => p.id === id)!.object;
}

/** Every drawn body wholly in view, by the controller's word and by the vertices; returns what failed. */
function framingFailures(x: Experience, cameras: readonly (readonly [number, PerspectiveCamera])[], tag: string): string[] {
  const failures: string[] = [];
  for (const [aspect, camera] of cameras) {
    for (const b of x.view(camera).bodies) {
      if (b.drawn === 0) continue;
      if (b.frame !== 'in') failures.push(`${tag} aspect ${aspect}: ${b.id} frame ${b.frame}`);
      const points = drawnPoints(objectOf(x, b.id));
      if (points.length === 0) failures.push(`${tag} aspect ${aspect}: ${b.id} drawn but no vertices`);
      const outside = points.filter((p) => !inView(p, camera)).length;
      if (outside > 0) failures.push(`${tag} aspect ${aspect}: ${b.id} has ${outside} of ${points.length} vertices out of view`);
    }
  }
  return failures;
}

/* -------------------------------------------------------------------------- */

describe('the field of view adapts to the screen\'s shape, and only to it', () => {
  it('is the base 38° wherever 38° already spans 52° across', () => {
    // 38° vertical spans 52° across from aspect tan(26°) / tan(19°) ≈ 1.4165 up.
    const crossover = Math.tan(rad(26)) / Math.tan(rad(19));
    expect(crossover).toBeCloseTo(1.4165, 4);
    for (const a of [1.42, 1.6, 2.2, 3, 5]) expect(verticalFovFor(a), `aspect ${a}`).toBe(38);
    expect(verticalFovFor(1.4)).toBeGreaterThan(38);
  });

  it('keeps at least 52° across at every aspect from 0.2 to 4', () => {
    for (let k = 20; k <= 400; k++) {
      const a = k / 100;
      // Where the minimum binds, equality holds up to rounding.
      expect(horizontalFov(verticalFovFor(a), a), `aspect ${a}`).toBeGreaterThanOrEqual(52 - 1e-9);
    }
  });

  it('opens only as the screen narrows: non-increasing in aspect', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let k = 20; k <= 400; k++) {
      const v = verticalFovFor(k / 100);
      expect(v, `aspect ${k / 100}`).toBeLessThanOrEqual(previous);
      previous = v;
    }
  });

  it('the home camera at each aspect looks at the centre point and spans at least 52° across', () => {
    for (const a of [0.56, 0.75, 1, 1.6, 2.2]) {
      const camera = homeCamera(a);
      expect(camera.aspect).toBe(a);
      expect(horizontalFov(camera.fov, camera.aspect)).toBeGreaterThanOrEqual(52 - 1e-9);
      const towardCentre = camera.position.clone().negate().normalize();
      expect(camera.getWorldDirection(new Vector3()).distanceTo(towardCentre)).toBeLessThan(1e-12);
    }
  });

  it('52° across clears the angle the scene radius subtends from home, with room to spare', () => {
    const distance = homeCamera(1).position.length();
    const needed = deg(2 * Math.asin(SCENE_RADIUS / distance));
    expect(needed).toBeGreaterThan(46);
    expect(needed).toBeLessThan(52);
  });
});

describe('SCENE_RADIUS is an honest bound on the turning world, and a tight one', () => {
  const companion = SCENE.find((o) => o.kind === 'glome') as GlomeObject;
  const block = SCENE.find((o) => o.kind === 'hyperbox') as HyperboxObject;

  it('bounds the ball at every orbit phase and the block\'s every corner, and the ball nearly reaches it', () => {
    let ball = 0;
    for (let k = 0; k <= 3600; k++) {
      const c = positionAt(companion, (2 * Math.PI * k) / 3600);
      ball = Math.max(ball, Math.hypot(...c) + companion.radius);
    }
    // Closed form: the arm (0, 0, 0, 0.92) turns in z–w, orthogonal to the orbit centre (3.6, 1.05, 0, 0),
    // so |c| is the same at every phase.
    expect(ball).toBeCloseTo(Math.sqrt(3.6 ** 2 + 1.05 ** 2 + 0.92 ** 2) + 0.72, 12);
    const corner = Math.hypot(...block.halfExtents);
    expect(corner).toBeCloseTo(Math.sqrt(2.2 ** 2 + 1.3 ** 2 + 0.8 ** 2 + 1.6 ** 2), 12);
    expect(ball).toBeLessThanOrEqual(SCENE_RADIUS);
    expect(corner).toBeLessThanOrEqual(SCENE_RADIUS);
    // Tight, not padded: the ball's farthest point is within 0.05 of the stated radius.
    expect(SCENE_RADIUS - ball).toBeLessThan(0.05);
  });
});

describe('the home frame holds every section the turning world draws', () => {
  const ASPECTS = [0.56, 0.75, 1.0, 1.6, 2.2] as const;
  const THETAS = [-90, -60, -36, -15, 0, 15, 36, 60, 90];
  const OFFSETS = [-1.6, -0.8, 0, 0.8, 1.6];
  const PHASES = Array.from({ length: 12 }, (_, k) => k * 30);

  it('on a grid of turn × slide × orbit phase, at phone through wide aspects', () => {
    const cameras = ASPECTS.map((a) => [a, homeCamera(a)] as const);
    const x = createExperience('free');
    const failures: string[] = [];
    const drawnStates = { block: 0, companion: 0 };
    let farthest = 0;
    for (const theta of THETAS) {
      x.dispatch({ type: 'cut-turn', degrees: theta });
      for (const offset of OFFSETS) {
        x.dispatch({ type: 'cut-offset', value: offset });
        for (const phase of PHASES) {
          x.dispatch({ type: 'orbit-phase', degrees: phase });
          failures.push(...framingFailures(x, cameras, `θ ${theta} offset ${offset} phase ${phase}`));
          for (const b of x.view().bodies) {
            if (b.drawn === 0) continue;
            drawnStates[b.id as keyof typeof drawnStates]++;
            // The chart is a projection: nothing drawn lies farther from its origin than the scene bound.
            for (const p of drawnPoints(objectOf(x, b.id))) farthest = Math.max(farthest, p.length());
          }
        }
      }
    }
    expect(failures).toEqual([]);
    // Not vacuous: the block is drawn in most sampled states, the ball in a share of them (the sweep below covers it).
    expect(drawnStates.block).toBeGreaterThan(400);
    expect(drawnStates.companion).toBeGreaterThanOrEqual(60);
    expect(farthest).toBeLessThanOrEqual(SCENE_RADIUS + 1e-5);
    x.dispose();
  });

  it('with the slice through the ball\'s centre wherever the slide can reach it: its largest section, at every turn and phase', () => {
    const cameras = ASPECTS.map((a) => [a, homeCamera(a)] as const);
    const companion = SCENE.find((o) => o.kind === 'glome') as GlomeObject;
    const x = createExperience('free');
    const failures: string[] = [];
    let sampled = 0;
    let farthest = 0;
    for (let theta = -63; theta <= 63; theta += 9) {
      x.dispatch({ type: 'cut-turn', degrees: theta });
      // The slice's normal, from first principles: the reference normal w turned by θ in the x–w plane.
      const n = [-Math.sin(rad(theta)), 0, 0, Math.cos(rad(theta))];
      for (let phase = 0; phase < 360; phase += 15) {
        const c = positionAt(companion, rad(phase));
        const height = n.reduce((sum, v, i) => sum + v * c[i]!, 0);
        const offset = Math.min(1.6, Math.max(-1.6, height));
        // Only where the reachable slice passes clearly inside the ball.
        if (Math.abs(height - offset) > companion.radius - 0.02) continue;
        x.dispatch({ type: 'orbit-phase', degrees: phase });
        x.dispatch({ type: 'cut-offset', value: offset });
        const ball = x.view().bodies.find((b) => b.id === 'companion')!;
        if (ball.drawn === 0) failures.push(`θ ${theta} phase ${phase}: the ball is in reach but not drawn`);
        sampled++;
        failures.push(...framingFailures(x, cameras, `θ ${theta} phase ${phase} offset ${offset.toFixed(3)}`));
        for (const p of drawnPoints(objectOf(x, 'companion'))) farthest = Math.max(farthest, p.length());
      }
    }
    expect(failures).toEqual([]);
    expect(sampled).toBeGreaterThan(150);
    expect(farthest).toBeLessThanOrEqual(SCENE_RADIUS + 1e-5);
    // The sweep reaches the bound itself, so it samples the farthest the ball is ever drawn, not a timid interior.
    expect(farthest).toBeGreaterThan(4.55);
    x.dispose();
  });

  it('and the widened field is load-bearing: the base 38° at phone aspect cuts the arrival block off', () => {
    const camera = homeCamera(0.56);
    camera.fov = 38;
    camera.updateProjectionMatrix();
    const x = createExperience('arrival');
    const block = x.view(camera).bodies.find((b) => b.id === 'block')!;
    expect(block.drawn).toBeGreaterThan(0);
    expect(block.frame).not.toBe('in');
    expect(drawnPoints(objectOf(x, 'block')).some((p) => !inView(p, camera))).toBe(true);
    // The same scene at the camera the page builds for that aspect is whole.
    expect(framingFailures(x, [[0.56, homeCamera(0.56)]], 'arrival')).toEqual([]);
    x.dispose();
  });
});

describe('the contact world is held around its launch', () => {
  it('from launch to 60 steps past the blow, slice untilted, at aspects 0.75 and 1.6, for both launches', () => {
    const cameras = [0.75, 1.6].map((a) => [a, homeCamera(a)] as const);
    for (const chapter of ['collision', 'spin'] as const) {
      const x = createExperience(chapter);
      const failures = framingFailures(x, cameras, `${chapter} launch`);
      // The blow lands in step 73; 60 steps past it is step 133.
      for (let k = 1; k <= 133; k++) {
        x.dispatch({ type: 'step' });
        failures.push(...framingFailures(x, cameras, `${chapter} step ${k}`));
      }
      expect(failures).toEqual([]);
      expect(x.worlds.contact.sim.steps).toBe(133);
      expect(x.worlds.contact.sim.impacts, `${chapter}: the blow landed`).toBeGreaterThanOrEqual(1);
      expect(Array.from(x.worlds.contact.slice.normal.data)).toEqual([0, 0, 0, 1]);
      x.dispose();
    }
  });
});

/**
 * The known limit. After the blow the box keeps moving along −w. With the
 * slice turned toward w its section is carried along the slice — the box stays
 * in the slice for as long as n·p still spans the offset, but its section
 * travels across the chart, out of any fixed frame. That is "in your slice,
 * but outside the camera's view": the controller must say so, and the only
 * recovery it may offer is a camera turn to the body's drawn bound.
 *
 * The direction matters. Turned to −80°, the section travels toward the
 * chart's +x, the side nearer the home camera, where it leaves the view; turned
 * to +80°, the same run carries it to the far side, where the frame still holds
 * it. Step 740 (667 steps past the blow) is inside the stretch, 710 to 774 at
 * aspect 0.75, in which the box is still in the slice and wholly out of view.
 */
describe('the known limit: a struck box carried out of the home frame, said and recoverable', () => {
  function struckAndTurned(degrees: number): Experience {
    const x = createExperience('collision');
    x.dispatch({ type: 'jump-touch' });
    x.dispatch({ type: 'step' });
    expect(x.worlds.contact.sim.impacts).toBe(1);
    x.dispatch({ type: 'cut-turn', degrees });
    while (x.worlds.contact.sim.steps < 740) x.dispatch({ type: 'step' });
    return x;
  }

  it('turned to −80° and 667 steps past the blow, the box is in the slice, out of view, and the recovery is camera-only', () => {
    const x = struckAndTurned(-80);
    const camera = homeCamera(0.75);
    const v = x.view(camera);
    const box = v.bodies.find((b) => b.id === 'box')!;
    const ball = v.bodies.find((b) => b.id === 'ball')!;

    // In the slice, independently: the posed corners' heights n·p span the offset 0, with n = (sin 80°, 0, 0, cos 80°).
    const n = [Math.sin(rad(80)), 0, 0, Math.cos(rad(80))];
    expect(Array.from(x.worlds.contact.slice.normal.data).map((c, i) => Math.abs(c - n[i]!))
      .every((d) => d < 1e-12)).toBe(true);
    const pose = x.worlds.contact.sim.boxPose();
    const heights: number[] = [];
    for (let s = 0; s < 16; s++) {
      const corner = BOX.halfExtents.map((h, i) => ((s >> i) & 1 ? h : -h));
      const p = pose.applyToPoint(new VecN(corner)).data;
      heights.push(n.reduce((sum, c, i) => sum + c * p[i]!, 0));
    }
    expect(Math.min(...heights)).toBeLessThan(0);
    expect(Math.max(...heights)).toBeGreaterThan(0);
    expect(box.status).toBe('present');
    expect(box.drawn).toBeGreaterThan(0);

    // Out of view, independently: every drawn vertex lies beyond one and the same side of the view.
    const ndc = drawnPoints(objectOf(x, 'box')).map((p) => p.clone().project(camera));
    expect(ndc.length).toBeGreaterThan(0);
    const beyond = [(q: Vector3) => q.x > 1, (q: Vector3) => q.x < -1, (q: Vector3) => q.y > 1, (q: Vector3) => q.y < -1]
      .some((side) => ndc.every(side));
    expect(beyond).toBe(true);

    // The controller says so, and nothing is drawn in view, so the empty-view panel speaks.
    expect(box.frame).toBe('out');
    expect(box.reason).toBe('Box is in your slice, but outside the camera’s view.');
    expect(ball.drawn).toBe(0);
    expect(v.empty).not.toBeNull();
    // The recovery for the box turns the camera to its drawn bound: no action, so no state of the world moves.
    expect(v.empty!.recoveries).toContainEqual({ label: 'Turn the camera to the box', action: null, frame: box.drawnBound });
    expect(box.drawnBound).not.toBeNull();

    // At a wide aspect the same state is not wholly out, but no longer wholly in: the frame has not held it.
    expect(x.view(homeCamera(1.6)).bodies.find((b) => b.id === 'box')!.frame).toBe('partial');
    x.dispose();
  });

  it('turned the other way, +80°, the same run at the same step is still drawn and not out of view', () => {
    const x = struckAndTurned(80);
    const box = x.view(homeCamera(0.75)).bodies.find((b) => b.id === 'box')!;
    expect(box.drawn).toBeGreaterThan(0);
    expect(box.frame).not.toBe('out');
    x.dispose();
  });
});
