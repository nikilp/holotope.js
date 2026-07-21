import { BivectorN, VecN, wedgeVectors } from '@holotope/core';
import { constraintRowSpeed4 } from './constraint-row4.js';
import {
  PlanarRotationJoint4,
  type RegularPlanarRotationConstraint4
} from './planar-rotation-joint4.js';

export interface PlanarRotationPhaseBranch4 {
  readonly wrappedAngle: number;
  readonly unwrappedAngle: number;
}

export interface PlanarRotationPhase4Options {
  readonly constraint: RegularPlanarRotationConstraint4;
  /** Current unit world reference in A's complementary plane. */
  readonly phaseDirectionA: VecN | ArrayLike<number>;
  /** Current unit world reference in B's complementary plane. */
  readonly phaseDirectionB: VecN | ArrayLike<number>;
  readonly previousBranch?: PlanarRotationPhaseBranch4;
  /** Resolves an exactly half-turn sample when a preceding branch exists. */
  readonly halfTurnDirection?: 1 | -1;
  /** Minimum common-plane projection length. Default 1e-10. */
  readonly phaseTolerance?: number;
  /** Band used to report an equally short half-turn lift. Default 1e-10. */
  readonly unwrapTolerance?: number;
  /** Unit and fixed-frame orthogonality validation band. Default 1e-10. */
  readonly orthonormalTolerance?: number;
}

export type PlanarRotationPhaseEvaluation4 =
  | {
      readonly status: 'regular';
      readonly constraint: RegularPlanarRotationConstraint4;
      readonly phaseDirectionA: VecN;
      readonly phaseDirectionB: VecN;
      readonly projectedPhaseA: VecN;
      readonly projectedPhaseB: VecN;
      readonly phaseProjectionGuards: readonly [number, number];
      readonly generator: BivectorN;
      readonly wrappedAngle: number;
      readonly angle: number;
      readonly angularSpeed: number;
      readonly branch: PlanarRotationPhaseBranch4;
    }
  | {
      readonly status: 'phase-degenerate';
      readonly constraint: RegularPlanarRotationConstraint4;
      readonly phaseDirectionA: VecN;
      readonly phaseDirectionB: VecN;
      readonly phaseProjectionGuards: readonly [number, number];
    }
  | {
      readonly status: 'unwrap-ambiguous';
      readonly constraint: RegularPlanarRotationConstraint4;
      readonly phaseDirectionA: VecN;
      readonly phaseDirectionB: VecN;
      readonly projectedPhaseA: VecN;
      readonly projectedPhaseB: VecN;
      readonly phaseProjectionGuards: readonly [number, number];
      readonly generator: BivectorN;
      readonly wrappedAngle: number;
      readonly angularSpeed: number;
      readonly previousBranch: PlanarRotationPhaseBranch4;
      readonly negativeBranch: PlanarRotationPhaseBranch4;
      readonly positiveBranch: PlanarRotationPhaseBranch4;
    };

/**
 * Evaluates the signed SO(2) phase left free by a regular five-row planar
 * rotation constraint. Successive samples must advance by less than pi.
 */
