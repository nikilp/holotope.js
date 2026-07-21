import { TransformN } from '../math/transform.js';
import { VecN } from '../math/vecn.js';
import type { HomogeneousProjection } from '../projection/types.js';
import {
  solveLinearCoordinateConstraintsN,
  type CoordinateConstraintConsistency,
  type CoordinateConstraintDetermination
} from './coordinate-constraints.js';
import {
  createLinearCoordinateConstraintSystemN,
  withLinearCoordinateConstraintBlockN,
  type LinearCoordinateConstraintSystemN
} from './coordinate-constraint-system.js';
import {
  inspectSourceCellReferenceN,
  type SourceCellReferenceN,
  type SourceCellReferenceStatusN
} from './source-reference.js';

export interface SourceSimplexReferenceN {
  readonly kind: 'source-simplex-reference';
  /** Persistent source cell containing the authored vertex simplex. */
  readonly parent: SourceCellReferenceN;
  readonly complex: SourceCellReferenceN['complex'];
  readonly intrinsicDim: number;
  readonly vertexIndices: readonly number[];
}

export interface SourceSimplexCoordinateN {
  readonly kind: 'source-simplex-coordinate';
  readonly reference: SourceSimplexReferenceN;
  /** Ordered barycentric weights matching `reference.vertexIndices`. */
  readonly weights: readonly number[];
}

export interface SourceSimplexCoordinateOptions {
  /** Scale-relative barycentric validation tolerance. Default `1e-12`. */
  readonly tolerance?: number;
}

export interface SourceSimplexProjectionN {
  readonly coordinate: SourceSimplexCoordinateN;
  readonly point: VecN;
  readonly squaredDistance: number;
  readonly affineRank: number;
  readonly unresolvedDegreesOfFreedom: number;
  readonly candidateFaces: number;
}

export interface SourceSimplexProjectionObservationN {
  /** Optional stable identity for incremental observation composition. */
  readonly key?: string;
  readonly projection: HomogeneousProjection;
  readonly targetPoint: readonly [number, number, number];
  readonly weight?: number;
  readonly label?: string;
}

export interface SourceSimplexObservationFitOptions {
  readonly transform?: TransformN;
  /** Scale-relative forward and compatibility tolerance. Default `1e-9`. */
  readonly tolerance?: number;
  /** Relative/normalized singular-value rank tolerance. Default `1e-10`. */
  readonly rankTolerance?: number;
  /** Null-space preference. Default is the uniform simplex coordinate. */
  readonly prior?: SourceSimplexCoordinateN;
  /** Safety bound for the exact active-face enumeration. Default `262143`. */
  readonly maxCandidateFaces?: number;
}

export interface SourceSimplexObservationDiagnosticN {
  readonly key: string;
  readonly label?: string;
  readonly weight: number;
  readonly targetPoint: readonly [number, number, number];
  readonly representationPoint: readonly [number, number, number];
  readonly representationResidual: number;
  readonly homogeneousEquationRms: number;
  readonly individualRank: number;
  readonly minAbsQ: number;
}

export type SourceSimplexObservationFitFailureReason =
  | 'no-observations'
  | 'invalid-projection-vertex'
  | 'invalid-homogeneous-denominator'
  | 'too-many-simplex-faces'
  | 'no-feasible-coordinate'
  | 'invalid-reconciled-projection';

export interface AvailableSourceSimplexObservationFitN {
  readonly kind: 'exact' | 'least-squares';
  readonly consistency: CoordinateConstraintConsistency;
  readonly determination: CoordinateConstraintDetermination;
  readonly coordinate: SourceSimplexCoordinateN;
  readonly point: VecN;
  readonly ambientPoint: VecN;
  readonly observations: readonly SourceSimplexObservationDiagnosticN[];
  readonly sourceDegreesOfFreedom: number;
  readonly observationRank: number;
  readonly unresolvedDegreesOfFreedom: number;
  readonly rankConditioning: number;
  readonly constraintNormalResidual: number;
  readonly activeFaceDimension: number;
  readonly normalizedEquationRms: number;
  readonly representationRmsResidual: number;
  readonly maxRepresentationResidual: number;
  readonly candidateFaces: number;
}

