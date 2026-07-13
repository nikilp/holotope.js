import { phiRing, type ExactValue } from '../coxeter/exact.js';
import { icosianE8Data, type DoubledIcosian } from '../lattice/e8.js';
import { phiConjugate } from '../lattice/elser-sloane.js';
import type { ModelPoint } from '../lattice/model-set.js';
import type { Vec4f64 } from '../field/types.js';
import type { Decoration, DecorationEquivarianceGenerator } from './decoration.js';

export type ExactVector4 = readonly [ExactValue, ExactValue, ExactValue, ExactValue];

/** An exact four-dimensional parameter and its single Float64 rendering. */
export interface ExactParameter4 {
  readonly exact: ExactVector4;
  readonly denominator: bigint;
  readonly value: Vec4f64;
}

function asExactVector4(values: readonly ExactValue[], label: string): ExactVector4 {
  if (values.length !== 4) throw new Error(`${label}: expected 4 coordinates, got ${values.length}`);
  return values.map((value) => ({ ...value })) as unknown as ExactVector4;
}

function exactParameter4(exact: ExactVector4, denominator: bigint): ExactParameter4 {
  if (denominator < 1n) throw new Error('exactParameter4: denominator must be positive');
  const numeric = exact.map((coordinate) => phiRing.toNumber(coordinate) / Number(denominator));
  if (numeric.some((coordinate) => !Number.isFinite(coordinate))) {
    throw new Error('exactParameter4: parameter is outside the Float64 range');
  }
  return {
    exact,
    denominator,
    value: numeric as unknown as Vec4f64
  };
}

/** Canonical model-set decoration: retain the coordinate discarded by physical rendering. */
export const elserSloanePerpendicularParameterDecoration: Decoration<
  ModelPoint,
  ExactParameter4
> = {
  id: 'elser-sloane-perpendicular-parameter',
  parameter(point): ExactParameter4 {
    return exactParameter4(
      asExactVector4(point.perpendicularExact, 'elserSloanePerpendicularParameterDecoration'),
      point.perpendicularDenominator
    );
  }
};

/** Exact key for a parameter, including its coordinate scale. */
export function exactParameter4Key(parameter: ExactParameter4): string {
  return `${parameter.denominator}:${phiRing.keyTuple(parameter.exact)}`;
}

export function exactParameter4Equals(left: ExactParameter4, right: ExactParameter4): boolean {
  if (left.denominator !== right.denominator) return false;
  return left.exact.every(
    (coordinate, index) =>
      coordinate.a === right.exact[index]!.a && coordinate.b === right.exact[index]!.b
  );
}

/** Exact key for a doubled icosian source point. */
export function doubledIcosianKey(point: DoubledIcosian): string {
  return phiRing.keyTuple(point);
}

function dot(left: ExactVector4, right: ExactVector4): ExactValue {
  let result = phiRing.zero;
  for (let index = 0; index < 4; index++) {
    result = phiRing.add(result, phiRing.mul(left[index]!, right[index]!));
  }
  return result;
}

function divideByTwo(value: ExactValue, label: string): ExactValue {
  if (value.a % 2n !== 0n || value.b % 2n !== 0n) {
    throw new Error(`${label}: reflection coefficient is not in Z[phi]`);
  }
  return { a: value.a / 2n, b: value.b / 2n };
}

/** Reflection in a unit H4 root, with both point and root stored in doubled coordinates. */
export function reflectDoubledIcosian(
  point: DoubledIcosian,
  root: DoubledIcosian
): DoubledIcosian {
  const rootNorm = dot(root, root);
  if (rootNorm.a !== 4n || rootNorm.b !== 0n) {
    throw new Error('reflectDoubledIcosian: root must have doubled norm 4');
  }
  const factor = divideByTwo(dot(point, root), 'reflectDoubledIcosian');
  return point.map((coordinate, index) =>
    phiRing.sub(coordinate, phiRing.mul(factor, root[index]!))
  ) as unknown as DoubledIcosian;
}

/** Apply Galois conjugation coordinate-wise. */
export function galoisTwistIcosian(point: DoubledIcosian): DoubledIcosian {
  return point.map(phiConjugate) as unknown as DoubledIcosian;
}

/** The perpendicular-space parameter of an exact icosian source `x`: `c=x*`. */
export const elserSloaneGermParameterDecoration: Decoration<DoubledIcosian, ExactParameter4> = {
  id: 'elser-sloane-galois-parameter',
  parameter(source): ExactParameter4 {
    return exactParameter4(galoisTwistIcosian(source), 2n);
  }
};

function sameExact(left: ExactValue, right: ExactValue): boolean {
  return left.a === right.a && left.b === right.b;
}

function findH4SimpleRoots(): readonly DoubledIcosian[] {
  const units = icosianE8Data().roots.slice(0, 120);
  const zero = phiRing.zero;
  const fiveLink = { a: 0n, b: -2n };
  const threeLink = { a: -2n, b: 0n };
  for (const first of units) {
    for (const second of units) {
      if (!sameExact(dot(first, second), fiveLink)) continue;
      for (const third of units) {
        if (!sameExact(dot(first, third), zero)) continue;
        if (!sameExact(dot(second, third), threeLink)) continue;
        for (const fourth of units) {
          if (!sameExact(dot(first, fourth), zero)) continue;
          if (!sameExact(dot(second, fourth), zero)) continue;
          if (sameExact(dot(third, fourth), threeLink)) return [first, second, third, fourth];
        }
      }
    }
  }
  throw new Error('elserSloaneH4ReflectionGenerators: no H4 simple-root system found');
}

let cachedH4Generators: readonly DoubledIcosian[] | null = null;

/** Four deterministic exact simple roots with Coxeter links H4 = 5-3-3. */
export function elserSloaneH4ReflectionGenerators(): readonly DoubledIcosian[] {
  cachedH4Generators ??= findH4SimpleRoots();
  return cachedH4Generators;
}

function reflectParameter(parameter: ExactParameter4, root: DoubledIcosian): ExactParameter4 {
  const reflected = reflectDoubledIcosian(parameter.exact, root);
  return exactParameter4(reflected, parameter.denominator);
}

/** H4 on physical provenance paired with its Galois-conjugate internal action. */
export function elserSloaneDecorationGenerators(): readonly DecorationEquivarianceGenerator<
  DoubledIcosian,
  ExactParameter4
>[] {
  return elserSloaneH4ReflectionGenerators().map((root, index) => {
    const twistedRoot = galoisTwistIcosian(root);
    return {
      id: `H4-s${index + 1}`,
      actOnSource: (source) => reflectDoubledIcosian(source, root),
      actOnParameter: (parameter) => reflectParameter(parameter, twistedRoot)
    };
  });
}
