import { Rotor4, TransformN, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  AllPairsCandidateProviderN,
  AxisAlignedBoundsN,
  HyperboxSupportShape4,
  SweepAndPruneCandidateProviderN,
  hyperboxBounds4,
  hyperboxSat4,
  supportShapeBoundsN,
  supportShapeSweptBoundsN,
  sweptBoundsN,
  type BroadphaseProxyN
} from '../src/index.js';

const PLANE_PAIRS = [
  [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]
] as const;

function proxy(
  id: string,
  min: ArrayLike<number>,
  max: ArrayLike<number>
): BroadphaseProxyN<string> {
  return { id, bounds: new AxisAlignedBoundsN(min, max), value: id };
}

function pairIds<T>(
  pairs: readonly { proxyA: BroadphaseProxyN<T>; proxyB: BroadphaseProxyN<T> }[]
): string[] {
  return pairs.map(({ proxyA, proxyB }) => `${proxyA.id}/${proxyB.id}`);
}

describe('dimension-independent broadphase bounds', () => {
  it('constructs closed bounds and treats interval contact as overlap', () => {
    const first = new AxisAlignedBoundsN([0, -1, 2], [1, 0, 4]);
    const touching = new AxisAlignedBoundsN([1, -2, 3], [2, -1, 5]);
    const separated = new AxisAlignedBoundsN([1 + 1e-9, -2, 3], [2, -1, 5]);
    expect(first.overlaps(touching)).toBe(true);
    expect(first.overlaps(separated)).toBe(false);
    expect(() => first.overlaps(new AxisAlignedBoundsN([0, 0], [1, 1])))
      .toThrow(/dimension/);
    expect(() => new AxisAlignedBoundsN([0, 2], [1, 1])).toThrow(/ordered/);
    expect(() => new AxisAlignedBoundsN([], [])).toThrow(/positive dimension/);
  });

  it('bounds every vertex of a rotated R4 support shape', () => {
    const shape = new HyperboxSupportShape4(
      [1, 2, 3, 4],
      new TransformN(
        4,
        Rotor4.fromPlanes([
          { i: 0, j: 3, angle: 0.73 },
          { i: 1, j: 2, angle: -0.41 }
        ]),
        new VecN([2, -3, 5, 7])
      )
    );
    const bounds = supportShapeBoundsN(shape);
    const analyticBounds = hyperboxBounds4(shape);
    const exactMin = new Float64Array(4).fill(Number.POSITIVE_INFINITY);
    const exactMax = new Float64Array(4).fill(Number.NEGATIVE_INFINITY);
    for (let feature = 0; feature < 16; feature++) {
      const point = shape.resolveFeature(feature)!.point;
      for (let axis = 0; axis < 4; axis++) {
        exactMin[axis] = Math.min(exactMin[axis]!, point.data[axis]!);
        exactMax[axis] = Math.max(exactMax[axis]!, point.data[axis]!);
        expect(point.data[axis]!).toBeGreaterThanOrEqual(bounds.min[axis]!);
        expect(point.data[axis]!).toBeLessThanOrEqual(bounds.max[axis]!);
      }
    }
    for (let axis = 0; axis < 4; axis++) {
      expect(bounds.min[axis]!).toBeCloseTo(exactMin[axis]!, 13);
      expect(bounds.max[axis]!).toBeCloseTo(exactMax[axis]!, 13);
      expect(analyticBounds.min[axis]!).toBeCloseTo(bounds.min[axis]!, 13);
      expect(analyticBounds.max[axis]!).toBeCloseTo(bounds.max[axis]!, 13);
    }
    expect(() => supportShapeBoundsN(shape, -1)).toThrow(/padding/);
    expect(() => hyperboxBounds4(shape, -1)).toThrow(/padding/);
  });

  it('encloses every intermediate translate from R1 through R8', () => {
    for (let dim = 1; dim <= 8; dim++) {
      const min = Float64Array.from({ length: dim }, (_, axis) => -axis - 0.5);
      const max = Float64Array.from({ length: dim }, (_, axis) => axis + 1.25);
      const displacement = new VecN(
        Array.from({ length: dim }, (_, axis) => (axis % 2 === 0 ? 1 : -1) * (axis + 2))
      );
      const start = new AxisAlignedBoundsN(min, max);
      const swept = sweptBoundsN(start, displacement);
      for (let sample = 0; sample <= 32; sample++) {
        const time = sample / 32;
        for (let axis = 0; axis < dim; axis++) {
          expect(min[axis]! + displacement.data[axis]! * time)
            .toBeGreaterThanOrEqual(swept.min[axis]!);
          expect(max[axis]! + displacement.data[axis]! * time)
            .toBeLessThanOrEqual(swept.max[axis]!);
        }
      }
    }
    expect(() => sweptBoundsN(
      new AxisAlignedBoundsN([0, 0], [1, 1]),
      [1]
    )).toThrow(/2 finite coordinates/);
    expect(() => sweptBoundsN(
      new AxisAlignedBoundsN([0, 0], [1, 1]),
      [1, Number.NaN]
    )).toThrow(/finite coordinates/);

    const shape = new HyperboxSupportShape4([1, 2, 3, 4]);
    const displacement = new VecN([3, -2, 1, 4]);
    const direct = sweptBoundsN(supportShapeBoundsN(shape, 1e-9), displacement);
    const composed = supportShapeSweptBoundsN(shape, displacement, 1e-9);
    expect(Array.from(composed.min)).toEqual(Array.from(direct.min));
    expect(Array.from(composed.max)).toEqual(Array.from(direct.max));
  });
});

