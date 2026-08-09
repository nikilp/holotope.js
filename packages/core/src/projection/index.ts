export type {
  DisplayMap3D,
  DisplayMapInverse3D,
  DisplayMapInvertOptions,
  FibreProjection,
  HomogeneousProjection,
  HomogeneousProjectionPointN,
  HomogeneousProjectionValidity,
  InvertibleDisplayMap3D,
  PerspectiveProjectionStage,
  Projection,
  ProjectionDomainHalfSpaceN,
  ProjectionFibreDomainN,
  ProjectionFibreN
} from './types.js';
export { PlaneEmbedding3D, isInvertibleDisplayMap3D } from './embedding.js';
export {
  evaluateProjectionFibre,
  isHomogeneousProjection,
  isPointInProjectionFibreDomain,
  projectionDomainMargin
} from './fibre.js';
export {
  liftHomogeneousSimplexPointN,
  type ExactHomogeneousSimplexLiftN,
  type HomogeneousSimplexLiftFailureReason,
  type HomogeneousSimplexLiftN,
  type HomogeneousSimplexLiftOptions,
  type HomogeneousSimplexVertexN,
  type UnavailableHomogeneousSimplexLiftN
} from './lift.js';
export { PerspectiveProjection, type PerspectiveProjectionOptions } from './perspective.js';
export { OrthographicProjection, type OrthographicProjectionOptions } from './orthographic.js';
export {
  CoordinateProjection,
  type CoordinateProjectionAxes,
  type CoordinateProjectionOptions
} from './coordinate.js';
export {
  HyperplaneSlice4,
  HyperplaneSliceN,
  sliceTetrahedra,
  sliceTetrahedraAmbient,
  type HyperplaneSlice4Options,
  type HyperplaneSlice4SetNormalOptions,
  type HyperplaneSliceNOptions,
  type SliceFrameUpdatePolicy,
  type SliceVertexProvenanceBuffers
} from './slice.js';
export {
  sectionSimplexGroupN,
  type SectionSimplexGroupNDiagnosticsN,
  type SectionSimplexGroupNOptions,
  type SectionSimplexGroupNResultN,
  type SourceAffineLineageN
} from './section.js';
export { CameraN } from './camera.js';
