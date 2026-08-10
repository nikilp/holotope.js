/**
 * Reader for {@link LaggedFrictionContractReport}.
 *
 * Deliberately a separate module: every field of that report is consumed here,
 * which is what makes the report evidence rather than decoration. A field
 * nothing reads cannot influence a decision.
 */
import type { LaggedFrictionContractReport } from './lagged-pair-friction-contract.js';

/**
 * Renders one report as the lines a caller would actually log, which is also
 * what makes every reported field load-bearing rather than decorative.
 */
export function summarizeLaggedFrictionContract(
  report: LaggedFrictionContractReport
): readonly string[] {
  return [
    `terms prepared: ${report.preparedTerms}` +
      (report.skipped.length === 0
        ? ''
        : ` (skipped ${report.skipped.map((skip) => skip.reason).join(', ')})`),
    // Regime and activity are printed together and labelled apart, because a
    // term reports a regime from its slip whether or not it can exert any
    // force at all. Reading the regime alone invites the reverse conclusion.
    `at rest: ${report.restingRegime}; displaced: ${report.slidingRegime} ` +
      `(contact ${report.slidingContactActive ? 'active' : 'inert'}, ` +
      `regularized below ${report.regularizationLength.toExponential(3)})`,
    `slip ${report.slidingSlip.toExponential(3)}, ` +
      `off-plane ${report.slipNormalComponent.toExponential(3)}`,
    `Coulomb bound ${report.forceLimit.toExponential(3)} from lagged normal ` +
      `${report.laggedNormalForce.toExponential(3)}; ` +
      `saturation residual ${report.saturationResidual.toExponential(3)}`,
    `base distance ${report.baseDistance.toFixed(6)} ` +
      `(witness separation ${report.baseWitnessSeparation.toFixed(6)}), ` +
      `uniqueness margin ${report.uniquenessGap.toExponential(3)}`,
    `authored providers [${report.authoredProviderIds.join(', ')}] + ` +
      `prepared [${report.preparedProviderIds.join(', ')}]`,
    `step ${report.stepStatus}; lag now ${report.lagStateAfterStep}`,
    `a parallel pair refuses with: ${report.refusalReason}`
  ];
}
