import { describe, expect, it } from 'vitest';
import {
  MatN,
  Rotor4,
  TransformN,
  VecN
} from '@holotope/core';
import {
  HyperboxSupportShape4,
  gjkDistance,
  hyperboxSat4,
  type HyperboxSatFeatureClass4
} from '../src/index.js';

const PLANE_PAIRS = [
  [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]
] as const;

function expectVectorClose(
  actual: VecN,
  expected: ArrayLike<number>,
  digits = 11
): void {
  for (let axis = 0; axis < actual.dim; axis++) {
    expect(actual.data[axis]!).toBeCloseTo(expected[axis]!, digits);
  }
}

function translatedBox(x: number): HyperboxSupportShape4 {
  return new HyperboxSupportShape4(
    [1, 1, 1, 1],
    new TransformN(4, undefined, new VecN([x, 0, 0, 0]))
  );
}

function projectedGap(
  boxA: HyperboxSupportShape4,
  boxB: HyperboxSupportShape4,
  direction: VecN
): number {
  const interval = (box: HyperboxSupportShape4): [number, number] => {
    const axes = box.worldAxes();
    const center = box.center.dot(direction);
    let radius = 0;
    for (let axis = 0; axis < 4; axis++) {
      radius += box.halfExtents[axis]! * Math.abs(axes[axis]!.dot(direction));
    }
    return [center - radius, center + radius];
  };
  const a = interval(boxA);
  const b = interval(boxB);
  return Math.max(a[0] - b[1], b[0] - a[1]);
}

describe('oriented R4 hyperbox support', () => {
  it('uses stable bit-mask vertices and resolves them at the current pose', () => {
    const rotation = Rotor4.fromPlanes([
      { i: 0, j: 3, angle: 0.4 },
      { i: 1, j: 2, angle: -0.7 }
    ]);
    const box = new HyperboxSupportShape4(
      [1, 2, 3, 4],
      new TransformN(4, rotation, new VecN([2, -1, 0.5, 3]))
    );
    const direction = new VecN([0.3, -0.8, 1.2, 0.4]);
    const support = box.support(direction);
    let maximum = Number.NEGATIVE_INFINITY;
    let maximizingFeature = -1;
    for (let feature = 0; feature < 16; feature++) {
      const vertex = box.resolveFeature(feature)!;
      const projection = vertex.point.dot(direction);
      if (projection > maximum) {
        maximum = projection;
        maximizingFeature = feature;
      }
    }
    expect(support.point.dot(direction)).toBeCloseTo(maximum, 13);
    expect(support.featureId).toBe(maximizingFeature);
    expectVectorClose(box.resolveFeature(support.featureId)!.point, support.point.data, 13);
  });

  it('rejects non-rigid transforms and malformed extents', () => {
    expect(() => new HyperboxSupportShape4([1, 2, 3])).toThrow(/four half extents/);
    expect(() => new HyperboxSupportShape4([1, 2, 0, 4])).toThrow(/positive/);
    const affine = MatN.identity(4);
    affine.set(0, 0, 2);
    expect(() => new HyperboxSupportShape4(
      [1, 1, 1, 1],
      new TransformN(4, affine)
    )).toThrow(/orthonormal/);
  });
});

