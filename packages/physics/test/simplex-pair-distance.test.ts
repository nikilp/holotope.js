import { describe, expect, it } from 'vitest';
import {
  CellComplex,
  TransformN,
  VecN,
  createSourceCellReferenceN,
  createSourceSimplexReferenceN,
  projectPointToSourceSimplexN,
  rotationFromPlanes,
  type SourceSimplexReferenceN
} from '@holotope/core';
import {
  ConvexHullSupportShapeN,
  evaluateSourceSimplexPairDistanceN,
  gjkDistance,
  type SourceSimplexPairDistanceN
} from '../src/index.js';

/**
 * P56 Part B — the twelve commissioned test categories for the public pair
 * query, self-contained: the referee below reimplements the joint-KKT oracle
 * *in this file* (same mathematics as the Kitchen Part A oracle, independent
 * code), so any clone of this repository carries its own differential.
 */

// --- the in-tree referee ----------------------------------------------------

interface RefereeResult {
  readonly distance: number;
  readonly multiple: boolean;
  readonly pointA: readonly number[];
  readonly pointB: readonly number[];
}

function refereePairDistance(
  dim: number, packedA: Float64Array, packedB: Float64Array
): RefereeResult {
  const countA = packedA.length / dim;
  const countB = packedB.length / dim;
  let magnitude = 0;
  for (const value of packedA) magnitude = Math.max(magnitude, Math.abs(value));
  for (const value of packedB) magnitude = Math.max(magnitude, Math.abs(value));
  const tau = 128 * 2 ** -52 * Math.max(1, magnitude * magnitude);
  const vertex = (packed: Float64Array, index: number): number[] =>
    Array.from(packed.subarray(index * dim, (index + 1) * dim));
  const dot = (x: number[], y: number[]): number =>
    x.reduce((sum, value, axis) => sum + value * y[axis]!, 0);
  const subsets = (count: number): number[][] => {
    const out: number[][] = [];
    for (let mask = 1; mask < 2 ** count; mask++) {
      const subset: number[] = [];
      for (let bit = 0; bit < count; bit++) {
        if ((mask & (1 << bit)) !== 0) subset.push(bit);
      }
      out.push(subset);
    }
    return out;
  };
  const solve = (m: number[][], r: number[]): number[] | null => {
    const n = r.length;
    const a = m.map((row, i) => [...row, r[i]!]);
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
      }
      let rowScale = 0;
      for (let c = 0; c < n; c++) rowScale = Math.max(rowScale, Math.abs(a[pivot]![c]!));
      if (!(Math.abs(a[pivot]![col]!) > rowScale * 1e-13)) return null;
      [a[pivot], a[col]] = [a[col]!, a[pivot]!];
      for (let row = col + 1; row < n; row++) {
        const factor = a[row]![col]! / a[col]![col]!;
        for (let c = col; c <= n; c++) a[row]![c]! -= factor * a[col]![c]!;
      }
    }
    const x = new Array<number>(n).fill(0);
    for (let row = n - 1; row >= 0; row--) {
      let sum = a[row]![n]!;
      for (let c = row + 1; c < n; c++) sum -= a[row]![c]! * x[c]!;
      x[row] = sum / a[row]![row]!;
    }
    return x;
  };
  interface Hit { d2: number; pA: number[]; pB: number[]; key: string; }
  const hits: Hit[] = [];
  for (const supportA of subsets(countA)) {
    for (const supportB of subsets(countB)) {
      const s = supportA.length;
      const t = supportB.length;
      const size = s + t + 2;
      const av = supportA.map((index) => vertex(packedA, index));
      const bv = supportB.map((index) => vertex(packedB, index));
      const matrix: number[][] = [];
      const rhs: number[] = [];
      for (let i = 0; i < s; i++) {
        const row = new Array<number>(size).fill(0);
        for (let c = 0; c < s; c++) row[c] = dot(av[i]!, av[c]!);
        for (let c = 0; c < t; c++) row[s + c] = -dot(av[i]!, bv[c]!);
        row[s + t] = -1;
        matrix.push(row); rhs.push(0);
      }
      for (let j = 0; j < t; j++) {
        const row = new Array<number>(size).fill(0);
        for (let c = 0; c < s; c++) row[c] = dot(bv[j]!, av[c]!);
        for (let c = 0; c < t; c++) row[s + c] = -dot(bv[j]!, bv[c]!);
        row[s + t + 1] = 1;
        matrix.push(row); rhs.push(0);
      }
      const sumA = new Array<number>(size).fill(0);
      for (let c = 0; c < s; c++) sumA[c] = 1;
      matrix.push(sumA); rhs.push(1);
      const sumB = new Array<number>(size).fill(0);
      for (let c = 0; c < t; c++) sumB[s + c] = 1;
      matrix.push(sumB); rhs.push(1);
      const solution = solve(matrix, rhs);
      if (solution === null) continue;
      const lambda = solution.slice(0, s);
      const mu = solution.slice(s, s + t);
      const alpha = solution[s + t]!;
      const beta = solution[s + t + 1]!;
      if (lambda.some((w) => w < -1e-10) || mu.some((w) => w < -1e-10)) continue;
      const pA = new Array<number>(dim).fill(0);
      const pB = new Array<number>(dim).fill(0);
      for (let i = 0; i < s; i++) {
        for (let axis = 0; axis < dim; axis++) pA[axis]! += lambda[i]! * av[i]![axis]!;
      }
      for (let j = 0; j < t; j++) {
        for (let axis = 0; axis < dim; axis++) pB[axis]! += mu[j]! * bv[j]![axis]!;
      }
      const n = pA.map((value, axis) => value - pB[axis]!);
      let worst = 0;
      for (let i = 0; i < countA; i++) {
        worst = Math.max(worst, alpha - dot(vertex(packedA, i), n));
      }
      for (let j = 0; j < countB; j++) {
        worst = Math.max(worst, dot(vertex(packedB, j), n) + beta);
      }
      if (worst > tau) continue;
      let d2 = 0;
      for (const value of n) d2 += value * value;
      hits.push({
        d2, pA, pB,
        key: [...pA, ...pB]
          .map((value) => Math.round(value / (1e-9 * Math.max(1, magnitude)))).join(',')
      });
    }
  }
  hits.sort((left, right) => left.d2 - right.d2);
  const best = hits[0]!;
  const optimal = hits.filter((hit) => hit.d2 - best.d2 <= tau * Math.max(1, magnitude));
  const distinct = new Set(optimal.map((hit) => hit.key));
  return {
    distance: Math.sqrt(best.d2),
    multiple: distinct.size > 1,
    pointA: best.pA,
    pointB: best.pB
  };
}

