import { VecN } from '@holotope/core';
import type { XpbdConstraintResultN } from './xpbd-constraint.js';
import {
  XpbdParticleHyperplaneConstraintN,
  XpbdParticleHyperplaneFamilyN,
  type XpbdParticleHyperplaneFamilyContactN,
  type XpbdParticleHyperplaneFamilyVertexContextN
} from './xpbd-hyperplane-contact.js';
import {
  XpbdParticleN,
  XpbdWorldN,
  type XpbdVelocityResponseContextN,
  type XpbdVelocityResponseEvaluationN,
  type XpbdVelocityResponseN
} from './xpbd-world.js';

export type XpbdParticleHyperplaneFrictionStateN =
  | 'disabled'
  | 'inactive'
  | 'sticking'
  | 'sliding';

export interface XpbdParticleHyperplaneFrictionNOptions {
  readonly id: string;
  readonly contact: XpbdParticleHyperplaneConstraintN;
  /** Isotropic Coulomb coefficient for the complete RN tangent ball. */
  readonly friction: number;
}

export interface XpbdParticleHyperplaneFrictionEvaluationN
  extends XpbdVelocityResponseEvaluationN {
  readonly state: XpbdParticleHyperplaneFrictionStateN;
  readonly contactConstraintId: string;
  readonly particleId: string;
  readonly frictionCoefficient: number;
  /** Position multiplier divided by the substep duration. */
  readonly normalImpulse: number;
  readonly normalSpeedBefore: number;
  readonly normalSpeedAfter: number;
  readonly tangentSpeedBefore: number;
  readonly tangentSpeedAfter: number;
  readonly tangentImpulse: VecN;
  /** `frictionCoefficient * normalImpulse`. */
  readonly frictionLimit: number;
  readonly kineticEnergyBefore: number;
  readonly kineticEnergyAfter: number;
  readonly kineticEnergyChange: number;
}

/**
 * Post-projection Coulomb response for one RN particle against one immovable
 * hyperplane. The tangent impulse is projected as one ambient vector; no
 * coordinate tangent basis or per-axis friction pyramid is introduced.
 */
export class XpbdParticleHyperplaneFrictionN
implements XpbdVelocityResponseN {
  readonly id: string;
  readonly dimension: number;
  readonly particles: readonly [XpbdParticleN];
  readonly contact: XpbdParticleHyperplaneConstraintN;
  readonly frictionCoefficient: number;

  constructor(options: XpbdParticleHyperplaneFrictionNOptions) {
    if (typeof options.id !== 'string' || options.id.trim().length === 0) {
      throw new Error(
        'XpbdParticleHyperplaneFrictionN: id must be a non-empty string'
      );
    }
    if (!(options.contact instanceof XpbdParticleHyperplaneConstraintN)) {
      throw new Error(
        'XpbdParticleHyperplaneFrictionN: contact must be an XpbdParticleHyperplaneConstraintN'
      );
    }
    const particle = options.contact.points[0];
    if (!(particle instanceof XpbdParticleN)) {
      throw new Error(
        'XpbdParticleHyperplaneFrictionN: contact point must be an XpbdParticleN'
      );
    }
    assertNonNegativeFinite(
      options.friction,
      'XpbdParticleHyperplaneFrictionN: friction'
    );
    this.id = options.id;
    this.dimension = options.contact.dimension;
    this.particles = Object.freeze([particle]);
    this.contact = options.contact;
    this.frictionCoefficient = options.friction;
  }

  apply(
    context: XpbdVelocityResponseContextN
  ): XpbdParticleHyperplaneFrictionEvaluationN {
    validateContext(context, this.dimension, this.id);
    const normalResult = requireContactResult(context, this.contact, this.id);
    return applyParticleHyperplaneFriction(
      this.particles[0],
      this.contact,
      this.frictionCoefficient,
      normalResult,
      context.deltaTime
    );
  }
}

export type XpbdParticleHyperplaneFrictionFamilyVertexScalarN =
  | number
  | ((vertex: XpbdParticleHyperplaneFamilyVertexContextN) => number);

