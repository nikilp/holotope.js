import { describe, expect, it } from 'vitest';
import { Rotor4, VecN, type HyperplaneSliceN } from '@holotope/core';
import type { BufferAttribute, Mesh } from 'three';
import { SCENE, TURN_PLANE } from '../../src/spatial-4d-turn/scene.js';
import { ON_PLANE_EPSILON, createProducts, type SectionProduct } from '../../src/spatial-4d-turn/section.js';
import { REFERENCE_STATE, applyTo, createSlice, setOffset, setTheta } from '../../src/spatial-4d-turn/turn-state.js';

/**
 * The DRAWN section against the closed form — the comparison the half-length
 * tests in turn.test.ts do not make (found in review: they held the formula to
 * itself). The vertices are read from the live range of the mesh buffer the
 * viewport draws, embedded back into R4 by the slice, and measured along the
 * rotor's image of the x axis — in ambient coordinates, so the result does not
 * depend on which basis of the hyperplane the chart happens to show.
 *
 * Also here: the block against the slice at its own faces, where an empty mesh
 * and a miss are different statements.
 */

const deg = (d: number): number => (d * Math.PI) / 180;
const box = SCENE.find((o) => o.kind === 'hyperbox')!;
const [hx, hy, hz, hw] = box.kind === 'hyperbox' ? box.halfExtents : [0, 0, 0, 0];

function blockAt(theta: number, offset = 0): { slice: HyperplaneSliceN; block: SectionProduct } {
  const slice = createSlice();
  const [block] = createProducts(SCENE, slice);
  applyTo(slice, setOffset(setTheta(REFERENCE_STATE, theta), offset));
  block!.update(slice);
  return { slice, block: block! };
}

/** Ambient R4 positions of the vertices actually drawn — the live range only. */
function drawnAmbient(block: SectionProduct, slice: HyperplaneSliceN): number[][] {
  const mesh = block.object as Mesh;
  const position = mesh.geometry.getAttribute('position') as BufferAttribute;
  const count = mesh.geometry.drawRange.count;
  const out: number[][] = [];
  for (let i = 0; i < count; i++) {
    out.push(slice.embedPoint([position.getX(i), position.getY(i), position.getZ(i)]));
  }
  return out;
}

const turnedX = (theta: number): Float64Array =>
  Rotor4.fromPlane(TURN_PLANE.i, TURN_PLANE.j, theta).applyToPoint(new VecN([1, 0, 0, 0])).data;

const along = (q: readonly number[], axis: ArrayLike<number>): number =>
  Math.abs(q[0]! * axis[0]! + q[1]! * axis[1]! + q[2]! * axis[2]! + q[3]! * axis[3]!);

describe('the drawn section has the predicted shape', () => {
  // min(2.2/|cos|, 1.6/|sin|) along the turned x axis; 1.3 and 0.8 along y and
  // z, which an x–w turn does not touch.
  const predictedHalfLength = (theta: number): number =>
    Math.min(hx! / Math.abs(Math.cos(theta)), hw! / Math.abs(Math.sin(theta)));

  it('along the turned x axis, and untouched in y and z, at every half degree including both ends', () => {
    for (let d = -90; d <= 90; d += 0.5) {
      const theta = deg(d);
      const { slice, block } = blockAt(theta);
      const points = drawnAmbient(block, slice);
      expect(points.length, `${d}° draws something`).toBeGreaterThan(0);
      const axisX = turnedX(theta);
      let alongX = 0;
      let alongY = 0;
      let alongZ = 0;
      for (const q of points) {
        alongX = Math.max(alongX, along(q, axisX));
        alongY = Math.max(alongY, Math.abs(q[1]!));
        alongZ = Math.max(alongZ, Math.abs(q[2]!));
      }
      // The buffer is Float32: about 1e-7 relative. 1e-5 absolute is generous
      // and still far below any wrong shape.
      expect(alongX, `${d}° half-length along the turned x axis`).toBeCloseTo(predictedHalfLength(theta), 5);
      expect(alongY, `${d}° y half-extent`).toBeCloseTo(hy!, 5);
      expect(alongZ, `${d}° z half-extent`).toBeCloseTo(hz!, 5);
    }
  });

  it('is widest at the diagonal, where the prediction says both bounds meet', () => {
    const diagonal = Math.atan(hw! / hx!);
    const { slice, block } = blockAt(diagonal);
    const axisX = turnedX(diagonal);
    const alongX = Math.max(...drawnAmbient(block, slice).map((q) => along(q, axisX)));
    expect(alongX).toBeCloseTo(Math.hypot(hx!, hw!), 5);
  });
});

