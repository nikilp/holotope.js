import { describe, expect, it } from 'vitest';
import {
  ConvexWindow,
  FlatN,
  LatticeN,
  ModelSet,
  createAKNModelSet,
  createAmmannBeenkerModelSet,
  createElserSloaneModelSet,
  createFibonacciModelSet,
  integerRing,
  type CoefficientRange,
  type ModelSetPatch
} from '@holotope/core';

function expectSameSample(pruned: ModelSetPatch, box: ModelSetPatch): void {
  expect(pruned.candidateCount).toBe(box.candidateCount);
  expect(pruned.boundaryCount).toBe(box.boundaryCount);
  expect(pruned.points).toEqual(box.points);
  expect(box.enumeration).toBeUndefined();
  expect(pruned.enumeration?.strategy).toBe('window-pruned');
}

function zeroWindow(dim: number): ConvexWindow {
  const halfspaces = [];
  for (let axis = 0; axis < dim; axis++) {
    const positive = Array.from({ length: dim }, (_, i) =>
      integerRing.fromInt(i === axis ? 1 : 0)
    );
    halfspaces.push(
      { normal: positive, bound: integerRing.zero },
      { normal: positive.map((value) => integerRing.neg(value)), bound: integerRing.zero }
    );
  }
  return new ConvexWindow(integerRing, dim, halfspaces);
}