export interface CompileXpbdParticleHyperplaneFrictionFamilyNOptions {
  readonly id: string;
  readonly contacts: XpbdParticleHyperplaneFamilyN;
  /** Uniform or source-vertex Coulomb coefficient. Default zero. */
  readonly friction?: XpbdParticleHyperplaneFrictionFamilyVertexScalarN;
}

export interface XpbdParticleHyperplaneFrictionFamilyContactN {
  readonly sourceVertexIndex: number;
  readonly particle: XpbdParticleN;
  readonly normalContact: XpbdParticleHyperplaneFamilyContactN;
  readonly frictionCoefficient: number;
}

export interface XpbdParticleHyperplaneFrictionFamilyContactEvaluationN
  extends XpbdParticleHyperplaneFrictionEvaluationN {
  readonly sourceVertexIndex: number;
}

export interface XpbdParticleHyperplaneFrictionFamilyEvaluationN
  extends XpbdVelocityResponseEvaluationN {
  readonly contacts: readonly XpbdParticleHyperplaneFrictionFamilyContactEvaluationN[];
  readonly activeContactCount: number;
  readonly stickingContactCount: number;
  readonly slidingContactCount: number;
  readonly totalTangentImpulse: number;
  readonly maximumTangentSpeedAfter: number;
  readonly kineticEnergyChange: number;
}

/** Source-vertex-indexed Coulomb responses over an existing normal family. */
export class XpbdParticleHyperplaneFrictionFamilyN
implements XpbdVelocityResponseN {
  readonly id: string;
  readonly dimension: number;
  readonly normalFamily: XpbdParticleHyperplaneFamilyN;
  readonly particles: readonly XpbdParticleN[];
  readonly contacts: readonly XpbdParticleHyperplaneFrictionFamilyContactN[];
  private attachedWorld: XpbdWorldN | null = null;

  private constructor(
    id: string,
    normalFamily: XpbdParticleHyperplaneFamilyN,
    contacts: readonly XpbdParticleHyperplaneFrictionFamilyContactN[]
  ) {
    this.id = id;
    this.dimension = normalFamily.dimension;
    this.normalFamily = normalFamily;
    this.particles = normalFamily.particles;
    this.contacts = contacts;
  }

  static compile(
    options: CompileXpbdParticleHyperplaneFrictionFamilyNOptions
  ): XpbdParticleHyperplaneFrictionFamilyN {
    if (typeof options.id !== 'string' || options.id.trim().length === 0) {
      throw new Error(
        'compileXpbdParticleHyperplaneFrictionFamilyN: id must be a non-empty string'
      );
    }
    if (!(options.contacts instanceof XpbdParticleHyperplaneFamilyN)) {
      throw new Error(
        'compileXpbdParticleHyperplaneFrictionFamilyN: contacts must be an XpbdParticleHyperplaneFamilyN'
      );
    }
    const contacts = options.contacts.contacts.map((normalContact) => {
      const context: XpbdParticleHyperplaneFamilyVertexContextN = Object.freeze({
        sourceVertexIndex: normalContact.sourceVertexIndex,
        sourcePosition: normalContact.sourcePosition.clone(),
        sourceSignedDistance: normalContact.sourceSignedDistance
      });
      const frictionCoefficient = vertexScalar(options.friction, context, 0);
      return Object.freeze({
        sourceVertexIndex: normalContact.sourceVertexIndex,
        particle: normalContact.particle,
        normalContact,
        frictionCoefficient
      });
    });
    return new XpbdParticleHyperplaneFrictionFamilyN(
      options.id,
      options.contacts,
      Object.freeze(contacts)
    );
  }

  apply(
    context: XpbdVelocityResponseContextN
  ): XpbdParticleHyperplaneFrictionFamilyEvaluationN {
    validateContext(context, this.dimension, this.id);
    const evaluations = this.contacts.map((contact) => Object.freeze({
      sourceVertexIndex: contact.sourceVertexIndex,
      ...applyParticleHyperplaneFriction(
        contact.particle,
        contact.normalContact.constraint,
        contact.frictionCoefficient,
        requireContactResult(
          context,
          contact.normalContact.constraint,
          this.id
        ),
        context.deltaTime
      )
    }));
    let activeContactCount = 0;
    let stickingContactCount = 0;
    let slidingContactCount = 0;
    let totalTangentImpulse = 0;
    let maximumTangentSpeedAfter = 0;
    let kineticEnergyChange = 0;
    for (const evaluation of evaluations) {
      if (evaluation.state === 'sticking' || evaluation.state === 'sliding') {
        activeContactCount++;
      }
      if (evaluation.state === 'sticking') stickingContactCount++;
      if (evaluation.state === 'sliding') slidingContactCount++;
      totalTangentImpulse += evaluation.tangentImpulse.length();
      maximumTangentSpeedAfter = Math.max(
        maximumTangentSpeedAfter,
        evaluation.tangentSpeedAfter
      );
      kineticEnergyChange += evaluation.kineticEnergyChange;
    }
    return Object.freeze({
      contacts: Object.freeze(evaluations),
      activeContactCount,
      stickingContactCount,
      slidingContactCount,
      totalTangentImpulse,
      maximumTangentSpeedAfter,
      kineticEnergyChange
    });
  }

  /** Adds only the velocity response; normal constraints must already exist. */
  addToWorld(world: XpbdWorldN): XpbdWorldN {
    if (!(world instanceof XpbdWorldN)) {
      throw new Error(
        'XpbdParticleHyperplaneFrictionFamilyN.addToWorld: expected an XpbdWorldN'
      );
    }
    if (world.dimension !== this.dimension) {
      throw new Error(
        `XpbdParticleHyperplaneFrictionFamilyN.addToWorld: family is R${this.dimension}, world is R${world.dimension}`
      );
    }
    if (this.attachedWorld !== null && this.attachedWorld !== world) {
      throw new Error(
        'XpbdParticleHyperplaneFrictionFamilyN.addToWorld: family is already attached to another world'
      );
    }
    validateFamilyWorld(this, world);
    world.addVelocityResponse(this);
    this.attachedWorld = world;
    return world;
  }
}

