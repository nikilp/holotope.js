import { BivectorN, Rotor4, VecN, wedgeVectors } from '@holotope/core';
import { inverseRotateBivector4, rotateBivector4 } from './bivector4.js';
import type { MassProperties4 } from './mass-properties4.js';

export interface RigidBody4Options {
  mass: number;
  /** Principal-frame inertia in planes 01,02,03,12,13,23. */
  inertiaDiagonal: ArrayLike<number>;
  position?: VecN | ArrayLike<number>;
  rotation?: Rotor4;
  linearVelocity?: VecN | ArrayLike<number>;
  angularMomentumWorld?: BivectorN | ArrayLike<number>;
  gravityScale?: number;
}

export type RigidBody4StateOptions = Omit<RigidBody4Options, 'mass' | 'inertiaDiagonal'>;

/**
 * A dynamic 4D rigid body whose authoritative angular state is world-frame
 * bivector momentum. Contact/static/kinematic policies are intentionally not
 * part of this ballistic-stage type yet.
 */
export class RigidBody4 {
  readonly mass: number;
  readonly invMass: number;
  readonly inertiaDiagonal: Float64Array;
  readonly invInertiaDiagonal: Float64Array;
  readonly position: VecN;
  rotation: Rotor4;
  readonly linearVelocity: VecN;
  readonly angularMomentumWorld: BivectorN;
  readonly force: VecN;
  readonly torque: BivectorN;
  gravityScale: number;

  constructor(options: RigidBody4Options) {
    if (!Number.isFinite(options.mass) || options.mass <= 0) {
      throw new Error('RigidBody4: mass must be finite and positive');
    }
    if (options.inertiaDiagonal.length !== 6) {
      throw new Error('RigidBody4: inertiaDiagonal must contain six plane inertias');
    }
    this.inertiaDiagonal = Float64Array.from(options.inertiaDiagonal);
    if (Array.from(this.inertiaDiagonal).some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new Error('RigidBody4: all principal inertias must be finite and positive');
    }
    this.invInertiaDiagonal = Float64Array.from(
      this.inertiaDiagonal,
      (value) => 1 / value
    );
    this.mass = options.mass;
    this.invMass = 1 / options.mass;
    this.position = vector4(options.position, 'position');
    this.rotation = options.rotation?.clone() ?? Rotor4.identity();
    this.linearVelocity = vector4(options.linearVelocity, 'linearVelocity');
    this.angularMomentumWorld = bivector4(
      options.angularMomentumWorld,
      'angularMomentumWorld'
    );
    this.force = new VecN(4);
    this.torque = new BivectorN(4);
    this.gravityScale = options.gravityScale ?? 1;
    if (!Number.isFinite(this.gravityScale)) {
      throw new Error('RigidBody4: gravityScale must be finite');
    }
  }

  /** Creates a body whose principal frame initially reproduces the source pose. */
  static fromMassProperties(
    properties: MassProperties4,
    options: RigidBody4StateOptions = {}
  ): RigidBody4 {
    return new RigidBody4({
      mass: properties.mass,
      inertiaDiagonal: properties.inertiaDiagonal,
      position: options.position ?? properties.centerOfMass,
      rotation: options.rotation ?? properties.principalRotor,
      ...(options.linearVelocity !== undefined
        ? { linearVelocity: options.linearVelocity }
        : {}),
      ...(options.angularMomentumWorld !== undefined
        ? { angularMomentumWorld: options.angularMomentumWorld }
        : {}),
      ...(options.gravityScale !== undefined ? { gravityScale: options.gravityScale } : {})
    });
  }

  applyForce(force: VecN | ArrayLike<number>): this {
    this.force.add(vector4(force, 'force'));
    return this;
  }

  applyTorque(torque: BivectorN | ArrayLike<number>): this {
    const value = bivector4(torque, 'torque');
    for (let component = 0; component < 6; component++) {
      this.torque.coeffs[component]! += value.coeffs[component]!;
    }
    return this;
  }

  clearAccumulators(): void {
    this.force.data.fill(0);
    this.torque.coeffs.fill(0);
  }

  angularMomentumBody(rotation = this.rotation): BivectorN {
    return inverseRotateBivector4(this.angularMomentumWorld, rotation);
  }

  angularVelocityBody(rotation = this.rotation): BivectorN {
    const velocity = this.angularMomentumBody(rotation);
    for (let component = 0; component < 6; component++) {
      velocity.coeffs[component]! *= this.invInertiaDiagonal[component]!;
    }
    return velocity;
  }

