import type { SimplexConstitutiveLawN } from './simplex-constitutive-family.js';
import {
  SIMPLEX_COMPRESSIBLE_NEO_HOOKEAN_LAW_ID,
  evaluateSimplexCompressibleNeoHookeanHessianVectorN,
  evaluateSimplexCompressibleNeoHookeanN,
  type SimplexCompressibleNeoHookeanEvaluationN,
  type SimplexCompressibleNeoHookeanMaterialN
} from './simplex-neo-hookean-material.js';
import {
  evaluateSimplexStVenantKirchhoffHessianVectorN,
  evaluateSimplexStVenantKirchhoffN,
  type SimplexStVenantKirchhoffEvaluationN,
  type SimplexStVenantKirchhoffMaterialN
} from './simplex-stvk-material.js';
import {
  SIMPLEX_MEASURE_BARRIER_LAW_ID,
  evaluateSimplexMeasureBarrierHessianVectorN,
  evaluateSimplexMeasureBarrierN,
  type SimplexMeasureBarrierEvaluationN,
  type SimplexMeasureBarrierMaterialN
} from './simplex-measure-barrier-material.js';

/** Immutable descriptor for the dimension-independent StVK reference law. */
export const simplexStVenantKirchhoffLawN: SimplexConstitutiveLawN<
  SimplexStVenantKirchhoffMaterialN,
  SimplexStVenantKirchhoffEvaluationN
> = Object.freeze({
  id: 'st-venant-kirchhoff',
  evaluate: evaluateSimplexStVenantKirchhoffN,
  evaluateHessianVector: evaluateSimplexStVenantKirchhoffHessianVectorN
});

/** Immutable descriptor for the compressible Neo-Hookean reference law. */
export const simplexCompressibleNeoHookeanLawN: SimplexConstitutiveLawN<
  SimplexCompressibleNeoHookeanMaterialN,
  SimplexCompressibleNeoHookeanEvaluationN
> = Object.freeze({
  id: SIMPLEX_COMPRESSIBLE_NEO_HOOKEAN_LAW_ID,
  evaluate: evaluateSimplexCompressibleNeoHookeanN,
  evaluateHessianVector:
    evaluateSimplexCompressibleNeoHookeanHessianVectorN
});

/** Immutable descriptor for the C2-clamped simplex lower-measure barrier. */
export const simplexMeasureBarrierLawN: SimplexConstitutiveLawN<
  SimplexMeasureBarrierMaterialN,
  SimplexMeasureBarrierEvaluationN
> = Object.freeze({
  id: SIMPLEX_MEASURE_BARRIER_LAW_ID,
  evaluate: evaluateSimplexMeasureBarrierN,
  evaluateHessianVector: evaluateSimplexMeasureBarrierHessianVectorN
});
