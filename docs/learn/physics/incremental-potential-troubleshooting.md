# Troubleshooting incremental-potential steps

The integrated incremental-potential step is transactional: either a converged
state reaches the particles, or the complete pre-step particle state is
restored. A refusal is therefore useful evidence, not a partially applied
simulation update.

This guide gives a caller one debugging sequence:

1. inspect the typed terminal;
2. inspect progress without inventing a threshold;
3. ask the shared diagnosis helper which policies are legitimate to consider;
4. choose the policy explicitly.

## The step being diagnosed

<!-- doc-check: context -->

```ts
import type { VecN } from '@holotope/core';
import type {
  XpbdConservativeForceProviderN,
  XpbdIncrementalPotentialStepFilterN,
  XpbdParticleN
} from '@holotope/physics';

declare const dimension: number;
declare const particles: readonly XpbdParticleN[];
declare const providers: readonly XpbdConservativeForceProviderN[];
declare const stepFilters: readonly XpbdIncrementalPotentialStepFilterN[];
declare const gravity: VecN;
```

## Start with the result

```ts
import {
  diagnoseXpbdIncrementalPotentialStepN,
  stepXpbdIncrementalPotentialN
} from '@holotope/physics';

const result = stepXpbdIncrementalPotentialN({
  dimension,
  particles,
  providers,
  stepFilters,
  deltaTime: 1 / 120,
  gravity,
  warmStart: 'previous-positions',
  minimization: {
    directionPolicy: 'newton-cg'
  }
});

const diagnosis = diagnoseXpbdIncrementalPotentialStepN(result);
console.log(diagnosis.condition, diagnosis.facts, diagnosis.levers);
```

The helper is pure. Its `levers` are data for a caller or interface to present;
it never retries a step, changes a tolerance, or selects a policy.

## Choose the minimizer base deliberately

The default `warmStart` is `inertial-prediction`, preserving the original
numerics. It is a good base when the predicted state lies inside every potential
law's domain.

For an open barrier, the prediction may cross the boundary before minimization
begins. That returns `initial-state-refused`. Select
`warmStart: 'previous-positions'` to begin at the last admissible live state
while retaining the inertial prediction as the objective's target.

When retaining some of the inertial prediction matters, select the opt-in
`feasible-inertial-prediction` policy. It evaluates the prediction, validates
the previous positions as an anchor, and samples geometrically decreasing
fractions of the chord between them until the complete objective accepts one:

```ts
const recovered = stepXpbdIncrementalPotentialN({
  dimension,
  particles,
  providers,
  stepFilters,
  deltaTime: 1 / 120,
  gravity,
  warmStart: 'feasible-inertial-prediction',
  feasibleWarmStart: {
    contractionFactor: 0.5,
    maximumTrials: 24
  },
  minimization: {
    directionPolicy: 'newton-cg'
  }
});

console.log(recovered.feasibleBaseRecovery?.status);
console.log(recovered.feasibleBaseRecovery?.trials);
```

The retained trials distinguish a feasible target, a recovered fraction, an
anchor-only result, and refusal of both target and anchor. This is a bounded
initialization search, not depenetration, collision response, a nearest-point
projection, or proof that the unsampled chord is feasible. Step filters still
certify every later Armijo segment.

Repository measurements found genuine but contextual value: recovery rescued
one first-order open-domain solve that exhausted its budget from the previous
positions, while adding work to a simpler isolated barrier and to the same
scene under Newton-CG. Choose it when preserving an admissible part of the
prediction is useful; do not assume it is faster than `previous-positions`.

An explicit `initialPositions` array always wins over `warmStart`. It is suitable
for a caller with a more informed feasible initial guess, and for exact fixtures.

## Read progress before changing policy

Every result carries:

| Field | Meaning |
| --- | --- |
| `acceptedIterations` | Accepted minimizer steps, including those retained by a refused terminal |
| `displacementNorm` | Packed-coordinate distance from the minimizer base to its final accepted iterate |
| `objectiveDecrease` | Objective at the base minus objective at the final accepted iterate |
| `convergencePoint` | Whether convergence was declared at the base or after an accepted iterate |

These fields deliberately carry no "enough progress" threshold. A result with
zero iterations can describe genuine equilibrium. It can also reveal an
unexpectedly loose gradient tolerance in a scene that was expected to move. The
scene supplies that intent; the solver cannot infer it.

## Conditions and legitimate responses

| Condition | What it establishes | Levers the helper may name |
| --- | --- | --- |
| `initial-state-refused` | The base is outside an open potential domain | Previous-position warm start; bounded feasible-prediction recovery; repair the authored state |
| `converged-without-iteration` | The authored tolerance was satisfied at the base | Lower the tolerance only when the scene was expected to keep solving |
| `iteration-limit` | The accepted-step budget ended before convergence | Newton or mass-diagonal direction; larger iteration budget |
| `line-search-exhausted` | Armijo trials found no acceptable step | Newton or mass-diagonal direction |
| `line-search-refused` | A step filter could not certify a positive segment | Inspect the blocking filter; repair the authored state |
| `direction-refused` | The direction policy declined to propose a direction | Select another named direction policy |
| `stalled` | Float64 resolution or a non-descent direction stopped the search | Select another named direction policy |
| `application-refused` | Minimization converged but transactional validation rejected application | Inspect application evidence |
| `progressed` | A converged iterate reached the application boundary | No corrective lever |

The gradient tolerance is intentionally absent from every refusal row. Raising
it can transform a visible non-convergence into zero-iteration apparent success
without advancing the intended solve.

## A measured escalation

For the repository's dimension-independent point–plane contact scene, the
smallest working configuration is:

```ts
const stepOptions = {
  warmStart: 'previous-positions',
  minimization: {
    directionPolicy: 'newton-cg'
  }
} as const;
```

The same scene under steepest descent exhausts its iteration budget at contact,
and mass-diagonal scaling is identical to steepest descent because its particles
have uniform mass. This is a measured property of that scene, not a theorem that
Newton is the correct first choice for every objective.

See [The ND contact demo](./nd-contact-demo) for the comparison, its liveness
assertions, and the limits of the contact model.

## "My friction provider is refused by the world step"

The incremental-potential path accepts **conservative** providers only, and it
refuses registered velocity responses outright. That is deliberate: a velocity
response corrects state after a position solve, so it has no energy for a
minimizer to descend.

A lagged friction term is not an exception to that rule — it satisfies the
conservative contract for one frozen lag. Supply it through `preparedProviders`
rather than registering it on the world:

<!-- doc-check: skip — a call-shape fragment; the self-contained version is
     the cookbook's "Prepare, execute, inspect, and refresh a friction lag" -->

```ts
const preparation = friction.prepare();          // freeze one lag
const advance = stepXpbdIncrementalPotentialWorldN({
  world,
  deltaTime,
  stepFilters: contact.stepFilters,
  preparedProviders: preparation.prepared,        // transient, this step only
  warmStart: 'feasible-inertial-prediction'
});
if (advance.step.status === 'applied') preparation.markConsumed();
else preparation.rollback();
```

The world's authored registry stays authoritative and untouched; prepared ids
appear in `selection.preparedProviderIds`, separate from `selection.providerIds`,
so an authored scene term and a one-transaction lagged one are always
distinguishable. Colliding ids, duplicates, and particles the world does not
own are refused before anything is touched.
