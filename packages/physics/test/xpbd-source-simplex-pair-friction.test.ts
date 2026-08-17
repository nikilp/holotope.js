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
  XpbdPotentialDomainErrorN,
  XpbdSourceSimplexPairBarrierN,
  XpbdSourceSimplexPairBarrierStepFilterN,
  XpbdSourceSimplexPairFrictionN,
  XpbdWorldN,
  stepXpbdIncrementalPotentialWorldN
} from '../src/index.js';

/** Narrows a graded component the fixture knows is representable. */
function availableComponentValue(
  component: { readonly available: boolean } & { readonly value?: number }
): number {
  if (!component.available || component.value === undefined) {
    throw new Error('test fixture: component unexpectedly outside Float64');
  }
  return component.value;
}

/**
 * P57 E2 — the prepared provider and its transaction lifecycle.
 *
 * The mathematics is measured in Kitchen (E1); what these gates hold is the
 * *contract*: conservative for one frozen lag, refusals by type, an explicit
 * single-use lifecycle, and a world seam that admits a transient term without
 * weakening P46's authoritative registry or its selection evidence.
 */

const DIM = 3;

function contactPair(options: { height?: number; skew?: number } = {}): {
  barrier: XpbdSourceSimplexPairBarrierN;
  particles: XpbdParticleN[];
  featureA: SourceSimplexReferenceN;
  featureB: SourceSimplexReferenceN;
} {
  const height = options.height ?? 0.1;
  const skew = options.skew ?? 1;
  const positions = Float64Array.from([
    -1, height, -skew,
    1, height, skew,
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

describe('the prepared friction term', () => {
  it('freezes one lag from a certified unique pair and carries its evidence', () => {
    const { barrier } = contactPair();
    const friction = new XpbdSourceSimplexPairFrictionN({
      id: 'slide', barrier, frictionCoefficient: 0.4, slipRegularization: 1e-3
    });
    const prepared = friction.prepare();
    const lag = prepared.lag;
    expect(lag.state).toBe('prepared');
    expect(lag.dimension).toBe(DIM);
    expect(lag.uniquenessGap).toBeGreaterThan(0);
    expect(lag.baseDistance).toBeCloseTo(0.1, 9);
    expect(lag.normal.length()).toBeCloseTo(1, 12);
    // The lagged magnitude is the barrier's own force at this base.
    expect(lag.laggedNormalForce).toBeCloseTo(
      Math.abs(
        availableComponentValue(barrier.evaluate().barrier.firstDerivative)
      ), 12
    );
    // Weights are source-ordered and sum to one on both sides.
    expect(lag.coordinateA.weights.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 12);
    expect(lag.coordinateB.weights.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 12);
    expect(lag.coordinateA.reference).toBe(barrier.featureA);
  });

  it('is conservative for the frozen lag: forces match the energy gradient', () => {
    const { barrier, particles } = contactPair();
    const friction = new XpbdSourceSimplexPairFrictionN({
      id: 'slide', barrier, frictionCoefficient: 0.5, slipRegularization: 1e-3
    });
    const prepared = friction.prepare();
    // Move off the base so the slip is live.
    const offsets = particles.map(() => new VecN([0.004, 0, 0.002]));
    const at = (delta: number[][]) => (particle: XpbdParticleN): VecN => {
      const index = particles.indexOf(particle);
      const position = particle.position.clone();
      if (index >= 0) {
        for (let axis = 0; axis < DIM; axis++) {
          position.data[axis]! += offsets[index]!.data[axis]! + (delta[index]?.[axis] ?? 0);
        }
      }
      return position;
    };
    const base = prepared.evaluateAt(at([]));
    expect(base.slipMagnitude).toBeGreaterThan(0);
    const step = 1e-7;
    for (let index = 0; index < particles.length; index++) {
      for (let axis = 0; axis < DIM; axis++) {
        const plus: number[][] = [[0, 0, 0], [0, 0, 0]];
        const minus: number[][] = [[0, 0, 0], [0, 0, 0]];
        plus[index]![axis] = step;
        minus[index]![axis] = -step;
        const numeric = (prepared.evaluateAt(at(plus)).potentialEnergy -
          prepared.evaluateAt(at(minus)).potentialEnergy) / (2 * step);
        const analytic = -base.forces[index]!.data[axis]!;
        expect(Math.abs(analytic - numeric) / Math.max(1, Math.abs(analytic)))
          .toBeLessThanOrEqual(1e-7);
      }
    }
  });

  it('keeps the force tangent, bounded by mu*lambda, and net-zero', () => {
    const { barrier, particles } = contactPair();
    const friction = new XpbdSourceSimplexPairFrictionN({
      id: 'slide', barrier, frictionCoefficient: 0.6, slipRegularization: 1e-3
    });
    const prepared = friction.prepare();
    const evaluation = prepared.evaluateAt((particle) => {
      const position = particle.position.clone();
      if (particles.includes(particle)) position.data[0]! += 0.05;
      return position;
    });
    expect(evaluation.regime).toBe('sliding');
    expect(evaluation.tangentForce.length())
      .toBeCloseTo(evaluation.forceLimit, 10);
    expect(Math.abs(evaluation.tangentForce.dot(evaluation.lag.normal)))
      .toBeLessThanOrEqual(1e-11 * Math.max(1, evaluation.tangentForce.length()));
    // Static side B contributes no force, so the A-side forces sum to -g.
    const net = new VecN(DIM);
    for (const force of evaluation.forces) net.add(force);
    for (let axis = 0; axis < DIM; axis++) {
      expect(net.data[axis]!).toBeCloseTo(-evaluation.tangentForce.data[axis]!, 10);
    }
  });

  it('is exactly zero at zero coefficient, and exactly zero force at rest', () => {
    const { barrier, particles } = contactPair();
    const off = new XpbdSourceSimplexPairFrictionN({
      id: 'off', barrier, frictionCoefficient: 0, slipRegularization: 1e-3
    }).prepare();
    const moved = off.evaluateAt((particle) => {
      const position = particle.position.clone();
      if (particles.includes(particle)) position.data[0]! += 0.5;
      return position;
    });
    expect(moved.potentialEnergy).toBe(0);
    for (const force of moved.forces) expect(force.length()).toBe(0);

    const on = new XpbdSourceSimplexPairFrictionN({
      id: 'on', barrier, frictionCoefficient: 0.5, slipRegularization: 1e-3
    }).prepare();
    const atRest = on.evaluate();
    expect(atRest.slipMagnitude).toBe(0);
    expect(atRest.regime).toBe('sticking');
    for (const force of atRest.forces) expect(force.length()).toBe(0);
  });

  it('refuses every P56 branch that cannot justify a friction frame', () => {
    // Tied: exactly parallel segments.
    const parallel = contactPair({ skew: 0 });
    const tied = new XpbdSourceSimplexPairFrictionN({
      id: 'tied', barrier: parallel.barrier,
      frictionCoefficient: 0.4, slipRegularization: 1e-3
    });
    let caught: unknown;
    try { tied.prepare(); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(XpbdPotentialDomainErrorN);
    expect((caught as XpbdPotentialDomainErrorN<string>).reason)
      .toBe('tied-witness-no-unique-gradient');

    // Zero distance: crossing segments.
    const crossing = contactPair({ height: 0 });
    const zero = new XpbdSourceSimplexPairFrictionN({
      id: 'zero', barrier: crossing.barrier,
      frictionCoefficient: 0.4, slipRegularization: 1e-3
    });
    expect(() => zero.prepare()).toThrow(/no tangent plane/);
  });

  it('refuses bad construction by name', () => {
    const { barrier } = contactPair();
    expect(() => new XpbdSourceSimplexPairFrictionN({
      id: '', barrier, frictionCoefficient: 0.4, slipRegularization: 1e-3
    })).toThrow(/id must be a non-empty string/);
    expect(() => new XpbdSourceSimplexPairFrictionN({
      id: 'x', barrier, frictionCoefficient: -1, slipRegularization: 1e-3
    })).toThrow(/frictionCoefficient must be finite and non-negative/);
    expect(() => new XpbdSourceSimplexPairFrictionN({
      id: 'x', barrier, frictionCoefficient: 0.4, slipRegularization: 0
    })).toThrow(/slipRegularization must be finite and positive/);
    expect(() => new XpbdSourceSimplexPairFrictionN({
      id: 'x', barrier, frictionCoefficient: 0.4, slipRegularization: 1e-3, magic: 1
    } as never)).toThrow(/unknown option "magic"/);
  });

  it('makes a consumed lag a named failure, never an implicit refresh', () => {
    const { barrier } = contactPair();
    const friction = new XpbdSourceSimplexPairFrictionN({
      id: 'slide', barrier, frictionCoefficient: 0.4, slipRegularization: 1e-3
    });
    const prepared = friction.prepare();
    prepared.assertUsable();
    prepared.markConsumed();
    expect(prepared.lag.state).toBe('consumed');
    expect(() => prepared.assertUsable()).toThrow(/is consumed; refresh it/);
    expect(() => prepared.markConsumed()).toThrow(/already.*consumed/);
    // Rollback restores usability — the refusal path leaves nothing stranded.
    prepared.rollback();
    expect(prepared.lag.state).toBe('prepared');
    prepared.assertUsable();
    // A refreshed lag is a NEW object; the old snapshot is never mutated.
    const refreshed = friction.prepare();
    expect(refreshed).not.toBe(prepared);
    expect(refreshed.lag.state).toBe('prepared');
  });

  it('never reads live positions behind positionOf, and mutates nothing', () => {
    const { barrier, particles } = contactPair();
    const prepared = new XpbdSourceSimplexPairFrictionN({
      id: 'slide', barrier, frictionCoefficient: 0.4, slipRegularization: 1e-3
    }).prepare();
    const before = particles.map((particle) => [...particle.position.data]);
    // A positionOf that reports a *different* placement than the live state
    // must be the only thing the evaluation sees.
    const displaced = prepared.evaluateAt((particle) => {
      const position = particle.position.clone();
      if (particles.includes(particle)) position.data[0]! += 0.02;
      return position;
    });
    const live = prepared.evaluate();
    expect(displaced.slipMagnitude).toBeGreaterThan(live.slipMagnitude);
    particles.forEach((particle, at) => {
      expect([...particle.position.data]).toEqual(before[at]!);
    });
    expect(prepared.lag.state).toBe('prepared');
  });
});

describe('the world transaction seam', () => {
  function world(): {
    world: XpbdWorldN; barrier: XpbdSourceSimplexPairBarrierN;
    particles: XpbdParticleN[];
  } {
    const { barrier, particles } = contactPair({ height: 0.2 });
    const instance = new XpbdWorldN({ dimension: DIM, gravity: [0, -9.81, 0] });
    for (const particle of particles) instance.addParticle(particle);
    instance.addForceProvider(barrier);
    return { world: instance, barrier, particles };
  }

  it('leaves the step bitwise unchanged when no prepared provider participates', () => {
    const withoutOption = world();
    const first = stepXpbdIncrementalPotentialWorldN({
      world: withoutOption.world, deltaTime: 0.01,
      stepFilters: [new XpbdSourceSimplexPairBarrierStepFilterN({
        id: 'f', barrier: withoutOption.barrier
      })],
      warmStart: 'feasible-inertial-prediction',
      minimization: { directionPolicy: 'steepest-descent' }
    });
    const withEmpty = world();
    const second = stepXpbdIncrementalPotentialWorldN({
      world: withEmpty.world, deltaTime: 0.01,
      stepFilters: [new XpbdSourceSimplexPairBarrierStepFilterN({
        id: 'f', barrier: withEmpty.barrier
      })],
      preparedProviders: [],
      warmStart: 'feasible-inertial-prediction',
      minimization: { directionPolicy: 'steepest-descent' }
    });
    // The selection object gains no field, and the step is identical.
    expect('preparedProviderIds' in first.selection).toBe(false);
    expect('preparedProviderIds' in second.selection).toBe(false);
    expect(JSON.stringify(second.selection)).toBe(JSON.stringify(first.selection));
    expect(second.step.status).toBe(first.step.status);
  });

  it('shows prepared ids in selection evidence, separate from authored ones', () => {
    const scene = world();
    const prepared = new XpbdSourceSimplexPairFrictionN({
      id: 'friction', barrier: scene.barrier,
      frictionCoefficient: 0.4, slipRegularization: 1e-3
    }).prepare();
    const advance = stepXpbdIncrementalPotentialWorldN({
      world: scene.world, deltaTime: 0.01,
      stepFilters: [new XpbdSourceSimplexPairBarrierStepFilterN({
        id: 'f', barrier: scene.barrier
      })],
      preparedProviders: [prepared],
      warmStart: 'feasible-inertial-prediction',
      minimization: { directionPolicy: 'steepest-descent' }
    });
    expect(advance.selection.providerIds).toEqual(['contact']);
    expect(advance.selection.preparedProviderIds).toEqual(['friction']);
    // The authored registry is untouched by the transaction.
    expect(scene.world.forceProviders.map((provider) => provider.id)).toEqual(['contact']);
  });

  it('refuses colliding ids, duplicates, and foreign particles before mutation', () => {
    const scene = world();
    const positionsBefore = scene.particles.map((p) => [...p.position.data]);
    const prepared = new XpbdSourceSimplexPairFrictionN({
      id: 'contact', barrier: scene.barrier, // collides with the authored id
      frictionCoefficient: 0.4, slipRegularization: 1e-3
    }).prepare();
    expect(() => stepXpbdIncrementalPotentialWorldN({
      world: scene.world, deltaTime: 0.01,
      preparedProviders: [prepared],
      warmStart: 'feasible-inertial-prediction'
    })).toThrow(/collides with an authored world force provider/);

    const good = new XpbdSourceSimplexPairFrictionN({
      id: 'friction', barrier: scene.barrier,
      frictionCoefficient: 0.4, slipRegularization: 1e-3
    }).prepare();
    expect(() => stepXpbdIncrementalPotentialWorldN({
      world: scene.world, deltaTime: 0.01,
      preparedProviders: [good, good],
      warmStart: 'feasible-inertial-prediction'
    })).toThrow(/duplicate prepared provider id "friction"/);

    // A provider naming a particle this world does not own.
    const foreign = contactPair({ height: 0.2 });
    const foreignPrepared = new XpbdSourceSimplexPairFrictionN({
      id: 'foreign', barrier: foreign.barrier,
      frictionCoefficient: 0.4, slipRegularization: 1e-3
    }).prepare();
    expect(() => stepXpbdIncrementalPotentialWorldN({
      world: scene.world, deltaTime: 0.01,
      preparedProviders: [foreignPrepared],
      warmStart: 'feasible-inertial-prediction'
    })).toThrow(/which this world does not own/);

    // Nothing moved on any refusal.
    scene.particles.forEach((particle, at) => {
      expect([...particle.position.data]).toEqual(positionsBefore[at]!);
    });
  });

  it('changes the applied trajectory when friction participates', () => {
    const run = (mu: number): number[][] => {
      const scene = world();
      // Give the pair a tangential drift to resist.
      for (const particle of scene.particles) particle.velocity.data[0] = 3;
      for (let step = 0; step < 6; step++) {
        const prepared = mu === 0 ? null : new XpbdSourceSimplexPairFrictionN({
          id: 'friction', barrier: scene.barrier,
          frictionCoefficient: mu, slipRegularization: 1e-3
        }).prepare();
        const advance = stepXpbdIncrementalPotentialWorldN({
          world: scene.world, deltaTime: 0.005,
          stepFilters: [new XpbdSourceSimplexPairBarrierStepFilterN({
            id: 'f', barrier: scene.barrier
          })],
          ...(prepared === null ? {} : { preparedProviders: [prepared] }),
          warmStart: 'feasible-inertial-prediction',
          minimization: { directionPolicy: 'steepest-descent' }
        });
        if (advance.step.status === 'applied' && prepared !== null) prepared.markConsumed();
      }
      return scene.particles.map((particle) => [...particle.velocity.data]);
    };
    const frictionless = run(0);
    const frictional = run(0.8);
    const speedOf = (velocities: number[][]): number =>
      velocities.reduce((sum, velocity) => sum + Math.abs(velocity[0]!), 0);
    // Liveness first: the frictionless run really is still sliding.
    expect(speedOf(frictionless)).toBeGreaterThan(1);
    // Friction resists it — the measured point of the whole track.
    expect(speedOf(frictional)).toBeLessThan(speedOf(frictionless));
  });
});

describe('a consumed lag is a named failure on every path', () => {
  it('refuses evaluation after markConsumed, not only a second consume', () => {
    const { barrier } = contactPair();
    const friction = new XpbdSourceSimplexPairFrictionN({
      id: 'consumed-guard', barrier, frictionCoefficient: 0.4, slipRegularization: 1e-3
    });
    const prepared = friction.prepare();
    // Non-vacuous: the same lag evaluates fine while it is prepared.
    const live = prepared.evaluate();
    expect(Number.isFinite(live.potentialEnergy)).toBe(true);

    prepared.markConsumed();
    // Both reuse paths must now be named failures, not just the second consume.
    expect(() => prepared.markConsumed()).toThrow(/already consumed/);
    expect(() => prepared.evaluate()).toThrow(/consumed/);
    expect(() => prepared.evaluateAt((particle) => particle.position.clone()))
      .toThrow(/consumed/);

    // And rollback restores usability, so the guard is a state check rather
    // than a one-way latch.
    prepared.rollback();
    const afterRollback = prepared.evaluate();
    expect(Number.isFinite(afterRollback.potentialEnergy)).toBe(true);
  });
});
