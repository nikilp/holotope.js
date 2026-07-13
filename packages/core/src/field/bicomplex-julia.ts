import {
  evaluateComplexQuadratic,
  resolveQuadraticOptions,
  type Complex2,
  type ComplexQuadraticEvaluation,
  type QuadraticIterationOptions,
  type ResolvedQuadraticIterationOptions
} from './complex-quadratic.js';
import { readVec4, type FieldEvaluation4, type ImplicitField4, type Vec4f64 } from './types.js';

export interface BicomplexJuliaOptions extends QuadraticIterationOptions {
  /** Parameter in [i1,i2,i1*i2,real] order. */
  parameter: Vec4f64;
}

export interface BicomplexIdempotentPair {
  readonly first: Complex2;
  readonly second: Complex2;
}

export interface BicomplexJuliaEvaluation extends FieldEvaluation4 {
  readonly factors: readonly [ComplexQuadraticEvaluation, ComplexQuadraticEvaluation];
}

/** Exact linear change from [i1,i2,i1*i2,real] to the two complex factors. */
export function bicomplexToIdempotent(point: ArrayLike<number>): BicomplexIdempotentPair {
  const [i1, i2, product, real] = readVec4(point, 'bicomplexToIdempotent');
  return {
    first: [i1 - i2, real + product],
    second: [i1 + i2, real - product]
  };
}

/** Inverse idempotent transform in [i1,i2,i1*i2,real] order. */
export function idempotentToBicomplex(
  first: Complex2,
  second: Complex2
): Vec4f64 {
  return [
    (first[0] + second[0]) / 2,
    (second[0] - first[0]) / 2,
    (first[1] - second[1]) / 2,
    (first[1] + second[1]) / 2
  ];
}

/** Quadratic bicomplex Julia field, evaluated as two independent complex factors. */
export class BicomplexJuliaField implements ImplicitField4<BicomplexJuliaEvaluation> {
  readonly id = 'bicomplex-julia-quadratic';
  readonly parameter: Vec4f64;
  readonly factorParameters: BicomplexIdempotentPair;
  readonly options: ResolvedQuadraticIterationOptions;
  readonly symmetries = [
    {
      id: 'idempotent-product',
      description: 'The bicomplex quadratic map is the direct product of two complex quadratic maps.'
    }
  ] as const;
  readonly sliceTheorems = [
    {
      id: 'factor-diagonalization',
      description: 'In idempotent coordinates every slice is an affine slice of a product of complex Julia sets.'
    }
  ] as const;
  readonly distanceEstimator = {
    certificate: 'provenProduct',
    description: 'Per-factor complex estimates combined in the orthogonal product metric.',
    recommendedStepSafety: 0.2
  } as const;

  constructor({ parameter, ...iterationOptions }: BicomplexJuliaOptions) {
    this.parameter = readVec4(parameter, 'BicomplexJuliaField parameter');
    this.factorParameters = bicomplexToIdempotent(this.parameter);
    this.options = resolveQuadraticOptions(iterationOptions);
  }

  evalCPU(point: ArrayLike<number>): BicomplexJuliaEvaluation {
    const factors = bicomplexToIdempotent(point);
    const first = evaluateComplexQuadratic(
      factors.first,
      this.factorParameters.first,
      this.options
    );
    const second = evaluateComplexQuadratic(
      factors.second,
      this.factorParameters.second,
      this.options
    );
    const escaped = first.escaped || second.escaped;
    const outsideFirst = first.escaped ? first.distance : 0;
    const outsideSecond = second.escaped ? second.distance : 0;
    const distance = Math.hypot(outsideFirst, outsideSecond) / Math.SQRT2;
    return {
      value: escaped ? Math.max(distance, Number.EPSILON * Math.max(first.potential, second.potential)) : -1 / this.options.maxIterations,
      escaped,
      iterations: Math.max(first.iterations, second.iterations),
      magnitude: Math.hypot(first.magnitude, second.magnitude) / Math.SQRT2,
      potential: Math.max(first.potential, second.potential),
      distance,
      orbitTrap: Math.hypot(first.orbitTrap, second.orbitTrap) / Math.SQRT2,
      finalPoint: idempotentToBicomplex(first.finalPoint, second.finalPoint),
      factors: [first, second]
    };
  }
}
