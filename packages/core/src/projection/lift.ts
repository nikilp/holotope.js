import { VecN } from '../math/vecn.js';

/** One source-simplex vertex and its valid or invalid homogeneous image. */
export interface HomogeneousSimplexVertexN {
  readonly sourcePoint: VecN;
  readonly coordinates: ArrayLike<number>;
  readonly valid: boolean;
}

export interface HomogeneousSimplexLiftOptions {
  /** Scale-relative geometric and barycentric tolerance. Default `1e-9`. */
  readonly tolerance?: number;
}

export type HomogeneousSimplexLiftFailureReason =
  | 'unsupported-projection'
  | 'invalid-projection-vertex'
  | 'invalid-homogeneous-denominator'
  | 'degenerate-simplex'
  | 'point-off-simplex'
  | 'point-outside-simplex'
  | 'singular-source-weights';

export interface ExactHomogeneousSimplexLiftN {
  readonly kind: 'exact';
  readonly point: VecN;
  /** Affine weights in the rendered segment or triangle. */
  readonly representationWeights: Float64Array;
  /** Perspective-correct affine weights in the source simplex. */
  readonly sourceWeights: Float64Array;
  readonly minAbsQ: number;
  /** One for a segment; normalized Gram determinant in `[0,1]` for a triangle. */
  readonly simplexConditioning: number;
  readonly representationResidual: number;
}

export interface UnavailableHomogeneousSimplexLiftN {
  readonly kind: 'unavailable';
  readonly reason: HomogeneousSimplexLiftFailureReason;
  readonly details: Readonly<Record<string, number | boolean>>;
}

export type HomogeneousSimplexLiftN =
  | ExactHomogeneousSimplexLiftN
  | UnavailableHomogeneousSimplexLiftN;

/**
 * Lifts a point on a rendered segment or triangle through a homogeneous map.
 *
 * The representation-space affine weights `lambda_i` become source weights
 * `mu_i = (lambda_i / q_i) / sum_j(lambda_j / q_j)`. A result is exact only
 * when every vertex is inside the projection domain, the representation
 * simplex is nondegenerate, and the supplied point lies on that simplex.
 */
