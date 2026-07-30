/** Dense reference policy for modifying provider-local potential curvature. */
export interface XpbdProviderLocalPsdCurvaturePolicyN {
  /** Explicit opt-in discriminator. */
  readonly kind: 'provider-local-psd';
  /** Relative tolerance used to audit reconstructed Hessian symmetry. */
  readonly symmetryTolerance?: number;
  /** Relative convergence tolerance forwarded to the dense eigensolver. */
  readonly eigensolverTolerance?: number;
  /** Maximum cyclic Jacobi sweeps per provider-local matrix. */
  readonly eigensolverMaximumSweeps?: number;
}

/**
 * Curvature used by analytic incremental-potential composition.
 *
 * `'exact'` is the default and preserves the providers' mathematical
 * Hessians. Provider-local PSD is an explicit modified-Newton policy: it
 * reconstructs each provider's dense local Hessian, audits symmetry, and
 * clamps negative eigenvalues to zero before applying it.
 */
export type XpbdIncrementalPotentialCurvaturePolicyN =
  | 'exact'
  | XpbdProviderLocalPsdCurvaturePolicyN;

/** Normalized policy name retained in result evidence. */
export type XpbdIncrementalPotentialCurvaturePolicyKindN =
  | 'exact'
  | 'provider-local-psd';

/** Evidence for one unchanged exact provider product. */
export interface XpbdConservativeExactCurvatureApplicationN {
  /** Confirms the mathematical provider HVP was used unchanged. */
  readonly kind: 'exact';
  /** One provider HVP evaluates the requested direction. */
  readonly operatorEvaluations: 1;
}

/** Evidence for one dense provider-local PSD projection. */
export interface XpbdConservativeProviderLocalPsdApplicationN {
  /** Confirms that negative local eigenvalues were clamped to zero. */
  readonly kind: 'provider-local-psd';
  /** Scalar variables in provider particle-major, axis-minor order. */
  readonly localVariableCount: number;
  /** One provider HVP per local basis vector. */
  readonly operatorEvaluations: number;
  /** Eigenvalues of the audited symmetric local Hessian, ascending. */
  readonly rawEigenvalues: Float64Array;
  /** `max(rawEigenvalues[i], 0)` in the same order. */
  readonly projectedEigenvalues: Float64Array;
  /** Number of strictly negative raw eigenvalues that were clamped. */
  readonly clippedEigenvalueCount: number;
  /** Maximum absolute skew divided by the local matrix scale. */
  readonly relativeSymmetryError: number;
  /** Largest eigensystem residual reported by the dense CPU reference. */
  readonly eigensystemMaxResidual: number;
  /** Maximum absolute entry of `VᵀV - I`. */
  readonly eigensystemOrthogonalityError: number;
}

/** Provider-local curvature construction attached to product evidence. */
export type XpbdConservativeCurvatureApplicationN =
  | XpbdConservativeExactCurvatureApplicationN
  | XpbdConservativeProviderLocalPsdApplicationN;
