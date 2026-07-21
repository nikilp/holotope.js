import { describe, expect, it } from 'vitest';
import {
  XpbdExponentialVelocityDampingN,
  XpbdParticleN,
  XpbdWorldN,
  type XpbdExponentialVelocityDampingEvaluationN
} from '../src/index.js';

function expectArrayClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  digits = 12
): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < actual.length; index++) {
    expect(actual[index]!).toBeCloseTo(expected[index]!, digits);
  }
}

describe('dimension-independent exponential XPBD velocity damping', () => {
  it('matches the analytic decay and energy change in R2, R4, and R7', () => {
    for (const dimension of [2, 4, 7]) {
      const velocity = Float64Array.from(
        { length: dimension },
        (_value, axis) => axis + 1
      );
      const particle = new XpbdParticleN({
        id: `r${dimension}`,
        position: new Float64Array(dimension),
        velocity,
        inverseMass: 0.5
      });
      const damping = new XpbdExponentialVelocityDampingN({
        id: `damping-r${dimension}`,
        particles: [particle],
        rate: 1.25
      });
      const result = new XpbdWorldN({ dimension })
        .addParticle(particle)
        .addVelocityResponse(damping)
        .step(0.2);
      const evaluation = result.constraintSolves[0]!
        .velocityResponses[0]!
        .evaluation as XpbdExponentialVelocityDampingEvaluationN;
      const factor = Math.exp(-0.25);
      expect(evaluation.factor).toBeCloseTo(factor, 14);
      expectArrayClose(
        particle.velocity.data,
        Array.from(velocity, (value) => value * factor),
        13
      );
      expect(evaluation.kineticEnergyAfter).toBeCloseTo(
        evaluation.kineticEnergyBefore * factor * factor,
        12
      );
      expect(evaluation.kineticEnergyChange).toBeLessThan(0);
      expect(evaluation.dampedParticleCount).toBe(1);
    }
  });

  it('has a substep-invariant final velocity factor', () => {
    const simulate = (substeps: number): Float64Array => {
      const particle = new XpbdParticleN({
        id: `p-${substeps}`,
        position: [0, 0, 0, 0],
        velocity: [1, -2, 3, -4]
      });
      const damping = new XpbdExponentialVelocityDampingN({
        id: `d-${substeps}`,
        particles: [particle],
        rate: 0.7
      });
      new XpbdWorldN({ dimension: 4 })
        .addParticle(particle)
        .addVelocityResponse(damping)
        .step(0.5, substeps);
      return particle.velocity.data.slice();
    };
    expectArrayClose(simulate(1), simulate(2), 13);
    expectArrayClose(simulate(1), simulate(10), 13);
  });

  it('leaves fixed velocities untouched and reports zero-rate identity', () => {
    const dynamic = new XpbdParticleN({
      id: 'dynamic', position: [0, 0], velocity: [1, 2]
    });
    const fixed = new XpbdParticleN({
      id: 'fixed', position: [0, 0], velocity: [3, 4], inverseMass: 0
    });
    const damping = new XpbdExponentialVelocityDampingN({
      id: 'identity', particles: [dynamic, fixed], rate: 0
    });
    const result = new XpbdWorldN({ dimension: 2 })
      .addParticle(dynamic)
      .addParticle(fixed)
      .addVelocityResponse(damping)
      .step(0.1);
    const evaluation = result.constraintSolves[0]!
      .velocityResponses[0]!
      .evaluation as XpbdExponentialVelocityDampingEvaluationN;
    expect(evaluation.factor).toBe(1);
    expect(evaluation.kineticEnergyChange).toBe(0);
    expect(evaluation.dampedParticleCount).toBe(1);
    expectArrayClose(dynamic.velocity.data, [1, 2]);
    expectArrayClose(fixed.velocity.data, [3, 4]);
  });

  it('rejects malformed particle sets and rates', () => {
    const r2 = new XpbdParticleN({ id: 'r2', position: [0, 0] });
    const r3 = new XpbdParticleN({ id: 'r3', position: [0, 0, 0] });
    expect(() => new XpbdExponentialVelocityDampingN({
      id: '', particles: [r2], rate: 1
    })).toThrow(/non-empty/);
    expect(() => new XpbdExponentialVelocityDampingN({
      id: 'empty', particles: [], rate: 1
    })).toThrow(/must not be empty/);
    expect(() => new XpbdExponentialVelocityDampingN({
      id: 'repeat', particles: [r2, r2], rate: 1
    })).toThrow(/unique/);
    expect(() => new XpbdExponentialVelocityDampingN({
      id: 'dimension', particles: [r2, r3], rate: 1
    })).toThrow(/dimensions/);
    expect(() => new XpbdExponentialVelocityDampingN({
      id: 'rate', particles: [r2], rate: -1
    })).toThrow(/non-negative/);
  });
});
