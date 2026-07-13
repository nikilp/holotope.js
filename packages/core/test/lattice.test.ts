import { describe, expect, it } from 'vitest';
import {
  createFoldedE8Roots,
  createFoldedE8Shells,
  doubledIcosianNorm,
  e8BaseChange,
  e8IntegerRoots,
  e8IntegerToIcosian,
  e8InnerProduct,
  e8QuadraticNorm,
  e8RootOrbit,
  icosianE8Data,
  icosianToE8Integer
} from '@holotope/core';

const PHI = (1 + Math.sqrt(5)) / 2;

/** Fraction-free determinant, exact for an integer matrix. */
function determinant(matrix: readonly (readonly bigint[])[]): bigint {
  const a = matrix.map((row) => row.slice());
  let previous = 1n;
  let sign = 1n;
  for (let k = 0; k < a.length - 1; k++) {
    let pivot = k;
    while (pivot < a.length && a[pivot]![k] === 0n) pivot++;
    if (pivot === a.length) return 0n;
    if (pivot !== k) {
      [a[k], a[pivot]] = [a[pivot]!, a[k]!];
      sign = -sign;
    }
    const pivotValue = a[k]![k]!;
    for (let i = k + 1; i < a.length; i++) {
      for (let j = k + 1; j < a.length; j++) {
        a[i]![j] = (a[i]![j]! * pivotValue - a[i]![k]! * a[k]![j]!) / previous;
      }
    }
    previous = pivotValue;
  }
  return sign * a[a.length - 1]![a.length - 1]!;
}

describe('E8 root system', () => {
  it('the rank-8 Coxeter orbit visits exactly 240 roots without enumerating W(E8)', () => {
    const roots = e8RootOrbit();
    expect(roots).toHaveLength(240);
    expect(new Set(roots.map((root) => root.map((x) => `${x.a},${x.b}`).join('|'))).size).toBe(240);
  });

  it('the icosian model has two exact norm-2 shells', () => {
    const data = icosianE8Data();
    expect(data.roots).toHaveLength(240);
    expect(data.shells.slice(0, 120).every((shell) => shell === 'unit')).toBe(true);
    expect(data.shells.slice(120).every((shell) => shell === 'conjugate')).toBe(true);
    for (let i = 0; i < 240; i++) {
      expect(e8QuadraticNorm(data.roots[i]!)).toBe(2n);
      const norm = doubledIcosianNorm(data.roots[i]!);
      expect(norm).toEqual(i < 120 ? { a: 4n, b: 0n } : { a: 8n, b: -4n });
    }
  });

  it('has the E8 inner-product spectrum and 6720 minimal pairs', () => {
    const data = icosianE8Data();
    const spectrum = new Map<bigint, number>();
    for (const root of data.roots) {
      const inner = e8InnerProduct(data.roots[0]!, root);
      spectrum.set(inner, (spectrum.get(inner) ?? 0) + 1);
    }
    expect([...spectrum.entries()].sort(([a], [b]) => Number(b - a))).toEqual([
      [2n, 1],
      [1n, 56],
      [0n, 126],
      [-1n, 56],
      [-2n, 1]
    ]);
    expect(data.edges.length / 2).toBe(6720);
    expect(data.parallelMetricSkeletonEdges.length / 2).toBe(1440);
    expect(data.perpendicularMetricSkeletonEdges.length / 2).toBe(1440);
    expect(data.parallelSkeletonEdges.length / 2).toBe(720);
    expect(data.perpendicularSkeletonEdges.length / 2).toBe(720);
    expect(data.chordEdges.length / 2).toBe(2400);
    expect(data.strutEdges.length / 2).toBe(2880);
  });

  it('contains an even unimodular rank-8 root basis', () => {
    const roots = icosianE8Data().roots;
    // A fixed root basis in the deterministic construction order. Keeping
    // this explicit makes the determinant check reproducible and wholly
    // independent of a floating rank heuristic.
    const selected = [98, 120, 226, 3, 59, 188, 63, 167].map((i) => roots[i]!);
    const gram = selected.map((left) => selected.map((right) => e8InnerProduct(left, right)));
    expect(gram.map((row, i) => row[i])).toEqual(Array<bigint>(8).fill(2n));
    expect(determinant(gram)).toBe(1n);
  });

  it('maps bijectively to the standard integer-coordinate roots', () => {
    const icosians = icosianE8Data().roots;
    const standard = e8IntegerRoots();
    const standardKeys = new Set(standard.map((root) => root.join(',')));
    const mapped = icosians.map(icosianToE8Integer);
    expect(standard).toHaveLength(240);
    expect(new Set(mapped.map((root) => root.join(','))).size).toBe(240);
    expect(mapped.every((root) => standardKeys.has(root.join(',')))).toBe(true);
    for (let i = 0; i < 240; i++) {
      expect(e8IntegerToIcosian(mapped[i]!)).toEqual(icosians[i]);
    }
    expect(e8BaseChange.integerToIcosianDenominator).toBe(2n);
    expect(() => e8IntegerToIcosian([1n, 0n, 0n, 0n, 0n, 0n, 0n, 0n])).toThrow(
      /parity/
    );
  });

  it('the two embeddings exchange the large and small 600-cell shells', () => {
    const data = icosianE8Data();
    const radius = (positions: Float64Array, vertex: number): number =>
      Math.hypot(...positions.subarray(vertex * 4, vertex * 4 + 4));
    expect(radius(data.parallelPositions, 0)).toBeCloseTo(1, 12);
    expect(radius(data.parallelPositions, 120)).toBeCloseTo(1 / PHI, 12);
    expect(radius(data.perpendicularPositions, 0)).toBeCloseTo(1, 12);
    expect(radius(data.perpendicularPositions, 120)).toBeCloseTo(PHI, 12);

    for (const [positions, edges] of [
      [data.parallelPositions, data.parallelMetricSkeletonEdges],
      [data.perpendicularPositions, data.perpendicularMetricSkeletonEdges]
    ] as const) {
      const degree = new Uint8Array(240);
      for (let e = 0; e < edges.length; e += 2) {
        const a = edges[e]!;
        const b = edges[e + 1]!;
        degree[a]!++;
        degree[b]!++;
        let distanceSquared = 0;
        for (let c = 0; c < 4; c++) {
          const delta = positions[a * 4 + c]! - positions[b * 4 + c]!;
          distanceSquared += delta * delta;
        }
        expect(Math.sqrt(distanceSquared)).toBeCloseTo(radius(positions, a) / PHI, 10);
      }
      expect([...degree].every((value) => value === 12)).toBe(true);
    }
  });

  it('builds renderable views with edge-class selection', () => {
    const all = createFoldedE8Roots();
    expect(all.ambientDim).toBe(4);
    expect(all.vertexCount).toBe(240);
    expect(all.cellCount(1)).toBe(6720);
    const skeleton = createFoldedE8Roots({
      embedding: 'perpendicular',
      edgeClasses: ['perpendicular-skeleton'],
      scale: 2
    });
    expect(skeleton.cellCount(1)).toBe(720);
    expect(createFoldedE8Shells({ embedding: 'perpendicular' }).cellCount(1)).toBe(1440);
    expect(() => createFoldedE8Roots({ scale: 0 })).toThrow(/positive/);
  });
});
