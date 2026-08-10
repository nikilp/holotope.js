import { describe, expect, it } from 'vitest';
import {
  CellComplex,
  VecN,
  createSourceCellReferenceN,
  createSourceSimplexReferenceN,
  type SourceSimplexReferenceN
} from '@holotope/core';
import {
  XpbdParticleN,
  XpbdSourceSimplexPairBarrierN,
  XpbdSourceSimplexPairFrictionN
} from '../src/index.js';

/**
 * P58B — the regularization scale is authorable as a slip velocity.
 *
 * The mathematics is measured in Kitchen. What these gates hold is the
 * *contract*: the numeric spelling is a length and is never reinterpreted, the
 * resolved length is frozen with the lag rather than read per evaluation, a
 * timestep is required exactly when it is meaningful, and slip regime stays
 * orthogonal to contact activity.
 */

const DIM = 3;

function contactPair(): {
  barrier: XpbdSourceSimplexPairBarrierN;
  particles: XpbdParticleN[];
  featureA: SourceSimplexReferenceN;
  featureB: SourceSimplexReferenceN;
} {
  const positions = Float64Array.from([
    -1, 0.1, -1,
    1, 0.1, 1,
    -1, 0, 0,
    1, 0, 0
  ]);
  const complex = new CellComplex(DIM, positions, [
    { dim: 1, verticesPerCell: 2, kind: 'simplex', indices: Uint32Array.from([0, 1]) },
    { dim: 1, verticesPerCell: 2, kind: 'simplex', indices: Uint32Array.from([2, 3]) }
  ]);
  const featureA = createSourceSimplexReferenceN(
    createSourceCellReferenceN(complex, complex.groups[0]!, 0)
  );
  const featureB = createSourceSimplexReferenceN(
    createSourceCellReferenceN(complex, complex.groups[1]!, 0)
  );
  const particles = [0, 1].map((vertex) => new XpbdParticleN({
    id: `a-${vertex}`,
    position: new VecN(Array.from(positions.subarray(vertex * DIM, (vertex + 1) * DIM))),
    inverseMass: 1
  }));
  const barrier = new XpbdSourceSimplexPairBarrierN({
    id: 'contact',
    particlesA: particles,
    featureA,
    featureB,
    activationDistance: 0.5,
    stiffness: 4
  });
  return { barrier, particles, featureA, featureB };
}

describe('the numeric slip regularization is a length, unchanged', () => {
  it('normalizes to a slip length carrying the identical number', () => {
    const { barrier } = contactPair();
    const friction = new XpbdSourceSimplexPairFrictionN({
      id: 'legacy', barrier, frictionCoefficient: 0.4, slipRegularization: 1e-3
    });
    expect(friction.slipRegularization)
      .toEqual({ kind: 'slip-length', length: 1e-3 });
  });

  it('freezes the same length a restated slip-length authoring would', () => {
    const numeric = new XpbdSourceSimplexPairFrictionN({
      id: 'numeric',
      barrier: contactPair().barrier,
      frictionCoefficient: 0.4,
      slipRegularization: 2.5e-3
    }).prepare();
    const restated = new XpbdSourceSimplexPairFrictionN({
      id: 'restated',
      barrier: contactPair().barrier,
      frictionCoefficient: 0.4,
      slipRegularization: { kind: 'slip-length', length: 2.5e-3 }
    }).prepare();

    expect(numeric.lag.regularizationLength).toBe(2.5e-3);
    expect(restated.lag.regularizationLength)
      .toBe(numeric.lag.regularizationLength);
  });

  it('refuses a non-positive or malformed scale in either spelling', () => {
    const { barrier } = contactPair();
    const build = (slipRegularization: unknown): void => {
      new XpbdSourceSimplexPairFrictionN({
        id: 'bad',
        barrier,
        frictionCoefficient: 0.4,
        slipRegularization: slipRegularization as number
      });
    };
    expect(() => build(0))
      .toThrow(/slipRegularization must be finite and positive/);
    expect(() => build(Number.NaN))
      .toThrow(/slipRegularization must be finite and positive/);
    expect(() => build({ kind: 'slip-length', length: -1 }))
      .toThrow(/slipRegularization\.length must be finite and positive/);
    expect(() => build({ kind: 'slip-velocity', velocity: 0 }))
      .toThrow(/slipRegularization\.velocity must be finite and positive/);
    expect(() => build({ kind: 'slip-speed', speed: 1 }))
      .toThrow(/slipRegularization\.kind must be .*received "slip-speed"/);
  });
});

