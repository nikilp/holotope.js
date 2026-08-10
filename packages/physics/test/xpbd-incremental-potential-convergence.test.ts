import { VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdParticleN,
  XpbdWorldN,
  compileXpbdIncrementalPotentialProblemN,
  diagnoseXpbdIncrementalPotentialStepN,
  minimizeXpbdIncrementalPotentialN,
  stepXpbdIncrementalPotentialWorldN,
  type XpbdConservativeForceProviderN
} from '../src/index.js';

/**
 * `U(x) = -f . x`, so `gradU = -f` and the reported force is exactly `f`
 * everywhere. At a warm start the packed gradient is exactly `-deltaTime² f`,
 * which is what makes the resolution floor analytic here rather than fitted.
 */
function constantForceProvider(
  id: string,
  particles: readonly XpbdParticleN[],
  forces: readonly VecN[]
): XpbdConservativeForceProviderN {
  const evaluateAt: XpbdConservativeForceProviderN['evaluateAt'] = (
    positionOf
  ) => {
    let potentialEnergy = 0;
    particles.forEach((particle, index) => {
      potentialEnergy -= forces[index]!.dot(positionOf(particle));
    });
    return { potentialEnergy, forces: forces.map((force) => force.clone()) };
  };
  return {
    id,
    dimension: particles[0]!.dimension,
    particles,
    evaluate: () => evaluateAt((particle) => particle.position.clone()),
    evaluateAt
  };
}

function axisForce(dimension: number, magnitude: number): VecN {
  const force = new VecN(dimension);
  force.data[0] = magnitude;
  return force;
}

describe('packed-gradient convergence remains the default', () => {
  it('reports the legacy criterion and echoes the packed norm as its residual',
    () => {
      const particle = new XpbdParticleN({ id: 'p', position: [0, 0, 0] });
      const problem = compileXpbdIncrementalPotentialProblemN({
        dimension: 3,
        particles: [particle],
        predictedPositions: [new VecN([0, 0, 0])],
        deltaTime: 1e-2,
        providers: [constantForceProvider('push', [particle], [axisForce(3, 5)])]
      });
      const result = minimizeXpbdIncrementalPotentialN({
        problem,
        initialCoordinates: [0, 0, 0],
        maximumIterations: 0
      });

      expect(result.convergence.kind).toBe('packed-gradient');
      expect(result.convergence.tolerance).toBe(1e-8);
      expect(result.gradientTolerance).toBe(1e-8);
      // Under this criterion the residual IS the packed norm, exactly.
      expect(result.convergence.initialResidual)
        .toBe(result.initial.gradientNorm);
      expect(result.convergence.finalResidual).toBe(result.final.gradientNorm);
    });

  it('treats an authored gradientTolerance as the packed-gradient criterion',
    () => {
      const particle = new XpbdParticleN({ id: 'p', position: [0, 0, 0] });
      const problem = compileXpbdIncrementalPotentialProblemN({
        dimension: 3,
        particles: [particle],
        predictedPositions: [new VecN([0, 0, 0])],
        deltaTime: 1e-2,
        providers: [constantForceProvider('push', [particle], [axisForce(3, 5)])]
      });
      const legacy = minimizeXpbdIncrementalPotentialN({
        problem,
        initialCoordinates: [0, 0, 0],
        gradientTolerance: 1e-6
      });
      const restated = minimizeXpbdIncrementalPotentialN({
        problem,
        initialCoordinates: [0, 0, 0],
        convergence: { kind: 'packed-gradient', tolerance: 1e-6 }
      });

      expect(legacy.convergence).toEqual(restated.convergence);
      expect(legacy.status).toBe(restated.status);
      expect(Array.from(legacy.final.coordinates))
        .toEqual(Array.from(restated.final.coordinates));
      expect(legacy.gradientTolerance).toBe(1e-6);
    });
});

