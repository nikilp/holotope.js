import { BivectorN, VecN, wedgeVectors } from '@holotope/core';
import type { RigidMotion4 } from './contact-kinematics4.js';
import { velocityAtWorldPoint4 } from './contact-kinematics4.js';
import { RigidBody4 } from './rigid-body4.js';

/** Dynamic body, prescribed rigid motion, or an immovable world participant. */
export type ConstraintParticipant4 = RigidBody4 | RigidMotion4 | null;

/** One participant's linear and six-plane angular coefficients in an R4 row. */
export interface RigidJacobian4 {
  readonly linear: VecN;
  readonly angular: BivectorN;
}

/**
 * Scalar rigid-Jacobian row `J_A v_A + J_B v_B = targetSpeed`.
 *
 * `positionError` must use the same orientation as the Jacobian: positive
 * error is reduced by negative coordinate speed. Persistent rows must retain
 * a coherent ID and Jacobian orientation for warm starting.
 */
export interface ConstraintRow4 {
  readonly id: string;
  readonly participantA: ConstraintParticipant4;
  readonly jacobianA: RigidJacobian4;
  readonly participantB: ConstraintParticipant4;
  readonly jacobianB: RigidJacobian4;
  readonly positionError?: number;
  /** Authored coordinate speed before position stabilization. Default 0. */
  readonly velocityTarget?: number;
  /** Lower generalized-force bound. Default negative infinity. */
  readonly minForce?: number;
  /** Upper generalized-force bound. Default positive infinity. */
  readonly maxForce?: number;
}

export interface ConstraintRowSolver4Options {
  /** Projected Gauss-Seidel passes. Default 8. */
  readonly iterations?: number;
  /** Fraction of signed position error corrected per step. Default 0.2. */
  readonly baumgarte?: number;
  /** Absolute position error ignored by velocity-level bias. Default 0.001. */
  readonly positionSlop?: number;
  /** Upper bound on the stabilization coordinate speed. Default 2. */
  readonly maxBiasSpeed?: number;
  /** Apply coherent impulses retained from the previous solve. Default true. */
  readonly warmStart?: boolean;
}

export type ConstraintImpulseState4 =
  | 'unbounded'
  | 'within-bounds'
  | 'at-minimum'
  | 'at-maximum'
  | 'fixed';

export interface ConstraintRowResult4 {
  readonly id: string;
  readonly positionError: number;
  /** Scalar `J M^-1 J^T`. */
  readonly response: number;
  readonly effectiveMass: number;
  readonly initialSpeed: number;
  readonly velocityTarget: number;
  readonly biasSpeed: number;
  readonly targetSpeed: number;
  readonly minForce: number;
  readonly maxForce: number;
  readonly minImpulse: number;
  readonly maxImpulse: number;
  readonly warmStartedImpulse: number;
  readonly accumulatedImpulse: number;
  readonly impulseState: ConstraintImpulseState4;
  readonly finalSpeed: number;
  /** Raw equality residual; may remain nonzero at a valid active bound. */
  readonly residualSpeed: number;
  /** Projected fixed-point residual; zero is the bounded-row KKT condition. */
  readonly projectedResidualSpeed: number;
}

export interface ConstraintRowSolveResult4 {
  readonly rows: readonly ConstraintRowResult4[];
  readonly retiredIds: readonly string[];
  readonly iterations: number;
  /** Sum of absolute scalar row impulses; coordinate-scale diagnostic only. */
  readonly sumAbsoluteCoordinateImpulse: number;
  readonly maxResidualSpeed: number;
  readonly maxProjectedResidualSpeed: number;
  /** Maximum absolute authored row error; units depend on row coordinates. */
  readonly maxAbsoluteCoordinateError: number;
}

export interface PointConstraintPair4 {
  readonly participantA: ConstraintParticipant4;
  readonly participantB: ConstraintParticipant4;
  readonly anchorA: VecN;
  readonly anchorB: VecN;
}

export interface PointConstraintRow4Options {
  readonly id: string;
  readonly participantA: ConstraintParticipant4;
  readonly participantB: ConstraintParticipant4;
  readonly anchorA: VecN | ArrayLike<number>;
  readonly anchorB: VecN | ArrayLike<number>;
  /** Finite nonzero world direction; normalized by the adapter. */
  readonly direction: VecN | ArrayLike<number>;
  readonly positionError?: number;
  readonly velocityTarget?: number;
  readonly minForce?: number;
  readonly maxForce?: number;
}

