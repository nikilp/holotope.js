import { CellComplex, VecN } from '@holotope/core';
import { HyperplaneColliderN } from './hyperplane-collider.js';
import {
  type XpbdPointN,
  type XpbdScalarConstraintEvaluationN,
  type XpbdScalarConstraintN
} from './xpbd-constraint.js';
import { XpbdParticleN, XpbdWorldN } from './xpbd-world.js';

export interface XpbdParticleHyperplaneConstraintNOptions {
  readonly id: string;
  readonly point: XpbdPointN;
  readonly plane: HyperplaneColliderN;
  /** Required signed distance from the plane. Default zero. */
  readonly clearance?: number;
  /** Inverse contact stiffness. Default zero. */
  readonly compliance?: number;
}

export interface XpbdParticleHyperplaneConstraintEvaluationN
  extends XpbdScalarConstraintEvaluationN {
  /** `normal dot position - offset`, before clearance. */
  readonly signedDistance: number;
  readonly clearance: number;
  /** `signedDistance - clearance`; the allowed domain is non-negative. */
  readonly gap: number;
}

/** Exact RN point contact with the positive side of an oriented hyperplane. */
export class XpbdParticleHyperplaneConstraintN
implements XpbdScalarConstraintN {
  readonly id: string;
  readonly dimension: number;
  readonly points: readonly [XpbdPointN];
  readonly relation = 'greater-than-or-equal' as const;
  readonly compliance: number;
  readonly plane: HyperplaneColliderN;
  readonly clearance: number;

  constructor(options: XpbdParticleHyperplaneConstraintNOptions) {
    if (typeof options.id !== 'string' || options.id.trim().length === 0) {
      throw new Error(
        'XpbdParticleHyperplaneConstraintN: id must be a non-empty string'
      );
    }
    assertPoint(options.point, 'XpbdParticleHyperplaneConstraintN: point');
    if (!(options.plane instanceof HyperplaneColliderN)) {
      throw new Error(
        'XpbdParticleHyperplaneConstraintN: plane must be a HyperplaneColliderN'
      );
    }
    if (options.plane.dim !== options.point.position.dim) {
      throw new Error(
        `XpbdParticleHyperplaneConstraintN: plane is R${options.plane.dim}, point is R${options.point.position.dim}`
      );
    }
    const clearance = options.clearance ?? 0;
    if (!Number.isFinite(clearance) || clearance < 0) {
      throw new Error(
        'XpbdParticleHyperplaneConstraintN: clearance must be finite and non-negative'
      );
    }
    const compliance = options.compliance ?? 0;
    if (!Number.isFinite(compliance) || compliance < 0) {
      throw new Error(
        'XpbdParticleHyperplaneConstraintN: compliance must be finite and non-negative'
      );
    }

    this.id = options.id;
    this.dimension = options.point.position.dim;
    this.points = Object.freeze([options.point]);
    this.compliance = compliance;
    this.plane = new HyperplaneColliderN(options.plane.normal, options.plane.offset);
    this.clearance = clearance;
  }

  evaluate(): XpbdParticleHyperplaneConstraintEvaluationN {
    const signedDistance = this.plane.normal.dot(this.points[0].position) -
      this.plane.offset;
    const gap = signedDistance - this.clearance;
    return {
      value: gap,
      signedDistance,
      clearance: this.clearance,
      gap,
      gradients: Object.freeze([this.plane.normal.clone()])
    };
  }
}

export interface XpbdParticleHyperplaneFamilyVertexContextN {
  readonly sourceVertexIndex: number;
  /** Copied source position; callback mutation cannot edit the complex. */
  readonly sourcePosition: VecN;
  /** Compile-time `normal dot sourcePosition - offset`. */
  readonly sourceSignedDistance: number;
}

export type XpbdParticleHyperplaneFamilyVertexScalarN =
  | number
  | ((vertex: XpbdParticleHyperplaneFamilyVertexContextN) => number);

export interface CompileXpbdParticleHyperplaneFamilyNOptions {
  readonly id: string;
  readonly source: CellComplex;
  /** One live particle per source vertex, in source-vertex order. */
  readonly particles: readonly XpbdParticleN[];
  readonly plane: HyperplaneColliderN;
  readonly clearance?: XpbdParticleHyperplaneFamilyVertexScalarN;
  readonly compliance?: XpbdParticleHyperplaneFamilyVertexScalarN;
}

export interface XpbdParticleHyperplaneFamilyContactN
  extends XpbdParticleHyperplaneFamilyVertexContextN {
  readonly particle: XpbdParticleN;
  readonly clearance: number;
  readonly sourceGap: number;
  readonly constraint: XpbdParticleHyperplaneConstraintN;
}

