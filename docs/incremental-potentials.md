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
would invalidate the compiled free-coordinate map. Evaluation returns both the
packed gradient and the complete P24 particle-space evidence.

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

## Capability boundary

These APIs provide a deterministic Float64 objective, packed first derivative,
and first-order sufficient-decrease reference. They do not:

- construct or project a Hessian or linear system;
- choose a descent direction or convergence criterion;
- mutate or advance the live particle state;
- perform IPC's continuous-collision-filtered line search;
- generate geometric contact-distance barriers;
- certify an intersection-free trajectory; or
- implement Incremental Potential Contact.

Those policies can consume this objective without changing its mass, energy,
identity, and sign conventions.
