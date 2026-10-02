import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { SCENE } from '../../src/spatial-4d-turn/scene.js';
import { GRAZE_EPSILON, createProducts, grazeRadiusOf } from '../../src/spatial-4d-turn/section.js';
import { REFERENCE_STATE, applyTo, createSlice, setTheta } from '../../src/spatial-4d-turn/turn-state.js';

/**
 * Source-feature identity through the SHIPPED products: the same `BoxSection`
 * the viewport draws, driven by the same slice the controls move. No DOM is
 * needed — the chart's buffers are plain three.js geometry.
 */

const deg = (d: number): number => (d * Math.PI) / 180;

function at(thetaDeg: number) {
  const slice = createSlice();
  const products = createProducts(SCENE, slice);
  applyTo(slice, setTheta(REFERENCE_STATE, deg(thetaDeg)));
  for (const p of products) p.update(slice);
  const block = products.find((p) => p.id === 'block')!;
  const companion = products.find((p) => p.id === 'companion')!;
  const names = new Set([...block.presentFaces].map((o) => block.faces[o]!.name));
  return { slice, products, block, companion, names };
}

describe('the block’s eight faces have names read from the geometry', () => {
  it('finds one cube per signed axis, and nothing else', () => {
    const { block } = at(0);
    expect(block.faces).toHaveLength(8);
    expect([...block.faces].map((f) => f.name).sort())
      .toEqual(['+w', '+x', '+y', '+z', '−w', '−x', '−y', '−z'].sort());
    for (const face of block.faces) {
      expect(block.faces.filter((f) => f.axis === face.axis && f.sign === face.sign)).toHaveLength(1);
    }
  });
});

describe('which faces the section cuts is predictable from the half-extents', () => {
  // The hyperplane -sin·x + cos·w = 0 meets the cube at w = ±1.6 only where
  // |x| = 1.6/tan ≤ 2.2, i.e. tan ≥ 1.6/2.2 (36.03°); and it meets the cubes at
  // x = ±2.2 only where |w| = 2.2·tan ≤ 1.6, i.e. below that same angle.
  it('shows the x faces and no w faces at the reference and below 36°', () => {
    for (const d of [0, 10, 20, 30]) {
      const { names } = at(d);
      expect(names.has('+x') && names.has('−x'), `${d}° has both x faces`).toBe(true);
      expect(names.has('+w') || names.has('−w'), `${d}° has no w face`).toBe(false);
      expect(names.has('+y') && names.has('−y') && names.has('+z') && names.has('−z')).toBe(true);
    }
  });

  it('swaps them past 36°: the w faces arrive as the x faces leave', () => {
    for (const d of [40, 50, 70, 90]) {
      const { names } = at(d);
      expect(names.has('+w') && names.has('−w'), `${d}° has both w faces`).toBe(true);
      expect(names.has('+x') || names.has('−x'), `${d}° has no x face`).toBe(false);
    }
  });

  it('never loses the y and z faces, whose axes the turn does not touch', () => {
    for (const d of [-80, -35, 0, 36, 60, 89]) {
      const { names } = at(d);
      for (const n of ['+y', '−y', '+z', '−z']) expect(names.has(n), `${d}° ${n}`).toBe(true);
    }
  });
});

