import { VecN } from '@holotope/core';
import type { ContactTangentBasis4 } from './contact-kinematics4.js';
import { contactTangentBasis4 } from './contact-kinematics4.js';
import {
  applyPointPairImpulse4,
  constraintRowCoupling4,
  constraintRowResponse4,
  pointConstraintRow4,
  pointPairRelativeVelocity4,
  type ConstraintParticipant4
} from './constraint-row4.js';
import type { HyperboxContactPatch4 } from './hyperbox-contact4.js';
import type { HyperboxHyperplaneContactPatch4 } from './mixed-contact4.js';
import type { PolytopeContactPatch4 } from './polytope-contact4.js';
import type { PolytopeHyperplaneContactPatch4 } from './polytope-plane-contact4.js';
import { RigidBody4 } from './rigid-body4.js';
import type { SmoothPointContactPatchN } from './smooth-contact.js';

/** Dynamic body, prescribed rigid motion, or an immovable participant. */
export type ContactParticipant4 = ConstraintParticipant4;

export interface ContactConstraint4 {
  /** Must be unique within a solver; persistent IDs retain warm impulses. */
  readonly id: string;
  readonly participantA: ContactParticipant4;
  readonly participantB: ContactParticipant4;
  /** Unit direction from B toward A. Non-unit finite inputs are normalized. */
  readonly normal: VecN;
  /** Actual world-space surface witness on A in the current pose. */
  readonly anchorA: VecN;
  /** Actual world-space surface witness on B in the current pose. */
  readonly anchorB: VecN;
  /** Non-negative overlap used only for velocity-level position bias. */
  readonly penetrationDepth?: number;
  /** Newton restitution coefficient in [0, 1]. Default 0. */
  readonly restitution?: number;
  /** Isotropic Coulomb coefficient for the full R4 tangent 3-ball. Default 0. */
  readonly friction?: number;
}

/** Backward-compatible name for a constraint whose friction is omitted. */
export type NormalContactConstraint4 = ContactConstraint4;

export interface ContactSolver4Options {
  /** Projected block Gauss-Seidel passes. Default 8. */
  iterations?: number;
  /** Closing speed below which restitution is suppressed. Default 0.5. */
  restitutionThreshold?: number;
  /** Fraction of excess penetration corrected per step. Default 0.2. */
  baumgarte?: number;
  /** Penetration ignored by position bias. Default 0.005. */
  penetrationSlop?: number;
  /** Upper bound on position-bias separation speed. Default 2. */
  maxBiasSpeed?: number;
  /** Apply coherent impulses retained from the previous solve. Default true. */
  warmStart?: boolean;
}

export type NormalContactSolver4Options = ContactSolver4Options;

export type ContactFrictionState4 = 'disabled' | 'inactive' | 'sticking' | 'sliding';

export interface ContactPointResult4 {
  readonly id: string;
  /** Scalar normal effective mass. */
  readonly effectiveMass: number;
  readonly initialNormalSpeed: number;
  readonly targetNormalSpeed: number;
  readonly restitutionSpeed: number;
  readonly biasSpeed: number;
  readonly warmStartedImpulse: number;
  readonly accumulatedImpulse: number;
  readonly finalNormalSpeed: number;
  readonly frictionCoefficient: number;
  /** Coherent orthonormal basis of the three-dimensional tangent space. */
  readonly tangentBasis: ContactTangentBasis4;
  /** Row-major 3x3 map from tangent impulse coordinates to relative speed. */
  readonly tangentResponse: Float64Array;
  readonly initialTangentSpeeds: readonly [number, number, number];
  readonly warmStartedTangentImpulse: readonly [number, number, number];
  readonly accumulatedTangentImpulse: readonly [number, number, number];
  readonly tangentImpulseWorld: VecN;
  readonly finalTangentSpeeds: readonly [number, number, number];
  /** Radius mu * lambda_n of the admissible tangent impulse ball. */
  readonly frictionLimit: number;
  readonly frictionState: ContactFrictionState4;
}

export type NormalContactPointResult4 = ContactPointResult4;

