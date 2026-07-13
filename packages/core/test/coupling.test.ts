import { describe, expect, it } from 'vitest';
import {
  BivectorN,
  SkewProductFlow,
  checkDecorationEquivariance,
  createElserSloaneModelSet,
  doubledIcosianKey,
  elserSloaneDecorationGenerators,
  elserSloaneGerm,
  elserSloaneGermParameterDecoration,
  elserSloaneH4ReflectionGenerators,
  elserSloaneNormPatch,
  elserSloanePerpendicularParameterDecoration,
  exactParameter4Equals,
  periodicOrbitHolonomy,
  phiRing,
  rotorIdentityResidual,
  type Decoration,
  type DoubledIcosian,
  type ExactValue
} from '@holotope/core';

type ComplexPoint = readonly [imaginary: number, real: number];

const PERIOD_TWO_START: ComplexPoint = [Math.sqrt(3) / 2, -0.5];

function complexSquare([imaginary, real]: ComplexPoint): ComplexPoint {
  return [2 * real * imaginary, real * real - imaginary * imaginary];
}

function complexDistance(left: ComplexPoint, right: ComplexPoint): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function essentialCocycle([imaginary, real]: ComplexPoint): BivectorN {
  const u1 = 0.28 * (1 + imaginary);
  const u2 = 0.25 * (1 - imaginary);
  const u3 = 0.18 * real;
  return new BivectorN(4)
    .set(1, 2, u1)
    .set(0, 3, -u1)
    .set(0, 2, -u2)
    .set(1, 3, -u2)
    .set(0, 1, u3)
    .set(2, 3, -u3);
}

function dot(left: DoubledIcosian, right: DoubledIcosian): ExactValue {
  let value = phiRing.zero;
  for (let coordinate = 0; coordinate < 4; coordinate++) {
    value = phiRing.add(value, phiRing.mul(left[coordinate]!, right[coordinate]!));
  }
  return value;
}

describe('Decoration', () => {
  it('reports finite-orbit equivariance and distinguishes missing images', () => {
    const sources = [0, 1, 2] as const;
    const decoration: Decoration<number, number> = {
      id: 'residue-color',
      parameter: (source) => source * 2
    };
    const equivariant = checkDecorationEquivariance({
      sources,
      decoration,
      generators: [
        {
          id: 'cycle',
          actOnSource: (source) => (source + 1) % 3,
          actOnParameter: (parameter) => (parameter + 2) % 6
        }
      ],
      sourceKey: String,
      parameterEquals: (left, right) => left === right
    });
    expect(equivariant).toMatchObject({ checked: 3, matched: 3, equivariant: true });

    const clipped = checkDecorationEquivariance({
      sources: [0, 1],
      decoration,
      generators: [
        {
          id: 'advance',
          actOnSource: (source) => source + 1,
          actOnParameter: (parameter) => parameter + 2
        }
      ],
      sourceKey: String,
      parameterEquals: (left, right) => left === right
    });
    expect(clipped.equivariant).toBe(false);
    expect(clipped.mismatches).toContainEqual({
      generator: 'advance',
      sourceIndex: 1,
      targetKey: '2',
      reason: 'missing-target'
    });
  });

  it('keeps the exact perpendicular coordinate and its scale as the parameter', () => {
    const model = createElserSloaneModelSet();
    const patch = elserSloaneNormPatch({ maxE8Norm: 4 });
    for (const point of patch.points) {
      const parameter = elserSloanePerpendicularParameterDecoration.parameter(point);
      const ambient = model.lattice.point(point.coefficients);
      expect(parameter.exact).toEqual(model.flat.projectPerpendicular(ambient));
      expect(parameter.exact).toEqual(point.perpendicularExact);
      expect(parameter.denominator).toBe(model.flat.perpendicularDenominator);
      for (let coordinate = 0; coordinate < 4; coordinate++) {
        expect(parameter.value[coordinate]).toBeCloseTo(point.perpendicular[coordinate]!, 14);
      }
    }
  });
});

describe('Elser-Sloane canonical parameter equivariance', () => {
  it('constructs an exact H4 simple-root system with links 5-3-3', () => {
    const roots = elserSloaneH4ReflectionGenerators();
    expect(roots).toHaveLength(4);
    for (let left = 0; left < 4; left++) {
      for (let right = 0; right < 4; right++) {
        const expected =
          left === right
            ? { a: 4n, b: 0n }
            : Math.abs(left - right) === 1
              ? left + right === 1
                ? { a: 0n, b: -2n }
                : { a: -2n, b: 0n }
              : { a: 0n, b: 0n };
        expect(dot(roots[left]!, roots[right]!)).toEqual(expected);
      }
    }
  });

  it('intertwines every H4 generator with its Galois-twisted parameter action', () => {
    const sources = elserSloaneGerm().points.map((point) => point.icosian);
    const report = checkDecorationEquivariance({
      sources,
      decoration: elserSloaneGermParameterDecoration,
      generators: elserSloaneDecorationGenerators(),
      sourceKey: doubledIcosianKey,
      parameterEquals: exactParameter4Equals
    });
    expect(report).toMatchObject({
      generatorCount: 4,
      sourceCount: 240,
      checked: 960,
      matched: 960,
      equivariant: true,
      mismatches: []
    });
  });
});

