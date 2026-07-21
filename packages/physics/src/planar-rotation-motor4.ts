import { VecN } from '@holotope/core';
import type { ConstraintBlock4 } from './constraint-block4.js';
import type { ConstraintRow4 } from './constraint-row4.js';
import {
  PlanarRotationCoordinate4,
  type PlanarRotationCoordinateEvaluation4
} from './planar-rotation-coordinate4.js';

export interface PlanarRotationMotor4Options {
  readonly coordinate: PlanarRotationCoordinate4;
  /** Positive follows the coordinate's oriented complementary-plane generator. */
  readonly targetSpeed: number;
  /** Symmetric generalized torque limit. */
  readonly maxTorque: number;
}

export interface PlanarRotationMotorConstraint4 {
  readonly status: 'regular';
  readonly coordinate: Extract<
    PlanarRotationCoordinateEvaluation4,
    { readonly status: 'regular' }
  >;
  readonly block: ConstraintBlock4;
  readonly phaseRow: ConstraintRow4;
  readonly targetSpeed: number;
  readonly maxTorque: number;
}

export type PlanarRotationMotorEvaluation4 =
  | PlanarRotationMotorConstraint4
  | Exclude<
      PlanarRotationCoordinateEvaluation4,
      { readonly status: 'regular' }
    >;

/** Torque-limited velocity motor for a continuous planar SO(2) coordinate. */
export class PlanarRotationMotor4 {
  readonly coordinate: PlanarRotationCoordinate4;
  targetSpeed: number;
  maxTorque: number;

  constructor(options: PlanarRotationMotor4Options) {
    this.coordinate = options.coordinate;
    this.targetSpeed = options.targetSpeed;
    this.maxTorque = options.maxTorque;
    this.assertPolicy();
  }

  constraint(options: {
    readonly halfTurnDirection?: 1 | -1;
  } = {}): PlanarRotationMotorEvaluation4 {
    this.assertPolicy();
    const coordinate = this.coordinate.evaluation(options);
    if (coordinate.status !== 'regular') return coordinate;
    const participantA = coordinate.constraint.block.rows[0]!.participantA;
    const participantB = coordinate.constraint.block.rows[0]!.participantB;
    const phaseRow: ConstraintRow4 = {
      id: `${this.coordinate.joint.id}|motor:phase`,
      participantA,
      jacobianA: {
        linear: new VecN(4),
        angular: coordinate.generator.clone()
      },
      participantB,
      jacobianB: {
        linear: new VecN(4),
        angular: coordinate.generator.clone().scale(-1)
      },
      velocityTarget: this.targetSpeed,
      minForce: -this.maxTorque,
      maxForce: this.maxTorque
    };
    return {
      status: 'regular',
      coordinate,
      block: {
        id: `${this.coordinate.joint.id}:motor`,
        rows: [...coordinate.constraint.block.rows, phaseRow],
        projection: { kind: 'one-bounded' }
      },
      phaseRow,
      targetSpeed: this.targetSpeed,
      maxTorque: this.maxTorque
    };
  }

  private assertPolicy(): void {
    if (!Number.isFinite(this.targetSpeed)) {
      throw new Error('PlanarRotationMotor4: targetSpeed must be finite');
    }
    if (!Number.isFinite(this.maxTorque) || this.maxTorque < 0) {
      throw new Error(
        'PlanarRotationMotor4: maxTorque must be finite and non-negative'
      );
    }
  }
}