describe('faces persist while cut vertices do not', () => {
  it('keeps the same face objects across turns while the cut edges change', () => {
    const slice = createSlice();
    const [block] = createProducts(SCENE, slice);
    const facesBefore = block!.faces;
    const edgeSets = new Map<number, string>();
    for (const d of [0, 20, 36, 50, 90]) {
      applyTo(slice, setTheta(REFERENCE_STATE, deg(d)));
      block!.update(slice);
      expect(block!.cutVertexCount, `${d}° has cut vertices`).toBeGreaterThan(0);
      expect(block!.cutEdges(), `${d}° one key per vertex`).toHaveLength(block!.cutVertexCount);
      edgeSets.set(d, block!.cutEdges().join('|'));
    }
    expect(block!.faces, 'identity is the same array, not an equal one').toBe(facesBefore);
    // The count alone can hold steady across a centred turn — it did, at every
    // angle above, which is why the count is not the assertion. The EDGES the
    // vertices stand on are what changes.
    expect(edgeSets.get(20), 'different edges are cut either side of the flip')
      .not.toBe(edgeSets.get(50));
    expect(edgeSets.get(0)).not.toBe(edgeSets.get(90));
  });

  it('but a parallel offset inside the block cuts the very same edges', () => {
    // Predictable without running anything: at theta = 0 the hyperplane is
    // w = c. Every edge it crosses at c = 0 spans the whole w range of the
    // block, so it crosses the same edges at any |c| < 1.6 — the drawn section
    // is the identical box, merely taken at another w. Translation moves
    // nothing about WHICH edges; only the turn does. The companion, sitting at
    // w = 0.92, is what the offset visibly changes.
    const slice = createSlice();
    const [block, companion] = createProducts(SCENE, slice);
    applyTo(slice, REFERENCE_STATE);
    block!.update(slice); companion!.update(slice);
    const centredEdges = block!.cutEdges().join('|');
    const centredCount = block!.cutVertexCount;
    const centredDistance = companion!.signedDistance;
    slice.offset = 1.4;
    block!.update(slice); companion!.update(slice);
    expect(block!.cutEdges().join('|'), 'same edges under parallel translation').toBe(centredEdges);
    expect(block!.cutVertexCount).toBe(centredCount);
    expect(companion!.signedDistance, 'the companion’s distance is what moved')
      .not.toBeCloseTo(centredDistance!, 6);
    slice.offset = 1.7;   // past the +w face: nothing left to cut
    block!.update(slice);
    expect(block!.status).toBe('outside');
    expect(block!.cutVertexCount).toBe(0);
  });
});

describe('picking a drawn triangle names its source face', () => {
  it('resolves every primitive at the reference to a non-w face', () => {
    const { block } = at(0);
    expect(block.primitiveCount).toBeGreaterThan(0);
    for (let p = 0; p < block.primitiveCount; p++) {
      const pick = block.pick({ faceIndex: p, point: new Vector3() });
      expect(pick, `primitive ${p}`).not.toBeNull();
      expect(pick!.face, `primitive ${p} has a face`).not.toBeNull();
      expect(pick!.face!.axis, `primitive ${p} is not a w face`).not.toBe(3);
    }
  });

  it('resolves every primitive at a quarter turn to a non-x face', () => {
    const { block } = at(90);
    for (let p = 0; p < block.primitiveCount; p++) {
      expect(block.pick({ faceIndex: p, point: new Vector3() })!.face!.axis).not.toBe(0);
    }
  });

  it('agrees with the face colouring the viewport draws', () => {
    const { block } = at(50);
    const picked = new Set<number>();
    for (let p = 0; p < block.primitiveCount; p++) {
      picked.add(block.pick({ faceIndex: p, point: new Vector3() })!.face!.ordinal);
    }
    expect([...picked].sort()).toEqual([...block.presentFaces].sort());
  });
});

describe('the companion’s graze is reachable from the slider, and disclosed', () => {
  it('flags grazing on the 0.5° grid at both crossings, while the library status stays exact', () => {
    const rows: Array<{ d: number; status: string; grazing: boolean }> = [];
    for (let d = 0; d <= 45; d += 0.5) {
      const { companion } = at(d);
      rows.push({ d, status: companion.status, grazing: companion.grazing });
    }
    const statuses = new Set(rows.map((r) => r.status));
    expect(statuses.has('outside')).toBe(true);
    expect(statuses.has('present')).toBe(true);
    // At the default tolerance exact tangency is not a state a 0.5° grid lands on.
    expect(statuses.has('tangent')).toBe(false);
    const grazes = rows.filter((r) => r.grazing).map((r) => r.d);
    const firstPresent = rows.find((r) => r.status === 'present')!.d;
    const lastPresent = [...rows].reverse().find((r) => r.status === 'present')!.d;
    expect(grazes.some((d) => d <= firstPresent), 'graze flagged around entry').toBe(true);
    expect(grazes.some((d) => d >= lastPresent), 'graze flagged around exit').toBe(true);
    // Grazing is a band on distance, on either side of the edge.
    for (const r of rows.filter((x) => x.grazing)) {
      const { companion } = at(r.d);
      expect(Math.abs(Math.abs(companion.signedDistance!) - 0.72)).toBeLessThanOrEqual(GRAZE_EPSILON + 1e-12);
    }
  });

  it('states the radius a hollow ball can still have', () => {
    const r = (SCENE.find((o) => o.kind === 'glome') as { radius: number }).radius;
    expect(grazeRadiusOf(r)).toBeCloseTo(Math.sqrt(2 * r * GRAZE_EPSILON - GRAZE_EPSILON ** 2), 12);
    expect(grazeRadiusOf(r)).toBeGreaterThan(0.1);
  });
});
