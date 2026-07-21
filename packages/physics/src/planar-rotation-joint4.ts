import { VecN, wedgeVectors } from '@holotope/core';
import { contactTangentBasis4 } from './contact-kinematics4.js';
import type { ConstraintBlock4 } from './constraint-block4.js';
import type {
  ConstraintParticipant4,
  ConstraintRow4
} from './constraint-row4.js';
import { RigidBody4 } from './rigid-body4.js';

export type OrthonormalTwoFrameInput4 = readonly [
  VecN | ArrayLike<number>,
  VecN | ArrayLike<number>
];

export type OrthonormalTwoFrame4 = readonly [VecN, VecN];

export interface PlanarRotationConstraintBlock4Options {
  readonly id: string;
  readonly participantA: ConstraintParticipant4;
  readonly participantB: ConstraintParticipant4;
  /** Current ordered orthonormal world two-frame carried by participant A. */
  readonly fixedFrameA: OrthonormalTwoFrameInput4;
  /** Current ordered orthonormal world two-frame carried by participant B. */
  readonly fixedFrameB: OrthonormalTwoFrameInput4;
  /** Previous three-frame, projected forward for coordinate continuity. */
  readonly previousFirstTangentBasis?: readonly VecN[];
  /** Previous complementary two-frame, projected forward for continuity. */
  readonly previousComplementBasis?: readonly VecN[];
  /** Guard for either bisector chart. Default 1e-10. */
  readonly singularTolerance?: number;
  /** Rank threshold used while transporting coordinate frames. Default 1e-10. */
  readonly frameTolerance?: number;
  /** Unit-length and orthogonality validation band. Default 1e-10. */
  readonly orthonormalTolerance?: number;
}

export type PlanarRotationConstraintEvaluation4 =
  | {
      readonly status: 'regular';
      readonly block: ConstraintBlock4;
      readonly fixedFrameA: OrthonormalTwoFrame4;
      readonly fixedFrameB: OrthonormalTwoFrame4;
      readonly referenceFrame: OrthonormalTwoFrame4;
      readonly firstTangentBasis: readonly [VecN, VecN, VecN];
      readonly complementBasis: readonly [VecN, VecN];
      readonly positionError: Float64Array;
      readonly firstAntipodalGuard: number;
      readonly secondBisectorGuard: number;
    }
  | {
      readonly status: 'first-antipodal';
      readonly fixedFrameA: OrthonormalTwoFrame4;
      readonly fixedFrameB: OrthonormalTwoFrame4;
      readonly firstAntipodalGuard: number;
    }
  | {
      readonly status: 'second-degenerate';
      readonly fixedFrameA: OrthonormalTwoFrame4;
      readonly fixedFrameB: OrthonormalTwoFrame4;
      readonly referenceDirection0: VecN;
      readonly firstAntipodalGuard: number;
      readonly secondBisectorGuard: number;
    };

export type RegularPlanarRotationConstraint4 = Extract<
  PlanarRotationConstraintEvaluation4,
  { readonly status: 'regular' }
>;

/**
 * Builds the five-row Stiefel coordinate which fixes an ordered orthonormal
 * two-frame and leaves only rotation in its complementary plane free.
 */
