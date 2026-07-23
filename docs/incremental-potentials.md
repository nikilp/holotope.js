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

## Capability boundary

This API is a deterministic Float64 objective and first-derivative reference.
It does not:

- construct or project a Hessian;
- pack free coordinates into a linear system;
- choose a descent direction or convergence tolerance;
- perform a filtered line search;
- generate geometric contact-distance barriers;
- certify an intersection-free trajectory; or
- implement Incremental Potential Contact.

Those policies can consume this objective without changing its mass, energy,
identity, and sign conventions.