export interface UnavailableSourceSimplexObservationFitN {
  readonly kind: 'unavailable';
  readonly reason: SourceSimplexObservationFitFailureReason;
  readonly details: Readonly<Record<string, number | boolean>>;
}

export type SourceSimplexObservationFitN =
  | AvailableSourceSimplexObservationFitN
  | UnavailableSourceSimplexObservationFitN;

interface RankReport {
  readonly rank: number;
  readonly conditioning: number;
  readonly threshold: number;
}

interface SimplexLeastSquaresSolution {
  readonly weights: Float64Array;
  readonly objective: number;
  readonly normalizedResidualRms: number;
  readonly normalResidual: number;
  readonly candidateFaces: number;
}

interface SimplexLeastSquaresUnavailable {
  readonly reason: 'too-many-simplex-faces' | 'no-feasible-coordinate';
  readonly details: Readonly<Record<string, number | boolean>>;
}

interface ConstraintObjective {
  readonly objective: number;
  readonly weightedRows: number;
}

/**
 * Create a persistent vertex-simplex inside a current source cell.
 *
 * `vertexIndices` may name the whole source simplex or an authored simplex
 * used to triangulate a non-simplex parent face. Lifecycle follows the parent
 * cell; changing its vertex tuple retires every derived simplex reference.
 */
export function createSourceSimplexReferenceN(
  parent: SourceCellReferenceN,
  vertexIndices: readonly number[] = parent.vertexIndices
): SourceSimplexReferenceN {
  requireCurrentCell(parent, 'createSourceSimplexReferenceN');
  if (vertexIndices.length < 2) {
    throw new Error(
      'createSourceSimplexReferenceN: a source simplex needs at least 2 vertices'
    );
  }
  if (vertexIndices.length > parent.complex.ambientDim + 1) {
    throw new Error(
      `createSourceSimplexReferenceN: ${vertexIndices.length} vertices cannot be affinely independent in R${parent.complex.ambientDim}`
    );
  }
  const parentVertices = new Set(parent.vertexIndices);
  const distinct = new Set<number>();
  for (const vertex of vertexIndices) {
    if (!Number.isSafeInteger(vertex) || !parentVertices.has(vertex)) {
      throw new Error(
        `createSourceSimplexReferenceN: vertex ${vertex} does not belong to the parent source cell`
      );
    }
    distinct.add(vertex);
  }
  if (distinct.size !== vertexIndices.length) {
    throw new Error('createSourceSimplexReferenceN: simplex vertices must be distinct');
  }
  return {
    kind: 'source-simplex-reference',
    parent,
    complex: parent.complex,
    intrinsicDim: vertexIndices.length - 1,
    vertexIndices: Object.freeze([...vertexIndices])
  };
}

export function inspectSourceSimplexReferenceN(
  reference: SourceSimplexReferenceN
): SourceCellReferenceStatusN {
  return inspectSourceCellReferenceN(reference.parent);
}

export function createSourceSimplexCoordinateN(
  reference: SourceSimplexReferenceN,
  weights: ArrayLike<number>,
  options: SourceSimplexCoordinateOptions = {}
): SourceSimplexCoordinateN {
  requireCurrentSimplex(reference, 'createSourceSimplexCoordinateN');
  if (weights.length !== reference.vertexIndices.length) {
    throw new Error(
      `createSourceSimplexCoordinateN: ${weights.length} weights for ${reference.vertexIndices.length} vertices`
    );
  }
  const tolerance = positiveTolerance(
    options.tolerance ?? 1e-12,
    'createSourceSimplexCoordinateN'
  );
  const normalized = new Array<number>(weights.length);
  let sum = 0;
  let magnitude = 0;
  for (let vertex = 0; vertex < weights.length; vertex++) {
    const weight = weights[vertex]!;
    if (!Number.isFinite(weight)) {
      throw new Error('createSourceSimplexCoordinateN: weights must be finite');
    }
    if (weight < -tolerance) {
      throw new Error(
        `createSourceSimplexCoordinateN: weight ${vertex} is outside the simplex (${weight})`
      );
    }
    normalized[vertex] = Math.max(0, weight);
    sum += weight;
    magnitude += Math.abs(weight);
  }
  if (Math.abs(sum - 1) > tolerance * Math.max(1, magnitude)) {
    throw new Error(
      `createSourceSimplexCoordinateN: weights must sum to one (got ${sum})`
    );
  }
  const clippedSum = normalized.reduce((total, weight) => total + weight, 0);
  for (let vertex = 0; vertex < normalized.length; vertex++) {
    normalized[vertex]! /= clippedSum;
  }
  return {
    kind: 'source-simplex-coordinate',
    reference,
    weights: Object.freeze(normalized)
  };
}

