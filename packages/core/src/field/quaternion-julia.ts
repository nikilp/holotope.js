import {
  resolveQuadraticOptions,
  type QuadraticIterationOptions,
  type ResolvedQuadraticIterationOptions
} from './complex-quadratic.js';
import {
  readVec4,
  type FieldEvaluation4,
  type ImplicitField4,
  type Vec4f64
} from './types.js';

export interface QuaternionJuliaOptions extends QuadraticIterationOptions {
  /** Quaternion parameter in [i,j,k,real] order. */
  parameter: Vec4f64;
}

export interface QuaternionJuliaEvaluation extends FieldEvaluation4 {
  readonly derivativeBound: number;
  readonly continuousIteration: number;
}

/** Rotation fixing the (real,i) plane and turning the (j,k) plane. */
export function rotateQuaternionJuliaSymmetry(
  point: ArrayLike<number>,
  angle: number
): Vec4f64 {
  const [i, j, k, real] = readVec4(point, 'rotateQuaternionJuliaSymmetry');
  if (!Number.isFinite(angle)) throw new Error('rotateQuaternionJuliaSymmetry: angle must be finite');
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [i, cosine * j - sine * k, sine * j + cosine * k, real];
}

/** Quadratic quaternion Julia field q -> q^2 + c. */
export class QuaternionJuliaField implements ImplicitField4<QuaternionJuliaEvaluation> {
  readonly id = 'quaternion-julia-quadratic';
  readonly parameter: Vec4f64;
  readonly options: ResolvedQuadraticIterationOptions;
  readonly symmetries = [
    {
      id: 'jk-circle',
      description: 'For parameters in the (real,i) plane, rotations of the (j,k) plane commute with iteration.'
    }
  ] as const;
  readonly sliceTheorems = [
    {
      id: 'complex-plane',
      description: 'Restricting to the (real,i) plane reproduces the complex quadratic Julia iteration.'
    },
    {
      id: 'symmetry-plane-suspension',
      description: 'Every hyperplane containing the (real,i) plane has the same section up to the circle symmetry.'
    }
  ] as const;
  readonly distanceEstimator = {
    certificate: 'provenNDA',
    description: 'Normed-division-algebra escape estimate using an upper bound on the iterate derivative.',
    recommendedStepSafety: 0.72
  } as const;

  constructor({ parameter, ...iterationOptions }: QuaternionJuliaOptions) {
    this.parameter = readVec4(parameter, 'QuaternionJuliaField parameter');
    if (this.parameter[1] !== 0 || this.parameter[2] !== 0) {
      throw new Error(
        'QuaternionJuliaField: parameter must lie in the (real,i) plane so declared symmetries remain valid'
      );
    }
    this.options = resolveQuadraticOptions(iterationOptions);
  }

  evalCPU(point: ArrayLike<number>): QuaternionJuliaEvaluation {
    let [i, j, k, real] = readVec4(point, 'QuaternionJuliaField.evalCPU');
    let radiusSquared = i * i + j * j + k * k + real * real;
    let derivativeBound = 1;
    let orbitTrap = Math.sqrt(radiusSquared);
    let iterations = 0;
    const escapeSquared = this.options.escapeRadius * this.options.escapeRadius;

    while (iterations < this.options.maxIterations && radiusSquared <= escapeSquared) {
      const radius = Math.sqrt(radiusSquared);
      derivativeBound *= 2 * radius;
      const nextI = 2 * real * i + this.parameter[0];
      const nextJ = 2 * real * j;
      const nextK = 2 * real * k;
      const nextReal = real * real - i * i - j * j - k * k + this.parameter[3];
      i = nextI;
      j = nextJ;
      k = nextK;
      real = nextReal;
      radiusSquared = i * i + j * j + k * k + real * real;
      orbitTrap = Math.min(orbitTrap, Math.sqrt(radiusSquared));
      iterations++;
    }

    const escaped = radiusSquared > escapeSquared;
    const magnitude = Math.sqrt(radiusSquared);
    const potential = escaped ? Math.log(magnitude) * 2 ** -iterations : 0;
    const continuousIteration = escaped
      ? iterations + 1 - Math.log2(Math.log(magnitude) / Math.log(this.options.escapeRadius))
      : this.options.maxIterations;
    const distance =
      escaped && derivativeBound > 0 && Number.isFinite(derivativeBound)
        ? Math.max(0, (0.5 * magnitude * Math.log(magnitude)) / derivativeBound)
        : 0;
    return {
      value: escaped ? Math.max(distance, potential * Number.EPSILON) : -1 / this.options.maxIterations,
      escaped,
      iterations,
      magnitude,
      potential,
      distance,
      orbitTrap,
      finalPoint: [i, j, k, real],
      derivativeBound,
      continuousIteration
    };
  }
}