interface CachedConstraintImpulse4 {
  impulse: number;
  dt: number;
  row: ConstraintRow4;
}

interface PreparedConstraintRow4 {
  source: ConstraintRow4;
  positionError: number;
  response: number;
  effectiveMass: number;
  initialSpeed: number;
  velocityTarget: number;
  biasSpeed: number;
  targetSpeed: number;
  minForce: number;
  maxForce: number;
  minImpulse: number;
  maxImpulse: number;
  warmStartedImpulse: number;
  accumulatedImpulse: number;
}

/** Warm-started projected solver for scalar rigid-Jacobian rows in R4. */
export class ConstraintRowSolver4 {
  readonly iterations: number;
  readonly baumgarte: number;
  readonly positionSlop: number;
  readonly maxBiasSpeed: number;
  readonly warmStart: boolean;
  private cache = new Map<string, CachedConstraintImpulse4>();

  constructor(options: ConstraintRowSolver4Options = {}) {
    this.iterations = options.iterations ?? 8;
    this.baumgarte = options.baumgarte ?? 0.2;
    this.positionSlop = options.positionSlop ?? 0.001;
    this.maxBiasSpeed = options.maxBiasSpeed ?? 2;
    this.warmStart = options.warmStart ?? true;
    if (!Number.isSafeInteger(this.iterations) || this.iterations < 1) {
      throw new Error('ConstraintRowSolver4: iterations must be a positive integer');
    }
    assertNonNegativeFinite('baumgarte', this.baumgarte);
    assertNonNegativeFinite('positionSlop', this.positionSlop);
    assertNonNegativeFinite('maxBiasSpeed', this.maxBiasSpeed);
  }

  solve(
    constraints: readonly ConstraintRow4[],
    dt: number
  ): ConstraintRowSolveResult4 {
    if (!Number.isFinite(dt) || dt <= 0) {
      throw new Error('ConstraintRowSolver4.solve: dt must be finite and positive');
    }
    const seen = new Set<string>();
    const prepared = constraints.map((constraint) => {
      if (constraint.id.length === 0) {
        throw new Error('ConstraintRowSolver4.solve: row IDs must not be empty');
      }
      if (seen.has(constraint.id)) {
        throw new Error(
          `ConstraintRowSolver4.solve: duplicate row ID ${constraint.id}`
        );
      }
      seen.add(constraint.id);
      return this.prepare(constraint, dt);
    });
    const retiredIds = Array.from(this.cache.keys())
      .filter((id) => !seen.has(id))
      .sort();

    if (this.warmStart) {
      for (const row of prepared) this.applyWarmStart(row, dt);
    }
    for (let iteration = 0; iteration < this.iterations; iteration++) {
      for (const row of prepared) this.solveRow(row);
    }

    const nextCache = new Map<string, CachedConstraintImpulse4>();
    const rows = prepared.map((row): ConstraintRowResult4 => {
      const finalSpeed = constraintRowSpeed4(row.source);
      const residualSpeed = finalSpeed - row.targetSpeed;
      const projectedImpulse = clamp(
        row.accumulatedImpulse +
          row.effectiveMass * (row.targetSpeed - finalSpeed),
        row.minImpulse,
        row.maxImpulse
      );
      const projectedResidualSpeed =
        (row.accumulatedImpulse - projectedImpulse) / row.effectiveMass;
      nextCache.set(row.source.id, {
        impulse: row.accumulatedImpulse,
        dt,
        row: cloneConstraintRowGeometry4(row.source)
      });
      return {
        id: row.source.id,
        positionError: row.positionError,
        response: row.response,
        effectiveMass: row.effectiveMass,
        initialSpeed: row.initialSpeed,
        velocityTarget: row.velocityTarget,
        biasSpeed: row.biasSpeed,
        targetSpeed: row.targetSpeed,
        minForce: row.minForce,
        maxForce: row.maxForce,
        minImpulse: row.minImpulse,
        maxImpulse: row.maxImpulse,
        warmStartedImpulse: row.warmStartedImpulse,
        accumulatedImpulse: row.accumulatedImpulse,
        impulseState: classifyImpulseState(
          row.accumulatedImpulse,
          row.minImpulse,
          row.maxImpulse
        ),
        finalSpeed,
        residualSpeed,
        projectedResidualSpeed
      };
    });
    this.cache = nextCache;
    return {
      rows,
      retiredIds,
      iterations: this.iterations,
      sumAbsoluteCoordinateImpulse: rows.reduce(
        (total, row) => total + Math.abs(row.accumulatedImpulse),
        0
      ),
      maxResidualSpeed: rows.reduce(
        (maximum, row) => Math.max(maximum, Math.abs(row.residualSpeed)),
        0
      ),
      maxProjectedResidualSpeed: rows.reduce(
        (maximum, row) => Math.max(
          maximum,
          Math.abs(row.projectedResidualSpeed)
        ),
        0
      ),
      maxAbsoluteCoordinateError: rows.reduce(
        (maximum, row) => Math.max(maximum, Math.abs(row.positionError)),
        0
      )
    };
  }