export function evaluateSourceSimplexCoordinateN(
  coordinate: SourceSimplexCoordinateN
): VecN {
  const { reference } = coordinate;
  requireCurrentSimplex(reference, 'evaluateSourceSimplexCoordinateN');
  const point = new VecN(reference.complex.ambientDim);
  for (let vertex = 0; vertex < reference.vertexIndices.length; vertex++) {
    const source = reference.complex.getPosition(reference.vertexIndices[vertex]!);
    const weight = coordinate.weights[vertex]!;
    for (let axis = 0; axis < point.dim; axis++) {
      point.data[axis]! += weight * source[axis]!;
    }
  }
  return point;
}

/** Closest Float64 point on the closed source simplex. */
export function projectPointToSourceSimplexN(
  reference: SourceSimplexReferenceN,
  point: ArrayLike<number>,
  options: SourceSimplexObservationFitOptions = {}
): SourceSimplexProjectionN {
  requireCurrentSimplex(reference, 'projectPointToSourceSimplexN');
  const ambientDim = reference.complex.ambientDim;
  assertFiniteTuple(point, ambientDim, 'projectPointToSourceSimplexN: point');
  const tolerance = positiveTolerance(
    options.tolerance ?? 1e-9,
    'projectPointToSourceSimplexN'
  );
  const rankTolerance = positiveTolerance(
    options.rankTolerance ?? 1e-10,
    'projectPointToSourceSimplexN: rankTolerance'
  );
  const prior = priorWeights(reference, options.prior);
  let scale = 0;
  const rows: Float64Array[] = [];
  for (let axis = 0; axis < ambientDim; axis++) {
    const row = new Float64Array(reference.vertexIndices.length);
    for (let vertex = 0; vertex < reference.vertexIndices.length; vertex++) {
      const value = reference.complex.positions[
        reference.vertexIndices[vertex]! * ambientDim + axis
      ]!;
      row[vertex] = value - point[axis]!;
      scale = Math.max(scale, Math.abs(value), Math.abs(point[axis]!));
    }
    rows.push(row);
  }
  const rowScale = scale > 0 ? scale : 1;
  const constraints = createLinearCoordinateConstraintSystemN(
    reference.vertexIndices.length,
    [{
      key: 'source-point',
      label: 'ambient source point',
      coefficients: flattenRows(rows),
      targets: new Float64Array(rows.length),
      rowCount: rows.length,
      scale: rowScale
    }]
  );
  const solved = solveWeightsOnSimplex(
    constraints,
    prior,
    tolerance,
    rankTolerance,
    options.maxCandidateFaces ?? 262_143
  );
  if ('reason' in solved) {
    throw new Error(`projectPointToSourceSimplexN: ${solved.reason}`);
  }
  const coordinate = createSourceSimplexCoordinateN(reference, solved.weights, {
    tolerance: tolerance * 10
  });
  const projected = evaluateSourceSimplexCoordinateN(coordinate);
  let squaredDistance = 0;
  for (let axis = 0; axis < ambientDim; axis++) {
    squaredDistance += (projected.data[axis]! - point[axis]!) ** 2;
  }
  const rank = rankOfConstraintSystem(
    constraints,
    fullHelmert(reference.vertexIndices.length),
    rankTolerance
  );
  return {
    coordinate,
    point: projected,
    squaredDistance,
    affineRank: rank.rank,
    unresolvedDegreesOfFreedom: reference.intrinsicDim - rank.rank,
    candidateFaces: solved.candidateFaces
  };
}

/**
 * Reconcile R3 observations as homogeneous linear constraints on one source
 * simplex's barycentric weights.
 *
 * For target `y` and homogeneous vertex image `(h_j, q_j)`, each coordinate
 * contributes `sum_j w_j (h_j[c] - y[c] q_j) = 0`. Multiple views stack
 * those rows. The closed-simplex least-squares problem is solved by an exact
 * active-face enumeration; rank is measured on the barycentric tangent space.
 */
