import { describe, expect, it } from 'vitest';
import { BivectorN, MatN, Rotor4, VecN } from '@holotope/core';
import {
  angularVelocityOperatorNorm4,
  combineBivectorPair4,
  orientationDexp4,
  orientationDlog4,
  relativeOrientationCoordinates4,
  rotateBivector4,
  splitBivectorPair4
} from '@holotope/physics';

function expectCoordinatesClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  tolerance = 1e-11
): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < actual.length; index++) {
    expect(Math.abs(actual[index]! - expected[index]!)).toBeLessThan(tolerance);
  }
}

function scaleBivector(bivector: BivectorN, scale: number): BivectorN {
  return new BivectorN(4, Array.from(bivector.coeffs, (value) => value * scale));
}

function deterministicBivector(seed: number, magnitude = 0.3): BivectorN {
  let state = seed >>> 0;
  const values: number[] = [];
  for (let index = 0; index < 6; index++) {
    state = (1664525 * state + 1013904223) >>> 0;
    values.push((((state / 0x100000000) * 2) - 1) * magnitude);
  }
  return new BivectorN(4, values);
}

function applyJacobian(matrix: MatN, bivector: BivectorN): Float64Array {
  return matrix.applyTo(new VecN(bivector.coeffs)).data;
}

describe('SO(4) bivector pair chart', () => {
  it('pins every lexicographic basis column literally', () => {
    const expected = [
      [[0, 0, 0.5], [0, 0, -0.5]],
      [[0, -0.5, 0], [0, 0.5, 0]],
      [[-0.5, 0, 0], [-0.5, 0, 0]],
      [[0.5, 0, 0], [-0.5, 0, 0]],
      [[0, -0.5, 0], [0, -0.5, 0]],
      [[0, 0, -0.5], [0, 0, -0.5]]
    ] as const;
    for (let column = 0; column < 6; column++) {
      const basis = new BivectorN(4);
      basis.coeffs[column] = 1;
      const split = splitBivectorPair4(basis);
      expectCoordinatesClose(split.left, expected[column]![0]);
      expectCoordinatesClose(split.right, expected[column]![1]);
    }
  });

  it('round-trips arbitrary bivectors through the pair chart', () => {
    for (let trial = 1; trial <= 100; trial++) {
      const bivector = deterministicBivector(trial, 4);
      expectCoordinatesClose(
        combineBivectorPair4(splitBivectorPair4(bivector)).coeffs,
        bivector.coeffs,
        1e-14
      );
    }
  });
});

