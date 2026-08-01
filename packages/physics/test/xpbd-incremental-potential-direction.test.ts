import { VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdParticleN,
  compileXpbdIncrementalPotentialProblemN,
  minimizeXpbdIncrementalPotentialN,
  stepXpbdIncrementalPotentialN,
  xpbdMassPreconditionedDirectionN,
  xpbdSteepestDescentDirectionN,
  type XpbdIncrementalPotentialDirectionContextN,
  type XpbdIncrementalPotentialDirectionPolicyN
} from '../src/index.js';

function inertialProblem(
  dimension: number,
  inverseMasses: readonly number[]
) {
  const particles = inverseMasses.map((inverseMass, index) =>
    new XpbdParticleN({
      id: `p-${index}`,
      position: new VecN(dimension),
      inverseMass
    })
  );
  return {
    particles,
    problem: compileXpbdIncrementalPotentialProblemN({
      dimension,
      particles,
      predictedPositions: particles.map(() => new VecN(dimension)),
      deltaTime: 1,
      providers: []
    })
  };
}

function snapshot(particles: readonly XpbdParticleN[]): unknown {
  return particles.map((particle) => ({
    position: particle.position.toArray(),
    velocity: particle.velocity.toArray(),
    force: particle.force.toArray(),
    inverseMass: particle.inverseMass
  }));
}