  angularVelocityWorld(rotation = this.rotation): BivectorN {
    return rotateBivector4(this.angularVelocityBody(rotation), rotation);
  }

  /** Instantaneous world velocity at a world-space point on the body. */
  velocityAtWorldPoint(point: VecN | ArrayLike<number>): VecN {
    const worldPoint = vector4(point, 'point');
    const lever = worldPoint.sub(this.position);
    return this.angularVelocityWorld()
      .toSkewMatrix()
      .applyTo(lever)
      .add(this.linearVelocity);
  }

  /** Applies the world-space inverse inertia operator to an angular impulse. */
  inverseInertiaWorld(
    angularImpulseWorld: BivectorN,
    rotation = this.rotation
  ): BivectorN {
    if (angularImpulseWorld.n !== 4) {
      throw new Error(
        `RigidBody4: angular impulse must be 4D, got n=${angularImpulseWorld.n}`
      );
    }
    if (
      Array.from(angularImpulseWorld.coeffs)
        .some((coefficient) => !Number.isFinite(coefficient))
    ) {
      throw new Error('RigidBody4: angular impulse must contain finite coefficients');
    }
    const body = inverseRotateBivector4(angularImpulseWorld, rotation);
    for (let component = 0; component < 6; component++) {
      body.coeffs[component]! *= this.invInertiaDiagonal[component]!;
    }
    return rotateBivector4(body, rotation);
  }

  /**
   * Applies a world-space R4 linear impulse at a world-space R4 point.
   * Both arrays are `[x, y, z, w]`; an impulse at `position` adds no angular
   * momentum, while an offset point contributes the wedge `r ∧ impulse`.
   */
  applyImpulseAtWorldPoint(
    impulse: VecN | ArrayLike<number>,
    point: VecN | ArrayLike<number>
  ): this {
    const impulseWorld = vector4(impulse, 'impulse');
    const worldPoint = vector4(point, 'point');
    this.linearVelocity.add(impulseWorld.clone().multiplyScalar(this.invMass));
    const lever = worldPoint.sub(this.position);
    const angularImpulse = wedgeVectors(lever, impulseWorld);
    for (let component = 0; component < 6; component++) {
      this.angularMomentumWorld.coeffs[component]! += angularImpulse.coeffs[component]!;
    }
    return this;
  }

  /**
   * Sets world-space R4 angular velocity. The bivector must have six plane
   * coefficients in `[xy, xz, xw, yz, yw, zw]` order; it is converted to the
   * authoritative world-frame angular momentum using this body's inertia.
   */
  setAngularVelocityWorld(velocityWorld: BivectorN): this {
    if (velocityWorld.n !== 4) {
      throw new Error(`RigidBody4: angular velocity must be 4D, got n=${velocityWorld.n}`);
    }
    const velocityBody = inverseRotateBivector4(velocityWorld, this.rotation);
    const momentumBody = velocityBody.clone();
    for (let component = 0; component < 6; component++) {
      momentumBody.coeffs[component]! *= this.inertiaDiagonal[component]!;
    }
    this.angularMomentumWorld.coeffs.set(
      rotateBivector4(momentumBody, this.rotation).coeffs
    );
    return this;
  }

  translationalKineticEnergy(): number {
    return 0.5 * this.mass * this.linearVelocity.lengthSq();
  }

  rotationalKineticEnergy(): number {
    const momentumBody = this.angularMomentumBody();
    let energy = 0;
    for (let component = 0; component < 6; component++) {
      energy +=
        0.5 * momentumBody.coeffs[component]! ** 2 *
        this.invInertiaDiagonal[component]!;
    }
    return energy;
  }

  kineticEnergy(): number {
    return this.translationalKineticEnergy() + this.rotationalKineticEnergy();
  }
}

function vector4(value: VecN | ArrayLike<number> | undefined, name: string): VecN {
  const vector = value instanceof VecN
    ? value.clone()
    : new VecN(value ?? new Float64Array(4));
  if (vector.dim !== 4 || Array.from(vector.data).some((entry) => !Number.isFinite(entry))) {
    throw new Error(`RigidBody4: ${name} must contain four finite coordinates`);
  }
  return vector;
}

function bivector4(
  value: BivectorN | ArrayLike<number> | undefined,
  name: string
): BivectorN {
  const bivector = value instanceof BivectorN
    ? value.clone()
    : new BivectorN(4, value ?? new Float64Array(6));
  if (bivector.n !== 4 || Array.from(bivector.coeffs).some((entry) => !Number.isFinite(entry))) {
    throw new Error(`RigidBody4: ${name} must contain six finite plane coefficients`);
  }
  return bivector;
}
