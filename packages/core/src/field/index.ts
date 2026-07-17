export {
  evaluateComplexQuadratic,
  resolveQuadraticOptions,
  type Complex2,
  type ComplexQuadraticEvaluation,
  type QuadraticIterationOptions,
  type ResolvedQuadraticIterationOptions
} from './complex-quadratic.js';
export {
  QuaternionJuliaField,
  rotateQuaternionJuliaSymmetry,
  type QuaternionJuliaEvaluation,
  type QuaternionJuliaOptions
} from './quaternion-julia.js';
export {
  BicomplexJuliaField,
  bicomplexToIdempotent,
  idempotentToBicomplex,
  type BicomplexIdempotentPair,
  type BicomplexJuliaEvaluation,
  type BicomplexJuliaOptions
} from './bicomplex-julia.js';
export {
  sampleFieldPoints4,
  sampleFieldSlice3,
  type FieldSampleBatch,
  type GridShape3,
  type Point3,
  type SampledFieldSlice3,
  type SampleFieldSlice3Options
} from './sample.js';
export {
  extractSampledIsosurface3,
  type ExtractedIsosurface3
} from './isosurface.js';
export {
  traceFieldSliceRay3,
  type FieldSliceRayHit3,
  type FieldSliceRayMiss3,
  type FieldSliceRayResult3,
  type TraceFieldSliceRay3Options
} from './ray.js';
export {
  containsTricomplexPlatonicSlice3,
  evaluateTricomplexMandelbrotSlice3,
  tricomplexMandelbrotComponents3,
  tricomplexPlatonicSlice3,
  tricomplexPlatonicValue3,
  type RealMandelbrotParameterEvaluation,
  type TricomplexMandelbrotSliceEvaluation3,
  type TricomplexPlatonicSlice3Id,
  type TricomplexPlatonicSlice3Spec
} from './tricomplex-platonic.js';
export {
  type DistanceCertificate,
  type DistanceEstimatorDeclaration,
  type FieldEvaluation4,
  type FieldSliceTheorem4,
  type FieldSymmetry4,
  type ImplicitField4,
  type Vec4f64
} from './types.js';
