export {
  createFoldedE8Roots,
  createFoldedE8Shells,
  doubledIcosianNorm,
  e8BaseChange,
  e8IntegerRoots,
  e8IntegerSecondShell,
  e8IntegerVectorsThroughNorm,
  e8IntegerToIcosian,
  e8InnerProduct,
  e8QuadraticNorm,
  e8RootOrbit,
  evaluatePhi,
  icosianE8Data,
  icosianToE8Integer,
  type DoubledE8Vector,
  type DoubledIcosian,
  type E8BaseChange,
  type E8EdgeClass,
  type E8RootShell,
  type FoldedE8Options,
  type FoldedE8ShellOptions,
  type IcosianE8Data,
  type PhiEmbedding
} from './e8.js';
export {
  ConvexWindow,
  FlatN,
  LatticeN,
  ModelSet,
  type CoefficientBoxSampleOptions,
  type CoefficientRange,
  type ExactHalfspace,
  type FlatNOptions,
  type ModelSetBoxSampleOptions,
  type ModelPoint,
  type ModelSetPatch,
  type ModelSetSampleOptions,
  type ModelSetWindowPrunedEnumeration,
  type ModelSetWindowPrunedSampleOptions,
  type WindowBoundaryPolicy,
  type WindowLocation
} from './model-set.js';
export {
  createFibonacciModelSet,
  fibonacciPatch,
  fibonacciSubstitutionPrefix,
  type FibonacciPatch,
  type FibonacciTile
} from './fibonacci.js';
export {
  ammannBeenkerInflate,
  ammannBeenkerInflationFactors,
  ammannBeenkerPatch,
  ammannBeenkerRotate45,
  createAmmannBeenkerModelSet,
  type AmmannBeenkerCoefficients,
  type AmmannBeenkerModelSetOptions,
  type AmmannBeenkerPatch,
  type AmmannBeenkerPatchOptions,
  type AmmannBeenkerPhasonOffset
} from './ammann-beenker.js';
export {
  aknEdgeLength,
  aknPatch,
  aknRotate3,
  aknRotate5,
  aknWindowHalfspaces,
  createAKNModelSet,
  type AKNModelSetOptions,
  type AKNCoefficients,
  type AKNPatch,
  type AKNPatchOptions,
  type AKNPhasonOffset
} from './akn.js';
/**
 * The golden-ratio ring the AKN and Elser–Sloane constructions are stated over.
 *
 * Surfaced here because the coordinates every function above returns are its
 * values: `phiConjugate` already sits on this barrel, and a caller holding one
 * without the ring that defines its arithmetic can inspect a coordinate but not
 * combine two.
 */
export { phiRing } from '../coxeter/exact.js';
export {
  PenroseModelSet,
  createPenroseModelSet,
  penroseCartesian,
  penroseDefaultPhason,
  penrosePatch,
  penroseRotate72,
  penroseUnitPentagon,
  penroseVertexStarCensus,
  penroseVertexStarKey,
  penroseWindowVertices,
  type PenroseCoefficients,
  type PenroseModelPoint,
  type PenroseModelSetOptions,
  type PenroseModelSetPatch,
  type PenrosePatch,
  type PenrosePatchOptions,
  type PenrosePhasonOffset,
  type PenroseVertexStarCensusOptions,
  type PenroseWindowClass,
  type ExactPair
} from './penrose.js';
export {
  classifyElserSloaneIcosian,
  createElserSloaneGermComplex,
  createElserSloaneModelSet,
  createElserSloaneWindow,
  elserSloaneCoefficients,
  elserSloaneDeflate,
  elserSloaneGerm,
  elserSloaneGaloisProduct,
  elserSloaneInflate,
  elserSloaneInflationMatrix,
  elserSloaneInternalCoordinate,
  elserSloaneLatticeBasis,
  elserSloaneNormPatch,
  elserSloanePatch,
  elserSloaneSection,
  elserSloaneSectionEdges,
  elserSloaneWindowHalfspaces,
  elserSloaneWindowVertices,
  phiConjugate,
  type ElserSloaneGerm,
  type ElserSloaneGermComplexOptions,
  type ElserSloaneGermPoint,
  type ElserSloaneModelSetOptions,
  type ElserSloanePatch,
  type ElserSloaneNormPatchOptions,
  type ElserSloanePatchOptions,
  type ElserSloanePhasonOffset,
  type ElserSloaneSourceShell
} from './elser-sloane.js';