describe('relative SO(4) orientation coordinates', () => {
  it('matches the exact shortest pair-lift comparison', () => {
    let state = 0x5eed1234;
    const random = (): number => {
      state = (1664525 * state + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    for (let trial = 0; trial < 20_000; trial++) {
      const phiLeft = random() * Math.PI;
      const phiRight = random() * Math.PI;
      const current = Rotor4.fromBivector(combineBivectorPair4({
        left: Float64Array.of(phiLeft, 0, 0),
        right: Float64Array.of(0, phiRight, 0)
      }));
      const result = relativeOrientationCoordinates4(current, Rotor4.identity(), {
        cutLocusTolerance: 0
      });
      const keep = phiLeft * phiLeft + phiRight * phiRight;
      const flip = (Math.PI - phiLeft) ** 2 + (Math.PI - phiRight) ** 2;
      const expectedSign = keep <= flip ? 1 : -1;
      expect(result.shortestPairSign).toBe(expectedSign);
    }
  });

  it('reports the full non-central cut locus instead of inventing a log', () => {
    const phiLeft = 0.73;
    const current = Rotor4.fromBivector(combineBivectorPair4({
      left: Float64Array.of(phiLeft, 0, 0),
      right: Float64Array.of(0, Math.PI - phiLeft, 0)
    }));
    const result = relativeOrientationCoordinates4(current, Rotor4.identity(), {
      cutLocusTolerance: 1e-12
    });
    expect(result.status).toBe('cut-locus');
    expect(result.cutLocusGuard).toBeLessThan(1e-14);
  });

  it('retains a prior pair lift only inside the named hysteresis band', () => {
    const phiLeft = 1.2;
    const phiRight = Math.PI - phiLeft + 0.01;
    const current = Rotor4.fromBivector(combineBivectorPair4({
      left: Float64Array.of(phiLeft, 0, 0),
      right: Float64Array.of(0, phiRight, 0)
    }));
    const previous = { pairSign: 1 as const, guardAtSelection: 0.1 };
    const retained = relativeOrientationCoordinates4(current, Rotor4.identity(), {
      previousBranch: previous,
      branchHysteresis: 0.02,
      cutLocusTolerance: 1e-12
    });
    expect(retained.status).toBe('regular');
    if (retained.status === 'regular') {
      expect(retained.branch.pairSign).toBe(1);
      expect(retained.usesShortestLift).toBe(false);
    }
    const switched = relativeOrientationCoordinates4(current, Rotor4.identity(), {
      previousBranch: previous,
      branchHysteresis: 0.001,
      cutLocusTolerance: 1e-12
    });
    expect(switched.status).toBe('regular');
    if (switched.status === 'regular') {
      expect(switched.branch.pairSign).toBe(-1);
      expect(switched.usesShortestLift).toBe(true);
    }
  });

  it('converts body-right and world-left errors by the SO(4) adjoint', () => {
    for (let trial = 1; trial <= 40; trial++) {
      const target = Rotor4.fromBivector(deterministicBivector(trial, 0.35));
      const current = Rotor4.fromBivector(deterministicBivector(trial + 1000, 0.35));
      const world = relativeOrientationCoordinates4(current, target, {
        trivialization: 'world-left'
      });
      const body = relativeOrientationCoordinates4(current, target, {
        trivialization: 'body-right'
      });
      expect(world.status).toBe('regular');
      expect(body.status).toBe('regular');
      if (world.status === 'regular' && body.status === 'regular') {
        expectCoordinatesClose(
          rotateBivector4(body.error, target).coeffs,
          world.error.coeffs,
          2e-11
        );
      }
    }
  });
});

describe('SO(4) orientation Jacobians', () => {
  for (const trivialization of ['world-left', 'body-right'] as const) {
    it(`${trivialization} dexp and dlog are analytic inverses`, () => {
      for (let trial = 1; trial <= 80; trial++) {
        const error = deterministicBivector(trial, 0.45);
        const product = orientationDlog4(error, trivialization)
          .multiply(orientationDexp4(error, trivialization));
        expectCoordinatesClose(product.data, MatN.identity(6).data, 2e-12);
      }
    });

    it(`${trivialization} dlog matches finite differences of Rotor4`, () => {
      const epsilon = 2e-7;
      for (let trial = 1; trial <= 50; trial++) {
        const error = deterministicBivector(trial, 0.22);
        const delta = deterministicBivector(trial + 500, 0.3);
        const base = Rotor4.fromBivector(error);
        const increment = Rotor4.fromBivector(scaleBivector(delta, epsilon));
        const perturbed = trivialization === 'world-left'
          ? increment.multiply(base)
          : base.multiply(increment);
        const coordinates = relativeOrientationCoordinates4(
          perturbed,
          Rotor4.identity(),
          { trivialization }
        );
        expect(coordinates.status).toBe('regular');
        if (coordinates.status !== 'regular') continue;
        const numeric = Float64Array.from(
          coordinates.error.coeffs,
          (value, index) => (value - error.coeffs[index]!) / epsilon
        );
        const expected = applyJacobian(orientationDlog4(error, trivialization), delta);
        expectCoordinatesClose(numeric, expected, 4e-7);
      }
    });
  }

  it('preserves the embedded-R3 bivector subalgebra', () => {
    const error = new BivectorN(4, [0.24, -0.31, 0, 0.17, 0, 0]);
    const delta = new BivectorN(4, [-0.13, 0.09, 0, 0.21, 0, 0]);
    for (const trivialization of ['world-left', 'body-right'] as const) {
      for (const matrix of [
        orientationDexp4(error, trivialization),
        orientationDlog4(error, trivialization)
      ]) {
        const transformed = applyJacobian(matrix, delta);
        expect(Math.abs(transformed[2]!)).toBeLessThan(1e-14);
        expect(Math.abs(transformed[4]!)).toBeLessThan(1e-14);
        expect(Math.abs(transformed[5]!)).toBeLessThan(1e-14);
      }
    }
  });
});

describe('SO(4) angular operator bound', () => {
  it('equals the largest singular rate of the dense skew map', () => {
    for (let trial = 1; trial <= 200; trial++) {
      const omega = deterministicBivector(trial, 3);
      const matrix = omega.toSkewMatrix();
      let traceSquared = 0;
      for (let row = 0; row < 4; row++) {
        for (let column = 0; column < 4; column++) {
          traceSquared += matrix.get(row, column) * matrix.get(column, row);
        }
      }
      const sumSquares = -0.5 * traceSquared;
      const pfaffian =
        matrix.get(0, 1) * matrix.get(2, 3) -
        matrix.get(0, 2) * matrix.get(1, 3) +
        matrix.get(0, 3) * matrix.get(1, 2);
      const discriminant = Math.sqrt(Math.max(
        0,
        sumSquares * sumSquares - 4 * pfaffian * pfaffian
      ));
      const denseNorm = Math.sqrt(0.5 * (sumSquares + discriminant));
      expect(angularVelocityOperatorNorm4(omega)).toBeCloseTo(denseNorm, 12);
    }
  });
});

describe('orientation coordinate validation', () => {
  it('rejects invalid dimensions, factors, and singular Jacobian inputs', () => {
    expect(() => splitBivectorPair4(new BivectorN(3))).toThrow(/4D bivector/);
    expect(() => combineBivectorPair4({
      left: Float64Array.of(0, 0),
      right: Float64Array.of(0, 0, 0)
    })).toThrow(/three factor coordinates/);
    const invalid = Rotor4.identity();
    invalid.left[3] = 2;
    expect(() => relativeOrientationCoordinates4(invalid, Rotor4.identity())).toThrow(/normalized/);
    const nearAntipode = combineBivectorPair4({
      left: Float64Array.of(Math.PI - 1e-9, 0, 0),
      right: Float64Array.of(0, 0, 0)
    });
    expect(() => orientationDlog4(nearAntipode)).toThrow(/regular chart/);
    expect(() => relativeOrientationCoordinates4(
      Rotor4.identity(),
      Rotor4.identity(),
      { cutLocusTolerance: Number.NaN }
    )).toThrow(/finite non-negative/);
  });
});
