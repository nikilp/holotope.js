import { VecN } from '../math/vecn.js';
import { TransformN } from '../math/transform.js';
import type { HomogeneousProjection } from '../projection/types.js';
import {
  inspectSourceCellReferenceN,
  type SourceCellReferenceN
} from './source-reference.js';

/**
 * An oriented coordinate on one current source 1-cell.
 *
 * `parameter = 0` names the reference's first vertex and `parameter = 1`
 * names its second. The coordinate retains topology identity rather than a
 * snapshot of the endpoint positions, so evaluation follows later geometry
 * edits while the source-cell reference remains current.
 */
export interface SourceEdgeCoordinateN {
  readonly kind: 'source-edge-coordinate';
  readonly reference: SourceCellReferenceN;
  readonly parameter: number;
}

export interface SourceEdgeProjectionN {
  readonly coordinate: SourceEdgeCoordinateN;
  readonly point: VecN;
  /** Squared Euclidean distance from the query point to the closed segment. */
  readonly squaredDistance: number;
  /** Parameter on the supporting line before clamping to the source segment. */
  readonly unclampedParameter: number;
}

export interface SourceEdgeCoordinateOptions {
  /** Clamp finite parameters to the closed source segment. Default `true`. */
  readonly clamp?: boolean;
}

export interface SourceEdgeProjectionFitOptions {
  /** Source-local to ambient transform applied before projection. */
  readonly transform?: TransformN;
  /** Scale-relative exact-target and degeneracy tolerance. Default `1e-9`. */
  readonly tolerance?: number;
}

export type SourceEdgeProjectionFitFailureReason =
  | 'invalid-projection-vertex'
  | 'invalid-homogeneous-denominator'
  | 'degenerate-projected-edge'
  | 'singular-source-weights';

export interface AvailableSourceEdgeProjectionFitN {
  /** Exact when the target lies on the projected segment; least-squares otherwise. */
  readonly kind: 'exact' | 'least-squares';
  readonly coordinate: SourceEdgeCoordinateN;
  /** Evaluated source-local point on the current edge. */
  readonly point: VecN;
  /** Source point after the optional ambient transform. */
  readonly ambientPoint: VecN;
  readonly targetPoint: readonly [number, number, number];
  /** Closest point on the projected source segment. */
  readonly representationPoint: readonly [number, number, number];
  /** Affine parameter on the rendered segment before perspective correction. */
  readonly representationParameter: number;
  /** Supporting-line parameter before clamping to the rendered segment. */
  readonly unclampedRepresentationParameter: number;
  readonly endpointClamped: boolean;
  /** Distance from the requested representation point to the realized one. */
  readonly representationResidual: number;
  /** Forward projection error of the recovered source coordinate. */
  readonly roundTripResidual: number;
  readonly minAbsQ: number;
}

export interface UnavailableSourceEdgeProjectionFitN {
  readonly kind: 'unavailable';
  readonly reason: SourceEdgeProjectionFitFailureReason;
  readonly details: Readonly<Record<string, number | boolean>>;
}

export type SourceEdgeProjectionFitN =
  | AvailableSourceEdgeProjectionFitN
  | UnavailableSourceEdgeProjectionFitN;

/** Create a validated, oriented coordinate on a current source edge. */
export function createSourceEdgeCoordinateN(
  reference: SourceCellReferenceN,
  parameter: number,
  options: SourceEdgeCoordinateOptions = {}
): SourceEdgeCoordinateN {
  requireCurrentEdge(reference, 'createSourceEdgeCoordinateN');
  if (!Number.isFinite(parameter)) {
    throw new Error('createSourceEdgeCoordinateN: parameter must be finite');
  }
  const clamp = options.clamp ?? true;
  if (!clamp && (parameter < 0 || parameter > 1)) {
    throw new Error(
      `createSourceEdgeCoordinateN: parameter ${parameter} lies outside [0, 1]`
    );
  }
  return {
    kind: 'source-edge-coordinate',
    reference,
    parameter: clamp ? Math.max(0, Math.min(1, parameter)) : parameter
  };
}

/** Evaluate a source-edge coordinate against the edge's current positions. */
export function evaluateSourceEdgeCoordinateN(
  coordinate: SourceEdgeCoordinateN
): VecN {
  const reference = coordinate.reference;
  requireCurrentEdge(reference, 'evaluateSourceEdgeCoordinateN');
  const { complex } = reference;
  const [from, to] = reference.vertexIndices;
  const point = new Float64Array(complex.ambientDim);
  for (let axis = 0; axis < complex.ambientDim; axis++) {
    const a = complex.positions[from! * complex.ambientDim + axis]!;
    const b = complex.positions[to! * complex.ambientDim + axis]!;
    point[axis] = a + coordinate.parameter * (b - a);
  }
  return new VecN(point);
}

