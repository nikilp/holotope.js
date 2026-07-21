import {
  MatN,
  symmetricEigenDecomposition
} from '@holotope/core';
import {
  applyConstraintRowImpulse4,
  constraintRowCoupling4,
  constraintRowSpeed4,
  type ConstraintImpulseState4,
  type ConstraintParticipant4,
  type ConstraintRow4
} from './constraint-row4.js';
import { RigidBody4 } from './rigid-body4.js';

export type ConstraintBlockRankPolicy4 = 'reject' | 'minimum-norm';

export type ConstraintBlockProjection4 =
  | { readonly kind: 'equality' }
  | { readonly kind: 'one-bounded' };

/** One coupled block of one to six rigid-Jacobian rows. */
export interface ConstraintBlock4 {
  /** Must be unique within a solver; persistent IDs retain warm impulses. */
  readonly id: string;
  readonly rows: readonly ConstraintRow4[];
  /** Equality by default; bounded projection must be requested explicitly. */
  readonly projection?: ConstraintBlockProjection4;
}

export interface ConstraintBlockSolver4Options {
  /** Block Gauss--Seidel passes. Default 8. */
  readonly iterations?: number;
  /** Fraction of the block-error norm corrected per step. Default 0.2. */
  readonly baumgarte?: number;
  /** Block-error norm ignored by velocity-level bias. Default 0.001. */
  readonly positionSlop?: number;
  /** Upper bound on the complete bias-vector norm. Default 2. */
  readonly maxBiasSpeed?: number;
  /** Apply coherent impulses retained from the previous solve. Default true. */
  readonly warmStart?: boolean;
  /** Relative eigenvalue threshold against `trace(K) / k`. Default 1e-10. */
  readonly rankTolerance?: number;
  /** Refuse rank loss by default; minimum-norm solving must be explicit. */
  readonly rankPolicy?: ConstraintBlockRankPolicy4;
}

export interface ConstraintBlockResult4 {
  readonly id: string;
  readonly rowCount: number;
  readonly projection: ConstraintBlockProjection4['kind'];
  /** Row-major `J M^-1 J^T`. */
  readonly response: Float64Array;
  /** Row-major inverse or explicitly requested spectral pseudoinverse. */
  readonly effectiveMass: Float64Array;
  readonly responseEigenvalues: Float64Array;
  readonly rankThreshold: number;
  readonly effectiveRank: number;
  readonly initialPositionError: Float64Array;
  readonly initialSpeed: Float64Array;
  readonly velocityTarget: Float64Array;
  readonly biasSpeed: Float64Array;
  readonly targetSpeed: Float64Array;
  readonly warmStartedImpulse: Float64Array;
  readonly accumulatedImpulse: Float64Array;
  readonly finalSpeed: Float64Array;
  readonly residualSpeed: Float64Array;
  readonly residualNorm: number;
  /** Norm of residuals in the unbounded equality subspace. */
  readonly equalityResidualNorm: number;
  readonly boundedCoordinate: ConstraintBlockBoundedCoordinateResult4 | null;
}

export interface ConstraintBlockBoundedCoordinateResult4 {
  readonly rowIndex: number;
  /** Scalar response after eliminating the equality coordinates. */
  readonly schurResponse: number;
  readonly minForce: number;
  readonly maxForce: number;
  readonly minImpulse: number;
  readonly maxImpulse: number;
  readonly impulseState: ConstraintImpulseState4;
  /** Reduced projected fixed-point residual; zero is the bounded KKT condition. */
  readonly projectedResidualSpeed: number;
}

export interface ConstraintBlockSolveResult4 {
  readonly blocks: readonly ConstraintBlockResult4[];
  readonly retiredIds: readonly string[];
  readonly iterations: number;
  /** Sum of Euclidean coordinate-impulse norms; diagnostic only. */
  readonly sumCoordinateImpulseNorms: number;
  readonly maxResidualNorm: number;
  readonly maxEqualityResidualNorm: number;
  readonly maxProjectedResidualSpeed: number;
  readonly maxPositionErrorNorm: number;
}

