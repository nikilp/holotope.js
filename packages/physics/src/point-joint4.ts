import { VecN } from '@holotope/core';
import {
  ConstraintBlockSolver4,
  constraintBlockResponseMatrix4
} from './constraint-block4.js';
import {
  applyPointPairImpulse4,
  pointConstraintRow4,
  type ConstraintParticipant4,
  type ConstraintRow4
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
  private readonly blockSolver: ConstraintBlockSolver4;

  constructor(options: PointJointSolver4Options = {}) {
    this.iterations = options.iterations ?? 8;
    this.baumgarte = options.baumgarte ?? 0.2;
    this.positionSlop = options.positionSlop ?? 0.001;
    this.maxBiasSpeed = options.maxBiasSpeed ?? 2;
    this.warmStart = options.warmStart ?? true;
    this.blockSolver = new ConstraintBlockSolver4({
      iterations: this.iterations,
      baumgarte: this.baumgarte,
      positionSlop: this.positionSlop,
      maxBiasSpeed: this.maxBiasSpeed,
      warmStart: this.warmStart
    });
  }

  solve(
    constraints: readonly PointJointConstraint4[],
    dt: number
  ): PointJointSolveResult4 {
    const blocks = constraints.map((constraint) => pointJointBlock4(constraint));
    const solved = this.blockSolver.solve(blocks, dt);
    const joints = solved.blocks.map((block, index): PointJointResult4 => {
      const source = constraints[index]!;
      return {
        id: source.id,
        initialError: new VecN(block.initialPositionError),
        initialRelativeVelocity: new VecN(block.initialSpeed),
        targetRelativeVelocity: new VecN(block.targetSpeed),
        response: block.response,
        effectiveMass: block.effectiveMass,
        warmStartedImpulse: new VecN(block.warmStartedImpulse),
        accumulatedImpulse: new VecN(block.accumulatedImpulse),
        finalRelativeVelocity: new VecN(block.finalSpeed),
        residualVelocity: new VecN(block.residualSpeed)
      };
    });
    return {
      joints,
      retiredIds: solved.retiredIds,
      iterations: solved.iterations,
      totalImpulse: solved.sumCoordinateImpulseNorms,
      maxResidualSpeed: solved.maxResidualNorm,
      maxAnchorError: solved.maxPositionErrorNorm
    };
  }

  reset(): void {
    this.blockSolver.reset();
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
  return constraintBlockResponseMatrix4(pointJointRows4(constraint));
}

function pointJointBlock4(constraint: PointJointConstraint4): {
  id: string;
  rows: readonly ConstraintRow4[];
} {
  assertVector4(constraint.anchorA, 'anchorA');
  assertVector4(constraint.anchorB, 'anchorB');
  return { id: constraint.id, rows: pointJointRows4(constraint) };
}

function pointJointRows4(
  constraint: PointJointConstraint4
): readonly ConstraintRow4[] {
  const error = constraint.anchorA.clone().sub(constraint.anchorB);
  return Array.from({ length: 4 }, (_, axis) =>
    pointConstraintRow4({
      id: `${constraint.id}|${axis}`,
      participantA: constraint.participantA,
      participantB: constraint.participantB,
      anchorA: constraint.anchorA,
      anchorB: constraint.anchorB,
      direction: VecN.basis(4, axis),
      positionError: error.data[axis]!
    })
  );
}

/** Applies equal and opposite world impulses at the two joint anchors. */
export function applyPairPointImpulse4(
  constraint: PointJointConstraint4,
  impulseWorld: VecN
): void {
  assertVector4(impulseWorld, 'impulseWorld');
  applyPointPairImpulse4(constraint, impulseWorld);
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