export function compileXpbdParticleHyperplaneFrictionFamilyN(
  options: CompileXpbdParticleHyperplaneFrictionFamilyNOptions
): XpbdParticleHyperplaneFrictionFamilyN {
  return XpbdParticleHyperplaneFrictionFamilyN.compile(options);
}

function applyParticleHyperplaneFriction(
  particle: XpbdParticleN,
  contact: XpbdParticleHyperplaneConstraintN,
  frictionCoefficient: number,
  normalResult: XpbdConstraintResultN,
  deltaTime: number
): XpbdParticleHyperplaneFrictionEvaluationN {
  const normal = contact.plane.normal;
  const kineticEnergyBefore = particle.kineticEnergy();
  const normalSpeedBefore = normal.dot(particle.velocity);
  const tangentVelocity = particle.velocity.clone().sub(
    normal.clone().multiplyScalar(normalSpeedBefore)
  );
  const tangentSpeedBefore = tangentVelocity.length();
  const normalImpulse = normalResult.totalMultiplier / deltaTime;
  const frictionLimit = frictionCoefficient * normalImpulse;
  const tangentImpulse = new VecN(particle.dimension);
  let state: XpbdParticleHyperplaneFrictionStateN;

  if (!(frictionCoefficient > 0)) {
    state = 'disabled';
  } else if (!normalResult.active || !(normalImpulse > 0) ||
    particle.inverseMass === 0) {
    state = 'inactive';
  } else if (!(tangentSpeedBefore > 0)) {
    state = 'sticking';
  } else {
    const stoppingImpulse = tangentSpeedBefore / particle.inverseMass;
    const appliedImpulse = Math.min(stoppingImpulse, frictionLimit);
    tangentImpulse.copy(tangentVelocity).multiplyScalar(
      -appliedImpulse / tangentSpeedBefore
    );
    for (let axis = 0; axis < particle.dimension; axis++) {
      if (tangentImpulse.data[axis] === 0) tangentImpulse.data[axis] = 0;
    }
    particle.velocity.add(
      tangentImpulse.clone().multiplyScalar(particle.inverseMass)
    );
    state = stoppingImpulse <= frictionLimit ? 'sticking' : 'sliding';
  }

  const normalSpeedAfter = normal.dot(particle.velocity);
  const tangentAfter = particle.velocity.clone().sub(
    normal.clone().multiplyScalar(normalSpeedAfter)
  );
  const kineticEnergyAfter = particle.kineticEnergy();
  return Object.freeze({
    state,
    contactConstraintId: contact.id,
    particleId: particle.id,
    frictionCoefficient,
    normalImpulse,
    normalSpeedBefore,
    normalSpeedAfter,
    tangentSpeedBefore,
    tangentSpeedAfter: tangentAfter.length(),
    tangentImpulse,
    frictionLimit,
    kineticEnergyBefore,
    kineticEnergyAfter,
    kineticEnergyChange: kineticEnergyAfter - kineticEnergyBefore
  });
}

