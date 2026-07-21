import {
  VecN,
  createRepresentationLineageN,
  fieldRestrictionMapRecipe4
} from '@holotope/core';
import type {
  FieldEvaluation4,
  RayRealizationMapRecipe3,
  RepresentationHitN
} from '@holotope/core';
import type { Ray } from 'three/webgpu';
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
  const rayRecipe: RayRealizationMapRecipe3 = {
    kind: 'ray-realization',
    fromDim: 3,
    toDim: 3,
    maxSteps: product.maxSteps,
    surfaceEpsilon: product.surfaceEpsilon,
    stepSafety: product.stepSafety
  };
  return {
    representation: 'raymarched-field',
    point3: intersection.point.toArray(),
    ambientDim: 4,
    ambientPointStatus: 'approximate',
    ambientPoint: new VecN(intersection.point4),
    ambiguity: 'first-ray-hit',
    lineage: createRepresentationLineageN(4, [
      fieldRestrictionMapRecipe4(product.field.id, product.slice),
      rayRecipe
    ]),
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
