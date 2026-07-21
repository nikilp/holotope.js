import {
  XpbdParticleN,
  type XpbdVelocityResponseContextN,
  type XpbdVelocityResponseEvaluationN,
  type XpbdVelocityResponseN
} from './xpbd-world.js';

export interface XpbdExponentialVelocityDampingNOptions {
  readonly id: string;
  readonly particles: readonly XpbdParticleN[];
  /** Isotropic exponential decay rate in inverse seconds. */
  readonly rate: number;
}

export interface XpbdExponentialVelocityDampingEvaluationN
  extends XpbdVelocityResponseEvaluationN {
  readonly rate: number;
  /** Exact per-substep multiplier `exp(-rate * deltaTime)`. */
  readonly factor: number;
  readonly dampedParticleCount: number;
  readonly kineticEnergyBefore: number;
  readonly kineticEnergyAfter: number;
  readonly kineticEnergyChange: number;
}

/**
 * Dimension-independent isotropic velocity decay with a rate measured per
 * second. Because each substep applies `exp(-rate * h)`, the final velocity
 * factor is invariant under subdivision of the same total duration.
 */
export class XpbdExponentialVelocityDampingN
implements XpbdVelocityResponseN {
  readonly id: string;
  readonly dimension: number;
  readonly particles: readonly XpbdParticleN[];
  readonly rate: number;

  constructor(options: XpbdExponentialVelocityDampingNOptions) {
    if (typeof options.id !== 'string' || options.id.trim().length === 0) {
      throw new Error(
        'XpbdExponentialVelocityDampingN: id must be a non-empty string'
      );
    }
    if (!Array.isArray(options.particles) || options.particles.length === 0) {
      throw new Error(
        'XpbdExponentialVelocityDampingN: particles must not be empty'
      );
    }
    if (new Set(options.particles).size !== options.particles.length) {
      throw new Error(
        'XpbdExponentialVelocityDampingN: particle identities must be unique'
      );
    }
    const first = options.particles[0];
    if (!(first instanceof XpbdParticleN)) {
      throw new Error(
        'XpbdExponentialVelocityDampingN: particles must be XpbdParticleN values'
      );
    }
    const dimension = first.dimension;
    for (const particle of options.particles) {
      if (!(particle instanceof XpbdParticleN)) {
        throw new Error(
          'XpbdExponentialVelocityDampingN: particles must be XpbdParticleN values'
        );
      }
      if (particle.dimension !== dimension) {
        throw new Error(
          'XpbdExponentialVelocityDampingN: particle dimensions must agree'
        );
      }
    }
    if (!Number.isFinite(options.rate) || options.rate < 0) {
      throw new Error(
        'XpbdExponentialVelocityDampingN: rate must be finite and non-negative'
      );
    }
    this.id = options.id;
    this.dimension = dimension;
    this.particles = Object.freeze([...options.particles]);
    this.rate = options.rate;
  }

  apply(
    context: XpbdVelocityResponseContextN
  ): XpbdExponentialVelocityDampingEvaluationN {
    if (!Number.isFinite(context.deltaTime) || context.deltaTime <= 0) {
      throw new Error(
        'XpbdExponentialVelocityDampingN.apply: deltaTime must be finite and positive'
      );
    }
    if (context.solve.dimension !== this.dimension) {
      throw new Error(
        'XpbdExponentialVelocityDampingN.apply: solve dimension mismatch'
      );
    }
    const factor = Math.exp(-this.rate * context.deltaTime);
    let kineticEnergyBefore = 0;
    let dampedParticleCount = 0;
    for (const particle of this.particles) {
      kineticEnergyBefore += particle.kineticEnergy();
      if (particle.inverseMass === 0) continue;
      particle.velocity.multiplyScalar(factor);
      dampedParticleCount++;
    }
    let kineticEnergyAfter = 0;
    for (const particle of this.particles) {
      kineticEnergyAfter += particle.kineticEnergy();
    }
    return Object.freeze({
      rate: this.rate,
      factor,
      dampedParticleCount,
      kineticEnergyBefore,
      kineticEnergyAfter,
      kineticEnergyChange: kineticEnergyAfter - kineticEnergyBefore
    });
  }
}
