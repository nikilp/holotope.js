import type { SimplexConstitutiveLawN } from './simplex-constitutive-family.js';
import {
  SIMPLEX_COMPRESSIBLE_NEO_HOOKEAN_LAW_ID,
  evaluateSimplexCompressibleNeoHookeanN,
  type SimplexCompressibleNeoHookeanEvaluationN,
  type SimplexCompressibleNeoHookeanMaterialN
} from './simplex-neo-hookean-material.js';
import {
  evaluateSimplexStVenantKirchhoffN,
  type SimplexStVenantKirchhoffEvaluationN,
  type SimplexStVenantKirchhoffMaterialN
} from './simplex-stvk-material.js';

/** Immutable descriptor for the dimension-independent StVK reference law. */
export const simplexStVenantKirchhoffLawN: SimplexConstitutiveLawN<
  SimplexStVenantKirchhoffMaterialN,
  SimplexStVenantKirchhoffEvaluationN
> = Object.freeze({
  id: 'st-venant-kirchhoff',
  evaluate: evaluateSimplexStVenantKirchhoffN
});

/** Immutable descriptor for the compressible Neo-Hookean reference law. */
export const simplexCompressibleNeoHookeanLawN: SimplexConstitutiveLawN<
  SimplexCompressibleNeoHookeanMaterialN,
  SimplexCompressibleNeoHookeanEvaluationN
> = Object.freeze({
  id: SIMPLEX_COMPRESSIBLE_NEO_HOOKEAN_LAW_ID,
  evaluate: evaluateSimplexCompressibleNeoHookeanN
});
