import { VecN } from '@holotope/core';
import {
  applyPointPairImpulse4,
  constraintRowCoupling4,
  pointConstraintRow4,
  pointPairRelativeVelocity4,
  type ConstraintParticipant4
} from './constraint-row4.js';
import { RigidBody4 } from './rigid-body4.js';

/** Dynamic body, prescribed rigid motion, or a fixed world participant. */
export type PointJointParticipant4 = ConstraintParticipant4;

/** Four coupled bilateral velocity constraints at a pair of world-space anchors. */
export interface PointJointConstraint4 {
  /** Must be unique within a solver; persistent IDs retain warm impulses. */
  readonly id: string;
  readonly participantA: PointJointParticipant4;
  readonly participantB: PointJointParticipant4;
  /** Current world-space anchor attached to participant A. */
  readonly anchorA: VecN;
  /** Current world-space anchor attached to participant B. */
  readonly anchorB: VecN;
}

export interface PointJointSolver4Options {
  /** Block Gauss-Seidel passes. Default 8. */
  readonly iterations?: number;
  /** Fraction of anchor error corrected per step. Default 0.2. */
  readonly baumgarte?: number;
  /** Anchor error ignored by velocity-level bias. Default 0.001. */
  readonly positionSlop?: number;
  /** Upper bound on the bias target's R4 speed. Default 2. */
  readonly maxBiasSpeed?: number;
  /** Apply coherent impulses retained from the previous solve. Default true. */
  readonly warmStart?: boolean;
}

export interface PointJointResult4 {
  readonly id: string;
  /** Initial world-space anchor error `anchorA - anchorB`. */
  readonly initialError: VecN;
  readonly initialRelativeVelocity: VecN;
  /** Desired `velocityA - velocityB`, including bounded position bias. */
  readonly targetRelativeVelocity: VecN;
  /** Row-major 4x4 map from world impulse to relative anchor velocity. */
  readonly response: Float64Array;
  /** Row-major inverse of `response`. */
  readonly effectiveMass: Float64Array;
  readonly warmStartedImpulse: VecN;
  readonly accumulatedImpulse: VecN;
  readonly finalRelativeVelocity: VecN;
  readonly residualVelocity: VecN;
}

export interface PointJointSolveResult4 {
  readonly joints: readonly PointJointResult4[];
  readonly retiredIds: readonly string[];
  readonly iterations: number;
  readonly totalImpulse: number;
  readonly maxResidualSpeed: number;
  readonly maxAnchorError: number;
}

interface CachedPointJointImpulse4 {
  impulseWorld: VecN;
  dt: number;
  participantA: PointJointParticipant4;
  participantB: PointJointParticipant4;
}

interface PreparedPointJoint4 {
  source: PointJointConstraint4;
  initialError: VecN;
  initialRelativeVelocity: VecN;
  targetRelativeVelocity: VecN;
  response: Float64Array;
  cholesky: Float64Array;
  effectiveMass: Float64Array;
  warmStartedImpulse: VecN;
  accumulatedImpulse: VecN;
}

/**
 * Warm-started R4 point-joint solver.
 *
 * A point joint removes all four components of relative anchor velocity in one
 * coupled solve. Off-centre impulses therefore include the complete 4D
 * translational/rotational response rather than treating axes independently.
 */
export class PointJointSolver4 {
  readonly iterations: number;
  readonly baumgarte: number;
  readonly positionSlop: number;
  readonly maxBiasSpeed: number;
  readonly warmStart: boolean;
  private cache = new Map<string, CachedPointJointImpulse4>();

