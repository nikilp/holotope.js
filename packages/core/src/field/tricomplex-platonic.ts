import {
  resolveQuadraticOptions,
  type QuadraticIterationOptions
} from './complex-quadratic.js';
import type { Point3 } from './sample.js';

export type TricomplexPlatonicSlice3Id = 'airbrot' | 'firebrot' | 'earthbrot';

export interface TricomplexPlatonicSlice3Spec {
  readonly id: TricomplexPlatonicSlice3Id;
  readonly label: string;
  readonly basis: readonly [string, string, string];
  /** Dyadic theorem vertices in the declared basis. */
  readonly vertices: readonly Point3[];
  /** Polygon faces indexing `vertices`. */
  readonly faces: readonly (readonly number[])[];
  readonly center: Point3;
  readonly edgeLength: number;
}

export interface RealMandelbrotParameterEvaluation {
  readonly parameter: number;
  readonly escaped: boolean;
  readonly iterations: number;
  readonly finalValue: number;
  readonly magnitude: number;
}

export interface TricomplexMandelbrotSliceEvaluation3 {
  readonly id: TricomplexPlatonicSlice3Id;
  /** Negative inside, zero on the theorem boundary, positive outside. */
  readonly analyticValue: number;
  readonly analyticallyBounded: boolean;
  readonly escaped: boolean;
  readonly iterations: number;
  /** Four real idempotent factors; Earthbrot's unused fourth factor is zero. */
  readonly factorParameters: readonly [number, number, number, number];
  readonly factors: readonly [
    RealMandelbrotParameterEvaluation,
    RealMandelbrotParameterEvaluation,
    RealMandelbrotParameterEvaluation,
    RealMandelbrotParameterEvaluation
  ];
}

const REAL_MANDELBROT_MINIMUM = -2;
const REAL_MANDELBROT_MAXIMUM = 1 / 4;
const REAL_MANDELBROT_CENTER = -7 / 8;
const REAL_MANDELBROT_RADIUS = 9 / 8;

const AIRBROT: TricomplexPlatonicSlice3Spec = {
  id: 'airbrot',
  label: 'Airbrot',
  basis: ['1', 'j1', 'j2'],
  vertices: [
    [1 / 4, 0, 0],
    [-2, 0, 0],
    [-7 / 8, 9 / 8, 0],
    [-7 / 8, -9 / 8, 0],
    [-7 / 8, 0, 9 / 8],
    [-7 / 8, 0, -9 / 8]
  ],
  faces: [
    [0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2],
    [1, 4, 2], [1, 3, 4], [1, 5, 3], [1, 2, 5]
  ],
  center: [-7 / 8, 0, 0],
  edgeLength: (9 * Math.SQRT2) / 8
};

const FIREBROT: TricomplexPlatonicSlice3Spec = {
  id: 'firebrot',
  label: 'Firebrot',
  basis: ['j1', 'j2', 'j3'],
  vertices: [
    [-1 / 4, 1 / 4, -1 / 4],
    [1 / 4, -1 / 4, -1 / 4],
    [-1 / 4, -1 / 4, 1 / 4],
    [1 / 4, 1 / 4, 1 / 4]
  ],
  faces: [[1, 2, 3], [0, 3, 2], [0, 1, 3], [0, 2, 1]],
  center: [0, 0, 0],
  edgeLength: Math.SQRT2 / 2
};

const EARTHBROT: TricomplexPlatonicSlice3Spec = {
  id: 'earthbrot',
  label: 'Earthbrot',
  basis: ['γ1γ3', 'γ̄1γ3', 'γ1γ̄3'],
  vertices: [
    [-2, -2, -2], [1 / 4, -2, -2], [1 / 4, 1 / 4, -2], [-2, 1 / 4, -2],
    [-2, -2, 1 / 4], [1 / 4, -2, 1 / 4], [1 / 4, 1 / 4, 1 / 4], [-2, 1 / 4, 1 / 4]
  ],
  faces: [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]],
  center: [-7 / 8, -7 / 8, -7 / 8],
  edgeLength: 9 / 4
};

const SPECS: Readonly<Record<TricomplexPlatonicSlice3Id, TricomplexPlatonicSlice3Spec>> = {
  airbrot: AIRBROT,
  firebrot: FIREBROT,
  earthbrot: EARTHBROT
};