export interface ContactSolveResult4 {
  readonly points: readonly ContactPointResult4[];
  readonly retiredIds: readonly string[];
  readonly iterations: number;
  readonly totalNormalImpulse: number;
  readonly totalTangentImpulse: number;
  readonly maxClosingSpeed: number;
  readonly maxTangentialSpeed: number;
}

export type NormalContactSolveResult4 = ContactSolveResult4;

export interface HyperboxNormalContactConstraintsOptions4 {
  /** Namespace for feature-pair IDs; normally the colliding body-pair ID. */
  readonly pairId: string;
  readonly restitution?: number;
  /** Bounded solver subset (default) or every geometric patch vertex. */
  readonly pointSource?: 'solver' | 'vertices';
}

export interface HyperboxContactConstraintsOptions4
  extends HyperboxNormalContactConstraintsOptions4 {
  readonly friction?: number;
}

export interface PolytopeContactConstraintsOptions4
  extends HyperboxNormalContactConstraintsOptions4 {
  readonly friction?: number;
}

export interface SmoothPointContactConstraintOptions4 {
  /** Namespace for the persistent smooth-point ID. */
  readonly pairId: string;
  readonly restitution?: number;
  readonly friction?: number;
}

export interface HyperboxHyperplaneContactConstraintsOptions4 {
  /** Namespace for the persistent support-feature point IDs. */
  readonly pairId: string;
  readonly restitution?: number;
  readonly friction?: number;
}

export type PolytopeHyperplaneContactConstraintsOptions4 =
  HyperboxHyperplaneContactConstraintsOptions4;

interface CachedContactImpulse4 {
  normalImpulse: number;
  normal: VecN;
  tangentImpulseWorld: VecN;
  tangentBasis: ContactTangentBasis4;
  dt: number;
}

interface PreparedConstraint4 {
  source: ContactConstraint4;
  normal: VecN;
  effectiveMass: number;
  initialNormalSpeed: number;
  restitutionSpeed: number;
  biasSpeed: number;
  targetNormalSpeed: number;
  warmStartedImpulse: number;
  accumulatedImpulse: number;
  frictionCoefficient: number;
  tangentBasis: ContactTangentBasis4;
  tangentResponse: Float64Array;
  tangentCholesky: Float64Array;
  initialTangentSpeeds: [number, number, number];
  warmStartedTangentImpulse: Float64Array;
  accumulatedTangentImpulse: Float64Array;
}

/**
 * Warm-started R4 contact solver with a scalar normal constraint and one
 * coupled three-coordinate friction constraint at every contact point.
 *
 * The tangent impulse is projected onto the Euclidean ball
 * `||lambda_t|| <= mu lambda_n`. The full 3x3 tangent response is solved as a
 * block, so friction is isotropic and invariant under a change of tangent
 * basis rather than being three independently clamped 1D constraints.
 */
export class ContactSolver4 {
  readonly iterations: number;
  readonly restitutionThreshold: number;
  readonly baumgarte: number;
  readonly penetrationSlop: number;
  readonly maxBiasSpeed: number;
  readonly warmStart: boolean;
  private cache = new Map<string, CachedContactImpulse4>();

  constructor(options: ContactSolver4Options = {}) {
    this.iterations = options.iterations ?? 8;
    this.restitutionThreshold = options.restitutionThreshold ?? 0.5;
    this.baumgarte = options.baumgarte ?? 0.2;
    this.penetrationSlop = options.penetrationSlop ?? 0.005;
    this.maxBiasSpeed = options.maxBiasSpeed ?? 2;
    this.warmStart = options.warmStart ?? true;
    if (!Number.isSafeInteger(this.iterations) || this.iterations < 1) {
      throw new Error('ContactSolver4: iterations must be a positive integer');
    }
    assertNonNegativeFinite('restitutionThreshold', this.restitutionThreshold);
    assertNonNegativeFinite('baumgarte', this.baumgarte);
    assertNonNegativeFinite('penetrationSlop', this.penetrationSlop);
    assertNonNegativeFinite('maxBiasSpeed', this.maxBiasSpeed);
  }

