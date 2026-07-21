export { ProjectedEdges3D, type ProjectedEdges3DOptions } from './projected-edges.js';
export { ProjectedSurface3D, type ProjectedSurface3DOptions } from './projected-surface.js';
export {
  SlicedComplex3D,
  type SliceCrossingProvenanceN,
  type SlicedComplex3DOptions
} from './sliced-complex.js';
export {
  SampledSlicedField3D,
  type SampledSlicedField3DOptions
} from './sampled-sliced-field.js';
export {
  representationHitFromProjectedEdge,
  representationHitFromProjectedSurface,
  representationHitFromSampledSlicedField,
  representationHitFromSlicedComplex,
  type RepresentationIntersection3D
} from './representation-hit.js';
export type {
  AmbientPointStatus,
  RepresentationAmbiguity,
  RepresentationCellSourceN,
  RepresentationDetailValue,
  RepresentationFieldRecordSource4,
  RepresentationHitN,
  RepresentationKind3D,
  RepresentationSampleCellSource4,
  RepresentationSourceN
} from '@holotope/core';
export {
  FieldRelief3D,
  type FieldRelief3DOptions,
  type FieldReliefSample
} from './field-relief.js';
export {
  FRACTAL_PALETTES,
  getFractalPalette,
  sampleFractalPalette,
  type FractalPaletteDefinition,
  type FractalPaletteId,
  type FractalRgb
} from './fractal-palette.js';
export { DragRotation4D, type DragRotation4DOptions } from './drag-rotation4d.js';