function requireContactResult(
  context: XpbdVelocityResponseContextN,
  contact: XpbdParticleHyperplaneConstraintN,
  responseId: string
): XpbdConstraintResultN {
  const result = context.solve.constraints.find(
    (candidate) => candidate.id === contact.id
  );
  if (result === undefined) {
    throw new Error(
      `XpbdParticleHyperplaneFrictionN "${responseId}": normal contact result "${contact.id}" is missing`
    );
  }
  if (result.relation !== 'greater-than-or-equal') {
    throw new Error(
      `XpbdParticleHyperplaneFrictionN "${responseId}": normal contact result has the wrong relation`
    );
  }
  return result;
}

function validateContext(
  context: XpbdVelocityResponseContextN,
  dimension: number,
  responseId: string
): void {
  if (!Number.isFinite(context.deltaTime) || context.deltaTime <= 0) {
    throw new Error(
      `XpbdParticleHyperplaneFrictionN "${responseId}": deltaTime must be finite and positive`
    );
  }
  if (context.solve.dimension !== dimension) {
    throw new Error(
      `XpbdParticleHyperplaneFrictionN "${responseId}": solve dimension mismatch`
    );
  }
}

function validateFamilyWorld(
  family: XpbdParticleHyperplaneFrictionFamilyN,
  world: XpbdWorldN
): void {
  if (
    family.normalFamily.source.ambientDim !== family.dimension ||
    family.normalFamily.source.vertexCount !== family.particles.length ||
    family.normalFamily.source.positions.length !==
      family.particles.length * family.dimension
  ) {
    throw new Error(
      'XpbdParticleHyperplaneFrictionFamilyN.addToWorld: source vertex layout changed'
    );
  }
  for (const particle of family.particles) {
    const existing = world.particles.find(
      (candidate) => candidate.id === particle.id
    );
    if (existing === undefined) {
      throw new Error(
        `XpbdParticleHyperplaneFrictionFamilyN.addToWorld: particle "${particle.id}" is not registered`
      );
    }
    if (existing !== particle) {
      throw new Error(
        `XpbdParticleHyperplaneFrictionFamilyN.addToWorld: particle id "${particle.id}" is owned by another object`
      );
    }
  }
  for (const contact of family.normalFamily.constraints) {
    const existing = world.constraints.find(
      (candidate) => candidate.id === contact.id
    );
    if (existing === undefined) {
      throw new Error(
        `XpbdParticleHyperplaneFrictionFamilyN.addToWorld: normal constraint "${contact.id}" is not registered`
      );
    }
    if (existing !== contact) {
      throw new Error(
        `XpbdParticleHyperplaneFrictionFamilyN.addToWorld: normal constraint id "${contact.id}" is owned by another object`
      );
    }
  }
  const existingResponse = world.velocityResponses.find(
    (candidate) => candidate.id === family.id
  );
  if (existingResponse !== undefined && existingResponse !== family) {
    throw new Error(
      `XpbdParticleHyperplaneFrictionFamilyN.addToWorld: velocity response id "${family.id}" is already owned`
    );
  }
}

function vertexScalar(
  policy: XpbdParticleHyperplaneFrictionFamilyVertexScalarN | undefined,
  context: XpbdParticleHyperplaneFamilyVertexContextN,
  fallback: number
): number {
  const value = typeof policy === 'function' ? policy(context) : (policy ?? fallback);
  assertNonNegativeFinite(
    value,
    'compileXpbdParticleHyperplaneFrictionFamilyN: friction'
  );
  return value;
}

function assertNonNegativeFinite(value: number, caller: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${caller} must be finite and non-negative`);
  }
}
