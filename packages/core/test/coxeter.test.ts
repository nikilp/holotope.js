import { describe, expect, it } from 'vitest';
import {
  CoxeterRealization,
  coxeterA3,
  coxeterA4,
  coxeterB3,
  coxeterB4,
  coxeterD4,
  coxeterF4,
  coxeterH3,
  coxeterH4,
  coxeterI2,
  createCoxeterDiagram,
  enumerateCoxeterAction,
  orbitDistanceTuples,
  realizeOrbit,
  wythoffSeed,
  type CoxeterAction,
  type CoxeterDiagram
} from '@holotope/core';

const ALL_DIAGRAMS: Array<[string, () => CoxeterDiagram]> = [
  ['I2(4)', () => coxeterI2(4)],
  ['I2(5)', () => coxeterI2(5)],
  ['A3', coxeterA3],
  ['B3', coxeterB3],
  ['H3', coxeterH3],
  ['A4', coxeterA4],
  ['B4', coxeterB4],
  ['D4', coxeterD4],
  ['F4', coxeterF4],
  ['H4', coxeterH4]
];

// Exact chamber enumeration is deterministic and immutable. Reuse it across
// the independent relation checks so a loaded CI runner does not repeat the
// 14,400-element H4 breadth-first search four times in one test file.
const actionCache = new Map<string, CoxeterAction>();

function actionFor(name: string, make: () => CoxeterDiagram): CoxeterAction {
  let action = actionCache.get(name);
  if (!action) {
    action = enumerateCoxeterAction(make());
    actionCache.set(name, action);
  }
  return action;
}

/** g·(sᵢsⱼ)^m as chamber IDs, using only the transition table. */
function applyBraid(action: CoxeterAction, g: number, i: number, j: number, m: number): number {
  let x = g;
  for (let k = 0; k < m; k++) {
    x = action.rightMultiply[x * action.rank + i]!;
    x = action.rightMultiply[x * action.rank + j]!;
  }
  return x;
}

describe('enumerateCoxeterAction', () => {
  it.each(ALL_DIAGRAMS)('%s enumerates exactly its group order', (name, make) => {
    const diagram = make();
    // The order check is built into enumeration; reaching here means the
    // exact BFS produced neither duplicates nor phantoms.
    expect(actionFor(name, make).order).toBe(diagram.order);
  });

  it.each(ALL_DIAGRAMS)('%s: sᵢ² = e as a permutation of all chambers', (name, make) => {
    const action = actionFor(name, make);
    for (let g = 0; g < action.order; g++) {
      for (let i = 0; i < action.rank; i++) {
        const gi = action.rightMultiply[g * action.rank + i]!;
        expect(action.rightMultiply[gi * action.rank + i]).toBe(g);
        expect(action.parity[gi]).toBe(-action.parity[g]!);
      }
    }
  });

  it.each(ALL_DIAGRAMS)('%s: (sᵢsⱼ)^m(i,j) = e as a permutation of all chambers', (name, make) => {
    const diagram = make();
    const action = actionFor(name, make);
    for (let i = 0; i < diagram.rank; i++) {
      for (let j = i + 1; j < diagram.rank; j++) {
        const m = diagram.matrix[i]![j]!;
        for (let g = 0; g < action.order; g++) {
          expect(applyBraid(action, g, i, j, m)).toBe(g);
        }
      }
    }
  });

  it('BFS tree reaches every element from the identity', () => {
    const action = actionFor('H4', coxeterH4);
    for (let g = 1; g < action.order; g++) {
      // Walk parents to the identity; word length is bounded by the
      // longest element of H4 (60 reflections).
      let steps = 0;
      for (let x = g; x !== 0 && steps <= 60; x = action.parent[x]!) steps++;
      expect(steps).toBeLessThanOrEqual(60);
    }
  });
});