export function fitSourceSimplexCoordinateToObservationsN(
  reference: SourceSimplexReferenceN,
  observations: readonly SourceSimplexProjectionObservationN[],
  options: SourceSimplexObservationFitOptions = {}
): SourceSimplexObservationFitN {
  requireCurrentSimplex(reference, 'fitSourceSimplexCoordinateToObservationsN');
  if (observations.length === 0) {
    return unavailable('no-observations', {});
  }
  const tolerance = positiveTolerance(
    options.tolerance ?? 1e-9,
    'fitSourceSimplexCoordinateToObservationsN'
  );
  const rankTolerance = positiveTolerance(
    options.rankTolerance ?? 1e-10,
    'fitSourceSimplexCoordinateToObservationsN: rankTolerance'
  );
  const ambientDim = reference.complex.ambientDim;
  const transform = options.transform ?? TransformN.identity(ambientDim);
  if (transform.dim !== ambientDim) {
    throw new Error(
      `fitSourceSimplexCoordinateToObservationsN: transform is R${transform.dim}, source simplex is in R${ambientDim}`
    );
  }
  const sourceVertices = reference.vertexIndices.map(
    (vertex) => new VecN(reference.complex.getPosition(vertex))
  );
  const ambientVertices = sourceVertices.map((point) => transform.applyToPoint(point));
  let constraintSystem = createLinearCoordinateConstraintSystemN(
    reference.vertexIndices.length
  );
  const observationRows: Float64Array[][] = [];
  const weights: number[] = [];
  const homogeneousScales: number[] = [];
  const minAbsQs: number[] = [];

  for (let observationIndex = 0; observationIndex < observations.length; observationIndex++) {
    const observation = observations[observationIndex]!;
    if (observation.projection.fromDim !== ambientDim) {
      throw new Error(
        `fitSourceSimplexCoordinateToObservationsN: observation ${observationIndex} expects R${observation.projection.fromDim}, source simplex is in R${ambientDim}`
      );
    }
    assertFiniteTuple(
      observation.targetPoint,
      3,
      `fitSourceSimplexCoordinateToObservationsN: observation ${observationIndex} target`
    );
    const weight = observation.weight ?? 1;
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error(
        `fitSourceSimplexCoordinateToObservationsN: observation ${observationIndex} weight must be finite and positive`
      );
    }
    weights.push(weight);
    const samples = ambientVertices.map((point) =>
      observation.projection.projectHomogeneousPoint(point.data)
    );
    const coordinates: [number, number, number, number][] = [];
    let homogeneousScale = 0;
    let minAbsQ = Number.POSITIVE_INFINITY;
    for (let vertex = 0; vertex < samples.length; vertex++) {
      const sample = samples[vertex]!;
      if (!sample.validity.valid) {
        return unavailable('invalid-projection-vertex', {
          observationIndex,
          vertex
        });
      }
      const tuple = sample.coordinates;
      const q = tuple[3];
      let vertexScale = 0;
      for (let coordinate = 0; coordinate < 4; coordinate++) {
        vertexScale = Math.max(vertexScale, Math.abs(tuple[coordinate]!));
      }
      if (Math.abs(q) <= tolerance * Math.max(vertexScale, Number.MIN_VALUE)) {
        return unavailable('invalid-homogeneous-denominator', {
          observationIndex,
          vertex,
          q,
          homogeneousScale: vertexScale
        });
      }
      minAbsQ = Math.min(minAbsQ, Math.abs(q));
      homogeneousScale = Math.max(
        homogeneousScale,
        vertexScale,
        Math.abs(observation.targetPoint[0] * q),
        Math.abs(observation.targetPoint[1] * q),
        Math.abs(observation.targetPoint[2] * q)
      );
      coordinates.push([tuple[0], tuple[1], tuple[2], tuple[3]]);
    }
    minAbsQs.push(minAbsQ);
    const scale = homogeneousScale || 1;
    homogeneousScales.push(scale);
    const currentRows: Float64Array[] = [];
    for (let coordinate = 0; coordinate < 3; coordinate++) {
      const row = new Float64Array(reference.vertexIndices.length);
      for (let vertex = 0; vertex < coordinates.length; vertex++) {
        const tuple = coordinates[vertex]!;
        row[vertex] =
          tuple[coordinate]! - observation.targetPoint[coordinate]! * tuple[3];
      }
      currentRows.push(row);
    }
    observationRows.push(currentRows);
    constraintSystem = withLinearCoordinateConstraintBlockN(
      constraintSystem,
      observation.key ?? `observation:${observationIndex}`,
      {
        coefficients: flattenRows(currentRows),
        targets: new Float64Array(currentRows.length),
        rowCount: currentRows.length,
        weight,
        scale,
        ...(observation.label === undefined ? {} : { label: observation.label })
      }
    );
  }

  const prior = priorWeights(reference, options.prior);
  const solved = solveWeightsOnSimplex(
    constraintSystem,
    prior,
    tolerance,
    rankTolerance,
    options.maxCandidateFaces ?? 262_143
  );
  if ('reason' in solved) return unavailable(solved.reason, solved.details);

  const coordinate = createSourceSimplexCoordinateN(reference, solved.weights, {
    tolerance: tolerance * 10
  });
  const point = evaluateSourceSimplexCoordinateN(coordinate);
  const ambientPoint = transform.applyToPoint(point);
  const fullRank = rankOfConstraintSystem(
    constraintSystem,
    fullHelmert(reference.vertexIndices.length),
    rankTolerance
  );
  const diagnostics: SourceSimplexObservationDiagnosticN[] = [];
  let weightedRepresentationResidualSquared = 0;
  let totalWeight = 0;
  let maxRepresentationResidual = 0;
  let everyForwardTargetExact = true;

  for (let index = 0; index < observations.length; index++) {
    const observation = observations[index]!;
    const sample = observation.projection.projectHomogeneousPoint(ambientPoint.data);
    if (!sample.validity.valid || Math.abs(sample.coordinates[3]) <= Number.MIN_VALUE) {
      return unavailable('invalid-reconciled-projection', { observationIndex: index });
    }
    const q = sample.coordinates[3];
    const representationPoint: [number, number, number] = [
      sample.coordinates[0] / q,
      sample.coordinates[1] / q,
      sample.coordinates[2] / q
    ];
    const representationResidual = Math.hypot(
      representationPoint[0] - observation.targetPoint[0],
      representationPoint[1] - observation.targetPoint[1],
      representationPoint[2] - observation.targetPoint[2]
    );
    const scale = Math.max(
      1,
      ...representationPoint.map(Math.abs),
      ...observation.targetPoint.map(Math.abs)
    );
    everyForwardTargetExact &&=
      representationResidual <= tolerance * scale;
    const weight = weights[index]!;
    weightedRepresentationResidualSquared += weight * representationResidual ** 2;
    totalWeight += weight;
    maxRepresentationResidual = Math.max(
      maxRepresentationResidual,
      representationResidual
    );
    const currentRows = observationRows[index]!;
    let equationSquared = 0;
    for (const row of currentRows) {
      equationSquared += weight * (
        dot(row, solved.weights) / homogeneousScales[index]!
      ) ** 2;
    }
    const individualRank = rankOfRows(
      currentRows,
      fullHelmert(reference.vertexIndices.length),
      rankTolerance
    );
    diagnostics.push({
      key: observation.key ?? `observation:${index}`,
      ...(observation.label === undefined ? {} : { label: observation.label }),
      weight,
      targetPoint: [
        observation.targetPoint[0],
        observation.targetPoint[1],
        observation.targetPoint[2]
      ],
      representationPoint,
      representationResidual,
      homogeneousEquationRms: Math.sqrt(equationSquared / 3),
      individualRank: individualRank.rank,
      minAbsQ: minAbsQs[index]!
    });
  }

  const normalizedEquationRms = solved.normalizedResidualRms;
  const consistency = normalizedEquationRms <= tolerance
    ? 'compatible'
    : 'conflicting';
  const activeWeights = solved.weights.reduce(
    (count, weight) => count + (weight > tolerance ? 1 : 0),
    0
  );
  return {
    kind: consistency === 'compatible' && everyForwardTargetExact
      ? 'exact'
      : 'least-squares',
    consistency,
    determination: fullRank.rank === reference.intrinsicDim
      ? 'unique'
      : 'rank-deficient',
    coordinate,
    point,
    ambientPoint,
    observations: diagnostics,
    sourceDegreesOfFreedom: reference.intrinsicDim,
    observationRank: fullRank.rank,
    unresolvedDegreesOfFreedom: reference.intrinsicDim - fullRank.rank,
    rankConditioning: fullRank.conditioning,
    constraintNormalResidual: solved.normalResidual,
    activeFaceDimension: Math.max(0, activeWeights - 1),
    normalizedEquationRms,
    representationRmsResidual: Math.sqrt(
      weightedRepresentationResidualSquared / totalWeight
    ),
    maxRepresentationResidual,
    candidateFaces: solved.candidateFaces
  };
}

