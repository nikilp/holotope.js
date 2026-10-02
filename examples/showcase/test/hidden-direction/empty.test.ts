import { VecN } from '@holotope/core';
import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { createExperience, kindOf, type Action } from '../../src/hidden-direction/experience.js';
import { homeCamera } from '../../src/hidden-direction/stage.js';
import { BALL, BOX, PRESETS } from '../../src/spatial-4d-contact/simulation.js';

/**
 * An empty view is explained, with a way back — and its four causes are kept
 * apart:
 *
 * 1. outside the cut — the body lies wholly to one side of the slice;
 * 2. tangent — the slice meets the body only along its boundary, and the
 *    renderer draws solids only;
 * 3. outside the camera — the body is cut and drawn, but the camera looks
 *    elsewhere;
 * 4. renderer omission — the library places the body in the slice and the
 *    renderer was handed nothing.
 *
 * The first three are reached here through `dispatch`, read through `view()`,
 * and each carries its own reason and its own kind of recovery: a view action
 * for what the slice misses, a camera-only turn for what the camera misses.
 * The fourth is unreachable from the shipped scenes; this file holds that it
 * stays unreached across a grid of both worlds (its wording is the copy
 * tests'). The study scene, which has no collision bodies, is never an empty
 * view.
 *
 * What it does not prove: the page's panel markup, or that `stage.frame`
 * turns a WebGL camera (it needs a renderer); the recovery's frame is checked
 * as data.
 */

type Experience = ReturnType<typeof createExperience>;

const rad = (deg: number): number => (deg * Math.PI) / 180;
/** The slider's reach, as the turn page authored it. */
const REACH = 1.6;

/** Physics state a view action must not touch, read from the simulation's own objects. */
function physics(x: Experience) {
  const sim = x.worlds.contact.sim;
  return {
    steps: sim.steps,
    time: sim.time,
    impacts: sim.impacts,
    ballPosition: Array.from(sim.ball.position.data),
    ballVelocity: Array.from(sim.ball.linearVelocity.data),
    boxPosition: Array.from(sim.box.position.data),
    boxVelocity: Array.from(sim.box.linearVelocity.data),
    boxProbe: Array.from(sim.boxPose().applyToPoint(new VecN([0.3, -0.7, 1.1, 0.2])).data)
  };
}

