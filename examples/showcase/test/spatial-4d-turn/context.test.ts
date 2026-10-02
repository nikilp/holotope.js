import { describe, expect, it } from 'vitest';
import { SCENE, type GlomeObject, type HyperboxObject } from '../../src/spatial-4d-turn/scene.js';
import { ContextLayer } from '../../src/spatial-4d-turn/context.js';
import { createProducts } from '../../src/spatial-4d-turn/section.js';
import { REFERENCE_STATE, applyTo, createSlice, setOffset, setPhase, setTheta, type TurnState } from '../../src/spatial-4d-turn/turn-state.js';

/**
 * The projection context through the SHIPPED layer — the same `ContextLayer`
 * the page mounts, driven by the same slice and products — held against
 * predictions written from the authored numbers and the accepted single-plane
 * frame, never against the adapter, the rotor or `positionAt`.
 */

const deg = (d: number): number => (d * Math.PI) / 180;
const box = SCENE.find((o) => o.kind === 'hyperbox') as HyperboxObject;
const ball = SCENE.find((o) => o.kind === 'glome') as GlomeObject;
const [hx, hy, hz, hw] = box.halfExtents;

function at(thetaDeg: number, offset = 0, phaseDeg = 0) {
  const slice = createSlice();
  const products = createProducts(SCENE, slice);
  const layer = new ContextLayer(products, slice);
  const state: TurnState = setPhase(setOffset(setTheta(REFERENCE_STATE, deg(thetaDeg)), offset), deg(phaseDeg));
  applyTo(slice, state);
  for (const p of products) { p.setPhase(state.phase); p.update(slice); }
  layer.update();
  return {
    slice, products, layer,
    block: products.find((p) => p.id === 'block')!,
    companion: products.find((p) => p.id === 'companion')!
  };
}

/**
 * The accepted frame (turn.test.ts holds it against Rotor4): the chart's first
 * axis is the rotor image of x, (cos θ, 0, 0, sin θ); y and z are untouched.
 * So a source point (x, y, z, w) lands at (x cos θ + w sin θ, y, z). Written
 * with Math.cos and Math.sin — not with the slice, the rotor or the adapter.
 */
const predictChart = (p: readonly number[], theta: number): number[] =>
  [p[0]! * Math.cos(theta) + p[3]! * Math.sin(theta), p[1]!, p[2]!];

const corners = (): number[][] => {
  const out: number[][] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) for (const sw of [-1, 1]) {
    out.push([sx * hx!, sy * hy!, sz * hz!, sw * hw!]);
  }
  return out;
};

/** Multiset equality of point sets, each predicted point matched to its nearest unused actual one. */
function expectSamePoints(actual: number[][], predicted: number[][], tolerance: number, label: string): void {
  expect(actual.length, `${label}: count`).toBe(predicted.length);
  const pool = actual.map((a) => [...a]);
  for (const p of predicted) {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    pool.forEach((a, i) => {
      const d = Math.hypot(a[0]! - p[0]!, a[1]! - p[1]!, a[2]! - p[2]!);
      if (d < bestDistance) { bestDistance = d; best = i; }
    });
    expect(bestDistance, `${label}: predicted (${p.map((c) => c.toFixed(3)).join(', ')}) has a match`).toBeLessThan(tolerance);
    pool.splice(best, 1);
  }
}

describe('the block’s projected edges are the library’s projection into the accepted frame', () => {
  it('lands the 16 corners where the frame predicts — reference, both ends, and turns between', () => {
    for (const d of [0, 36, -36, 60, -60, 90, -90]) {
      const { layer } = at(d);
      expect(layer.block!.edgeCount(), `${d}°: edges`).toBe(32);
      // Float32 buffer: ~1e-7 relative. 1e-5 is generous and far below any wrong frame.
      expectSamePoints(layer.block!.vertexPositions(), corners().map((c) => predictChart(c, deg(d))), 1e-5, `${d}°`);
    }
  });

  it('is the projection of source edges, not the section: 32 edges even where the section is empty', () => {
    const touching = at(0, -hw!);
    expect(touching.block.status).toBe('tangent');
    expect(touching.block.primitiveCount, 'the section draws nothing here').toBe(0);
    expect(touching.layer.block!.edgeCount(), 'the context still has every edge').toBe(32);
    const reference = at(0, 0);
    expect(touching.layer.block!.vertexPositions()).toEqual(reference.layer.block!.vertexPositions());
    // And at the reference the section is a different object altogether: 48
    // triangles on 26 cut vertices, against the context's 16 corners and 32 edges.
    expect(reference.block.primitiveCount).toBe(48);
    expect(reference.block.cutVertexCount).toBe(26);
    expect(reference.layer.block!.vertexPositions()).toHaveLength(16);
  });

  it('does not move when the offset changes at a fixed turn, while the cut does', () => {
    for (const d of [0, 20, -50]) {
      const base = at(d, 0);
      const distances = new Set<number>();
      for (const offset of [-1.6, -0.8, 0, 0.8, 1.6]) {
        const s = at(d, offset);
        expect(s.layer.block!.vertexPositions(), `${d}° @ ${offset}: block context`).toEqual(base.layer.block!.vertexPositions());
        expect(s.layer.ball!.chartCentre(), `${d}° @ ${offset}: ball context`).toEqual(base.layer.ball!.chartCentre());
        // The cut did move: the knife's signed distance to the ball's centre is
        // a fact of the section, and it changes with every offset at any turn.
        // (At −50° the block is cut at every offset in range and the ball is out
        // of reach at all of them, so statuses alone would not show the change.)
        distances.add(s.companion.signedDistance!);
      }
      expect(distances.size, `${d}°: the cut changed at every offset`).toBe(5);
    }
    // And where the offset does cross a boundary, the statuses show it too.
    const statuses = new Set([-1.6, 0, 0.8].map((offset) => {
      const s = at(0, offset);
      return `${s.block.status}/${s.block.primitiveCount}/${s.companion.status}`;
    }));
    expect(statuses.size).toBe(3);
  });

  it('turns with the knife, in the same frame as the section: wider than the cut, as a shadow must be', () => {
    const reference = at(0);
    const turned = at(60);
    expect(turned.layer.block!.vertexPositions()).not.toEqual(reference.layer.block!.vertexPositions());
    // Along the chart's first axis the projection reaches 2.2 cos 60° + 1.6 sin 60°;
    // the section at the same turn reaches only min(2.2/cos, 1.6/sin) — held in geometry.test.ts.
    const reach = Math.max(...turned.layer.block!.vertexPositions().map((v) => Math.abs(v[0]!)));
    expect(reach).toBeCloseTo(hx! * Math.cos(deg(60)) + hw! * Math.sin(deg(60)), 5);
    expect(reach).toBeGreaterThan(Math.min(hx! / Math.cos(deg(60)), hw! / Math.sin(deg(60))));
  });
});