interface CachedConstraintBlock4 {
  rows: readonly ConstraintRow4[];
  impulse: Float64Array;
  dt: number;
  participantA: ConstraintParticipant4;
  participantB: ConstraintParticipant4;
}

interface PreparedConstraintBlock4 {
  source: ConstraintBlock4;
  participantA: ConstraintParticipant4;
  participantB: ConstraintParticipant4;
  response: Float64Array;
  effectiveMass: Float64Array;
  responseEigenvalues: Float64Array;
  rankThreshold: number;
  effectiveRank: number;
  initialPositionError: Float64Array;
  initialSpeed: Float64Array;
  velocityTarget: Float64Array;
  biasSpeed: Float64Array;
  targetSpeed: Float64Array;
  warmStartedImpulse: Float64Array;
  accumulatedImpulse: Float64Array;
  projection: ConstraintBlockProjection4['kind'];
  boundedRowIndex: number;
  equalityIndices: readonly number[];
  equalityEffectiveMass: Float64Array;
  schurResponse: number;
  minForce: number;
  maxForce: number;
  minImpulse: number;
  maxImpulse: number;
}

/**
 * Warm-started block solver for one to six R4 rigid-Jacobian rows.
 *
 * Bias limiting and warm-start projection operate on the complete coordinate
 * vector for equality blocks. A `one-bounded` block exactly eliminates its
 * equality subspace before projecting the one force-limited coordinate.
 */
export class ConstraintBlockSolver4 {
  readonly iterations: number;
  readonly baumgarte: number;
  readonly positionSlop: number;
  readonly maxBiasSpeed: number;
  readonly warmStart: boolean;
  readonly rankTolerance: number;
  readonly rankPolicy: ConstraintBlockRankPolicy4;
  private cache = new Map<string, CachedConstraintBlock4>();

  constructor(options: ConstraintBlockSolver4Options = {}) {
    this.iterations = options.iterations ?? 8;
    this.baumgarte = options.baumgarte ?? 0.2;
    this.positionSlop = options.positionSlop ?? 0.001;
    this.maxBiasSpeed = options.maxBiasSpeed ?? 2;
    this.warmStart = options.warmStart ?? true;
    this.rankTolerance = options.rankTolerance ?? 1e-10;
    this.rankPolicy = options.rankPolicy ?? 'reject';
    if (!Number.isSafeInteger(this.iterations) || this.iterations < 1) {
      throw new Error('ConstraintBlockSolver4: iterations must be a positive integer');
    }
    requireNonNegativeFinite(this.baumgarte, 'baumgarte');
    requireNonNegativeFinite(this.positionSlop, 'positionSlop');
    requireNonNegativeFinite(this.maxBiasSpeed, 'maxBiasSpeed');
    requirePositiveFinite(this.rankTolerance, 'rankTolerance');
    if (this.rankPolicy !== 'reject' && this.rankPolicy !== 'minimum-norm') {
      throw new Error(`ConstraintBlockSolver4: unknown rank policy ${String(this.rankPolicy)}`);
    }
  }