export function planarRotationConstraintBlock4(
  options: PlanarRotationConstraintBlock4Options
): PlanarRotationConstraintEvaluation4 {
  if (options.id.length === 0) {
    throw new Error('planarRotationConstraintBlock4: id must not be empty');
  }
  const singularTolerance = finiteNonNegative(
    options.singularTolerance ?? 1e-10,
    'singularTolerance'
  );
  const frameTolerance = finiteNonNegative(
    options.frameTolerance ?? 1e-10,
    'frameTolerance'
  );
  const orthonormalTolerance = finiteNonNegative(
    options.orthonormalTolerance ?? 1e-10,
    'orthonormalTolerance'
  );
  const fixedFrameA = orthonormalFrame2(
    options.fixedFrameA,
    'fixedFrameA',
    orthonormalTolerance
  );
  const fixedFrameB = orthonormalFrame2(
    options.fixedFrameB,
    'fixedFrameB',
    orthonormalTolerance
  );
  const [directionA0, directionA1] = fixedFrameA;
  const [directionB0, directionB1] = fixedFrameB;

  const firstDot = Math.max(-1, Math.min(1, directionA0.dot(directionB0)));
  const firstAntipodalGuard = Math.max(0, 1 + firstDot);
  if (firstAntipodalGuard <= singularTolerance) {
    return {
      status: 'first-antipodal',
      fixedFrameA,
      fixedFrameB,
      firstAntipodalGuard
    };
  }

  const referenceDirection0 = directionA0.clone().add(directionB0).normalize();
  const firstTangentBasis = contactTangentBasis4(
    referenceDirection0,
    options.previousFirstTangentBasis,
    frameTolerance
  );
  const secondBisector = directionA1.clone().add(directionB1);
  secondBisector.sub(
    referenceDirection0.clone().multiplyScalar(
      secondBisector.dot(referenceDirection0)
    )
  );
  const secondBisectorGuard = secondBisector.length();
  if (secondBisectorGuard <= singularTolerance) {
    return {
      status: 'second-degenerate',
      fixedFrameA,
      fixedFrameB,
      referenceDirection0,
      firstAntipodalGuard,
      secondBisectorGuard
    };
  }
  const referenceDirection1 = secondBisector.multiplyScalar(
    1 / secondBisectorGuard
  );
  const complementBasis = orthogonalComplementBasis2_4(
    referenceDirection0,
    referenceDirection1,
    options.previousComplementBasis,
    frameTolerance
  );

  const difference0 = directionA0.clone().sub(directionB0);
  const difference1 = directionA1.clone().sub(directionB1);
  const positionError = Float64Array.of(
    ...firstTangentBasis.map((tangent) => tangent.dot(difference0)),
    ...complementBasis.map((tangent) => tangent.dot(difference1))
  );
  const rows: ConstraintRow4[] = [
    ...firstTangentBasis.map((tangent, index): ConstraintRow4 => ({
      id: `${options.id}|fixed-frame:first:${index}`,
      participantA: options.participantA,
      jacobianA: {
        linear: new VecN(4),
        angular: wedgeVectors(directionA0, tangent)
      },
      participantB: options.participantB,
      jacobianB: {
        linear: new VecN(4),
        angular: wedgeVectors(directionB0, tangent).scale(-1)
      },
      positionError: positionError[index]!
    })),
    ...complementBasis.map((tangent, index): ConstraintRow4 => ({
      id: `${options.id}|fixed-frame:second:${index}`,
      participantA: options.participantA,
      jacobianA: {
        linear: new VecN(4),
        angular: wedgeVectors(directionA1, tangent)
      },
      participantB: options.participantB,
      jacobianB: {
        linear: new VecN(4),
        angular: wedgeVectors(directionB1, tangent).scale(-1)
      },
      positionError: positionError[index + 3]!
    }))
  ];
  return {
    status: 'regular',
    block: { id: options.id, rows },
    fixedFrameA,
    fixedFrameB,
    referenceFrame: [referenceDirection0, referenceDirection1],
    firstTangentBasis,
    complementBasis,
    positionError,
    firstAntipodalGuard,
    secondBisectorGuard
  };
}

export type PlanarRotationJoint4Options =
  | {
      readonly id: string;
      readonly bodyA: RigidBody4;
      readonly localFixedFrameA: OrthonormalTwoFrameInput4;
      readonly bodyB: RigidBody4;
      readonly localFixedFrameB: OrthonormalTwoFrameInput4;
      readonly singularTolerance?: number;
      readonly frameTolerance?: number;
      readonly orthonormalTolerance?: number;
    }
  | {
      readonly id: string;
      readonly bodyA: RigidBody4;
      readonly localFixedFrameA: OrthonormalTwoFrameInput4;
      readonly bodyB?: null;
      readonly worldFixedFrameB: OrthonormalTwoFrameInput4;
      readonly singularTolerance?: number;
      readonly frameTolerance?: number;
      readonly orthonormalTolerance?: number;
    };