describe('contradictory and malformed stop tests are refused', () => {
  function fixture() {
    const particle = new XpbdParticleN({ id: 'p', position: [0, 0, 0] });
    return compileXpbdIncrementalPotentialProblemN({
      dimension: 3,
      particles: [particle],
      predictedPositions: [new VecN([0, 0, 0])],
      deltaTime: 1e-2,
      providers: [constantForceProvider('push', [particle], [axisForce(3, 5)])]
    });
  }

  it('refuses both spellings at once rather than silently picking one', () => {
    expect(() => minimizeXpbdIncrementalPotentialN({
      problem: fixture(),
      initialCoordinates: [0, 0, 0],
      gradientTolerance: 1e-6,
      convergence: { kind: 'maximum-acceleration-residual', tolerance: 1e-3 }
    })).toThrow(/either gradientTolerance or convergence, not both/);
  });

  it('refuses an unknown criterion, naming what it received', () => {
    expect(() => minimizeXpbdIncrementalPotentialN({
      problem: fixture(),
      initialCoordinates: [0, 0, 0],
      convergence: {
        kind: 'relative-residual'
      } as unknown as { kind: 'packed-gradient'; tolerance: number }
    })).toThrow(/convergence\.kind must be .*received "relative-residual"/);
  });

  it('refuses a negative or non-finite tolerance in the new spelling', () => {
    for (const tolerance of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => minimizeXpbdIncrementalPotentialN({
        problem: fixture(),
        initialCoordinates: [0, 0, 0],
        convergence: { kind: 'maximum-acceleration-residual', tolerance }
      })).toThrow(/convergence\.tolerance must be finite and non-negative/);
    }
  });

  it('refuses before the problem is evaluated at all', () => {
    let evaluations = 0;
    const problem = fixture();
    const evaluate = problem.evaluate.bind(problem);
    Object.defineProperty(problem, 'evaluate', {
      configurable: true,
      value: (coordinates: ArrayLike<number>) => {
        evaluations++;
        return evaluate(coordinates);
      }
    });
    expect(() => minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: [0, 0, 0],
      gradientTolerance: 1e-6,
      convergence: { kind: 'packed-gradient', tolerance: 1e-6 }
    })).toThrow();
    expect(evaluations).toBe(0);
  });
});

describe('maximum-acceleration-residual is timestep-invariant', () => {
  /**
   * The defect this criterion exists for, driven end to end through the public
   * world step rather than inspected on a gradient.
   *
   * One free particle of unit mass under a constant 1000 N force, integrated
   * over a fixed 1e-3 s horizon. Newton's answer is 1 m/s at every timestep.
   * The packed warm-start gradient is `deltaTime² · 1000`, so the shipped
   * packed-gradient default of 1e-8 stops resolving this force below
   * `deltaTime = sqrt(1e-8 / 1000) ≈ 3.16e-6 s`.
   */
  const FORCE = 1000;
  const HORIZON = 1e-3;
  const DELTA_TIMES = [1e-4, 5e-5, 1e-5, 5e-6, 2e-6, 1e-6] as const;

  function drive(
    deltaTime: number,
    convergence?: {
      readonly kind: 'maximum-acceleration-residual';
      readonly tolerance: number;
    }
  ) {
    const particle = new XpbdParticleN({ id: 'p', position: [0, 0, 0] });
    const world = new XpbdWorldN({ dimension: 3 });
    world.addParticle(particle);
    world.addForceProvider(
      constantForceProvider('push', [particle], [axisForce(3, FORCE)])
    );
    const steps = Math.round(HORIZON / deltaTime);
    let applied = 0;
    for (let index = 0; index < steps; index++) {
      const advance = stepXpbdIncrementalPotentialWorldN({
        world,
        deltaTime,
        ...(convergence === undefined ? {} : { minimization: { convergence } })
      });
      if (advance.step.status === 'applied') applied++;
    }
    return { steps, applied, velocity: particle.velocity.data[0]! };
  }

  it('drops the whole force under the packed-gradient default, reporting success',
    () => {
      const rows = DELTA_TIMES.map((deltaTime) => ({
        deltaTime,
        warmStartGradient: deltaTime * deltaTime * FORCE,
        ...drive(deltaTime)
      }));
      // Every step succeeds at every timestep: nothing anywhere reports a
      // problem, which is exactly why this needed measuring.
      for (const row of rows) expect(row.applied).toBe(row.steps);

      const resolved = rows.filter((row) => row.warmStartGradient > 1e-8);
      const dropped = rows.filter((row) => row.warmStartGradient <= 1e-8);
      expect(resolved.length).toBeGreaterThan(0);
      expect(dropped.length).toBeGreaterThan(0);
      for (const row of resolved) {
        expect(row.velocity).toBeCloseTo(FORCE * HORIZON, 9);
      }
      // Refining the timestep by 2.5x (5e-6 -> 2e-6) takes a 1000 N force from
      // exactly right to identically zero.
      for (const row of dropped) expect(row.velocity).toBe(0);
    });

  it('holds Newton\'s answer at every timestep under an acceleration tolerance',
    () => {
      // 1 m/s² is four hundred thousand times smaller than the 1000 m/s² this
      // scene actually produces, and is authorable without knowing deltaTime.
      const convergence = {
        kind: 'maximum-acceleration-residual',
        tolerance: 1
      } as const;
      const rows = DELTA_TIMES.map((deltaTime) => ({
        deltaTime,
        ...drive(deltaTime, convergence)
      }));
      for (const row of rows) {
        expect(row.applied).toBe(row.steps);
        expect(row.velocity).toBeCloseTo(FORCE * HORIZON, 9);
      }
      // The timestep at which the packed-gradient criterion silently gave up.
      const failing = rows.find((row) => row.deltaTime === 1e-6)!;
      expect(failing.velocity).toBeGreaterThan(0.999);
    });
});

