import { describe, expect, it } from 'vitest';
import { evaluateClampedLogBarrier } from '../src/index.js';

const ipcToolkitOracle = [
  [0.1, 1.865093925325177, -12.244653167389281, 121.60517018598809],
  [0.25, 0.77979057812993846, -4.3294415416798362, 23.772588722239782],
  [0.5, 0.17328679513998632, -1.1931471805599454, 6.3862943611198908],
  [0.9, 0.0010536051565782623, -0.032183214242676374, 0.66751115477244305]
] as const;

describe('C2-clamped logarithmic scalar barrier', () => {
  it('matches the pinned IPC Toolkit Float64 oracle', () => {
    for (const [coordinate, energy, first, second] of ipcToolkitOracle) {
      const evaluated = evaluateClampedLogBarrier({
        coordinate,
        activation: 1,
        stiffness: 1
      });
      expect(evaluated.active).toBe(true);
      expect(evaluated.energy).toBe(energy);
      expect(evaluated.firstDerivative).toBe(first);
      expect(evaluated.secondDerivative).toBe(second);
    }
  });

  it('is exactly inactive at and above activation', () => {
    for (const coordinate of [0.7, 1, 2, 1e100]) {
      const evaluated = evaluateClampedLogBarrier({
        coordinate,
        activation: 0.7,
        stiffness: 3.2
      });
      expect(evaluated.active).toBe(false);
      expect(evaluated.energy).toBe(0);
      expect(evaluated.firstDerivative).toBe(0);
      expect(evaluated.secondDerivative).toBe(0);
    }
  });

  it('matches centered first and second differences under arbitrary scaling', () => {
    const activation = 1.7;
    const stiffness = 2.4;
    const step = 1e-5;
    for (const coordinate of [0.19, 0.43, 0.91, 1.31]) {
      const evaluate = (value: number) => evaluateClampedLogBarrier({
        coordinate: value,
        activation,
        stiffness
      });
      const base = evaluate(coordinate);
      const plus = evaluate(coordinate + step);
      const minus = evaluate(coordinate - step);
      const numericFirst = (plus.energy - minus.energy) / (2 * step);
      const numericSecond = (
        plus.firstDerivative - minus.firstDerivative
      ) / (2 * step);
      expect(Math.abs(base.firstDerivative - numericFirst)).toBeLessThanOrEqual(
        1e-8 * Math.max(1, Math.abs(base.firstDerivative), Math.abs(numericFirst))
      );
      expect(Math.abs(base.secondDerivative - numericSecond)).toBeLessThanOrEqual(
        1e-8 * Math.max(
          1,
          Math.abs(base.secondDerivative),
          Math.abs(numericSecond)
        )
      );
      expect(base.secondDerivative).toBeGreaterThan(0);
    }
  });

  it('refuses coordinates outside the open domain and malformed scales', () => {
    expect(() => evaluateClampedLogBarrier({
      coordinate: 0,
      activation: 1,
      stiffness: 1
    })).toThrow(/coordinate/);
    expect(() => evaluateClampedLogBarrier({
      coordinate: -1,
      activation: 1,
      stiffness: 1
    })).toThrow(/coordinate/);
    expect(() => evaluateClampedLogBarrier({
      coordinate: 0.5,
      activation: Number.NaN,
      stiffness: 1
    })).toThrow(/activation/);
    expect(() => evaluateClampedLogBarrier({
      coordinate: 0.5,
      activation: 1,
      stiffness: 0
    })).toThrow(/stiffness/);
  });
});