  solve(
    constraints: readonly ContactConstraint4[],
    dt: number
  ): ContactSolveResult4 {
    if (!Number.isFinite(dt) || dt <= 0) {
      throw new Error('ContactSolver4.solve: dt must be finite and positive');
    }
    const seen = new Set<string>();
    const prepared = constraints.map((constraint) => {
      if (constraint.id.length === 0) {
        throw new Error('ContactSolver4.solve: contact IDs must not be empty');
      }
      if (seen.has(constraint.id)) {
        throw new Error(`ContactSolver4.solve: duplicate contact ID ${constraint.id}`);
      }
      seen.add(constraint.id);
      return this.prepare(constraint, dt);
    });
    const retiredIds = Array.from(this.cache.keys())
      .filter((id) => !seen.has(id))
      .sort();

    if (this.warmStart) {
      for (const constraint of prepared) this.applyWarmStart(constraint, dt);
    }

    for (let iteration = 0; iteration < this.iterations; iteration++) {
      for (const constraint of prepared) {
        this.solveNormal(constraint);
        this.solveFriction(constraint);
      }
    }

    const nextCache = new Map<string, CachedContactImpulse4>();
    const points = prepared.map((constraint): ContactPointResult4 => {
      const tangentImpulseWorld = tangentVectorFromCoordinates(
        constraint.tangentBasis,
        constraint.accumulatedTangentImpulse
      );
      const finalTangentSpeeds = relativeTangentSpeeds(
        constraint.source,
        constraint.tangentBasis
      );
      const frictionLimit =
        constraint.frictionCoefficient * constraint.accumulatedImpulse;
      const tangentMagnitude = vector3Length(constraint.accumulatedTangentImpulse);
      const finalTangentMagnitude = vector3Length(finalTangentSpeeds);
      const frictionState = classifyFriction(
        constraint.frictionCoefficient,
        frictionLimit,
        tangentMagnitude,
        finalTangentMagnitude
      );
      nextCache.set(constraint.source.id, {
        normalImpulse: constraint.accumulatedImpulse,
        normal: constraint.normal.clone(),
        tangentImpulseWorld: tangentImpulseWorld.clone(),
        tangentBasis: cloneTangentBasis(constraint.tangentBasis),
        dt
      });
      return {
        id: constraint.source.id,
        effectiveMass: constraint.effectiveMass,
        initialNormalSpeed: constraint.initialNormalSpeed,
        targetNormalSpeed: constraint.targetNormalSpeed,
        restitutionSpeed: constraint.restitutionSpeed,
        biasSpeed: constraint.biasSpeed,
        warmStartedImpulse: constraint.warmStartedImpulse,
        accumulatedImpulse: constraint.accumulatedImpulse,
        finalNormalSpeed: relativeNormalSpeed(constraint.source, constraint.normal),
        frictionCoefficient: constraint.frictionCoefficient,
        tangentBasis: cloneTangentBasis(constraint.tangentBasis),
        tangentResponse: constraint.tangentResponse.slice(),
        initialTangentSpeeds: tuple3(constraint.initialTangentSpeeds),
        warmStartedTangentImpulse: tuple3(constraint.warmStartedTangentImpulse),
        accumulatedTangentImpulse: tuple3(constraint.accumulatedTangentImpulse),
        tangentImpulseWorld,
        finalTangentSpeeds,
        frictionLimit,
        frictionState
      };
    });
    this.cache = nextCache;
    return {
      points,
      retiredIds,
      iterations: this.iterations,
      totalNormalImpulse: points.reduce(
        (sum, point) => sum + point.accumulatedImpulse,
        0
      ),
      totalTangentImpulse: points.reduce(
        (sum, point) => sum + point.tangentImpulseWorld.length(),
        0
      ),
      maxClosingSpeed: points.reduce(
        (maximum, point) => Math.max(maximum, Math.max(0, -point.finalNormalSpeed)),
        0
      ),
      maxTangentialSpeed: points.reduce(
        (maximum, point) => Math.max(maximum, vector3Length(point.finalTangentSpeeds)),
        0
      )
    };
  }

  reset(): void {
    this.cache.clear();
  }

