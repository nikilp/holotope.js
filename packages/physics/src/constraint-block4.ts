import {
  MatN,
  symmetricEigenDecomposition
} from '@holotope/core';
import {
  applyConstraintRowImpulse4,
  constraintRowCoupling4,
  constraintRowSpeed4,
  type ConstraintParticipant4,
  type ConstraintRow4
} from './constraint-row4.js';
import { RigidBody4 } from './rigid-body4.js';

export type ConstraintBlockRankPolicy4 = 'reject' | 'minimum-norm';

/** One coupled block of one to six unbounded bilateral rigid-Jacobian rows. */
export interface ConstraintBlock4 {
  /** Must be unique within a solver; persistent IDs retain warm impulses. */
  readonly id: string;
  readonly rows: readonly ConstraintRow4[];
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
}

export interface ConstraintBlockSolveResult4 {
  readonly blocks: readonly ConstraintBlockResult4[];
  readonly retiredIds: readonly string[];
  readonly iterations: number;
  /** Sum of Euclidean coordinate-impulse norms; diagnostic only. */
  readonly sumCoordinateImpulseNorms: number;
  readonly maxResidualNorm: number;
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
}

/**
 * Warm-started equality-block solver for one to six R4 rigid-Jacobian rows.
 *
 * Bias limiting and warm-start projection operate on the complete coordinate
 * vector, so an orthogonal change of row basis does not change the world solve.
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
        residualNorm: vectorNorm(residualSpeed)
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
    const { participantA, participantB } = validateBlock(source);
    const response = constraintBlockResponseMatrix4(source.rows);
    const spectral = decomposeResponse(
      response,
      source.rows.length,
      this.rankTolerance
    );
    if (
      this.rankPolicy === 'reject' &&
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
    const errorNorm = vectorNorm(initialPositionError);
    const correction = Math.max(0, errorNorm - this.positionSlop);
    const biasSpeed = new Float64Array(source.rows.length);
    if (errorNorm > 0 && correction > 0) {
      const scale = -Math.min(
        this.maxBiasSpeed,
        (this.baumgarte / dt) * correction
      ) / errorNorm;
      for (let index = 0; index < biasSpeed.length; index++) {
        biasSpeed[index] = initialPositionError[index]! * scale;
      }
    }
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
      accumulatedImpulse: new Float64Array(source.rows.length)
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
    const impulse = applyDense(
      block.effectiveMass,
      projectedSpeed
    );
    const timestepScale = dt / cached.dt;
    for (let index = 0; index < impulse.length; index++) {
      impulse[index]! *= timestepScale;
    }
    block.warmStartedImpulse.set(impulse);
    block.accumulatedImpulse.set(impulse);
    applyBlockImpulse(block.source.rows, impulse);
  }

  private solveBlock(block: PreparedConstraintBlock4): void {
    const requested = subtract(block.targetSpeed, blockSpeed(block.source.rows));
    const delta = applyDense(block.effectiveMass, requested);
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
  for (const row of source.rows) {
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
    if (
      (row.minForce !== undefined && row.minForce !== -Infinity) ||
      (row.maxForce !== undefined && row.maxForce !== Infinity)
    ) {
      throw new Error('ConstraintBlockSolver4.solve: equality blocks cannot contain bounded rows');
    }
  }
  return { participantA, participantB };
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