  solve(blocks: readonly ConstraintBlock4[], dt: number): ConstraintBlockSolveResult4 {
    if (!Number.isFinite(dt) || dt <= 0) {
      throw new Error('ConstraintBlockSolver4.solve: dt must be finite and positive');
    }
    const seen = new Set<string>();
    const prepared = blocks.map((block) => {
      if (block.id.length === 0) {
        throw new Error('ConstraintBlockSolver4.solve: block IDs must not be empty');
      }
      if (seen.has(block.id)) {
        throw new Error(`ConstraintBlockSolver4.solve: duplicate block ID ${block.id}`);
      }
      seen.add(block.id);
      return this.prepare(block, dt);
    });
    const retiredIds = Array.from(this.cache.keys())
      .filter((id) => !seen.has(id))
      .sort();

    if (this.warmStart) {
      for (const block of prepared) this.applyWarmStart(block, dt);
    }
    for (let iteration = 0; iteration < this.iterations; iteration++) {
      for (const block of prepared) this.solveBlock(block);
    }

    const nextCache = new Map<string, CachedConstraintBlock4>();
    const results = prepared.map((block): ConstraintBlockResult4 => {
      const finalSpeed = blockSpeed(block.source.rows);
      const residualSpeed = subtract(finalSpeed, block.targetSpeed);
      const equalityResidualNorm = indexedNorm(
        residualSpeed,
        block.equalityIndices
      );
      const boundedCoordinate = block.projection === 'one-bounded'
        ? boundedResult(block, finalSpeed)
        : null;
      nextCache.set(block.source.id, {
        rows: block.source.rows.map(cloneRowGeometry),
        impulse: block.accumulatedImpulse.slice(),
        dt,
        participantA: block.participantA,
        participantB: block.participantB
      });
      return {
        id: block.source.id,
        rowCount: block.source.rows.length,
        projection: block.projection,
        response: block.response.slice(),
        effectiveMass: block.effectiveMass.slice(),
        responseEigenvalues: block.responseEigenvalues.slice(),
        rankThreshold: block.rankThreshold,
        effectiveRank: block.effectiveRank,
        initialPositionError: block.initialPositionError.slice(),
        initialSpeed: block.initialSpeed.slice(),
        velocityTarget: block.velocityTarget.slice(),
        biasSpeed: block.biasSpeed.slice(),
        targetSpeed: block.targetSpeed.slice(),
        warmStartedImpulse: block.warmStartedImpulse.slice(),
        accumulatedImpulse: block.accumulatedImpulse.slice(),
        finalSpeed,
        residualSpeed,
        residualNorm: vectorNorm(residualSpeed),
        equalityResidualNorm,
        boundedCoordinate
      };
    });
    this.cache = nextCache;
    return {
      blocks: results,
      retiredIds,
      iterations: this.iterations,
      sumCoordinateImpulseNorms: results.reduce(
        (sum, block) => sum + vectorNorm(block.accumulatedImpulse),
        0
      ),
      maxResidualNorm: results.reduce(
        (maximum, block) => Math.max(maximum, block.residualNorm),
        0
      ),
      maxEqualityResidualNorm: results.reduce(
        (maximum, block) => Math.max(maximum, block.equalityResidualNorm),
        0
      ),
      maxProjectedResidualSpeed: results.reduce(
        (maximum, block) => Math.max(
          maximum,
          Math.abs(block.boundedCoordinate?.projectedResidualSpeed ?? 0)
        ),
        0
      ),
      maxPositionErrorNorm: results.reduce(
        (maximum, block) => Math.max(
          maximum,
          vectorNorm(block.initialPositionError)
        ),
        0
      )
    };
  }

  reset(): void {
    this.cache.clear();
  }