  private prepare(source: ContactConstraint4, dt: number): PreparedConstraint4 {
    if (
      source.participantA instanceof RigidBody4 &&
      source.participantA === source.participantB
    ) {
      throw new Error('ContactSolver4.solve: a body cannot contact itself');
    }
    assertVector4(source.normal, 'normal');
    assertVector4(source.anchorA, 'anchorA');
    assertVector4(source.anchorB, 'anchorB');
    const normal = source.normal.clone();
    const length = normal.length();
    if (!(length > 0)) {
      throw new Error('ContactSolver4.solve: normal must be nonzero');
    }
    normal.multiplyScalar(1 / length);
    const penetrationDepth = source.penetrationDepth ?? 0;
    assertNonNegativeFinite('penetrationDepth', penetrationDepth);
    const restitution = source.restitution ?? 0;
    if (!Number.isFinite(restitution) || restitution < 0 || restitution > 1) {
      throw new Error('ContactSolver4.solve: restitution must be in [0, 1]');
    }
    const frictionCoefficient = source.friction ?? 0;
    assertNonNegativeFinite('friction', frictionCoefficient);
    const normalResponse = constraintRowResponse4(
      directionalRow(source, normal, 'normal-response')
    );
    if (!(normalResponse > 0) || !Number.isFinite(normalResponse)) {
      throw new Error('ContactSolver4.solve: contact needs a dynamic participant');
    }
    const cached = this.cache.get(source.id);
    const tangentBasis = contactTangentBasis4(normal, cached?.tangentBasis);
    const tangentResponse = tangentResponseMatrix(source, tangentBasis);
    const tangentCholesky = cholesky3(tangentResponse);
    const initialNormalSpeed = relativeNormalSpeed(source, normal);
    if (!Number.isFinite(initialNormalSpeed)) {
      throw new Error('ContactSolver4.solve: contact velocity must be finite');
    }
    const restitutionSpeed = initialNormalSpeed < -this.restitutionThreshold
      ? -restitution * initialNormalSpeed
      : 0;
    const biasSpeed = Math.min(
      this.maxBiasSpeed,
      (this.baumgarte / dt) * Math.max(0, penetrationDepth - this.penetrationSlop)
    );
    return {
      source,
      normal,
      effectiveMass: 1 / normalResponse,
      initialNormalSpeed,
      restitutionSpeed,
      biasSpeed,
      targetNormalSpeed: Math.max(restitutionSpeed, biasSpeed),
      warmStartedImpulse: 0,
      accumulatedImpulse: 0,
      frictionCoefficient,
      tangentBasis,
      tangentResponse,
      tangentCholesky,
      initialTangentSpeeds: relativeTangentSpeeds(source, tangentBasis),
      warmStartedTangentImpulse: new Float64Array(3),
      accumulatedTangentImpulse: new Float64Array(3)
    };
  }

  private applyWarmStart(constraint: PreparedConstraint4, dt: number): void {
    const cached = this.cache.get(constraint.source.id);
    if (!cached) return;
    const normalCoherence = Math.min(
      1,
      Math.max(0, cached.normal.dot(constraint.normal))
    );
    const stepScale = dt / cached.dt;
    const normalImpulse = cached.normalImpulse * stepScale * normalCoherence;
    if (normalImpulse > 0) {
      constraint.warmStartedImpulse = normalImpulse;
      constraint.accumulatedImpulse = normalImpulse;
      applyPairDirectionalImpulse(constraint.source, constraint.normal, normalImpulse);
    }

    if (!(constraint.frictionCoefficient > 0) || !(normalImpulse > 0)) return;
    const tangentWorld = cached.tangentImpulseWorld
      .clone()
      .multiplyScalar(stepScale * normalCoherence);
    tangentWorld.sub(
      constraint.normal.clone().multiplyScalar(tangentWorld.dot(constraint.normal))
    );
    const coordinates = coordinatesInTangentBasis(
      tangentWorld,
      constraint.tangentBasis
    );
    projectVector3ToBall(
      coordinates,
      constraint.frictionCoefficient * normalImpulse
    );
    constraint.warmStartedTangentImpulse.set(coordinates);
    constraint.accumulatedTangentImpulse.set(coordinates);
    applyPairWorldImpulse(
      constraint.source,
      tangentVectorFromCoordinates(constraint.tangentBasis, coordinates)
    );
  }

