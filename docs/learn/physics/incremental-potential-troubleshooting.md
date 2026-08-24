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

The default `warmStart` is `inertial-prediction`: the base is the prediction.
Every automatically selected base movement is first certified by the registered
step filters as one segment from the previous positions to the prediction, so
with a filter registered — as in every snippet on this page — the base can never
be installed past what the filters certify.

For an open barrier, the prediction may cross the boundary before minimization
begins. What happens depends on what is registered. With the barrier's paired
filter registered, the movement is `limited` to the certified prefix and the
step proceeds from that admissible base — the certification evidence is in
`result.warmStartCertification`. With **no** filter registered nothing certifies
the movement: an endpoint-inadmissible prediction is installed as the base and
returns `initial-state-refused`, and an endpoint-*feasible* far-side prediction
is installed uncertified — which is why the paired filter is required, not
optional. `warmStart: 'previous-positions'` begins at the last admissible live
state while retaining the inertial prediction as the objective's target.

If the previous positions are themselves inside a barrier's open boundary, the
filters cannot certify any movement from them (`indeterminate`), so no
automatic warm start moves — every step refuses until the state is repaired.
Repair it explicitly: pass `initialPositions`, the authoritative uncertified
bypass, or re-author the offending state.

When retaining some of the inertial prediction matters, select the opt-in
`feasible-inertial-prediction` policy. It evaluates the certified target,
validates the previous positions as an anchor, and samples geometrically
decreasing fractions of the certified chord until the complete objective
accepts one:

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
anchor-only result, and refusal of both target and anchor. With a filter
registered and a `limited` certification, the common evidence shape is
`target-feasible` in one trial — the chord's target is already the certified,
admissible prefix point; interior fractions appear when another law refuses
that point. This is a bounded initialization search, not depenetration,
collision response, a nearest-point projection, or proof that the unsampled
chord is feasible. Step filters certify the warm-start movement and every
later Armijo segment.

Repository measurements found genuine but contextual value: recovery rescued
one first-order open-domain solve that exhausted its budget from the previous
positions, while adding work to a simpler isolated barrier and to the same
scene under Newton-CG. Choose it when preserving an admissible part of the
prediction is useful; do not assume it is faster than `previous-positions`.

An explicit `initialPositions` array always wins over `warmStart`, and no
certification runs for it: the coordinates are the caller's own uncertified
decision. It is suitable for a caller with a more informed feasible initial
guess, for repairing an inadmissible authored state, and for exact fixtures.

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
| `converged-without-iteration` | The authored tolerance was satisfied at the base | Lower the tolerance only when the scene was expected to keep solving; under `'packed-gradient'`, re-author the stop test in a timestep-independent unit |
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

## "Every step reports `applied` and nothing moves"

Nothing is being concealed here, and there is no refusal to catch. Converging
at the warm start is a legitimate terminal, so the transaction applies a
converged iterate that happens to equal its base, and `applied` is the honest
report. What `applied` does **not** mean is that every physical force in the
scene exceeded the solver's resolution.

