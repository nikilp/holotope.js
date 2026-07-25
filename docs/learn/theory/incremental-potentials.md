# Incremental potential objectives

An optimization time integrator does not immediately write a force into the
live state. It asks which candidate configuration minimizes a single objective
that combines inertia with conservative energy.

For candidate particle positions `q`, inertial predictions `qHat`, time step
`h`, dynamic masses `m_i`, and conservative energy `U(q)`, Holotope evaluates

\[
E(q)=\frac{1}{2}\sum_{i\ \mathrm{dynamic}}
m_i\lVert q_i-\widehat q_i\rVert^2+h^2U(q).
\]

This scaled form has the same stationary points as dividing the complete
objective by `h²`. It follows the Incremental Potential form for Backward
Euler in Li et al.,
[“Incremental Potential Contact” (2020), equation 1](https://ipc-sim.github.io/file/IPC-paper-fullRes.pdf),
with explicit external accelerations absorbed into `qHat` and without that
paper's contact, friction, or nonlinear-solver layers.

## Inertial prediction

`predictXpbdInertialStateN()` produces `qHat` without changing the particles:

\[
a_i=s_i g+w_i f_i,\qquad
\widehat q_i=q_i+h v_i+h^2a_i,
\]

where `s_i` is `gravityScale`, `w_i` is inverse mass, and `f_i` is the
particle's accumulated explicit force. Fixed particles retain their current
positions. Registered conservative force providers are intentionally omitted:
their trial-state energies belong in `U(q)`.

```ts
import {
  evaluateXpbdIncrementalPotentialN,
  predictXpbdInertialStateN
} from '@holotope/physics';

const prediction = predictXpbdInertialStateN({
  dimension: 4,
  particles,
  deltaTime: 1 / 60,
  gravity: [0, -9.81, 0, 0]
});

const evaluation = evaluateXpbdIncrementalPotentialN({
  dimension: 4,
  particles,
  positions: candidatePositions,
  predictedPositions: prediction.positions,
  deltaTime: prediction.deltaTime,
  providers: [elasticFamily, measureBarrierFamily]
});

console.log(evaluation.objective);
console.log(evaluation.gradientNorm);
```

The result separates `inertialObjective`,
`scaledConservativeObjective`, and the original physical
`conservativePotentialEnergy`. Its `gradients` are

\[
\nabla_iE=m_i(q_i-\widehat q_i)+h^2\nabla_iU
\]

for dynamic particles.

## Prescribed particles and reaction evidence

`inverseMass === 0` means that a particle coordinate is prescribed. It is not
represented by a large finite mass. Its candidate must exactly equal its
prediction, and its entry in the free-coordinate `gradients` array is zero.

The nested `potential` result still retains the complete `dU/dq`, including
the conservative reaction at prescribed particles. This keeps the optimizer's
free degrees of freedom separate from physically useful support evidence.

## Packed free-coordinate problems

`compileXpbdIncrementalPotentialProblemN()` creates a solver view without
replacing particle identity. Dynamic particles are packed in authored particle
order, with all RN axes contiguous. Prescribed particles occupy no packed
coordinate and are restored from the compiled inertial prediction.

```ts
import {
  compileXpbdIncrementalPotentialProblemN
} from '@holotope/physics';

const problem = compileXpbdIncrementalPotentialProblemN({
  dimension: 4,
  particles,
  predictedPositions: prediction.positions,
  deltaTime: prediction.deltaTime,
  providers: [elasticFamily, measureBarrierFamily]
});

const coordinates = problem.packPositions(candidatePositions);
const packed = problem.evaluate(coordinates);

console.log(problem.variableCount);
console.log(packed.objective, packed.gradient);
```

The compiler clones its prediction and records each particle's inverse mass.
It refuses evaluation if inverse mass later changes, because such a change
would invalidate the compiled free-coordinate map. It also retains a defensive
snapshot of position, velocity, force, inverse mass, and gravity scale for the
separate application boundary. `particleStatesBeforeStep()` returns copies of
that snapshot. Evaluation returns both the packed gradient and the complete
particle-space evidence.

## Safeguarded first-order backtracking

`searchXpbdIncrementalPotentialArmijoN()` evaluates a supplied descent
direction using the Armijo sufficient-decrease condition

\[
E(x+\alpha p)\leq E(x)+c\alpha\nabla E(x)^T p.
\]

```ts
import {
  searchXpbdIncrementalPotentialArmijoN
} from '@holotope/physics';

const base = problem.evaluate(coordinates);
const direction = Float64Array.from(
  base.gradient,
  (component) => -component
);
const search = searchXpbdIncrementalPotentialArmijoN({
  problem,
  coordinates,
  direction
});

if (search.status === 'accepted') {
  console.log(search.stepLength, search.accepted.objective);
}
```

The search returns `not-descent` without trials when
`dot(gradient, direction) >= 0`. Otherwise it records every accepted,
insufficient-decrease, or domain-refused trial.

Only `SimplexConstitutiveDomainErrorN` is recoverable during backtracking.
Collapse, inversion, non-positive measure, or crossing an authored
lower-measure boundary can therefore request a smaller step. Malformed
inputs, Float64 overflow, stale source lineage, and arbitrary provider errors
are rethrown rather than disguised as optimization difficulty. A typed domain
refusal at the base point is also rethrown because there is no valid state from
which to establish sufficient decrease.

## Bounded steepest-descent reference

`minimizeXpbdIncrementalPotentialN()` closes the first-order reference loop.
At each iterate it chooses the packed direction `p = -gradient` and delegates
acceptance to the Armijo search:

```ts
import {
  minimizeXpbdIncrementalPotentialN
} from '@holotope/physics';

const result = minimizeXpbdIncrementalPotentialN({
  problem,
  initialCoordinates: coordinates,
  gradientTolerance: 1e-8,
  maximumIterations: 128
});

console.log(result.status, result.final.gradientNorm);
for (const iteration of result.iterations) {
  console.log(
    iteration.index,
    iteration.stepNorm,
    iteration.objectiveDecrease,
    iteration.search.trials
  );
}
```

The result is one of `converged`, `iteration-limit`,
`line-search-exhausted`, or `stalled`. It retains the initial and final
evaluations and every Armijo-accepted iterate. Exhaustion includes the failed
search; a stall states whether Float64 coordinate resolution, objective
resolution, or a defensive non-descent result prevented further progress.

Convergence means only that the absolute packed-gradient norm is at or below
the authored tolerance. It is not a statement about a global minimum. The
routine validates all policy values even if the initial state is already
converged or the iteration budget is zero, and it does not catch malformed
provider evidence or an invalid base state. Every result retains the exact
compiled problem that produced it; this identity is used by the application
transaction below.

## Atomic result application

`applyXpbdIncrementalPotentialResultN()` is the first state-mutating boundary
in this ladder. It applies only a `converged` minimization result:

```ts
import {
  applyXpbdIncrementalPotentialResultN
} from '@holotope/physics';

const application = applyXpbdIncrementalPotentialResultN({
  result,
  velocityUpdate: 'backward-euler',
  clearForces: true
});

if (application.status === 'refused') {
  console.log(application.reason);
} else {
  console.log(application.verifiedFinal.objective);
}
```

With the default `backward-euler` policy, each dynamic velocity becomes

\[
v_{n+1}=\frac{q_{n+1}-q_n}{h},
\]

using the exact `q_n` captured when the problem was compiled. Fixed particles
receive their prescribed final positions but retain their authored velocities,
matching `XpbdWorldN`. The alternative `preserve` policy changes no velocity.
External force accumulators clear by default after a successful application;
`clearForces: false` leaves them under caller ownership.

Before writing, the application:

1. requires a converged terminal status;
2. proves every live particle field still equals the compilation snapshot;
3. reevaluates the final coordinates and compares position, objective, and
   free-gradient evidence with the stored result;
4. precomputes every position, velocity, and force and checks Float64
   arithmetic; and
5. commits all particles under a rollback snapshot.

Expected non-application states return `refused` with reason
`not-converged`, `stale-particle-state`, `stale-result-evidence`, or
`verification-mutated-particle-state`. Arbitrary provider and arithmetic
errors are not mislabeled, but any particle mutation made by a failing final
provider evaluation is restored before the error escapes. Reapplying the same
result normally returns `stale-particle-state`, because the first application
has advanced its particles.

## Run one transactional reference step

`stepXpbdIncrementalPotentialN()` composes prediction, problem compilation,
bounded minimization, verification, and application while retaining the
evidence from every layer:

```ts
import {
  stepXpbdIncrementalPotentialN
} from '@holotope/physics';

const step = stepXpbdIncrementalPotentialN({
  dimension: 4,
  particles,
  providers: [elasticFamily, measureBarrierFamily],
  deltaTime: 1 / 120,
  gravity: [0, -9.81, 0, 0],
  minimization: {
    gradientTolerance: 1e-8,
    maximumIterations: 128
  }
});

if (step.status === 'applied') {
  binding.writeSourcePositions();
} else {
  console.log(step.stage, step.reason, step.minimization.status);
}
```

The default initial iterate is the inertial prediction. `initialPositions`
provides an explicit warm start in particle order; fixed entries must still
equal their prescribed prediction. Application defaults remain
`backward-euler` velocity reconstruction and force clearing.

This is a transaction over the complete authored particle state. A typed
minimization or application refusal restores the state from before prediction.
Thrown provider, validation, arithmetic, and commit failures also restore that
state before escaping. This outer boundary protects callers even when a
malformed conservative provider mutates a live particle during an early trial
evaluation.

## Capability boundary

These APIs provide a deterministic Float64 objective, packed first derivative,
first-order sufficient-decrease search, and a bounded non-mutating
steepest-descent golden path, an explicit atomic state transition, and a
single-call transactional reference step. They do not:

- construct or project a Hessian or linear system;
- provide Newton, quasi-Newton, or preconditioned directions;
- apply `XpbdWorldN` velocity responses or state guards to the optimization
  path;
- perform IPC's continuous-collision-filtered line search;
- generate geometric contact-distance barriers;
- certify an intersection-free trajectory; or
- implement Incremental Potential Contact.

The minimizer is intended for small reference problems and differential
testing, not as the production path for large stiff systems. More advanced
solvers can consume the same problem without changing its mass, energy,
identity, and sign conventions.
