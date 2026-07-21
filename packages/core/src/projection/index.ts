export type {
  FibreProjection,
  HomogeneousProjection,
  HomogeneousProjectionPointN,
  HomogeneousProjectionValidity,
  PerspectiveProjectionStage,
  Projection,
  ProjectionDomainHalfSpaceN,
  ProjectionFibreDomainN,
  ProjectionFibreN
} from './types.js';
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
  sliceTetrahedra,
  sliceTetrahedraAmbient,
  type HyperplaneSlice4Options,
  type HyperplaneSlice4SetNormalOptions,
  type SliceFrameUpdatePolicy,
  type SliceVertexProvenanceBuffers
} from './slice.js';
export { CameraN } from './camera.js';
