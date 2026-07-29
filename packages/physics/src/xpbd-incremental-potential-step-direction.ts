import type {
  XpbdIncrementalPotentialDirectionPolicyN,
  XpbdIncrementalPotentialDirectionPolicyNameN
} from './xpbd-incremental-potential-direction.js';
import type {
  XpbdIncrementalPotentialProblemN
} from './xpbd-incremental-potential-problem.js';

interface XpbdIncrementalPotentialStepDirectionChoiceN {
  readonly directionPolicy?:
    | XpbdIncrementalPotentialDirectionPolicyN
    | XpbdIncrementalPotentialDirectionPolicyNameN;
  readonly directionPolicyFactory?: (
    problem: XpbdIncrementalPotentialProblemN
  ) => XpbdIncrementalPotentialDirectionPolicyN;
}

/**
 * Resolves the direct or problem-dependent direction seam for an integrated step.
 *
 * Kept outside the step module so both public policy fields have an explicit
 * consumer and one place owns their mutual-exclusion invariant.
 */
export function resolveXpbdIncrementalPotentialStepDirectionN(
  policy: XpbdIncrementalPotentialStepDirectionChoiceN | undefined,
  problem: XpbdIncrementalPotentialProblemN,
  caller: string
):
  | XpbdIncrementalPotentialDirectionPolicyN
  | XpbdIncrementalPotentialDirectionPolicyNameN
  | undefined {
  if (
    policy?.directionPolicy !== undefined &&
    policy.directionPolicyFactory !== undefined
  ) {
    throw new Error(
      `${caller}: minimization.directionPolicy and directionPolicyFactory ` +
        'are mutually exclusive'
    );
  }
  return policy?.directionPolicyFactory === undefined
    ? policy?.directionPolicy
    : policy.directionPolicyFactory(problem);
}
