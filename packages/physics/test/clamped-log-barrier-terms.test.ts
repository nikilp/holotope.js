import { describe, expect, it } from 'vitest';
import {
  assembleSameSigned, barrierTermParts, evaluateBarrierCore
} from '../src/clamped-log-barrier-core.js';
import type { ClampedLogBarrierInputsN } from '../src/index.js';

/**
 * The same-sign identity gate. The contract carries no premature
 * intermediate-failure arm because on the active domain every output is a
 * sum of SAME-SIGNED terms, so a term can only overflow when the output
 * does. Both halves are held to the code: the term mirror is written
 * independently in the core module, and assembling it through the SHIPPED
 * combiner must reproduce the shipped outputs bit for bit — so the mirror
 * cannot drift from the arithmetic it makes a claim about.
 */

function corpus(): ClampedLogBarrierInputsN[] {
  const rows: ClampedLogBarrierInputsN[] = [];
  for (const activation of [1e-300, 1e-80, 1e-3, 1, 1e3, 1e80, 1e200]) {
    for (const stiffness of [1e-300, 1e-20, 1, 1e20, 1e300]) {
      for (const exponent of [-320, -200, -100, -20, -3, -1, -0.3, 0]) {
        const coordinate = activation * 10 ** exponent;
        if (!Number.isFinite(coordinate) || coordinate <= 0) continue;
        if (!(coordinate < activation)) continue;
        rows.push({ coordinate, activation, stiffness });
      }
    }
  }
  // The emission-window shape, so the identity holds on grid-touching rows.
  const x = 0.5 * (1 + 2 ** -40);
  for (let step = 0; step < 12; step += 1) {
    rows.push({ coordinate: x, activation: x + 0.5 * 1.8 * 2 ** -30,
      stiffness: ((0.52 + step * 0.01) / (6 * 1.8)) * 2 ** (-1074 + 30) });
  }
  return rows;
}

describe('clamped-log barrier: the same-sign term identity', () => {
  it('the term mirror assembles bit-identically to the shipped core', () => {
    let checked = 0;
    for (const row of corpus()) {
      const core = evaluateBarrierCore(row, 2);
      const mirror = barrierTermParts(row);
      const assembled = {
        energy: assembleSameSigned(mirror.energy),
        firstDerivative: assembleSameSigned(mirror.firstDerivative),
        secondDerivative: assembleSameSigned(mirror.secondDerivative)
      };
      for (const output of ['energy', 'firstDerivative',
        'secondDerivative'] as const) {
        expect(Object.is(assembled[output], core[output]),
          `${output} mirror drift at x=${row.coordinate.toExponential(3)}`
          + ` a=${row.activation.toExponential(0)}`
          + ` k=${row.stiffness.toExponential(0)}`).toBe(true);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('every output is a sum of same-signed terms on the active domain', () => {
    for (const row of corpus()) {
      const mirror = barrierTermParts(row);
      for (const [name, sign] of [
        ['energy', 1], ['firstDerivative', -1], ['secondDerivative', 1]
      ] as const) {
        for (const part of mirror[name]) {
          if (part.significand === 0) continue;
          expect(Math.sign(part.significand),
            `${name} term sign at x=${row.coordinate.toExponential(3)}`)
            .toBe(sign);
        }
      }
    }
  });
});