describe('outside the cut: each body is beyond the slice, said with its side and distance', () => {
  const ballW = PRESETS.find((p) => p.id === 'central')!.ballStart[3];
  const [, , , hw] = BOX.halfExtents;

  it('at offset 1.6 in chapter III the view is empty, and each reason names its side and how far', () => {
    const x = createExperience('collision');
    x.dispatch({ type: 'cut-offset', value: 1.6 });
    const v = x.view();
    expect(v.empty).not.toBeNull();
    expect(v.empty!.headline).toBe('Your slice cuts nothing in view — and nothing has gone.');
    const box = v.bodies.find((b) => b.id === 'box')!;
    const ball = v.bodies.find((b) => b.id === 'ball')!;
    expect([box.status, box.drawn, ball.status, ball.drawn]).toEqual(['outside', 0, 'outside', 0]);
    // The box's top is w = h_w = 1.0, below the slice by 1.6 − 1.0: kata.
    // The ball's lowest point is w = 2.7 − 0.5 = 2.2, above it by 2.2 − 1.6: ana.
    expect(box.reason).toContain(`All of it lies ${(1.6 - hw).toFixed(2)} kata of your slice`);
    expect(ball.reason).toContain(`All of it lies ${(ballW - BALL.radius - 1.6).toFixed(2)} ana of your slice`);
    expect(box.caption).toBe(`Box — not in your slice: ${(1.6 - hw).toFixed(2)} kata of it`);
    expect(v.empty!.reasons).toEqual([
      { id: 'box', line: box.reason, colour: BOX.colour },
      { id: 'ball', line: ball.reason, colour: BALL.colour }
    ]);
    x.dispose();
  });

  it('offers exactly one recovery, to the box: the ball’s heights [2.2, 3.2] lie beyond the slider’s reach of ±1.6', () => {
    const low = ballW - BALL.radius;
    const high = ballW + BALL.radius;
    expect([low, high]).toEqual([2.2, 3.2]);
    expect(low).toBeGreaterThan(REACH);
    const x = createExperience('collision');
    x.dispatch({ type: 'cut-offset', value: 1.6 });
    const v = x.view();
    expect(v.empty!.recoveries).toEqual([
      { label: 'Slide your slice to the box', action: { type: 'cut-to', body: 'box' }, frame: null }
    ]);
    const ball = v.bodies.find((b) => b.id === 'ball')!;
    const box = v.bodies.find((b) => b.id === 'box')!;
    expect([box.reachable, ball.reachable]).toEqual([true, false]);
    expect(ball.reason.endsWith('Your slice cannot slide that far along this normal.')).toBe(true);
    expect(box.reason).not.toContain('cannot slide');
    x.dispose();
  });

  it('the recovery is a view action: the box is drawn again, the view is not empty, and the physics has not moved', () => {
    const x = createExperience('collision');
    // At the blow both bodies are moving, so "has not moved" means something;
    // the slice at −1.6 lies kata of both (box from about −1.01, ball from about 1.0).
    x.dispatch({ type: 'jump-after' });
    x.dispatch({ type: 'cut-offset', value: -1.6 });
    const v = x.view();
    expect(v.empty).not.toBeNull();
    expect(v.bodies.map((b) => b.status)).toEqual(['outside', 'outside']);
    const recovery = v.empty!.recoveries.find((r) => r.action !== null && r.action.type === 'cut-to' && r.action.body === 'box')!;
    expect(recovery.label).toBe('Slide your slice to the box');
    const action = recovery.action as Action;
    expect(kindOf(action)).toBe('view');
    const sim = x.worlds.contact.sim;
    const before = physics(x);
    const box = v.bodies.find((b) => b.id === 'box')!;
    x.dispatch(action);
    const after = x.view();
    const boxAfter = after.bodies.find((b) => b.id === 'box')!;
    expect(boxAfter.status).toBe('present');
    expect(boxAfter.drawn).toBeGreaterThan(0);
    expect(after.empty).toBeNull();
    // The slice goes to the middle of the box's heights, which the slider can reach.
    expect(after.cut.offset).toBeCloseTo((box.low + box.high) / 2, 12);
    expect(Math.abs(after.cut.offset)).toBeLessThanOrEqual(REACH);
    expect(x.worlds.contact.sim).toBe(sim);
    expect(physics(x)).toEqual(before);
    x.dispose();
  });

  it('at launch the box’s heights are [−1, 1], so the recovery puts the slice through its centre', () => {
    const x = createExperience('collision');
    x.dispatch({ type: 'cut-offset', value: 1.6 });
    x.dispatch({ type: 'cut-to', body: 'box' });
    expect(x.view().cut.offset).toBe(0);
    x.dispose();
  });
});

describe('tangent: the slice touches the box only along its boundary', () => {
  it('turned 30° and slid to the box’s least height across the slice, the box is touching, draws nothing, and the empty view says why', () => {
    const x = createExperience('collision');
    x.dispatch({ type: 'cut-turn', degrees: 30 });
    const n = Array.from(x.worlds.contact.slice.normal.data);
    // The turn convention: +w turned 30° toward −x.
    expect(n[0]).toBeCloseTo(-Math.sin(rad(30)), 12);
    expect(n[3]).toBeCloseTo(Math.cos(rad(30)), 12);
    expect([n[1], n[2]]).toEqual([0, 0]);
    // The box at launch sits at the origin, unturned: its 16 corners are (±h_x, ±h_y, ±h_z, ±h_w).
    let least = Number.POSITIVE_INFINITY;
    for (let m = 0; m < 16; m++) {
      const corner = BOX.halfExtents.map((h, i) => ((m >> i) & 1 ? h : -h));
      least = Math.min(least, corner.reduce((s, c, i) => s + c * n[i]!, 0));
    }
    // −(1.2 sin 30° + 1.0 cos 30°) ≈ −1.4660, inside the slider's reach.
    expect(least).toBeCloseTo(-(1.2 * 0.5 + 1.0 * Math.sqrt(3) / 2), 12);
    expect(least).toBeGreaterThan(-REACH);
    // The least height, not the greatest: the sectioner counts a point on the
    // slice as the far side, so with the whole box on the normal's side
    // nothing is emitted and the library calls it tangent. At the greatest
    // height the cells just inside are sectioned and the face the slice lies
    // on is drawn — the boundary convention the turn page discloses at its
    // block's ±w faces.
    x.dispatch({ type: 'cut-offset', value: least });
    const v = x.view();
    const box = v.bodies.find((b) => b.id === 'box')!;
    const ball = v.bodies.find((b) => b.id === 'ball')!;
    expect(box.status).toBe('tangent');
    expect(box.drawn).toBe(0);
    expect(box.caption).toBe('Box — touching your slice, only along its boundary');
    expect(box.reason).toContain('only along its boundary');
    expect(box.reason).toContain('the renderer draws solids only');
    expect(box.reason).not.toContain('not in your slice');
    expect(v.event).toBe('Box is touching your slice — only along its boundary, so nothing solid is drawn.');
    expect(ball.drawn).toBe(0);
    expect(v.empty).not.toBeNull();
    expect(v.empty!.reasons.find((r) => r.id === 'box')!.line).toBe(box.reason);
    x.dispose();
  });
});

