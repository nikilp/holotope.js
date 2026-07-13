export type Complex2 = readonly [imaginary: number, real: number];

export interface QuadraticIterationOptions {
  maxIterations?: number;
  escapeRadius?: number;
}

export interface ComplexQuadraticEvaluation {
  readonly escaped: boolean;
  readonly iterations: number;
  readonly magnitude: number;
  readonly potential: number;
  readonly continuousIteration: number;
  readonly derivativeBound: number;
  readonly distance: number;
  readonly orbitTrap: number;
  readonly finalPoint: Complex2;
}

export interface ResolvedQuadraticIterationOptions {
  readonly maxIterations: number;
  readonly escapeRadius: number;
}

export function resolveQuadraticOptions(
  { maxIterations = 64, escapeRadius = 4 }: QuadraticIterationOptions = {}
): ResolvedQuadraticIterationOptions {
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1) {
    throw new Error(`quadratic iteration: invalid maxIterations ${maxIterations}`);
  }
  if (!Number.isFinite(escapeRadius) || escapeRadius <= 1) {
    throw new Error(`quadratic iteration: escapeRadius must be finite and greater than one`);
  }
  return { maxIterations, escapeRadius };
}

/** Deterministic reference iteration in the coordinate order [imaginary, real]. */
export function evaluateComplexQuadratic(
  point: Complex2,
  parameter: Complex2,
  options: ResolvedQuadraticIterationOptions
): ComplexQuadraticEvaluation {
  let imaginary = point[0];
  let real = point[1];
  let radiusSquared = imaginary * imaginary + real * real;
  let derivativeBound = 1;
  let orbitTrap = Math.sqrt(radiusSquared);
  let iterations = 0;
  const escapeSquared = options.escapeRadius * options.escapeRadius;

  while (iterations < options.maxIterations && radiusSquared <= escapeSquared) {
    const radius = Math.sqrt(radiusSquared);
    derivativeBound *= 2 * radius;
    const nextImaginary = 2 * real * imaginary + parameter[0];
    const nextReal = real * real - imaginary * imaginary + parameter[1];
    imaginary = nextImaginary;
    real = nextReal;
    radiusSquared = imaginary * imaginary + real * real;
    orbitTrap = Math.min(orbitTrap, Math.sqrt(radiusSquared));
    iterations++;
  }

  const escaped = radiusSquared > escapeSquared;
  const magnitude = Math.sqrt(radiusSquared);
  const potential = escaped ? Math.log(magnitude) * 2 ** -iterations : 0;
  const continuousIteration = escaped
    ? iterations + 1 - Math.log2(Math.log(magnitude) / Math.log(options.escapeRadius))
    : options.maxIterations;
  const distance =
    escaped && derivativeBound > 0 && Number.isFinite(derivativeBound)
      ? Math.max(0, (0.5 * magnitude * Math.log(magnitude)) / derivativeBound)
      : 0;
  return {
    escaped,
    iterations,
    magnitude,
    potential,
    continuousIteration,
    derivativeBound,
    distance,
    orbitTrap,
    finalPoint: [imaginary, real]
  };
}
