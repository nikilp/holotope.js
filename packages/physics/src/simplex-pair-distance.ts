import {
  VecN,
  createSourceSimplexCoordinateN,
  inspectSourceSimplexReferenceN,
  type SourceSimplexCoordinateN,
  type SourceSimplexReferenceN
} from '@holotope/core';

/**
 * One side of a source-simplex pair query: persistent identity, and
 * optionally the packed candidate positions to evaluate at. Omitted positions
 * read the reference's live complex at its own vertex indices, so a static
 * obstacle feature needs nothing beyond its reference.
 */
export interface SourceSimplexPairSideN {
  /** Persistent source-simplex identity; refused by name when retired. */
  readonly reference: SourceSimplexReferenceN;
  /**
   * Packed candidate positions, `vertexIndices.length * ambientDim` entries
   * in the reference's own vertex order — a deforming feature's proposed
   * placement. Positions are geometry only; identity always comes from the
   * reference.
   */
  readonly positions?: Float64Array;
}

/** One certified closest-pair witness, in source vertex order on both sides. */
export interface SourceSimplexPairWitnessN {
  /** Ordered barycentric weights on A, as a source-simplex coordinate. */
  readonly coordinateA: SourceSimplexCoordinateN;
  /** Ordered barycentric weights on B. */
  readonly coordinateB: SourceSimplexCoordinateN;
  /** Closest point on A at the evaluated positions. */
  readonly pointA: VecN;
  /** Closest point on B at the evaluated positions. */
  readonly pointB: VecN;
  /** Active A-side slots (indices into the reference's vertex order). */
  readonly activeSlotsA: readonly number[];
  /** Active B-side slots. */
  readonly activeSlotsB: readonly number[];
}

/** Certified separated pair whose closest points are unique. */
export interface SourceSimplexPairSeparatedUniqueN {
  /** Certified separation with a unique closest pair. */
  readonly status: 'separated-unique';
  /** Certified unsigned distance between the features. */
  readonly distance: number;
  /** `distance * distance`, from the optimal candidate's own arithmetic. */
  readonly squaredDistance: number;
  /** Unit separating direction from B toward A. */
  readonly direction: VecN;
  /** The unique closest pair, in source vertex order on both sides. */
  readonly witness: SourceSimplexPairWitnessN;
  /**
   * Squared-distance gap to the best geometrically distinct candidate — the
   * measured margin that justifies differentiating through the witness
   * (Danskin/envelope form). `Infinity` when no competitor exists.
   */
  readonly uniquenessGap: number;
  /** Worst variational-certificate residual of the accepted witness. */
  readonly certificateResidual: number;
  /** Scale-derived certification tolerance used by this evaluation. */
  readonly tolerance: number;
}

/** Certified distance whose optimal witness pair is not unique. */
export interface SourceSimplexPairSeparatedMultipleN {
  /** Certified separation whose optimal witness pair is not unique. */
  readonly status: 'separated-multiple';
  /** Certified unsigned distance, shared by every returned witness. */
  readonly distance: number;
  /** `distance * distance`, from the best candidate's own arithmetic. */
  readonly squaredDistance: number;
  /** Shared unit separating direction (B toward A), common to all witnesses. */
  readonly direction: VecN;
  /**
   * Every certified, geometrically distinct optimal witness. A continuum of
   * closest pairs (exactly parallel segments) appears as its extreme
   * representatives. No single witness is blessed, and no gradient exists —
   * the gradient set is not a singleton here (Danskin), so returning one
   * would fabricate physics.
   */
  readonly witnesses: readonly SourceSimplexPairWitnessN[];
  /** Worst variational-certificate residual of the accepted optimum. */
  readonly certificateResidual: number;
  /** Scale-derived certification tolerance used by this evaluation. */
  readonly tolerance: number;
}

/**
 * Certified zero distance: the witnesses coincide within tolerance. Convex
 * simplices at distance zero touch or overlap; the query does not pretend to
 * distinguish which, and **no separating normal is invented**.
 */
