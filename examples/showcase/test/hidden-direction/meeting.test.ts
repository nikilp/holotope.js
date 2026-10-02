import { VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import { createExperience } from '../../src/hidden-direction/experience.js';
import { BUTTONS, keyAction, sliderKey } from '../../src/hidden-direction/bindings.js';
import { absentReason, caption } from '../../src/hidden-direction/copy.js';
import { boxMeeting, type Meeting } from '../../src/hidden-direction/worlds.js';
import { BOX } from '../../src/spatial-4d-contact/simulation.js';

/**
 * What the slice shares with a body is three facts, said apart: whether the
 * slice meets it (the library's status), what the meeting is and its
 * dimension (from the posed corners, within 10⁻⁹), and what the renderer drew.
 *
 * The review's C1: at the turning world's kata limit the slice lies on the
 * block's −w face. The library calls that `tangent` and nothing is drawn, but
 * the meeting is a solid 4.4 × 2.6 × 1.6 cuboid; the page called it "a face, an
 * edge or a point, not a solid". At the ana limit the +w face is drawn. The
 * difference is the sectioner's convention — it cuts only cells with a corner
 * strictly kata of the slice, and counts a corner on the slice as ana — so the
 * dimension is read from the corners, never from the triangle count. A turned
 * slice on the contact box meets a genuinely lower-dimensional face, a flat
 * rectangle, which is drawn (4 flat triangles) from the kata side and not from
 * the ana side.
 *
 * Oracles: the scene's authored half extents as literals (block 2.2, 1.3, 0.8,
 * 1.6; box 1.2, 0.9, 0.7, 1.0), the library's own corner classification for
 * the block (`BlockBoundary`), and closed-form support heights.
 */

type Experience = ReturnType<typeof createExperience>;

const rad = (deg: number): number => (deg * Math.PI) / 180;
const body = (x: Experience, id: string) => x.view().bodies.find((b) => b.id === id)!;
/** Every sentence the page shows for a body, and the event line. */
const sentences = (x: Experience, id: string): string[] => {
  const v = x.view();
  const b = v.bodies.find((q) => q.id === id)!;
  return [b.caption, b.reason, v.event ?? '', ...(v.empty?.reasons.map((r) => r.line) ?? [])];
};
/** The old claims C1 found false. A sentence carrying any of them fails. */
const OLD_CLAIM = /not a solid|draws solids only|nothing solid is drawn|face, an edge or a point|only along its boundary/;

describe('the reference limits: the block’s ±w faces, met whole, drawn from one side only', () => {
  it('the kata limit, reached by eight Shift+↓ presses: tangent, nothing drawn, and the meeting is the solid −w face, 4.4 × 2.6 × 1.6', () => {
    const x = createExperience('cuts');
    const down = keyAction('ArrowDown', true, { playing: false, shadowOn: false, studyPlaying: false, facesCut: [], face: null })!;
    for (let k = 0; k < 8; k++) x.dispatch(down as Exclude<typeof down, string>);
    // Eight steps of 0.2 land 1.1·10⁻¹⁶ short of the limit — far inside the sectioner's 10⁻⁹, so the slice lies on the face.
    expect(x.view().cut.offset).toBeCloseTo(-1.6, 15);
    const block = body(x, 'block');
    // 1. Whether the slice meets it: the library's word.
    expect(block.status).toBe('tangent');
    // 3. What the renderer drew: nothing.
    expect(block.drawn).toBe(0);
    // 2. What the meeting is: the whole −w face, its sides the block's x, y and z extents.
    expect(block.meeting).toEqual({ kind: 'boundary', body: 'box', dim: 3, sides: [4.4, 2.6, 1.6], face: '−w', rest: 'ana' });
    // The library's own corner classification agrees: eight corners on the slice, eight ana, the −w face whole.
    const lib = x.block.boundary!;
    expect([lib.on, lib.below, lib.above, lib.face?.name]).toEqual([8, 0, 8, '−w']);
    expect(block.caption).toBe('Block — meets your slice only on its boundary: its −w face, a solid 4.40 × 2.60 × 1.60 cuboid; nothing drawn');
    expect(block.reason).toBe('Block meets your slice only on its boundary, within 10⁻⁹: its −w face, a solid 4.40 × 2.60 × 1.60 cuboid. '
      + 'Nothing is drawn for it. The library’s sectioner cuts only the cells of the block that have a corner strictly kata of your '
      + 'slice, and it counts a corner on your slice as ana; here every corner is on your slice or ana of it, so there is nothing '
      + 'to cut. That is the sectioner’s convention for a slice lying on a boundary, not the shape of the meeting — with the block '
      + 'kata of your slice instead, a meeting like this one is drawn. A little ana-ward, inside the block, the cut is drawn.');
    expect(x.view().event).toBe('Block now meets your slice only on its boundary — you moved your slice. '
      + 'The meeting is its −w face, a solid cuboid; nothing is drawn for it.');
    for (const s of sentences(x, 'block')) expect(s).not.toMatch(OLD_CLAIM);
    x.dispose();
  });

  it('the ana limit: present, twelve triangles drawn, and the meeting is the solid +w face of the same size', () => {
    const x = createExperience('cuts');
    x.dispatch({ type: 'cut-offset', value: 1.6 });
    const block = body(x, 'block');
    expect(block.status).toBe('present');
    expect(block.drawn).toBe(12);
    expect(block.meeting).toEqual({ kind: 'boundary', body: 'box', dim: 3, sides: [4.4, 2.6, 1.6], face: '+w', rest: 'kata' });
    const lib = x.block.boundary!;
    expect([lib.on, lib.below, lib.above, lib.face?.name]).toEqual([8, 8, 0, '+w']);
    expect(block.caption).toBe('Block — in your slice only on its boundary: its +w face, a solid 4.40 × 2.60 × 1.60 cuboid');
    for (const s of sentences(x, 'block')) expect(s).not.toMatch(OLD_CLAIM);
    x.dispose();
  });

  it('the two limits meet faces of one size and differ only in what is drawn: the dimension is not read from the triangles', () => {
    const x = createExperience('cuts');
    const at = (offset: number) => { x.dispatch({ type: 'cut-offset', value: offset }); return body(x, 'block'); };
    const kata = at(-1.6);
    const ana = at(1.6);
    expect([kata.drawn, ana.drawn]).toEqual([0, 12]);
    const dims = [kata, ana].map((b) => (b.meeting.kind === 'boundary' ? [b.meeting.dim, ...b.meeting.sides] : null));
    expect(dims).toEqual([[3, 4.4, 2.6, 1.6], [3, 4.4, 2.6, 1.6]]);
    // Just inside either limit the slice passes through the block's interior: a solid, said as plainly in your slice.
    for (const o of [-1.59, 1.59, 0]) {
      const b = at(o);
      expect(b.meeting, `${o}`).toEqual({ kind: 'through' });
      expect(b.caption, `${o}`).toBe('Block — in your slice');
    }
    x.dispose();
  });
});

describe('turned and posed slices meet lower-dimensional faces of the contact box', () => {
  /** The box's least and greatest heights across an untouched slice turned by θ: −(h_x |sin θ| + h_w cos θ) and its negative. */
  const support = (deg: number): number => BOX.halfExtents[0] * Math.abs(Math.sin(rad(deg))) + BOX.halfExtents[3] * Math.cos(rad(deg));

  it('turned 30°, at either support height, the meeting is the flat 1.8 × 1.4 rectangle — drawn as four flat triangles from the kata side only', () => {
    const x = createExperience('collision');
    x.dispatch({ type: 'cut-turn', degrees: 30 });
    const h = support(30);
    expect(h).toBeCloseTo(1.2 * 0.5 + 1.0 * Math.sqrt(3) / 2, 12);
    x.dispatch({ type: 'cut-offset', value: -h });
    let box = body(x, 'box');
    expect([box.status, box.drawn]).toEqual(['tangent', 0]);
    expect(box.meeting).toEqual({ kind: 'boundary', body: 'box', dim: 2, sides: [1.8, 1.4], face: null, rest: 'ana' });
    x.dispatch({ type: 'cut-offset', value: h });
    box = body(x, 'box');
    expect([box.status, box.drawn]).toEqual(['present', 4]);
    expect(box.meeting).toEqual({ kind: 'boundary', body: 'box', dim: 2, sides: [1.8, 1.4], face: null, rest: 'kata' });
    expect(box.caption).toBe('Box — in your slice only on its boundary: a flat 1.80 × 1.40 rectangle, with no thickness');
    for (const s of sentences(x, 'box')) expect(s).not.toMatch(OLD_CLAIM);
    x.dispose();
  });

  it('untilted at ±1.0, the meeting is the box’s ∓w 3-face, a solid 2.4 × 1.8 × 1.4 cuboid: not drawn, then drawn', () => {
    const x = createExperience('collision');
    x.dispatch({ type: 'cut-offset', value: -1 });
    let box = body(x, 'box');
    expect([box.status, box.drawn]).toEqual(['tangent', 0]);
    expect(box.meeting).toEqual({ kind: 'boundary', body: 'box', dim: 3, sides: [2.4, 1.8, 1.4], face: '−w', rest: 'ana' });
    x.dispatch({ type: 'cut-offset', value: 1 });
    box = body(x, 'box');
    expect([box.status, box.drawn]).toEqual(['present', 12]);
    expect(box.meeting).toEqual({ kind: 'boundary', body: 'box', dim: 3, sides: [2.4, 1.8, 1.4], face: '+w', rest: 'kata' });
    x.dispose();
  });

  it('after the off-centre blow the box is turned in x–w; the slice on its least height meets its posed 1.8 × 1.4 face', () => {
    const x = createExperience('spin');
    x.dispatch({ type: 'jump-after' });
    // Ten steps on: turned measurably, and not yet carried beyond the slider's reach.
    for (let k = 0; k < 10; k++) x.dispatch({ type: 'step' });
    // The pose: its x and w axes have turned, so no untilted slice can lie on a 3-face of it.
    const pose = x.worlds.contact.sim.boxPose();
    const ex = Array.from(pose.applyToPoint(new VecN([1, 0, 0, 0])).data);
    const o = Array.from(pose.applyToPoint(new VecN([0, 0, 0, 0])).data);
    expect(Math.abs(ex[3]! - o[3]!), 'the box has turned toward w').toBeGreaterThan(1e-3);
    const least = body(x, 'box').low;
    expect(Math.abs(least)).toBeLessThan(1.6);
    x.dispatch({ type: 'cut-offset', value: least });
    const box = body(x, 'box');
    expect(box.status).not.toBe('outside');
    // The lowest part of a box turned in x–w, against a normal in x–w, is the edge-face spanned by y and z.
    expect(box.meeting).toMatchObject({ kind: 'boundary', body: 'box', dim: 2, face: null, rest: 'ana' });
    const m = box.meeting as Extract<Meeting, { kind: 'boundary' }>;
    expect(m.sides[0]).toBeCloseTo(1.8, 12);
    expect(m.sides[1]).toBeCloseTo(1.4, 12);
    for (const s of sentences(x, 'box')) expect(s).not.toMatch(OLD_CLAIM);
    x.dispose();
  });
});

describe('a touching ball is a single point, kept apart from a box’s face', () => {
  it('turning world: the slice at the ball’s near side touches it at a point; the caption says so, with its marker', () => {
    const x = createExperience('arrival');
    // At phase 0 the ball's centre is at w = 0.92, radius 0.72.
    x.dispatch({ type: 'cut-offset', value: 0.92 - 0.72 });
    const ball = body(x, 'companion');
    expect(ball.status).toBe('tangent');
    expect(ball.meeting).toEqual({ kind: 'boundary', body: 'ball', dim: 0, sides: [], face: null, rest: 'ana' });
    expect(ball.caption).toBe('Ball — touching your slice at a single point; nothing drawn. The small marker is the point where it touches.');
    expect(ball.reason).toContain('Ball touches your slice at a single point, within 10⁻⁹.');
    expect(ball.reason).not.toContain('sectioner');
    x.dispose();
  });

  it('contact world: just before the blow, the slice on the box’s +w face touches the ball at a point, and meets the box’s face whole', () => {
    const x = createExperience('collision');
    // *Just before the blow*, as the page's button sends it.
    x.dispatch(BUTTONS.find((b) => b.id === 'hd-jump')!.act({ playing: false, shadowOn: false, studyPlaying: false, facesCut: [], face: null })!);
    expect(x.worlds.contact.sim.steps).toBe(72);
    x.dispatch({ type: 'cut-offset', value: BOX.halfExtents[3] });
    const v = x.view();
    const ball = v.bodies.find((b) => b.id === 'ball')!;
    const box = v.bodies.find((b) => b.id === 'box')!;
    expect(ball.meeting).toEqual({ kind: 'boundary', body: 'ball', dim: 0, sides: [], face: null, rest: 'ana' });
    expect(box.meeting).toEqual({ kind: 'boundary', body: 'box', dim: 3, sides: [2.4, 1.8, 1.4], face: '+w', rest: 'kata' });
    expect(ball.caption).toContain('touching your slice at a single point');
    expect(box.caption).toContain('its +w face, a solid 2.40 × 1.80 × 1.40 cuboid');
    x.dispose();
  });
});

describe('the meeting, read from corners: every dimension, and when it is not established', () => {
  /** A unit tesseract's corners, and their signed distances from a slice given as a function of the corner. */
  const corners: number[][] = [];
  for (let m = 0; m < 16; m++) corners.push([0, 1, 2, 3].map((i) => ((m >> i) & 1 ? 0.5 : -0.5)));
  const faces = [0, 1, 2, 3].flatMap((axis) => [-1, 1].map((sign) => ({
    ordinal: axis * 2 + (sign > 0 ? 1 : 0), axis: axis as 0 | 1 | 2 | 3, sign: sign as -1 | 1,
    name: `${sign < 0 ? '−' : '+'}${'xyzw'[axis]}`, colour: '#000', rgb: [0, 0, 0] as const
  })));
  const meet = (h: (c: number[]) => number, offset: number) => boxMeeting(corners.map((c) => h(c) - offset), corners, faces);

  it('a 3-face, a 2-face, an edge and a corner, each from the side the rest of the box lies on', () => {
    // n = +w: the slice w = −0.5 lies on the −w face.
    expect(meet((c) => c[3]!, -0.5)).toEqual({ kind: 'boundary', body: 'box', dim: 3, sides: [1, 1, 1], face: '−w', rest: 'ana' });
    expect(meet((c) => c[3]!, 0.5)).toEqual({ kind: 'boundary', body: 'box', dim: 3, sides: [1, 1, 1], face: '+w', rest: 'kata' });
    // n ∝ x + w: the least height −1 is reached on the 2-face x = w = −0.5.
    expect(meet((c) => c[0]! + c[3]!, -1)).toEqual({ kind: 'boundary', body: 'box', dim: 2, sides: [1, 1], face: null, rest: 'ana' });
    // n ∝ x + z + w: on the edge x = z = w = −0.5.
    expect(meet((c) => c[0]! + c[2]! + c[3]!, -1.5)).toEqual({ kind: 'boundary', body: 'box', dim: 1, sides: [1], face: null, rest: 'ana' });
    // n ∝ x + y + z + w: at one corner.
    expect(meet((c) => c[0]! + c[1]! + c[2]! + c[3]!, 2)).toEqual({ kind: 'boundary', body: 'box', dim: 0, sides: [], face: null, rest: 'kata' });
  });

  it('through the interior is a solid; clear of every corner is no meeting', () => {
    expect(meet((c) => c[3]!, 0)).toEqual({ kind: 'through' });
    expect(meet((c) => c[0]! + c[3]!, 0.3)).toEqual({ kind: 'through' });
    expect(meet((c) => c[3]!, 0.8)).toEqual({ kind: 'none' });
  });

  it('corners within 10⁻⁹ that are not all of one face leave the dimension unsettled, and the copy says so', () => {
    // Three of the four corners of the 2-face x = w = −0.5 within the band, the fourth 2·10⁻⁹ out.
    const signed = corners.map((c) => {
      const h = c[0]! + c[3]! + 1;
      return h === 0 && c[1]! > 0 && c[2]! > 0 ? 2e-9 : h;
    });
    const m = boxMeeting(signed, corners, faces);
    expect(m).toEqual({ kind: 'unsettled' });
    expect(absentReason('Box', 'tangent', 0, null, true, 0, m)).toContain('its dimension — is not established at that tolerance');
    expect(caption('Box', 'tangent', 0, 0, m)).toBe('Box — meets your slice only on its boundary: part of its boundary, of a dimension not established within 10⁻⁹; nothing drawn');
  });
});

describe('the gauge’s own keys reach the reference limit too', () => {
  it('eight Shift+↓ on the focused gauge land exactly on −1.6, and the block is said as its solid −w face', () => {
    const x = createExperience('cuts');
    for (let k = 0; k < 8; k++) x.dispatch(sliderKey('gauge', 'ArrowDown', true)!);
    expect(x.view().cut.offset).toBeCloseTo(-1.6, 15);
    expect(body(x, 'block').status).toBe('tangent');
    expect(body(x, 'block').caption).toContain('its −w face, a solid 4.40 × 2.60 × 1.60 cuboid');
    x.dispose();
  });
});
