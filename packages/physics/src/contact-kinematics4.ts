import { BivectorN, Rotor4, TransformN, VecN } from '@holotope/core';
import type {
  HyperboxContactPatch4,
  HyperboxContactVertex4
} from './hyperbox-contact4.js';
import type { RigidBody4 } from './rigid-body4.js';
import { rigidTrajectoryFromTransforms4 } from './rigid-trajectory4.js';

export type ContactTangentBasis4 = readonly [VecN, VecN, VecN];

/** Instantaneous world-space rigid motion, usable by dynamic or kinematic bodies. */
export interface RigidMotion4 {
  readonly center: VecN;
  readonly linearVelocity: VecN;
  readonly angularVelocityWorld: BivectorN;
}

export interface HyperboxContactKinematicsOptions4 {
  /** Evaluate the bounded solver subset (default) or every patch vertex. */
  pointSource?: 'solver' | 'vertices';
  /** Previous frame basis, projected forward to avoid tangent-coordinate flips. */
  previousTangentBasis?: readonly VecN[];
  /** Linear-independence band for frame construction. Default 1e-10. */
  frameTolerance?: number;
}

export interface HyperboxContactPointKinematics4 {
  readonly id: string;
  readonly vertex: HyperboxContactVertex4;
  /** Original-pose surface anchor on A (resolved point minus `translationA`). */
  readonly anchorA: VecN;
  /** Original-pose surface anchor on B. */
  readonly anchorB: VecN;
  readonly velocityA: VecN;
  readonly velocityB: VecN;
  /** `velocityA - velocityB`. */
  readonly relativeVelocity: VecN;
  /** Positive is separating along the B→A contact normal; negative is closing. */
  readonly normalSpeed: number;
  readonly tangentialVelocity: VecN;
  readonly tangentSpeeds: readonly [number, number, number];
}

export interface HyperboxContactKinematics4 {
  readonly normal: VecN;
  readonly tangentBasis: ContactTangentBasis4;
  readonly points: readonly HyperboxContactPointKinematics4[];
}

/** Snapshot the instantaneous motion of a simulated dynamic body. */
export function rigidMotionFromBody4(body: RigidBody4): RigidMotion4 {
  return {
    center: body.position.clone(),
    linearVelocity: body.linearVelocity.clone(),
    angularVelocityWorld: body.angularVelocityWorld()
  };
}

/**
 * Extract average world-space motion from two coherent rigid poses.
 *
 * This is the kinematic-driver bridge: animated platforms and authored motion
 * can participate in contact velocities without becoming dynamic bodies.
 */
export function rigidMotionFromTransforms4(
  previous: TransformN,
  current: TransformN,
  dt: number
): RigidMotion4 {
  if (!Number.isFinite(dt) || dt <= 0) {
    throw new Error('rigidMotionFromTransforms4: dt must be finite and positive');
  }
  assertRigidTransform4(previous, 'previous');
  assertRigidTransform4(current, 'current');
  const trajectory = rigidTrajectoryFromTransforms4(previous, current);
  return {
    center: current.position.clone(),
    linearVelocity: trajectory.linearDisplacement.clone().multiplyScalar(1 / dt),
    angularVelocityWorld: trajectory.angularDisplacementWorld.clone().scale(1 / dt)
  };
}

/** World velocity `v + Ω·(point-center)` for an R4 rigid motion. */
export function velocityAtWorldPoint4(motion: RigidMotion4, point: VecN): VecN {
  assertMotion4(motion);
  assertVector4(point, 'point');
  const lever = point.clone().sub(motion.center);
  return motion.angularVelocityWorld
    .toSkewMatrix()
    .applyTo(lever)
    .add(motion.linearVelocity);
}

/**
 * Builds the three-dimensional tangent basis of an R4 contact hyperplane.
 * A previous basis is parallel-projected and orthonormalized first, providing
 * coherent tangent coordinates under small normal changes.
 */
