import { VecN } from '@holotope/core';
import type { ConstraintBlock4 } from './constraint-block4.js';
import type { ConstraintRow4 } from './constraint-row4.js';
import {
  PlanarRotationCoordinate4,
  type PlanarRotationCoordinateEvaluation4
} from './planar-rotation-coordinate4.js';

export type PlanarRotationIntervalState4 =
  | 'inactive'
  | 'minimum'
  | 'maximum';

export interface PlanarRotationInterval4Options {
  readonly coordinate: PlanarRotationCoordinate4;
  readonly minAngle: number;
  readonly maxAngle: number;
}

export interface PlanarRotationIntervalObservation4 {
  readonly status: 'regular';
  readonly coordinate: Extract<
    PlanarRotationCoordinateEvaluation4,
    { readonly status: 'regular' }
  >;
  readonly state: PlanarRotationIntervalState4;
  readonly predictive: boolean;
  readonly angle: number;
  readonly angularSpeed: number;
  readonly predictedAngle: number;
  readonly minAngle: number;
  readonly maxAngle: number;
}

export interface PlanarRotationIntervalConstraint4 {
  readonly limit: 'minimum' | 'maximum';
  readonly predictive: boolean;
  readonly angle: number;
  readonly boundAngle: number;
  readonly positionError: number;
  readonly velocityTarget: number;
  readonly phaseRow: ConstraintRow4;
  readonly block: ConstraintBlock4;
}

export interface PlanarRotationIntervalConstraints4 {
  readonly status: 'regular';
  readonly coordinate: Extract<
    PlanarRotationCoordinateEvaluation4,
    { readonly status: 'regular' }
  >;
  readonly constraints: readonly [
    PlanarRotationIntervalConstraint4,
    PlanarRotationIntervalConstraint4
  ];
}

export type PlanarRotationIntervalEvaluation4 =
  | PlanarRotationIntervalObservation4
  | Exclude<
      PlanarRotationCoordinateEvaluation4,
      { readonly status: 'regular' }
    >;

export type PlanarRotationIntervalConstraintEvaluation4 =
  | PlanarRotationIntervalConstraints4
  | Exclude<
      PlanarRotationCoordinateEvaluation4,
      { readonly status: 'regular' }
    >;

/** Two-sided unwrapped-angle interval represented by persistent guardian blocks. */
export class PlanarRotationIntervalJoint4 {
  readonly coordinate: PlanarRotationCoordinate4;
  readonly minAngle: number;
  readonly maxAngle: number;

  constructor(options: PlanarRotationInterval4Options) {
    this.coordinate = options.coordinate;
    this.minAngle = options.minAngle;
    this.maxAngle = options.maxAngle;
    if (!Number.isFinite(this.minAngle) || !Number.isFinite(this.maxAngle)) {
      throw new Error('PlanarRotationIntervalJoint4: angle bounds must be finite');
    }
    if (this.maxAngle <= this.minAngle) {
      throw new Error(
        'PlanarRotationIntervalJoint4: maxAngle must exceed minAngle'
      );
    }
  }

  interval(
    dt: number,
    options: { readonly halfTurnDirection?: 1 | -1 } = {}
  ): PlanarRotationIntervalEvaluation4 {
    this.assertDt(dt, 'interval');
    const coordinate = this.coordinate.evaluation(options);
    if (coordinate.status !== 'regular') return coordinate;
    const predictedAngle = coordinate.angle + coordinate.angularSpeed * dt;
    let state: PlanarRotationIntervalState4 = 'inactive';
    let predictive = false;
    if (coordinate.angle <= this.minAngle) {
      if (predictedAngle > this.maxAngle) {
        state = 'maximum';
        predictive = true;
      } else {
        state = 'minimum';
      }
    } else if (coordinate.angle >= this.maxAngle) {
      if (predictedAngle < this.minAngle) {
        state = 'minimum';
        predictive = true;
      } else {
        state = 'maximum';
      }
    } else if (predictedAngle < this.minAngle) {
      state = 'minimum';
      predictive = true;
    } else if (predictedAngle > this.maxAngle) {
      state = 'maximum';
      predictive = true;
    }
    return {
      status: 'regular',
      coordinate,
      state,
      predictive,
      angle: coordinate.angle,
      angularSpeed: coordinate.angularSpeed,
      predictedAngle,
      minAngle: this.minAngle,
      maxAngle: this.maxAngle
    };
  }

  constraints(
    dt: number,
    options: { readonly halfTurnDirection?: 1 | -1 } = {}
  ): PlanarRotationIntervalConstraintEvaluation4 {
    this.assertDt(dt, 'constraints');
    const coordinate = this.coordinate.evaluation(options);
    if (coordinate.status !== 'regular') return coordinate;
    const minimumError = Math.min(0, coordinate.angle - this.minAngle);
    const maximumError = Math.max(0, coordinate.angle - this.maxAngle);
    const minimumTarget = minimumError < 0
      ? 0
      : (this.minAngle - coordinate.angle) / dt;
    const maximumTarget = maximumError > 0
      ? 0
      : (this.maxAngle - coordinate.angle) / dt;
    return {
      status: 'regular',
      coordinate,
      constraints: [
        this.buildConstraint(
          coordinate,
          'minimum',
          minimumError,
          minimumTarget
        ),
        this.buildConstraint(
          coordinate,
          'maximum',
          maximumError,
          maximumTarget
        )
      ]
    };
  }

  private buildConstraint(
    coordinate: Extract<
      PlanarRotationCoordinateEvaluation4,
      { readonly status: 'regular' }
    >,
    limit: 'minimum' | 'maximum',
    positionError: number,
    velocityTarget: number
  ): PlanarRotationIntervalConstraint4 {
    const participantA = coordinate.constraint.block.rows[0]!.participantA;
    const participantB = coordinate.constraint.block.rows[0]!.participantB;
    const phaseRow: ConstraintRow4 = {
      id: `${this.coordinate.joint.id}|interval:${limit}:phase`,
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
      positionError,
      velocityTarget,
      ...(limit === 'minimum' ? { minForce: 0 } : { maxForce: 0 })
    };
    const boundAngle = limit === 'minimum' ? this.minAngle : this.maxAngle;
    return {
      limit,
      predictive: positionError === 0,
      angle: coordinate.angle,
      boundAngle,
      positionError,
      velocityTarget,
      phaseRow,
      block: {
        id: `${this.coordinate.joint.id}:interval:${limit}`,
        rows: [...coordinate.constraint.block.rows, phaseRow],
        projection: { kind: 'one-bounded' }
      }
    };
  }

  private assertDt(dt: number, method: string): void {
    if (!Number.isFinite(dt) || dt <= 0) {
      throw new Error(
        `PlanarRotationIntervalJoint4.${method}: dt must be finite and positive`
      );
    }
  }
}
