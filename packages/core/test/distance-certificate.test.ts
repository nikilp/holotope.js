import { describe, expect, it } from 'vitest';
import {
  BicomplexJuliaField,
  QuaternionJuliaField,
  idempotentToBicomplex,
  type ImplicitField4
} from '@holotope/core';

function auditEstimatedRaySteps(field: ImplicitField4): { tested: number; skipped: number } {
  const safety = field.distanceEstimator!.recommendedStepSafety;
  let tested = 0;
  let skipped = 0;
  for (let ray = 0; ray < 64; ray++) {
    const raw = [
      Math.sin(ray * 1.7 + 0.2),
      Math.cos(ray * 0.71 + 0.5),
      Math.sin(ray * 0.37 + 1.1),
      Math.cos(ray * 1.13 + 0.9)
    ];
    const norm = Math.hypot(...raw);
    const direction = raw.map((coordinate) => -coordinate / norm);
    const origin = direction.map((coordinate) => -3.2 * coordinate);
    let travel = 0;
    for (let step = 0; step < 384 && travel < 6.4; step++) {
      const point = origin.map(
        (coordinate, axis) => coordinate + direction[axis]! * travel
      );
      const record = field.evalCPU(point);
      if (!record.escaped) break;
      const advance = record.distance * safety;
      // The renderer's terminal epsilon deliberately permits the final hit.
      // Audit only estimator-sized steps, not that separate stopping policy.
      if (advance < 1e-4) break;
      expect(Number.isFinite(advance)).toBe(true);
      expect(advance).toBeGreaterThan(0);
      tested++;
      for (let sample = 1; sample < 48; sample++) {
        const at = travel + (advance * sample) / 48;
        const probe = origin.map(
          (coordinate, axis) => coordinate + direction[axis]! * at
        );
        if (!field.evalCPU(probe).escaped) {
          skipped++;
          break;
        }
      }
      travel += advance;
    }
  }
  return { tested, skipped };
}

describe('distance-estimator ray audits', () => {
  it('does not skip a dense bounded sample for normed quaternion fields', () => {
    for (const parameter of [
      [0.156, 0, 0, -0.8],
      [0.745, 0, 0, -0.123]
    ] as const) {
      const field = new QuaternionJuliaField({ parameter, maxIterations: 48 });
      expect(field.distanceEstimator.certificate).toBe('provenNDA');
      const audit = auditEstimatedRaySteps(field);
      expect(audit.tested).toBeGreaterThan(1_000);
      expect(audit.skipped).toBe(0);
    }
  });

  it('does not skip a dense bounded sample for factorized bicomplex fields', () => {
    const pairs = [
      [[0.745, -0.123], [0.156, -0.8]],
      [[0, -1], [0.156, -0.8]],
      [[0, -1], [0.745, -0.123]],
      [[0.156, -0.8], [0.156, -0.8]]
    ] as const;
    for (const [first, second] of pairs) {
      const field = new BicomplexJuliaField({
        parameter: idempotentToBicomplex(first, second),
        maxIterations: 48
      });
      expect(field.distanceEstimator.certificate).toBe('provenProduct');
      const audit = auditEstimatedRaySteps(field);
      expect(audit.tested).toBeGreaterThan(1_000);
      expect(audit.skipped).toBe(0);
    }
  });
});