  constructor(options: PointJointSolver4Options = {}) {
    this.iterations = options.iterations ?? 8;
    this.baumgarte = options.baumgarte ?? 0.2;
    this.positionSlop = options.positionSlop ?? 0.001;
    this.maxBiasSpeed = options.maxBiasSpeed ?? 2;
    this.warmStart = options.warmStart ?? true;
    if (!Number.isSafeInteger(this.iterations) || this.iterations < 1) {
      throw new Error('PointJointSolver4: iterations must be a positive integer');
    }
    assertNonNegativeFinite('baumgarte', this.baumgarte);
    assertNonNegativeFinite('positionSlop', this.positionSlop);
    assertNonNegativeFinite('maxBiasSpeed', this.maxBiasSpeed);
  }

  solve(
    constraints: readonly PointJointConstraint4[],
    dt: number
  ): PointJointSolveResult4 {
    if (!Number.isFinite(dt) || dt <= 0) {
      throw new Error('PointJointSolver4.solve: dt must be finite and positive');
    }
    const seen = new Set<string>();
    const prepared = constraints.map((constraint) => {
      if (constraint.id.length === 0) {
        throw new Error('PointJointSolver4.solve: joint IDs must not be empty');
      }
      if (seen.has(constraint.id)) {
        throw new Error(`PointJointSolver4.solve: duplicate joint ID ${constraint.id}`);
      }
      seen.add(constraint.id);
      return this.prepare(constraint, dt);
    });
    const retiredIds = Array.from(this.cache.keys())
      .filter((id) => !seen.has(id))
      .sort();

    if (this.warmStart) {
      for (const joint of prepared) this.applyWarmStart(joint, dt);
    }
    for (let iteration = 0; iteration < this.iterations; iteration++) {
      for (const joint of prepared) this.solveJoint(joint);
    }

    const nextCache = new Map<string, CachedPointJointImpulse4>();
    const joints = prepared.map((joint): PointJointResult4 => {
      const finalRelativeVelocity = relativeAnchorVelocity(joint.source);
      const residualVelocity = finalRelativeVelocity
        .clone()
        .sub(joint.targetRelativeVelocity);
      nextCache.set(joint.source.id, {
        impulseWorld: joint.accumulatedImpulse.clone(),
        dt,
        participantA: joint.source.participantA,
        participantB: joint.source.participantB
      });
      return {
        id: joint.source.id,
        initialError: joint.initialError.clone(),
        initialRelativeVelocity: joint.initialRelativeVelocity.clone(),
        targetRelativeVelocity: joint.targetRelativeVelocity.clone(),
        response: joint.response.slice(),
        effectiveMass: joint.effectiveMass.slice(),
        warmStartedImpulse: joint.warmStartedImpulse.clone(),
        accumulatedImpulse: joint.accumulatedImpulse.clone(),
        finalRelativeVelocity,
        residualVelocity
      };
    });
    this.cache = nextCache;
    return {
      joints,
      retiredIds,
      iterations: this.iterations,
      totalImpulse: joints.reduce(
        (total, joint) => total + joint.accumulatedImpulse.length(),
        0
      ),
      maxResidualSpeed: joints.reduce(
        (maximum, joint) => Math.max(maximum, joint.residualVelocity.length()),
        0
      ),
      maxAnchorError: joints.reduce(
        (maximum, joint) => Math.max(maximum, joint.initialError.length()),
        0
      )
    };
  }

  reset(): void {
    this.cache.clear();
  }

  private prepare(
    source: PointJointConstraint4,
    dt: number
  ): PreparedPointJoint4 {
    if (
      source.participantA instanceof RigidBody4 &&
      source.participantA === source.participantB
    ) {
      throw new Error('PointJointSolver4.solve: a body cannot be joined to itself');
    }
    assertVector4(source.anchorA, 'anchorA');
    assertVector4(source.anchorB, 'anchorB');
    const response = pointJointResponseMatrix4(source);
    const cholesky = cholesky4(response);
    const effectiveMass = inverseFromCholesky4(cholesky);
    const initialError = source.anchorA.clone().sub(source.anchorB);
    const initialRelativeVelocity = relativeAnchorVelocity(source);
    const errorLength = initialError.length();
    const correctionDistance = Math.max(0, errorLength - this.positionSlop);
    const targetRelativeVelocity = errorLength > 0 && correctionDistance > 0
      ? initialError
        .clone()
        .multiplyScalar(-Math.min(
          this.maxBiasSpeed,
          (this.baumgarte / dt) * correctionDistance
        ) / errorLength)
      : new VecN(4);
    return {
      source,
      initialError,
      initialRelativeVelocity,
      targetRelativeVelocity,
      response,
      cholesky,
      effectiveMass,
      warmStartedImpulse: new VecN(4),
      accumulatedImpulse: new VecN(4)
    };
  }

