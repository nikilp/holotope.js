import { VecN } from '../math/vecn.js';
import { PerspectiveProjection } from '../projection/perspective.js';
import type {
  RepresentationLineageN,
  RepresentationMapRecipeN
} from './map.js';

export type RepresentationLineagePointFailureReason =
  | 'outside-domain'
  | 'recipe-insufficient'
  | 'record-required';

export type RepresentationLineageEvidenceValue =
  | string
  | number
  | boolean
  | readonly number[];

export interface RepresentationLineagePointStepN {
  readonly stepIndex: number;
  readonly recipeKind: RepresentationMapRecipeN['kind'];
  readonly kind: 'exact' | 'unavailable';
  readonly point?: readonly number[];
  readonly details?: Readonly<Record<string, RepresentationLineageEvidenceValue>>;
}

export interface ExactRepresentationLineagePointN {
  readonly kind: 'exact';
  readonly point: VecN;
  readonly steps: readonly RepresentationLineagePointStepN[];
}

export interface UnavailableRepresentationLineagePointN {
  readonly kind: 'unavailable';
  readonly reason: RepresentationLineagePointFailureReason;
  readonly failedStep: number;
  /** Last exact point before the failed operation. */
  readonly point: VecN;
  readonly steps: readonly RepresentationLineagePointStepN[];
}

export type RepresentationLineagePointEvaluationN =
  | ExactRepresentationLineagePointN
  | UnavailableRepresentationLineagePointN;

export interface RepresentationLineagePointEvaluationOptions {
  /** Scale-relative affine-domain tolerance. Default `1e-9`. */
  readonly tolerance?: number;
}

/**
 * Evaluate one source point through the point-action encoded by a lineage.
 *
 * Only recipe kinds carrying sufficient point mathematics are evaluated. A
 * field realization or custom projection returns typed unavailability rather
 * than delegating to renderer state or guessing an implementation.
 */
export function evaluateRepresentationLineagePointN(
  lineage: RepresentationLineageN,
  sourcePoint: VecN | ArrayLike<number>,
  options: RepresentationLineagePointEvaluationOptions = {}
): RepresentationLineagePointEvaluationN {
  const tolerance = options.tolerance ?? 1e-9;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    throw new Error(
      'evaluateRepresentationLineagePointN: tolerance must be finite and positive'
    );
  }
  const input = sourcePoint instanceof VecN
    ? sourcePoint.clone()
    : new VecN(sourcePoint);
  if (input.dim !== lineage.sourceDim) {
    throw new Error(
      `evaluateRepresentationLineagePointN: source point is R${input.dim}, lineage expects R${lineage.sourceDim}`
    );
  }
  requireFinitePoint(input.data, 'evaluateRepresentationLineagePointN: source point');

  let point = input;
  const steps: RepresentationLineagePointStepN[] = [];
  for (let stepIndex = 0; stepIndex < lineage.steps.length; stepIndex++) {
    const recipe = lineage.steps[stepIndex]!;
    switch (recipe.kind) {
      case 'affine-section': {
        const residual = affinePlaneResidual(point, recipe.normal, recipe.offset);
        const threshold = affineThreshold(point, recipe.offset, tolerance);
        if (Math.abs(residual) > threshold) {
          return unavailable(
            point,
            steps,
            recipe,
            stepIndex,
            'outside-domain',
            { planeResidual: residual, tolerance: threshold }
          );
        }
        steps.push(exactStep(stepIndex, recipe, point, {
          planeResidual: residual,
          tolerance: threshold
        }));
        break;
      }
      case 'affine-slice-chart': {
        const residual = affinePlaneResidual(point, recipe.normal, recipe.offset);
        const threshold = affineThreshold(point, recipe.offset, tolerance);
        if (Math.abs(residual) > threshold) {
          return unavailable(
            point,
            steps,
            recipe,
            stepIndex,
            'outside-domain',
            { planeResidual: residual, tolerance: threshold }
          );
        }
        const chart = new Float64Array(3);
        for (let axis = 0; axis < 3; axis++) {
          const basisAxis = recipe.basis[axis]!;
          for (let component = 0; component < 4; component++) {
            chart[axis]! += basisAxis[component]! * (
              point.data[component]! - recipe.normal[component]! * recipe.offset
            );
          }
        }
        point = new VecN(chart);
        steps.push(exactStep(stepIndex, recipe, point, {
          planeResidual: residual,
          tolerance: threshold
        }));
        break;
      }
      case 'orthographic-projection': {
        point = new VecN([point.data[0]!, point.data[1]!, point.data[2]!]);
        steps.push(exactStep(stepIndex, recipe, point));
        break;
      }
      case 'coordinate-subspace-projection': {
        point = new VecN([
          point.data[recipe.retainedAxes[0]]!,
          point.data[recipe.retainedAxes[1]]!,
          point.data[recipe.retainedAxes[2]]!
        ]);
        requireFinitePoint(point.data, `evaluateRepresentationLineagePointN: step ${stepIndex}`);
        steps.push(exactStep(stepIndex, recipe, point));
        break;
      }
      case 'iterated-perspective-projection': {
        const projection = new PerspectiveProjection({
          fromDim: recipe.fromDim,
          viewDistance: recipe.viewDistance,
          epsilon: recipe.epsilon
        });
        const homogeneous = projection.projectHomogeneousPoint(point.data);
        const q = homogeneous.coordinates[3];
        if (!homogeneous.validity.valid) {
          const margins = homogeneous.validity.kind === 'iterated-perspective'
            ? homogeneous.validity.stages.map((stage) => stage.domainMargin)
            : [];
          return unavailable(
            point,
            steps,
            recipe,
            stepIndex,
            'outside-domain',
            {
              q,
              firstClampedAxis: homogeneous.validity.kind === 'iterated-perspective'
                ? (homogeneous.validity.firstClampedAxis ?? -1)
                : -1,
              domainMargins: margins
            }
          );
        }
        point = new VecN([
          homogeneous.coordinates[0] / q,
          homogeneous.coordinates[1] / q,
          homogeneous.coordinates[2] / q
        ]);
        steps.push(exactStep(stepIndex, recipe, point, { q }));
        break;
      }
      case 'custom-projection':
        return unavailable(
          point,
          steps,
          recipe,
          stepIndex,
          'recipe-insufficient',
          { label: recipe.label }
        );
      case 'field-restriction':
      case 'sampled-isosurface':
      case 'ray-realization':
        return unavailable(
          point,
          steps,
          recipe,
          stepIndex,
          'record-required'
        );
    }
  }
  return {
    kind: 'exact',
    point,
    steps: Object.freeze(steps)
  };
}