describe('broadphase candidate providers', () => {
  it('keeps exhaustive all-pairs as a canonical golden path', () => {
    const values = [
      proxy('gamma', [10, 0], [11, 1]),
      proxy('alpha', [0, 0], [1, 1]),
      proxy('beta', [5, 0], [6, 1])
    ];
    const result = new AllPairsCandidateProviderN<string>().compute(values);
    expect(pairIds(result.pairs)).toEqual(['alpha/beta', 'alpha/gamma', 'beta/gamma']);
    expect(result.diagnostics).toMatchObject({
      providerId: 'all-pairs',
      possiblePairs: 3,
      candidatePairs: 3,
      rejectedPairs: 0,
      axis: null
    });
  });

  it('rejects on the primary and secondary axes without losing touching pairs', () => {
    const values = [
      proxy('a', [0, 0, 0, 0], [2, 2, 2, 2]),
      proxy('b', [2, 1, 1, 1], [3, 3, 3, 3]),
      proxy('c', [1, 4, 1, 1], [2, 5, 2, 2]),
      proxy('d', [8, 0, 0, 0], [9, 1, 1, 1])
    ];
    const result = new SweepAndPruneCandidateProviderN<string>({ axis: 0 })
      .compute(values);
    expect(pairIds(result.pairs)).toEqual(['a/b']);
    expect(result.diagnostics).toMatchObject({
      possiblePairs: 6,
      candidatePairs: 1,
      rejectedPairs: 5,
      axis: 0
    });
    expect(result.diagnostics.primaryAxisOverlaps).toBeGreaterThan(1);
    expect(result.diagnostics.secondaryAxisTests).toBeGreaterThan(0);
  });

  it('exactly matches brute-force AABB overlap from R1 through R8', () => {
    let state = 0x6d2b79f5;
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    for (let dim = 1; dim <= 8; dim++) {
      for (let sample = 0; sample < 30; sample++) {
        const values = Array.from({ length: 18 }, (_, index) => {
          const min = new Float64Array(dim);
          const max = new Float64Array(dim);
          for (let axis = 0; axis < dim; axis++) {
            min[axis] = random() * 20 - 10;
            max[axis] = min[axis]! + 0.1 + random() * 4;
          }
          return proxy(`p${index.toString().padStart(2, '0')}`, min, max);
        });
        const expected: string[] = [];
        for (let left = 0; left < values.length - 1; left++) {
          for (let right = left + 1; right < values.length; right++) {
            if (values[left]!.bounds.overlaps(values[right]!.bounds)) {
              expected.push(`${values[left]!.id}/${values[right]!.id}`);
            }
          }
        }
        const provider = new SweepAndPruneCandidateProviderN<string>();
        const forward = pairIds(provider.compute(values).pairs);
        provider.reset();
        const reverse = pairIds(provider.compute([...values].reverse()).pairs);
        expect(forward).toEqual(expected);
        expect(reverse).toEqual(expected);
      }
    }
  });

  it('never rejects a continuous N-ball contact from R1 through R8', () => {
    let state = 0x91e10da5;
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    for (let dim = 1; dim <= 8; dim++) {
      for (let scene = 0; scene < 30; scene++) {
        const balls = Array.from({ length: 16 }, (_, index) => {
          const center = Float64Array.from(
            { length: dim },
            () => random() * 30 - 15
          );
          const displacement = Float64Array.from(
            { length: dim },
            () => random() * 12 - 6
          );
          const radius = 0.1 + random() * 1.4;
          const start = new AxisAlignedBoundsN(
            Float64Array.from(center, (coordinate) => coordinate - radius),
            Float64Array.from(center, (coordinate) => coordinate + radius)
          );
          return {
            id: `p${index.toString().padStart(2, '0')}`,
            center,
            displacement,
            radius,
            bounds: sweptBoundsN(start, displacement)
          };
        });
        const result = new SweepAndPruneCandidateProviderN<typeof balls[number]>()
          .compute(balls.map((ball) => ({
            id: ball.id,
            bounds: ball.bounds,
            value: ball
          })));
        const candidates = new Set(pairIds(result.pairs));
        for (let left = 0; left < balls.length - 1; left++) {
          for (let right = left + 1; right < balls.length; right++) {
            const a = balls[left]!;
            const b = balls[right]!;
            let startDotVelocity = 0;
            let velocitySquared = 0;
            for (let axis = 0; axis < dim; axis++) {
              const start = a.center[axis]! - b.center[axis]!;
              const velocity = a.displacement[axis]! - b.displacement[axis]!;
              startDotVelocity += start * velocity;
              velocitySquared += velocity * velocity;
            }
            const time = velocitySquared === 0
              ? 0
              : Math.max(0, Math.min(1, -startDotVelocity / velocitySquared));
            let distanceSquared = 0;
            for (let axis = 0; axis < dim; axis++) {
              const separation =
                a.center[axis]! - b.center[axis]! +
                (a.displacement[axis]! - b.displacement[axis]!) * time;
              distanceSquared += separation * separation;
            }
            const radii = a.radius + b.radius;
            if (distanceSquared <= radii * radii) {
              expect(candidates.has(`${a.id}/${b.id}`)).toBe(true);
            }
          }
        }
      }
    }
  });

  it('reuses coherent primary-axis order and reports adjacent swaps', () => {
    const provider = new SweepAndPruneCandidateProviderN<string>({ axis: 0 });
    const initial = [
      proxy('a', [0, 0], [1, 1]),
      proxy('b', [2, 0], [3, 1]),
      proxy('c', [4, 0], [5, 1])
    ];
    expect(provider.compute(initial).diagnostics.reusedOrder).toBe(false);
    const unchanged = provider.compute([...initial].reverse()).diagnostics;
    expect(unchanged.reusedOrder).toBe(true);
    expect(unchanged.sortSwaps).toBe(0);

    const moved = [
      initial[0]!,
      initial[1]!,
      proxy('c', [-2, 0], [-1, 1])
    ];
    const changed = provider.compute(moved).diagnostics;
    expect(changed.reusedOrder).toBe(true);
    expect(changed.sortSwaps).toBe(2);
    provider.reset();
    expect(provider.compute(moved).diagnostics.reusedOrder).toBe(false);
  });

  it('rejects malformed proxy sets and impossible fixed axes', () => {
    const valid = proxy('valid', [0, 0], [1, 1]);
    expect(() => new AllPairsCandidateProviderN().compute([
      valid,
      { ...valid }
    ])).toThrow(/duplicate/);
    expect(() => new AllPairsCandidateProviderN().compute([
      valid,
      proxy('other', [0, 0, 0], [1, 1, 1])
    ])).toThrow(/dimensions/);
    expect(() => new SweepAndPruneCandidateProviderN({ axis: -1 })).toThrow(/axis/);
    expect(() => new SweepAndPruneCandidateProviderN({ axis: 2 }).compute([valid]))
      .toThrow(/outside R2/);
    const corrupted = proxy('corrupted', [0, 0], [1, 1]);
    corrupted.bounds.min[0] = Number.NaN;
    expect(() => new AllPairsCandidateProviderN().compute([corrupted]))
      .toThrow(/remain finite/);
  });
});

describe('R4 broadphase conservatism', () => {
  it('never rejects an SAT contact across 5,000 full-SO(4) box poses', () => {
    let state = 0x3f1a6b27;
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    const first = new HyperboxSupportShape4([1, 1.2, 0.8, 0.6]);
    const firstBounds = supportShapeBoundsN(first, 1e-12);
    let contacts = 0;
    for (let sample = 0; sample < 5_000; sample++) {
      const second = new HyperboxSupportShape4(
        [0.9, 0.7, 1.1, 0.5],
        new TransformN(
          4,
          Rotor4.fromPlanes(PLANE_PAIRS.map(([i, j]) => ({
            i,
            j,
            angle: (random() * 2 - 1) * Math.PI
          }))),
          new VecN(Array.from({ length: 4 }, () => (random() * 2 - 1) * 3))
        )
      );
      const intersects = hyperboxSat4(first, second).intersects;
      if (intersects) {
        contacts++;
        expect(firstBounds.overlaps(supportShapeBoundsN(second, 1e-12))).toBe(true);
      }
    }
    expect(contacts).toBeGreaterThan(100);
  });
});