export interface SourceSimplexPairZeroDistanceN {
  /** Certified contact-or-overlap; no separating direction exists. */
  readonly status: 'zero-distance';
  /** Residual squared distance of the coinciding witnesses. */
  readonly squaredDistance: number;
  /** The coinciding pair, still in source vertex order. */
  readonly witness: SourceSimplexPairWitnessN;
  /** Scale-derived certification tolerance used by this evaluation. */
  readonly tolerance: number;
}

/**
 * Explicit refusal: Float64 could not certify the comparison at the derived
 * tolerance. Carries the evidence a caller needs to audit the refusal —
 * never silently converted into a separation.
 */
export interface SourceSimplexPairIndeterminateN {
  /** Explicit refusal to certify; never converted into a separation. */
  readonly status: 'indeterminate';
  /** Best uncertified candidate's squared distance — evidence, not a claim. */
  readonly bestSquaredDistance: number;
  /** The certificate residual that exceeded tolerance. */
  readonly certificateResidual: number;
  /** The tolerance it exceeded — the audit trail of the refusal. */
  readonly tolerance: number;
}

/** Discriminated result of one source-simplex pair distance evaluation. */
export type SourceSimplexPairDistanceN =
  | SourceSimplexPairSeparatedUniqueN
  | SourceSimplexPairSeparatedMultipleN
  | SourceSimplexPairZeroDistanceN
  | SourceSimplexPairIndeterminateN;

/** Options for {@link evaluateSourceSimplexPairDistanceN}. */
export interface SourceSimplexPairDistanceOptionsN {
  /** Relative affine-rank tolerance per side. Default `1e-10`. */
  readonly rankTolerance?: number;
  /** Barycentric feasibility band. Default `1e-10`. */
  readonly barycentricTolerance?: number;
}

const EPS = 2 ** -52;
const CALLER = 'evaluateSourceSimplexPairDistanceN';

/**
 * Minimum distance between two finite source simplices in RN, with
 * source-retained witnesses, a variational certificate, honest ties, and
 * typed refusals.
 *
 * The kernel enumerates every nonempty face pair, solves the unconstrained
 * closest-affine-pair system per pair, keeps feasible candidates, and
 * certifies the optimum by the variational inequality against **every**
 * input vertex (`⟨n, v − p⟩ ≥ −τ` over A and `⟨n, q − w⟩ ≥ −τ` over B, with
 * `n = p − q` and τ derived from Float64 forward error, `128ε·max(1, M²)`).
 * The certificate is checked against the inputs, not against the enumeration
 * that produced the candidate. Distance between convex sets is differentiable
 * exactly where the closest pair is unique, so the result separates
 * `'separated-unique'` — carrying the measured `uniquenessGap` that justifies
 * the envelope-form gradient `∂d/∂aᵢ = λᵢ·n̂`, `∂d/∂bⱼ = −μⱼ·n̂` — from
 * `'separated-multiple'`, which returns every distinct optimal witness and
 * no gradient. Zero distance is certified with no invented normal, and an
 * uncertifiable comparison refuses with its own residuals.
 *
 * Weights are ordered by each reference's **own vertex order**, whatever any
 * internal solve does; pair swap preserves the distance, swaps the evidence,
 * and negates the direction. This is a mathematical result, not a solver
 * cache: there is no iteration budget, and identical input replays
 * identically.
 *
 * Prior art: the closest-pair KKT characterization is classical convex
 * analysis; the feature-pair decomposition of proximity follows Li et al.,
 * *Incremental Potential Contact* (SIGGRAPH 2020) as mathematical prior art.
 * The implementation is original to this repository.
 *
 * @example
 * A deforming segment approaching a static obstacle edge, with the witness
 * explaining exactly which feature carried the answer — and the parallel tie
 * refusing to fabricate one:
 * ```ts
 * const complex = new CellComplex(3, Float64Array.from([
 *   -1, 0, 0,
 *   1, 0, 0,
 *   -1, 0.75, 0.4,
 *   1, 0.75, -0.4
 * ]), [{ dim: 1, verticesPerCell: 2, kind: 'simplex',
 *        indices: Uint32Array.from([0, 1, 2, 3]) }]);
 * const group = complex.groups[0];
 * if (group === undefined) throw new Error('expected the segment group');
 * const obstacle = createSourceSimplexReferenceN(
 *   createSourceCellReferenceN(complex, group, 0), [0, 1]
 * );
 * const mover = createSourceSimplexReferenceN(
 *   createSourceCellReferenceN(complex, group, 1), [2, 3]
 * );
 *
 * const result = evaluateSourceSimplexPairDistanceN(
 *   { reference: mover }, { reference: obstacle }
 * );
 * log(result.status); // 'separated-unique' — the segments are skew
 * if (result.status === 'separated-unique') {
 *   log('distance', result.distance); // 0.75
 *   log('weights on the mover', result.witness.coordinateA.weights);
 *   // Which feature carried the answer: the active slots name the vertices
 *   // (in source order) whose convex combination is the witness.
 *   log('active mover vertices', result.witness.activeSlotsA);
 *   log('active obstacle vertices', result.witness.activeSlotsB);
 *   log('margin', result.uniquenessGap); // > 0: a derivative is justified
 * }
 *
 * // Propose a parallel placement: the tie is evidence, not a choice.
 * const parallel = evaluateSourceSimplexPairDistanceN(
 *   { reference: mover, positions: Float64Array.from([
 *     -0.5, 0.75, 0,
 *     0.5, 0.75, 0
 *   ]) },
 *   { reference: obstacle }
 * );
 * log(parallel.status); // 'separated-multiple'
 * if (parallel.status === 'separated-multiple') {
 *   log('tied witnesses', parallel.witnesses.length); // >= 2, none blessed
 * }
 * ```
 */