/** Persistent fixed-two-frame binding with one complementary SO(2) free. */
export class PlanarRotationJoint4 {
  readonly id: string;
  readonly bodyA: RigidBody4;
  readonly localFixedFrameA: OrthonormalTwoFrame4;
  readonly bodyB: RigidBody4 | null;
  readonly fixedFrameB: OrthonormalTwoFrame4;
  readonly singularTolerance: number;
  readonly frameTolerance: number;
  readonly orthonormalTolerance: number;
  private previousFirstTangentBasis: [VecN, VecN, VecN] | undefined;
  private previousComplementBasis: [VecN, VecN] | undefined;

  constructor(options: PlanarRotationJoint4Options) {
    if (options.id.length === 0) {
      throw new Error('PlanarRotationJoint4: id must not be empty');
    }
    this.id = options.id;
    this.bodyA = options.bodyA;
    this.bodyB = options.bodyB ?? null;
    this.singularTolerance = finiteNonNegative(
      options.singularTolerance ?? 1e-10,
      'singularTolerance'
    );
    this.frameTolerance = finiteNonNegative(
      options.frameTolerance ?? 1e-10,
      'frameTolerance'
    );
    this.orthonormalTolerance = finiteNonNegative(
      options.orthonormalTolerance ?? 1e-10,
      'orthonormalTolerance'
    );
    this.localFixedFrameA = orthonormalFrame2(
      options.localFixedFrameA,
      'localFixedFrameA',
      this.orthonormalTolerance
    );
    this.fixedFrameB = 'localFixedFrameB' in options
      ? orthonormalFrame2(
          options.localFixedFrameB,
          'localFixedFrameB',
          this.orthonormalTolerance
        )
      : orthonormalFrame2(
          options.worldFixedFrameB,
          'worldFixedFrameB',
          this.orthonormalTolerance
        );
    if (this.bodyA === this.bodyB) {
      throw new Error('PlanarRotationJoint4: a body cannot be joined to itself');
    }
  }

  worldFixedFrameA(): OrthonormalTwoFrame4 {
    return this.localFixedFrameA.map(
      (direction) => this.bodyA.rotation.applyToPoint(direction)
    ) as [VecN, VecN];
  }

  worldFixedFrameB(): OrthonormalTwoFrame4 {
    return this.bodyB === null
      ? cloneFrame(this.fixedFrameB)
      : this.fixedFrameB.map(
          (direction) => this.bodyB!.rotation.applyToPoint(direction)
        ) as [VecN, VecN];
  }

  constraint(): PlanarRotationConstraintEvaluation4 {
    const evaluation = planarRotationConstraintBlock4({
      id: this.id,
      participantA: this.bodyA,
      participantB: this.bodyB,
      fixedFrameA: this.worldFixedFrameA(),
      fixedFrameB: this.worldFixedFrameB(),
      ...(this.previousFirstTangentBasis === undefined
        ? {}
        : { previousFirstTangentBasis: this.previousFirstTangentBasis }),
      ...(this.previousComplementBasis === undefined
        ? {}
        : { previousComplementBasis: this.previousComplementBasis }),
      singularTolerance: this.singularTolerance,
      frameTolerance: this.frameTolerance,
      orthonormalTolerance: this.orthonormalTolerance
    });
    if (evaluation.status === 'regular') {
      this.previousFirstTangentBasis = evaluation.firstTangentBasis.map(
        (vector) => vector.clone()
      ) as [VecN, VecN, VecN];
      this.previousComplementBasis = evaluation.complementBasis.map(
        (vector) => vector.clone()
      ) as [VecN, VecN];
    }
    return evaluation;
  }

  resetFrame(): void {
    this.previousFirstTangentBasis = undefined;
    this.previousComplementBasis = undefined;
  }
}