describe('SkewProductFlow', () => {
  it('reports exact identity holonomy for the null cocycle', () => {
    const flow = new SkewProductFlow<ComplexPoint>({
      id: 'null-over-circle-doubling',
      baseMap: complexSquare,
      cocycle: () => new BivectorN(4)
    });
    const report = periodicOrbitHolonomy(flow, PERIOD_TWO_START, {
      period: 2,
      baseDistance: complexDistance
    });
    expect(report.closed).toBe(true);
    expect(report.closureError).toBeLessThan(1e-14);
    expect(report.identityResidual).toBe(0);
    expect(report.nontrivial).toBe(false);
    expect(report.essentialWitness).toBe(false);
  });

  it('finds a nontrivial ordered holonomy on a period-two Julia orbit', () => {
    const flow = new SkewProductFlow<ComplexPoint>({
      id: 'essential-over-circle-doubling',
      baseMap: complexSquare,
      cocycle: essentialCocycle,
      coupling: 0.72
    });
    const report = periodicOrbitHolonomy(flow, PERIOD_TWO_START, {
      period: 2,
      baseDistance: complexDistance
    });
    expect(report.orbit).toHaveLength(2);
    expect(report.orbit.map((point) => Math.hypot(...point))).toEqual([
      expect.closeTo(1, 14),
      expect.closeTo(1, 14)
    ]);
    expect(report.closed).toBe(true);
    expect(report.identityResidual).toBeGreaterThan(0.1);
    expect(report.nontrivial).toBe(true);
    expect(report.essentialWitness).toBe(true);

    const first = flow.increment(report.orbit[0]!);
    const second = flow.increment(report.orbit[1]!);
    expect([...first.right]).toEqual([0, 0, 0, 1]);
    expect([...second.right]).toEqual([0, 0, 0, 1]);
    const ordered = second.multiply(first);
    const expected = ordered.toMatrix().data;
    const actual = report.holonomy.toMatrix().data;
    for (let index = 0; index < expected.length; index++) {
      expect(actual[index]).toBeCloseTo(expected[index]!, 14);
    }

    const wrongPeriod = periodicOrbitHolonomy(flow, PERIOD_TWO_START, {
      period: 1,
      baseDistance: complexDistance
    });
    expect(wrongPeriod.closed).toBe(false);
    expect(wrongPeriod.essentialWitness).toBe(false);
  });

  it('preserves four-dimensional distances under long fiber accumulation', () => {
    const flow = new SkewProductFlow<ComplexPoint>({
      baseMap: complexSquare,
      cocycle: essentialCocycle,
      coupling: 0.72
    });
    const state = flow.iterate(flow.initial(PERIOD_TWO_START), 2000);
    const source = Float64Array.of(0.3, -0.7, 1.1, 0.2, -0.9, 0.4, 0.1, 0.8);
    const transformed = new Float64Array(8);
    state.fiber.applyToPositions(source, transformed, 2);
    const distance = (values: Float64Array): number =>
      Math.hypot(
        values[0]! - values[4]!,
        values[1]! - values[5]!,
        values[2]! - values[6]!,
        values[3]! - values[7]!
      );
    expect(distance(transformed)).toBeCloseTo(distance(source), 12);
    expect(Math.hypot(...state.fiber.left)).toBeCloseTo(1, 14);
    expect(Math.hypot(...state.fiber.right)).toBeCloseTo(1, 14);
  });

  it('validates the cocycle dimension, coefficients, and claimed period', () => {
    const wrongDimension = new SkewProductFlow<number>({
      baseMap: (value) => value,
      cocycle: () => new BivectorN(3)
    });
    expect(() => wrongDimension.increment(0)).toThrow(/4D bivector/);

    const nonFinite = new SkewProductFlow<number>({
      baseMap: (value) => value,
      cocycle: () => new BivectorN(4).set(0, 1, Number.NaN)
    });
    expect(() => nonFinite.increment(0)).toThrow(/non-finite/);
    expect(() =>
      periodicOrbitHolonomy(
        new SkewProductFlow({ baseMap: (value: number) => value, cocycle: () => new BivectorN(4) }),
        0,
        { period: 0, baseDistance: (left, right) => Math.abs(left - right) }
      )
    ).toThrow(/period/);
    expect(rotorIdentityResidual(new SkewProductFlow({
      baseMap: (value: number) => value,
      cocycle: () => new BivectorN(4)
    }).initial(0).fiber)).toBe(0);
  });
});
