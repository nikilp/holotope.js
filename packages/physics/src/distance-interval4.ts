import { VecN } from '@holotope/core';
import {
  pointPairRelativeVelocity4,
  pointConstraintRow4,
  type ConstraintRow4
} from './constraint-row4.js';
import {
  DistanceCoordinate4,
  type DistanceCoordinate4Options
} from './distance-joint4.js';

export type DistanceIntervalState4 = 'inactive' | 'minimum' | 'maximum';

export interface DistanceIntervalConstraint4 extends ConstraintRow4 {
  readonly limit: 'minimum' | 'maximum';
  /** True for a first-order boundary guardian; false for outside-range repair. */
  readonly predictive: boolean;
  readonly anchorA: VecN;
  readonly anchorB: VecN;
  /** Unit direction from anchor B toward anchor A. */
  readonly radialDirection: VecN;
  readonly currentLength: number;
  readonly boundLength: number;
  readonly positionError: number;
  readonly velocityTarget: number;
}

export interface DistanceIntervalEvaluation4 {
  readonly state: DistanceIntervalState4;
  /** Whether observed constant-speed motion crosses the reported bound. */
  readonly predictive: boolean;
  readonly currentLength: number;
  readonly distanceSpeed: number;
  readonly predictedLength: number;
  readonly minLength: number;
  readonly maxLength: number;
}

export type DistanceIntervalJoint4Options = DistanceCoordinate4Options & {
  readonly minLength: number;
  readonly maxLength: number;
};

/** Two-sided R4 distance interval implemented as two unilateral guardian rows. */
export class DistanceIntervalJoint4 extends DistanceCoordinate4 {
  readonly minLength: number;
  readonly maxLength: number;

  constructor(options: DistanceIntervalJoint4Options) {
    super(options);
    this.minLength = options.minLength;
    this.maxLength = options.maxLength;
    if (!Number.isFinite(this.minLength) || this.minLength < 0) {
      throw new Error(
        'DistanceIntervalJoint4: minLength must be finite and non-negative'
      );
    }
    if (!Number.isFinite(this.maxLength) || this.maxLength <= this.minLength) {
      throw new Error(
        'DistanceIntervalJoint4: maxLength must be finite and greater than minLength; use DistanceJoint4 for equality'
      );
    }
    const anchorA = this.worldAnchorA();
    const anchorB = this.worldAnchorB();
    if (anchorA.clone().sub(anchorB).length() > 1e-15) {
      this.evaluateAnchors(anchorA, anchorB);
    } else if (this.minLength > 0 && this.directionHint === undefined) {
      throw new Error(
        'DistanceIntervalJoint4: coincident anchors below a positive minimum require a directionHint'
      );
    }
  }

  /** Observes current and constant-speed predicted state without emitting rows. */
  interval(dt: number): DistanceIntervalEvaluation4 {
    if (!Number.isFinite(dt) || dt <= 0) {
      throw new Error(
        'DistanceIntervalJoint4.interval: dt must be finite and positive'
      );
    }
    const anchorA = this.worldAnchorA();
    const anchorB = this.worldAnchorB();
    const delta = anchorA.clone().sub(anchorB);
    const currentLength = delta.length();
    const relativeVelocity = pointPairRelativeVelocity4({
      participantA: this.bodyA,
      participantB: this.bodyB,
      anchorA,
      anchorB
    });

    let radialDirection: VecN;
    let distanceSpeed: number;
    let predictedLength: number;
    let singularMotionDirection: VecN | null = null;
    if (currentLength > 1e-15) {
      const coordinate = this.evaluateAnchors(anchorA, anchorB);
      radialDirection = coordinate.direction;
      distanceSpeed = relativeVelocity.dot(radialDirection);
      predictedLength = currentLength + distanceSpeed * dt;
    } else {
      // At coincidence, the one-sided derivative of norm(delta) is
      // norm(relativeVelocity), regardless of any previously retained hint.
      // This observed direction is the only honest predictor of a far-bound
      // crossing; an authored hint remains the recovery direction for a
      // violated positive minimum.
      distanceSpeed = relativeVelocity.length();
      predictedLength = distanceSpeed * dt;
      if (distanceSpeed > 1e-15) {
        singularMotionDirection = relativeVelocity.clone().normalize();
      }
      radialDirection = this.directionHint?.clone() ??
        singularMotionDirection?.clone() ?? new VecN(4);
    }

    let limit: 'minimum' | 'maximum' | null = null;
    let predictive = false;
    if (currentLength <= this.minLength) {
      // A fast recovery can traverse the full allowed span in one step. The
      // minimum row cannot slow outward motion, so the destination maximum
      // must take precedence in that case.
      if (predictedLength > this.maxLength) {
        limit = 'maximum';
        predictive = true;
      } else if (currentLength === 0 && this.minLength === 0) {
        return this.inactive(currentLength, distanceSpeed, predictedLength);
      } else {
        limit = 'minimum';
      }
    } else if (currentLength >= this.maxLength) {
      // Symmetrically, a fast inward recovery may need the destination
      // minimum rather than the currently violated maximum.
      if (predictedLength < this.minLength) {
        limit = 'minimum';
        predictive = true;
      } else {
        limit = 'maximum';
      }
    } else if (predictedLength < this.minLength) {
      limit = 'minimum';
      predictive = true;
    } else if (predictedLength > this.maxLength) {
      limit = 'maximum';
      predictive = true;
    }

    if (limit === null) {
      return this.inactive(currentLength, distanceSpeed, predictedLength);
    }

    if (
      currentLength === 0 &&
      limit === 'maximum' &&
      singularMotionDirection !== null
    ) {
      radialDirection = singularMotionDirection;
    }
    if (!(radialDirection.length() > 1e-15)) {
      throw new Error(
        'DistanceIntervalJoint4: active coincident constraint requires a directionHint'
      );
    }
    return {
      state: limit,
      predictive,
      currentLength,
      distanceSpeed,
      predictedLength,
      minLength: this.minLength,
      maxLength: this.maxLength
    };
  }