describe('orbitDistanceTuples (Wythoff vertex counts)', () => {
  const cases: Array<[string, () => CoxeterDiagram, boolean[], number]> = [
    // H3: ringing the node on the 5-link end gives the dodecahedron,
    // the far end the icosahedron, the middle the icosidodecahedron
    // (as vertex counts of x{5,3} / o{5,3}x / rectifications).
    ['H3 dodecahedron', coxeterH3, [true, false, false], 20],
    ['H3 icosahedron', coxeterH3, [false, false, true], 12],
    ['H3 icosidodecahedron', coxeterH3, [false, true, false], 30],
    ['B3 cube', coxeterB3, [false, false, true], 8],
    ['B3 octahedron', coxeterB3, [true, false, false], 6],
    ['B3 cuboctahedron', coxeterB3, [false, true, false], 12],
    ['A3 tetrahedron', coxeterA3, [true, false, false], 4],
    ['A3 octahedron (rectified)', coxeterA3, [false, true, false], 6],
    ['A3 omnitruncated', coxeterA3, [true, true, true], 24],
    ['A4 5-cell', coxeterA4, [true, false, false, false], 5],
    ['A4 omnitruncated', coxeterA4, [true, true, true, true], 120],
    ['B4 tesseract', coxeterB4, [false, false, false, true], 16],
    ['B4 16-cell', coxeterB4, [true, false, false, false], 8],
    ['F4 24-cell', coxeterF4, [true, false, false, false], 24],
    ['H4 600-cell', coxeterH4, [false, false, false, true], 120],
    ['H4 120-cell', coxeterH4, [true, false, false, false], 600]
  ];

  it.each(cases)('%s has the catalog vertex count', (_, make, rings, expected) => {
    const diagram = make();
    const orbit = orbitDistanceTuples(diagram, wythoffSeed(diagram, rings));
    expect(orbit.length).toBe(expected);
  });
});

describe('CoxeterRealization', () => {
  it('Cholesky factor reproduces the Gram matrix', () => {
    for (const [, make] of ALL_DIAGRAMS) {
      const diagram = make();
      const n = diagram.rank;
      const L = new CoxeterRealization(diagram).choleskyL;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          let acc = 0;
          for (let k = 0; k < n; k++) acc += L[i * n + k]! * L[j * n + k]!;
          const expected = i === j ? 1 : -Math.cos(Math.PI / diagram.matrix[i]![j]!);
          expect(acc).toBeCloseTo(expected, 12);
        }
      }
    }
  });

  it('realized orbits are equidistant from the origin (uniformity)', () => {
    const diagram = coxeterH3();
    const orbit = orbitDistanceTuples(diagram, wythoffSeed(diagram, [true, false, false]));
    const positions = realizeOrbit(diagram, orbit);
    const r0 = Math.hypot(positions[0]!, positions[1]!, positions[2]!);
    expect(r0).toBeGreaterThan(0);
    for (let p = 1; p < orbit.length; p++) {
      const r = Math.hypot(positions[p * 3]!, positions[p * 3 + 1]!, positions[p * 3 + 2]!);
      expect(r).toBeCloseTo(r0, 10);
    }
  });

  it('generator edges of the omnitruncate have exact length 2', () => {
    // Seed at distance 1 from every mirror: |sᵢ(x) − x| = 2·dᵢ = 2.
    const diagram = coxeterA3();
    const realization = new CoxeterRealization(diagram);
    const seed = [1, 1, 1];
    const x = realization.realizeDistances(seed);
    for (let i = 0; i < 3; i++) {
      const reflected = seed.slice();
      for (let j = 0; j < 3; j++) {
        reflected[j]! -= (j === i ? 2 : -Math.cos(Math.PI / diagram.matrix[j]![i]!) * 2) * seed[i]!;
      }
      const y = realization.realizeDistances(reflected);
      const len = Math.hypot(y[0]! - x[0]!, y[1]! - x[1]!, y[2]! - x[2]!);
      expect(len).toBeCloseTo(2, 12);
    }
  });
});

describe('createCoxeterDiagram validation', () => {
  it('rejects marks outside 2…5 and mixed radicals', () => {
    expect(() => createCoxeterDiagram('bad', [[1, 6], [6, 1]], 12)).toThrow(/unsupported/);
    expect(() =>
      createCoxeterDiagram('mixed', [[1, 4, 2], [4, 1, 5], [2, 5, 1]], 0)
    ).toThrow(/unsupported|ℤ/);
  });

  it('rejects a wrong declared order', () => {
    expect(() => enumerateCoxeterAction(createCoxeterDiagram('A2?', [[1, 3], [3, 1]], 7))).toThrow(
      /expected 7/
    );
  });
});