/**
 * Project an ambient point onto the closed source segment in Float64.
 *
 * This is an explicit interaction policy, not an inverse projection: the
 * caller has already selected the source edge whose one-dimensional freedom
 * resolves the otherwise underdetermined representation-space edit.
 */
export function projectPointToSourceEdgeN(
  reference: SourceCellReferenceN,
  point: ArrayLike<number>
): SourceEdgeProjectionN {
  requireCurrentEdge(reference, 'projectPointToSourceEdgeN');
  const { complex } = reference;
  if (point.length !== complex.ambientDim) {
    throw new Error(
      `projectPointToSourceEdgeN: point dimension ${point.length} does not match R${complex.ambientDim}`
    );
  }
  const [from, to] = reference.vertexIndices;
  let directionSquared = 0;
  let along = 0;
  for (let axis = 0; axis < complex.ambientDim; axis++) {
    const a = complex.positions[from! * complex.ambientDim + axis]!;
    const direction = complex.positions[to! * complex.ambientDim + axis]! - a;
    directionSquared += direction * direction;
    along += (point[axis]! - a) * direction;
  }
  if (!(directionSquared > 0) || !Number.isFinite(directionSquared)) {
    throw new Error('projectPointToSourceEdgeN: source edge is geometrically degenerate');
  }
  const unclampedParameter = along / directionSquared;
  const coordinate = createSourceEdgeCoordinateN(reference, unclampedParameter);
  const projected = evaluateSourceEdgeCoordinateN(coordinate);
  let squaredDistance = 0;
  for (let axis = 0; axis < complex.ambientDim; axis++) {
    const delta = point[axis]! - projected.data[axis]!;
    squaredDistance += delta * delta;
  }
  return {
    coordinate,
    point: projected,
    squaredDistance,
    unclampedParameter
  };
}

/**
 * Fit a representation-space target to one explicitly selected source edge.
 *
 * The homogeneous image of an N-D line is a line in R3. The target is first
 * projected onto that rendered segment in ordinary R3; its affine segment
 * parameter is then converted to the perspective-correct source parameter.
 * An exact result means the requested target was already on the segment.
 * Otherwise the result is an explicitly labelled least-squares policy.
 */