function solveWeightsOnSimplex(
  system: LinearCoordinateConstraintSystemN,
  prior: Float64Array,
  tolerance: number,
  rankTolerance: number,
  maxCandidateFaces: number
): SimplexLeastSquaresSolution | SimplexLeastSquaresUnavailable {
  if (!Number.isSafeInteger(maxCandidateFaces) || maxCandidateFaces < 1) {
    throw new Error('maxCandidateFaces must be a positive safe integer');
  }
  const vertexCount = prior.length;
  const faceCount = 2 ** vertexCount - 1;
  if (!Number.isSafeInteger(faceCount) || faceCount > maxCandidateFaces) {
    return {
      reason: 'too-many-simplex-faces',
      details: { vertexCount, faceCount, maxCandidateFaces }
    };
  }
  let best: {
    weights: Float64Array;
    objective: number;
    normalizedResidualRms: number;
    normalResidual: number;
    priorDistanceSquared: number;
  } | undefined;
  let candidateFaces = 0;
  const totalRows = system.blocks.reduce(
    (total, block) => total + block.rowCount,
    0
  );
  const objectiveBand = tolerance ** 2 * Math.max(1, totalRows);

  const consider = (active: readonly number[]): void => {
    const candidate = solveOnActiveFace(
      system,
      prior,
      active,
      tolerance,
      rankTolerance
    );
    if (candidate === undefined) return;
    candidateFaces++;
    if (
      best === undefined ||
      candidate.objective < best.objective - objectiveBand ||
      (
        Math.abs(candidate.objective - best.objective) <= objectiveBand &&
        candidate.priorDistanceSquared < best.priorDistanceSquared - tolerance ** 2
      )
    ) {
      best = candidate;
    }
  };
  const active: number[] = [];
  const enumerate = (vertex: number): void => {
    if (vertex === vertexCount) {
      if (active.length > 0) consider(active);
      return;
    }
    enumerate(vertex + 1);
    active.push(vertex);
    enumerate(vertex + 1);
    active.pop();
  };
  enumerate(0);
  if (best === undefined) {
    return {
      reason: 'no-feasible-coordinate',
      details: { candidateFaces, vertexCount }
    };
  }
  return {
    weights: best.weights,
    objective: best.objective,
    normalizedResidualRms: best.normalizedResidualRms,
    normalResidual: best.normalResidual,
    candidateFaces
  };
}