export function planarRotationPhase4(
  options: PlanarRotationPhase4Options
): PlanarRotationPhaseEvaluation4 {
  const phaseTolerance = finiteNonNegative(
    options.phaseTolerance ?? 1e-10,
    'phaseTolerance'
  );
  const unwrapTolerance = finiteNonNegative(
    options.unwrapTolerance ?? 1e-10,
    'unwrapTolerance'
  );
  const orthonormalTolerance = finiteNonNegative(
    options.orthonormalTolerance ?? 1e-10,
    'orthonormalTolerance'
  );
  if (
    options.halfTurnDirection !== undefined &&
    options.halfTurnDirection !== 1 &&
    options.halfTurnDirection !== -1
  ) {
    throw new Error('planarRotationPhase4: halfTurnDirection must be 1 or -1');
  }
  const phaseDirectionA = phaseReference(
    options.phaseDirectionA,
    options.constraint.fixedFrameA,
    'phaseDirectionA',
    orthonormalTolerance
  );
  const phaseDirectionB = phaseReference(
    options.phaseDirectionB,
    options.constraint.fixedFrameB,
    'phaseDirectionB',
    orthonormalTolerance
  );
  const [reference0, reference1] = options.constraint.referenceFrame;
  const projectedPhaseA = projectComplement(
    phaseDirectionA,
    reference0,
    reference1
  );
  const projectedPhaseB = projectComplement(
    phaseDirectionB,
    reference0,
    reference1
  );
  const guardA = projectedPhaseA.length();
  const guardB = projectedPhaseB.length();
  const phaseProjectionGuards = [guardA, guardB] as const;
  if (guardA <= phaseTolerance || guardB <= phaseTolerance) {
    return {
      status: 'phase-degenerate',
      constraint: options.constraint,
      phaseDirectionA,
      phaseDirectionB,
      phaseProjectionGuards
    };
  }
  projectedPhaseA.multiplyScalar(1 / guardA);
  projectedPhaseB.multiplyScalar(1 / guardB);

  const [basis0, basis1] = options.constraint.complementBasis;
  const a0 = projectedPhaseA.dot(basis0);
  const a1 = projectedPhaseA.dot(basis1);
  const b0 = projectedPhaseB.dot(basis0);
  const b1 = projectedPhaseB.dot(basis1);
  const wrappedAngle = wrapAnglePi(
    Math.atan2(a1 * b0 - a0 * b1, a0 * b0 + a1 * b1)
  );
  const generator = wedgeVectors(basis0, basis1);
  const participantA = options.constraint.block.rows[0]!.participantA;
  const participantB = options.constraint.block.rows[0]!.participantB;
  const angularSpeed = constraintRowSpeed4({
    id: `${options.constraint.block.id}|phase`,
    participantA,
    jacobianA: { linear: new VecN(4), angular: generator },
    participantB,
    jacobianB: {
      linear: new VecN(4),
      angular: generator.clone().scale(-1)
    }
  });

  if (options.previousBranch === undefined) {
    const branch = Object.freeze({
      wrappedAngle,
      unwrappedAngle: wrappedAngle
    });
    return {
      status: 'regular',
      constraint: options.constraint,
      phaseDirectionA,
      phaseDirectionB,
      projectedPhaseA,
      projectedPhaseB,
      phaseProjectionGuards,
      generator,
      wrappedAngle,
      angle: wrappedAngle,
      angularSpeed,
      branch
    };
  }

  const previousBranch = validateBranch(
    options.previousBranch,
    unwrapTolerance
  );
  let increment = wrapAnglePi(wrappedAngle - previousBranch.wrappedAngle);
  if (Math.PI - Math.abs(increment) <= unwrapTolerance) {
    const negativeBranch = Object.freeze({
      wrappedAngle,
      unwrappedAngle: previousBranch.unwrappedAngle - Math.PI
    });
    const positiveBranch = Object.freeze({
      wrappedAngle,
      unwrappedAngle: previousBranch.unwrappedAngle + Math.PI
    });
    if (options.halfTurnDirection === undefined) {
      return {
        status: 'unwrap-ambiguous',
        constraint: options.constraint,
        phaseDirectionA,
        phaseDirectionB,
        projectedPhaseA,
        projectedPhaseB,
        phaseProjectionGuards,
        generator,
        wrappedAngle,
        angularSpeed,
        previousBranch,
        negativeBranch,
        positiveBranch
      };
    }
    increment = options.halfTurnDirection * Math.PI;
  }
  const angle = previousBranch.unwrappedAngle + increment;
  const branch = Object.freeze({ wrappedAngle, unwrappedAngle: angle });
  return {
    status: 'regular',
    constraint: options.constraint,
    phaseDirectionA,
    phaseDirectionB,
    projectedPhaseA,
    projectedPhaseB,
    phaseProjectionGuards,
    generator,
    wrappedAngle,
    angle,
    angularSpeed,
    branch
  };
}

export type PlanarRotationCoordinate4Options =
  | {
      readonly joint: PlanarRotationJoint4;
      readonly localPhaseDirectionA: VecN | ArrayLike<number>;
      readonly localPhaseDirectionB: VecN | ArrayLike<number>;
      readonly worldPhaseDirectionB?: never;
      readonly phaseTolerance?: number;
      readonly unwrapTolerance?: number;
    }
  | {
      readonly joint: PlanarRotationJoint4;
      readonly localPhaseDirectionA: VecN | ArrayLike<number>;
      readonly localPhaseDirectionB?: never;
      readonly worldPhaseDirectionB: VecN | ArrayLike<number>;
      readonly phaseTolerance?: number;
      readonly unwrapTolerance?: number;
    };

export type PlanarRotationCoordinateEvaluation4 =
  | PlanarRotationPhaseEvaluation4
  | {
      readonly status: 'first-antipodal';
      readonly constraint: Extract<
        ReturnType<PlanarRotationJoint4['constraint']>,
        { readonly status: 'first-antipodal' }
      >;
    }
  | {
      readonly status: 'second-degenerate';
      readonly constraint: Extract<
        ReturnType<PlanarRotationJoint4['constraint']>,
        { readonly status: 'second-degenerate' }
      >;
    };

/** Persistent local phase references plus explicit continuous unwrap state. */
export class PlanarRotationCoordinate4 {
  readonly joint: PlanarRotationJoint4;
  readonly localPhaseDirectionA: VecN;
  readonly phaseDirectionB: VecN;
  readonly phaseTolerance: number;
  readonly unwrapTolerance: number;
  private previousBranch: PlanarRotationPhaseBranch4 | undefined;