export function evaluateSourceSimplexPairDistanceN(
  sideA: SourceSimplexPairSideN,
  sideB: SourceSimplexPairSideN,
  options: SourceSimplexPairDistanceOptionsN = {}
): SourceSimplexPairDistanceN {
  const unknown = Object.keys(options).filter(
    (key) => !['rankTolerance', 'barycentricTolerance'].includes(key)
  );
  if (unknown.length > 0) {
    throw new Error(
      `${CALLER}: unknown option${unknown.length === 1 ? '' : 's'} ` +
      unknown.sort().map((key) => `"${key}"`).join(', ')
    );
  }
  const rankTolerance = options.rankTolerance ?? 1e-10;
  const barycentricTolerance = options.barycentricTolerance ?? 1e-10;
  if (!Number.isFinite(rankTolerance) || rankTolerance <= 0) {
    throw new Error(`${CALLER}: rankTolerance must be finite and positive`);
  }
  if (!Number.isFinite(barycentricTolerance) || barycentricTolerance <= 0) {
    throw new Error(`${CALLER}: barycentricTolerance must be finite and positive`);
  }
  const a = resolveSide(sideA, 'side A');
  const b = resolveSide(sideB, 'side B');
  if (a.dim !== b.dim) {
    throw new Error(
      `${CALLER}: side A is in R${a.dim}, side B is in R${b.dim}`
    );
  }
  const dim = a.dim;
  assertAffineRank(a.positions, dim, 'side A', rankTolerance);
  assertAffineRank(b.positions, dim, 'side B', rankTolerance);

  const countA = a.positions.length / dim;
  const countB = b.positions.length / dim;
  let magnitude = 0;
  for (const value of a.positions) magnitude = Math.max(magnitude, Math.abs(value));
  for (const value of b.positions) magnitude = Math.max(magnitude, Math.abs(value));
  const tolerance = 128 * EPS * Math.max(1, magnitude * magnitude);
  const witnessTolerance = 1e-9 * Math.max(1, magnitude);

  interface Candidate {
    readonly slotsA: readonly number[];
    readonly slotsB: readonly number[];
    readonly weightsA: number[];
    readonly weightsB: number[];
    readonly pointA: number[];
    readonly pointB: number[];
    readonly squaredDistance: number;
    readonly key: string;
  }
  const vertexAt = (packed: Float64Array, index: number): Float64Array =>
    packed.subarray(index * dim, (index + 1) * dim) as Float64Array;
  const candidates: Candidate[] = [];
  for (const slotsA of nonemptySubsets(countA)) {
    for (const slotsB of nonemptySubsets(countB)) {
      const s = slotsA.length - 1;
      const t = slotsB.length - 1;
      const baseA = vertexAt(a.positions, slotsA[0]!);
      const baseB = vertexAt(b.positions, slotsB[0]!);
      const edgesA: Float64Array[] = [];
      for (let i = 1; i <= s; i++) {
        const edge = new Float64Array(dim);
        const vertex = vertexAt(a.positions, slotsA[i]!);
        for (let axis = 0; axis < dim; axis++) edge[axis] = vertex[axis]! - baseA[axis]!;
        edgesA.push(edge);
      }
      const edgesB: Float64Array[] = [];
      for (let j = 1; j <= t; j++) {
        const edge = new Float64Array(dim);
        const vertex = vertexAt(b.positions, slotsB[j]!);
        for (let axis = 0; axis < dim; axis++) edge[axis] = vertex[axis]! - baseB[axis]!;
        edgesB.push(edge);
      }
      const gap = new Float64Array(dim);
      for (let axis = 0; axis < dim; axis++) gap[axis] = baseB[axis]! - baseA[axis]!;

      let u: number[] = [];
      let v: number[] = [];
      if (s + t > 0) {
        const size = s + t;
        const matrix: number[][] = Array.from({ length: size }, () =>
          new Array<number>(size).fill(0));
        const rhs = new Array<number>(size).fill(0);
        for (let i = 0; i < s; i++) {
          for (let c = 0; c < s; c++) matrix[i]![c] = dot(edgesA[i]!, edgesA[c]!, dim);
          for (let c = 0; c < t; c++) matrix[i]![s + c] = -dot(edgesA[i]!, edgesB[c]!, dim);
          rhs[i] = dot(edgesA[i]!, gap, dim);
        }
        for (let j = 0; j < t; j++) {
          for (let c = 0; c < s; c++) matrix[s + j]![c] = -dot(edgesB[j]!, edgesA[c]!, dim);
          for (let c = 0; c < t; c++) matrix[s + j]![s + c] = dot(edgesB[j]!, edgesB[c]!, dim);
          rhs[s + j] = -dot(edgesB[j]!, gap, dim);
        }
        const solution = solvePivoted(matrix, rhs);
        if (solution === null) continue; // parallel affine pair; extremes cover it
        u = solution.slice(0, s);
        v = solution.slice(s, s + t);
      }
      const faceWeightsA = [1 - u.reduce((x, y) => x + y, 0), ...u];
      const faceWeightsB = [1 - v.reduce((x, y) => x + y, 0), ...v];
      if (faceWeightsA.some((w) => w < -barycentricTolerance)) continue;
      if (faceWeightsB.some((w) => w < -barycentricTolerance)) continue;

      const pointA = new Array<number>(dim).fill(0);
      const pointB = new Array<number>(dim).fill(0);
      slotsA.forEach((slot, at) => {
        const vertex = vertexAt(a.positions, slot);
        for (let axis = 0; axis < dim; axis++) {
          pointA[axis]! += faceWeightsA[at]! * vertex[axis]!;
        }
      });
      slotsB.forEach((slot, at) => {
        const vertex = vertexAt(b.positions, slot);
        for (let axis = 0; axis < dim; axis++) {
          pointB[axis]! += faceWeightsB[at]! * vertex[axis]!;
        }
      });
      let squaredDistance = 0;
      for (let axis = 0; axis < dim; axis++) {
        const delta = pointA[axis]! - pointB[axis]!;
        squaredDistance += delta * delta;
      }
      const weightsA = new Array<number>(countA).fill(0);
      const weightsB = new Array<number>(countB).fill(0);
      slotsA.forEach((slot, at) => {
        weightsA[slot] = Math.min(1, Math.max(0, faceWeightsA[at]!));
      });
      slotsB.forEach((slot, at) => {
        weightsB[slot] = Math.min(1, Math.max(0, faceWeightsB[at]!));
      });
      candidates.push({
        slotsA, slotsB, weightsA, weightsB, pointA, pointB, squaredDistance,
        key: [...pointA, ...pointB]
          .map((value) => Math.round(value / witnessTolerance)).join(',')
      });
    }
  }

  candidates.sort((left, right) => left.squaredDistance - right.squaredDistance);
  const best = candidates[0]!;

  const direction = best.pointA.map((value, axis) => value - best.pointB[axis]!);
  let certificateResidual = 0;
  for (let i = 0; i < countA; i++) {
    const vertex = vertexAt(a.positions, i);
    let along = 0;
    for (let axis = 0; axis < dim; axis++) {
      along += direction[axis]! * (best.pointA[axis]! - vertex[axis]!);
    }
    certificateResidual = Math.max(certificateResidual, along);
  }
  for (let j = 0; j < countB; j++) {
    const vertex = vertexAt(b.positions, j);
    let along = 0;
    for (let axis = 0; axis < dim; axis++) {
      along += direction[axis]! * (vertex[axis]! - best.pointB[axis]!);
    }
    certificateResidual = Math.max(certificateResidual, along);
  }

  const witnessOf = (candidate: Candidate): SourceSimplexPairWitnessN => Object.freeze({
    coordinateA: createSourceSimplexCoordinateN(a.reference, candidate.weightsA),
    coordinateB: createSourceSimplexCoordinateN(b.reference, candidate.weightsB),
    pointA: new VecN(candidate.pointA),
    pointB: new VecN(candidate.pointB),
    activeSlotsA: Object.freeze([...candidate.slotsA]),
    activeSlotsB: Object.freeze([...candidate.slotsB])
  });

  const zeroBand = Math.sqrt(tolerance) * Math.max(1, magnitude);
  const distance = Math.sqrt(best.squaredDistance);
  if (distance <= zeroBand) {
    return Object.freeze({
      status: 'zero-distance',
      squaredDistance: best.squaredDistance,
      witness: witnessOf(best),
      tolerance
    });
  }
  if (certificateResidual > tolerance) {
    return Object.freeze({
      status: 'indeterminate',
      bestSquaredDistance: best.squaredDistance,
      certificateResidual,
      tolerance
    });
  }
  const optimalBand = tolerance * Math.max(1, magnitude);
  const distinct = new Map<string, Candidate>();
  for (const candidate of candidates) {
    if (candidate.squaredDistance - best.squaredDistance > optimalBand) break;
    if (!distinct.has(candidate.key)) distinct.set(candidate.key, candidate);
  }
  const unit = new VecN(direction.map((value) => value / distance));
  if (distinct.size > 1) {
    return Object.freeze({
      status: 'separated-multiple',
      distance,
      squaredDistance: best.squaredDistance,
      direction: unit,
      witnesses: Object.freeze([...distinct.values()].map(witnessOf)),
      certificateResidual,
      tolerance
    });
  }
  let uniquenessGap = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate.key === best.key) continue;
    uniquenessGap = candidate.squaredDistance - best.squaredDistance;
    break;
  }
  return Object.freeze({
    status: 'separated-unique',
    distance,
    squaredDistance: best.squaredDistance,
    direction: unit,
    witness: witnessOf(best),
    uniquenessGap,
    certificateResidual,
    tolerance
  });
}