Under the default `'packed-gradient'` criterion the threshold is in mass·length,
because the objective folds `deltaTime²` into the potential. It therefore
resolves forces only down to `gradientTolerance / deltaTime²`. That floor
*rises* as the timestep falls, so refining the step makes the criterion less
sensitive to force, not more. A unit-mass particle under
a constant 1000 N force integrates to 1 m/s at `deltaTime = 5e-6` and produces
identically zero motion at `2e-6`, with every step of both runs reporting
`applied`. See
[what the stop test bounds](../theory/incremental-potentials#what-the-stop-test-bounds)
for the full table and the units it rests on.

The helper classifies this as `converged-without-iteration`. Three facts
separate an over-loose stop test from genuine rest:

| Fact | What it tells you |
| --- | --- |
| `convergenceKind` | Which criterion actually decided. Under anything but `'packed-gradient'`, the `gradientTolerance` fact is an inert echo that decided nothing |
| `convergenceResidualFinal` | What that criterion measured, in its own unit, to be compared against `convergenceTolerance` |
| `gradientNormFinal` | The packed-gradient norm, in mass·length, retained whichever criterion ran |

Two levers are named under `'packed-gradient'`: `'lower-gradient-tolerance'`,
which keeps the criterion and tightens it, and
`'timestep-independent-convergence'`, which re-authors the stop test in a unit
that does not move with the timestep:

```ts
import {
  diagnoseXpbdIncrementalPotentialStepN,
  stepXpbdIncrementalPotentialN
} from '@holotope/physics';

const attempt = stepXpbdIncrementalPotentialN({
  dimension,
  particles,
  providers,
  stepFilters,
  deltaTime: 1 / 2000,
  gravity,
  warmStart: 'previous-positions',
  minimization: {
    // length/time^2, and the same physical bound at every deltaTime.
    convergence: { kind: 'maximum-acceleration-residual', tolerance: 1e-3 }
  }
});

const diagnosed = diagnoseXpbdIncrementalPotentialStepN(attempt);
if (diagnosed.condition === 'converged-without-iteration') {
  console.log(
    diagnosed.facts.convergenceKind,
    diagnosed.facts.convergenceTolerance,
    diagnosed.facts.convergenceResidualFinal,
    diagnosed.facts.gradientNormFinal
  );
}
```

Under `'maximum-acceleration-residual'` the helper names only
`'lower-convergence-tolerance'`. That threshold is an acceleration and does not
move with the timestep, so the same terminal there is much stronger evidence of
actual rest — and naming a gradient tolerance to an author who never wrote one
would be advice about the wrong number.

Neither lever is applied for you, and neither is automatically right. A scene
genuinely at equilibrium produces exactly this condition too. The scene supplies
the intent; the helper supplies the units.

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

## "Friction weakens when I refine the timestep"

Per-step slip is `‖tangential velocity‖ · deltaTime`. Once that slip falls
inside the regularized branch the force is `forceLimit · slip / length`, so with
a fixed regularization **length** the force goes as `deltaTime`, one step's
impulse as `deltaTime²`, and a fixed horizon of `T / deltaTime` steps totals
`T · deltaTime`. Friction does not merely soften under refinement; it vanishes.

Measured over an eight-fold refinement on two scenes, the tangential impulse
falls to 0.133 of its coarse value, with the last halving at a ratio of 1.98
against the 2.00 the scaling predicts. That was confirmed through two
independent channels — force-side impulse and velocity-side energy — agreeing to
0.19%, and cross-checked against a momentum audit to `1e-4`.

`slipRegularization` written as a bare number is a world length, exactly as it
has always been, and is never reinterpreted as a velocity. To hold the
regularized branch over the same *speed* range at every timestep, author the
slip speed below which contact should be treated as stuck:

```ts
import type { XpbdSourceSimplexPairFrictionFamilyN } from '@holotope/physics';

// Compiled with slipRegularization: { kind: 'slip-velocity', velocity: 1e-2 }.
declare const frictionFamily: XpbdSourceSimplexPairFrictionFamilyN;
declare const interval: number;

// The length is resolved once, here, as velocity * deltaTime, and frozen into
// every lag this preparation returns.
const lags = frictionFamily.prepare({ deltaTime: interval });
console.log(lags.prepared.length, lags.skipped.length);
```

That resolution cancels `deltaTime` out of `slip / length` exactly. Under the
same eight-fold refinement the impulse holds to 1.06 of its coarse value, last
halving 0.99.

`deltaTime` is required at `prepare` under a slip velocity and refused under a
slip length. Accepting and ignoring it in the second case would leave an author
believing their length tracked the timestep, which is the belief that makes
friction disappear silently. Freezing the resolved length into the lag is what
keeps the term conservative across one solve: a length that moved mid-search
would leave Armijo minimizing a function whose own shape changed underneath it.

Three readings this does not license. A velocity-derived length is a smoothing
scale and nothing more — it is not evidence of static friction and not evidence
of finite-support retention. `regime` and `contactActive` are orthogonal:
`regime` is a statement about slip alone, `contactActive` is exactly
`forceLimit > 0`, and in the sheet probe 144 of 192 evaluations read `'sliding'`
while exerting exactly zero force, so a population statistic that does not
separate the two is mostly reporting on terms touching nothing. And total-energy
decay is not a measurement of friction work: an integrator loses energy at
`frictionCoefficient: 0`, and the measured zero-friction control drifts 0.0395%,
which is 24% of the smallest signal it would have to certify.