describe('outside the camera: in the slice, out of view', () => {
  /** A camera 40 units out along +z, looking further out: the origin is behind it. */
  function lookingAway(): PerspectiveCamera {
    const camera = new PerspectiveCamera(50, 1.6, 0.1, 200);
    camera.position.set(0, 0, 40);
    camera.lookAt(0, 0, 80);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    return camera;
  }

  it('looking away from the origin, the drawn block is out of frame; the view is empty, and the recovery turns the camera to the block’s drawn bound', () => {
    const x = createExperience('cuts');
    const v = x.view(lookingAway());
    const block = v.bodies.find((b) => b.id === 'block')!;
    const ball = v.bodies.find((b) => b.id === 'companion')!;
    expect(block.status).toBe('present');
    expect(block.drawn).toBeGreaterThan(0);
    expect(block.frame).toBe('out');
    // At the reference the cut is the 2.2 × 1.3 × 0.8 half-extent box at the
    // chart's origin: its bounding sphere is centred there with radius the half-diagonal.
    expect(block.drawnBound).not.toBeNull();
    for (const c of block.drawnBound!.centre) expect(Math.abs(c)).toBeLessThan(1e-6);
    expect(block.drawnBound!.radius).toBeCloseTo(Math.hypot(2.2, 1.3, 0.8), 6);
    // Nothing drawn for the ball, so no frame to judge.
    expect([ball.status, ball.drawn, ball.frame]).toEqual(['outside', 0, null]);
    for (const b of v.bodies) if (b.drawn > 0) expect(b.frame, b.id).toBe('out');

    expect(v.empty).not.toBeNull();
    expect(v.empty!.reasons.find((r) => r.id === 'block')!.line).toBe('Block is in your slice, but outside the camera’s view.');
    expect(v.empty!.recoveries).toEqual([
      { label: 'Turn the camera to the block', action: null, frame: block.drawnBound },
      { label: 'Slide your slice to the ball', action: { type: 'cut-to', body: 'companion' }, frame: null }
    ]);
    x.dispose();
  });

  it('the same state from the home camera, at desktop and phone shapes, is not empty', () => {
    const x = createExperience('cuts');
    for (const aspect of [1.6, 0.5]) {
      const v = x.view(homeCamera(aspect));
      expect(v.bodies.find((b) => b.id === 'block')!.frame, `aspect ${aspect}`).toBe('in');
      expect(v.empty, `aspect ${aspect}`).toBeNull();
    }
    x.dispose();
  });
});