interface ResolvedSide {
  readonly reference: SourceSimplexReferenceN;
  readonly positions: Float64Array;
  readonly dim: number;
}

function resolveSide(side: SourceSimplexPairSideN, label: string): ResolvedSide {
  if (typeof side !== 'object' || side === null ||
      typeof side.reference !== 'object' || side.reference === null ||
      side.reference.kind !== 'source-simplex-reference') {
    throw new Error(`${CALLER}: ${label} must carry a SourceSimplexReferenceN`);
  }
  const status = inspectSourceSimplexReferenceN(side.reference);
  if (status.kind === 'retired') {
    throw new Error(`${CALLER}: ${label} source simplex is retired (${status.reason})`);
  }
  const dim = side.reference.complex.ambientDim;
  const count = side.reference.vertexIndices.length;
  let positions: Float64Array;
  if (side.positions !== undefined) {
    if (side.positions.length !== count * dim) {
      throw new Error(
        `${CALLER}: ${label} positions must pack ${count} R${dim} vertices, ` +
        `got ${side.positions.length} values`
      );
    }
    positions = side.positions;
  } else {
    positions = new Float64Array(count * dim);
    side.reference.vertexIndices.forEach((vertexIndex, slot) => {
      for (let axis = 0; axis < dim; axis++) {
        positions[slot * dim + axis] =
          side.reference.complex.positions[vertexIndex * dim + axis]!;
      }
    });
  }
  for (const value of positions) {
    if (!Number.isFinite(value)) {
      throw new Error(`${CALLER}: ${label} coordinates must be finite`);
    }
  }
  return { reference: side.reference, positions, dim };
}