  private prepare(source: ConstraintBlock4, dt: number): PreparedConstraintBlock4 {
    const validated = validateBlock(source);
    const {
      participantA,
      participantB,
      projection,
      boundedRowIndex,
      equalityIndices,
      minForce,
      maxForce
    } = validated;
    if (projection === 'one-bounded' && this.rankPolicy !== 'reject') {
      throw new Error(
        'ConstraintBlockSolver4.solve: one-bounded blocks require rankPolicy reject'
      );
    }
    const response = constraintBlockResponseMatrix4(source.rows);
    const spectral = decomposeResponse(
      response,
      source.rows.length,
      this.rankTolerance
    );
    if (
      (this.rankPolicy === 'reject' || projection === 'one-bounded') &&
      spectral.effectiveRank !== source.rows.length
    ) {
      throw new Error(
        `ConstraintBlockSolver4.solve: block ${source.id} has effective rank ` +
        `${spectral.effectiveRank}/${source.rows.length}`
      );
    }
    const initialPositionError = Float64Array.from(
      source.rows,
      (row) => row.positionError ?? 0
    );
    const velocityTarget = Float64Array.from(
      source.rows,
      (row) => row.velocityTarget ?? 0
    );
    const biasSpeed = blockBiasSpeed(
      initialPositionError,
      equalityIndices,
      boundedRowIndex,
      dt,
      this.baumgarte,
      this.positionSlop,
      this.maxBiasSpeed
    );
    const equalityResponse = submatrix(
      response,
      source.rows.length,
      equalityIndices
    );
    const equalitySpectral = projection === 'equality'
      ? spectral
      : equalityIndices.length === 0
      ? {
          effectiveMass: new Float64Array(),
          eigenvalues: new Float64Array(),
          threshold: 0,
          effectiveRank: 0
        }
      : decomposeResponse(
          equalityResponse,
          equalityIndices.length,
          this.rankTolerance
        );
    if (
      projection === 'one-bounded' &&
      equalitySpectral.effectiveRank !== equalityIndices.length
    ) {
      throw new Error(
        `ConstraintBlockSolver4.solve: block ${source.id} has rank-deficient equality subspace`
      );
    }
    const schurResponse = projection === 'one-bounded'
      ? schurComplement(
          response,
          source.rows.length,
          equalityIndices,
          boundedRowIndex,
          equalitySpectral.effectiveMass
        )
      : 0;
    if (
      projection === 'one-bounded' &&
      (!(schurResponse > spectral.threshold) || !Number.isFinite(1 / schurResponse))
    ) {
      throw new Error(
        `ConstraintBlockSolver4.solve: block ${source.id} has non-positive bounded Schur response`
      );
    }
    const minImpulse = minForce === -Infinity ? -Infinity : minForce * dt;
    const maxImpulse = maxForce === Infinity ? Infinity : maxForce * dt;
    return {
      source,
      participantA,
      participantB,
      response,
      effectiveMass: spectral.effectiveMass,
      responseEigenvalues: spectral.eigenvalues,
      rankThreshold: spectral.threshold,
      effectiveRank: spectral.effectiveRank,
      initialPositionError,
      initialSpeed: blockSpeed(source.rows),
      velocityTarget,
      biasSpeed,
      targetSpeed: add(velocityTarget, biasSpeed),
      warmStartedImpulse: new Float64Array(source.rows.length),
      accumulatedImpulse: new Float64Array(source.rows.length),
      projection,
      boundedRowIndex,
      equalityIndices,
      equalityEffectiveMass: equalitySpectral.effectiveMass,
      schurResponse,
      minForce,
      maxForce,
      minImpulse,
      maxImpulse
    };
  }

  private applyWarmStart(block: PreparedConstraintBlock4, dt: number): void {
    const cached = this.cache.get(block.source.id);
    if (
      !cached ||
      cached.participantA !== block.participantA ||
      cached.participantB !== block.participantB
    ) {
      return;
    }
    const projectedSpeed = new Float64Array(block.source.rows.length);
    for (let row = 0; row < block.source.rows.length; row++) {
      for (let previous = 0; previous < cached.rows.length; previous++) {
        projectedSpeed[row]! += constraintRowCoupling4(
          block.source.rows[row]!,
          cached.rows[previous]!
        ) * cached.impulse[previous]!;
      }
    }
    let impulse = applyDense(
      block.effectiveMass,
      projectedSpeed
    );
    const timestepScale = dt / cached.dt;
    for (let index = 0; index < impulse.length; index++) {
      impulse[index]! *= timestepScale;
    }
    if (block.projection === 'one-bounded') {
      impulse = projectWarmImpulse(block, impulse, projectedSpeed, timestepScale);
    }
    block.warmStartedImpulse.set(impulse);
    block.accumulatedImpulse.set(impulse);
    applyBlockImpulse(block.source.rows, impulse);
  }