describe('XPBD incremental-potential direction policies', () => {
  it('preserves packed mass ordering and analytic directions in RN', () => {
    for (const dimension of [1, 2, 4, 7]) {
      const inverseMasses = [0, 0.25, 2];
      const { problem } = inertialProblem(dimension, inverseMasses);
      const initial = Float64Array.from(
        { length: 2 * dimension },
        (_, index) => (index + 1) * 0.1
      );
      let captured: XpbdIncrementalPotentialDirectionContextN | undefined;
      const capture: XpbdIncrementalPotentialDirectionPolicyN = {
        id: 'capture',
        evaluate(context) {
          captured = context;
          return xpbdSteepestDescentDirectionN.evaluate(context);
        }
      };
      const steepest = minimizeXpbdIncrementalPotentialN({
        problem,
        initialCoordinates: initial,
        maximumIterations: 1,
        directionPolicy: capture
      });
      const mass = minimizeXpbdIncrementalPotentialN({
        problem,
        initialCoordinates: initial,
        maximumIterations: 1,
        directionPolicy: xpbdMassPreconditionedDirectionN
      });

      expect(captured).toBeDefined();
      expect(captured!.dimension).toBe(dimension);
      expect(captured!.freeParticleIndices).toEqual([1, 2]);
      expect(Array.from(captured!.freeParticleInverseMasses))
        .toEqual([0.25, 2]);
      expect(steepest.directionPolicyId).toBe('capture');
      expect(steepest.iterations[0]!.directionPolicyId).toBe('capture');
      expect(mass.directionPolicyId).toBe('mass-diagonal');

      for (let index = 0; index < initial.length; index++) {
        const inverseMass = index < dimension ? 0.25 : 2;
        const expectedGradient = initial[index]! / inverseMass;
        expect(steepest.iterations[0]!.direction[index])
          .toBeCloseTo(-expectedGradient, 14);
        expect(mass.iterations[0]!.direction[index])
          .toBeCloseTo(-initial[index]!, 14);
      }
    }
  });

  it('solves a non-uniform inertial block in one mass-preconditioned step', () => {
    const { problem } = inertialProblem(1, [1, 0.01]);
    const preconditioned = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: [1, -1],
      directionPolicy: xpbdMassPreconditionedDirectionN,
      initialStep: 1,
      maximumIterations: 1,
      gradientTolerance: 1e-14
    });
    const steepest = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: [1, -1],
      initialStep: 1,
      maximumIterations: 1,
      gradientTolerance: 1e-14
    });
    const repeated = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: [1, -1],
      directionPolicy: xpbdMassPreconditionedDirectionN,
      initialStep: 1,
      maximumIterations: 1,
      gradientTolerance: 1e-14
    });

    expect(preconditioned).toMatchObject({
      status: 'converged',
      convergencePoint: 'accepted-iterate',
      directionPolicyId: 'mass-diagonal'
    });
    expect(preconditioned.iterations).toHaveLength(1);
    expect(Array.from(preconditioned.final.coordinates)).toEqual([0, 0]);
    expect({
      status: repeated.status,
      directionPolicyId: repeated.directionPolicyId,
      coordinates: Array.from(repeated.final.coordinates),
      direction: Array.from(repeated.iterations[0]!.direction),
      trials: repeated.iterations[0]!.search.trials
    }).toEqual({
      status: preconditioned.status,
      directionPolicyId: preconditioned.directionPolicyId,
      coordinates: Array.from(preconditioned.final.coordinates),
      direction: Array.from(preconditioned.iterations[0]!.direction),
      trials: preconditioned.iterations[0]!.search.trials
    });
    expect(steepest.status).toBe('iteration-limit');
    expect(steepest.directionPolicyId).toBe('steepest-descent');
    expect(steepest.final.gradientNorm).toBeGreaterThan(1e-14);
  });

  it('commutes with uniform scaling and orthogonal coordinate changes', () => {
    const gradient = Float64Array.of(2, -3, 5, 7);
    const context: XpbdIncrementalPotentialDirectionContextN = {
      dimension: 2,
      deltaTime: 0.1,
      iterationIndex: 0,
      coordinates: new Float64Array(4),
      gradient,
      gradientNorm: Math.hypot(...gradient),
      freeParticleIndices: Object.freeze([0, 1]),
      freeParticleInverseMasses: Float64Array.of(0.25, 0.25)
    };
    const steepest = xpbdSteepestDescentDirectionN.evaluate(context);
    const mass = xpbdMassPreconditionedDirectionN.evaluate(context);
    for (let index = 0; index < gradient.length; index++) {
      expect(mass[index]).toBeCloseTo(0.25 * steepest[index]!, 14);
    }

    const rotateQuarterTurn = (values: ArrayLike<number>) =>
      Float64Array.of(-values[1]!, values[0]!, -values[3]!, values[2]!);
    const rotatedGradient = rotateQuarterTurn(gradient);
    const rotated = xpbdMassPreconditionedDirectionN.evaluate({
      ...context,
      gradient: rotatedGradient,
      gradientNorm: context.gradientNorm
    });
    expect(Array.from(rotated)).toEqual(
      Array.from(rotateQuarterTurn(mass))
    );
  });

  it('defensively isolates policy context and copied output evidence', () => {
    const { particles, problem } = inertialProblem(1, [0.5]);
    const callerCoordinates = Float64Array.of(2);
    const before = snapshot(particles);
    let output: Float64Array | undefined;
    let indicesFrozen = false;
    const mutating: XpbdIncrementalPotentialDirectionPolicyN = {
      id: 'mutating-policy',
      evaluate(context) {
        indicesFrozen = Object.isFrozen(context.freeParticleIndices);
        context.coordinates[0] = 999;
        context.gradient[0] = 999;
        context.freeParticleInverseMasses[0] = 999;
        output = Float64Array.of(-4);
        return output;
      }
    };
    const result = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: callerCoordinates,
      directionPolicy: mutating,
      maximumIterations: 1,
      initialStep: 0.5,
      gradientTolerance: 0
    });
    output![0] = 777;

    expect(indicesFrozen).toBe(true);
    expect(Array.from(callerCoordinates)).toEqual([2]);
    expect(result.initial.coordinates[0]).toBe(2);
    expect(result.initial.gradient[0]).toBe(4);
    expect(result.iterations[0]!.direction[0]).toBe(-4);
    expect(snapshot(particles)).toEqual(before);
  });

  it('rejects malformed policy contracts and retains non-descent evidence', () => {
    const { problem } = inertialProblem(1, [1]);
    const run = (directionPolicy: XpbdIncrementalPotentialDirectionPolicyN) =>
      minimizeXpbdIncrementalPotentialN({
        problem,
        initialCoordinates: [1],
        directionPolicy
      });

    expect(() => run(
      null as unknown as XpbdIncrementalPotentialDirectionPolicyN
    )).toThrow(/directionPolicy must be an object/);
    expect(() => run({
      id: '',
      evaluate: () => [-1]
    })).toThrow(/directionPolicy id must be non-empty/);
    expect(() => run({
      id: 'missing',
      evaluate: undefined
    } as unknown as XpbdIncrementalPotentialDirectionPolicyN))
      .toThrow(/directionPolicy must define evaluate/);
    expect(() => run({
      id: 'short',
      evaluate: () => []
    })).toThrow(/must return 1 components/);
    expect(() => run({
      id: 'nan',
      evaluate: () => [Number.NaN]
    })).toThrow(/component 0 must be finite/);

    for (const [id, component] of [
      ['zero', 0],
      ['ascent', 1]
    ] as const) {
      const result = run({
        id,
        evaluate: () => [component]
      });
      expect(result).toMatchObject({
        status: 'stalled',
        reason: 'not-descent',
        directionPolicyId: id,
        search: {
          status: 'not-descent',
          trials: []
        }
      });
      expect(result.iterations).toEqual([]);
    }
  });

  it('propagates through the atomic step and restores thrown failures', () => {
    const particle = new XpbdParticleN({
      id: 'p',
      position: [1],
      velocity: [0.5],
      inverseMass: 0.25
    }).applyForce([0.25]);
    const applied = stepXpbdIncrementalPotentialN({
      dimension: 1,
      particles: [particle],
      providers: [],
      deltaTime: 0.2,
      initialPositions: [new VecN([2])],
      minimization: {
        directionPolicy: xpbdMassPreconditionedDirectionN,
        initialStep: 1,
        gradientTolerance: 1e-14
      }
    });
    expect(applied).toMatchObject({
      status: 'applied',
      minimization: {
        status: 'converged',
        directionPolicyId: 'mass-diagonal'
      }
    });

    particle.position = new VecN([3]);
    particle.velocity = new VecN([-2]);
    particle.force = new VecN([4]);
    const beforeFailure = snapshot([particle]);
    expect(() => stepXpbdIncrementalPotentialN({
      dimension: 1,
      particles: [particle],
      providers: [],
      deltaTime: 0.2,
      initialPositions: [new VecN([5])],
      minimization: {
        directionPolicy: {
          id: 'failure',
          evaluate: () => [Number.POSITIVE_INFINITY]
        }
      }
    })).toThrow(/component 0 must be finite/);
    expect(snapshot([particle])).toEqual(beforeFailure);
  });
});
