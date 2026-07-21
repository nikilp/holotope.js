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
} from './types.js';
export {
  solveLinearCoordinateConstraintsN,
  type CoordinateConstraintConsistency,
  type CoordinateConstraintDetermination,
  type LinearCoordinateConstraintBlockDiagnosticN,
  type LinearCoordinateConstraintBlockN,
  type LinearCoordinateConstraintFitN,
  type LinearCoordinateConstraintOptions
} from './coordinate-constraints.js';
export {
  clearLinearCoordinateConstraintSystemN,
  createLinearCoordinateConstraintSystemN,
  getLinearCoordinateConstraintBlockN,
  solveLinearCoordinateConstraintSystemN,
  withLinearCoordinateConstraintBlockN,
  withoutLinearCoordinateConstraintBlockN,
  type LinearCoordinateConstraintSystemFitN,
  type LinearCoordinateConstraintSystemN,
  type NamedLinearCoordinateConstraintBlockDiagnosticN,
  type NamedLinearCoordinateConstraintBlockInputN,
  type NamedLinearCoordinateConstraintBlockN
} from './coordinate-constraint-system.js';
export {
  createSourceCellReferenceN,
  inspectSourceCellReferenceN,
  type SourceCellReferenceN,
  type SourceCellReferenceRetirementReason,
  type SourceCellReferenceStatusN
} from './source-reference.js';
export {
  createSourceEdgeCoordinateN,
  evaluateSourceEdgeCoordinateN,
  fitSourceEdgeCoordinateToProjectionN,
  projectPointToSourceEdgeN,
  type AvailableSourceEdgeProjectionFitN,
  type SourceEdgeCoordinateN,
  type SourceEdgeCoordinateOptions,
  type SourceEdgeProjectionFitFailureReason,
  type SourceEdgeProjectionFitN,
  type SourceEdgeProjectionFitOptions,
  type SourceEdgeProjectionN,
  type UnavailableSourceEdgeProjectionFitN
} from './source-edge-coordinate.js';
export {
  fitSourceEdgeCoordinateToObservationsN,
  type AvailableSourceEdgeObservationFitN,
  type SourceEdgeObservationDiagnosticN,
  type SourceEdgeObservationFitN,
  type SourceEdgeObservationFitOptions,
  type SourceEdgeProjectionObservationN,
  type UnavailableSourceEdgeObservationFitN
} from './source-edge-observations.js';
export {
  createSourceSimplexCoordinateN,
  createSourceSimplexReferenceN,
  evaluateSourceSimplexCoordinateN,
  fitSourceSimplexCoordinateToObservationsN,
  inspectSourceSimplexReferenceN,
  projectPointToSourceSimplexN,
  type AvailableSourceSimplexObservationFitN,
  type SourceSimplexCoordinateN,
  type SourceSimplexCoordinateOptions,
  type SourceSimplexObservationDiagnosticN,
  type SourceSimplexObservationFitFailureReason,
  type SourceSimplexObservationFitN,
  type SourceSimplexObservationFitOptions,
  type SourceSimplexProjectionN,
  type SourceSimplexProjectionObservationN,
  type SourceSimplexReferenceN,
  type UnavailableSourceSimplexObservationFitN
} from './source-simplex-coordinate.js';
export {
  affineSectionMapRecipe4,
  affineSliceChartMapRecipe4,
  createRepresentationLineageN,
  fieldRestrictionMapRecipe4,
  projectionMapRecipeN,
  type AffineSectionMapRecipe4,
  type AffineSliceChartMapRecipe4,
  type CustomProjectionMapRecipeN,
  type CoordinateProjectionMapRecipeN,
  type FieldRestrictionMapRecipe4,
  type OrthographicProjectionMapRecipeN,
  type PerspectiveProjectionMapRecipeN,
  type RayRealizationMapRecipe3,
  type RepresentationLineageN,
  type RepresentationMapRecipeN,
  type SampledIsosurfaceMapRecipe3
} from './map.js';