  constructor(options: PlanarRotationCoordinate4Options) {
    this.joint = options.joint;
    this.phaseTolerance = finiteNonNegative(
      options.phaseTolerance ?? 1e-10,
      'phaseTolerance'
    );
    this.unwrapTolerance = finiteNonNegative(
      options.unwrapTolerance ?? 1e-10,
      'unwrapTolerance'
    );
    this.localPhaseDirectionA = phaseReference(
      options.localPhaseDirectionA,
      this.joint.localFixedFrameA,
      'localPhaseDirectionA',
      this.joint.orthonormalTolerance
    );
    if (this.joint.bodyB === null) {
      if (!('worldPhaseDirectionB' in options)) {
        throw new Error(
          'PlanarRotationCoordinate4: a fixed-world joint requires worldPhaseDirectionB'
        );
      }
      this.phaseDirectionB = phaseReference(
        options.worldPhaseDirectionB,
        this.joint.fixedFrameB,
        'worldPhaseDirectionB',
        this.joint.orthonormalTolerance
      );
    } else {
      if (!('localPhaseDirectionB' in options)) {
        throw new Error(
          'PlanarRotationCoordinate4: a two-body joint requires localPhaseDirectionB'
        );
      }
      this.phaseDirectionB = phaseReference(
        options.localPhaseDirectionB,
        this.joint.fixedFrameB,
        'localPhaseDirectionB',
        this.joint.orthonormalTolerance
      );
    }
  }

  worldPhaseDirectionA(): VecN {
    return this.joint.bodyA.rotation.applyToPoint(this.localPhaseDirectionA);
  }

  worldPhaseDirectionB(): VecN {
    return this.joint.bodyB === null
      ? this.phaseDirectionB.clone()
      : this.joint.bodyB.rotation.applyToPoint(this.phaseDirectionB);
  }

  evaluation(options: {
    readonly halfTurnDirection?: 1 | -1;
  } = {}): PlanarRotationCoordinateEvaluation4 {
    const constraint = this.joint.constraint();
    if (constraint.status !== 'regular') {
      return { status: constraint.status, constraint } as
        PlanarRotationCoordinateEvaluation4;
    }
    const evaluation = planarRotationPhase4({
      constraint,
      phaseDirectionA: this.worldPhaseDirectionA(),
      phaseDirectionB: this.worldPhaseDirectionB(),
      ...(this.previousBranch === undefined
        ? {}
        : { previousBranch: this.previousBranch }),
      ...(options.halfTurnDirection === undefined
        ? {}
        : { halfTurnDirection: options.halfTurnDirection }),
      phaseTolerance: this.phaseTolerance,
      unwrapTolerance: this.unwrapTolerance,
      orthonormalTolerance: this.joint.orthonormalTolerance
    });
    if (evaluation.status === 'regular') {
      this.previousBranch = evaluation.branch;
    }
    return evaluation;
  }

  resetPhase(branch?: PlanarRotationPhaseBranch4): void {
    this.previousBranch = branch === undefined
      ? undefined
      : validateBranch(branch, this.unwrapTolerance);
  }
}

function phaseReference(
  value: VecN | ArrayLike<number>,
  fixedFrame: readonly [VecN, VecN],
  name: string,
  tolerance: number
): VecN {
  const direction = value instanceof VecN ? value.clone() : new VecN(value);
  if (
    direction.dim !== 4 ||
    Array.from(direction.data).some((entry) => !Number.isFinite(entry))
  ) {
    throw new Error(`PlanarRotationCoordinate4: ${name} must contain four finite coordinates`);
  }
  if (
    Math.abs(direction.length() - 1) > tolerance ||
    Math.abs(direction.dot(fixedFrame[0])) > tolerance ||
    Math.abs(direction.dot(fixedFrame[1])) > tolerance
  ) {
    throw new Error(
      `PlanarRotationCoordinate4: ${name} must be unit and orthogonal to the fixed frame`
    );
  }
  return direction;
}

function projectComplement(
  direction: VecN,
  reference0: VecN,
  reference1: VecN
): VecN {
  return direction.clone()
    .sub(reference0.clone().multiplyScalar(direction.dot(reference0)))
    .sub(reference1.clone().multiplyScalar(direction.dot(reference1)));
}

function validateBranch(
  branch: PlanarRotationPhaseBranch4,
  tolerance: number
): PlanarRotationPhaseBranch4 {
  if (
    !Number.isFinite(branch.wrappedAngle) ||
    !Number.isFinite(branch.unwrappedAngle) ||
    branch.wrappedAngle < -Math.PI ||
    branch.wrappedAngle >= Math.PI ||
    Math.abs(wrapAnglePi(
      wrapAnglePi(branch.unwrappedAngle) - branch.wrappedAngle
    )) > tolerance
  ) {
    throw new Error('PlanarRotationCoordinate4: invalid phase branch token');
  }
  return Object.freeze({
    wrappedAngle: branch.wrappedAngle,
    unwrappedAngle: branch.unwrappedAngle
  });
}

function wrapAnglePi(angle: number): number {
  let wrapped = (angle + Math.PI) % (2 * Math.PI);
  if (wrapped < 0) wrapped += 2 * Math.PI;
  wrapped -= Math.PI;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

function finiteNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`PlanarRotationCoordinate4: ${name} must be finite and non-negative`);
  }
  return value;
}