export function liftHomogeneousSimplexPointN(
  vertices: readonly HomogeneousSimplexVertexN[],
  point3: ArrayLike<number>,
  options: HomogeneousSimplexLiftOptions = {}
): HomogeneousSimplexLiftN {
  if (vertices.length !== 2 && vertices.length !== 3) {
    throw new Error(
      `liftHomogeneousSimplexPointN: expected 2 or 3 vertices, got ${vertices.length}`
    );
  }
  assertFiniteTuple(point3, 3, 'point3');
  const tolerance = options.tolerance ?? 1e-9;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    throw new Error(
      'liftHomogeneousSimplexPointN: tolerance must be finite and positive'
    );
  }

  const ambientDim = vertices[0]!.sourcePoint.dim;
  const projected: [number, number, number][] = [];
  let minAbsQ = Number.POSITIVE_INFINITY;
  for (let vertex = 0; vertex < vertices.length; vertex++) {
    const sample = vertices[vertex]!;
    if (sample.sourcePoint.dim !== ambientDim) {
      throw new Error(
        'liftHomogeneousSimplexPointN: source vertices must have equal dimension'
      );
    }
    assertFiniteVector(sample.sourcePoint, `sourcePoint[${vertex}]`);
    assertFiniteTuple(sample.coordinates, 4, `coordinates[${vertex}]`);
    if (!sample.valid) {
      return unavailable('invalid-projection-vertex', { vertex });
    }
    const q = sample.coordinates[3]!;
    minAbsQ = Math.min(minAbsQ, Math.abs(q));
    let homogeneousScale = 0;
    for (let coordinate = 0; coordinate < 4; coordinate++) {
      homogeneousScale = Math.max(
        homogeneousScale,
        Math.abs(sample.coordinates[coordinate]!)
      );
    }
    if (Math.abs(q) <= tolerance * Math.max(homogeneousScale, Number.MIN_VALUE)) {
      return unavailable('invalid-homogeneous-denominator', {
        vertex,
        q,
        homogeneousScale
      });
    }
    projected.push([
      sample.coordinates[0]! / q,
      sample.coordinates[1]! / q,
      sample.coordinates[2]! / q
    ]);
  }

  let scale = 1;
  for (const point of [...projected, [point3[0]!, point3[1]!, point3[2]!] as [number, number, number]]) {
    scale = Math.max(scale, Math.abs(point[0]), Math.abs(point[1]), Math.abs(point[2]));
  }
  const distanceTolerance = tolerance * scale;
  let representationWeights: Float64Array;
  let simplexConditioning: number;

  if (vertices.length === 2) {
    const edge = subtract3(projected[1]!, projected[0]!);
    const lengthSquared = dot3(edge, edge);
    if (lengthSquared <= distanceTolerance * distanceTolerance) {
      return unavailable('degenerate-simplex', { lengthSquared });
    }
    const fromStart = subtract3(point3, projected[0]!);
    const parameter = dot3(fromStart, edge) / lengthSquared;
    representationWeights = Float64Array.of(1 - parameter, parameter);
    simplexConditioning = 1;
  } else {
    const edge0 = subtract3(projected[1]!, projected[0]!);
    const edge1 = subtract3(projected[2]!, projected[0]!);
    const fromStart = subtract3(point3, projected[0]!);
    const d00 = dot3(edge0, edge0);
    const d01 = dot3(edge0, edge1);
    const d11 = dot3(edge1, edge1);
    const denominator = d00 * d11 - d01 * d01;
    const scaleSquared = Math.max(d00 * d11, Number.MIN_VALUE);
    simplexConditioning = Math.max(0, denominator / scaleSquared);
    if (
      d00 <= distanceTolerance * distanceTolerance ||
      d11 <= distanceTolerance * distanceTolerance ||
      simplexConditioning <= tolerance * tolerance
    ) {
      return unavailable('degenerate-simplex', {
        gramDeterminant: denominator,
        simplexConditioning
      });
    }
    const d20 = dot3(fromStart, edge0);
    const d21 = dot3(fromStart, edge1);
    const weight1 = (d11 * d20 - d01 * d21) / denominator;
    const weight2 = (d00 * d21 - d01 * d20) / denominator;
    representationWeights = Float64Array.of(
      1 - weight1 - weight2,
      weight1,
      weight2
    );
  }

  const reconstructed = interpolateProjected(projected, representationWeights);
  const representationResidual = Math.hypot(
    reconstructed[0] - point3[0]!,
    reconstructed[1] - point3[1]!,
    reconstructed[2] - point3[2]!
  );
  if (representationResidual > distanceTolerance) {
    return unavailable('point-off-simplex', {
      representationResidual,
      allowedResidual: distanceTolerance,
      simplexConditioning
    });
  }
  for (let vertex = 0; vertex < representationWeights.length; vertex++) {
    const weight = representationWeights[vertex]!;
    if (weight < -tolerance || weight > 1 + tolerance) {
      return unavailable('point-outside-simplex', { vertex, weight });
    }
  }

  const sourceWeights = new Float64Array(vertices.length);
  let sourceWeightSum = 0;
  let sourceWeightMagnitude = 0;
  for (let vertex = 0; vertex < vertices.length; vertex++) {
    const weight = representationWeights[vertex]! / vertices[vertex]!.coordinates[3]!;
    sourceWeights[vertex] = weight;
    sourceWeightSum += weight;
    sourceWeightMagnitude += Math.abs(weight);
  }
  if (Math.abs(sourceWeightSum) <= tolerance * sourceWeightMagnitude) {
    return unavailable('singular-source-weights', {
      sourceWeightSum,
      sourceWeightMagnitude
    });
  }
  const point = new VecN(ambientDim);
  for (let vertex = 0; vertex < vertices.length; vertex++) {
    sourceWeights[vertex]! /= sourceWeightSum;
    const source = vertices[vertex]!.sourcePoint.data;
    for (let coordinate = 0; coordinate < ambientDim; coordinate++) {
      point.data[coordinate]! += sourceWeights[vertex]! * source[coordinate]!;
    }
  }
  return {
    kind: 'exact',
    point,
    representationWeights,
    sourceWeights,
    minAbsQ,
    simplexConditioning,
    representationResidual
  };
}

function unavailable(
  reason: HomogeneousSimplexLiftFailureReason,
  details: Readonly<Record<string, number | boolean>>
): UnavailableHomogeneousSimplexLiftN {
  return { kind: 'unavailable', reason, details };
}

function assertFiniteTuple(
  values: ArrayLike<number>,
  length: number,
  name: string
): void {
  if (values.length !== length) {
    throw new Error(
      `liftHomogeneousSimplexPointN: ${name} must contain ${length} coordinates`
    );
  }
  for (let coordinate = 0; coordinate < length; coordinate++) {
    if (!Number.isFinite(values[coordinate])) {
      throw new Error(`liftHomogeneousSimplexPointN: ${name} must be finite`);
    }
  }
}

function assertFiniteVector(vector: VecN, name: string): void {
  for (const coordinate of vector.data) {
    if (!Number.isFinite(coordinate)) {
      throw new Error(`liftHomogeneousSimplexPointN: ${name} must be finite`);
    }
  }
}

function subtract3(
  left: ArrayLike<number>,
  right: ArrayLike<number>
): [number, number, number] {
  return [
    left[0]! - right[0]!,
    left[1]! - right[1]!,
    left[2]! - right[2]!
  ];
}

function dot3(left: ArrayLike<number>, right: ArrayLike<number>): number {
  return left[0]! * right[0]! + left[1]! * right[1]! + left[2]! * right[2]!;
}

function interpolateProjected(
  vertices: readonly [number, number, number][],
  weights: Float64Array
): [number, number, number] {
  const point: [number, number, number] = [0, 0, 0];
  for (let vertex = 0; vertex < vertices.length; vertex++) {
    for (let coordinate = 0; coordinate < 3; coordinate++) {
      point[coordinate]! += weights[vertex]! * vertices[vertex]![coordinate]!;
    }
  }
  return point;
}