describe('an empty mesh is told apart from a miss, at the block’s own faces', () => {
  // Found in review: at offset −1.6 the plane lies on the block's −w face, the
  // sectioner emits nothing by its tie-break, and the page called it a miss.
  it('lying exactly on the −w face is touching, not a miss, and says what is not drawn', () => {
    const { block } = blockAt(0, -hw!);
    expect(block.primitiveCount).toBe(0);
    expect(block.status).toBe('tangent');
    expect(block.boundary?.on).toBe(8);
    expect(block.boundary?.face?.name).toBe('−w');
    expect(block.explain()).toMatch(/touches the block on its −w face/);
    expect(block.explain()).toMatch(/Nothing is drawn/);
    expect(block.explain()).not.toMatch(/misses|clears/);
  });

  it('lying exactly on the +w face draws that face, and the readout says it is the tie-break', () => {
    const { block } = blockAt(0, hw!);
    expect(block.status).toBe('present');
    expect(block.primitiveCount).toBeGreaterThan(0);
    expect(block.boundary?.face?.name).toBe('+w');
    expect(block.explain()).toMatch(/lies exactly on the block’s \+w face/);
    expect(block.explain()).toMatch(/tie-break/);
  });

  it('clear of the block is outside, with the nearest corner’s distance and side', () => {
    const { slice, block } = blockAt(0);
    slice.offset = hw! + 0.1; // past the slider's clamp: the plane is 0.10 beyond the +w face
    block.update(slice);
    expect(block.status).toBe('outside');
    expect(block.boundary?.on).toBe(0);
    expect(block.boundary?.nearest).toBeCloseTo(-0.1, 9);
    expect(block.explain()).toMatch(/clears the block/);
    expect(block.explain()).toMatch(/0\.10 away/);
  });

  it('a plane through four corners is touching along a square face', () => {
    // At 45° the normal is (−1, 0, 0, 1)/√2; the four corners (2.2, ±1.3, ±0.8, −1.6)
    // share the signed distance −(2.2 + 1.6)/√2 and nothing else comes near it.
    const theta = deg(45);
    const { slice, block } = blockAt(theta);
    slice.offset = -(hx! + hw!) * Math.SQRT1_2;
    block.update(slice);
    expect(block.primitiveCount).toBe(0);
    expect(block.status).toBe('tangent');
    expect(block.boundary?.on).toBe(4);
    expect(block.boundary?.face).toBeNull();
    expect(block.explain()).toMatch(/along one of its square faces/);
  });

  it('mirrors the sectioner’s own tolerance rather than inventing one', () => {
    expect(ON_PLANE_EPSILON).toBe(1e-9);
  });
});