export function contactTangentBasis4(
  normal: VecN,
  previousBasis?: readonly VecN[],
  tolerance = 1e-10
): ContactTangentBasis4 {
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error('contactTangentBasis4: tolerance must be finite and non-negative');
  }
  assertVector4(normal, 'normal');
  const unitNormal = normal.clone();
  const normalLength = unitNormal.length();
  if (!(normalLength > tolerance)) {
    throw new Error('contactTangentBasis4: normal must be nonzero');
  }
  unitNormal.multiplyScalar(1 / normalLength);
  if (previousBasis !== undefined && previousBasis.length !== 3) {
    throw new Error('contactTangentBasis4: previousBasis must contain three vectors');
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
    assertVector4(source, 'basis vector');
    const tangent = source.clone();
    tangent.sub(unitNormal.clone().multiplyScalar(tangent.dot(unitNormal)));
    for (const accepted of basis) {
      tangent.sub(accepted.clone().multiplyScalar(tangent.dot(accepted)));
    }
    const length = tangent.length();
    if (length > tolerance) basis.push(tangent.multiplyScalar(1 / length));
    if (basis.length === 3) break;
  }
  if (basis.length !== 3) {
    throw new Error('contactTangentBasis4: could not construct three tangent vectors');
  }
  return basis as [VecN, VecN, VecN];
}

/** Extract normal and full three-tangent relative velocity at every box anchor. */
export function hyperboxContactKinematics4(
  patch: HyperboxContactPatch4,
  motionA: RigidMotion4,
  motionB: RigidMotion4,
  options: HyperboxContactKinematicsOptions4 = {}
): HyperboxContactKinematics4 {
  const pointSource = options.pointSource ?? 'solver';
  if (pointSource !== 'solver' && pointSource !== 'vertices') {
    throw new Error('hyperboxContactKinematics4: pointSource must be solver or vertices');
  }
  assertMotion4(motionA);
  assertMotion4(motionB);
  const normal = patch.normal.clone().normalize();
  const tangentBasis = contactTangentBasis4(
    normal,
    options.previousTangentBasis,
    options.frameTolerance ?? 1e-10
  );
  const vertices = pointSource === 'solver' ? patch.solverPoints : patch.vertices;
  const points = vertices.map((vertex): HyperboxContactPointKinematics4 => {
    const anchorA = vertex.point.clone().sub(patch.translationA);
    const anchorB = vertex.point.clone();
    const velocityA = velocityAtWorldPoint4(motionA, anchorA);
    const velocityB = velocityAtWorldPoint4(motionB, anchorB);
    const relativeVelocity = velocityA.clone().sub(velocityB);
    const normalSpeed = relativeVelocity.dot(normal);
    const tangentialVelocity = relativeVelocity
      .clone()
      .sub(normal.clone().multiplyScalar(normalSpeed));
    return {
      id: vertex.id,
      vertex,
      anchorA,
      anchorB,
      velocityA,
      velocityB,
      relativeVelocity,
      normalSpeed,
      tangentialVelocity,
      tangentSpeeds: [
        tangentialVelocity.dot(tangentBasis[0]),
        tangentialVelocity.dot(tangentBasis[1]),
        tangentialVelocity.dot(tangentBasis[2])
      ]
    };
  });
  return { normal, tangentBasis, points };
}

function assertRigidTransform4(transform: TransformN, name: string): void {
  if (
    transform.dim !== 4 ||
    Array.from(transform.position.data).some((value) => !Number.isFinite(value))
  ) {
    throw new Error(`rigidMotionFromTransforms4: ${name} must be a finite R4 transform`);
  }
  const matrix = transform.rotation instanceof Rotor4
    ? transform.rotation.toMatrix()
    : transform.rotation;
  if (
    Array.from(matrix.data).some((value) => !Number.isFinite(value)) ||
    matrix.orthogonalityError() > 1e-10 ||
    Math.abs(matrix.determinant() - 1) > 1e-9
  ) {
    throw new Error(`rigidMotionFromTransforms4: ${name} rotation must be proper orthonormal`);
  }
}

function assertMotion4(motion: RigidMotion4): void {
  assertVector4(motion.center, 'motion center');
  assertVector4(motion.linearVelocity, 'linear velocity');
  if (
    motion.angularVelocityWorld.n !== 4 ||
    Array.from(motion.angularVelocityWorld.coeffs).some((value) => !Number.isFinite(value))
  ) {
    throw new Error('contact kinematics: angular velocity must be a finite R4 bivector');
  }
}

function assertVector4(vector: VecN, name: string): void {
  if (
    vector.dim !== 4 ||
    Array.from(vector.data).some((value) => !Number.isFinite(value))
  ) {
    throw new Error(`contact kinematics: ${name} must contain four finite coordinates`);
  }
}