describe('the acceleration residual is a per-particle physical quantity', () => {
  it('excludes fixed particles, which hold no packed coordinate', () => {
    const free = new XpbdParticleN({ id: 'free', position: [0, 0, 0] });
    const fixed = new XpbdParticleN({
      id: 'fixed',
      position: [1, 0, 0],
      inverseMass: 0
    });
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 3,
      particles: [free, fixed],
      predictedPositions: [new VecN([0, 0, 0]), new VecN([1, 0, 0])],
      deltaTime: 1e-2,
      providers: [constantForceProvider(
        'push',
        [free, fixed],
        [axisForce(3, 7), axisForce(3, 1e6)]
      )]
    });
    const result = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: [0, 0, 0],
      maximumIterations: 0,
      convergence: { kind: 'maximum-acceleration-residual', tolerance: 0 }
    });

    // Only the free particle is packed, so only its acceleration is bounded.
    // The prescribed particle carries a 1e6 N load and contributes nothing.
    expect(problem.variableCount).toBe(3);
    expect(result.convergence.initialResidual).toBeCloseTo(7, 9);
  });

  it('is invariant when an identical block of particles is replicated', () => {
    function residualFor(blocks: number): number {
      const particles = Array.from(
        { length: blocks },
        (_unused, index) => new XpbdParticleN({
          id: `p${index}`,
          position: [0, 0, 0]
        })
      );
      const problem = compileXpbdIncrementalPotentialProblemN({
        dimension: 3,
        particles,
        predictedPositions: particles.map(() => new VecN([0, 0, 0])),
        deltaTime: 1e-2,
        providers: [constantForceProvider(
          'push',
          particles,
          particles.map(() => axisForce(3, 3))
        )]
      });
      return minimizeXpbdIncrementalPotentialN({
        problem,
        initialCoordinates: particles.flatMap(() => [0, 0, 0]),
        maximumIterations: 0,
        convergence: { kind: 'maximum-acceleration-residual', tolerance: 0 }
      }).convergence.initialResidual;
    }

    const one = residualFor(1);
    // Bit for bit, not merely close: a max over identical values, where the
    // packed norm would instead grow as sqrt(N).
    expect(residualFor(8)).toBe(one);
    expect(residualFor(32)).toBe(one);
    expect(one).toBeCloseTo(3, 9);
  });

  it('is bounded by the worst-accelerated particle, not by an aggregate', () => {
    const light = new XpbdParticleN({ id: 'light', position: [0, 0, 0] });
    const heavy = new XpbdParticleN({
      id: 'heavy',
      position: [1, 0, 0],
      inverseMass: 1 / 1000
    });
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 3,
      particles: [light, heavy],
      predictedPositions: [new VecN([0, 0, 0]), new VecN([1, 0, 0])],
      deltaTime: 1e-2,
      providers: [constantForceProvider(
        'push',
        [light, heavy],
        [axisForce(3, 2), axisForce(3, 500)]
      )]
    });
    const result = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: [0, 0, 0, 1, 0, 0],
      maximumIterations: 0,
      convergence: { kind: 'maximum-acceleration-residual', tolerance: 0 }
    });

    // The heavy particle carries 250x the force but half the acceleration, so
    // the light one sets the bound. A force norm would report the opposite.
    expect(result.convergence.initialResidual).toBeCloseTo(2, 9);
  });
});

