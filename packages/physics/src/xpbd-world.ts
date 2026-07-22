import { VecN } from '@holotope/core';
import {
  XpbdConstraintSolverN,
  type XpbdConstraintSolverNOptions,
  type XpbdPointN,
  type XpbdScalarConstraintN,
  type XpbdSolveResultN
} from './xpbd-constraint.js';

export interface XpbdParticleNOptions {
  readonly id: string;
  readonly position: VecN | ArrayLike<number>;
  readonly velocity?: VecN | ArrayLike<number>;
  /** Zero fixes the point; default one. */
  readonly inverseMass?: number;
  /** Multiplier on world gravity; default one. */
  readonly gravityScale?: number;
}

/** Mutable RN point mass consumed by `XpbdWorldN`. */
export class XpbdParticleN implements XpbdPointN {
  readonly id: string;
  readonly dimension: number;
  readonly position: VecN;
  readonly velocity: VecN;
  readonly force: VecN;
  readonly inverseMass: number;
  gravityScale: number;

  constructor(options: XpbdParticleNOptions) {
    if (typeof options.id !== 'string' || options.id.trim().length === 0) {
      throw new Error('XpbdParticleN: id must be a non-empty string');
    }
    const position = vector(options.position, undefined, 'XpbdParticleN: position');
    const velocity = options.velocity === undefined
      ? new VecN(position.dim)
      : vector(options.velocity, position.dim, 'XpbdParticleN: velocity');
    const inverseMass = options.inverseMass ?? 1;
    if (!Number.isFinite(inverseMass) || inverseMass < 0) {
      throw new Error('XpbdParticleN: inverseMass must be finite and non-negative');
    }
    const gravityScale = options.gravityScale ?? 1;
    if (!Number.isFinite(gravityScale)) {
      throw new Error('XpbdParticleN: gravityScale must be finite');
    }

    this.id = options.id;
    this.dimension = position.dim;
    this.position = position;
    this.velocity = velocity;
    this.force = new VecN(position.dim);
    this.inverseMass = inverseMass;
    this.gravityScale = gravityScale;
  }

  applyForce(force: VecN | ArrayLike<number>): this {
    this.force.add(vector(force, this.dimension, 'XpbdParticleN.applyForce: force'));
    return this;
  }

  clearForce(): this {
    this.force.data.fill(0);
    return this;
  }

  kineticEnergy(): number {
    return this.inverseMass === 0
      ? 0
      : 0.5 * this.velocity.lengthSq() / this.inverseMass;
  }
}

export interface XpbdWorldNOptions {
  readonly dimension: number;
  /** Default is zero in every coordinate. */
  readonly gravity?: VecN | ArrayLike<number>;
  readonly solverIterations?: number;
  readonly responseEpsilon?: number;
}

/** Pure state-dependent forces evaluated at the current particle positions. */
export interface XpbdForceProviderEvaluationN {
  /** One force per provider particle, in the same order. */
  readonly forces: readonly VecN[];
  /** Optional conservative potential-energy evidence. */
  readonly potentialEnergy?: number;
}

/** A renderer-neutral RN force source reevaluated before every substep. */
export interface XpbdForceProviderN {
  readonly id: string;
  readonly dimension: number;
  readonly particles: readonly XpbdParticleN[];
  evaluate(): XpbdForceProviderEvaluationN;
}

export interface XpbdWorldForceProviderResultN {
  readonly provider: XpbdForceProviderN;
  readonly evaluation: XpbdForceProviderEvaluationN;
}

/** Evidence returned by one post-projection velocity response. */
export interface XpbdVelocityResponseEvaluationN {
  /** Optional total kinetic-energy change caused by this response. */
  readonly kineticEnergyChange?: number;
}

export interface XpbdVelocityResponseContextN {
  readonly deltaTime: number;
  readonly substepIndex: number;
  /** Position-level solve whose reconstructed velocities are now available. */
  readonly solve: XpbdSolveResultN;
}

/** Ordered RN velocity policy applied after XPBD velocity reconstruction. */
export interface XpbdVelocityResponseN {
  readonly id: string;
  readonly dimension: number;
  /** Exact registered particles whose velocities this policy may mutate. */
  readonly particles: readonly XpbdParticleN[];
  apply(context: XpbdVelocityResponseContextN): XpbdVelocityResponseEvaluationN;
}

export interface XpbdWorldVelocityResponseResultN {
  readonly response: XpbdVelocityResponseN;
  readonly evaluation: XpbdVelocityResponseEvaluationN;
}

/** Read-only evidence deciding whether one completed RN substep is admissible. */
export interface XpbdStateGuardEvaluationN {
  readonly accepted: boolean;
  /** Optional signed distance from the guard boundary; positive is admissible. */
  readonly margin?: number;
  readonly reason?: string;
}

export interface XpbdStateGuardContextN {
  readonly deltaTime: number;
  readonly substepIndex: number;
  /** Exact position at the beginning of this substep, returned as a defensive copy. */
  readonly positionBeforeSubstep: (particle: XpbdParticleN) => VecN;
  readonly forceProviders: readonly XpbdWorldForceProviderResultN[];
  readonly solve: XpbdSolveResultN;
  readonly velocityResponses: readonly XpbdWorldVelocityResponseResultN[];
}