  private solveBlock(block: PreparedConstraintBlock4): void {
    const requested = subtract(block.targetSpeed, blockSpeed(block.source.rows));
    const delta = block.projection === 'equality'
      ? applyDense(block.effectiveMass, requested)
      : solveOneBoundedDelta(block, requested);
    for (let index = 0; index < delta.length; index++) {
      block.accumulatedImpulse[index]! += delta[index]!;
    }
    applyBlockImpulse(block.source.rows, delta);
  }
}

/** Row-major symmetric response for coherent R4 rigid-Jacobian rows. */
export function constraintBlockResponseMatrix4(
  rows: readonly ConstraintRow4[]
): Float64Array {
  if (rows.length < 1 || rows.length > 6) {
    throw new Error('constraintBlockResponseMatrix4: expected one to six rows');
  }
  const response = new Float64Array(rows.length * rows.length);
  for (let row = 0; row < rows.length; row++) {
    for (let column = 0; column <= row; column++) {
      const value = constraintRowCoupling4(rows[row]!, rows[column]!);
      response[row * rows.length + column] = value;
      response[column * rows.length + row] = value;
    }
  }
  return response;
}

function validateBlock(source: ConstraintBlock4): {
  participantA: ConstraintParticipant4;
  participantB: ConstraintParticipant4;
  projection: ConstraintBlockProjection4['kind'];
  boundedRowIndex: number;
  equalityIndices: readonly number[];
  minForce: number;
  maxForce: number;
} {
  if (source.rows.length < 1 || source.rows.length > 6) {
    throw new Error('ConstraintBlockSolver4.solve: blocks must contain one to six rows');
  }
  const first = source.rows[0]!;
  const participantA = first.participantA;
  const participantB = first.participantB;
  if (participantA instanceof RigidBody4 && participantA === participantB) {
    throw new Error('ConstraintBlockSolver4.solve: a body cannot constrain itself');
  }
  if (!(participantA instanceof RigidBody4) && !(participantB instanceof RigidBody4)) {
    throw new Error('ConstraintBlockSolver4.solve: block needs a dynamic participant');
  }
  const rowIds = new Set<string>();
  const boundedIndices: number[] = [];
  for (let index = 0; index < source.rows.length; index++) {
    const row = source.rows[index]!;
    if (row.participantA !== participantA || row.participantB !== participantB) {
      throw new Error('ConstraintBlockSolver4.solve: block rows need identical participants');
    }
    if (rowIds.has(row.id)) {
      throw new Error(`ConstraintBlockSolver4.solve: duplicate row ID ${row.id}`);
    }
    rowIds.add(row.id);
    validateJacobian(row.jacobianA);
    validateJacobian(row.jacobianB);
    const positionError = row.positionError ?? 0;
    const velocityTarget = row.velocityTarget ?? 0;
    if (!Number.isFinite(positionError) || !Number.isFinite(velocityTarget)) {
      throw new Error('ConstraintBlockSolver4.solve: row errors and targets must be finite');
    }
    const [minForce, maxForce] = forceBounds(row);
    if (minForce !== -Infinity || maxForce !== Infinity) boundedIndices.push(index);
  }
  const projection = source.projection?.kind ?? 'equality';
  if (projection !== 'equality' && projection !== 'one-bounded') {
    throw new Error(
      `ConstraintBlockSolver4.solve: unknown projection ${String(projection)}`
    );
  }
  if (projection === 'equality') {
    if (boundedIndices.length !== 0) {
      throw new Error(
        'ConstraintBlockSolver4.solve: equality blocks cannot contain bounded rows'
      );
    }
    return {
      participantA,
      participantB,
      projection,
      boundedRowIndex: -1,
      equalityIndices: source.rows.map((_, index) => index),
      minForce: -Infinity,
      maxForce: Infinity
    };
  }
  if (boundedIndices.length !== 1) {
    throw new Error(
      'ConstraintBlockSolver4.solve: one-bounded blocks require exactly one bounded row'
    );
  }
  const boundedRowIndex = boundedIndices[0]!;
  const [minForce, maxForce] = forceBounds(source.rows[boundedRowIndex]!);
  return {
    participantA,
    participantB,
    projection,
    boundedRowIndex,
    equalityIndices: source.rows
      .map((_, index) => index)
      .filter((index) => index !== boundedRowIndex),
    minForce,
    maxForce
  };
}