function assertAffineRank(
  packed: Float64Array,
  dim: number,
  side: string,
  rankTolerance: number
): void {
  const count = packed.length / dim;
  if (count === 1) return;
  if (count > dim + 1) {
    throw new Error(
      `${CALLER}: ${side} has ${count} vertices; a simplex in R${dim} ` +
      `has at most ${dim + 1}`
    );
  }
  const basis: number[][] = [];
  let scale = 0;
  for (let vertex = 1; vertex < count; vertex++) {
    const edge = new Array<number>(dim);
    for (let axis = 0; axis < dim; axis++) {
      edge[axis] = packed[vertex * dim + axis]! - packed[axis]!;
      scale = Math.max(scale, Math.abs(edge[axis]!));
    }
    for (const row of basis) {
      let along = 0;
      for (let axis = 0; axis < dim; axis++) along += edge[axis]! * row[axis]!;
      for (let axis = 0; axis < dim; axis++) edge[axis]! -= along * row[axis]!;
    }
    let norm = 0;
    for (let axis = 0; axis < dim; axis++) norm += edge[axis]! * edge[axis]!;
    norm = Math.sqrt(norm);
    if (norm <= rankTolerance * Math.max(1, scale)) {
      throw new Error(
        `${CALLER}: ${side} is rank-deficient (vertex ${vertex} is affinely ` +
        'dependent on its predecessors within the rank tolerance)'
      );
    }
    for (let axis = 0; axis < dim; axis++) edge[axis]! /= norm;
    basis.push(edge);
  }
}

