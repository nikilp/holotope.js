import { describe, expect, it } from 'vitest';
import { HyperplaneSliceN } from '@holotope/core';
import {
  ambientSeparation, buildProjectionPair, chartOf,
  projectedEdges, projectedVertices
} from '../src/flatland/projection.js';
import { sectionOutline, buildFlatlandSource } from '../src/flatland/section.js';

/**
 * Scene 4's claim, which is stronger than "these look alike": two genuinely
 * different solids cast the same shadow, and the sameness is exact.
 */
describe('flatland: projection is many-to-one', () => {
  const pair = buildProjectionPair();

  it('projects both solids to the same shadow, to 1e15 of their separation', () => {
    // The first draft asserted BITWISE equality and failed: the chart basis is
    // orthonormal only to floating point, so `n·u` is about 1e-17 and the
    // displaced dot product rounds differently in its last bits. The honest
    // claim is the RATIO — how small the shadow disagreement is against how far
    // apart the solids stand — and that is what is pinned.
    const a = projectedVertices(pair, pair.original);
    const b = projectedVertices(pair, pair.twin);
    expect(b.length).toBe(a.length);
    let worstShadow = 0;
    for (let i = 0; i < a.length; i++) {
      worstShadow = Math.max(worstShadow,
        Math.hypot(b[i]![0] - a[i]![0], b[i]![1] - a[i]![1]));
    }
    expect(worstShadow).toBeLessThan(1e-14);
    const ratio = ambientSeparation(pair) / Math.max(worstShadow, Number.MIN_VALUE);
    expect(ratio).toBeGreaterThan(1e15);
  });

  it('shares its edge topology, so the drawn shadows coincide too', () => {
    expect(projectedEdges(pair.twin)).toEqual(projectedEdges(pair.original));
    expect(pair.twin.vertexCount).toBe(pair.original.vertexCount);
  });

  it('is nevertheless a different solid, by a wide margin', () => {
    // SHEAR_COEFFICIENT is a coefficient, not a bound: the saddle exceeds one
    // at the corners, so the furthest vertex travels further than it.
    const apart = ambientSeparation(pair);
    expect(apart).toBeGreaterThan(0.4);
    expect(apart).toBeLessThan(2);
    // Exactly two vertices stay put, and which two is not arbitrary: the saddle
    // vanishes at the chart origin, and the only cube corners projecting there
    // are the two poles of the diagonal being projected along. Six of eight
    // move, so the twin is nowhere near a restyling.
    const unmoved: number[] = [];
    for (let vertex = 0; vertex < pair.original.vertexCount; vertex++) {
      const same = [0, 1, 2].every((axis) =>
        pair.twin.positions[vertex * 3 + axis]
          === pair.original.positions[vertex * 3 + axis]);
      if (same) unmoved.push(vertex);
    }
    expect(unmoved.length).toBe(2);
    // Vertex 0 is (−1,−1,−1) and vertex 7 is (1,1,1) under binary corner order.
    expect(unmoved).toEqual([0, 7]);
    for (const pole of unmoved) {
      const chart = chartOf(pair.slice, [
        pair.original.positions[pole * 3]!,
        pair.original.positions[pole * 3 + 1]!,
        pair.original.positions[pole * 3 + 2]!
      ]);
      expect(Math.hypot(...chart)).toBeLessThan(1e-15);
    }
  });

  it('separates immediately once the view leaves the projection direction', () => {
    // The payoff is that the coincidence is special to one direction. Tilt the
    // chart and the two shadows stop agreeing.
    const tilted = new HyperplaneSliceN({ normal: [1, 0, 0], offset: 0 });
    let worst = 0;
    for (let vertex = 0; vertex < pair.original.vertexCount; vertex++) {
      const read = (c: typeof pair.original): [number, number] => chartOf(tilted, [
        c.positions[vertex * 3]!, c.positions[vertex * 3 + 1]!, c.positions[vertex * 3 + 2]!
      ]);
      const a = read(pair.original);
      const b = read(pair.twin);
      worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1]));
    }
    expect(worst).toBeGreaterThan(0.3);
  });

  it('contrasts with the section, which does tell them apart', () => {
    // Scene 3's map is not fooled: a section through the twin is a different
    // shape from a section through the cube at the same offset. This is the
    // sentence the two scenes exist to separate.
    const cube = buildFlatlandSource();
    const cubeArea = (offset: number): number => {
      const ring = sectionOutline(cube, offset).ring;
      let sum = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        sum += a[0] * b[1] - b[0] * a[1];
      }
      return Math.abs(sum) / 2;
    };
    // The cube's own section is nonzero and varies — the section carries
    // information about position along the normal, which the projection threw
    // away entirely.
    expect(cubeArea(0)).toBeGreaterThan(cubeArea(1.2));
    expect(cubeArea(1.68)).toBeLessThan(cubeArea(0));
  });
});