  private solveNormal(constraint: PreparedConstraint4): void {
    const normalSpeed = relativeNormalSpeed(constraint.source, constraint.normal);
    if (!Number.isFinite(normalSpeed)) {
      throw new Error('ContactSolver4.solve: contact velocity became non-finite');
    }
    const impulseDelta =
      constraint.effectiveMass * (constraint.targetNormalSpeed - normalSpeed);
    const previous = constraint.accumulatedImpulse;
    constraint.accumulatedImpulse = Math.max(0, previous + impulseDelta);
    applyPairDirectionalImpulse(
      constraint.source,
      constraint.normal,
      constraint.accumulatedImpulse - previous
    );
  }

  private solveFriction(constraint: PreparedConstraint4): void {
    if (!(constraint.frictionCoefficient > 0)) return;
    const frictionLimit =
      constraint.frictionCoefficient * constraint.accumulatedImpulse;
    const speeds = relativeTangentSpeeds(constraint.source, constraint.tangentBasis);
    const impulseDelta = solveCholesky3(
      constraint.tangentCholesky,
      new Float64Array([-speeds[0], -speeds[1], -speeds[2]])
    );
    const previous = constraint.accumulatedTangentImpulse.slice();
    for (let coordinate = 0; coordinate < 3; coordinate++) {
      constraint.accumulatedTangentImpulse[coordinate] =
        constraint.accumulatedTangentImpulse[coordinate]! + impulseDelta[coordinate]!;
    }
    projectVector3ToBall(constraint.accumulatedTangentImpulse, frictionLimit);
    const appliedDelta = new Float64Array(3);
    for (let coordinate = 0; coordinate < 3; coordinate++) {
      appliedDelta[coordinate] =
        constraint.accumulatedTangentImpulse[coordinate]! - previous[coordinate]!;
    }
    applyPairWorldImpulse(
      constraint.source,
      tangentVectorFromCoordinates(constraint.tangentBasis, appliedDelta)
    );
  }
}

/**
 * Normal-only compatibility solver. Friction values on supplied constraints
 * are deliberately ignored; use ContactSolver4 for coupled R4 friction.
 */
export class NormalContactSolver4 extends ContactSolver4 {
  override solve(
    constraints: readonly NormalContactConstraint4[],
    dt: number
  ): NormalContactSolveResult4 {
    return super.solve(
      constraints.map((constraint) =>
        constraint.friction === undefined
          ? constraint
          : { ...constraint, friction: 0 }
      ),
      dt
    );
  }
}

/** Converts a resolved hyperbox patch into contact constraints at actual anchors. */
export function contactConstraintsFromHyperboxPatch4(
  patch: HyperboxContactPatch4,
  participantA: ContactParticipant4,
  participantB: ContactParticipant4,
  options: HyperboxContactConstraintsOptions4
): readonly ContactConstraint4[] {
  if (options.pairId.length === 0) {
    throw new Error('contactConstraintsFromHyperboxPatch4: pairId must not be empty');
  }
  const pointSource = options.pointSource ?? 'solver';
  if (pointSource !== 'solver' && pointSource !== 'vertices') {
    throw new Error(
      'contactConstraintsFromHyperboxPatch4: pointSource must be solver or vertices'
    );
  }
  if (options.friction !== undefined) {
    assertNonNegativeFinite('friction', options.friction);
  }
  const vertices = pointSource === 'solver' ? patch.solverPoints : patch.vertices;
  return vertices.map((vertex) => ({
    id: `${options.pairId}|${vertex.id}`,
    participantA,
    participantB,
    normal: patch.normal,
    anchorA: vertex.point.clone().sub(patch.translationA),
    anchorB: vertex.point,
    penetrationDepth: patch.penetrationDepth,
    ...(options.restitution === undefined ? {} : { restitution: options.restitution }),
    ...(options.friction === undefined ? {} : { friction: options.friction })
  }));
}

