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
      ? normalizedRotor4(options.start.rotation, 'start')
      : rotorFromMatrix(options.start.rotation, 'start');
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

/**
 * Builds the principal constant-generator screw segment between two R4 poses.
 * A relative central inversion is refused because the endpoints do not select
 * a unique SO(4) logarithm; callers must subdivide or author the generator.
 */
export function rigidTrajectoryFromTransforms4(
  start: TransformN,
  end: TransformN
): RigidTrajectory4 {
  if (
    end.dim !== 4 ||
    Array.from(end.position.data).some((coordinate) => !Number.isFinite(coordinate))
  ) {
    throw new Error('rigidTrajectoryFromTransforms4: end must be a finite R4 transform');
  }
  const seed = new RigidTrajectory4({
    start,
    linearDisplacement: new Float64Array(4),
    angularDisplacementWorld: new Float64Array(6)
  });
  const endRotor = end.rotation instanceof Rotor4
    ? normalizedRotor4(end.rotation, 'end')
    : rotorFromMatrix(end.rotation, 'end');
  const startRotor = seed.start.rotation as Rotor4;
  return new RigidTrajectory4({
    start: seed.start,
    linearDisplacement: end.position.clone().sub(seed.start.position),
    angularDisplacementWorld: endRotor.multiply(startRotor.conjugate()).log()
  });
}

function rotorFromMatrix(matrix: MatN, name: string): Rotor4 {
  try {
    return Rotor4.fromMatrix(matrix);
  } catch (error) {
    throw new Error(
      `RigidTrajectory4: ${name} rotation must be proper orthonormal (${error instanceof Error ? error.message : String(error)})`
    );
  }
}

function normalizedRotor4(value: Rotor4, name: string): Rotor4 {
  for (const factor of [value.left, value.right]) {
    const length = Math.hypot(factor[0]!, factor[1]!, factor[2]!, factor[3]!);
    if (!Number.isFinite(length) || !(length > 1e-15)) {
      throw new Error(
        `RigidTrajectory4: ${name} rotation must have finite nonzero factors`
      );
    }
  }
  return value.clone().normalize();
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
