import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rotor4, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import { BOX } from '../../src/spatial-4d-contact/simulation.js';
import { FULL_TURN, RotationStudy, STUDY_PLANES, STUDY_RATES, studyLandmarks, transitionAngle } from '../../src/spatial-4d-contact/study.js';

/**
 * The rotation study against an INDEPENDENT analytic oracle. Nothing below
 * reads a formula out of the library or out of `study.ts`; the predictions are
 * written from the authored half-extents and the meaning of a rotation.
 *
 * - Ordinary turn (x–y): the drawn section is the 3D box h_x × h_y × h_z
 *   rigidly rotated by α inside the section — tested through its support
 *   function in many directions together with containment.
 * - Turn through the fourth direction (x–w): the drawn section is a cuboid
 *   whose x half-extent is min(h_x/|cos α|, h_w/|sin α|), with the y and z
 *   extents untouched, bounded by the x faces below the transition
 *   tan α = h_w/h_x and by the w faces above it.
 *
 * The drawn buffers are Float32 (about 1e−7 relative); 1e−5 absolute is the
 * tolerance for anything read from them, far below any wrong shape.
 */

const [hx, hy, hz, hw] = BOX.halfExtents;
const deg = (d: number): number => (d * Math.PI) / 180;
const t = transitionAngle();
const tDeg = (t * 180) / Math.PI;

/** Chart coordinates (x, y, z) of the drawn vertices; asserts they lie in w = 0. */
function drawn(study: RotationStudy): number[][] {
  const points = study.views.sectionVertices();
  expect(points.length, 'something is drawn').toBeGreaterThan(0);
  for (const p of points) expect(Math.abs(p[3]!), 'drawn vertex lies in the fixed section').toBeLessThanOrEqual(1e-9);
  return points.map((p) => [p[0]!, p[1]!, p[2]!]);
}

const dot3 = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const support = (points: readonly number[][], u: readonly number[]): number => Math.max(...points.map((p) => dot3(p, u)));
const maxAbs = (points: readonly number[][], axis: number): number => Math.max(...points.map((p) => Math.abs(p[axis]!)));

/** The x half-extent of the x–w section, with the zero coefficients handled explicitly, never by dividing by zero. */
function predictedX(alpha: number): number {
  const c = Math.abs(Math.cos(alpha));
  const s = Math.abs(Math.sin(alpha));
  const byXFaces = c === 0 ? Number.POSITIVE_INFINITY : hx / c;
  const byWFaces = s === 0 ? Number.POSITIVE_INFINITY : hw / s;
  return Math.min(byXFaces, byWFaces);
}

/** Directions to probe the support function: axes, face diagonals, space diagonals and a few fixed oblique ones. */
const DIRECTIONS: readonly number[][] = [
  [1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1],
  [1, 1, 0], [1, -1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1], [-1, 1, 1], [1, -1, 1], [1, 1, -1],
  [0.3, 0.9, 0.2], [-0.7, 0.2, 0.6], [0.5, -0.5, 0.7], [0.9, 0.1, -0.4]
].map((u) => { const n = Math.hypot(...u); return u.map((c) => c / n); });

const faceNames = (study: RotationStudy): string[] =>
  [...study.views.box.presentFaces].map((o) => study.views.box.faces[o]!.name).sort();

describe('the ordinary turn (x–y) is the rigidly rotated 3D box', () => {
  it('support function in eighteen directions and containment, every half degree through a full revolution', () => {
    const study = new RotationStudy();
    study.setMode('ordinary');
    for (let d = 0; d <= 360; d += 0.5) {
      const alpha = deg(d);
      study.setAngle(alpha);
      const points = drawn(study);
      // The library's rotor convention, documented: e_x → cos e_x + sin e_y.
      const a = [Math.cos(alpha), Math.sin(alpha), 0];
      const b = [-Math.sin(alpha), Math.cos(alpha), 0];
      for (const u of DIRECTIONS) {
        const predicted = hx * Math.abs(dot3(u, a)) + hy * Math.abs(dot3(u, b)) + hz * Math.abs(u[2]!);
        expect(support(points, u), `${d}° support along (${u.map((c) => c.toFixed(2)).join(', ')})`).toBeCloseTo(predicted, 5);
      }
      for (const p of points) {
        expect(Math.abs(dot3(p, a))).toBeLessThanOrEqual(hx + 1e-5);
        expect(Math.abs(dot3(p, b))).toBeLessThanOrEqual(hy + 1e-5);
        expect(Math.abs(p[2]!)).toBeLessThanOrEqual(hz + 1e-5);
      }
      expect(faceNames(study), `${d}° bounding faces`).toEqual(['+x', '+y', '+z', '−x', '−y', '−z']);
    }
    study.dispose();
  });

  it('at the zero coefficients the section is the authored box, axis-aligned or turned a right angle', () => {
    const study = new RotationStudy();
    study.setMode('ordinary');
    for (const [d, ex, ey] of [[0, hx, hy], [90, hy, hx], [180, hx, hy], [270, hy, hx], [360, hx, hy]] as const) {
      study.setAngle(deg(d));
      const points = drawn(study);
      expect(maxAbs(points, 0), `${d}° x`).toBeCloseTo(ex, 5);
      expect(maxAbs(points, 1), `${d}° y`).toBeCloseTo(ey, 5);
      expect(maxAbs(points, 2), `${d}° z`).toBeCloseTo(hz, 5);
    }
    study.dispose();
  });
});

