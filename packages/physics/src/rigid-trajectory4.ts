import {
  BivectorN,
  MatN,
  Rotor4,
  TransformN,
  VecN
} from '@holotope/core';
import { angularVelocityOperatorNorm4 } from './orientation-coordinates4.js';

export interface RigidTrajectory4Options {
  readonly start: TransformN;
  /** Complete translation over normalized time `[0,1]`. */
  readonly linearDisplacement: VecN | ArrayLike<number>;
  /** World-left exponential generator over normalized time `[0,1]`. */
  readonly angularDisplacementWorld: BivectorN | ArrayLike<number>;
}

/** Explicit constant-generator R4 screw trajectory over normalized time. */
export class RigidTrajectory4 {
  readonly start: TransformN;
  readonly linearDisplacement: VecN;
  readonly angularDisplacementWorld: BivectorN;
  private readonly startRotor: Rotor4;

  constructor(options: RigidTrajectory4Options) {
    if (options.start.dim !== 4) {
      throw new Error('RigidTrajectory4: start must be an R4 transform');
    }
    if (
      Array.from(options.start.position.data)
        .some((coordinate) => !Number.isFinite(coordinate))
    ) {
      throw new Error('RigidTrajectory4: start position must be finite');
    }
    this.startRotor = options.start.rotation instanceof Rotor4
      ? options.start.rotation.clone().normalize()
      : rotorFromMatrix(options.start.rotation);
    this.start = new TransformN(
      4,
      this.startRotor.clone(),
      options.start.position.clone()
    );
    this.linearDisplacement = vector4(
      options.linearDisplacement,
      'linearDisplacement'
    );
    this.angularDisplacementWorld = bivector4(
      options.angularDisplacementWorld,
      'angularDisplacementWorld'
    );
  }

  poseAt(time: number): TransformN {
    requireNormalizedTime(time, 'RigidTrajectory4.poseAt');
    const increment = Rotor4.fromBivector(
      this.angularDisplacementWorld.clone().scale(time)
    );
    return new TransformN(
      4,
      increment.multiply(this.startRotor),
      this.start.position.clone().add(
        this.linearDisplacement.clone().multiplyScalar(time)
      )
    );
  }

  /** Bound on any pivot-relative material point with norm at most `radius`. */
  pointSpeedBound(radius: number): number {
    if (!Number.isFinite(radius) || radius < 0) {
      throw new Error(
        'RigidTrajectory4.pointSpeedBound: radius must be finite and non-negative'
      );
    }
    return this.linearDisplacement.length() +
      angularVelocityOperatorNorm4(this.angularDisplacementWorld) * radius;
  }
}

function rotorFromMatrix(matrix: MatN): Rotor4 {
  try {
    return Rotor4.fromMatrix(matrix);
  } catch (error) {
    throw new Error(
      `RigidTrajectory4: start rotation must be proper orthonormal (${error instanceof Error ? error.message : String(error)})`
    );
  }
}

function vector4(value: VecN | ArrayLike<number>, name: string): VecN {
  const vector = value instanceof VecN ? value.clone() : new VecN(value);
  if (
    vector.dim !== 4 ||
    Array.from(vector.data).some((coordinate) => !Number.isFinite(coordinate))
  ) {
    throw new Error(`RigidTrajectory4: ${name} must contain four finite coordinates`);
  }
  return vector;
}

function bivector4(
  value: BivectorN | ArrayLike<number>,
  name: string
): BivectorN {
  const bivector = value instanceof BivectorN
    ? value.clone()
    : new BivectorN(4, value);
  if (
    bivector.n !== 4 ||
    Array.from(bivector.coeffs).some((coefficient) => !Number.isFinite(coefficient))
  ) {
    throw new Error(`RigidTrajectory4: ${name} must contain six finite coefficients`);
  }
  return bivector;
}

function requireNormalizedTime(time: number, owner: string): void {
  if (!Number.isFinite(time) || time < 0 || time > 1) {
    throw new Error(`${owner}: time must be finite and in [0, 1]`);
  }
}