describe('complete R4 hyperbox SAT', () => {
  it('returns analytic aligned separation, touching, and overlap certificates', () => {
    const origin = translatedBox(0);
    const separated = hyperboxSat4(origin, translatedBox(3));
    expect(separated.status).toBe('separated');
    expect(separated.intersects).toBe(false);
    expect(separated.separation).toBeCloseTo(1, 14);
    expectVectorClose(separated.axis, [-1, 0, 0, 0], 14);
    expect(separated.source.featureClass).toBe('facet-a');
    expect(separated.diagnostics).toEqual({
      axesGenerated: 56,
      axesTested: 4,
      degenerateAxesSkipped: 24,
      duplicateAxesSkipped: 28
    });

    const touching = hyperboxSat4(origin, translatedBox(2));
    expect(touching.status).toBe('touching');
    expect(touching.signedAxisDistance).toBe(0);

    const overlapping = hyperboxSat4(origin, translatedBox(1.5));
    expect(overlapping.status).toBe('overlapping');
    expect(overlapping.penetrationDepth).toBeCloseTo(0.5, 14);
    expect(overlapping.signedAxisDistance).toBeCloseTo(-0.5, 14);
    expectVectorClose(overlapping.axis, [-1, 0, 0, 0], 14);
  });

  it('pins a separation invisible to all eight facet-normal axes', () => {
    const boxA = new HyperboxSupportShape4([1, 1.2, 0.8, 0.6]);
    const angles = [
      -0.6160006645231031,
      -0.2957631702832078,
      2.710616604153151,
      -1.9509457467326923,
      -1.2748440260736469,
      -0.6618182712960471
    ];
    const boxB = new HyperboxSupportShape4(
      [0.9, 0.7, 1.1, 0.5],
      new TransformN(
        4,
        Rotor4.fromPlanes(
          PLANE_PAIRS.map(([i, j], index) => ({ i, j, angle: angles[index]! }))
        ),
        new VecN([
          0.5075564910657704,
          -1.8792329386342317,
          -1.5547043345868587,
          1.4199476188514382
        ])
      )
    );

    for (const facetAxis of [...boxA.worldAxes(), ...boxB.worldAxes()]) {
      expect(projectedGap(boxA, boxB, facetAxis)).toBeLessThanOrEqual(0);
    }
    const result = hyperboxSat4(boxA, boxB);
    expect(result.status).toBe('separated');
    expect(result.separation).toBeCloseTo(0.06792564569847337, 13);
    expect(result.source).toEqual({
      featureClass: 'edge-a-face-b',
      axesA: [0],
      axesB: [2, 3]
    });
    expect(result.diagnostics.axesTested).toBe(56);
    expect(gjkDistance(boxA, boxB).distance).toBeCloseTo(0.0681587350806607, 12);
  });

  it('agrees with GJK over 20,000 deterministic full R4 poses', () => {
    let state = 0x91e10da5;
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    const boxA = new HyperboxSupportShape4([1, 1.2, 0.8, 0.6]);
    const winningFamilies = new Set<HyperboxSatFeatureClass4>();
    let mismatches = 0;
    let indeterminateGjk = 0;
    for (let sample = 0; sample < 20_000; sample++) {
      const rotation = Rotor4.fromPlanes(
        PLANE_PAIRS.map(([i, j]) => ({
          i,
          j,
          angle: (random() * 2 - 1) * Math.PI
        }))
      );
      const translation = new VecN(
        Array.from({ length: 4 }, () => random() * 7 - 3.5)
      );
      const boxB = new HyperboxSupportShape4(
        [0.9, 0.7, 1.1, 0.5],
        new TransformN(4, rotation, translation)
      );
      const sat = hyperboxSat4(boxA, boxB);
      const gjk = gjkDistance(boxA, boxB);
      winningFamilies.add(sat.source.featureClass);
      if (gjk.intersects === null) {
        indeterminateGjk++;
      } else if (sat.intersects !== gjk.intersects) {
        mismatches++;
      }
    }
    expect(indeterminateGjk).toBe(0);
    expect(mismatches).toBe(0);
    expect(winningFamilies.has('edge-a-face-b')).toBe(true);
    expect(winningFamilies.has('face-a-edge-b')).toBe(true);
  });

  it('is symmetric under swapping the ordered pair', () => {
    const boxA = new HyperboxSupportShape4([1, 1.2, 0.8, 0.6]);
    const boxB = new HyperboxSupportShape4(
      [0.7, 1.1, 0.6, 0.9],
      new TransformN(
        4,
        Rotor4.fromPlanes([
          { i: 0, j: 2, angle: 0.7 },
          { i: 1, j: 3, angle: -0.45 }
        ]),
        new VecN([1.1, -0.4, 0.3, 0.2])
      )
    );
    const forward = hyperboxSat4(boxA, boxB);
    const reverse = hyperboxSat4(boxB, boxA);
    expect(forward.status).toBe(reverse.status);
    expect(forward.signedAxisDistance).toBeCloseTo(reverse.signedAxisDistance, 12);
    expect(Math.abs(forward.axis.dot(reverse.axis))).toBeCloseTo(1, 12);
  });

  it('validates numerical policies', () => {
    const box = translatedBox(0);
    expect(() => hyperboxSat4(box, box, { axisEpsilon: -1 })).toThrow(
      /axisEpsilon/
    );
    expect(() => hyperboxSat4(box, box, { contactTolerance: Number.NaN })).toThrow(
      /contactTolerance/
    );
    expect(() => hyperboxSat4(box, box, { duplicateEpsilon: 1 })).toThrow(
      /less than 1/
    );
  });
});