/** Pure accepted-state policy evaluated after a complete RN substep. */
export interface XpbdStateGuardN {
  readonly id: string;
  readonly dimension: number;
  /** Exact registered particles observed by this guard. */
  readonly particles: readonly XpbdParticleN[];
  evaluate(context: XpbdStateGuardContextN): XpbdStateGuardEvaluationN;
}

export interface XpbdWorldStateGuardResultN {
  readonly guard: XpbdStateGuardN;
  readonly evaluation: XpbdStateGuardEvaluationN;
}

/** Typed signal that a well-formed completed substep was not admissible. */
export class XpbdStateGuardRejectionErrorN extends Error {
  readonly guard: XpbdStateGuardN;
  readonly evaluation: XpbdStateGuardEvaluationN;
  readonly substepIndex: number;

  constructor(
    guard: XpbdStateGuardN,
    evaluation: XpbdStateGuardEvaluationN,
    substepIndex: number
  ) {
    super(
      `XpbdWorldN.step: state guard "${guard.id}" rejected substep ${substepIndex}` +
      (evaluation.reason === undefined ? '' : ` (${evaluation.reason})`)
    );
    this.name = 'XpbdStateGuardRejectionErrorN';
    this.guard = guard;
    this.evaluation = evaluation;
    this.substepIndex = substepIndex;
  }
}

export interface XpbdAdaptiveStepOptionsN {
  /** First deterministic subdivision count. Default one. */
  readonly initialSubsteps?: number;
  /** Hard retry ceiling. Default 64. */
  readonly maximumSubsteps?: number;
  /** Integer multiplier applied after rejection. Default two. */
  readonly growthFactor?: number;
}

export interface XpbdAdaptiveStepAttemptN {
  readonly substeps: number;
  readonly status: 'accepted' | 'rejected';
  readonly rejectedGuardId?: string;
  readonly rejectedSubstepIndex?: number;
  readonly rejection?: XpbdStateGuardEvaluationN;
}

export interface XpbdWorldAdaptiveStepResultN {
  readonly result: XpbdWorldStepResultN;
  readonly attempts: readonly XpbdAdaptiveStepAttemptN[];
}

/** Typed exhaustion result; the world has already restored its initial state. */
export class XpbdAdaptiveStepFailureErrorN extends Error {
  readonly deltaTime: number;
  readonly attempts: readonly XpbdAdaptiveStepAttemptN[];
  readonly lastRejection: XpbdStateGuardRejectionErrorN;

  constructor(
    deltaTime: number,
    attempts: readonly XpbdAdaptiveStepAttemptN[],
    lastRejection: XpbdStateGuardRejectionErrorN
  ) {
    super(
      `XpbdWorldN.stepAdaptive: exhausted ${attempts.length} attempts at ` +
      `${attempts[attempts.length - 1]!.substeps} substeps`
    );
    this.name = 'XpbdAdaptiveStepFailureErrorN';
    this.deltaTime = deltaTime;
    this.attempts = attempts;
    this.lastRejection = lastRejection;
  }
}

export interface XpbdWorldSubstepResultN {
  readonly index: number;
  readonly deltaTime: number;
  /** Provider evaluations at the configuration preceding this substep. */
  readonly forceProviders: readonly XpbdWorldForceProviderResultN[];
  readonly solve: XpbdSolveResultN;
  /** Ordered policies applied after velocity reconstruction. */
  readonly velocityResponses: readonly XpbdWorldVelocityResponseResultN[];
  /** Ordered read-only acceptance checks for the completed substep. */
  readonly stateGuards: readonly XpbdWorldStateGuardResultN[];
}

export interface XpbdWorldStepResultN {
  readonly dimension: number;
  readonly deltaTime: number;
  readonly substeps: number;
  readonly constraintSolves: readonly XpbdWorldSubstepResultN[];
  readonly maxAbsConstraintValue: number;
  readonly maxAbsCompliantResidual: number;
  readonly maxAbsProjectedKktResidual: number;
}

interface ParticleSnapshotN {
  readonly particle: XpbdParticleN;
  readonly position: Float64Array;
  readonly velocity: Float64Array;
  readonly force: Float64Array;
  readonly gravityScale: number;
}

interface EvaluatedForcesN {
  readonly forces: readonly Float64Array[] | null;
  readonly results: readonly XpbdWorldForceProviderResultN[];
}

const EMPTY_FORCE_PROVIDER_RESULTS: readonly XpbdWorldForceProviderResultN[] =
  Object.freeze([]);
const EMPTY_VELOCITY_RESPONSE_RESULTS: readonly XpbdWorldVelocityResponseResultN[] =
  Object.freeze([]);
const EMPTY_STATE_GUARD_RESULTS: readonly XpbdWorldStateGuardResultN[] =
  Object.freeze([]);

