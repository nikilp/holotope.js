export { ProjectedEdgesGPU, type ProjectedEdgesGPUOptions } from './projected-edges-gpu.js';
export {
  ProjectedEdgesInstancedGPU,
  type ProjectedEdgesInstancedGPUOptions
} from './projected-edges-instanced-gpu.js';
export {
  ProjectedSurfaceGPU,
  type ProjectedSurfaceGPUOptions
} from './projected-surface-gpu.js';
export {
  SlicedComplexGPU,
  type SlicedComplexGPUOptions,
  type ComputeCapableRenderer
} from './sliced-complex-gpu.js';
export {
  QuaternionJuliaGPU,
  compareQuaternionJuliaGPU,
  type QuaternionJuliaGPUDifferential,
  type QuaternionJuliaGPURecordBatch
} from './quaternion-julia-gpu.js';
export {
  type ImplicitFieldNode4,
  type RaymarchedFieldStyle3D,
  type RaymarchedFieldStyleContext
} from './implicit-field-node4.js';
export { QuaternionJuliaNode4 } from './quaternion-julia-node.js';
export { BicomplexJuliaNode4 } from './bicomplex-julia-node.js';
export {
  RaymarchedField3D,
  type RaymarchedField3DOptions,
  type RaymarchedFieldIntersection
} from './raymarched-field.js';
export {
  intersectRaymarchedRepresentation,
  representationHitFromRaymarchedField
} from './representation-hit.js';
export {
  SettledSamplingState,
  SettledSupersampling3D,
  type RevisionSource,
  type SettledSupersampling3DOptions,
  type SettledSupersamplingMode
} from './settled-supersampling.js';
export {
  RaymarchedQuaternionJulia3D,
  type RaymarchedQuaternionJulia3DOptions
} from './raymarched-quaternion-julia.js';
export {
  BicomplexJuliaGPU,
  compareBicomplexJuliaGPU,
  type BicomplexJuliaGPUDifferential,
  type BicomplexJuliaGPURecordBatch,
  type ComplexQuadraticGPURecordBatch
} from './bicomplex-julia-gpu.js';
export {
  RaymarchedBicomplexJulia3D,
  type RaymarchedBicomplexJulia3DOptions
} from './raymarched-bicomplex-julia.js';
export { sliceToGpuUniforms, transformToGpuUniforms } from './convert.js';