/** Converts a resolved hyperbox patch into frictionless normal constraints. */
export function normalContactConstraintsFromHyperboxPatch4(
  patch: HyperboxContactPatch4,
  participantA: ContactParticipant4,
  participantB: ContactParticipant4,
  options: HyperboxNormalContactConstraintsOptions4
): readonly NormalContactConstraint4[] {
  return contactConstraintsFromHyperboxPatch4(
    patch,
    participantA,
    participantB,
    options
  );
}

/** Converts a resolved vertex-polytope patch into persistent R4 constraints. */
export function contactConstraintsFromPolytopePatch4(
  patch: PolytopeContactPatch4,
  participantA: ContactParticipant4,
  participantB: ContactParticipant4,
  options: PolytopeContactConstraintsOptions4
): readonly ContactConstraint4[] {
  if (options.pairId.length === 0) {
    throw new Error('contactConstraintsFromPolytopePatch4: pairId must not be empty');
  }
  const pointSource = options.pointSource ?? 'solver';
  if (pointSource !== 'solver' && pointSource !== 'vertices') {
    throw new Error(
      'contactConstraintsFromPolytopePatch4: pointSource must be solver or vertices'
    );
  }
  if (options.friction !== undefined) {
    assertNonNegativeFinite('friction', options.friction);
  }
  const vertices = pointSource === 'solver' ? patch.solverPoints : patch.vertices;
  return vertices.map((vertex) => ({
    id: `${options.pairId}|${vertex.id}`,
    participantA,
    participantB,
    normal: patch.normal.clone(),
    anchorA: vertex.point.clone().sub(patch.translationA),
    anchorB: vertex.point.clone(),
    penetrationDepth: patch.penetrationDepth,
    ...(options.restitution === undefined ? {} : { restitution: options.restitution }),
    ...(options.friction === undefined ? {} : { friction: options.friction })
  }));
}

/** Converts an exact box/plane support feature into response constraints. */
export function contactConstraintsFromHyperboxHyperplanePatch4(
  patch: HyperboxHyperplaneContactPatch4,
  participantA: ContactParticipant4,
  participantB: ContactParticipant4,
  options: HyperboxHyperplaneContactConstraintsOptions4
): readonly ContactConstraint4[] {
  if (options.pairId.length === 0) {
    throw new Error(
      'contactConstraintsFromHyperboxHyperplanePatch4: pairId must not be empty'
    );
  }
  if (options.friction !== undefined) {
    assertNonNegativeFinite('friction', options.friction);
  }
  return patch.solverPoints.map((vertex) => ({
    id: `${options.pairId}|${vertex.id}`,
    participantA,
    participantB,
    normal: patch.normal.clone(),
    anchorA: vertex.pointA.clone(),
    anchorB: vertex.pointB.clone(),
    penetrationDepth: patch.penetrationDepth,
    ...(options.restitution === undefined ? {} : { restitution: options.restitution }),
    ...(options.friction === undefined ? {} : { friction: options.friction })
  }));
}

/** Converts a general polytope/plane support face into response constraints. */
export function contactConstraintsFromPolytopeHyperplanePatch4(
  patch: PolytopeHyperplaneContactPatch4,
  participantA: ContactParticipant4,
  participantB: ContactParticipant4,
  options: PolytopeHyperplaneContactConstraintsOptions4
): readonly ContactConstraint4[] {
  if (options.pairId.length === 0) {
    throw new Error(
      'contactConstraintsFromPolytopeHyperplanePatch4: pairId must not be empty'
    );
  }
  if (options.friction !== undefined) {
    assertNonNegativeFinite('friction', options.friction);
  }
  return patch.solverPoints.map((vertex) => ({
    id: `${options.pairId}|${vertex.id}`,
    participantA,
    participantB,
    normal: patch.normal.clone(),
    anchorA: vertex.pointA.clone(),
    anchorB: vertex.pointB.clone(),
    penetrationDepth: patch.penetrationDepth,
    ...(options.restitution === undefined ? {} : { restitution: options.restitution }),
    ...(options.friction === undefined ? {} : { friction: options.friction })
  }));
}

