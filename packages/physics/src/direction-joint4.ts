import { VecN, wedgeVectors } from '@holotope/core';
import { contactTangentBasis4 } from './contact-kinematics4.js';
import type { ConstraintBlock4 } from './constraint-block4.js';
import type {
  ConstraintParticipant4,
  ConstraintRow4
} from './constraint-row4.js';
import { RigidBody4 } from './rigid-body4.js';

export interface DirectionConstraintBlock4Options {
  readonly id: string;
  readonly participantA: ConstraintParticipant4;
  readonly participantB: ConstraintParticipant4;
  /** Current oriented world direction carried by participant A. */
  readonly directionA: VecN | ArrayLike<number>;
  /** Current oriented world direction carried by participant B. */
  readonly directionB: VecN | ArrayLike<number>;
  /** Previous tangent frame, projected forward for coordinate continuity. */
  readonly previousTangentBasis?: readonly VecN[];
  /** Guard on `1 + directionA dot directionB`. Default 1e-10. */
  readonly antipodalTolerance?: number;
  /** Rank threshold used while transporting the tangent frame. Default 1e-10. */
  readonly frameTolerance?: number;
}

export type DirectionConstraintEvaluation4 =
  | {
      readonly status: 'regular';
      readonly block: ConstraintBlock4;
      readonly directionA: VecN;
      readonly directionB: VecN;
      readonly referenceDirection: VecN;
      readonly tangentBasis: readonly [VecN, VecN, VecN];
      readonly positionError: Float64Array;
      readonly antipodalGuard: number;
    }
  | {
      readonly status: 'antipodal';
      readonly directionA: VecN;
      readonly directionB: VecN;
      readonly antipodalGuard: number;
    };

/**
 * Builds the three-row quotient coordinate which preserves one oriented R4
 * material direction while leaving its SO(3) stabilizer free.
 */
export function directionConstraintBlock4(
  options: DirectionConstraintBlock4Options
): DirectionConstraintEvaluation4 {
  if (options.id.length === 0) {
    throw new Error('directionConstraintBlock4: id must not be empty');
  }
  const antipodalTolerance = finiteNonNegative(
    options.antipodalTolerance ?? 1e-10,
    'antipodalTolerance'
  );
  const frameTolerance = finiteNonNegative(
    options.frameTolerance ?? 1e-10,
    'frameTolerance'
  );
  const directionA = unitDirection(options.directionA, 'directionA');
  const directionB = unitDirection(options.directionB, 'directionB');
  const dot = Math.max(-1, Math.min(1, directionA.dot(directionB)));
  const antipodalGuard = Math.max(0, 1 + dot);
  if (antipodalGuard <= antipodalTolerance) {
    return { status: 'antipodal', directionA, directionB, antipodalGuard };
  }

  const referenceDirection = directionA.clone().add(directionB).normalize();
  const tangentBasis = contactTangentBasis4(
    referenceDirection,
    options.previousTangentBasis,
    frameTolerance
  );
  const difference = directionA.clone().sub(directionB);
  const positionError = Float64Array.from(
    tangentBasis,
    (tangent) => tangent.dot(difference)
  );
  const rows = tangentBasis.map((tangent, index): ConstraintRow4 => ({
    id: `${options.id}|direction:${index}`,
    participantA: options.participantA,
    jacobianA: {
      linear: new VecN(4),
      angular: wedgeVectors(directionA, tangent)
    },
    participantB: options.participantB,
    jacobianB: {
      linear: new VecN(4),
      angular: wedgeVectors(directionB, tangent).scale(-1)
    },
    positionError: positionError[index]!
  }));
  return {
    status: 'regular',
    block: { id: options.id, rows },
    directionA,
    directionB,
    referenceDirection,
    tangentBasis,
    positionError,
    antipodalGuard
  };
}

export type DirectionJoint4Options =
  | {
      readonly id: string;
      readonly bodyA: RigidBody4;
      readonly localDirectionA: VecN | ArrayLike<number>;
      readonly bodyB: RigidBody4;
      readonly localDirectionB: VecN | ArrayLike<number>;
      readonly antipodalTolerance?: number;
      readonly frameTolerance?: number;
    }
  | {
      readonly id: string;
      readonly bodyA: RigidBody4;
      readonly localDirectionA: VecN | ArrayLike<number>;
      readonly bodyB?: null;
      readonly worldDirectionB: VecN | ArrayLike<number>;
      readonly antipodalTolerance?: number;
      readonly frameTolerance?: number;
    };

/** Persistent local-direction binding with a transported three-coordinate frame. */
export class DirectionJoint4 {
  readonly id: string;
  readonly bodyA: RigidBody4;
  readonly localDirectionA: VecN;
  readonly bodyB: RigidBody4 | null;
  readonly directionB: VecN;
  readonly antipodalTolerance: number;
  readonly frameTolerance: number;
  private previousTangentBasis: [VecN, VecN, VecN] | undefined;

  constructor(options: DirectionJoint4Options) {
    if (options.id.length === 0) {
      throw new Error('DirectionJoint4: id must not be empty');
    }
    this.id = options.id;
    this.bodyA = options.bodyA;
    this.localDirectionA = unitDirection(options.localDirectionA, 'localDirectionA');
    this.bodyB = options.bodyB ?? null;
    this.directionB = 'localDirectionB' in options
      ? unitDirection(options.localDirectionB, 'localDirectionB')
      : unitDirection(options.worldDirectionB, 'worldDirectionB');
    this.antipodalTolerance = finiteNonNegative(
      options.antipodalTolerance ?? 1e-10,
      'antipodalTolerance'
    );
    this.frameTolerance = finiteNonNegative(
      options.frameTolerance ?? 1e-10,
      'frameTolerance'
    );
    if (this.bodyA === this.bodyB) {
      throw new Error('DirectionJoint4: a body cannot be joined to itself');
    }
  }

  worldDirectionA(): VecN {
    return this.bodyA.rotation.applyToPoint(this.localDirectionA);
  }

  worldDirectionB(): VecN {
    return this.bodyB === null
      ? this.directionB.clone()
      : this.bodyB.rotation.applyToPoint(this.directionB);
  }

  constraint(): DirectionConstraintEvaluation4 {
    const evaluation = directionConstraintBlock4({
      id: this.id,
      participantA: this.bodyA,
      participantB: this.bodyB,
      directionA: this.worldDirectionA(),
      directionB: this.worldDirectionB(),
      ...(this.previousTangentBasis === undefined
        ? {}
        : { previousTangentBasis: this.previousTangentBasis }),
      antipodalTolerance: this.antipodalTolerance,
      frameTolerance: this.frameTolerance
    });
    if (evaluation.status === 'regular') {
      this.previousTangentBasis = evaluation.tangentBasis.map(
        (vector) => vector.clone()
      ) as [VecN, VecN, VecN];
    }
    return evaluation;
  }

  resetFrame(): void {
    this.previousTangentBasis = undefined;
  }
}

function unitDirection(value: VecN | ArrayLike<number>, name: string): VecN {
  const direction = value instanceof VecN ? value.clone() : new VecN(value);
  if (
    direction.dim !== 4 ||
    Array.from(direction.data).some((entry) => !Number.isFinite(entry))
  ) {
    throw new Error(`DirectionJoint4: ${name} must contain four finite coordinates`);
  }
  const length = direction.length();
  if (!(length > 1e-15)) {
    throw new Error(`DirectionJoint4: ${name} must be nonzero`);
  }
  return direction.multiplyScalar(1 / length);
}

function finiteNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`DirectionJoint4: ${name} must be finite and non-negative`);
  }
  return value;
}