/**
 * Renderer-neutral RN point-mass integration around the XPBD golden kernel.
 *
 * This world is intentionally separate from `PhysicsWorld4`: point positions
 * and R4 rigid transforms are different generalized-coordinate systems.
 */
export class XpbdWorldN {
  readonly dimension: number;
  readonly gravity: VecN;
  private readonly solver: XpbdConstraintSolverN;
  private readonly registeredParticles: XpbdParticleN[] = [];
  private readonly registeredConstraints: XpbdScalarConstraintN[] = [];
  private readonly registeredForceProviders: XpbdForceProviderN[] = [];
  private readonly registeredVelocityResponses: XpbdVelocityResponseN[] = [];
  private readonly registeredStateGuards: XpbdStateGuardN[] = [];

  constructor(options: XpbdWorldNOptions) {
    if (!Number.isSafeInteger(options.dimension) || options.dimension < 1) {
      throw new Error('XpbdWorldN: dimension must be a positive integer');
    }
    this.dimension = options.dimension;
    this.gravity = options.gravity === undefined
      ? new VecN(options.dimension)
      : vector(options.gravity, options.dimension, 'XpbdWorldN: gravity');
    const solverOptions: XpbdConstraintSolverNOptions = {
      dimension: options.dimension,
      ...(options.solverIterations === undefined
        ? {}
        : { iterations: options.solverIterations }),
      ...(options.responseEpsilon === undefined
        ? {}
        : { responseEpsilon: options.responseEpsilon })
    };
    this.solver = new XpbdConstraintSolverN(solverOptions);
  }

  get particles(): readonly XpbdParticleN[] {
    return this.registeredParticles;
  }

  get constraints(): readonly XpbdScalarConstraintN[] {
    return this.registeredConstraints;
  }

  get forceProviders(): readonly XpbdForceProviderN[] {
    return this.registeredForceProviders;
  }

  get velocityResponses(): readonly XpbdVelocityResponseN[] {
    return this.registeredVelocityResponses;
  }

  get stateGuards(): readonly XpbdStateGuardN[] {
    return this.registeredStateGuards;
  }

  addParticle(particle: XpbdParticleN): this {
    if (!(particle instanceof XpbdParticleN)) {
      throw new Error('XpbdWorldN.addParticle: expected an XpbdParticleN');
    }
    if (particle.dimension !== this.dimension) {
      throw new Error(
        `XpbdWorldN.addParticle: particle is R${particle.dimension}, world is R${this.dimension}`
      );
    }
    if (this.registeredParticles.includes(particle)) return this;
    if (this.registeredParticles.some((existing) => existing.id === particle.id)) {
      throw new Error(`XpbdWorldN.addParticle: duplicate particle id "${particle.id}"`);
    }
    this.registeredParticles.push(particle);
    return this;
  }

  removeParticle(particle: XpbdParticleN): this {
    const index = this.registeredParticles.indexOf(particle);
    if (index < 0) return this;
    if (
      this.registeredConstraints.some((constraint) => constraint.points.includes(particle)) ||
      this.registeredForceProviders.some((provider) => provider.particles.includes(particle)) ||
      this.registeredVelocityResponses.some((response) =>
        response.particles.includes(particle)
      ) ||
      this.registeredStateGuards.some((guard) =>
        guard.particles.includes(particle)
      )
    ) {
      throw new Error(
        `XpbdWorldN.removeParticle: particle "${particle.id}" is still referenced by a constraint, force provider, velocity response, or state guard`
      );
    }
    this.registeredParticles.splice(index, 1);
    return this;
  }

  addConstraint(constraint: XpbdScalarConstraintN): this {
    this.validateConstraintOwnership(constraint, 'XpbdWorldN.addConstraint');
    if (this.registeredConstraints.includes(constraint)) return this;
    if (this.registeredConstraints.some((existing) => existing.id === constraint.id)) {
      throw new Error(`XpbdWorldN.addConstraint: duplicate constraint id "${constraint.id}"`);
    }
    this.registeredConstraints.push(constraint);
    return this;
  }

  removeConstraint(constraint: XpbdScalarConstraintN): this {
    const index = this.registeredConstraints.indexOf(constraint);
    if (index >= 0) this.registeredConstraints.splice(index, 1);
    return this;
  }

  addForceProvider(provider: XpbdForceProviderN): this {
    this.validateForceProviderOwnership(provider, 'XpbdWorldN.addForceProvider');
    if (this.registeredForceProviders.includes(provider)) return this;
    if (this.registeredForceProviders.some((existing) => existing.id === provider.id)) {
      throw new Error(
        `XpbdWorldN.addForceProvider: duplicate force provider id "${provider.id}"`
      );
    }
    this.registeredForceProviders.push(provider);
    return this;
  }

  removeForceProvider(provider: XpbdForceProviderN): this {
    const index = this.registeredForceProviders.indexOf(provider);
    if (index >= 0) this.registeredForceProviders.splice(index, 1);
    return this;
  }