function solveOnActiveFace(
  system: LinearCoordinateConstraintSystemN,
  prior: Float64Array,
  active: readonly number[],
  tolerance: number,
  rankTolerance: number
): {
  weights: Float64Array;
  objective: number;
  normalizedResidualRms: number;
  normalResidual: number;
  priorDistanceSquared: number;
} | undefined {
  const vertexCount = prior.length;
  const activeCount = active.length;
  const weights = new Float64Array(vertexCount);
  let normalResidual = 0;
  if (activeCount === 1) {
    weights[active[0]!] = 1;
  } else {
    const basis = fullHelmert(activeCount);
    const tangentDim = activeCount - 1;
    const localBlocks = system.blocks.map((block) => {
      const coefficients = new Float64Array(block.rowCount * tangentDim);
      const targets = new Float64Array(block.rowCount);
      for (let rowIndex = 0; rowIndex < block.rowCount; rowIndex++) {
        const sourceOffset = rowIndex * system.coordinateDim;
        let centerValue = 0;
        for (const vertex of active) {
          centerValue += block.coefficients[sourceOffset + vertex]! / activeCount;
        }
        targets[rowIndex] = block.targets[rowIndex]! - centerValue;
        for (let coordinate = 0; coordinate < tangentDim; coordinate++) {
          for (let local = 0; local < activeCount; local++) {
            coefficients[rowIndex * tangentDim + coordinate]! +=
              block.coefficients[sourceOffset + active[local]!]! *
                basis[local]![coordinate]!;
          }
        }
      }
      return {
        coefficients,
        targets,
        rowCount: block.rowCount,
        weight: block.weight,
        scale: block.scale,
        ...(block.label === undefined ? {} : { label: block.label })
      };
    });
    const zPrior = new Float64Array(tangentDim);
    for (let coordinate = 0; coordinate < tangentDim; coordinate++) {
      for (let local = 0; local < activeCount; local++) {
        zPrior[coordinate]! += basis[local]![coordinate]! * (
          prior[active[local]!]! - 1 / activeCount
        );
      }
    }
    const constraints = solveLinearCoordinateConstraintsN(
      tangentDim,
      localBlocks,
      { prior: zPrior, tolerance, rankTolerance }
    );
    normalResidual = constraints.normalResidual;
    const z = constraints.solution;
    for (let local = 0; local < activeCount; local++) {
      let weight = 1 / activeCount;
      for (let coordinate = 0; coordinate < tangentDim; coordinate++) {
        weight += basis[local]![coordinate]! * z[coordinate]!;
      }
      if (weight < -tolerance * 10) return undefined;
      weights[active[local]!] = Math.max(0, weight);
    }
    const sum = weights.reduce((total, weight) => total + weight, 0);
    if (!(sum > 0)) return undefined;
    for (let vertex = 0; vertex < weights.length; vertex++) weights[vertex]! /= sum;
  }

  const { objective, weightedRows } = constraintObjective(system, weights);
  const normalizedResidualRms = weightedRows === 0
    ? 0
    : Math.sqrt(objective / weightedRows);
  let priorDistanceSquared = 0;
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    priorDistanceSquared += (weights[vertex]! - prior[vertex]!) ** 2;
  }
  return {
    weights,
    objective,
    normalizedResidualRms,
    normalResidual,
    priorDistanceSquared
  };
}