function dot(x: Float64Array, y: Float64Array, dim: number): number {
  let sum = 0;
  for (let axis = 0; axis < dim; axis++) sum += x[axis]! * y[axis]!;
  return sum;
}

function solvePivoted(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) {
      if (Math.abs(a[row]![column]!) > Math.abs(a[pivot]![column]!)) pivot = row;
    }
    let rowScale = 0;
    for (let c = 0; c < n; c++) rowScale = Math.max(rowScale, Math.abs(a[pivot]![c]!));
    if (!(Math.abs(a[pivot]![column]!) > rowScale * 1e-13)) return null;
    const swap = a[pivot]!;
    a[pivot] = a[column]!;
    a[column] = swap;
    for (let row = column + 1; row < n; row++) {
      const factor = a[row]![column]! / a[column]![column]!;
      for (let c = column; c <= n; c++) a[row]![c]! -= factor * a[column]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = a[row]![n]!;
    for (let c = row + 1; c < n; c++) sum -= a[row]![c]! * x[c]!;
    x[row] = sum / a[row]![row]!;
  }
  return x;
}

function nonemptySubsets(count: number): number[][] {
  const subsets: number[][] = [];
  for (let mask = 1; mask < 2 ** count; mask++) {
    const subset: number[] = [];
    for (let bit = 0; bit < count; bit++) {
      if ((mask & (1 << bit)) !== 0) subset.push(bit);
    }
    subsets.push(subset);
  }
  return subsets;
}