/** Source-vertex-indexed point contacts over an existing particle binding. */
export class XpbdParticleHyperplaneFamilyN {
  readonly id: string;
  readonly dimension: number;
  readonly source: CellComplex;
  readonly particles: readonly XpbdParticleN[];
  readonly plane: HyperplaneColliderN;
  readonly contacts: readonly XpbdParticleHyperplaneFamilyContactN[];
  readonly constraints: readonly XpbdParticleHyperplaneConstraintN[];
  private attachedWorld: XpbdWorldN | null = null;

  private constructor(
    id: string,
    source: CellComplex,
    particles: readonly XpbdParticleN[],
    plane: HyperplaneColliderN,
    contacts: XpbdParticleHyperplaneFamilyContactN[]
  ) {
    this.id = id;
    this.dimension = source.ambientDim;
    this.source = source;
    this.particles = Object.freeze([...particles]);
    this.plane = plane;
    this.contacts = Object.freeze(contacts);
    this.constraints = Object.freeze(
      contacts.map((contact) => contact.constraint)
    );
  }

  static compile(
    options: CompileXpbdParticleHyperplaneFamilyNOptions
  ): XpbdParticleHyperplaneFamilyN {
    validateCompilerInput(options);
    const plane = new HyperplaneColliderN(options.plane.normal, options.plane.offset);
    const contacts = compileContacts(options, plane);
    return new XpbdParticleHyperplaneFamilyN(
      options.id,
      options.source,
      options.particles,
      plane,
      contacts
    );
  }

  /** Adds only contact constraints; particles must already belong to the world. */
  addToWorld(world: XpbdWorldN): XpbdWorldN {
    if (!(world instanceof XpbdWorldN)) {
      throw new Error(
        'XpbdParticleHyperplaneFamilyN.addToWorld: expected an XpbdWorldN'
      );
    }
    if (world.dimension !== this.dimension) {
      throw new Error(
        `XpbdParticleHyperplaneFamilyN.addToWorld: family is R${this.dimension}, world is R${world.dimension}`
      );
    }
    if (this.attachedWorld !== null && this.attachedWorld !== world) {
      throw new Error(
        'XpbdParticleHyperplaneFamilyN.addToWorld: family is already attached to another world'
      );
    }
    validateCurrentLayout(this);
    preflightWorldIdentity(world, this.particles, this.constraints);
    for (const constraint of this.constraints) world.addConstraint(constraint);
    this.attachedWorld = world;
    return world;
  }
}

export function compileXpbdParticleHyperplaneFamilyN(
  options: CompileXpbdParticleHyperplaneFamilyNOptions
): XpbdParticleHyperplaneFamilyN {
  return XpbdParticleHyperplaneFamilyN.compile(options);
}

function validateCompilerInput(
  options: CompileXpbdParticleHyperplaneFamilyNOptions
): void {
  if (typeof options.id !== 'string' || options.id.trim().length === 0) {
    throw new Error(
      'compileXpbdParticleHyperplaneFamilyN: id must be a non-empty string'
    );
  }
  if (!(options.source instanceof CellComplex)) {
    throw new Error(
      'compileXpbdParticleHyperplaneFamilyN: source must be a CellComplex'
    );
  }
  if (!(options.plane instanceof HyperplaneColliderN)) {
    throw new Error(
      'compileXpbdParticleHyperplaneFamilyN: plane must be a HyperplaneColliderN'
    );
  }
  if (options.plane.dim !== options.source.ambientDim) {
    throw new Error(
      `compileXpbdParticleHyperplaneFamilyN: plane is R${options.plane.dim}, source is R${options.source.ambientDim}`
    );
  }
  validateParticles(options.source, options.particles);
}

function compileContacts(
  options: CompileXpbdParticleHyperplaneFamilyNOptions,
  plane: HyperplaneColliderN
): XpbdParticleHyperplaneFamilyContactN[] {
  const contacts: XpbdParticleHyperplaneFamilyContactN[] = [];
  for (let sourceVertexIndex = 0;
    sourceVertexIndex < options.source.vertexCount;
    sourceVertexIndex++) {
    const sourcePosition = positionFor(options.source, sourceVertexIndex);
    const sourceSignedDistance = plane.normal.dot(sourcePosition) - plane.offset;
    const context: XpbdParticleHyperplaneFamilyVertexContextN = Object.freeze({
      sourceVertexIndex,
      sourcePosition: sourcePosition.clone(),
      sourceSignedDistance
    });
    const clearance = vertexScalar(
      options.clearance,
      context,
      0,
      'clearance'
    );
    if (clearance < 0) {
      throw new Error(
        'compileXpbdParticleHyperplaneFamilyN: clearance must be non-negative'
      );
    }
    const compliance = vertexScalar(
      options.compliance,
      context,
      0,
      'compliance'
    );
    if (compliance < 0) {
      throw new Error(
        'compileXpbdParticleHyperplaneFamilyN: compliance must be non-negative'
      );
    }
    const particle = options.particles[sourceVertexIndex]!;
    const constraint = new XpbdParticleHyperplaneConstraintN({
      id: `${options.id}/vertex/${sourceVertexIndex}`,
      point: particle,
      plane,
      clearance,
      compliance
    });
    contacts.push(Object.freeze({
      ...context,
      particle,
      clearance,
      sourceGap: sourceSignedDistance - clearance,
      constraint
    }));
  }
  return contacts;
}