describe('the turn through the fourth direction (x–w) cuts different parts of a rigid object', () => {
  it('x half-extent min(h_x/|cos α|, h_w/|sin α|), y and z untouched, every half degree through a full revolution', () => {
    const study = new RotationStudy();
    study.setMode('fourth');
    for (let d = 0; d <= 360; d += 0.5) {
      const alpha = deg(d);
      study.setAngle(alpha);
      const points = drawn(study);
      expect(maxAbs(points, 0), `${d}° x half-extent`).toBeCloseTo(predictedX(alpha), 5);
      expect(maxAbs(points, 1), `${d}° y half-extent`).toBeCloseTo(hy, 5);
      expect(maxAbs(points, 2), `${d}° z half-extent`).toBeCloseTo(hz, 5);
      // A cuboid: every drawn vertex is within the predicted extents.
      for (const p of points) {
        expect(Math.abs(p[0]!)).toBeLessThanOrEqual(predictedX(alpha) + 1e-5);
        expect(Math.abs(p[1]!)).toBeLessThanOrEqual(hy + 1e-5);
        expect(Math.abs(p[2]!)).toBeLessThanOrEqual(hz + 1e-5);
      }
    }
    study.dispose();
  });

  it('zero coefficients: h_x at 0°, 180°, 360° and h_w at 90°, 270°, with no division anywhere', () => {
    const study = new RotationStudy();
    study.setMode('fourth');
    for (const [d, ex] of [[0, hx], [90, hw], [180, hx], [270, hw], [360, hx]] as const) {
      study.setAngle(deg(d));
      expect(maxAbs(drawn(study), 0), `${d}°`).toBeCloseTo(ex, 5);
      expect(Number.isFinite(predictedX(deg(d)))).toBe(true);
    }
    study.dispose();
  });

  it('the transition is at tan α = h_w/h_x = 39.81°, and the bounding family changes there — both sides, all four quadrants', () => {
    expect(tDeg).toBeCloseTo(39.8056, 3);
    expect(Math.tan(t)).toBeCloseTo(hw / hx, 12);
    const study = new RotationStudy();
    study.setMode('fourth');
    const widest = Math.hypot(hx, hw);
    for (const centre of [t, Math.PI - t, Math.PI + t, 2 * Math.PI - t]) {
      const delta = deg(0.25);
      // Just below (in |tan|): the x faces bound, extent h_x/|cos|.
      const below = Math.abs(Math.tan(centre - delta)) < hw / hx ? centre - delta : centre + delta;
      const above = below === centre - delta ? centre + delta : centre - delta;
      study.setAngle(below);
      expect(maxAbs(drawn(study), 0)).toBeCloseTo(hx / Math.abs(Math.cos(below)), 5);
      expect(faceNames(study), `${((below * 180) / Math.PI).toFixed(2)}° bounded by the x faces`).toEqual(['+x', '+y', '+z', '−x', '−y', '−z']);
      study.setAngle(above);
      expect(maxAbs(drawn(study), 0)).toBeCloseTo(hw / Math.abs(Math.sin(above)), 5);
      expect(faceNames(study), `${((above * 180) / Math.PI).toFixed(2)}° bounded by the w faces`).toEqual(['+w', '+y', '+z', '−w', '−y', '−z']);
      // At the transition itself the section is widest: √(h_x² + h_w²).
      study.setAngle(centre);
      expect(maxAbs(drawn(study), 0), 'widest at the transition').toBeCloseTo(widest, 5);
    }
    study.dispose();
  });
});

