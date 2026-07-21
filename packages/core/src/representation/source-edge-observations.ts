import { TransformN } from '../math/transform.js';
import type { VecN } from '../math/vecn.js';
import type { HomogeneousProjection } from '../projection/types.js';
import {
  type CoordinateConstraintConsistency,
  type CoordinateConstraintDetermination
} from './coordinate-constraints.js';
import {
  createLinearCoordinateConstraintSystemN,
  solveLinearCoordinateConstraintSystemN,
  withLinearCoordinateConstraintBlockN
} from './coordinate-constraint-system.js';
import {
  createSourceEdgeCoordinateN,
  evaluateSourceEdgeCoordinateN,
  fitSourceEdgeCoordinateToProjectionN,
  type AvailableSourceEdgeProjectionFitN,
  type SourceEdgeCoordinateN,
  type SourceEdgeProjectionFitFailureReason
} from './source-edge-coordinate.js';
import type { SourceCellReferenceN } from './source-reference.js';

export interface SourceEdgeProjectionObservationN {
  /** Optional stable identity for incremental observation composition. */
  readonly key?: string;
  readonly projection: HomogeneousProjection;
  readonly targetPoint: readonly [number, number, number];
  /** Positive influence in the source-parameter least-squares objective. */
  readonly weight?: number;
  /** Optional caller-owned diagnostic label. */
  readonly label?: string;
}

export interface SourceEdgeObservationFitOptions {
  /** One source-local to ambient transform shared by every observation. */
  readonly transform?: TransformN;
  /** Scale-relative representation and parameter tolerance. Default `1e-9`. */
  readonly tolerance?: number;
  /** Relative singular-value rank tolerance. Default `1e-10`. */
  readonly rankTolerance?: number;
}

export interface SourceEdgeObservationDiagnosticN {
  readonly key: string;
  readonly label?: string;
  readonly weight: number;
  readonly targetPoint: readonly [number, number, number];
  /** Closest independently inferred edge parameter for this observation. */
  readonly observedParameter: number;
  /** Consensus minus independently inferred source parameter. */
  readonly parameterResidual: number;
  /** Projection of the reconciled source coordinate in this view. */
  readonly representationPoint: readonly [number, number, number];
  readonly representationResidual: number;
  /** The complete independently fitted observation for audit. */
  readonly independentFit: AvailableSourceEdgeProjectionFitN;
}

export interface AvailableSourceEdgeObservationFitN {
  /** Exact only when every target is exact and all infer the same parameter. */
  readonly kind: 'exact' | 'least-squares';
  /** Whether the independently inferred source parameters agree. */
  readonly consistency: CoordinateConstraintConsistency;
  readonly determination: CoordinateConstraintDetermination;
  readonly coordinate: SourceEdgeCoordinateN;
  readonly point: VecN;
  readonly ambientPoint: VecN;
  readonly observations: readonly SourceEdgeObservationDiagnosticN[];
  readonly totalWeight: number;
  readonly sourceDegreesOfFreedom: 1;
  readonly observationRank: number;
  readonly unresolvedDegreesOfFreedom: number;
  readonly rankConditioning: number;
  readonly constraintNormalResidual: number;
  readonly sourceParameterSpread: number;
  readonly parameterRmsResidual: number;
  readonly representationRmsResidual: number;
  readonly maxRepresentationResidual: number;
}

export interface UnavailableSourceEdgeObservationFitN {
  readonly kind: 'unavailable';
  readonly reason: 'no-observations' | 'observation-unavailable';
  readonly observationIndex?: number;
  readonly observationReason?: SourceEdgeProjectionFitFailureReason;
}

export type SourceEdgeObservationFitN =
  | AvailableSourceEdgeObservationFitN
  | UnavailableSourceEdgeObservationFitN;

/**
 * Reconcile several R3 observations of one explicitly named source edge.
 *
 * Each observation first performs the auditable homogeneous single-view fit.
 * Those fits produce estimates of the same dimensionless source parameter
 * `t`. The returned coordinate minimizes
 *
 *     sum(weight[i] * (t - observedT[i])^2)
 *
 * on the closed source segment. This is deliberately a source-coordinate
 * consensus policy, not a claimed inverse of the projections and not an
 * unlabelled mixture of representation-space units.
 */