/** Converts one exact smooth point patch into an R4 response constraint. */
export function contactConstraintFromSmoothPointPatch4(
  patch: SmoothPointContactPatchN,
  participantA: ContactParticipant4,
  participantB: ContactParticipant4,
  options: SmoothPointContactConstraintOptions4
): ContactConstraint4 {
  if (options.pairId.length === 0) {
    throw new Error('contactConstraintFromSmoothPointPatch4: pairId must not be empty');
  }
  assertSmoothPointPatch4(patch);
  if (options.friction !== undefined) {
    assertNonNegativeFinite('friction', options.friction);
  }
  return {
    id: `${options.pairId}|smooth-point`,
    participantA,
    participantB,
    normal: patch.normal.clone(),
    anchorA: patch.pointA.clone(),
    anchorB: patch.pointB.clone(),
    penetrationDepth: patch.penetrationDepth,
    ...(options.restitution === undefined ? {} : { restitution: options.restitution }),
    ...(options.friction === undefined ? {} : { friction: options.friction })
  };
}

/** Frictionless compatibility form of the exact smooth point adapter. */
export function normalContactConstraintFromSmoothPointPatch4(
  patch: SmoothPointContactPatchN,
  participantA: ContactParticipant4,
  participantB: ContactParticipant4,
  options: Omit<SmoothPointContactConstraintOptions4, 'friction'>
): NormalContactConstraint4 {
  return contactConstraintFromSmoothPointPatch4(
    patch,
    participantA,
    participantB,
    options
  );
}

function tangentResponseMatrix(
  constraint: ContactConstraint4,
  basis: ContactTangentBasis4
): Float64Array {
  const rows = basis.map((direction, index) =>
    directionalRow(constraint, direction, `tangent-response-${index}`)
  );
  const response = new Float64Array(9);
  for (let column = 0; column < 3; column++) {
    for (let row = 0; row < 3; row++) {
      response[row * 3 + column] = constraintRowCoupling4(
        rows[row]!,
        rows[column]!
      );
    }
  }
  for (let row = 0; row < 3; row++) {
    for (let column = row + 1; column < 3; column++) {
      const symmetric =
        0.5 * (response[row * 3 + column]! + response[column * 3 + row]!);
      response[row * 3 + column] = symmetric;
      response[column * 3 + row] = symmetric;
    }
  }
  return response;
}

function relativeVelocity(constraint: ContactConstraint4): VecN {
  return pointPairRelativeVelocity4(constraint);
}

function relativeNormalSpeed(
  constraint: ContactConstraint4,
  normal: VecN
): number {
  return relativeVelocity(constraint).dot(normal);
}

function relativeTangentSpeeds(
  constraint: ContactConstraint4,
  basis: ContactTangentBasis4
): [number, number, number] {
  const velocity = relativeVelocity(constraint);
  return [
    velocity.dot(basis[0]),
    velocity.dot(basis[1]),
    velocity.dot(basis[2])
  ];
}

function applyPairDirectionalImpulse(
  constraint: ContactConstraint4,
  direction: VecN,
  scalar: number
): void {
  if (scalar === 0) return;
  applyPairWorldImpulse(constraint, direction.clone().multiplyScalar(scalar));
}

function applyPairWorldImpulse(
  constraint: ContactConstraint4,
  impulse: VecN
): void {
  applyPointPairImpulse4(constraint, impulse);
}

function directionalRow(
  constraint: ContactConstraint4,
  direction: VecN,
  suffix: string
) {
  return pointConstraintRow4({
    id: `${constraint.id}|${suffix}`,
    participantA: constraint.participantA,
    participantB: constraint.participantB,
    anchorA: constraint.anchorA,
    anchorB: constraint.anchorB,
    direction
  });
}

function coordinatesInTangentBasis(
  vector: VecN,
  basis: ContactTangentBasis4
): Float64Array {
  return new Float64Array([
    vector.dot(basis[0]),
    vector.dot(basis[1]),
    vector.dot(basis[2])
  ]);
}

function tangentVectorFromCoordinates(
  basis: ContactTangentBasis4,
  coordinates: ArrayLike<number>
): VecN {
  const result = new VecN(4);
  for (let coordinate = 0; coordinate < 3; coordinate++) {
    result.add(basis[coordinate]!.clone().multiplyScalar(coordinates[coordinate]!));
  }
  return result;
}