describe('slicing alone cannot take the block out of the turning world’s slice', () => {
  // Along n = (−sin θ, 0, 0, cos θ) the block's half-height across the slice
  // is h(θ) = 2.2|sin θ| + 1.6|cos θ|. On [0°, 90°] this is A·sin(θ + φ) with
  // θ + φ inside [0°, 180°], so it is concave there, and by symmetry on
  // [−90°, 0°]; its least value is at an end: min(h(0), h(±90°)) = min(1.6, 2.2)
  // = 1.6, reached only at θ = 0. Every offset the slider allows, |offset| ≤ 1.6,
  // therefore meets the block; only at θ = 0, offset = ±1.6 does the slice lie
  // on a face (a w face) rather than pass through the interior.
  const h = (deg: number): number => 2.2 * Math.abs(Math.sin(rad(deg))) + 1.6 * Math.abs(Math.cos(rad(deg)));

  it('on the 7.5° grid of turns and every 0.2 of offset within ±1.6 (425 poses), the block is never outside, and touches only at 0° and the slider’s end', () => {
    const x = createExperience('cuts');
    const notPresent: [number, number, string][] = [];
    let poses = 0;
    for (let i = 0; i <= 24; i++) {
      const t = -90 + 7.5 * i;
      x.dispatch({ type: 'cut-turn', degrees: t });
      for (let k = -8; k <= 8; k++) {
        const o = k / 5;
        x.dispatch({ type: 'cut-offset', value: o });
        const block = x.view().bodies.find((b) => b.id === 'block')!;
        poses++;
        // The gauge's heights are the half-height either side of the centre.
        expect(block.high, `${t}° at ${o}`).toBeCloseTo(h(t), 12);
        expect(block.low, `${t}° at ${o}`).toBeCloseTo(-h(t), 12);
        expect(block.status, `${t}° at ${o}`).not.toBe('outside');
        if (block.status !== 'present') notPresent.push([t, o, block.status]);
      }
    }
    expect(poses).toBe(425);
    for (const [t, o, status] of notPresent) {
      expect(t, `${t}° at ${o}`).toBe(0);
      expect(Math.abs(o), `${t}° at ${o}`).toBe(REACH);
      expect(status, `${t}° at ${o}`).toBe('tangent');
    }
    expect(notPresent.some(([t, o]) => t === 0 && o === -REACH), 'the −w face is touched').toBe(true);
    x.dispose();
  });

  it('the one empty view slicing reaches there is that touch, and it is said as a touch, not an absence', () => {
    const x = createExperience('cuts');
    x.dispatch({ type: 'cut-offset', value: -REACH });
    const v = x.view();
    const block = v.bodies.find((b) => b.id === 'block')!;
    expect(block.status).toBe('tangent');
    expect(v.empty).not.toBeNull();
    const line = v.empty!.reasons.find((r) => r.id === 'block')!.line;
    expect(line).toContain('touches your slice only along its boundary');
    expect(line).not.toContain('not in your slice');
    x.dispose();
  });
});

describe('the study scene is never an empty view', () => {
  it('in chapter V there are no collision bodies to report, even with the collision’s slice left where its view was empty', () => {
    const x = createExperience('collision');
    x.dispatch({ type: 'cut-offset', value: 1.6 });
    expect(x.view().empty).not.toBeNull();
    x.dispatch({ type: 'chapter', id: 'turning' });
    const away = new PerspectiveCamera(50, 1.6, 0.1, 200);
    away.position.set(0, 0, 40);
    away.lookAt(0, 0, 80);
    for (const mode of ['fourth', 'ordinary'] as const) {
      x.dispatch({ type: 'study-mode', mode });
      for (const d of [0, 45, 90, 180, 300]) {
        x.dispatch({ type: 'study-angle', degrees: d });
        for (const camera of [null, away]) {
          const v = x.view(camera);
          const where = `${mode} ${d}° ${camera ? 'looking away' : 'no camera'}`;
          expect(v.studyOpen, where).toBe(true);
          expect(v.bodies, where).toEqual([]);
          expect(v.empty, where).toBeNull();
        }
      }
    }
    x.dispose();
  });
});

