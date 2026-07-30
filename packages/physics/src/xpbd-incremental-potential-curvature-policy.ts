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

/** Dense reference policy for PSD-projecting provider-declared local blocks. */
export interface XpbdProviderBlockPsdCurvaturePolicyN {
  /** Explicit block-local opt-in discriminator. */
  readonly kind: 'provider-block-psd';
  /** Relative tolerance used to audit every reconstructed block's symmetry. */
  readonly symmetryTolerance?: number;
  /** Relative tolerance for raw block assembly against the aggregate HVP. */
  readonly decompositionTolerance?: number;
  /** Relative convergence tolerance forwarded to each dense eigensolve. */
  readonly eigensolverTolerance?: number;
  /** Maximum cyclic Jacobi sweeps for each local block. */
  readonly eigensolverMaximumSweeps?: number;
}

/**
 * Curvature used by analytic incremental-potential composition.
 *
 * `'exact'` is the default and preserves the providers' mathematical
 * Hessians. Provider-local PSD reconstructs one dense matrix per provider.
 * Provider-block PSD instead projects an exact provider-authored additive
 * decomposition, falling back visibly to one implicit provider block when no
 * finer decomposition exists.
 */
export type XpbdIncrementalPotentialCurvaturePolicyN =
  | 'exact'
  | XpbdProviderLocalPsdCurvaturePolicyN
  | XpbdProviderBlockPsdCurvaturePolicyN;

/** Normalized policy name retained in result evidence. */
export type XpbdIncrementalPotentialCurvaturePolicyKindN =
  | 'exact'
  | 'provider-local-psd'
  | 'provider-block-psd';

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

/** Spectral evidence for one PSD-projected provider curvature block. */
export interface XpbdConservativePsdBlockApplicationN {
  /** Stable identity unique within the owning provider. */
  readonly blockId: string;
  /** Stable particle ids in block product order. */
  readonly particleIds: readonly string[];
  /** Scalar variables in block particle-major, axis-minor order. */
  readonly localVariableCount: number;
  /** One exact block HVP per local basis vector. */
  readonly operatorEvaluations: number;
  /** Eigenvalues of the audited symmetric block Hessian, ascending. */
  readonly rawEigenvalues: Float64Array;
  /** `max(rawEigenvalues[i], 0)` in the same order. */
  readonly projectedEigenvalues: Float64Array;
  /** Number of strictly negative block eigenvalues that were clamped. */
  readonly clippedEigenvalueCount: number;
  /** Maximum absolute block skew divided by its matrix scale. */
  readonly relativeSymmetryError: number;
  /** Largest block eigensystem residual from the dense CPU reference. */
  readonly eigensystemMaxResidual: number;
  /** Maximum absolute entry of the block's `VᵀV - I`. */
  readonly eigensystemOrthogonalityError: number;
}

/** Evidence for PSD projection over declared or implicit provider blocks. */
export interface XpbdConservativeProviderBlockPsdApplicationN {
  /** Confirms block-local rather than whole-provider projection. */
  readonly kind: 'provider-block-psd';
  /** Whether the provider supplied a finer sum or formed one implicit block. */
  readonly decomposition: 'declared' | 'implicit-provider';
  /** Number of independently projected blocks. */
  readonly blockCount: number;
  /** Sum of basis HVPs plus one exact aggregate audit HVP. */
  readonly operatorEvaluations: number;
  /** Relative norm error of raw block assembly against the aggregate HVP. */
  readonly rawAssemblyRelativeError: number;
  /** Source-ordered spectral evidence for every projected block. */
  readonly blocks: readonly XpbdConservativePsdBlockApplicationN[];
}

/** Provider-local curvature construction attached to product evidence. */
export type XpbdConservativeCurvatureApplicationN =
  | XpbdConservativeExactCurvatureApplicationN
  | XpbdConservativeProviderLocalPsdApplicationN
  | XpbdConservativeProviderBlockPsdApplicationN;