function projectVector3ToBall(vector: Float64Array, radius: number): void {
  if (!(radius > 0)) {
    vector.fill(0);
    return;
  }
  const length = vector3Length(vector);
  if (length <= radius) return;
  const scale = radius / length;
  for (let coordinate = 0; coordinate < 3; coordinate++) {
    vector[coordinate] = vector[coordinate]! * scale;
  }
}

function vector3Length(vector: ArrayLike<number>): number {
  return Math.hypot(vector[0]!, vector[1]!, vector[2]!);
}

function cholesky3(matrix: Float64Array): Float64Array {
  const factor = new Float64Array(9);
  const scale = Math.max(matrix[0]!, matrix[4]!, matrix[8]!, 1);
  const tolerance = 1e-14 * scale;
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column <= row; column++) {
      let value = matrix[row * 3 + column]!;
      for (let k = 0; k < column; k++) {
        value -= factor[row * 3 + k]! * factor[column * 3 + k]!;
      }
      if (row === column) {
        if (!(value > tolerance) || !Number.isFinite(value)) {
          throw new Error(
            'ContactSolver4.solve: tangent response must be positive definite'
          );
        }
        factor[row * 3 + column] = Math.sqrt(value);
      } else {
        factor[row * 3 + column] = value / factor[column * 3 + column]!;
      }
    }
  }
  return factor;
}

function solveCholesky3(
  factor: Float64Array,
  rightHandSide: Float64Array
): Float64Array {
  const intermediate = new Float64Array(3);
  for (let row = 0; row < 3; row++) {
    let value = rightHandSide[row]!;
    for (let column = 0; column < row; column++) {
      value -= factor[row * 3 + column]! * intermediate[column]!;
    }
    intermediate[row] = value / factor[row * 3 + row]!;
  }
  const result = new Float64Array(3);
  for (let row = 2; row >= 0; row--) {
    let value = intermediate[row]!;
    for (let column = row + 1; column < 3; column++) {
      value -= factor[column * 3 + row]! * result[column]!;
    }
    result[row] = value / factor[row * 3 + row]!;
  }
  return result;
}

function classifyFriction(
  coefficient: number,
  limit: number,
  impulseMagnitude: number,
  finalSpeed: number
): ContactFrictionState4 {
  if (!(coefficient > 0)) return 'disabled';
  if (!(limit > 0)) return 'inactive';
  const atBoundary = impulseMagnitude >= limit * (1 - 1e-9);
  return atBoundary && finalSpeed > 1e-9 ? 'sliding' : 'sticking';
}

function cloneTangentBasis(basis: ContactTangentBasis4): ContactTangentBasis4 {
  return [basis[0].clone(), basis[1].clone(), basis[2].clone()];
}

function tuple3(values: ArrayLike<number>): [number, number, number] {
  return [values[0]!, values[1]!, values[2]!];
}

function assertVector4(vector: VecN, name: string): void {
  if (
    vector.dim !== 4 ||
    Array.from(vector.data).some((value) => !Number.isFinite(value))
  ) {
    throw new Error(`ContactSolver4.solve: ${name} must be a finite R4 vector`);
  }
}

function assertSmoothPointPatch4(patch: SmoothPointContactPatchN): void {
  for (const [name, vector] of [
    ['normal', patch.normal],
    ['pointA', patch.pointA],
    ['pointB', patch.pointB],
    ['translationA', patch.translationA],
    ['resolvedPoint', patch.resolvedPoint]
  ] as const) {
    if (
      vector.dim !== 4 ||
      Array.from(vector.data).some((coordinate) => !Number.isFinite(coordinate))
    ) {
      throw new Error(
        `contactConstraintFromSmoothPointPatch4: ${name} must be a finite R4 vector`
      );
    }
  }
  if (!(patch.normal.lengthSq() > 0)) {
    throw new Error('contactConstraintFromSmoothPointPatch4: normal must be nonzero');
  }
  assertNonNegativeFinite('penetrationDepth', patch.penetrationDepth);
}

function assertNonNegativeFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`ContactSolver4: ${name} must be finite and non-negative`);
  }
}