function readPoint3(point: ArrayLike<number>, label: string): Point3 {
  if (point.length !== 3) throw new Error(`${label}: expected a 3D point, got ${point.length}D`);
  const out: Point3 = [point[0]!, point[1]!, point[2]!];
  if (out.some((coordinate) => !Number.isFinite(coordinate))) {
    throw new Error(`${label}: coordinates must be finite`);
  }
  return out;
}

/** Exact theorem data for the three Platonic tricomplex Mandelbrot slices. */
export function tricomplexPlatonicSlice3(
  id: TricomplexPlatonicSlice3Id
): TricomplexPlatonicSlice3Spec {
  return SPECS[id];
}

/**
 * The real idempotent parameters whose independent quadratic orbits decide
 * membership in the selected tricomplex Mandelbrot slice.
 */
export function tricomplexMandelbrotComponents3(
  id: TricomplexPlatonicSlice3Id,
  point: ArrayLike<number>
): readonly [number, number, number, number] {
  const [x, y, z] = readPoint3(point, 'tricomplexMandelbrotComponents3');
  if (id === 'airbrot') {
    return [x + y - z, x - y + z, x + y + z, x - y - z];
  }
  if (id === 'firebrot') {
    return [x - y + z, -x + y + z, x + y - z, -x - y - z];
  }
  return [x, y, z, 0];
}

/**
 * Exact half-space value for the proven Platonic shape. It is a membership
 * function, not a Euclidean distance outside edges and vertices.
 */
export function tricomplexPlatonicValue3(
  id: TricomplexPlatonicSlice3Id,
  point: ArrayLike<number>
): number {
  const [x, y, z] = readPoint3(point, 'tricomplexPlatonicValue3');
  if (id === 'airbrot') {
    return Math.abs(x - REAL_MANDELBROT_CENTER) + Math.abs(y) + Math.abs(z)
      - REAL_MANDELBROT_RADIUS;
  }
  if (id === 'firebrot') {
    return Math.max(x - y + z, -x + y + z, x + y - z, -x - y - z)
      - REAL_MANDELBROT_MAXIMUM;
  }
  return Math.max(
    Math.abs(x - REAL_MANDELBROT_CENTER),
    Math.abs(y - REAL_MANDELBROT_CENTER),
    Math.abs(z - REAL_MANDELBROT_CENTER)
  ) - REAL_MANDELBROT_RADIUS;
}

export function containsTricomplexPlatonicSlice3(
  id: TricomplexPlatonicSlice3Id,
  point: ArrayLike<number>,
  epsilon = 0
): boolean {
  if (!Number.isFinite(epsilon) || epsilon < 0) {
    throw new Error('containsTricomplexPlatonicSlice3: epsilon must be finite and non-negative');
  }
  return tricomplexPlatonicValue3(id, point) <= epsilon;
}

function evaluateRealMandelbrotParameter(
  parameter: number,
  options: Required<QuadraticIterationOptions>
): RealMandelbrotParameterEvaluation {
  let value = 0;
  let iterations = 0;
  const escapeSquared = options.escapeRadius * options.escapeRadius;
  while (iterations < options.maxIterations && value * value <= escapeSquared) {
    value = value * value + parameter;
    iterations++;
  }
  const magnitude = Math.abs(value);
  return { parameter, escaped: magnitude * magnitude > escapeSquared, iterations, finalValue: value, magnitude };
}

/** Independent real-orbit realization of the tricomplex Mandelbrot theorem. */
export function evaluateTricomplexMandelbrotSlice3(
  id: TricomplexPlatonicSlice3Id,
  point: ArrayLike<number>,
  { maxIterations = 64, escapeRadius = 2 }: QuadraticIterationOptions = {}
): TricomplexMandelbrotSliceEvaluation3 {
  const options = resolveQuadraticOptions({ maxIterations, escapeRadius });
  const factorParameters = tricomplexMandelbrotComponents3(id, point);
  const factors = factorParameters.map((parameter) =>
    evaluateRealMandelbrotParameter(parameter, options)
  ) as unknown as TricomplexMandelbrotSliceEvaluation3['factors'];
  const escaped = factors.some((factor) => factor.escaped);
  const iterations = escaped
    ? Math.min(...factors.filter((factor) => factor.escaped).map((factor) => factor.iterations))
    : options.maxIterations;
  return {
    id,
    analyticValue: tricomplexPlatonicValue3(id, point),
    analyticallyBounded: factorParameters.every(
      (parameter) => parameter >= REAL_MANDELBROT_MINIMUM && parameter <= REAL_MANDELBROT_MAXIMUM
    ),
    escaped,
    iterations,
    factorParameters,
    factors
  };
}
