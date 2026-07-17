export { ProjectedEdges3D, type ProjectedEdges3DOptions } from './projected-edges.js';
export { ProjectedSurface3D, type ProjectedSurface3DOptions } from './projected-surface.js';
export { SlicedComplex3D, type SlicedComplex3DOptions } from './sliced-complex.js';
export {
  SampledSlicedField3D,
  type SampledSlicedField3DOptions
} from './sampled-sliced-field.js';
export {
  representationHitFromProjectedEdge,
  representationHitFromProjectedSurface,
  representationHitFromSampledSlicedField,
  representationHitFromSlicedComplex,
  type AmbientPointStatus,
  type RepresentationAmbiguity,
  type RepresentationCellSourceN,
  type RepresentationFieldRecordSource4,
  type RepresentationHitN,
  type RepresentationIntersection3D,
  type RepresentationKind3D,
  type RepresentationSampleCellSource4,
  type RepresentationSourceN
} from './representation-hit.js';
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