describe('a slip velocity resolves against the timestep, once, at prepare', () => {
  function velocityTerm(velocity: number): XpbdSourceSimplexPairFrictionN {
    return new XpbdSourceSimplexPairFrictionN({
      id: 'derived',
      barrier: contactPair().barrier,
      frictionCoefficient: 0.4,
      slipRegularization: { kind: 'slip-velocity', velocity }
    });
  }

  it('freezes velocity * deltaTime into the lag', () => {
    for (const deltaTime of [8e-3, 4e-3, 2e-3, 1e-3]) {
      const prepared = velocityTerm(2.5).prepare({ deltaTime });
      expect(prepared.lag.regularizationLength).toBeCloseTo(2.5 * deltaTime, 15);
    }
  });

  it('requires the timestep it cannot invent', () => {
    expect(() => velocityTerm(2.5).prepare())
      .toThrow(/deltaTime is required when slipRegularization is authored/);
    expect(() => velocityTerm(2.5).prepare({ deltaTime: 0 }))
      .toThrow(/deltaTime must be finite and positive/);
  });

  it('refuses a timestep under an authored length rather than ignoring it', () => {
    // Accepting and discarding it would leave the author believing their
    // length tracked the timestep, which is the belief that makes friction
    // vanish under refinement.
    const term = new XpbdSourceSimplexPairFrictionN({
      id: 'fixed',
      barrier: contactPair().barrier,
      frictionCoefficient: 0.4,
      slipRegularization: 1e-3
    });
    expect(() => term.prepare({ deltaTime: 1e-3 }))
      .toThrow(/deltaTime is meaningless for an authored slip length/);
  });

  it('holds the slip-to-scale ratio fixed as the timestep halves', () => {
    // The point of the velocity spelling: `slip / eps` is what sets the force
    // inside the regularized branch, and per-step slip is proportional to
    // deltaTime. Resolving eps as velocity * deltaTime cancels it exactly, so
    // the same physical slip SPEED lands at the same point on the law at every
    // timestep. Under a fixed length that ratio falls off linearly instead.
    const slipSpeed = 1.25;
    const ratios = [8e-3, 4e-3, 2e-3, 1e-3].map((deltaTime) => {
      const derived = velocityTerm(2.5).prepare({ deltaTime });
      const fixedLength = new XpbdSourceSimplexPairFrictionN({
        id: 'fixed',
        barrier: contactPair().barrier,
        frictionCoefficient: 0.4,
        slipRegularization: 2.5 * 8e-3
      }).prepare();
      const slip = slipSpeed * deltaTime;
      return {
        derived: slip / derived.lag.regularizationLength,
        fixed: slip / fixedLength.lag.regularizationLength
      };
    });

    for (const ratio of ratios) {
      expect(ratio.derived).toBeCloseTo(slipSpeed / 2.5, 12);
    }
    // The fixed length loses a factor of eight across the same ladder.
    expect(ratios[0]!.fixed / ratios[ratios.length - 1]!.fixed)
      .toBeCloseTo(8, 9);
  });

  it('does not let the frozen length move while the lag is held', () => {
    // Conservativeness within one lag depends on this: an Armijo trial must
    // not be able to change the shape of the function it is minimizing.
    const prepared = velocityTerm(2.5).prepare({ deltaTime: 4e-3 });
    const length = prepared.lag.regularizationLength;
    const near = prepared.evaluateAt((particle) => particle.position.clone());
    const far = prepared.evaluateAt((particle) => {
      const moved = particle.position.clone();
      moved.data[0] += 0.05;
      return moved;
    });

    expect(near.lag.regularizationLength).toBe(length);
    expect(far.lag.regularizationLength).toBe(length);
    expect(Object.isFrozen(prepared.lag)).toBe(true);
  });
});

describe('slip regime and contact activity are separate questions', () => {
  it('reports activity from the lagged normal force, not from the slip', () => {
    const { barrier } = contactPair();
    const prepared = new XpbdSourceSimplexPairFrictionN({
      id: 'live', barrier, frictionCoefficient: 0.5, slipRegularization: 1e-4
    }).prepare();
    const evaluation = prepared.evaluate();

    expect(evaluation.contactActive).toBe(evaluation.forceLimit > 0);
    expect(evaluation.contactActive).toBe(prepared.lag.laggedNormalForce > 0);
  });

  it('reports an inactive term whose regime still describes its slip', () => {
    // A zero Coulomb coefficient makes the force limit exactly zero while the
    // lag, the slip and the regime all remain perfectly well defined. Reading
    // the regime alone here would report motion from a term exerting nothing.
    const { barrier } = contactPair();
    const prepared = new XpbdSourceSimplexPairFrictionN({
      id: 'inert', barrier, frictionCoefficient: 0, slipRegularization: 1e-4
    }).prepare();
    const evaluation = prepared.evaluateAt((particle) => {
      const moved = particle.position.clone();
      moved.data[0] += 0.02;
      return moved;
    });

    expect(evaluation.forceLimit).toBe(0);
    expect(evaluation.contactActive).toBe(false);
    // Slipping far past the regularization, and exerting nothing at all.
    expect(evaluation.slipMagnitude).toBeGreaterThan(1e-4);
    expect(evaluation.regime).toBe('sliding');
    expect(evaluation.potentialEnergy).toBe(0);
    for (const force of evaluation.forces) {
      expect(force.length()).toBe(0);
    }
  });
});
