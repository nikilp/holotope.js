import { VecN } from '@holotope/core';
import type { FieldEvaluation4 } from '@holotope/core';
import type { Ray } from 'three/webgpu';
import type { RepresentationHitN } from '../representation-hit.js';
import type {
  RaymarchedField3D,
  RaymarchedFieldIntersection
} from './raymarched-field.js';

/** Convert an existing CPU-golden field intersection to the common hit form. */
export function representationHitFromRaymarchedField<
  Record extends FieldEvaluation4
>(
  product: RaymarchedField3D<Record>,
  intersection: RaymarchedFieldIntersection<Record>
): RepresentationHitN<Record> {
  return {
    representation: 'raymarched-field',
    point3: intersection.point.toArray(),
    ambientDim: 4,
    ambientPointStatus: 'approximate',
    ambientPoint: new VecN(intersection.point4),
    ambiguity: 'first-ray-hit',
    source: {
      kind: 'field-record',
      field: product.field,
      record: intersection.record
    },
    details: {
      steps: intersection.steps,
      startedInside: intersection.startedInside
    }
  };
}

/** Trace a world-space ray and return the common representation hit. */
export function intersectRaymarchedRepresentation<
  Record extends FieldEvaluation4
>(
  product: RaymarchedField3D<Record>,
  ray: Ray
): RepresentationHitN<Record> | null {
  const intersection = product.intersectRay(ray);
  return intersection
    ? representationHitFromRaymarchedField(product, intersection)
    : null;
}
