import type { CellComplex } from '../geometry/cell-complex.js';
import type { FieldEvaluation4, ImplicitField4 } from '../field/types.js';
import type { VecN } from '../math/vecn.js';
import type { SourceCellIdN, SourceCellReferenceN } from './source-reference.js';
import type { RepresentationLineageN } from './map.js';

export type RepresentationKind3D =
  | 'projected-edge'
  | 'projected-surface'
  | 'sliced-complex'
  | 'section-chart'
  | 'sampled-sliced-field'
  | 'raymarched-field';

/** Precision of the represented ambient point, independent of source identity. */
export type AmbientPointStatus = 'exact' | 'approximate' | 'unavailable';

/** Why a visible 3D selection may or may not name one ambient source point. */
/**
 * How the representation lost information on the way to 3D, and therefore in
 * what sense a hit on it may fail to name a unique source point.
 *
 * - `none` — the map was invertible here, and the hit names one point;
 * - `projection-overlap` — a projection is many-to-one, so other source
 *   points share this image;
 * - `sampled-surface` — the surface is reconstructed from samples, so the
 *   point lies between the places the field was actually evaluated;
 * - `first-ray-hit` — ray marching returned the first surface met, and
 *   further ones lie behind it along the same ray.
 *
 * This is independent of whether an ambient point exists: a hit can name its
 * source cell exactly while being ambiguous about position, and the two
 * questions are answered by different fields.
 */
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
  /** Structural identity suitable for compatible regeneration boundaries. */
  readonly id?: SourceCellIdN;
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
 * A representation map is generally many-to-one, so the 3D coordinates a
 * renderer reports cannot identify the point that produced them. This record
 * exists because that identity is *carried* rather than inverted: a product
 * retains, per rendered primitive, the source it was built from, and a hit
 * hands that back.
 *
 * It answers three questions that are independent of one another, and reading
 * one for another is the mistake it is shaped to prevent:
 *
 * | question | field |
 * | --- | --- |
 * | what source produced this? | `source` |
 * | where is it in R^N? | `ambientPointStatus`, then `ambientPoint` |
 * | is the answer unique? | `ambiguity` |
 *
 * The common case is an exactly identified source with no ambient point at
 * all: a cut drawn in a projection's frame names its source cell precisely
 * while the projection makes the position ambiguous.
 *
 * `ambientPointStatus` therefore qualifies `ambientPoint` rather than merely
 * announcing it:
 *
 * - `exact` — the point is present and is the source position;
 * - `approximate` — the point is present but was reconstructed between
 *   samples, as on a sampled field surface, and is accurate only to the
 *   sampling;
 * - `unavailable` — no point, because the map could not be inverted here.
 *
 * A present `ambientPoint` is thus not by itself a trustworthy position. Read
 * the status first and treat `approximate` as an estimate; the record reports
 * the distinction rather than resolving it, because which tolerance is
 * acceptable belongs to the caller.
 */
export interface RepresentationHitN<
  Evaluation extends FieldEvaluation4 = FieldEvaluation4
> {
  /** Which kind of render product was picked. */
  readonly representation: RepresentationKind3D;
  /** The picked point, in the consumer's world frame. */
  readonly point3: readonly [number, number, number];
  /** Dimension of the space the source lives in. */
  readonly ambientDim: number;
  /** Whether an ambient point could be recovered at all; check before
   * reading `ambientPoint`. */
  readonly ambientPointStatus: AmbientPointStatus;
  /** The source position in R^N. Present when the status is `'exact'` or
   * `'approximate'`, and qualified by it — absent only when unavailable. */
  readonly ambientPoint?: VecN;
  /** In what sense the hit may name more than one source point. */
  readonly ambiguity: RepresentationAmbiguity;
  /** The chain of reductions that produced this representation, which is what
   * makes the ambiguity and the status explicable rather than asserted. */
  readonly lineage: RepresentationLineageN;
  /** The retained source record: a cell, a sampled cell, or a field
   * evaluation. Narrow on its `kind` before reading it. */
  readonly source: RepresentationSourceN<Evaluation>;
  /** Product-specific extras, keyed by name; nothing here is load-bearing. */
  readonly details?: Readonly<Record<string, RepresentationDetailValue>>;
}