describe('exact window-pruned model-set enumeration', () => {
  it('differentially matches every shipped single-window scheme', () => {
    const cases: ReadonlyArray<{
      readonly model: ModelSet;
      readonly coefficientRanges: readonly CoefficientRange[];
    }> = [
      {
        model: createFibonacciModelSet(),
        coefficientRanges: [
          { min: -5, max: 4 },
          { min: -3, max: 6 }
        ]
      },
      {
        model: createAmmannBeenkerModelSet(),
        coefficientRanges: [
          { min: -2, max: 1 },
          { min: -1, max: 2 },
          { min: -2, max: 2 },
          { min: 0, max: 3 }
        ]
      },
      {
        model: createAKNModelSet(),
        coefficientRanges: Array.from({ length: 6 }, () => ({ min: -1, max: 1 }))
      },
      {
        model: createElserSloaneModelSet(),
        coefficientRanges: Array.from({ length: 8 }, (_, axis) => ({
          min: axis % 2 === 0 ? -1 : 0,
          max: axis % 3 === 0 ? 1 : 0
        }))
      }
    ];

    for (const { model, coefficientRanges } of cases) {
      const box = model.sample({ coefficientRanges });
      const pruned = model.sample({
        coefficientRanges,
        strategy: 'window-pruned'
      });
      expectSameSample(pruned, box);
    }
  });

  it('includes lattice bases, offsets, denominators, and asymmetric ranges in the bound', () => {
    const latticeBasis = [
      [integerRing.fromInt(2), integerRing.one],
      [integerRing.fromInt(-1), integerRing.fromInt(2)]
    ] as const;
    const lattice = new LatticeN(integerRing, latticeBasis);
    const flat = new FlatN({
      ring: integerRing,
      parallelProjection: [
        [integerRing.one, integerRing.zero],
        [integerRing.zero, integerRing.one]
      ],
      perpendicularProjection: [[integerRing.one, integerRing.fromInt(-1)]],
      parallelOffset: [integerRing.fromInt(3), integerRing.fromInt(-2)],
      perpendicularOffset: [integerRing.fromInt(2)],
      parallelDenominator: 3n,
      perpendicularDenominator: 2n
    });
    const window = new ConvexWindow(integerRing, 1, [
      { normal: [integerRing.one], bound: integerRing.fromInt(4) },
      { normal: [integerRing.fromInt(-1)], bound: integerRing.fromInt(3) }
    ]);
    const ranges = [
      { min: -3n, max: 2n },
      { min: 1n, max: 4n }
    ] as const;
    const rangesBefore = ranges.map((range) => ({ ...range }));
    const model = new ModelSet(lattice, flat, window, 'include');

    const box = model.sample({ coefficientRanges: ranges });
    const pruned = model.sample({
      coefficientRanges: ranges,
      strategy: 'window-pruned'
    });

    expectSameSample(pruned, box);
    expect(ranges).toEqual(rangesBefore);
    expect(lattice.basis).toEqual(latticeBasis);
    expect(flat.perpendicularOffset).toEqual([integerRing.fromInt(2)]);
    expect(window.halfspaces).toHaveLength(2);
  });

  it('preserves global and per-facet boundary decisions, including corners', () => {
    const lattice = LatticeN.integer(integerRing, 2);
    const flat = new FlatN({
      ring: integerRing,
      parallelProjection: [
        [integerRing.one, integerRing.zero],
        [integerRing.zero, integerRing.one]
      ],
      perpendicularProjection: [
        [integerRing.one, integerRing.zero],
        [integerRing.zero, integerRing.one]
      ]
    });
    const ranges = {
      coefficientRanges: [
        { min: -1, max: 1 },
        { min: -1, max: 1 }
      ]
    } as const;
    const window = zeroWindow(2);

    for (const policy of ['include', 'exclude'] as const) {
      const model = new ModelSet(lattice, flat, window, policy);
      const box = model.sample(ranges);
      const pruned = model.sample({ ...ranges, strategy: 'window-pruned' });
      expectSameSample(pruned, box);
    }

    const refusing = new ModelSet(lattice, flat, window, 'error');
    expect(() => refusing.sample(ranges)).toThrow(/singular cut.*\[0,0\]/);
    expect(() => refusing.sample({ ...ranges, strategy: 'window-pruned' })).toThrow(
      /singular cut.*\[0,0\]/
    );

    const explicitCornerExclusion = new ConvexWindow(integerRing, 2, [
      {
        normal: [integerRing.one, integerRing.zero],
        bound: integerRing.zero,
        boundary: 'include'
      },
      {
        normal: [integerRing.fromInt(-1), integerRing.zero],
        bound: integerRing.zero,
        boundary: 'include'
      },
      {
        normal: [integerRing.zero, integerRing.one],
        bound: integerRing.zero,
        boundary: 'exclude'
      },
      {
        normal: [integerRing.zero, integerRing.fromInt(-1)],
        bound: integerRing.zero,
        boundary: 'include'
      }
    ]);
    const explicit = new ModelSet(lattice, flat, explicitCornerExclusion, 'error');
    const box = explicit.sample(ranges);
    const pruned = explicit.sample({ ...ranges, strategy: 'window-pruned' });
    expectSameSample(pruned, box);
    expect(pruned.boundaryCount).toBe(1);
    expect(pruned.points).toHaveLength(0);
  });

  it('crosses the box cap safely when exact prefixes collapse the search', () => {
    const dim = 6;
    const model = new ModelSet(
      LatticeN.integer(integerRing, dim),
      new FlatN({
        ring: integerRing,
        parallelProjection: Array.from({ length: dim }, (_, row) =>
          Array.from({ length: dim }, (_, column) =>
            integerRing.fromInt(row === column ? 1 : 0)
          )
        ),
        perpendicularProjection: Array.from({ length: dim }, (_, row) =>
          Array.from({ length: dim }, (_, column) =>
            integerRing.fromInt(row === column ? 1 : 0)
          )
        )
      }),
      zeroWindow(dim),
      'include'
    );
    const coefficientRanges = Array.from({ length: dim }, () => ({ min: -5, max: 5 }));

    expect(() => model.sample({ coefficientRanges })).toThrow(/1771561 candidates/);
    const patch = model.sample({
      coefficientRanges,
      strategy: 'window-pruned',
      maxTraversalNodes: 100
    });
    expect(patch.candidateCount).toBe(1_771_561);
    expect(patch.points.map((point) => point.coefficients)).toEqual([
      [0n, 0n, 0n, 0n, 0n, 0n]
    ]);
    expect(
      patch.enumeration!.visitedNodes + patch.enumeration!.prunedSubtrees
    ).toBeLessThan(100);
  });

  it('enforces a traversal budget that also counts rejected subtree roots', () => {
    const model = new ModelSet(
      LatticeN.integer(integerRing, 1),
      new FlatN({
        ring: integerRing,
        parallelProjection: [[integerRing.one]],
        perpendicularProjection: [[integerRing.one]]
      }),
      zeroWindow(1),
      'include'
    );
    expect(() =>
      model.sample({
        coefficientRanges: [{ min: -1_000_000n, max: 1_000_000n }],
        strategy: 'window-pruned',
        maxTraversalNodes: 8
      })
    ).toThrow(/exhausted node budget 8/);
  });

  it('rejects invalid strategy and incompatible budgets for JavaScript callers', () => {
    const model = createFibonacciModelSet();
    const coefficientRanges = [
      { min: -1, max: 1 },
      { min: -1, max: 1 }
    ] as const;

    expect(() =>
      model.sample({ coefficientRanges, strategy: 'guess' } as never)
    ).toThrow(/invalid strategy guess/);
    expect(() =>
      model.sample({ coefficientRanges, maxTraversalNodes: 5 } as never)
    ).toThrow(/maxTraversalNodes requires/);
    expect(() =>
      model.sample({
        coefficientRanges,
        strategy: 'window-pruned',
        maxCandidates: 5
      } as never)
    ).toThrow(/maxCandidates is only valid/);
    expect(() =>
      model.sample({
        coefficientRanges,
        strategy: 'window-pruned',
        maxTraversalNodes: 0
      })
    ).toThrow(/invalid maxTraversalNodes 0/);
  });

  it('materially prunes the fixed AKN radius-two coefficient box', () => {
    const coefficientRanges = Array.from({ length: 6 }, () => ({ min: -2, max: 2 }));
    const model = createAKNModelSet();
    const box = model.sample({ coefficientRanges });
    const pruned = model.sample({
      coefficientRanges,
      strategy: 'window-pruned'
    });

    expectSameSample(pruned, box);
    expect(pruned.candidateCount).toBe(15_625);
    expect(pruned.points).toHaveLength(1_117);
    expect(
      pruned.enumeration!.visitedNodes + pruned.enumeration!.prunedSubtrees
    ).toBeLessThan(pruned.candidateCount);
  });
});
