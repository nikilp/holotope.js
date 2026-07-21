import type { CellComplex } from '../geometry/cell-complex.js';
import type { FieldEvaluation4, ImplicitField4 } from '../field/types.js';
import type { VecN } from '../math/vecn.js';
import type { SourceCellReferenceN } from './source-reference.js';
import type { RepresentationLineageN } from './map.js';

export type RepresentationKind3D =
  | 'projected-edge'
  | 'projected-surface'
  | 'sliced-complex'
  | 'sampled-sliced-field'
  | 'raymarched-field';

/** Precision of the represented ambient point, independent of source identity. */
export type AmbientPointStatus = 'exact' | 'approximate' | 'unavailable';

/** Why a visible 3D selection may or may not name one ambient source point. */
export type RepresentationAmbiguity =
  | 'none'
  | 'projection-overlap'
  | 'sampled-surface'
  | 'first-ray-hit';

export interface RepresentationCellSourceN {
  readonly kind: 'cell';
  readonly complex: CellComplex;
  readonly intrinsicDim: number;
  /** Index in the render product's documented concatenated cell sequence. */
  readonly cellIndex: number;
  readonly vertexIndices: readonly number[];
  /** Lifecycle-aware reference to the source cell group and local ordinal. */
  readonly reference: SourceCellReferenceN;
}

export interface RepresentationSampleCellSource4<
  Evaluation extends FieldEvaluation4 = FieldEvaluation4
> {
  readonly kind: 'sample-cell';
  readonly field: ImplicitField4<Evaluation>;
  readonly cellIndex: number;
}

export interface RepresentationFieldRecordSource4<
  Evaluation extends FieldEvaluation4 = FieldEvaluation4
> {
  readonly kind: 'field-record';
  readonly field: ImplicitField4<Evaluation>;
  readonly record: Evaluation;
}

export type RepresentationSourceN<Evaluation extends FieldEvaluation4 = FieldEvaluation4> =
  | RepresentationCellSourceN
  | RepresentationSampleCellSource4<Evaluation>
  | RepresentationFieldRecordSource4<Evaluation>;

export type RepresentationDetailValue =
  | string
  | number
  | boolean
  | readonly number[];

/**
 * Renderer-independent inspection result for a three-dimensional
 * representation of higher-dimensional state.
 *
 * `point3` is expressed in the representation consumer's world frame.
 * `lineage` names the mathematical reductions that produced that
 * representation. `ambientPoint`, source identity, and ambiguity remain
 * independent facts.
 */
export interface RepresentationHitN<
  Evaluation extends FieldEvaluation4 = FieldEvaluation4
> {
  readonly representation: RepresentationKind3D;
  readonly point3: readonly [number, number, number];
  readonly ambientDim: number;
  readonly ambientPointStatus: AmbientPointStatus;
  readonly ambientPoint?: VecN;
  readonly ambiguity: RepresentationAmbiguity;
  readonly lineage: RepresentationLineageN;
  readonly source: RepresentationSourceN<Evaluation>;
  readonly details?: Readonly<Record<string, RepresentationDetailValue>>;
}
