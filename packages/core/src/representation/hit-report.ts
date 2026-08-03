import type { VecN } from '../math/vecn.js';
import type {
  RepresentationAmbiguity,
  RepresentationHitN,
  RepresentationKind3D,
  RepresentationSourceN
} from './types.js';

/**
 * What a hit licenses a caller to say about an ambient source point.
 *
 * The discriminant is the point of the type. A hit carries precision and
 * uniqueness as two independent fields, and a caller that reads only the first
 * will present a conditional lift as the source point — which is the mistake
 * this shape makes unrepresentable, because `point` is reachable only through a
 * branch that already states what may be claimed of it.
 */
export type RepresentationAmbientClaimN =
  | {
      /** Exactly one source point produced this observation. */
      readonly claim: 'unique';
      readonly point: VecN;
    }
  | {
      /**
       * Exact on the source primitive the pick selected, and not unique under
       * the map. Report it against that primitive or not at all.
       */
      readonly claim: 'on-selected-primitive';
      readonly point: VecN;
      readonly ambiguity: RepresentationAmbiguity;
    }
  | {
      /** Recovered within a tolerance rather than exactly. */
      readonly claim: 'approximate';
      readonly point: VecN;
      readonly ambiguity: RepresentationAmbiguity;
    }
  | {
      /** No ambient point was recovered; only source identity survives. */
      readonly claim: 'unavailable';
      readonly ambiguity: RepresentationAmbiguity;
    };

/** A hit restated so the three independent questions cannot be conflated. */
export interface RepresentationHitReportN {
  /** Which kind of render product was picked. */
  readonly representation: RepresentationKind3D;
  /** Structural identity of the selected source primitive; always present. */
  readonly source: RepresentationSourceN;
  /**
   * What may be said about an ambient point, if anything.
   *
   * Branch on `claim`. There is deliberately no second boolean saying the same
   * thing: a convenience predicate beside a discriminant is one more field to
   * read instead of the union, which is the habit this type exists to break.
   */
  readonly ambient: RepresentationAmbientClaimN;
  /** Reduction kinds that produced this representation, outermost first. */
  readonly lineageKinds: readonly string[];
}

/**
 * Restates a representation hit as a claim a caller can act on.
 *
 * A `RepresentationHitN` answers three independent questions — which source
 * primitive, how precise the lift, and whether the observation determines one
 * point — and the answers are deliberately separate because they are separate
 * facts. Reading them together correctly is the step callers get wrong: a
 * projected pick routinely reports `ambientPointStatus: 'exact'` while
 * `ambiguity` is `'projection-overlap'`, because the lift is exact on the
 * triangle the ray met and the projection as a whole is many-to-one.
 *
 * This function performs that reading once. It adds no information and makes
 * no decision the hit did not already contain; it removes the opportunity to
 * combine the fields incorrectly.
 *
 * @param hit - Hit produced by a representation adapter.
 * @returns The same evidence, shaped so a unique claim requires both facts.
 *
 * @example
 * Branch on the claim rather than on precision alone:
 * ```ts
 * const complex = tetrahedralizeCuboidCells(createHypercube({ dim: 4, size: 2 }));
 * const section = new SlicedComplex3D(
 *   complex,
 *   HyperplaneSlice4.axisAligned(3, 0)
 * );
 * section.update();
 *
 * // Centroid of the first emitted section triangle, in the product's frame.
 * const positions = section.geometry.getAttribute('position');
 * const point = section.object.position.clone().set(
 *   (positions.getX(0) + positions.getX(1) + positions.getX(2)) / 3,
 *   (positions.getY(0) + positions.getY(1) + positions.getY(2)) / 3,
 *   (positions.getZ(0) + positions.getZ(1) + positions.getZ(2)) / 3
 * );
 *
 * // RepresentationHitReportN.
 * const report = describeRepresentationHitN(
 *   representationHitFromSlicedComplex(section, { point, faceIndex: 0 })
 * );
 *
 * log(report.source.kind); // identity always survives
 * log(report.lineageKinds); // why the claim is what it is
 *
 * // RepresentationAmbientClaimN — a discriminated union on `claim`.
 * const ambient = report.ambient;
 * if (ambient.claim === 'unique') {
 *   log(ambient.point.data); // safe to present as the source point
 * } else if (ambient.claim === 'on-selected-primitive') {
 *   // Exact on the named primitive, not unique under the map.
 *   log(ambient.point.data, ambient.ambiguity);
 * } else {
 *   log('identity only', ambient.claim);
 * }
 * ```
 */
export function describeRepresentationHitN(
  hit: RepresentationHitN
): RepresentationHitReportN {
  const unique = hit.ambientPointStatus === 'exact' && hit.ambiguity === 'none';
  return Object.freeze({
    representation: hit.representation,
    source: hit.source,
    ambient: ambientClaim(hit, unique),
    lineageKinds: Object.freeze(
      hit.lineage.steps.map((step) => step.kind)
    )
  });
}

function ambientClaim(
  hit: RepresentationHitN,
  unique: boolean
): RepresentationAmbientClaimN {
  const point = hit.ambientPoint;
  if (hit.ambientPointStatus === 'unavailable' || point === undefined) {
    return Object.freeze({
      claim: 'unavailable' as const,
      ambiguity: hit.ambiguity
    });
  }
  if (hit.ambientPointStatus === 'approximate') {
    return Object.freeze({
      claim: 'approximate' as const,
      point,
      ambiguity: hit.ambiguity
    });
  }
  return unique
    ? Object.freeze({ claim: 'unique' as const, point })
    : Object.freeze({
        claim: 'on-selected-primitive' as const,
        point,
        ambiguity: hit.ambiguity
      });
}