function validateParticles(
  source: CellComplex,
  particles: readonly XpbdParticleN[]
): void {
  if (particles.length !== source.vertexCount) {
    throw new Error(
      'compileXpbdParticleHyperplaneFamilyN: particles must match the source vertex count'
    );
  }
  if (new Set(particles).size !== particles.length) {
    throw new Error(
      'compileXpbdParticleHyperplaneFamilyN: particle identities must be unique'
    );
  }
  const ids = new Set<string>();
  for (let index = 0; index < particles.length; index++) {
    const particle = particles[index];
    if (!(particle instanceof XpbdParticleN)) {
      throw new Error(
        `compileXpbdParticleHyperplaneFamilyN: particle ${index} must be an XpbdParticleN`
      );
    }
    if (particle.dimension !== source.ambientDim) {
      throw new Error(
        `compileXpbdParticleHyperplaneFamilyN: particle ${index} dimension mismatch`
      );
    }
    if (ids.has(particle.id)) {
      throw new Error(
        `compileXpbdParticleHyperplaneFamilyN: duplicate particle id "${particle.id}"`
      );
    }
    ids.add(particle.id);
    assertPoint(particle, `compileXpbdParticleHyperplaneFamilyN: particle ${index}`);
  }
  for (let vertex = 0; vertex < source.vertexCount; vertex++) {
    const position = positionFor(source, vertex);
    for (const coordinate of position.data) {
      if (!Number.isFinite(coordinate)) {
        throw new Error(
          `compileXpbdParticleHyperplaneFamilyN: source vertex ${vertex} must be finite`
        );
      }
    }
  }
}

function validateCurrentLayout(family: XpbdParticleHyperplaneFamilyN): void {
  if (
    family.source.ambientDim !== family.dimension ||
    family.source.vertexCount !== family.particles.length ||
    family.source.positions.length !== family.particles.length * family.dimension
  ) {
    throw new Error(
      'XpbdParticleHyperplaneFamilyN.addToWorld: source vertex layout changed'
    );
  }
}

function preflightWorldIdentity(
  world: XpbdWorldN,
  particles: readonly XpbdParticleN[],
  constraints: readonly XpbdParticleHyperplaneConstraintN[]
): void {
  for (const particle of particles) {
    const existing = world.particles.find((candidate) => candidate.id === particle.id);
    if (existing === undefined) {
      throw new Error(
        `XpbdParticleHyperplaneFamilyN.addToWorld: particle "${particle.id}" is not registered`
      );
    }
    if (existing !== particle) {
      throw new Error(
        `XpbdParticleHyperplaneFamilyN.addToWorld: particle id "${particle.id}" is owned by another object`
      );
    }
  }
  for (const constraint of constraints) {
    const existing = world.constraints.find((candidate) => candidate.id === constraint.id);
    if (existing !== undefined && existing !== constraint) {
      throw new Error(
        `XpbdParticleHyperplaneFamilyN.addToWorld: constraint id "${constraint.id}" is already owned`
      );
    }
  }
}

function vertexScalar(
  policy: XpbdParticleHyperplaneFamilyVertexScalarN | undefined,
  context: XpbdParticleHyperplaneFamilyVertexContextN,
  fallback: number,
  label: string
): number {
  const value = typeof policy === 'function' ? policy(context) : (policy ?? fallback);
  if (!Number.isFinite(value)) {
    throw new Error(
      `compileXpbdParticleHyperplaneFamilyN: ${label} must be finite`
    );
  }
  return value;
}

function positionFor(source: CellComplex, vertex: number): VecN {
  return new VecN(source.positions.subarray(
    vertex * source.ambientDim,
    (vertex + 1) * source.ambientDim
  ));
}

function assertPoint(point: XpbdPointN, caller: string): void {
  if (typeof point !== 'object' || point === null || !(point.position instanceof VecN)) {
    throw new Error(`${caller} must provide a VecN position`);
  }
  if (point.position.dim < 1) {
    throw new Error(`${caller} position must have positive dimension`);
  }
  for (const coordinate of point.position.data) {
    if (!Number.isFinite(coordinate)) {
      throw new Error(`${caller} position must be finite`);
    }
  }
  if (!Number.isFinite(point.inverseMass) || point.inverseMass < 0) {
    throw new Error(`${caller} inverseMass must be finite and non-negative`);
  }
}