describe('renderer omission does not occur in the shipped scenes', () => {
  it('across a coarse grid of both worlds, a body is drawn exactly when the library places it in the slice', () => {
    const turns = Array.from({ length: 13 }, (_, k) => -90 + 15 * k);
    const offsets = Array.from({ length: 9 }, (_, k) => (k - 4) * 0.4);
    const seen = { present: 0, other: 0 };
    const wrong: string[] = [];
    const judge = (where: string, x: Experience): void => {
      for (const b of x.view().bodies) {
        if ((b.status === 'present') !== (b.drawn > 0)) wrong.push(`${where}: ${b.id} is ${b.status} with ${b.drawn} drawn`);
        if (b.caption.includes('the renderer drew nothing')) wrong.push(`${where}: ${b.id} captioned as an omission`);
        if (b.status === 'present') seen.present++; else seen.other++;
      }
    };

    const turn = createExperience('cuts');
    for (const t of turns) {
      turn.dispatch({ type: 'cut-turn', degrees: t });
      for (const o of offsets) {
        turn.dispatch({ type: 'cut-offset', value: o });
        for (let p = 0; p < 360; p += 30) {
          turn.dispatch({ type: 'orbit-phase', degrees: p });
          judge(`turn world ${t}° at ${o}, orbit ${p}°`, turn);
        }
      }
    }
    turn.dispose();

    const contact = createExperience('collision');
    for (const preset of ['central', 'off-centre'] as const) {
      contact.dispatch({ type: 'preset', id: preset });
      const stops: [string, () => void][] = [
        ['launch', () => undefined],
        ['before the blow', () => contact.dispatch({ type: 'jump-touch' })],
        ['the blow', () => contact.dispatch({ type: 'jump-after' })],
        ['60 steps on', () => { for (let s = 0; s < 60; s++) contact.dispatch({ type: 'step' }); }]
      ];
      for (const [name, go] of stops) {
        go();
        for (const t of turns) {
          contact.dispatch({ type: 'cut-turn', degrees: t });
          for (const o of offsets) {
            contact.dispatch({ type: 'cut-offset', value: o });
            judge(`contact world ${preset} ${name}, ${t}° at ${o}`, contact);
          }
        }
      }
    }
    contact.dispose();

    expect(seen.present).toBeGreaterThan(1000);
    expect(seen.other).toBeGreaterThan(1000);
    expect(wrong).toEqual([]);
  }, 20_000);
});

describe('a marker on screen is named, and never read as a cut', () => {
  /**
   * The section modules draw two small things that are not cuts: the point where
   * a ball touches the slice, and, for the turning world's ball on a near miss
   * (within the 0.02 graze band), the point where the slice would first touch it.
   * The page must name a marker exactly when one is drawn. The oracle is the
   * drawn scene graph itself: the ball product's second child is that marker mesh.
   */
  it('turning world: over a full orbit at three offsets, the caption names a marker exactly when the marker mesh is visible', () => {
    const x = createExperience('cuts');
    const ball = x.worlds.turn.products.find((p) => p.complex === null)!;
    const marker = ball.object.children[1]!;
    let named = 0;
    let drawnMarkers = 0;
    for (const offset of [0, 0.19, 0.205]) {
      x.dispatch({ type: 'cut-offset', value: offset });
      for (let k = 0; k < 720; k++) {
        x.dispatch({ type: 'orbit-phase', degrees: k / 2 });
        const reading = x.view().bodies.find((b) => b.id === 'companion')!;
        const says = /small marker/.test(reading.caption);
        expect(says, `offset ${offset}, phase ${k / 2}°: caption “${reading.caption}”`).toBe(marker.visible);
        // The picture's tag stands on the marker itself: the reading's markerAt is the marker mesh's position.
        const raw = x.worlds.turn.bodies().find((b) => b.id === 'companion')!;
        expect(raw.markerAt !== null, `offset ${offset}, phase ${k / 2}°: a tag exactly when a marker is drawn`).toBe(marker.visible);
        if (raw.markerAt !== null) {
          for (let c = 0; c < 3; c++) expect(raw.markerAt[c]).toBeCloseTo(marker.position.getComponent(c), 12);
        }
        if (marker.visible) {
          drawnMarkers++;
          expect(reading.drawn, 'a marker is never counted as a drawn cut').toBe(0);
          expect(reading.caption).not.toMatch(/in your slice(?!:)/);
        }
        if (says) named++;
      }
    }
    // Not a vacuous sweep: the grid reaches near misses.
    expect(drawnMarkers).toBeGreaterThan(0);
    expect(named).toBe(drawnMarkers);
    x.dispose();
  });

  it('the empty headline stays true with a marker on screen: the slice cuts nothing in view', () => {
    // Chapter III at the top of the slider's reach: both bodies outside, nothing cut.
    const x = createExperience('collision');
    x.dispatch({ type: 'cut-offset', value: 1.6 });
    const v = x.view();
    expect(v.empty!.headline).toBe('Your slice cuts nothing in view — and nothing has gone.');
    expect(v.bodies.every((b) => b.drawn === 0)).toBe(true);
    x.dispose();
  });
});
