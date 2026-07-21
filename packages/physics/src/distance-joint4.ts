import { VecN } from '@holotope/core';
import {
  pointConstraintRow4,
  type ConstraintRow4
} from './constraint-row4.js';
import { RigidBody4 } from './rigid-body4.js';

export interface DistanceCoordinateEvaluationN {
  /** `anchorA - anchorB`. */
  readonly delta: VecN;
  /** Unit gradient of distance with respect to anchor A. */
  readonly direction: VecN;
  readonly distance: number;
}

export interface DistanceConstraintEvaluationN
  extends DistanceCoordinateEvaluationN {
  /** Signed constraint value `distance - restLength`. */
  readonly error: number;
}

/** Dimension-independent distance and gradient between two anchors. */
export function evaluateDistanceCoordinateN(
  anchorA: VecN,
  anchorB: VecN,
  directionHint?: VecN
): DistanceCoordinateEvaluationN {
  assertFiniteVectorN(anchorA, 'anchorA');
  assertFiniteVectorN(anchorB, 'anchorB');
  if (anchorA.dim !== anchorB.dim) {
    throw new Error('evaluateDistanceCoordinateN: anchors must have equal dimension');
  }
  if (directionHint !== undefined) {
    assertFiniteVectorN(directionHint, 'directionHint');
    if (directionHint.dim !== anchorA.dim || !(directionHint.length() > 1e-15)) {
      throw new Error(
        'evaluateDistanceCoordinateN: directionHint must be nonzero and match the anchor dimension'
      );
    }
  }
  const delta = anchorA.clone().sub(anchorB);
  const distance = delta.length();
  let direction: VecN;
  if (distance > 1e-15) {
    direction = delta.clone().multiplyScalar(1 / distance);
  } else {
    if (directionHint === undefined) {
      throw new Error(
        'evaluateDistanceCoordinateN: coincident anchors require a directionHint'
      );
    }
    direction = directionHint.clone().normalize();
  }
  return { delta, direction, distance };
}

/**
 * Dimension-independent distance equality geometry used by the R4 rigid-body
 * adapter. A direction hint makes the gradient explicit at coincidence.
 */
export function evaluateDistanceConstraintN(
  anchorA: VecN,
  anchorB: VecN,
  restLength: number,
  directionHint?: VecN
): DistanceConstraintEvaluationN {
  if (!Number.isFinite(restLength) || restLength <= 0) {
    throw new Error(
      'evaluateDistanceConstraintN: restLength must be finite and positive'
    );
  }
  const coordinate = evaluateDistanceCoordinateN(
    anchorA,
    anchorB,
    directionHint
  );
  return {
    ...coordinate,
    error: coordinate.distance - restLength
  };
}

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

function assertFiniteVectorN(vector: VecN, name: string): void {
  if (
    vector.dim < 1 ||
    Array.from(vector.data).some((entry) => !Number.isFinite(entry))
  ) {
    throw new Error(`${name} must be a finite vector`);
  }
}