  addVelocityResponse(response: XpbdVelocityResponseN): this {
    this.validateVelocityResponseOwnership(
      response,
      'XpbdWorldN.addVelocityResponse'
    );
    if (this.registeredVelocityResponses.includes(response)) return this;
    if (this.registeredVelocityResponses.some(
      (existing) => existing.id === response.id
    )) {
      throw new Error(
        `XpbdWorldN.addVelocityResponse: duplicate velocity response id "${response.id}"`
      );
    }
    this.registeredVelocityResponses.push(response);
    return this;
  }

  removeVelocityResponse(response: XpbdVelocityResponseN): this {
    const index = this.registeredVelocityResponses.indexOf(response);
    if (index >= 0) this.registeredVelocityResponses.splice(index, 1);
    return this;
  }

  addStateGuard(guard: XpbdStateGuardN): this {
    this.validateStateGuardOwnership(guard, 'XpbdWorldN.addStateGuard');
    if (this.registeredStateGuards.includes(guard)) return this;
    if (this.registeredStateGuards.some((existing) => existing.id === guard.id)) {
      throw new Error(
        `XpbdWorldN.addStateGuard: duplicate state guard id "${guard.id}"`
      );
    }
    this.registeredStateGuards.push(guard);
    return this;
  }

  removeStateGuard(guard: XpbdStateGuardN): this {
    const index = this.registeredStateGuards.indexOf(guard);
    if (index >= 0) this.registeredStateGuards.splice(index, 1);
    return this;
  }