  reset(): void {
    this.cache.clear();
  }

  private prepare(
    source: ConstraintRow4,
    dt: number
  ): PreparedConstraintRow4 {
    if (
      source.participantA instanceof RigidBody4 &&
      source.participantA === source.participantB
    ) {
      throw new Error(
        'ConstraintRowSolver4.solve: a body cannot constrain itself'
      );
    }
    assertJacobian4(source.jacobianA, 'jacobianA');
    assertJacobian4(source.jacobianB, 'jacobianB');
    const positionError = source.positionError ?? 0;
    const velocityTarget = source.velocityTarget ?? 0;
    if (!Number.isFinite(positionError)) {
      throw new Error(
        'ConstraintRowSolver4.solve: positionError must be finite'
      );
    }
    if (!Number.isFinite(velocityTarget)) {
      throw new Error(
        'ConstraintRowSolver4.solve: velocityTarget must be finite'
      );
    }
    const minForce = source.minForce ?? -Infinity;
    const maxForce = source.maxForce ?? Infinity;
    assertForceBounds(minForce, maxForce);
    const minImpulse = minForce === -Infinity ? -Infinity : minForce * dt;
    const maxImpulse = maxForce === Infinity ? Infinity : maxForce * dt;
    const response = constraintRowResponse4(source);
    if (
      !(response > 0) ||
      !Number.isFinite(response) ||
      !Number.isFinite(1 / response)
    ) {
      throw new Error(
        'ConstraintRowSolver4.solve: row needs a dynamic participant and positive response'
      );
    }
    const signedCorrection = Math.sign(positionError) * Math.max(
      0,
      Math.abs(positionError) - this.positionSlop
    );
    const rawBias = signedCorrection === 0
      ? 0
      : -(this.baumgarte / dt) * signedCorrection;
    const biasSpeed = rawBias === 0
      ? 0
      : Math.max(-this.maxBiasSpeed, Math.min(this.maxBiasSpeed, rawBias));
    const targetSpeed = velocityTarget + biasSpeed;
    const initialSpeed = constraintRowSpeed4(source);
    return {
      source,
      positionError,
      response,
      effectiveMass: 1 / response,
      initialSpeed,
      velocityTarget,
      biasSpeed,
      targetSpeed,
      minForce,
      maxForce,
      minImpulse,
      maxImpulse,
      warmStartedImpulse: 0,
      accumulatedImpulse: 0
    };
  }

  private applyWarmStart(row: PreparedConstraintRow4, dt: number): void {
    const cached = this.cache.get(row.source.id);
    if (
      !cached ||
      cached.row.participantA !== row.source.participantA ||
      cached.row.participantB !== row.source.participantB
    ) {
      return;
    }
    const projection = constraintRowCoupling4(row.source, cached.row) /
      row.response;
    const projected = cached.impulse * projection * (dt / cached.dt);
    if (!Number.isFinite(projected)) return;
    const impulse = clamp(projected, row.minImpulse, row.maxImpulse);
    row.warmStartedImpulse = impulse;
    row.accumulatedImpulse = impulse;
    applyConstraintRowImpulse4(row.source, impulse);
  }

  private solveRow(row: PreparedConstraintRow4): void {
    const speed = constraintRowSpeed4(row.source);
    const requestedDelta = row.effectiveMass * (row.targetSpeed - speed);
    const previous = row.accumulatedImpulse;
    row.accumulatedImpulse = clamp(
      previous + requestedDelta,
      row.minImpulse,
      row.maxImpulse
    );
    applyConstraintRowImpulse4(
      row.source,
      row.accumulatedImpulse - previous
    );
  }
}

