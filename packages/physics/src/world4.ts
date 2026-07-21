import { VecN } from '@holotope/core';
import { RigidBody4 } from './rigid-body4.js';
import {
  applyRigidBodyPosePlan4,
  planRigidBodyPose4
} from './rigid-body-pose-plan4.js';

export interface PhysicsWorld4Options {
  /** Default is y-down: [0, -9.81, 0, 0]. */
  gravity?: VecN | ArrayLike<number>;
}

/** Called after force integration and before pose integration in each substep. */
export type PhysicsWorld4VelocityConstraintCallback = (
  substepDt: number,
  substepIndex: number
) => void;

/** Fixed-step world with an explicit velocity-constraint callback seam. */
export class PhysicsWorld4 {
  readonly gravity: VecN;
  readonly bodies: RigidBody4[] = [];

  constructor(options: PhysicsWorld4Options = {}) {
    this.gravity = options.gravity instanceof VecN
      ? options.gravity.clone()
      : new VecN(options.gravity ?? [0, -9.81, 0, 0]);
    if (
      this.gravity.dim !== 4 ||
      Array.from(this.gravity.data).some((value) => !Number.isFinite(value))
    ) {
      throw new Error('PhysicsWorld4: gravity must contain four finite coordinates');
    }
  }

  addBody(body: RigidBody4): this {
    if (!this.bodies.includes(body)) this.bodies.push(body);
    return this;
  }

  removeBody(body: RigidBody4): this {
    const index = this.bodies.indexOf(body);
    if (index >= 0) this.bodies.splice(index, 1);
    return this;
  }

  /**
   * Integrates force/torque into velocities without moving any pose.
   *
   * This low-level stage exists so event-driven contact can split pose
   * integration at a time of impact. Accumulators remain live until
   * `clearAccumulators()`; ordinary callers should continue to use `step()`.
   */
  integrateVelocities(dt: number): this {
    assertPositiveStep(dt, 'PhysicsWorld4.integrateVelocities');
    for (const body of this.bodies) integrateBodyVelocity(body, dt, this.gravity);
    return this;
  }

  /** Advances every body pose using its current post-constraint velocity. */
  integratePoses(dt: number): this {
    assertPositiveStep(dt, 'PhysicsWorld4.integratePoses');
    for (const body of this.bodies) integrateBodyPose(body, dt);
    return this;
  }

  /** Clears forces and torques after a complete manually staged step. */
  clearAccumulators(): this {
    for (const body of this.bodies) body.clearAccumulators();
    return this;
  }

  /**
   * Advances force, momentum, velocity, position, and Spin(4) orientation.
   * Forces and torques are held constant across substeps, then cleared.
   */
  step(
    dt: number,
    substeps = 1,
    solveVelocityConstraints?: PhysicsWorld4VelocityConstraintCallback
  ): void {
    assertPositiveStep(dt, 'PhysicsWorld4.step');
    if (!Number.isSafeInteger(substeps) || substeps < 1) {
      throw new Error('PhysicsWorld4.step: substeps must be a positive integer');
    }
    const substep = dt / substeps;
    for (let iteration = 0; iteration < substeps; iteration++) {
      this.integrateVelocities(substep);
      solveVelocityConstraints?.(substep, iteration);
      this.integratePoses(substep);
    }
    this.clearAccumulators();
  }
}

function assertPositiveStep(dt: number, owner: string): void {
  if (!Number.isFinite(dt) || dt <= 0) {
    throw new Error(`${owner}: dt must be finite and positive`);
  }
}

function integrateBodyVelocity(body: RigidBody4, dt: number, gravity: VecN): void {
  for (let component = 0; component < 6; component++) {
    body.angularMomentumWorld.coeffs[component]! += body.torque.coeffs[component]! * dt;
  }

  for (let axis = 0; axis < 4; axis++) {
    const acceleration =
      gravity.data[axis]! * body.gravityScale + body.force.data[axis]! * body.invMass;
    body.linearVelocity.data[axis]! += acceleration * dt;
  }
}

function integrateBodyPose(body: RigidBody4, dt: number): void {
  applyRigidBodyPosePlan4(planRigidBodyPose4(body, dt), 1);
}