  /**
   * Predicts, projects, reconstructs velocity, and applies ordered responses
   * for one complete step.
   * External forces remain constant across substeps and clear after successful
   * return. State-dependent providers are reevaluated before every substep.
   */
  step(deltaTime: number, substeps = 1): XpbdWorldStepResultN {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) {
      throw new Error('XpbdWorldN.step: deltaTime must be finite and positive');
    }
    if (!Number.isSafeInteger(substeps) || substeps < 1) {
      throw new Error('XpbdWorldN.step: substeps must be a positive integer');
    }
    this.validateCurrentState();
    const snapshots = this.registeredParticles.map(snapshotParticle);
    try {
      const substepDuration = deltaTime / substeps;
      const constraintSolves: XpbdWorldSubstepResultN[] = [];
      for (let index = 0; index < substeps; index++) {
        const priorPositions = this.registeredParticles.map(
          (particle) => particle.position.data.slice()
        );
        const evaluatedForces = this.evaluateForceProviders();
        this.predict(substepDuration, evaluatedForces.forces);
        const solve = this.solver.solve(this.registeredConstraints, substepDuration);
        this.reconstructVelocities(priorPositions, substepDuration);
        const velocityResponses = this.applyVelocityResponses({
          deltaTime: substepDuration,
          substepIndex: index,
          solve
        });
        const stateGuards = this.registeredStateGuards.length === 0
          ? EMPTY_STATE_GUARD_RESULTS
          : this.evaluateStateGuards({
              deltaTime: substepDuration,
              substepIndex: index,
              positionBeforeSubstep: priorPositionQuery(
                this.registeredParticles,
                priorPositions
              ),
              forceProviders: evaluatedForces.results,
              solve,
              velocityResponses
            });
        constraintSolves.push(Object.freeze({
          index,
          deltaTime: substepDuration,
          forceProviders: evaluatedForces.results,
          solve,
          velocityResponses,
          stateGuards
        }));
      }
      for (const particle of this.registeredParticles) particle.clearForce();
      return Object.freeze({
        dimension: this.dimension,
        deltaTime,
        substeps,
        constraintSolves: Object.freeze(constraintSolves),
        maxAbsConstraintValue: maximum(
          constraintSolves.map((substep) => substep.solve.maxAbsConstraintValue)
        ),
        maxAbsCompliantResidual: maximum(
          constraintSolves.map((substep) => substep.solve.maxAbsCompliantResidual)
        ),
        maxAbsProjectedKktResidual: maximum(
          constraintSolves.map((substep) => substep.solve.maxAbsProjectedKktResidual)
        )
      });
    } catch (error) {
      for (const snapshot of snapshots) restoreParticle(snapshot);
      throw error;
    }
  }

  /**
   * Retries typed accepted-state rejections with deterministic subdivision.
   * Every attempt advances the same `deltaTime`; unrelated errors are not retried.
   */
  stepAdaptive(
    deltaTime: number,
    options: XpbdAdaptiveStepOptionsN = {}
  ): XpbdWorldAdaptiveStepResultN {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) {
      throw new Error(
        'XpbdWorldN.stepAdaptive: deltaTime must be finite and positive'
      );
    }
    const initialSubsteps = options.initialSubsteps ?? 1;
    const maximumSubsteps = options.maximumSubsteps ?? 64;
    const growthFactor = options.growthFactor ?? 2;
    if (!Number.isSafeInteger(initialSubsteps) || initialSubsteps < 1) {
      throw new Error(
        'XpbdWorldN.stepAdaptive: initialSubsteps must be a positive integer'
      );
    }
    if (!Number.isSafeInteger(maximumSubsteps) ||
      maximumSubsteps < initialSubsteps) {
      throw new Error(
        'XpbdWorldN.stepAdaptive: maximumSubsteps must be an integer at least initialSubsteps'
      );
    }
    if (!Number.isSafeInteger(growthFactor) || growthFactor < 2) {
      throw new Error(
        'XpbdWorldN.stepAdaptive: growthFactor must be an integer at least two'
      );
    }

    const attempts: XpbdAdaptiveStepAttemptN[] = [];
    let substeps = initialSubsteps;
    while (true) {
      try {
        const result = this.step(deltaTime, substeps);
        attempts.push(Object.freeze({ substeps, status: 'accepted' }));
        return Object.freeze({
          result,
          attempts: Object.freeze(attempts)
        });
      } catch (error) {
        if (!(error instanceof XpbdStateGuardRejectionErrorN)) throw error;
        attempts.push(Object.freeze({
          substeps,
          status: 'rejected',
          rejectedGuardId: error.guard.id,
          rejectedSubstepIndex: error.substepIndex,
          rejection: error.evaluation
        }));
        if (substeps === maximumSubsteps) {
          throw new XpbdAdaptiveStepFailureErrorN(
            deltaTime,
            Object.freeze(attempts),
            error
          );
        }
        substeps = Math.min(maximumSubsteps, substeps * growthFactor);
      }
    }
  }

  private validateCurrentState(): void {
    vector(this.gravity, this.dimension, 'XpbdWorldN.step: gravity');
    const particleIds = new Set<string>();
    for (const particle of this.registeredParticles) {
      if (particle.dimension !== this.dimension) {
        throw new Error('XpbdWorldN.step: particle dimension changed');
      }
      if (particleIds.has(particle.id)) {
        throw new Error(`XpbdWorldN.step: duplicate particle id "${particle.id}"`);
      }
      particleIds.add(particle.id);
      vector(particle.position, this.dimension, `XpbdWorldN.step: ${particle.id} position`);
      vector(particle.velocity, this.dimension, `XpbdWorldN.step: ${particle.id} velocity`);
      vector(particle.force, this.dimension, `XpbdWorldN.step: ${particle.id} force`);
      if (!Number.isFinite(particle.inverseMass) || particle.inverseMass < 0) {
        throw new Error(`XpbdWorldN.step: ${particle.id} inverseMass is invalid`);
      }
      if (!Number.isFinite(particle.gravityScale)) {
        throw new Error(`XpbdWorldN.step: ${particle.id} gravityScale is invalid`);
      }
    }
    const constraintIds = new Set<string>();
    for (const constraint of this.registeredConstraints) {
      this.validateConstraintOwnership(constraint, 'XpbdWorldN.step');
      if (constraintIds.has(constraint.id)) {
        throw new Error(`XpbdWorldN.step: duplicate constraint id "${constraint.id}"`);
      }
      constraintIds.add(constraint.id);
    }
    const forceProviderIds = new Set<string>();
    for (const provider of this.registeredForceProviders) {
      this.validateForceProviderOwnership(provider, 'XpbdWorldN.step');
      if (forceProviderIds.has(provider.id)) {
        throw new Error(
          `XpbdWorldN.step: duplicate force provider id "${provider.id}"`
        );
      }
      forceProviderIds.add(provider.id);
    }
    const velocityResponseIds = new Set<string>();
    for (const response of this.registeredVelocityResponses) {
      this.validateVelocityResponseOwnership(response, 'XpbdWorldN.step');
      if (velocityResponseIds.has(response.id)) {
        throw new Error(
          `XpbdWorldN.step: duplicate velocity response id "${response.id}"`
        );
      }
      velocityResponseIds.add(response.id);
    }
    const stateGuardIds = new Set<string>();
    for (const guard of this.registeredStateGuards) {
      this.validateStateGuardOwnership(guard, 'XpbdWorldN.step');
      if (stateGuardIds.has(guard.id)) {
        throw new Error(
          `XpbdWorldN.step: duplicate state guard id "${guard.id}"`
        );
      }
      stateGuardIds.add(guard.id);
    }
  }

  private validateConstraintOwnership(
    constraint: XpbdScalarConstraintN,
    caller: string
  ): void {
    if (typeof constraint !== 'object' || constraint === null) {
      throw new Error(`${caller}: expected an XPBD scalar constraint`);
    }
    if (typeof constraint.id !== 'string' || constraint.id.trim().length === 0) {
      throw new Error(`${caller}: constraint id must be a non-empty string`);
    }
    if (constraint.dimension !== this.dimension) {
      throw new Error(
        `${caller}: constraint is R${constraint.dimension}, world is R${this.dimension}`
      );
    }
    if (!Array.isArray(constraint.points) || constraint.points.length === 0) {
      throw new Error(`${caller}: constraint must contain registered particles`);
    }
    if (!Number.isFinite(constraint.compliance) || constraint.compliance < 0) {
      throw new Error(`${caller}: constraint compliance must be finite and non-negative`);
    }
    if (
      constraint.relation !== undefined &&
      constraint.relation !== 'equality' &&
      constraint.relation !== 'greater-than-or-equal'
    ) {
      throw new Error(`${caller}: constraint relation is invalid`);
    }
    const uniquePoints = new Set<XpbdPointN>();
    for (const point of constraint.points) {
      if (uniquePoints.has(point)) {
        throw new Error(`${caller}: constraint repeats a particle identity`);
      }
      uniquePoints.add(point);
      if (!this.registeredParticles.includes(point as XpbdParticleN)) {
        throw new Error(`${caller}: every constraint point must be a registered particle`);
      }
    }
  }

  private validateForceProviderOwnership(
    provider: XpbdForceProviderN,
    caller: string
  ): void {
    if (typeof provider !== 'object' || provider === null) {
      throw new Error(`${caller}: expected an RN force provider`);
    }
    if (typeof provider.id !== 'string' || provider.id.trim().length === 0) {
      throw new Error(`${caller}: force provider id must be a non-empty string`);
    }
    if (provider.dimension !== this.dimension) {
      throw new Error(
        `${caller}: force provider is R${provider.dimension}, world is R${this.dimension}`
      );
    }
    if (!Array.isArray(provider.particles) || provider.particles.length === 0) {
      throw new Error(`${caller}: force provider must contain registered particles`);
    }
    if (typeof provider.evaluate !== 'function') {
      throw new Error(`${caller}: force provider must define evaluate()`);
    }
    const uniqueParticles = new Set<XpbdParticleN>();
    for (const particle of provider.particles) {
      if (!(particle instanceof XpbdParticleN)) {
        throw new Error(`${caller}: force provider particles must be XpbdParticleN values`);
      }
      if (uniqueParticles.has(particle)) {
        throw new Error(`${caller}: force provider repeats a particle identity`);
      }
      uniqueParticles.add(particle);
      if (!this.registeredParticles.includes(particle)) {
        throw new Error(`${caller}: every force-provider particle must be registered`);
      }
    }
  }

  private validateVelocityResponseOwnership(
    response: XpbdVelocityResponseN,
    caller: string
  ): void {
    if (typeof response !== 'object' || response === null) {
      throw new Error(`${caller}: expected an RN velocity response`);
    }
    if (typeof response.id !== 'string' || response.id.trim().length === 0) {
      throw new Error(`${caller}: velocity response id must be a non-empty string`);
    }
    if (response.dimension !== this.dimension) {
      throw new Error(
        `${caller}: velocity response is R${response.dimension}, world is R${this.dimension}`
      );
    }
    if (!Array.isArray(response.particles) || response.particles.length === 0) {
      throw new Error(`${caller}: velocity response must contain registered particles`);
    }
    if (typeof response.apply !== 'function') {
      throw new Error(`${caller}: velocity response must define apply()`);
    }
    const uniqueParticles = new Set<XpbdParticleN>();
    for (const particle of response.particles) {
      if (!(particle instanceof XpbdParticleN)) {
        throw new Error(`${caller}: velocity-response particles must be XpbdParticleN values`);
      }
      if (uniqueParticles.has(particle)) {
        throw new Error(`${caller}: velocity response repeats a particle identity`);
      }
      uniqueParticles.add(particle);
      if (!this.registeredParticles.includes(particle)) {
        throw new Error(`${caller}: every velocity-response particle must be registered`);
      }
    }
  }

  private validateStateGuardOwnership(
    guard: XpbdStateGuardN,
    caller: string
  ): void {
    if (typeof guard !== 'object' || guard === null) {
      throw new Error(`${caller}: expected an RN state guard`);
    }
    if (typeof guard.id !== 'string' || guard.id.trim().length === 0) {
      throw new Error(`${caller}: state guard id must be a non-empty string`);
    }
    if (guard.dimension !== this.dimension) {
      throw new Error(
        `${caller}: state guard is R${guard.dimension}, world is R${this.dimension}`
      );
    }
    if (!Array.isArray(guard.particles) || guard.particles.length === 0) {
      throw new Error(`${caller}: state guard must contain registered particles`);
    }
    if (typeof guard.evaluate !== 'function') {
      throw new Error(`${caller}: state guard must define evaluate()`);
    }
    const uniqueParticles = new Set<XpbdParticleN>();
    for (const particle of guard.particles) {
      if (!(particle instanceof XpbdParticleN)) {
        throw new Error(`${caller}: state guard particles must be XpbdParticleN values`);
      }
      if (uniqueParticles.has(particle)) {
        throw new Error(`${caller}: state guard repeats a particle identity`);
      }
      uniqueParticles.add(particle);
      if (!this.registeredParticles.includes(particle)) {
        throw new Error(`${caller}: every state-guard particle must be registered`);
      }
    }
  }

  private evaluateStateGuards(
    context: XpbdStateGuardContextN
  ): readonly XpbdWorldStateGuardResultN[] {
    const results: XpbdWorldStateGuardResultN[] = [];
    const frozenContext = Object.freeze({ ...context });
    for (const guard of this.registeredStateGuards) {
      const before = this.registeredParticles.map(snapshotParticle);
      const evaluation = guard.evaluate(frozenContext);
      if (typeof evaluation !== 'object' || evaluation === null) {
        throw new Error(
          `XpbdWorldN.step: state guard "${guard.id}" returned no evaluation`
        );
      }
      for (let index = 0; index < this.registeredParticles.length; index++) {
        assertParticleUnchanged(
          this.registeredParticles[index]!,
          before[index]!,
          `XpbdWorldN.step: state guard "${guard.id}"`
        );
      }
      if (typeof evaluation.accepted !== 'boolean') {
        throw new Error(
          `XpbdWorldN.step: state guard "${guard.id}" accepted must be boolean`
        );
      }
      if (evaluation.margin !== undefined && !Number.isFinite(evaluation.margin)) {
        throw new Error(
          `XpbdWorldN.step: state guard "${guard.id}" margin must be finite`
        );
      }
      if (evaluation.reason !== undefined &&
        (typeof evaluation.reason !== 'string' || evaluation.reason.length === 0)) {
        throw new Error(
          `XpbdWorldN.step: state guard "${guard.id}" reason must be a non-empty string`
        );
      }
      const immutableEvaluation = Object.freeze({ ...evaluation });
      const result = Object.freeze({ guard, evaluation: immutableEvaluation });
      results.push(result);
      if (!immutableEvaluation.accepted) {
        throw new XpbdStateGuardRejectionErrorN(
          guard,
          immutableEvaluation,
          context.substepIndex
        );
      }
    }
    return Object.freeze(results);
  }

  private applyVelocityResponses(
    context: XpbdVelocityResponseContextN
  ): readonly XpbdWorldVelocityResponseResultN[] {
    if (this.registeredVelocityResponses.length === 0) {
      return EMPTY_VELOCITY_RESPONSE_RESULTS;
    }
    const results: XpbdWorldVelocityResponseResultN[] = [];
    for (const response of this.registeredVelocityResponses) {
      const declared = new Set(response.particles);
      const before = this.registeredParticles.map(snapshotParticle);
      const evaluation = response.apply(context);
      if (typeof evaluation !== 'object' || evaluation === null) {
        throw new Error(
          `XpbdWorldN.step: velocity response "${response.id}" returned no evaluation`
        );
      }
      if (
        evaluation.kineticEnergyChange !== undefined &&
        !Number.isFinite(evaluation.kineticEnergyChange)
      ) {
        throw new Error(
          `XpbdWorldN.step: velocity response "${response.id}" kineticEnergyChange must be finite`
        );
      }
      for (let index = 0; index < this.registeredParticles.length; index++) {
        const particle = this.registeredParticles[index]!;
        const snapshot = before[index]!;
        if (!arraysEqual(particle.position.data, snapshot.position)) {
          throw new Error(
            `XpbdWorldN.step: velocity response "${response.id}" mutated particle positions`
          );
        }
        if (!arraysEqual(particle.force.data, snapshot.force)) {
          throw new Error(
            `XpbdWorldN.step: velocity response "${response.id}" mutated particle forces`
          );
        }
        if (particle.gravityScale !== snapshot.gravityScale) {
          throw new Error(
            `XpbdWorldN.step: velocity response "${response.id}" mutated gravity scale`
          );
        }
        if (!declared.has(particle) &&
          !arraysEqual(particle.velocity.data, snapshot.velocity)) {
          throw new Error(
            `XpbdWorldN.step: velocity response "${response.id}" mutated an undeclared particle`
          );
        }
        vector(
          particle.velocity,
          this.dimension,
          `XpbdWorldN.step: velocity response "${response.id}" particle velocity`
        );
      }
      results.push(Object.freeze({ response, evaluation }));
    }
    return Object.freeze(results);
  }

  private evaluateForceProviders(): EvaluatedForcesN {
    if (this.registeredForceProviders.length === 0) {
      return { forces: null, results: EMPTY_FORCE_PROVIDER_RESULTS };
    }
    const forces = this.registeredParticles.map(
      () => new Float64Array(this.dimension)
    );
    const particleIndices = new Map(
      this.registeredParticles.map((particle, index) => [particle, index] as const)
    );
    const results: XpbdWorldForceProviderResultN[] = [];
    for (const provider of this.registeredForceProviders) {
      const evaluation = provider.evaluate();
      if (typeof evaluation !== 'object' || evaluation === null) {
        throw new Error(
          `XpbdWorldN.step: force provider "${provider.id}" returned no evaluation`
        );
      }
      if (!Array.isArray(evaluation.forces)) {
        throw new Error(
          `XpbdWorldN.step: force provider "${provider.id}" forces must be an array`
        );
      }
      if (evaluation.forces.length !== provider.particles.length) {
        throw new Error(
          `XpbdWorldN.step: force provider "${provider.id}" force count mismatch`
        );
      }
      if (
        evaluation.potentialEnergy !== undefined &&
        !Number.isFinite(evaluation.potentialEnergy)
      ) {
        throw new Error(
          `XpbdWorldN.step: force provider "${provider.id}" potentialEnergy must be finite`
        );
      }
      for (let local = 0; local < provider.particles.length; local++) {
        const force = evaluation.forces[local];
        if (!(force instanceof VecN) || force.dim !== this.dimension) {
          throw new Error(
            `XpbdWorldN.step: force provider "${provider.id}" force ${local} must be R${this.dimension}`
          );
        }
        const worldIndex = particleIndices.get(provider.particles[local]!);
        if (worldIndex === undefined) {
          throw new Error(
            `XpbdWorldN.step: force provider "${provider.id}" particle ownership changed`
          );
        }
        const accumulated = forces[worldIndex]!;
        for (let axis = 0; axis < this.dimension; axis++) {
          const value = force.data[axis]!;
          if (!Number.isFinite(value)) {
            throw new Error(
              `XpbdWorldN.step: force provider "${provider.id}" force ${local} must be finite`
            );
          }
          accumulated[axis]! += value;
          if (!Number.isFinite(accumulated[axis])) {
            throw new Error(
              `XpbdWorldN.step: accumulated provider force is outside the Float64 range`
            );
          }
        }
      }
      results.push(Object.freeze({ provider, evaluation }));
    }
    return {
      forces,
      results: Object.freeze(results)
    };
  }

  private predict(
    deltaTime: number,
    stateDependentForces: readonly Float64Array[] | null
  ): void {
    for (let index = 0; index < this.registeredParticles.length; index++) {
      const particle = this.registeredParticles[index]!;
      if (particle.inverseMass === 0) continue;
      const stateDependentForce = stateDependentForces?.[index];
      for (let axis = 0; axis < this.dimension; axis++) {
        const acceleration =
          particle.gravityScale * this.gravity.data[axis]! +
          particle.inverseMass * (
            particle.force.data[axis]! + (stateDependentForce?.[axis] ?? 0)
          );
        particle.velocity.data[axis]! += deltaTime * acceleration;
        particle.position.data[axis]! += deltaTime * particle.velocity.data[axis]!;
      }
    }
  }

  private reconstructVelocities(
    priorPositions: readonly Float64Array[],
    deltaTime: number
  ): void {
    for (let index = 0; index < this.registeredParticles.length; index++) {
      const particle = this.registeredParticles[index]!;
      if (particle.inverseMass === 0) continue;
      const prior = priorPositions[index]!;
      for (let axis = 0; axis < this.dimension; axis++) {
        particle.velocity.data[axis] =
          (particle.position.data[axis]! - prior[axis]!) / deltaTime;
      }
    }
  }
}