export function fitSourceEdgeCoordinateToObservationsN(
  reference: SourceCellReferenceN,
  observations: readonly SourceEdgeProjectionObservationN[],
  options: SourceEdgeObservationFitOptions = {}
): SourceEdgeObservationFitN {
  if (observations.length === 0) {
    return { kind: 'unavailable', reason: 'no-observations' };
  }
  const tolerance = options.tolerance ?? 1e-9;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    throw new Error(
      'fitSourceEdgeCoordinateToObservationsN: tolerance must be finite and positive'
    );
  }
  const rankTolerance = options.rankTolerance ?? 1e-10;
  if (!Number.isFinite(rankTolerance) || rankTolerance <= 0) {
    throw new Error(
      'fitSourceEdgeCoordinateToObservationsN: rankTolerance must be finite and positive'
    );
  }

  const independentFits: AvailableSourceEdgeProjectionFitN[] = [];
  const weights: number[] = [];
  let totalWeight = 0;
  let minimumParameter = Number.POSITIVE_INFINITY;
  let maximumParameter = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < observations.length; index++) {
    const observation = observations[index]!;
    const weight = observation.weight ?? 1;
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error(
        `fitSourceEdgeCoordinateToObservationsN: observation ${index} weight must be finite and positive`
      );
    }
    const fit = fitSourceEdgeCoordinateToProjectionN(
      reference,
      observation.projection,
      observation.targetPoint,
      {
        ...(options.transform === undefined ? {} : { transform: options.transform }),
        tolerance
      }
    );
    if (fit.kind === 'unavailable') {
      return {
        kind: 'unavailable',
        reason: 'observation-unavailable',
        observationIndex: index,
        observationReason: fit.reason
      };
    }
    independentFits.push(fit);
    weights.push(weight);
    totalWeight += weight;
    minimumParameter = Math.min(minimumParameter, fit.coordinate.parameter);
    maximumParameter = Math.max(maximumParameter, fit.coordinate.parameter);
  }

  let constraintSystem = createLinearCoordinateConstraintSystemN(1);
  for (let index = 0; index < independentFits.length; index++) {
    const fit = independentFits[index]!;
    const observation = observations[index]!;
    constraintSystem = withLinearCoordinateConstraintBlockN(
      constraintSystem,
      observation.key ?? `observation:${index}`,
      {
        coefficients: [1],
        targets: [fit.coordinate.parameter],
        rowCount: 1,
        weight: weights[index]!,
        ...(observation.label === undefined ? {} : { label: observation.label })
      }
    );
  }
  const constraints = solveLinearCoordinateConstraintSystemN(
    constraintSystem,
    { tolerance, rankTolerance }
  );
  const parameter = constraints.solution[0]!;
  const coordinate = createSourceEdgeCoordinateN(reference, parameter);
  const point = evaluateSourceEdgeCoordinateN(coordinate);
  const transform = options.transform ?? TransformN.identity(point.dim);
  const ambientPoint = transform.applyToPoint(point);
  const diagnostics: SourceEdgeObservationDiagnosticN[] = [];
  let weightedParameterResidualSquared = 0;
  let weightedRepresentationResidualSquared = 0;
  let maxRepresentationResidual = 0;

  for (let index = 0; index < observations.length; index++) {
    const observation = observations[index]!;
    const independentFit = independentFits[index]!;
    const weight = weights[index]!;
    const homogeneous = observation.projection.projectHomogeneousPoint(
      ambientPoint.data
    );
    const q = homogeneous.coordinates[3];
    const representationPoint: [number, number, number] = [
      homogeneous.coordinates[0] / q,
      homogeneous.coordinates[1] / q,
      homogeneous.coordinates[2] / q
    ];
    const representationResidual = Math.hypot(
      representationPoint[0] - observation.targetPoint[0],
      representationPoint[1] - observation.targetPoint[1],
      representationPoint[2] - observation.targetPoint[2]
    );
    const parameterResidual = parameter - independentFit.coordinate.parameter;
    weightedParameterResidualSquared += weight * parameterResidual ** 2;
    weightedRepresentationResidualSquared += weight * representationResidual ** 2;
    maxRepresentationResidual = Math.max(
      maxRepresentationResidual,
      representationResidual
    );
    diagnostics.push({
      key: observation.key ?? `observation:${index}`,
      ...(observation.label === undefined ? {} : { label: observation.label }),
      weight,
      targetPoint: independentFit.targetPoint,
      observedParameter: independentFit.coordinate.parameter,
      parameterResidual,
      representationPoint,
      representationResidual,
      independentFit
    });
  }

  const sourceParameterSpread = maximumParameter - minimumParameter;
  const consistency = constraints.consistency;
  const kind = consistency === 'compatible' &&
    independentFits.every((fit) => fit.kind === 'exact')
    ? 'exact'
    : 'least-squares';

  return {
    kind,
    consistency,
    determination: constraints.determination,
    coordinate,
    point,
    ambientPoint,
    observations: diagnostics,
    totalWeight,
    sourceDegreesOfFreedom: 1,
    observationRank: constraints.rank,
    unresolvedDegreesOfFreedom: constraints.unresolvedDegreesOfFreedom,
    rankConditioning: constraints.rankConditioning,
    constraintNormalResidual: constraints.normalResidual,
    sourceParameterSpread,
    parameterRmsResidual: Math.sqrt(
      weightedParameterResidualSquared / totalWeight
    ),
    representationRmsResidual: Math.sqrt(
      weightedRepresentationResidualSquared / totalWeight
    ),
    maxRepresentationResidual
  };
}