describe('every terminal carries the criterion that decided it', () => {
  function starvedFixture() {
    const particle = new XpbdParticleN({ id: 'p', position: [0, 0, 0] });
    return compileXpbdIncrementalPotentialProblemN({
      dimension: 3,
      particles: [particle],
      predictedPositions: [new VecN([0, 0, 0])],
      deltaTime: 1e-2,
      providers: [constantForceProvider('push', [particle], [axisForce(3, 9)])]
    });
  }

  it('reports metric, authored tolerance and both residuals when it stops short',
    () => {
      const result = minimizeXpbdIncrementalPotentialN({
        problem: starvedFixture(),
        initialCoordinates: [0, 0, 0],
        maximumIterations: 0,
        convergence: { kind: 'maximum-acceleration-residual', tolerance: 1e-6 }
      });

      expect(result.status).toBe('iteration-limit');
      expect(result.convergence.kind).toBe('maximum-acceleration-residual');
      expect(result.convergence.tolerance).toBe(1e-6);
      expect(result.convergence.initialResidual).toBeCloseTo(9, 9);
      expect(result.convergence.finalResidual).toBeCloseTo(9, 9);
      // It stopped nine million times short of the bound, and says so in the
      // unit the author chose.
      expect(result.convergence.finalResidual)
        .toBeGreaterThan(result.convergence.tolerance);
    });

  it('retains the packed gradient norm whichever criterion is in force', () => {
    const result = minimizeXpbdIncrementalPotentialN({
      problem: starvedFixture(),
      initialCoordinates: [0, 0, 0],
      maximumIterations: 0,
      convergence: { kind: 'maximum-acceleration-residual', tolerance: 1e-6 }
    });

    // The packed norm is still published for every existing reader, and is
    // NOT the residual the criterion compared. At unit mass the two differ by
    // exactly deltaTime squared, which is the whole reason both are reported:
    // 9 m/s² of residual acceleration reads as 9e-4 of packed gradient.
    const deltaTimeSquared = 1e-2 * 1e-2;
    expect(result.final.gradientNorm).toBeCloseTo(9 * deltaTimeSquared, 12);
    expect(result.convergence.finalResidual).toBeCloseTo(
      result.final.gradientNorm / deltaTimeSquared,
      9
    );
    expect(result.convergence.finalResidual)
      .not.toBeCloseTo(result.final.gradientNorm, 6);
  });

  it('surfaces the criterion through step diagnosis', () => {
    const particle = new XpbdParticleN({ id: 'p', position: [0, 0, 0] });
    const world = new XpbdWorldN({ dimension: 3 });
    world.addParticle(particle);
    world.addForceProvider(
      constantForceProvider('push', [particle], [axisForce(3, 9)])
    );
    const advance = stepXpbdIncrementalPotentialWorldN({
      world,
      deltaTime: 1e-2,
      minimization: {
        convergence: { kind: 'maximum-acceleration-residual', tolerance: 1e-6 }
      }
    });
    const diagnosis = diagnoseXpbdIncrementalPotentialStepN(advance.step);

    expect(diagnosis.facts['convergenceKind'])
      .toBe('maximum-acceleration-residual');
    expect(diagnosis.facts['convergenceTolerance']).toBe(1e-6);
    expect(diagnosis.facts['convergenceResidualInitial']).toBeCloseTo(9, 9);
    // The packed norm remains reported alongside, never replaced.
    expect(typeof diagnosis.facts['gradientNormInitial']).toBe('number');
  });

  it('does not offer a gradient-tolerance lever to an author who wrote none',
    () => {
      // A particle already at its prediction with no provider: the base is
      // stationary, so the step converges without iterating under either
      // criterion. The advice must name the threshold the author actually
      // wrote, and must not blame the timestep under a criterion that does
      // not move with it.
      const particle = new XpbdParticleN({ id: 'p', position: [0, 0, 0] });
      const world = new XpbdWorldN({ dimension: 3 });
      world.addParticle(particle);
      const advance = stepXpbdIncrementalPotentialWorldN({
        world,
        deltaTime: 1e-2,
        minimization: {
          convergence: {
            kind: 'maximum-acceleration-residual',
            tolerance: 1e-6
          }
        }
      });
      const diagnosis = diagnoseXpbdIncrementalPotentialStepN(advance.step);

      expect(diagnosis.condition).toBe('converged-without-iteration');
      expect(diagnosis.levers).toEqual(['lower-convergence-tolerance']);
      expect(diagnosis.levers).not.toContain('lower-gradient-tolerance');
      expect(diagnosis.summary).toContain('maximum acceleration residual');
    });
});
