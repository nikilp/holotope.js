import { BivectorN, MatN, Rotor4, VecN } from '@holotope/core';
import type { ConstraintBlock4 } from './constraint-block4.js';
import type {
  ConstraintParticipant4,
  ConstraintRow4
} from './constraint-row4.js';
import { inverseRotateBivector4 } from './bivector4.js';
import {
  orientationDlog4,
  relativeOrientationCoordinates4,
  type OrientationBranchToken4
} from './orientation-coordinates4.js';
import { RigidBody4 } from './rigid-body4.js';

export interface OrientationConstraintBlock4Options {
  readonly id: string;
  readonly participantA: ConstraintParticipant4;
  readonly participantB: ConstraintParticipant4;
  /** Current oriented material frame carried by participant A. */
  readonly frameA: Rotor4;
  /** Current target frame carried by participant B or fixed in the world. */
  readonly frameB: Rotor4;
  readonly previousBranch?: OrientationBranchToken4;
  readonly cutLocusTolerance?: number;
  readonly branchHysteresis?: number;
}

export type OrientationConstraintEvaluation4 =
  | {
      readonly status: 'regular';
      readonly block: ConstraintBlock4;
      readonly frameA: Rotor4;
      readonly frameB: Rotor4;
      readonly error: BivectorN;
      readonly branch: OrientationBranchToken4;
      readonly cutLocusGuard: number;
      readonly shortestPairSign: 1 | -1;
      readonly usesShortestLift: boolean;
      /** Exact map from A's world-left angular velocity to error rate. */
      readonly jacobianA: MatN;
      /** Exact signed map from B's world-left angular velocity to error rate. */
      readonly jacobianB: MatN;
    }
  | {
      readonly status: 'cut-locus';
      readonly frameA: Rotor4;
      readonly frameB: Rotor4;
      readonly branch: OrientationBranchToken4;
      readonly cutLocusGuard: number;
      readonly shortestPairSign: 1 | -1;
    };

/**
 * Builds the complete six-row rotational coordinate preserving one oriented
 * R4 frame. Translation remains deliberately outside this policy.
 */
export function orientationConstraintBlock4(
  options: OrientationConstraintBlock4Options
): OrientationConstraintEvaluation4 {
  if (options.id.length === 0) {
    throw new Error('orientationConstraintBlock4: id must not be empty');
  }
  const frameA = unitRotor(options.frameA, 'frameA');
  const frameB = unitRotor(options.frameB, 'frameB');
  const coordinates = relativeOrientationCoordinates4(frameA, frameB, {
    trivialization: 'body-right',
    ...(options.previousBranch === undefined
      ? {}
      : { previousBranch: options.previousBranch }),
    ...(options.cutLocusTolerance === undefined
      ? {}
      : { cutLocusTolerance: options.cutLocusTolerance }),
    ...(options.branchHysteresis === undefined
      ? {}
      : { branchHysteresis: options.branchHysteresis })
  });
  if (coordinates.status === 'cut-locus') {
    return {
      status: 'cut-locus',
      frameA,
      frameB,
      branch: coordinates.branch,
      cutLocusGuard: coordinates.cutLocusGuard,
      shortestPairSign: coordinates.shortestPairSign
    };
  }

  const worldToFrameB = inverseBivectorAdjointMatrix4(frameB);
  const jacobianA = orientationDlog4(coordinates.error, 'world-left')
    .multiply(worldToFrameB);
  const jacobianB = new MatN(
    6,
    Array.from(jacobianA.data, (value) => -value)
  );
  const rows = Array.from({ length: 6 }, (_, index): ConstraintRow4 => ({
    id: `${options.id}|orientation:${index}`,
    participantA: options.participantA,
    jacobianA: {
      linear: new VecN(4),
      angular: matrixRowBivector4(jacobianA, index)
    },
    participantB: options.participantB,
    jacobianB: {
      linear: new VecN(4),
      angular: matrixRowBivector4(jacobianB, index)
    },
    positionError: coordinates.error.coeffs[index]!
  }));
  return {
    status: 'regular',
    block: { id: options.id, rows },
    frameA,
    frameB,
    error: coordinates.error.clone(),
    branch: coordinates.branch,
    cutLocusGuard: coordinates.cutLocusGuard,
    shortestPairSign: coordinates.shortestPairSign,
    usesShortestLift: coordinates.usesShortestLift,
    jacobianA,
    jacobianB
  };
}