  private applyWarmStart(joint: PreparedPointJoint4, dt: number): void {
    const cached = this.cache.get(joint.source.id);
    if (
      !cached ||
      cached.participantA !== joint.source.participantA ||
      cached.participantB !== joint.source.participantB
    ) {
      return;
    }
    const impulse = cached.impulseWorld.clone().multiplyScalar(dt / cached.dt);
    joint.warmStartedImpulse.copy(impulse);
    joint.accumulatedImpulse.copy(impulse);
    applyPairPointImpulse4(joint.source, impulse);
  }

  private solveJoint(joint: PreparedPointJoint4): void {
    const velocityError = joint.targetRelativeVelocity
      .clone()
      .sub(relativeAnchorVelocity(joint.source));
    const impulseDelta = solveCholesky4(joint.cholesky, velocityError.data);
    joint.accumulatedImpulse.add(new VecN(impulseDelta));
    applyPairPointImpulse4(joint.source, new VecN(impulseDelta));
  }
}

export type PointJoint4Options =
  | {
      readonly id: string;
      readonly bodyA: RigidBody4;
      readonly localAnchorA: VecN | ArrayLike<number>;
      readonly bodyB: RigidBody4;
      readonly localAnchorB: VecN | ArrayLike<number>;
    }
  | {
      readonly id: string;
      readonly bodyA: RigidBody4;
      readonly localAnchorA: VecN | ArrayLike<number>;
      readonly bodyB?: null;
      readonly worldAnchorB: VecN | ArrayLike<number>;
    };

/** Persistent local-anchor binding that resolves a fresh solver constraint. */
export class PointJoint4 {
  readonly id: string;
  readonly bodyA: RigidBody4;
  readonly localAnchorA: VecN;
  readonly bodyB: RigidBody4 | null;
  readonly anchorB: VecN;

  constructor(options: PointJoint4Options) {
    if (options.id.length === 0) {
      throw new Error('PointJoint4: id must not be empty');
    }
    this.id = options.id;
    this.bodyA = options.bodyA;
    this.localAnchorA = vector4(options.localAnchorA, 'localAnchorA');
    this.bodyB = options.bodyB ?? null;
    this.anchorB = 'localAnchorB' in options
      ? vector4(options.localAnchorB, 'localAnchorB')
      : vector4(options.worldAnchorB, 'worldAnchorB');
    if (this.bodyA === this.bodyB) {
      throw new Error('PointJoint4: a body cannot be joined to itself');
    }
  }

  worldAnchorA(): VecN {
    return this.bodyA.rotation
      .applyToPoint(this.localAnchorA)
      .add(this.bodyA.position);
  }

  worldAnchorB(): VecN {
    return this.bodyB === null
      ? this.anchorB.clone()
      : this.bodyB.rotation.applyToPoint(this.anchorB).add(this.bodyB.position);
  }

  constraint(): PointJointConstraint4 {
    return {
      id: this.id,
      participantA: this.bodyA,
      participantB: this.bodyB,
      anchorA: this.worldAnchorA(),
      anchorB: this.worldAnchorB()
    };
  }
}