/** Builds a normalized point-direction equality row with exact R4 lever arms. */
export function pointConstraintRow4(
  options: PointConstraintRow4Options
): ConstraintRow4 {
  const anchorA = vector4(options.anchorA, 'anchorA');
  const anchorB = vector4(options.anchorB, 'anchorB');
  const direction = vector4(options.direction, 'direction');
  const length = direction.length();
  if (!(length > 1e-15)) {
    throw new Error('pointConstraintRow4: direction must be nonzero');
  }
  direction.multiplyScalar(1 / length);
  const opposite = direction.clone().multiplyScalar(-1);
  return {
    id: options.id,
    participantA: options.participantA,
    jacobianA: pointJacobian4(options.participantA, anchorA, direction),
    participantB: options.participantB,
    jacobianB: pointJacobian4(options.participantB, anchorB, opposite),
    ...(options.positionError === undefined
      ? {}
      : { positionError: options.positionError }),
    ...(options.velocityTarget === undefined
      ? {}
      : { velocityTarget: options.velocityTarget }),
    ...(options.minForce === undefined ? {} : { minForce: options.minForce }),
    ...(options.maxForce === undefined ? {} : { maxForce: options.maxForce })
  };
}

/** Scalar generalized speed `J_A v_A + J_B v_B`. */
export function constraintRowSpeed4(
  constraint: ConstraintRow4
): number {
  const speed = participantConstraintSpeed4(
    constraint.participantA,
    constraint.jacobianA
  ) + participantConstraintSpeed4(
    constraint.participantB,
    constraint.jacobianB
  );
  if (!Number.isFinite(speed)) {
    throw new Error('constraintRowSpeed4: coordinate speed must be finite');
  }
  return speed;
}

/** Scalar response `J M^-1 J^T`. */
export function constraintRowResponse4(
  constraint: ConstraintRow4
): number {
  return constraintRowCoupling4(constraint, constraint);
}

/** Cross-response `J_left M^-1 J_right^T` for coherent row blocks. */
export function constraintRowCoupling4(
  left: ConstraintRow4,
  right: ConstraintRow4
): number {
  if (
    left.participantA !== right.participantA ||
    left.participantB !== right.participantB
  ) {
    throw new Error(
      'constraintRowCoupling4: rows must reference the same participants'
    );
  }
  return participantConstraintCoupling4(
    left.participantA,
    left.jacobianA,
    right.jacobianA
  ) + participantConstraintCoupling4(
    left.participantB,
    left.jacobianB,
    right.jacobianB
  );
}

/** Applies the generalized impulse `M^-1 J^T lambda` to dynamic participants. */
export function applyConstraintRowImpulse4(
  constraint: ConstraintRow4,
  impulse: number
): void {
  if (!Number.isFinite(impulse)) {
    throw new Error('applyConstraintRowImpulse4: impulse must be finite');
  }
  if (impulse === 0) return;
  applyParticipantConstraintImpulse4(
    constraint.participantA,
    constraint.jacobianA,
    impulse
  );
  applyParticipantConstraintImpulse4(
    constraint.participantB,
    constraint.jacobianB,
    impulse
  );
}

/** Relative world velocity `velocityA(anchorA) - velocityB(anchorB)`. */
export function pointPairRelativeVelocity4(pair: PointConstraintPair4): VecN {
  return participantVelocityAtPoint4(pair.participantA, pair.anchorA)
    .sub(participantVelocityAtPoint4(pair.participantB, pair.anchorB));
}

/** Applies equal and opposite R4 point impulses to a participant pair. */
export function applyPointPairImpulse4(
  pair: PointConstraintPair4,
  impulseWorld: VecN | ArrayLike<number>
): void {
  const impulse = vector4(impulseWorld, 'impulseWorld');
  if (impulse.lengthSq() === 0) return;
  if (pair.participantA instanceof RigidBody4) {
    pair.participantA.applyImpulseAtWorldPoint(impulse, pair.anchorA);
  }
  if (pair.participantB instanceof RigidBody4) {
    pair.participantB.applyImpulseAtWorldPoint(
      impulse.clone().multiplyScalar(-1),
      pair.anchorB
    );
  }
}

/** World velocity of a dynamic, prescribed, or fixed participant at a point. */
export function participantVelocityAtPoint4(
  participant: ConstraintParticipant4,
  anchor: VecN
): VecN {
  if (participant instanceof RigidBody4) {
    return participant.velocityAtWorldPoint(anchor);
  }
  if (participant === null) return new VecN(4);
  return velocityAtWorldPoint4(participant, anchor);
}