describe('rigidity and one source pose', () => {
  const corners: VecN[] = [];
  for (let m = 0; m < 16; m++) {
    corners.push(new VecN([m & 1 ? hx : -hx, m & 2 ? hy : -hy, m & 4 ? hz : -hz, m & 8 ? hw : -hw]));
  }
  const dist = (a: ArrayLike<number>, b: ArrayLike<number>): number =>
    Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!, a[3]! - b[3]!);

  it('the pose preserves every pairwise corner distance and keeps the centre at the origin, in both modes, all angles', () => {
    const study = new RotationStudy();
    for (const mode of ['ordinary', 'fourth'] as const) {
      study.setMode(mode);
      for (let d = 0; d <= 360; d += 7.5) {
        study.setAngle(deg(d));
        const pose = study.pose();
        const posed = corners.map((c) => pose.applyToPoint(c).data);
        for (let i = 0; i < 16; i++) {
          for (let j = i + 1; j < 16; j++) {
            expect(dist(posed[i]!, posed[j]!), `${mode} ${d}° corners ${i},${j}`).toBeCloseTo(dist(corners[i]!.data, corners[j]!.data), 12);
          }
        }
        const centre = [0, 1, 2, 3].map((k) => posed.reduce((s, p) => s + p[k]!, 0) / 16);
        for (const c of centre) expect(Math.abs(c)).toBeLessThanOrEqual(1e-12);
        expect(Array.from(pose.applyToPoint(VecN.zero(4)).data), 'no translation: the origin stays put').toEqual([0, 0, 0, 0]);
      }
    }
    study.dispose();
  });

  it('the context edges and the section come from the same pose: projected corners match, and every drawn vertex lies on the posed box', () => {
    const study = new RotationStudy();
    for (const mode of ['ordinary', 'fourth'] as const) {
      study.setMode(mode);
      for (const d of [0, 17, tDeg, 60, 90, 133, 200, 289, 360]) {
        study.setAngle(deg(d));
        const pose = study.pose();
        const rotor = pose.rotation;
        if (!(rotor instanceof Rotor4)) throw new Error('the study pose is a Rotor4 pose');
        const inverse = rotor.conjugate();
        const projected = study.views.contextVertices();
        expect(projected.length).toBe(16);
        // The complex's own vertex order is the library's; match as sets.
        const expected = corners.map((c) => study.slice.projectPointToChart(pose.applyToPoint(c).data).coordinates.map((v) => Math.round(v * 1e4) / 1e4));
        const got = projected.map((p) => p.map((v) => Math.round(v * 1e4) / 1e4));
        const key = (p: number[]): string => p.join(',');
        expect(got.map(key).sort()).toEqual(expected.map((e) => key(Array.from(e))).sort());
        for (const q of study.views.sectionVertices()) {
          const body = inverse.applyToPoint(new VecN(q)).data;
          const slack = [hx, hy, hz, hw].map((h, k) => Math.abs(body[k]!) - h);
          for (const s of slack) expect(s, `${mode} ${d}° inside the box`).toBeLessThanOrEqual(1e-5);
          expect(Math.max(...slack), `${mode} ${d}° on the boundary`).toBeGreaterThanOrEqual(-1e-5);
        }
      }
    }
    study.dispose();
  });
});