/** Row-major 4x4 point-impulse response for a bilateral anchor pair. */
export function pointJointResponseMatrix4(
  constraint: PointJointConstraint4
): Float64Array {
  const rows = Array.from({ length: 4 }, (_, axis) =>
    pointConstraintRow4({
      id: `${constraint.id}|${axis}`,
      participantA: constraint.participantA,
      participantB: constraint.participantB,
      anchorA: constraint.anchorA,
      anchorB: constraint.anchorB,
      direction: VecN.basis(4, axis)
    })
  );
  const response = new Float64Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      response[row * 4 + column] = constraintRowCoupling4(
        rows[row]!,
        rows[column]!
      );
    }
  }
  for (let row = 0; row < 4; row++) {
    for (let column = row + 1; column < 4; column++) {
      const symmetric = 0.5 * (
        response[row * 4 + column]! + response[column * 4 + row]!
      );
      response[row * 4 + column] = symmetric;
      response[column * 4 + row] = symmetric;
    }
  }
  return response;
}

/** Applies equal and opposite world impulses at the two joint anchors. */
export function applyPairPointImpulse4(
  constraint: PointJointConstraint4,
  impulseWorld: VecN
): void {
  assertVector4(impulseWorld, 'impulseWorld');
  applyPointPairImpulse4(constraint, impulseWorld);
}

function relativeAnchorVelocity(constraint: PointJointConstraint4): VecN {
  return pointPairRelativeVelocity4(constraint);
}

function cholesky4(matrix: Float64Array): Float64Array {
  const lower = new Float64Array(16);
  const scale = Math.max(matrix[0]!, matrix[5]!, matrix[10]!, matrix[15]!);
  const tolerance = 1e-14 * scale;
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column <= row; column++) {
      let value = matrix[row * 4 + column]!;
      for (let k = 0; k < column; k++) {
        value -= lower[row * 4 + k]! * lower[column * 4 + k]!;
      }
      if (row === column) {
        if (!(value > tolerance) || !Number.isFinite(value)) {
          throw new Error(
            'PointJointSolver4.solve: joint needs a dynamic participant and a positive-definite response'
          );
        }
        lower[row * 4 + column] = Math.sqrt(value);
      } else {
        lower[row * 4 + column] = value / lower[column * 4 + column]!;
      }
    }
  }
  return lower;
}

function solveCholesky4(
  lower: Float64Array,
  rightHandSide: ArrayLike<number>
): Float64Array {
  const intermediate = new Float64Array(4);
  for (let row = 0; row < 4; row++) {
    let value = rightHandSide[row]!;
    for (let column = 0; column < row; column++) {
      value -= lower[row * 4 + column]! * intermediate[column]!;
    }
    intermediate[row] = value / lower[row * 4 + row]!;
  }
  const result = new Float64Array(4);
  for (let row = 3; row >= 0; row--) {
    let value = intermediate[row]!;
    for (let column = row + 1; column < 4; column++) {
      value -= lower[column * 4 + row]! * result[column]!;
    }
    result[row] = value / lower[row * 4 + row]!;
  }
  return result;
}

function inverseFromCholesky4(lower: Float64Array): Float64Array {
  const inverse = new Float64Array(16);
  for (let column = 0; column < 4; column++) {
    const basis = new Float64Array(4);
    basis[column] = 1;
    const solved = solveCholesky4(lower, basis);
    for (let row = 0; row < 4; row++) {
      inverse[row * 4 + column] = solved[row]!;
    }
  }
  return inverse;
}

function vector4(value: VecN | ArrayLike<number>, name: string): VecN {
  const vector = value instanceof VecN ? value.clone() : new VecN(value);
  assertVector4(vector, name);
  return vector;
}

function assertVector4(vector: VecN, name: string): void {
  if (
    vector.dim !== 4 ||
    Array.from(vector.data).some((entry) => !Number.isFinite(entry))
  ) {
    throw new Error(`PointJoint4: ${name} must contain four finite coordinates`);
  }
}

function assertNonNegativeFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`PointJointSolver4: ${name} must be finite and non-negative`);
  }
}