function pointJacobian4(
  participant: ConstraintParticipant4,
  anchor: VecN,
  linear: VecN
): RigidJacobian4 {
  if (participant === null) {
    return { linear: linear.clone(), angular: new BivectorN(4) };
  }
  const center = participant instanceof RigidBody4
    ? participant.position
    : participant.center;
  return {
    linear: linear.clone(),
    angular: wedgeVectors(anchor.clone().sub(center), linear)
  };
}

function participantConstraintSpeed4(
  participant: ConstraintParticipant4,
  jacobian: RigidJacobian4
): number {
  if (participant === null) return 0;
  const linearVelocity = participant.linearVelocity;
  const angularVelocity = participant instanceof RigidBody4
    ? participant.angularVelocityWorld()
    : participant.angularVelocityWorld;
  return jacobian.linear.dot(linearVelocity) +
    bivectorDot(jacobian.angular, angularVelocity);
}

function participantConstraintCoupling4(
  participant: ConstraintParticipant4,
  left: RigidJacobian4,
  right: RigidJacobian4
): number {
  if (!(participant instanceof RigidBody4)) return 0;
  return participant.invMass * left.linear.dot(right.linear) + bivectorDot(
    left.angular,
    participant.inverseInertiaWorld(right.angular)
  );
}

function applyParticipantConstraintImpulse4(
  participant: ConstraintParticipant4,
  jacobian: RigidJacobian4,
  impulse: number
): void {
  if (!(participant instanceof RigidBody4)) return;
  participant.linearVelocity.add(
    jacobian.linear.clone().multiplyScalar(participant.invMass * impulse)
  );
  for (let plane = 0; plane < 6; plane++) {
    participant.angularMomentumWorld.coeffs[plane]! +=
      jacobian.angular.coeffs[plane]! * impulse;
  }
}

function cloneConstraintRowGeometry4(
  constraint: ConstraintRow4
): ConstraintRow4 {
  return {
    id: constraint.id,
    participantA: constraint.participantA,
    jacobianA: {
      linear: constraint.jacobianA.linear.clone(),
      angular: constraint.jacobianA.angular.clone()
    },
    participantB: constraint.participantB,
    jacobianB: {
      linear: constraint.jacobianB.linear.clone(),
      angular: constraint.jacobianB.angular.clone()
    }
  };
}

function bivectorDot(left: BivectorN, right: BivectorN): number {
  if (left.n !== 4 || right.n !== 4) {
    throw new Error('constraint row bivectors must be R4');
  }
  let result = 0;
  for (let plane = 0; plane < 6; plane++) {
    result += left.coeffs[plane]! * right.coeffs[plane]!;
  }
  return result;
}

function vector4(value: VecN | ArrayLike<number>, name: string): VecN {
  const vector = value instanceof VecN ? value.clone() : new VecN(value);
  if (
    vector.dim !== 4 ||
    Array.from(vector.data).some((entry) => !Number.isFinite(entry))
  ) {
    throw new Error(`${name} must contain four finite coordinates`);
  }
  return vector;
}

function assertJacobian4(jacobian: RigidJacobian4, name: string): void {
  if (
    jacobian.linear.dim !== 4 ||
    Array.from(jacobian.linear.data).some((entry) => !Number.isFinite(entry)) ||
    jacobian.angular.n !== 4 ||
    Array.from(jacobian.angular.coeffs).some((entry) => !Number.isFinite(entry))
  ) {
    throw new Error(
      `ConstraintRowSolver4.solve: ${name} must be a finite R4 rigid Jacobian`
    );
  }
}

function assertForceBounds(minForce: number, maxForce: number): void {
  if (
    Number.isNaN(minForce) ||
    Number.isNaN(maxForce) ||
    minForce === Infinity ||
    maxForce === -Infinity ||
    minForce > maxForce
  ) {
    throw new Error(
      'ConstraintRowSolver4.solve: force bounds must form a non-empty interval'
    );
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function classifyImpulseState(
  impulse: number,
  minimum: number,
  maximum: number
): ConstraintImpulseState4 {
  if (minimum === -Infinity && maximum === Infinity) return 'unbounded';
  if (minimum === maximum) return 'fixed';
  if (impulse === minimum) return 'at-minimum';
  if (impulse === maximum) return 'at-maximum';
  return 'within-bounds';
}

function assertNonNegativeFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `ConstraintRowSolver4: ${name} must be finite and non-negative`
    );
  }
}