function affinePlaneResidual(
  point: VecN,
  normal: readonly [number, number, number, number],
  offset: number
): number {
  if (point.dim !== 4) {
    throw new Error(
      `evaluateRepresentationLineagePointN: affine recipe expects R4, received R${point.dim}`
    );
  }
  requireFinitePoint(normal, 'evaluateRepresentationLineagePointN: affine normal');
  if (!Number.isFinite(offset)) {
    throw new Error('evaluateRepresentationLineagePointN: affine offset must be finite');
  }
  let residual = -offset;
  for (let component = 0; component < 4; component++) {
    residual += normal[component]! * point.data[component]!;
  }
  return residual;
}

function affineThreshold(point: VecN, offset: number, tolerance: number): number {
  return tolerance * Math.max(1, Math.abs(offset), Math.hypot(...point.data));
}

function exactStep(
  stepIndex: number,
  recipe: RepresentationMapRecipeN,
  point: VecN,
  details?: Readonly<Record<string, RepresentationLineageEvidenceValue>>
): RepresentationLineagePointStepN {
  return Object.freeze({
    stepIndex,
    recipeKind: recipe.kind,
    kind: 'exact' as const,
    point: Object.freeze(Array.from(point.data)),
    ...(details === undefined ? {} : { details: Object.freeze({ ...details }) })
  });
}

function unavailable(
  point: VecN,
  steps: RepresentationLineagePointStepN[],
  recipe: RepresentationMapRecipeN,
  stepIndex: number,
  reason: RepresentationLineagePointFailureReason,
  details?: Readonly<Record<string, RepresentationLineageEvidenceValue>>
): UnavailableRepresentationLineagePointN {
  const failed = Object.freeze({
    stepIndex,
    recipeKind: recipe.kind,
    kind: 'unavailable' as const,
    ...(details === undefined ? {} : { details: Object.freeze({ ...details }) })
  });
  return {
    kind: 'unavailable',
    reason,
    failedStep: stepIndex,
    point,
    steps: Object.freeze([...steps, failed])
  };
}

function requireFinitePoint(point: ArrayLike<number>, caller: string): void {
  for (let coordinate = 0; coordinate < point.length; coordinate++) {
    if (!Number.isFinite(point[coordinate])) {
      throw new Error(`${caller} must contain only finite coordinates`);
    }
  }
}