describe('mode changes, reset, playback and the fixed frame', () => {
  const frameOf = (study: RotationStudy) => ({
    normal: Array.from(study.slice.normal.data),
    basis: study.slice.basis.map((b) => Array.from(b)),
    offset: study.slice.offset
  });

  it('switching the mode keeps the object angle, leaves the slice bitwise unchanged, and says what changed', () => {
    const study = new RotationStudy();
    const frame = frameOf(study);
    study.setAngle(deg(50));
    const before = maxAbs(drawn(study), 0);
    const sentence = study.setMode('fourth');
    expect(study.angleDegrees()).toBeCloseTo(50, 12);
    expect(study.mode).toBe('fourth');
    expect(frameOf(study)).toEqual(frame);
    expect(sentence).toContain('Same object angle, 50.0°');
    expect(sentence).toContain('x–w plane instead of x–y');
    expect(sentence).toContain('The section frame and the camera did not move.');
    expect(maxAbs(drawn(study), 0), 'the section is now a different cut of the same object').not.toBeCloseTo(before, 3);
    expect(study.setMode('fourth')).toContain('Still turning in the x–w plane at 50.0°');
    study.dispose();
  });

  it('a full revolution never moves the frame and never jumps: the extent changes smoothly and returns to the start', () => {
    const study = new RotationStudy();
    const frame = frameOf(study);
    for (const mode of ['ordinary', 'fourth'] as const) {
      study.setMode(mode);
      study.setAngle(0);
      const start = drawn(study).map((p) => p.map((v) => Math.round(v * 1e4) / 1e4).join(',')).sort();
      const startFaces = faceNames(study);
      let previous = maxAbs(drawn(study), 0);
      for (let d = 0.5; d <= 360; d += 0.5) {
        study.setAngle(deg(d));
        const extent = maxAbs(drawn(study), 0);
        // Half a degree changes the x–w extent by at most ~0.011 near the transition; 0.05 is a jump.
        expect(Math.abs(extent - previous), `${mode} ${d}° continuity`).toBeLessThan(0.05);
        previous = extent;
        expect(frameOf(study), `${mode} ${d}° frame`).toEqual(frame);
      }
      expect(drawn(study).map((p) => p.map((v) => Math.round(v * 1e4) / 1e4).join(',')).sort(), `${mode} back to the start`).toEqual(start);
      expect(faceNames(study)).toEqual(startFaces);
    }
    study.dispose();
  });

  it('the angle is clamped to one revolution, playback advances only while playing and wraps, reset returns to 0° paused with the mode kept', () => {
    const study = new RotationStudy();
    study.setMode('fourth');
    study.setAngle(-1);
    expect(study.angle).toBe(0);
    study.setAngle(10);
    expect(study.angle).toBe(FULL_TURN);
    study.setAngle(deg(359.5));
    study.advance(1);
    expect(study.angle, 'paused: no advance').toBeCloseTo(deg(359.5), 12);
    study.setRate('normal');
    study.setPlaying(true);
    study.advance(1);
    expect(study.angle, 'one second at the normal rate, wrapped').toBeCloseTo(deg(359.5) + STUDY_RATES.normal - FULL_TURN, 12);
    expect(STUDY_RATES.normal).toBeCloseTo(FULL_TURN / 12, 15);
    expect(STUDY_RATES.slow).toBeCloseTo(FULL_TURN / 48, 15);
    study.reset();
    expect(study.angle).toBe(0);
    expect(study.playing).toBe(false);
    expect(study.mode).toBe('fourth');
    study.dispose();
  });

  it('landmarks come from the authored half-extents and describe the transition', () => {
    const marks = studyLandmarks();
    expect(marks.map((m) => m.id)).toEqual(['reference', 'transition', 'quarter', 'half', 'full']);
    const transition = marks.find((m) => m.id === 'transition')!;
    expect(transition.angle).toBeCloseTo(Math.atan(hw / hx), 15);
    expect(transition.name).toContain('39.8°');
    expect(transition.note).toContain(Math.hypot(hx, hw).toFixed(3));
    expect(marks.find((m) => m.id === 'full')!.angle).toBe(FULL_TURN);
  });

  it('describes each mode as a prescribed turn, and the fourth-direction cut as a rigid object cut in different places', () => {
    const study = new RotationStudy();
    expect(study.describe()).toMatch(/^Prescribed turn — not a physics simulation\./);
    expect(study.describe()).toContain('same rigid 3D box');
    study.setMode('fourth');
    expect(study.describe()).toMatch(/^Prescribed turn — not a physics simulation\./);
    expect(study.describe()).toMatch(/section changes shape because it cuts different parts of the object\s*—\s*not\s*because the object deforms/);
    expect(STUDY_PLANES.ordinary).toMatchObject({ i: 0, j: 1 });
    expect(STUDY_PLANES.fourth).toMatchObject({ i: 0, j: 3 });
    study.dispose();
  });
});

describe('source pins: the study is separate', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '..', '..', 'src', 'spatial-4d-contact', 'study.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('never touches the collision simulation, never reorients its slice, never computes a section or a projection itself', () => {
    expect(source).not.toMatch(/ContactSimulation|PhysicsWorld4|ContactPipeline4|RigidBody4/);
    expect(source).not.toMatch(/setNormal\(|\.offset\s*=/);
    expect(source).toMatch(/Rotor4\.fromPlane\(plane\.i,\s*plane\.j,\s*this\.angle\)/);
    expect(source).not.toMatch(/Math\.(cos|sin|tan)\(/);
  });
});
