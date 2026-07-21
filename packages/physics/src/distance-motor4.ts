import { VecN } from '@holotope/core';
import {
  pointConstraintRow4,
  type ConstraintRow4
} from './constraint-row4.js';
import {
  DistanceCoordinate4,
  type DistanceCoordinate4Options
} from './distance-joint4.js';

export interface DistanceMotorConstraint4 extends ConstraintRow4 {
  readonly anchorA: VecN;
  readonly anchorB: VecN;
  readonly direction: VecN;
  readonly currentLength: number;
  readonly velocityTarget: number;
  readonly minForce: number;
  readonly maxForce: number;
}

export type DistanceMotor4Options = DistanceCoordinate4Options & {
  /** Positive lengthens the coordinate; negative shortens it. */
  readonly targetSpeed: number;
  /** Symmetric generalized-force limit. */
  readonly maxForce: number;
};

/** Force-limited velocity motor for one R4 distance coordinate. */
export class DistanceMotor4 extends DistanceCoordinate4 {
  targetSpeed: number;
  maxForce: number;

  constructor(options: DistanceMotor4Options) {
    super(options);
    this.targetSpeed = options.targetSpeed;
    this.maxForce = options.maxForce;
    this.assertPolicy();
    // A motor at coincidence needs an authored direction before it can define
    // positive lengthening.
    this.evaluation();
  }

  constraint(): DistanceMotorConstraint4 {
    this.assertPolicy();
    const anchorA = this.worldAnchorA();
    const anchorB = this.worldAnchorB();
    const coordinate = this.evaluateAnchors(anchorA, anchorB);
    const row = pointConstraintRow4({
      id: `${this.id}:motor`,
      participantA: this.bodyA,
      participantB: this.bodyB,
      anchorA,
      anchorB,
      direction: coordinate.direction,
      velocityTarget: this.targetSpeed,
      minForce: -this.maxForce,
      maxForce: this.maxForce
    });
    return {
      ...row,
      anchorA,
      anchorB,
      direction: coordinate.direction,
      currentLength: coordinate.distance,
      velocityTarget: this.targetSpeed,
      minForce: -this.maxForce,
      maxForce: this.maxForce
    };
  }

  private assertPolicy(): void {
    if (!Number.isFinite(this.targetSpeed)) {
      throw new Error('DistanceMotor4: targetSpeed must be finite');
    }
    if (!Number.isFinite(this.maxForce) || this.maxForce < 0) {
      throw new Error('DistanceMotor4: maxForce must be finite and non-negative');
    }
  }
}