function forceBounds(row: ConstraintRow4): readonly [number, number] {
  const minForce = row.minForce ?? -Infinity;
  const maxForce = row.maxForce ?? Infinity;
  if (
    Number.isNaN(minForce) ||
    Number.isNaN(maxForce) ||
    minForce === Infinity ||
    maxForce === -Infinity ||
    minForce > maxForce
  ) {
    throw new Error(
      'ConstraintBlockSolver4.solve: force bounds must be ordered finite values or outward infinities'
    );
  }
  return [minForce, maxForce];
}

function validateJacobian(jacobian: ConstraintRow4['jacobianA']): void {
  if (
    jacobian.linear.dim !== 4 ||
    jacobian.angular.n !== 4 ||
    Array.from(jacobian.linear.data).some((value) => !Number.isFinite(value)) ||
    Array.from(jacobian.angular.coeffs).some((value) => !Number.isFinite(value))
  ) {
    throw new Error('ConstraintBlockSolver4.solve: rows need finite R4 Jacobians');
  }
}

function decomposeResponse(
  response: Float64Array,
  dimension: number,
  rankTolerance: number
): {
  effectiveMass: Float64Array;
  eigenvalues: Float64Array;
  threshold: number;
  effectiveRank: number;
} {
  const eigensystem = symmetricEigenDecomposition(new MatN(dimension, response), {
    tolerance: Math.min(1e-12, rankTolerance * 0.1),
    symmetryTolerance: 1e-13
  });
  let trace = 0;
  for (let index = 0; index < dimension; index++) {
    trace += response[index * dimension + index]!;
  }
  const scale = trace / dimension;
  const threshold = rankTolerance * Math.max(0, scale);
  const negativeTolerance = Math.max(1e-14 * Math.max(1, scale), threshold);
  if (eigensystem.values[0]! < -negativeTolerance) {
    throw new Error('ConstraintBlockSolver4.solve: response must be positive semidefinite');
  }
  const effectiveMass = new Float64Array(dimension * dimension);
  let effectiveRank = 0;
  for (let eigen = 0; eigen < dimension; eigen++) {
    const value = eigensystem.values[eigen]!;
    if (!(value > threshold)) continue;
    effectiveRank++;
    const inverse = 1 / value;
    for (let row = 0; row < dimension; row++) {
      const vr = eigensystem.vectors.get(row, eigen);
      for (let column = 0; column < dimension; column++) {
        effectiveMass[row * dimension + column]! +=
          inverse * vr * eigensystem.vectors.get(column, eigen);
      }
    }
  }
  return {
    effectiveMass,
    eigenvalues: eigensystem.values,
    threshold,
    effectiveRank
  };
}

function blockBiasSpeed(
  positionError: Float64Array,
  equalityIndices: readonly number[],
  boundedRowIndex: number,
  dt: number,
  baumgarte: number,
  positionSlop: number,
  maxBiasSpeed: number
): Float64Array {
  const bias = new Float64Array(positionError.length);
  const equalityNorm = indexedNorm(positionError, equalityIndices);
  const equalityCorrection = Math.max(0, equalityNorm - positionSlop);
  if (equalityNorm > 0 && equalityCorrection > 0) {
    const scale = -Math.min(
      maxBiasSpeed,
      (baumgarte / dt) * equalityCorrection
    ) / equalityNorm;
    for (const index of equalityIndices) {
      bias[index] = positionError[index]! * scale;
    }
  }
  if (boundedRowIndex >= 0) {
    const error = positionError[boundedRowIndex]!;
    const signedCorrection = Math.sign(error) * Math.max(
      0,
      Math.abs(error) - positionSlop
    );
    const raw = signedCorrection === 0
      ? 0
      : -(baumgarte / dt) * signedCorrection;
    bias[boundedRowIndex] = raw === 0
      ? 0
      : clamp(raw, -maxBiasSpeed, maxBiasSpeed);
  }
  return bias;
}