function snapshotParticle(particle: XpbdParticleN): ParticleSnapshotN {
  return {
    particle,
    position: particle.position.data.slice(),
    velocity: particle.velocity.data.slice(),
    force: particle.force.data.slice(),
    gravityScale: particle.gravityScale
  };
}

function priorPositionQuery(
  particles: readonly XpbdParticleN[],
  positions: readonly Float64Array[]
): (particle: XpbdParticleN) => VecN {
  const byParticle = new Map<XpbdParticleN, Float64Array>();
  for (let index = 0; index < particles.length; index++) {
    byParticle.set(particles[index]!, positions[index]!);
  }
  return (particle: XpbdParticleN): VecN => {
    const position = byParticle.get(particle);
    if (position === undefined) {
      throw new Error(
        'XpbdStateGuardContextN.positionBeforeSubstep: particle is not registered in this world'
      );
    }
    return new VecN(position);
  };
}

function restoreParticle(snapshot: ParticleSnapshotN): void {
  snapshot.particle.position.data.set(snapshot.position);
  snapshot.particle.velocity.data.set(snapshot.velocity);
  snapshot.particle.force.data.set(snapshot.force);
  snapshot.particle.gravityScale = snapshot.gravityScale;
}

function assertParticleUnchanged(
  particle: XpbdParticleN,
  snapshot: ParticleSnapshotN,
  caller: string
): void {
  if (!arraysEqual(particle.position.data, snapshot.position)) {
    throw new Error(`${caller} mutated particle positions`);
  }
  if (!arraysEqual(particle.velocity.data, snapshot.velocity)) {
    throw new Error(`${caller} mutated particle velocities`);
  }
  if (!arraysEqual(particle.force.data, snapshot.force)) {
    throw new Error(`${caller} mutated particle forces`);
  }
  if (particle.gravityScale !== snapshot.gravityScale) {
    throw new Error(`${caller} mutated gravity scale`);
  }
}

function arraysEqual(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function vector(
  value: VecN | ArrayLike<number>,
  dimension: number | undefined,
  caller: string
): VecN {
  const result = value instanceof VecN ? value.clone() : new VecN(value);
  if (result.dim < 1 || (dimension !== undefined && result.dim !== dimension)) {
    throw new Error(`${caller} must have dimension ${dimension ?? 'at least one'}`);
  }
  for (const coordinate of result.data) {
    if (!Number.isFinite(coordinate)) throw new Error(`${caller} must be finite`);
  }
  return result;
}

function maximum(values: readonly number[]): number {
  let result = 0;
  for (const value of values) result = Math.max(result, value);
  return result;
}