function rankOfConstraintSystem(
  system: LinearCoordinateConstraintSystemN,
  basis: readonly Float64Array[],
  rankTolerance: number
): RankReport {
  const tangentDim = basis[0]?.length ?? 0;
  if (tangentDim === 0) return { rank: 0, conditioning: 1, threshold: 0 };
  if (system.blocks.length === 0) {
    return { rank: 0, conditioning: 0, threshold: 0 };
  }
  const blocks = system.blocks.map((block) => {
    const coefficients = new Float64Array(block.rowCount * tangentDim);
    for (let row = 0; row < block.rowCount; row++) {
      const sourceOffset = row * system.coordinateDim;
      for (let coordinate = 0; coordinate < tangentDim; coordinate++) {
        for (let vertex = 0; vertex < system.coordinateDim; vertex++) {
          coefficients[row * tangentDim + coordinate]! +=
            block.coefficients[sourceOffset + vertex]! *
              basis[vertex]![coordinate]!;
        }
      }
    }
    return {
      coefficients,
      targets: new Float64Array(block.rowCount),
      rowCount: block.rowCount,
      weight: block.weight,
      scale: block.scale,
      ...(block.label === undefined ? {} : { label: block.label })
    };
  });
  const constraints = solveLinearCoordinateConstraintsN(
    tangentDim,
    blocks,
    { rankTolerance }
  );
  return {
    rank: constraints.rank,
    conditioning: constraints.rankConditioning,
    threshold: constraints.rankThreshold
  };
}