function schurComplement(
  response: Float64Array,
  dimension: number,
  equalityIndices: readonly number[],
  boundedRowIndex: number,
  equalityEffectiveMass: Float64Array
): number {
  let result = response[boundedRowIndex * dimension + boundedRowIndex]!;
  if (equalityIndices.length === 0) return result;
  const coupling = Float64Array.from(
    equalityIndices,
    (index) => response[index * dimension + boundedRowIndex]!
  );
  const eliminated = applyDense(equalityEffectiveMass, coupling);
  for (let index = 0; index < equalityIndices.length; index++) {
    result -= coupling[index]! * eliminated[index]!;
  }
  return result;
}

function solveOneBoundedDelta(
  block: PreparedConstraintBlock4,
  requested: Float64Array
): Float64Array {
  const delta = new Float64Array(requested.length);
  const requestedEquality = gather(requested, block.equalityIndices);
  const equalityOnlyDelta = applyDense(
    block.equalityEffectiveMass,
    requestedEquality
  );
  let reducedRequest = requested[block.boundedRowIndex]!;
  for (let index = 0; index < block.equalityIndices.length; index++) {
    const equalityIndex = block.equalityIndices[index]!;
    reducedRequest -= block.response[
      block.boundedRowIndex * requested.length + equalityIndex
    ]! * equalityOnlyDelta[index]!;
  }
  const previousBounded = block.accumulatedImpulse[block.boundedRowIndex]!;
  const nextBounded = clamp(
    previousBounded + reducedRequest / block.schurResponse,
    block.minImpulse,
    block.maxImpulse
  );
  const boundedDelta = nextBounded - previousBounded;
  delta[block.boundedRowIndex] = boundedDelta;
  const adjustedEqualityRequest = requestedEquality.slice();
  for (let index = 0; index < block.equalityIndices.length; index++) {
    const equalityIndex = block.equalityIndices[index]!;
    adjustedEqualityRequest[index]! -= block.response[
      equalityIndex * requested.length + block.boundedRowIndex
    ]! * boundedDelta;
  }
  scatter(
    delta,
    block.equalityIndices,
    applyDense(block.equalityEffectiveMass, adjustedEqualityRequest)
  );
  return delta;
}

function projectWarmImpulse(
  block: PreparedConstraintBlock4,
  scaledImpulse: Float64Array,
  projectedSpeed: Float64Array,
  timestepScale: number
): Float64Array {
  const result = scaledImpulse.slice();
  const boundedImpulse = clamp(
    result[block.boundedRowIndex]!,
    block.minImpulse,
    block.maxImpulse
  );
  result[block.boundedRowIndex] = boundedImpulse;
  const equalityEffect = Float64Array.from(
    block.equalityIndices,
    (rowIndex) => timestepScale * projectedSpeed[rowIndex]! -
      block.response[
        rowIndex * result.length + block.boundedRowIndex
      ]! * boundedImpulse
  );
  scatter(
    result,
    block.equalityIndices,
    applyDense(block.equalityEffectiveMass, equalityEffect)
  );
  return result;
}

function boundedResult(
  block: PreparedConstraintBlock4,
  finalSpeed: Float64Array
): ConstraintBlockBoundedCoordinateResult4 {
  const requested = subtract(block.targetSpeed, finalSpeed);
  const requestedEquality = gather(requested, block.equalityIndices);
  const equalityOnlyDelta = applyDense(
    block.equalityEffectiveMass,
    requestedEquality
  );
  let reducedRequest = requested[block.boundedRowIndex]!;
  for (let index = 0; index < block.equalityIndices.length; index++) {
    const equalityIndex = block.equalityIndices[index]!;
    reducedRequest -= block.response[
      block.boundedRowIndex * requested.length + equalityIndex
    ]! * equalityOnlyDelta[index]!;
  }
  const impulse = block.accumulatedImpulse[block.boundedRowIndex]!;
  const projectedImpulse = clamp(
    impulse + reducedRequest / block.schurResponse,
    block.minImpulse,
    block.maxImpulse
  );
  return {
    rowIndex: block.boundedRowIndex,
    schurResponse: block.schurResponse,
    minForce: block.minForce,
    maxForce: block.maxForce,
    minImpulse: block.minImpulse,
    maxImpulse: block.maxImpulse,
    impulseState: classifyImpulseState(
      impulse,
      block.minImpulse,
      block.maxImpulse
    ),
    projectedResidualSpeed: block.schurResponse * (impulse - projectedImpulse)
  };
}