export function fitSourceEdgeCoordinateToProjectionN(
  reference: SourceCellReferenceN,
  projection: HomogeneousProjection,
  targetPoint: ArrayLike<number>,
  options: SourceEdgeProjectionFitOptions = {}
): SourceEdgeProjectionFitN {
  requireCurrentEdge(reference, 'fitSourceEdgeCoordinateToProjectionN');
  const { complex } = reference;
  if (projection.fromDim !== complex.ambientDim) {
    throw new Error(
      `fitSourceEdgeCoordinateToProjectionN: projection expects R${projection.fromDim}, source edge is in R${complex.ambientDim}`
    );
  }
  if (targetPoint.length !== 3) {
    throw new Error(
      `fitSourceEdgeCoordinateToProjectionN: targetPoint must contain 3 coordinates, got ${targetPoint.length}`
    );
  }
  for (let coordinate = 0; coordinate < 3; coordinate++) {
    if (!Number.isFinite(targetPoint[coordinate])) {
      throw new Error('fitSourceEdgeCoordinateToProjectionN: targetPoint must be finite');
    }
  }
  const tolerance = options.tolerance ?? 1e-9;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    throw new Error(
      'fitSourceEdgeCoordinateToProjectionN: tolerance must be finite and positive'
    );
  }
  const transform = options.transform ?? TransformN.identity(complex.ambientDim);
  if (transform.dim !== complex.ambientDim) {
    throw new Error(
      `fitSourceEdgeCoordinateToProjectionN: transform is R${transform.dim}, source edge is in R${complex.ambientDim}`
    );
  }

  const [from, to] = reference.vertexIndices;
  const sourcePoints = [
    new VecN(complex.getPosition(from!)),
    new VecN(complex.getPosition(to!))
  ] as const;
  const ambientPoints = [
    transform.applyToPoint(sourcePoints[0]),
    transform.applyToPoint(sourcePoints[1])
  ] as const;
  const homogeneous = ambientPoints.map((point) =>
    projection.projectHomogeneousPoint(point.data)
  );
  for (let vertex = 0; vertex < 2; vertex++) {
    if (!homogeneous[vertex]!.validity.valid) {
      return unavailableProjectionFit('invalid-projection-vertex', { vertex });
    }
  }

  const projected: [[number, number, number], [number, number, number]] = [
    [0, 0, 0],
    [0, 0, 0]
  ];
  let minAbsQ = Number.POSITIVE_INFINITY;
  for (let vertex = 0; vertex < 2; vertex++) {
    const coordinates = homogeneous[vertex]!.coordinates;
    const q = coordinates[3];
    let homogeneousScale = 0;
    for (let coordinate = 0; coordinate < 4; coordinate++) {
      homogeneousScale = Math.max(homogeneousScale, Math.abs(coordinates[coordinate]!));
    }
    if (Math.abs(q) <= tolerance * Math.max(homogeneousScale, Number.MIN_VALUE)) {
      return unavailableProjectionFit('invalid-homogeneous-denominator', {
        vertex,
        q,
        homogeneousScale
      });
    }
    minAbsQ = Math.min(minAbsQ, Math.abs(q));
    for (let coordinate = 0; coordinate < 3; coordinate++) {
      projected[vertex]![coordinate] = coordinates[coordinate]! / q;
    }
  }

  const direction: [number, number, number] = [
    projected[1][0] - projected[0][0],
    projected[1][1] - projected[0][1],
    projected[1][2] - projected[0][2]
  ];
  const directionSquared =
    direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2;
  const scale = Math.max(
    1,
    Math.abs(targetPoint[0]!),
    Math.abs(targetPoint[1]!),
    Math.abs(targetPoint[2]!),
    ...projected.flatMap((point) => point.map(Math.abs))
  );
  if (directionSquared <= (tolerance * scale) ** 2) {
    return unavailableProjectionFit('degenerate-projected-edge', {
      directionSquared,
      allowedSquaredLength: (tolerance * scale) ** 2
    });
  }
  const fromTarget: [number, number, number] = [
    targetPoint[0]! - projected[0][0],
    targetPoint[1]! - projected[0][1],
    targetPoint[2]! - projected[0][2]
  ];
  const unclampedRepresentationParameter = (
    fromTarget[0] * direction[0] +
    fromTarget[1] * direction[1] +
    fromTarget[2] * direction[2]
  ) / directionSquared;
  const representationParameter = Math.max(
    0,
    Math.min(1, unclampedRepresentationParameter)
  );
  const representationPoint: [number, number, number] = [
    projected[0][0] + representationParameter * direction[0],
    projected[0][1] + representationParameter * direction[1],
    projected[0][2] + representationParameter * direction[2]
  ];
  const representationResidual = Math.hypot(
    targetPoint[0]! - representationPoint[0],
    targetPoint[1]! - representationPoint[1],
    targetPoint[2]! - representationPoint[2]
  );

  const q0 = homogeneous[0]!.coordinates[3];
  const q1 = homogeneous[1]!.coordinates[3];
  const weight0 = (1 - representationParameter) / q0;
  const weight1 = representationParameter / q1;
  const sourceWeightSum = weight0 + weight1;
  const sourceWeightMagnitude = Math.abs(weight0) + Math.abs(weight1);
  if (Math.abs(sourceWeightSum) <= tolerance * sourceWeightMagnitude) {
    return unavailableProjectionFit('singular-source-weights', {
      sourceWeightSum,
      sourceWeightMagnitude
    });
  }
  const sourceParameter = weight1 / sourceWeightSum;
  const coordinate = createSourceEdgeCoordinateN(reference, sourceParameter);
  const point = evaluateSourceEdgeCoordinateN(coordinate);
  const ambientPoint = transform.applyToPoint(point);
  const roundTrip = projection.projectHomogeneousPoint(ambientPoint.data).coordinates;
  const roundTripPoint: [number, number, number] = [
    roundTrip[0] / roundTrip[3],
    roundTrip[1] / roundTrip[3],
    roundTrip[2] / roundTrip[3]
  ];
  const roundTripResidual = Math.hypot(
    roundTripPoint[0] - representationPoint[0],
    roundTripPoint[1] - representationPoint[1],
    roundTripPoint[2] - representationPoint[2]
  );
  return {
    kind: representationResidual <= tolerance * scale ? 'exact' : 'least-squares',
    coordinate,
    point,
    ambientPoint,
    targetPoint: [targetPoint[0]!, targetPoint[1]!, targetPoint[2]!],
    representationPoint,
    representationParameter,
    unclampedRepresentationParameter,
    endpointClamped:
      unclampedRepresentationParameter < 0 ||
      unclampedRepresentationParameter > 1,
    representationResidual,
    roundTripResidual,
    minAbsQ
  };
}

function unavailableProjectionFit(
  reason: SourceEdgeProjectionFitFailureReason,
  details: Readonly<Record<string, number | boolean>>
): UnavailableSourceEdgeProjectionFitN {
  return { kind: 'unavailable', reason, details };
}

function requireCurrentEdge(reference: SourceCellReferenceN, caller: string): void {
  if (
    reference.intrinsicDim !== 1 ||
    reference.vertexIndices.length !== 2
  ) {
    throw new Error(`${caller}: source reference must name a 1-cell with two vertices`);
  }
  const status = inspectSourceCellReferenceN(reference);
  if (status.kind === 'retired') {
    throw new Error(`${caller}: source edge reference is retired (${status.reason})`);
  }
}