function orthogonalComplementBasis2_4(
  normal0: VecN,
  normal1: VecN,
  previousBasis: readonly VecN[] | undefined,
  tolerance: number
): readonly [VecN, VecN] {
  if (previousBasis !== undefined && previousBasis.length !== 2) {
    throw new Error(
      'planarRotationConstraintBlock4: previousComplementBasis must contain two vectors'
    );
  }
  const sources = [
    ...(previousBasis ?? []),
    VecN.basis(4, 0),
    VecN.basis(4, 1),
    VecN.basis(4, 2),
    VecN.basis(4, 3)
  ];
  const basis: VecN[] = [];
  for (const source of sources) {
    const tangent = finiteVector4(source, 'complement basis vector');
    tangent.sub(normal0.clone().multiplyScalar(tangent.dot(normal0)));
    tangent.sub(normal1.clone().multiplyScalar(tangent.dot(normal1)));
    for (const accepted of basis) {
      tangent.sub(accepted.clone().multiplyScalar(tangent.dot(accepted)));
    }
    const length = tangent.length();
    if (length > tolerance) basis.push(tangent.multiplyScalar(1 / length));
    if (basis.length === 2) break;
  }
  if (basis.length !== 2) {
    throw new Error(
      'planarRotationConstraintBlock4: could not construct complementary frame'
    );
  }
  if (determinantColumns4(normal0, normal1, basis[0]!, basis[1]!) < 0) {
    basis[1]!.multiplyScalar(-1);
  }
  return basis as [VecN, VecN];
}

function determinantColumns4(
  column0: VecN,
  column1: VecN,
  column2: VecN,
  column3: VecN
): number {
  const a = column0.data;
  const b = column1.data;
  const c = column2.data;
  const d = column3.data;
  return (
    a[0]! * determinant3(
      b[1]!, c[1]!, d[1]!,
      b[2]!, c[2]!, d[2]!,
      b[3]!, c[3]!, d[3]!
    ) -
    b[0]! * determinant3(
      a[1]!, c[1]!, d[1]!,
      a[2]!, c[2]!, d[2]!,
      a[3]!, c[3]!, d[3]!
    ) +
    c[0]! * determinant3(
      a[1]!, b[1]!, d[1]!,
      a[2]!, b[2]!, d[2]!,
      a[3]!, b[3]!, d[3]!
    ) -
    d[0]! * determinant3(
      a[1]!, b[1]!, c[1]!,
      a[2]!, b[2]!, c[2]!,
      a[3]!, b[3]!, c[3]!
    )
  );
}

function determinant3(
  a00: number, a01: number, a02: number,
  a10: number, a11: number, a12: number,
  a20: number, a21: number, a22: number
): number {
  return (
    a00 * (a11 * a22 - a12 * a21) -
    a01 * (a10 * a22 - a12 * a20) +
    a02 * (a10 * a21 - a11 * a20)
  );
}

function orthonormalFrame2(
  value: OrthonormalTwoFrameInput4,
  name: string,
  tolerance: number
): OrthonormalTwoFrame4 {
  if (value.length !== 2) {
    throw new Error(`PlanarRotationJoint4: ${name} must contain two vectors`);
  }
  const first = finiteVector4(value[0], `${name}[0]`);
  const second = finiteVector4(value[1], `${name}[1]`);
  if (
    Math.abs(first.length() - 1) > tolerance ||
    Math.abs(second.length() - 1) > tolerance ||
    Math.abs(first.dot(second)) > tolerance
  ) {
    throw new Error(`PlanarRotationJoint4: ${name} must be orthonormal`);
  }
  return [first, second];
}

function finiteVector4(
  value: VecN | ArrayLike<number>,
  name: string
): VecN {
  const vector = value instanceof VecN ? value.clone() : new VecN(value);
  if (
    vector.dim !== 4 ||
    Array.from(vector.data).some((entry) => !Number.isFinite(entry))
  ) {
    throw new Error(`PlanarRotationJoint4: ${name} must contain four finite coordinates`);
  }
  return vector;
}

function cloneFrame(frame: OrthonormalTwoFrame4): OrthonormalTwoFrame4 {
  return [frame[0].clone(), frame[1].clone()];
}

function finiteNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`PlanarRotationJoint4: ${name} must be finite and non-negative`);
  }
  return value;
}
