import { describe, expect, it } from 'vitest';
import {
  ConvexWindow,
  FlatN,
  LatticeN,
  ModelSet,
  createFibonacciModelSet,
  fibonacciPatch,
  fibonacciSubstitutionPrefix,
  integerRing,
  phiRing,
  sqrt2Ring,
  type ExactValue
} from '@holotope/core';

const exact = (a: bigint, b = 0n): ExactValue => ({ a, b });

describe('exact ordered rings', () => {
  it('decides signs without Float64 evaluation', () => {
    expect(integerRing.sign(exact(-3n))).toBe(-1);
    expect(sqrt2Ring.sign(exact(-7n, 5n))).toBe(1); // 5sqrt(2) > 7
    expect(sqrt2Ring.sign(exact(7n, -5n))).toBe(-1);
    expect(phiRing.sign(exact(-8n, 5n))).toBe(1); // 5phi > 8
    expect(phiRing.sign(exact(-13n, 8n))).toBe(-1); // 8phi < 13
    expect(phiRing.compare(exact(0n, 1n), exact(1n))).toBe(1);
  });
});

describe('cut-and-project model sets', () => {
  const lattice = LatticeN.integer(integerRing, 1);
  const flat = new FlatN({
    ring: integerRing,
    parallelProjection: [[integerRing.one]],
    perpendicularProjection: [[integerRing.one]]
  });
  const pointWindow = new ConvexWindow(integerRing, 1, [
    { normal: [integerRing.one], bound: integerRing.zero },
    { normal: [integerRing.fromInt(-1)], bound: integerRing.zero }
  ]);

  it('carries lattice coefficients through as exact provenance', () => {
    const point = new ModelSet(lattice, flat, pointWindow, 'include').sample({
      coefficientRanges: [{ min: -2, max: 2 }]
    });
    expect(point.candidateCount).toBe(5);
    expect(point.boundaryCount).toBe(1);
    expect(point.points).toHaveLength(1);
    expect(point.points[0]!.coefficients).toEqual([0n]);
    expect(point.points[0]!.windowLocation).toBe('boundary');
  });

  it('makes singular-cut policy explicit', () => {
    const ranges = { coefficientRanges: [{ min: -1, max: 1 }] } as const;
    expect(new ModelSet(lattice, flat, pointWindow, 'exclude').sample(ranges).points).toHaveLength(0);
    expect(() => new ModelSet(lattice, flat, pointWindow, 'error').sample(ranges)).toThrow(
      /singular cut.*\[0\]/
    );
  });

  it('guards accidental unbounded coefficient-box work', () => {
    const model = new ModelSet(lattice, flat, pointWindow, 'exclude');
    expect(() =>
      model.sample({ coefficientRanges: [{ min: -100, max: 100 }], maxCandidates: 100 })
    ).toThrow(/201 candidates/);
  });
});

describe('Fibonacci model set', () => {
  it('reports both facets of its canonical singular half-open window', () => {
    const patch = createFibonacciModelSet().sample({
      coefficientRanges: [
        { min: -40, max: 40 },
        { min: -40, max: 40 }
      ]
    });
    expect(patch.boundaryCount).toBe(2);
    expect(patch.points.length).toBeGreaterThan(40);
  });

  it('matches the substitution fixed point symbol-for-symbol', () => {
    const patch = fibonacciPatch(144);
    expect(patch.boundaryCount).toBe(2);
    expect(patch.tiles).toEqual(fibonacciSubstitutionPrefix(144));
    expect(patch.points[0]!.parallelExact[0]).toEqual(phiRing.zero);
  });

  it('has exactly two exact tile lengths in golden ratio', () => {
    const patch = fibonacciPatch(89);
    const lengths = new Set<string>();
    for (let i = 0; i < patch.tiles.length; i++) {
      const gap = phiRing.sub(
        patch.points[i + 1]!.parallelExact[0]!,
        patch.points[i]!.parallelExact[0]!
      );
      lengths.add(phiRing.key(gap));
    }
    expect(lengths).toEqual(new Set(['0,1', '1,1'])); // phi and phi^2
  });
});