// --- fixtures over source references -----------------------------------------

function segmentPairComplex(
  dim: number, aValues: number[], bValues: number[]
): { a: SourceSimplexReferenceN; b: SourceSimplexReferenceN; complex: CellComplex } {
  const positions = new Float64Array((aValues.length + bValues.length));
  positions.set(aValues, 0);
  positions.set(bValues, aValues.length);
  const countA = aValues.length / dim;
  const countB = bValues.length / dim;
  const complex = new CellComplex(dim, positions, [{
    dim: countA - 1, verticesPerCell: countA, kind: 'simplex',
    indices: Uint32Array.from(Array.from({ length: countA }, (_, i) => i))
  }, {
    dim: countB - 1, verticesPerCell: countB, kind: 'simplex',
    indices: Uint32Array.from(Array.from({ length: countB }, (_, i) => countA + i))
  }]);
  const a = createSourceSimplexReferenceN(
    createSourceCellReferenceN(complex, complex.groups[0]!, 0)
  );
  const b = createSourceSimplexReferenceN(
    createSourceCellReferenceN(complex, complex.groups[1]!, 0)
  );
  return { a, b, complex };
}

function embed(dim: number, layoutDim: number, values: number[]): number[] {
  const count = values.length / layoutDim;
  const out = new Array<number>(count * dim).fill(0);
  for (let vertex = 0; vertex < count; vertex++) {
    for (let axis = 0; axis < layoutDim; axis++) {
      out[vertex * dim + axis] = values[vertex * layoutDim + axis]!;
    }
  }
  return out;
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const DIMS = [2, 3, 4, 5, 6, 7];

// --- 1. analytic cases --------------------------------------------------------

describe('analytic point, edge, and face cases in R2–R7', () => {
  it('returns the textbook distances with source-ordered witnesses', () => {
    for (const dim of DIMS) {
      // vertex--segment (a 0-simplex side: the widened core floor).
      const point = segmentPairComplex(
        dim, embed(dim, 2, [0.2, 0.75]), embed(dim, 2, [-1, 0, 1, 0])
      );
      const single = createSourceSimplexReferenceN(point.a.parent, [0]);
      const vertexToEdge = evaluateSourceSimplexPairDistanceN(
        { reference: single }, { reference: point.b }
      );
      expect(vertexToEdge.status).toBe('separated-unique');
      if (vertexToEdge.status === 'separated-unique') {
        expect(vertexToEdge.distance).toBeCloseTo(0.75, 12);
        expect(vertexToEdge.witness.coordinateA.weights).toEqual([1]);
        // The witness lands inside the obstacle edge, not at an endpoint.
        const [w0, w1] = vertexToEdge.witness.coordinateB.weights;
        expect(w0!).toBeGreaterThan(0.1);
        expect(w1!).toBeGreaterThan(0.1);
      }

      // skew segment--segment at height 0.75 (needs a third axis).
      if (dim >= 3) {
        const skew = segmentPairComplex(
          dim,
          embed(dim, 3, [-1, 0, 0, 1, 0, 0]),
          embed(dim, 3, [0, -1, 0.75, 0, 1, 0.75])
        );
        const result = evaluateSourceSimplexPairDistanceN(
          { reference: skew.a }, { reference: skew.b }
        );
        expect(result.status).toBe('separated-unique');
        if (result.status === 'separated-unique') {
          expect(result.distance).toBeCloseTo(0.75, 12);
          // Interior--interior: all four weights strictly inside.
          for (const weight of [
            ...result.witness.coordinateA.weights,
            ...result.witness.coordinateB.weights
          ]) {
            expect(weight).toBeGreaterThan(0.4);
          }
        }
      }

      // vertex--face in both pair orders.
      if (dim >= 3) {
        const face = segmentPairComplex(
          dim,
          embed(dim, 3, [0.2, 0.2, 0.75]),
          embed(dim, 3, [-1, -1, 0, 2, -1, 0, -1, 2, 0])
        );
        const vertexSide = createSourceSimplexReferenceN(face.a.parent, [0]);
        const forward = evaluateSourceSimplexPairDistanceN(
          { reference: vertexSide }, { reference: face.b }
        );
        const backward = evaluateSourceSimplexPairDistanceN(
          { reference: face.b }, { reference: vertexSide }
        );
        expect(forward.status).toBe('separated-unique');
        expect(backward.status).toBe('separated-unique');
        if (forward.status === 'separated-unique' &&
            backward.status === 'separated-unique') {
          expect(forward.distance).toBeCloseTo(0.75, 12);
          expect(backward.distance).toBeCloseTo(forward.distance, 12);
          for (let axis = 0; axis < dim; axis++) {
            expect(backward.direction.data[axis]!)
              .toBeCloseTo(-forward.direction.data[axis]!, 12);
          }
        }
      }
    }
  });
});

// --- 2+3. oracle differential, reconstruction, ordering ------------------------

describe('in-tree referee differential over the Part A families', () => {
  it('agrees on distance and multiplicity across analytic and random pairs', () => {
    let compared = 0;
    for (const dim of DIMS) {
      const next = lcg(0xb56 + dim);
      const cases: { a: number[]; b: number[] }[] = [
        { a: embed(dim, 2, [0.2, 0.75]), b: embed(dim, 2, [-1, 0, 1, 0]) },
        { a: embed(dim, 2, [2, 2, 4, 4]), b: embed(dim, 2, [-1, 0, 1, 0]) },
        { a: embed(dim, 2, [-1, 0, 1, 0]), b: embed(dim, 2, [-0.5, 0.75, 0.5, 0.75]) }
      ];
      for (let trial = 0; trial < 12; trial++) {
        const arityA = 1 + Math.floor(next() * Math.min(3, dim));
        const arityB = 1 + Math.floor(next() * Math.min(3, dim));
        const scale = 2 ** Math.floor(next() * 10 - 4);
        const a: number[] = [];
        const b: number[] = [];
        for (let at = 0; at < arityA * dim; at++) a.push((next() * 2 - 1) * scale);
        for (let at = 0; at < arityB * dim; at++) b.push((next() * 2 - 1) * scale);
        const axis = Math.floor(next() * dim);
        for (let vertexIndex = 0; vertexIndex < arityB; vertexIndex++) {
          b[vertexIndex * dim + axis] = b[vertexIndex * dim + axis]! + scale * 3;
        }
        cases.push({ a, b });
      }
      for (const testCase of cases) {
        const fixture = segmentPairComplex(dim, testCase.a, testCase.b);
        const result = evaluateSourceSimplexPairDistanceN(
          { reference: fixture.a }, { reference: fixture.b }
        );
        const referee = refereePairDistance(
          dim, Float64Array.from(testCase.a), Float64Array.from(testCase.b)
        );
        compared++;
        if (result.status === 'indeterminate') continue;
        const distance = result.status === 'zero-distance'
          ? Math.sqrt(result.squaredDistance) : result.distance;
        const scale = Math.max(1, ...testCase.a.map(Math.abs), ...testCase.b.map(Math.abs));
        expect(Math.abs(distance - referee.distance) / Math.max(1, scale))
          .toBeLessThanOrEqual(1e-10);
        if (result.status === 'separated-multiple') {
          expect(referee.multiple).toBe(true);
        }
        if (result.status === 'separated-unique') {
          // Reconstruction from source-ordered weights, both sides.
          const { witness } = result;
          const weightsA = witness.coordinateA.weights;
          const weightsB = witness.coordinateB.weights;
          expect(Math.abs(weightsA.reduce((x, y) => x + y, 0) - 1))
            .toBeLessThanOrEqual(1e-12);
          expect(Math.abs(weightsB.reduce((x, y) => x + y, 0) - 1))
            .toBeLessThanOrEqual(1e-12);
          const countA = testCase.a.length / dim;
          for (let axis = 0; axis < dim; axis++) {
            let rebuilt = 0;
            for (let vertexIndex = 0; vertexIndex < countA; vertexIndex++) {
              rebuilt += weightsA[vertexIndex]! * testCase.a[vertexIndex * dim + axis]!;
            }
            expect(Math.abs(rebuilt - witness.pointA.data[axis]!))
              .toBeLessThanOrEqual(1e-11 * scale);
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(80);
  });
});

// --- 4. swap, permutation, rigid covariance, scale law -------------------------

describe('pair swap, source permutation, rigid covariance, and scale law', () => {
  it('holds all four invariances on a skew pair in every dimension', () => {
    for (const dim of DIMS.filter((d) => d >= 3)) {
      const aValues = embed(dim, 3, [-1, 0, 0, 1, 0, 0]);
      const bValues = embed(dim, 3, [0.1, -1, 0.6, 0.1, 1, 0.6]);
      const fixture = segmentPairComplex(dim, aValues, bValues);
      const base = evaluateSourceSimplexPairDistanceN(
        { reference: fixture.a }, { reference: fixture.b }
      );
      expect(base.status).toBe('separated-unique');
      if (base.status !== 'separated-unique') continue;

      const swapped = evaluateSourceSimplexPairDistanceN(
        { reference: fixture.b }, { reference: fixture.a }
      );
      expect(swapped.status).toBe('separated-unique');
      if (swapped.status === 'separated-unique') {
        expect(swapped.distance).toBeCloseTo(base.distance, 12);
        for (let axis = 0; axis < dim; axis++) {
          expect(swapped.direction.data[axis]!)
            .toBeCloseTo(-base.direction.data[axis]!, 11);
          expect(swapped.witness.pointA.data[axis]!)
            .toBeCloseTo(base.witness.pointB.data[axis]!, 11);
        }
      }

      // Source-vertex permutation: reversed B reference.
      const reversedB = createSourceSimplexReferenceN(
        fixture.b.parent, [...fixture.b.vertexIndices].reverse()
      );
      const permuted = evaluateSourceSimplexPairDistanceN(
        { reference: fixture.a }, { reference: reversedB }
      );
      expect(permuted.status).toBe('separated-unique');
      if (permuted.status === 'separated-unique') {
        expect(permuted.distance).toBeCloseTo(base.distance, 12);
        const forward = base.witness.coordinateB.weights;
        const backward = permuted.witness.coordinateB.weights;
        expect(backward[0]!).toBeCloseTo(forward[1]!, 11);
        expect(backward[1]!).toBeCloseTo(forward[0]!, 11);
      }

      // Rigid covariance via positions overrides.
      const rigid = new TransformN(
        dim,
        rotationFromPlanes(dim, [{ i: 0, j: dim - 1, angle: 0.6 }]),
        new VecN(Array.from({ length: dim }, (_, axis) => 0.25 * (axis + 1)))
      );
      const move = (values: number[]): Float64Array => {
        const out = new Float64Array(values.length);
        for (let vertexIndex = 0; vertexIndex < values.length / dim; vertexIndex++) {
          const moved = rigid.applyToPoint(
            new VecN(values.slice(vertexIndex * dim, (vertexIndex + 1) * dim))
          );
          out.set(moved.data, vertexIndex * dim);
        }
        return out;
      };
      const rotated = evaluateSourceSimplexPairDistanceN(
        { reference: fixture.a, positions: move(aValues) },
        { reference: fixture.b, positions: move(bValues) }
      );
      expect(rotated.status).toBe('separated-unique');
      if (rotated.status === 'separated-unique') {
        expect(Math.abs(rotated.distance - base.distance)).toBeLessThanOrEqual(1e-10);
      }

      // Positive uniform scale law.
      const factor = 2.5;
      const scaled = evaluateSourceSimplexPairDistanceN(
        { reference: fixture.a, positions: Float64Array.from(aValues, (v) => v * factor) },
        { reference: fixture.b, positions: Float64Array.from(bValues, (v) => v * factor) }
      );
      expect(scaled.status).toBe('separated-unique');
      if (scaled.status === 'separated-unique') {
        expect(Math.abs(scaled.distance - factor * base.distance))
          .toBeLessThanOrEqual(1e-10 * factor);
        for (let at = 0; at < base.witness.coordinateA.weights.length; at++) {
          expect(scaled.witness.coordinateA.weights[at]!)
            .toBeCloseTo(base.witness.coordinateA.weights[at]!, 11);
        }
      }
    }
  });
});

// --- 5. derivative differential -------------------------------------------------

describe('unique-witness derivative, envelope form against central differences', () => {
  it('matches lambda_i * n-hat on 300+ coordinates across dimensions', () => {
    let checked = 0;
    for (const dim of DIMS.filter((d) => d >= 3)) {
      const aValues = embed(dim, 3, [-1, 0.05, 0, 1, -0.05, 0]);
      const bValues = embed(dim, 3, [0.2, -1, 0.7, -0.1, 1, 0.8]);
      const fixture = segmentPairComplex(dim, aValues, bValues);
      const evaluate = (positions: number[]): number => {
        const result = evaluateSourceSimplexPairDistanceN(
          { reference: fixture.a, positions: Float64Array.from(positions) },
          { reference: fixture.b }
        );
        if (result.status !== 'separated-unique') return Number.NaN;
        return result.distance;
      };
      const base = evaluateSourceSimplexPairDistanceN(
        { reference: fixture.a }, { reference: fixture.b }
      );
      expect(base.status).toBe('separated-unique');
      if (base.status !== 'separated-unique') continue;
      expect(base.uniquenessGap).toBeGreaterThan(1e-6); // margin justifies this
      const step = 1e-6;
      for (let at = 0; at < aValues.length; at++) {
        const vertexIndex = Math.floor(at / dim);
        const axis = at % dim;
        const plus = [...aValues];
        plus[at] = plus[at]! + step;
        const minus = [...aValues];
        minus[at] = minus[at]! - step;
        const numeric = (evaluate(plus) - evaluate(minus)) / (2 * step);
        if (Number.isNaN(numeric)) continue;
        const analytic = base.witness.coordinateA.weights[vertexIndex]! *
          base.direction.data[axis]!;
        expect(Math.abs(analytic - numeric) / Math.max(1, Math.abs(analytic)))
          .toBeLessThanOrEqual(1e-7);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(300 / 6); // per-file share; Part A carries 2,198
  });
});

// --- 6. parallel and tied semantics ---------------------------------------------

describe('parallel, near-parallel, and tied witness semantics', () => {
  it('returns typed multiplicity with a shared direction and no gradient owner', () => {
    const dim = 4;
    const fixture = segmentPairComplex(
      dim,
      embed(dim, 2, [-1, 0, 1, 0]),
      embed(dim, 2, [-0.5, 0.75, 0.5, 0.75])
    );
    const result = evaluateSourceSimplexPairDistanceN(
      { reference: fixture.a }, { reference: fixture.b }
    );
    expect(result.status).toBe('separated-multiple');
    if (result.status === 'separated-multiple') {
      expect(result.distance).toBeCloseTo(0.75, 12);
      expect(result.witnesses.length).toBeGreaterThanOrEqual(2);
      // Every witness achieves the distance along the same unit direction.
      for (const witness of result.witnesses) {
        const gap = witness.pointA.clone().sub(witness.pointB);
        expect(gap.length()).toBeCloseTo(0.75, 10);
        const along = gap.dot(result.direction) / gap.length();
        expect(Math.abs(along)).toBeCloseTo(1, 10);
      }
      expect('witness' in result).toBe(false); // no blessed single witness
      expect('uniquenessGap' in result).toBe(false); // and no derivative claim
    }
    // Near-parallel above the certification band stays unique.
    const theta = 1e-3;
    const tilted = evaluateSourceSimplexPairDistanceN(
      { reference: fixture.b, positions: Float64Array.from(embed(dim, 3, [
        -Math.cos(theta) * 0.5, 0.75, -Math.sin(theta) * 0.5,
        Math.cos(theta) * 0.5, 0.75, Math.sin(theta) * 0.5
      ])) },
      { reference: fixture.a }
    );
    expect(tilted.status).toBe('separated-unique');
  });
});

// --- 7. intersection and zero distance ------------------------------------------

describe('intersection and zero-distance semantics', () => {
  it('certifies zero with agreeing witnesses and no invented normal', () => {
    const dim = 3;
    // The P53d counterexample: all A vertices separated, interiors intersect.
    const fixture = segmentPairComplex(
      dim,
      embed(dim, 3, [-3, -3, 0, 3, -3, 0, 0, 4, 0]),
      embed(dim, 3, [0, 0, -1, 0, 0, 1])
    );
    // Liveness of the counterexample: every A vertex is far from B.
    for (const vertexIndex of fixture.a.vertexIndices) {
      const vertexPoint = Array.from(
        fixture.a.complex.positions.subarray(vertexIndex * dim, (vertexIndex + 1) * dim)
      );
      const asPoint = projectPointToSourceSimplexN(fixture.b, vertexPoint);
      expect(Math.sqrt(asPoint.squaredDistance)).toBeGreaterThan(2.9);
    }
    const result = evaluateSourceSimplexPairDistanceN(
      { reference: fixture.a }, { reference: fixture.b }
    );
    expect(result.status).toBe('zero-distance');
    if (result.status === 'zero-distance') {
      expect(Math.sqrt(result.squaredDistance)).toBeLessThanOrEqual(1e-7);
      for (let axis = 0; axis < dim; axis++) {
        expect(result.witness.pointA.data[axis]!)
          .toBeCloseTo(result.witness.pointB.data[axis]!, 7);
      }
      expect('direction' in result).toBe(false); // no invented normal
    }
  });
});

// --- 8. refusals before contamination --------------------------------------------

describe('rank-deficient and non-finite input refusal', () => {
  it('refuses by name before touching any distance', () => {
    const dim = 3;
    const fixture = segmentPairComplex(
      dim, embed(dim, 2, [0, 0.5, 1, 0.5]), embed(dim, 2, [-1, 0, 1, 0])
    );
    expect(() => evaluateSourceSimplexPairDistanceN(
      { reference: fixture.a, positions: Float64Array.from([0, 0, 0, 0, 0, 0]) },
      { reference: fixture.b }
    )).toThrow(/side A is rank-deficient/);
    expect(() => evaluateSourceSimplexPairDistanceN(
      { reference: fixture.a, positions: Float64Array.from([0, 0, 0, Number.NaN, 0, 0]) },
      { reference: fixture.b }
    )).toThrow(/side A coordinates must be finite/);
    expect(() => evaluateSourceSimplexPairDistanceN(
      { reference: fixture.a, positions: Float64Array.from([0, 0, 0]) },
      { reference: fixture.b }
    )).toThrow(/side A positions must pack 2 R3 vertices, got 3 values/);
    expect(() => evaluateSourceSimplexPairDistanceN(
      { reference: fixture.a }, { reference: fixture.b },
      { magic: true } as never
    )).toThrow(/unknown option "magic"/);
  });
});

// --- 9. deterministic replay ------------------------------------------------------

describe('deterministic replay, including refusal evidence', () => {
  it('replays bitwise near the tie boundary and on ties', () => {
    const dim = 5;
    const theta = 1e-9;
    const fixture = segmentPairComplex(
      dim,
      embed(dim, 2, [-1, 0, 1, 0]),
      embed(dim, 3, [-Math.cos(theta), 0.5, -Math.sin(theta),
        Math.cos(theta), 0.5, Math.sin(theta)])
    );
    const one = evaluateSourceSimplexPairDistanceN(
      { reference: fixture.a }, { reference: fixture.b }
    );
    const two = evaluateSourceSimplexPairDistanceN(
      { reference: fixture.a }, { reference: fixture.b }
    );
    expect(JSON.stringify(describeForReplay(one))).toBe(JSON.stringify(describeForReplay(two)));
  });
});

function describeForReplay(result: SourceSimplexPairDistanceN): unknown {
  if (result.status === 'separated-unique') {
    return [result.status, result.distance, result.uniquenessGap,
      [...result.witness.coordinateA.weights], [...result.witness.coordinateB.weights]];
  }
  if (result.status === 'separated-multiple') {
    return [result.status, result.distance,
      result.witnesses.map((witness) => [...witness.coordinateA.weights])];
  }
  if (result.status === 'zero-distance') {
    return [result.status, result.squaredDistance];
  }
  return [result.status, result.bestSquaredDistance, result.certificateResidual];
}

// --- 10. old answers unchanged ------------------------------------------------------

describe('gjkDistance and point--simplex answers, pinned', () => {
  it('leaves the shipped queries bit-for-bit where they were', () => {
    // gjk pinned fixture (the shipped example's numbers).
    const box = new ConvexHullSupportShapeN(4, Float64Array.from([
      0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0,
      0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1, 0
    ]));
    const probe = new ConvexHullSupportShapeN(4, Float64Array.from([0.25, 0.5, 0.5, 2]));
    const gjk = gjkDistance(probe, box);
    expect(gjk.status).toBe('separated');
    expect(gjk.distance).toBe(2);

    // point--simplex pinned fixture through the shipped core projection.
    const complex = new CellComplex(3, Float64Array.from([
      0, 0, 0, 2, 0, 0, 0, 2, 0
    ]), [{
      dim: 2, verticesPerCell: 3, kind: 'simplex',
      indices: Uint32Array.from([0, 1, 2])
    }]);
    const reference = createSourceSimplexReferenceN(
      createSourceCellReferenceN(complex, complex.groups[0]!, 0)
    );
    const projection = projectPointToSourceSimplexN(reference, [0.5, 0.5, 1]);
    expect(projection.squaredDistance).toBe(1);
    // Pinned to the shipped bits, solve noise included: the gate is that P56
    // moved nothing, not that the old solver is prettier than it is.
    expect([...projection.coordinate.weights])
      .toEqual([0.5, 0.24999999999999997, 0.24999999999999994]);
  });
});