export type OrientationJoint4Options =
  | {
      readonly id: string;
      readonly bodyA: RigidBody4;
      readonly localFrameA?: Rotor4;
      readonly bodyB: RigidBody4;
      readonly localFrameB?: Rotor4;
      readonly cutLocusTolerance?: number;
      readonly branchHysteresis?: number;
    }
  | {
      readonly id: string;
      readonly bodyA: RigidBody4;
      readonly localFrameA?: Rotor4;
      readonly bodyB?: null;
      readonly worldFrameB: Rotor4;
      readonly cutLocusTolerance?: number;
      readonly branchHysteresis?: number;
    };

/** Persistent material-frame binding with explicit SO(4) branch continuity. */
export class OrientationJoint4 {
  readonly id: string;
  readonly bodyA: RigidBody4;
  readonly localFrameA: Rotor4;
  readonly bodyB: RigidBody4 | null;
  /** Body-local when `bodyB` exists; fixed-world otherwise. */
  readonly frameB: Rotor4;
  readonly cutLocusTolerance: number;
  readonly branchHysteresis: number;
  private previousBranch: OrientationBranchToken4 | undefined;

  constructor(options: OrientationJoint4Options) {
    if (options.id.length === 0) {
      throw new Error('OrientationJoint4: id must not be empty');
    }
    this.id = options.id;
    this.bodyA = options.bodyA;
    this.localFrameA = unitRotor(
      options.localFrameA ?? Rotor4.identity(),
      'localFrameA'
    );
    this.bodyB = options.bodyB ?? null;
    if (this.bodyA === this.bodyB) {
      throw new Error('OrientationJoint4: a body cannot be joined to itself');
    }
    if (this.bodyB === null) {
      if (!('worldFrameB' in options)) {
        throw new Error('OrientationJoint4: a fixed binding needs worldFrameB');
      }
      this.frameB = unitRotor(options.worldFrameB, 'worldFrameB');
    } else {
      this.frameB = unitRotor(
        'localFrameB' in options
          ? options.localFrameB ?? Rotor4.identity()
          : Rotor4.identity(),
        'localFrameB'
      );
    }
    this.cutLocusTolerance = finiteNonNegative(
      options.cutLocusTolerance ?? 1e-10,
      'cutLocusTolerance'
    );
    this.branchHysteresis = finiteNonNegative(
      options.branchHysteresis ?? 1e-6,
      'branchHysteresis'
    );
  }

  worldFrameA(): Rotor4 {
    return this.bodyA.rotation.multiply(this.localFrameA).normalize();
  }

  worldFrameB(): Rotor4 {
    return this.bodyB === null
      ? this.frameB.clone()
      : this.bodyB.rotation.multiply(this.frameB).normalize();
  }

  constraint(): OrientationConstraintEvaluation4 {
    const evaluation = orientationConstraintBlock4({
      id: this.id,
      participantA: this.bodyA,
      participantB: this.bodyB,
      frameA: this.worldFrameA(),
      frameB: this.worldFrameB(),
      ...(this.previousBranch === undefined
        ? {}
        : { previousBranch: this.previousBranch }),
      cutLocusTolerance: this.cutLocusTolerance,
      branchHysteresis: this.branchHysteresis
    });
    this.previousBranch = {
      pairSign: evaluation.branch.pairSign,
      guardAtSelection: evaluation.branch.guardAtSelection
    };
    return evaluation;
  }

  resetBranch(): void {
    this.previousBranch = undefined;
  }
}

function matrixRowBivector4(matrix: MatN, row: number): BivectorN {
  if (matrix.n !== 6 || row < 0 || row >= 6) {
    throw new Error('orientationConstraintBlock4: expected a row of a 6x6 matrix');
  }
  return new BivectorN(4, matrix.data.slice(row * 6, row * 6 + 6));
}

function inverseBivectorAdjointMatrix4(rotation: Rotor4): MatN {
  const matrix = new MatN(6);
  for (let column = 0; column < 6; column++) {
    const basis = new BivectorN(4);
    basis.coeffs[column] = 1;
    const transformed = inverseRotateBivector4(basis, rotation);
    for (let row = 0; row < 6; row++) {
      matrix.data[row * 6 + column] = transformed.coeffs[row]!;
    }
  }
  return matrix;
}

function unitRotor(value: Rotor4, name: string): Rotor4 {
  const result = value.clone();
  for (const [factorName, factor] of [
    ['left', result.left],
    ['right', result.right]
  ] as const) {
    const length = Math.hypot(factor[0]!, factor[1]!, factor[2]!, factor[3]!);
    if (!Number.isFinite(length) || Math.abs(length - 1) > 1e-10) {
      throw new Error(
        `OrientationJoint4: ${name} ${factorName} factor must be finite and normalized`
      );
    }
  }
  return result;
}

function finiteNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `OrientationJoint4: ${name} must be finite and non-negative`
    );
  }
  return value;
}
