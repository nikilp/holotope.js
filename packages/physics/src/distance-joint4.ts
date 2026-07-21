import { VecN } from '@holotope/core';
import {
  pointConstraintRow4,
  type ConstraintRow4
} from './constraint-row4.js';
import {
  evaluateDistanceCoordinateN,
  type DistanceConstraintEvaluationN,
  type DistanceCoordinateEvaluationN
} from './distance-coordinate-n.js';
import { RigidBody4 } from './rigid-body4.js';

interface DistanceCoordinate4BaseOptions {
  readonly id: string;
  readonly bodyA: RigidBody4;
  readonly localAnchorA: VecN | ArrayLike<number>;
  /** Coherent distance gradient used only when the two anchors coincide. */
  readonly directionHint?: VecN | ArrayLike<number>;
}

export type DistanceCoordinate4Options = DistanceCoordinate4BaseOptions & (
  | {
      readonly bodyB: RigidBody4;
      readonly localAnchorB: VecN | ArrayLike<number>;
    }
  | {
      readonly bodyB?: null;
      readonly worldAnchorB: VecN | ArrayLike<number>;
    }
);

/** Reusable local/world anchor binding for one scalar distance coordinate. */
export class DistanceCoordinate4 {
  readonly id: string;
  readonly bodyA: RigidBody4;
  readonly localAnchorA: VecN;
  readonly bodyB: RigidBody4 | null;
  readonly anchorB: VecN;
  protected directionHint: VecN | undefined;

  constructor(options: DistanceCoordinate4Options) {
    if (options.id.length === 0) {
      throw new Error('DistanceCoordinate4: id must not be empty');
    }
    this.id = options.id;
    this.bodyA = options.bodyA;
    this.localAnchorA = vector4(options.localAnchorA, 'localAnchorA');
    this.bodyB = options.bodyB ?? null;
    this.anchorB = 'localAnchorB' in options
      ? vector4(options.localAnchorB, 'localAnchorB')
      : vector4(options.worldAnchorB, 'worldAnchorB');
    if (this.bodyA === this.bodyB) {
      throw new Error('DistanceCoordinate4: a body cannot be joined to itself');
    }
    this.directionHint = options.directionHint === undefined
      ? undefined
      : vector4(options.directionHint, 'directionHint');
    if (
      this.directionHint !== undefined &&
      !(this.directionHint.length() > 1e-15)
    ) {
      throw new Error('DistanceCoordinate4: directionHint must be nonzero');
    }
    this.directionHint?.normalize();
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

  evaluation(): DistanceCoordinateEvaluationN {
    return this.evaluateAnchors(this.worldAnchorA(), this.worldAnchorB());
  }

  protected evaluateAnchors(
    anchorA: VecN,
    anchorB: VecN
  ): DistanceCoordinateEvaluationN {
    const evaluation = evaluateDistanceCoordinateN(
      anchorA,
      anchorB,
      this.directionHint
    );
    this.directionHint = evaluation.direction.clone();
    return evaluation;
  }
}

export interface DistanceJointConstraint4 extends ConstraintRow4 {
  readonly anchorA: VecN;
  readonly anchorB: VecN;
  readonly direction: VecN;
  readonly currentLength: number;
  readonly restLength: number;
  readonly positionError: number;
}

export type DistanceJoint4Options = DistanceCoordinate4Options & {
  /** Captures the construction-pose distance when omitted. */
  readonly restLength?: number;
};

/** Persistent local-anchor binding for a rigid R4 distance equality. */
export class DistanceJoint4 extends DistanceCoordinate4 {
  readonly restLength: number;

  constructor(options: DistanceJoint4Options) {
    super(options);
    const initialA = this.worldAnchorA();
    const initialB = this.worldAnchorB();
    const initialLength = initialA.clone().sub(initialB).length();
    this.restLength = options.restLength ?? initialLength;
    if (!Number.isFinite(this.restLength) || this.restLength <= 0) {
      throw new Error(
        'DistanceJoint4: restLength must be finite and positive; use PointJoint4 for zero length'
      );
    }
    this.evaluateAnchors(initialA, initialB);
  }

  override evaluation(): DistanceConstraintEvaluationN {
    const coordinate = super.evaluation();
    return {
      ...coordinate,
      error: coordinate.distance - this.restLength
    };
  }

  constraint(): DistanceJointConstraint4 {
    const anchorA = this.worldAnchorA();
    const anchorB = this.worldAnchorB();
    const coordinate = this.evaluateAnchors(anchorA, anchorB);
    const positionError = coordinate.distance - this.restLength;
    const row = pointConstraintRow4({
      id: this.id,
      participantA: this.bodyA,
      participantB: this.bodyB,
      anchorA,
      anchorB,
      direction: coordinate.direction,
      positionError
    });
    return {
      ...row,
      anchorA,
      anchorB,
      direction: coordinate.direction,
      currentLength: coordinate.distance,
      restLength: this.restLength,
      positionError
    };
  }
}

function vector4(value: VecN | ArrayLike<number>, name: string): VecN {
  const vector = value instanceof VecN ? value.clone() : new VecN(value);
  if (
    vector.dim !== 4 ||
    Array.from(vector.data).some((entry) => !Number.isFinite(entry))
  ) {
    throw new Error(`DistanceCoordinate4: ${name} must contain four finite coordinates`);
  }
  return vector;
}