function submatrix(
  source: Float64Array,
  dimension: number,
  indices: readonly number[]
): Float64Array {
  const result = new Float64Array(indices.length * indices.length);
  for (let row = 0; row < indices.length; row++) {
    for (let column = 0; column < indices.length; column++) {
      result[row * indices.length + column] = source[
        indices[row]! * dimension + indices[column]!
      ]!;
    }
  }
  return result;
}

function gather(source: ArrayLike<number>, indices: readonly number[]): Float64Array {
  return Float64Array.from(indices, (index) => source[index]!);
}

function scatter(
  target: Float64Array,
  indices: readonly number[],
  source: ArrayLike<number>
): void {
  for (let index = 0; index < indices.length; index++) {
    target[indices[index]!] = source[index]!;
  }
}

function indexedNorm(vector: ArrayLike<number>, indices: readonly number[]): number {
  let norm = 0;
  for (const index of indices) norm = Math.hypot(norm, vector[index]!);
  return norm;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function classifyImpulseState(
  impulse: number,
  minimum: number,
  maximum: number
): ConstraintImpulseState4 {
  if (minimum === -Infinity && maximum === Infinity) return 'unbounded';
  if (minimum === maximum) return 'fixed';
  if (impulse === minimum) return 'at-minimum';
  if (impulse === maximum) return 'at-maximum';
  return 'within-bounds';
}

function blockSpeed(rows: readonly ConstraintRow4[]): Float64Array {
  return Float64Array.from(rows, constraintRowSpeed4);
}

function applyBlockImpulse(
  rows: readonly ConstraintRow4[],
  impulse: ArrayLike<number>
): void {
  for (let row = 0; row < rows.length; row++) {
    applyConstraintRowImpulse4(rows[row]!, impulse[row]!);
  }
}

function applyDense(matrix: Float64Array, vector: ArrayLike<number>): Float64Array {
  const dimension = vector.length;
  const result = new Float64Array(dimension);
  for (let row = 0; row < dimension; row++) {
    for (let column = 0; column < dimension; column++) {
      result[row]! += matrix[row * dimension + column]! * vector[column]!;
    }
  }
  return result;
}

function add(left: ArrayLike<number>, right: ArrayLike<number>): Float64Array {
  return Float64Array.from(left, (value, index) => value + right[index]!);
}

function subtract(left: ArrayLike<number>, right: ArrayLike<number>): Float64Array {
  return Float64Array.from(left, (value, index) => value - right[index]!);
}

function vectorNorm(vector: ArrayLike<number>): number {
  let norm = 0;
  for (let index = 0; index < vector.length; index++) {
    norm = Math.hypot(norm, vector[index]!);
  }
  return norm;
}

function cloneRowGeometry(row: ConstraintRow4): ConstraintRow4 {
  return {
    id: row.id,
    participantA: row.participantA,
    jacobianA: {
      linear: row.jacobianA.linear.clone(),
      angular: row.jacobianA.angular.clone()
    },
    participantB: row.participantB,
    jacobianB: {
      linear: row.jacobianB.linear.clone(),
      angular: row.jacobianB.angular.clone()
    }
  };
}

function requireNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`ConstraintBlockSolver4: ${name} must be finite and non-negative`);
  }
}

function requirePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`ConstraintBlockSolver4: ${name} must be finite and positive`);
  }
}