describe('the block names the faces that bound it, and derives the transition it speaks of', () => {
  // Found in review: the explanation typed the centred transition as 36.05°
  // (it is atan(1.6/2.2) = 36.03°) and said "both x ends and both w ends"
  // whenever one face of each family was present. These run the production
  // explain() on the shipped product, never a copy of the sentence.
  const transitionDeg = (Math.atan(hw! / hx!) * 180) / Math.PI;
  const X_FACES = ['−x', '+x'];
  const W_FACES = ['−w', '+w'];
  const named = (text: string) => ({
    x: X_FACES.filter((n) => text.includes(n)).sort(),
    w: W_FACES.filter((n) => text.includes(n)).sort()
  });
  const cut = (block: SectionProduct) => {
    const names = [...block.presentFaces].map((o) => block.faces[o]!.name);
    return { x: names.filter((n) => n.endsWith('x')).sort(), w: names.filter((n) => n.endsWith('w')).sort() };
  };

  it('states the transition from the half-extents for both turn directions, and never the old figure', () => {
    expect(transitionDeg).toBeCloseTo(36.027373, 5);
    for (const d of [0, 35.5, 36, 36.5, 50, -36.5, -35.5, -50]) {
      const text = blockAt(deg(d)).block.explain();
      // |tan θ| and ±: one statement true on both sides of zero.
      expect(text, `${d}°`).toContain(`|tan θ| = 1.6/2.2, at about ±${transitionDeg.toFixed(2)}°`);
      expect(text, `${d}°`).not.toContain('36.05');
      expect(text, `${d}°`).not.toMatch(/both pairs/);
    }
  });

  it('centred just below the transition: both x ends, no w end — just above: both w ends, no x end', () => {
    for (const d of [35.5, 36, -35.5, -36]) {
      const text = blockAt(deg(d)).block.explain();
      expect(named(text), `${d}°`).toEqual({ x: ['+x', '−x'], w: [] });
      expect(text).toMatch(/w ends are not reached/);
    }
    for (const d of [36.5, 37, -36.5, -37]) {
      const text = blockAt(deg(d)).block.explain();
      expect(named(text), `${d}°`).toEqual({ x: [], w: ['+w', '−w'] });
      expect(text).toMatch(/far side of the transition/);
    }
  });

  it('names exactly the x and w faces the section cuts, scoped to those families, and names the others too', () => {
    // Against the COMPLETE face set read from presentFaces here — not through
    // boundingFamilies() — so a sentence that quietly drops the y and z ends
    // cannot pass (found in review: "and no others" was false at 30°/0.8,
    // where the y and z ends bound the cut as well).
    for (const [d, offset] of [[30, 0.8], [-30, 0.8], [30, -0.8], [-30, -0.8], [20, 0.8], [50, 0.8], [40, -1.2]]) {
      const { block } = blockAt(deg(d!), offset!);
      const text = block.explain();
      const present = [...block.presentFaces].map((o) => block.faces[o]!.name);
      const expected = {
        x: present.filter((n) => n.endsWith('x')).sort(),
        w: present.filter((n) => n.endsWith('w')).sort()
      };
      const yz = present.filter((n) => n.endsWith('y') || n.endsWith('z'));
      expect(named(text), `${d}° @ ${offset}: x and w faces named`).toEqual(expected);
      expect(text, `${d}° @ ${offset}: scoped to the x and w families`).toMatch(/^Of its x and w ends, /);
      expect(text, `${d}° @ ${offset}: no exclusivity claim`).not.toMatch(/no others|and no other|only faces/);
      expect(yz.length, `${d}° @ ${offset}: the y and z ends are cut here`).toBe(4);
      for (const n of yz) expect(text, `${d}° @ ${offset}: names ${n}`).toContain(n);
    }
    const mixed = blockAt(deg(30), 0.8).block;
    expect(cut(mixed), 'the reported off-centre state cuts one x face and one w face').toEqual({ x: ['−x'], w: ['+w'] });
    expect(mixed.explain()).toContain('cuts the block’s −x end (red) and its +w end (gold). Its −y, +y, −z and +z ends bound it as well.');
    expect(mixed.explain()).toMatch(/holds over a range of angles/);
    expect(mixed.explain(), 'the exact-transition qualification is kept').toMatch(/exactly there both can meet the plane.*tie-break/);
    // The negative-angle counterpart cuts the other x end: the normal's x
    // component changes sign, the w component does not.
    const mirrored = blockAt(deg(-30), 0.8).block;
    expect(cut(mirrored)).toEqual({ x: ['+x'], w: ['+w'] });
    expect(mirrored.explain()).toContain('cuts the block’s +x end (red) and its +w end (gold). Its −y, +y, −z and +z ends bound it as well.');
  });

  it('at the transition evaluated directly, says only what the sectioner emitted', () => {
    for (const sign of [1, -1]) {
      const { block } = blockAt(sign * Math.atan(hw! / hx!));
      expect(block.status).toBe('present');
      const text = block.explain();
      const spoken = named(text);
      expect(spoken, `${sign > 0 ? '+' : '−'}transition`).toEqual(cut(block));
      expect(spoken.x.length + spoken.w.length).toBeGreaterThan(0);
      expect(text).not.toContain('36.05');
      // The mathematical transition and the emission convention stay two statements.
      expect(text).toContain(`|tan θ| = 1.6/2.2, at about ±${transitionDeg.toFixed(2)}°`);
      if (spoken.x.length && spoken.w.length) expect(text).toMatch(/depends on its tie-break/);
    }
  });
});