  /**
   * Returns both stable unilateral guardian rows. These, rather than the
   * diagnostic `interval()` result, are the solver input: retaining both rows
   * lets later motor/contact updates remain inside the first-order speed window.
   */
  constraints(dt: number): readonly DistanceIntervalConstraint4[] {
    if (!Number.isFinite(dt) || dt <= 0) {
      throw new Error(
        'DistanceIntervalJoint4.constraints: dt must be finite and positive'
      );
    }
    const anchorA = this.worldAnchorA();
    const anchorB = this.worldAnchorB();
    const delta = anchorA.clone().sub(anchorB);
    const currentLength = delta.length();
    const relativeVelocity = pointPairRelativeVelocity4({
      participantA: this.bodyA,
      participantB: this.bodyB,
      anchorA,
      anchorB
    });
    let radialDirection: VecN;
    if (currentLength > 1e-15) {
      radialDirection = this.evaluateAnchors(anchorA, anchorB).direction;
    } else if (this.directionHint !== undefined) {
      radialDirection = this.directionHint.clone();
      const longitudinalSpeed = relativeVelocity.dot(radialDirection);
      const transverseSpeed = relativeVelocity.clone().sub(
        radialDirection.clone().multiplyScalar(longitudinalSpeed)
      ).length();
      if (transverseSpeed > 1e-12 || longitudinalSpeed < -1e-12) {
        throw new Error(
          'DistanceIntervalJoint4.constraints: relative motion at coincidence must follow the authored positive direction branch'
        );
      }
    } else {
      throw new Error(
        'DistanceIntervalJoint4.constraints: coincident guardian rows require a directionHint'
      );
    }

    const minimumError = Math.min(0, currentLength - this.minLength);
    const minimumTarget = minimumError < 0
      ? 0
      : (this.minLength - currentLength) / dt;
    const minimumFixed = currentLength === 0 && this.minLength === 0;
    const maximumError = Math.max(0, currentLength - this.maxLength);
    const maximumTarget = maximumError > 0
      ? 0
      : (this.maxLength - currentLength) / dt;
    return [
      this.buildConstraint({
        limit: 'minimum',
        predictive: minimumError === 0 && !minimumFixed,
        anchorA,
        anchorB,
        radialDirection,
        currentLength,
        positionError: minimumError,
        velocityTarget: minimumTarget,
        ...(minimumFixed ? { maxForce: 0 } : {})
      }),
      this.buildConstraint({
        limit: 'maximum',
        predictive: maximumError === 0,
        anchorA,
        anchorB,
        radialDirection,
        currentLength,
        positionError: maximumError,
        velocityTarget: maximumTarget
      })
    ];
  }

  private buildConstraint(options: {
    limit: 'minimum' | 'maximum';
    predictive: boolean;
    anchorA: VecN;
    anchorB: VecN;
    radialDirection: VecN;
    currentLength: number;
    positionError: number;
    velocityTarget: number;
    maxForce?: number;
  }): DistanceIntervalConstraint4 {
    const boundLength = options.limit === 'minimum'
      ? this.minLength
      : this.maxLength;
    const row = pointConstraintRow4({
      id: `${this.id}:${options.limit}`,
      participantA: this.bodyA,
      participantB: this.bodyB,
      anchorA: options.anchorA,
      anchorB: options.anchorB,
      direction: options.radialDirection,
      positionError: options.positionError,
      velocityTarget: options.velocityTarget,
      ...(options.limit === 'minimum'
        ? { minForce: 0, ...(options.maxForce === undefined
          ? {}
          : { maxForce: options.maxForce }) }
        : { maxForce: 0 })
    });
    return {
      ...row,
      limit: options.limit,
      predictive: options.predictive,
      anchorA: options.anchorA,
      anchorB: options.anchorB,
      radialDirection: options.radialDirection,
      currentLength: options.currentLength,
      boundLength,
      positionError: options.positionError,
      velocityTarget: options.velocityTarget
    };
  }

  private inactive(
    currentLength: number,
    distanceSpeed: number,
    predictedLength: number
  ): DistanceIntervalEvaluation4 {
    return {
      state: 'inactive',
      predictive: false,
      currentLength,
      distanceSpeed,
      predictedLength,
      minLength: this.minLength,
      maxLength: this.maxLength
    };
  }
}