function rankOfRows(
  rows: readonly Float64Array[],
  basis: readonly Float64Array[],
  rankTolerance: number
): RankReport {
  const tangentDim = basis[0]?.length ?? 0;
  if (tangentDim === 0) return { rank: 0, conditioning: 1, threshold: 0 };
  if (rows.length === 0) return { rank: 0, conditioning: 0, threshold: 0 };
  const coefficients = new Float64Array(rows.length * tangentDim);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!;
    for (let coordinate = 0; coordinate < tangentDim; coordinate++) {
      for (let vertex = 0; vertex < row.length; vertex++) {
        coefficients[rowIndex * tangentDim + coordinate]! +=
          row[vertex]! * basis[vertex]![coordinate]!;
      }
    }
  }
  const constraints = solveLinearCoordinateConstraintsN(tangentDim, [{
    coefficients,
    targets: new Float64Array(rows.length),
    rowCount: rows.length,
    label: 'simplex tangent rank'
  }], { rankTolerance });
  return {
    rank: constraints.rank,
    conditioning: constraints.rankConditioning,
    threshold: constraints.rankThreshold
  };
}

/** Orthonormal Helmert basis for the zero-sum subspace of R^vertexCount. */
function fullHelmert(vertexCount: number): Float64Array[] {
  const basis = Array.from(
    { length: vertexCount },
    () => new Float64Array(Math.max(0, vertexCount - 1))
  );
  for (let coordinate = 0; coordinate < vertexCount - 1; coordinate++) {
    const denominator = Math.sqrt((coordinate + 1) * (coordinate + 2));
    for (let vertex = 0; vertex <= coordinate; vertex++) {
      basis[vertex]![coordinate] = 1 / denominator;
    }
    basis[coordinate + 1]![coordinate] = -(coordinate + 1) / denominator;
  }
  return basis;
}

function priorWeights(
  reference: SourceSimplexReferenceN,
  prior: SourceSimplexCoordinateN | undefined
): Float64Array {
  if (prior === undefined) {
    return new Float64Array(reference.vertexIndices.length).fill(
      1 / reference.vertexIndices.length
    );
  }
  if (prior.reference !== reference) {
    throw new Error('source-simplex prior must use the same reference object');
  }
  return Float64Array.from(prior.weights);
}

function constraintObjective(
  system: LinearCoordinateConstraintSystemN,
  coordinate: ArrayLike<number>
): ConstraintObjective {
  let objective = 0;
  let weightedRows = 0;
  for (const block of system.blocks) {
    for (let row = 0; row < block.rowCount; row++) {
      const offset = row * system.coordinateDim;
      let applied = 0;
      for (let column = 0; column < system.coordinateDim; column++) {
        applied += block.coefficients[offset + column]! * coordinate[column]!;
      }
      const residual = (applied - block.targets[row]!) / block.scale;
      objective += block.weight * residual ** 2;
      weightedRows += block.weight;
    }
  }
  return { objective, weightedRows };
}

function flattenRows(rows: readonly Float64Array[]): Float64Array {
  const rowLength = rows[0]?.length ?? 0;
  const flattened = new Float64Array(rows.length * rowLength);
  for (let row = 0; row < rows.length; row++) {
    flattened.set(rows[row]!, row * rowLength);
  }
  return flattened;
}

function dot(left: ArrayLike<number>, right: ArrayLike<number>): number {
  let value = 0;
  for (let index = 0; index < left.length; index++) {
    value += left[index]! * right[index]!;
  }
  return value;
}

function unavailable(
  reason: SourceSimplexObservationFitFailureReason,
  details: Readonly<Record<string, number | boolean>>
): UnavailableSourceSimplexObservationFitN {
  return { kind: 'unavailable', reason, details };
}

function requireCurrentCell(reference: SourceCellReferenceN, caller: string): void {
  const status = inspectSourceCellReferenceN(reference);
  if (status.kind === 'retired') {
    throw new Error(`${caller}: parent source cell is retired (${status.reason})`);
  }
}

function requireCurrentSimplex(
  reference: SourceSimplexReferenceN,
  caller: string
): void {
  requireCurrentCell(reference.parent, caller);
}

function positiveTolerance(value: number, caller: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${caller}: tolerance must be finite and positive`);
  }
  return value;
}

function assertFiniteTuple(
  values: ArrayLike<number>,
  length: number,
  caller: string
): void {
  if (values.length !== length) {
    throw new Error(`${caller} must contain ${length} coordinates`);
  }
  for (let coordinate = 0; coordinate < length; coordinate++) {
    if (!Number.isFinite(values[coordinate])) {
      throw new Error(`${caller} must be finite`);
    }
  }
}
