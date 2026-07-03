import { describe, expect, it } from 'vitest';
import { OrthographicProjection, PerspectiveProjection } from '@holotope/core';

describe('OrthographicProjection', () => {
  it('keeps the first three coordinates', () => {
    const proj = new OrthographicProjection({ fromDim: 5 });
    expect(proj.projectPoint([1, 2, 3, 4, 5])).toEqual([1, 2, 3]);
  });

  it('projects packed positions', () => {
    const proj = new OrthographicProjection({ fromDim: 4 });
    const src = new Float64Array([1, 2, 3, 9, 4, 5, 6, -9]);
    const dst = new Float32Array(6);
    proj.projectPositions(src, 2, dst);
    expect(Array.from(dst)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('PerspectiveProjection', () => {
  it('is the identity for fromDim = 3 (n=3 invariant)', () => {
    const proj = new PerspectiveProjection({ fromDim: 3, viewDistance: 5 });
    expect(proj.projectPoint([1.5, -2.5, 3.5])).toEqual([1.5, -2.5, 3.5]);
  });

  it('leaves points on the w=0 hyperplane unscaled', () => {
    const proj = new PerspectiveProjection({ fromDim: 4, viewDistance: 3 });
    const [x, y, z] = proj.projectPoint([1, 2, -1, 0]);
    expect(x).toBeCloseTo(1, 12);
    expect(y).toBeCloseTo(2, 12);
    expect(z).toBeCloseTo(-1, 12);
  });

  it('enlarges points nearer the viewpoint and shrinks farther ones', () => {
    const proj = new PerspectiveProjection({ fromDim: 4, viewDistance: 4 });
    const [near] = proj.projectPoint([1, 0, 0, 1]); // scale 4/3 > 1
    const [far] = proj.projectPoint([1, 0, 0, -1]); // scale 4/5 < 1
    expect(near).toBeCloseTo(4 / 3, 12);
    expect(far).toBeCloseTo(4 / 5, 12);
  });

  it('projectPositions matches projectPoint', () => {
    const proj = new PerspectiveProjection({ fromDim: 6, viewDistance: 3 });
    const count = 5;
    const src = new Float64Array(count * 6).map(() => Math.random() * 2 - 1);
    const dst = new Float32Array(count * 3);
    proj.projectPositions(src, count, dst);
    for (let p = 0; p < count; p++) {
      const expected = proj.projectPoint(Array.from(src.subarray(p * 6, p * 6 + 6)));
      for (let c = 0; c < 3; c++) {
        expect(dst[p * 3 + c]).toBeCloseTo(expected[c]!, 5); // Float32 precision
      }
    }
  });

  it('clamps rather than exploding at the viewpoint', () => {
    const proj = new PerspectiveProjection({ fromDim: 4, viewDistance: 2 });
    const [x] = proj.projectPoint([1, 0, 0, 2]); // exactly at the viewpoint
    expect(Number.isFinite(x)).toBe(true);
  });
});