describe('the ball’s projected extent', () => {
  // The authored path, in the rotor's sign convention as held by path.test.ts
  // and turn.test.ts: centre (3.6, 1.05, −0.92 sin φ, 0.92 cos φ). Projected
  // by the accepted frame: (3.6 cos θ + w sin θ, 1.05, z).
  const predictBall = (thetaDeg: number, phaseDeg: number): number[] => {
    const theta = deg(thetaDeg);
    const phase = deg(phaseDeg);
    const w = 0.92 * Math.cos(phase);
    const z = -0.92 * Math.sin(phase);
    return [ball.centre[0] * Math.cos(theta) + w * Math.sin(theta), ball.centre[1], z];
  };

  it('sits at the predicted projected centre with the source radius, at several phases and turns', () => {
    for (const thetaDeg of [0, 30, -60, 90]) {
      for (const phaseDeg of [0, 45, 90, 135, 180, 270]) {
        const { layer } = at(thetaDeg, 0, phaseDeg);
        const centre = layer.ball!.chartCentre();
        const want = predictBall(thetaDeg, phaseDeg);
        for (let i = 0; i < 3; i++) expect(centre[i], `${thetaDeg}° φ=${phaseDeg}° coordinate ${i}`).toBeCloseTo(want[i]!, 9);
        expect(layer.ball!.radius, 'the radius is the source radius').toBe(ball.radius);
        expect(layer.ball!.object.scale.x).toBe(ball.radius);
        expect(layer.ball!.object.position.toArray().map((c) => Number(c.toFixed(9))))
          .toEqual(centre.map((c) => Number(c.toFixed(9))));
      }
    }
  });

  it('stays in projection while its section is absent', () => {
    const { layer, companion } = at(0, 0, 0);
    expect(companion.status).toBe('outside');
    expect(companion.primitiveCount).toBe(0);
    const centre = layer.ball!.chartCentre();
    expect(centre[0]).toBeCloseTo(3.6, 12);
    expect(centre[1]).toBeCloseTo(1.05, 12);
    expect(centre[2]).toBeCloseTo(0, 12);
    expect(layer.ball!.radius).toBe(ball.radius);
  });

  it('moves along the projected path as the phase advances, while the block’s context does not', () => {
    const rest = at(0, 0, 0);
    const quarter = at(0, 0, 90);
    expect(quarter.layer.ball!.chartCentre()).not.toEqual(rest.layer.ball!.chartCentre());
    expect(quarter.layer.ball!.chartCentre()[2]).toBeCloseTo(-0.92, 9);
    expect(quarter.layer.block!.vertexPositions()).toEqual(rest.layer.block!.vertexPositions());
  });
});

describe('the toggle and the picker', () => {
  it('showing or hiding the layer changes nothing but its own visibility', () => {
    const { slice, products, layer } = at(25, 0.4, 70);
    const snapshot = () => ({
      normal: Array.from(slice.normal.data),
      offset: slice.offset,
      products: products.map((p) => `${p.id}:${p.status}/${p.primitiveCount}/${p.object.visible}`),
      block: layer.block!.vertexPositions(),
      ball: layer.ball!.chartCentre()
    });
    const before = snapshot();
    expect(layer.visible).toBe(false);
    layer.setVisible(true);
    expect(layer.visible).toBe(true);
    expect(snapshot()).toEqual(before);
    layer.setVisible(false);
    expect(layer.visible).toBe(false);
    expect(snapshot()).toEqual(before);
  });

  it('lives on its own root, outside every product’s object, so section picking never reaches it', () => {
    const { products, layer } = at(0);
    expect(layer.object.parent).toBeNull();
    for (const p of products) {
      expect(p.object.getObjectById(layer.object.id), `${p.id} does not hold the layer`).toBeUndefined();
      layer.object.traverse((o) => {
        expect(p.object.getObjectById(o.id), `${p.id} does not hold ${o.name || o.type}`).toBeUndefined();
      });
    }
  });

  it('says what it is and what it is not, from its own numbers', () => {
    const { layer } = at(0);
    const text = layer.describe();
    expect(text).toContain('32 edges');
    expect(text).toContain('not the outline of the projected solid');
    expect(text).toContain(`radius ${ball.radius}`);
    expect(text).toContain('not contact');
    expect(text).toContain('does not reach every cut');
  });
});
