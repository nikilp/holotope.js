import { VecN } from '@holotope/core';

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

/** Dimension-independent positive-length distance equality geometry. */
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

function assertFiniteVectorN(vector: VecN, name: string): void {
  if (
    vector.dim < 1 ||
    Array.from(vector.data).some((entry) => !Number.isFinite(entry))
  ) {
    throw new Error(`${name} must be a finite vector`);
  }
}
