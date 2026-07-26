# Incremental potential objectives

An optimization time integrator does not immediately write a force into the
live state. It asks which candidate configuration minimizes a single objective
that combines inertia with conservative energy.

For candidate particle positions `q`, inertial predictions `qHat`, time step
`h`, dynamic masses `m_i`, and conservative energy `U(q)`, Holotope evaluates

$$
E(q)=\frac{1}{2}\sum_{i\ \mathrm{dynamic}}
m_i\lVert q_i-\widehat q_i\rVert^2+h^2U(q).
$$

This scaled form has the same stationary points as dividing the complete
objective by `h²`. It follows the Incremental Potential form for Backward
Euler in Li et al.,
[“Incremental Potential Contact” (2020), equation 1](https://ipc-sim.github.io/file/IPC-paper-fullRes.pdf),
with explicit external accelerations absorbed into `qHat` and without that
paper's contact, friction, or nonlinear-solver layers.

## Inertial prediction

`predictXpbdInertialStateN()` produces `qHat` without changing the particles:

$$
a_i=s_i g+w_i f_i,\qquad
\widehat q_i=q_i+h v_i+h^2a_i,
$$

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

$$
\nabla_iE=m_i(q_i-\widehat q_i)+h^2\nabla_iU
$$

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

$$
E(x+\alpha p)\leq E(x)+c\alpha\nabla E(x)^T p.
$$

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

Only `XpbdPotentialDomainErrorN` is recoverable during backtracking.
`SimplexConstitutiveDomainErrorN` specializes that common type, as do
open-distance barriers. Collapse, inversion, non-positive measure, or crossing
an authored lower boundary can therefore request a smaller step. Malformed
inputs, Float64 overflow, stale source lineage, and arbitrary provider errors
are rethrown rather than disguised as optimization difficulty. A typed domain
refusal at the base point is also rethrown because there is no valid state from
which to establish sufficient decrease.

## Scalar and particle–hyperplane barriers

`evaluateClampedLogBarrier()` exposes the dimension-independent scalar law

$$
b(d;\widehat d)=
\begin{cases}
-\kappa(d-\widehat d)^2\log(d/\widehat d),
  &0<d<\widehat d,\\
0,&d\geq\widehat d,
\end{cases}
$$

together with its analytic first and second derivatives. The open boundary
`d = 0` is deliberately outside the evaluator's domain. At and above the
activation coordinate, value and both derivatives are exactly zero. The same
scalar kernel supplies the simplex lower-measure barrier and contact-distance
providers, so they share one curvature and boundary convention.

`XpbdParticleHyperplaneBarrierN` composes the scalar law with the affine signed
distance from an RN point to an oriented hyperplane:

$$
d(q)=n^Tq-o-d_{\min},\qquad
\widehat d=d_{\mathrm{active}}-d_{\min}.
$$

Because `HyperplaneColliderN` stores a unit normal, both authored distances are
world-space lengths. The conservative force is

$$
f(q)=-b'(d(q);\widehat d)n.
$$

```ts
import {
  HyperplaneColliderN,
  XpbdParticleHyperplaneBarrierN
} from '@holotope/physics';

const floorBarrier = new XpbdParticleHyperplaneBarrierN({
  id: 'floor/point-0',
  particle,
  plane: new HyperplaneColliderN([0, 1, 0, 0], 0),
  minimumDistance: 0.01,
  activationDistance: 0.1,
  stiffness: 250
});

const sample = floorBarrier.evaluate();
console.log(sample.potentialEnergy, sample.forces[0]);
```

The provider implements both live `evaluate()` and non-mutating
`evaluateAt(positionOf)`, so it can be used by `XpbdWorldN` or placed directly
in an incremental-potential problem. A candidate at or below
`minimumDistance` raises a typed potential-domain refusal that Armijo can
backtrack.

A barrier potential is proactive contact energy, not by itself a proof of
intersection-free motion. Such a guarantee also needs a valid initial state,
complete collision candidates, and a collision-free step policy. This layer
does not silently claim those surrounding conditions.

## Collision-free search prefixes

`XpbdIncrementalPotentialStepFilterN` is the explicit seam between a proposed
line-search segment and an admissible prefix. A filter sees defensive
particle-space positions at the base and requested endpoint. It returns:

- `safe` when the entire segment is certified;
- `limited` with a smaller maximum step;
- `indeterminate` when it cannot certify the segment.

`indeterminate` is a refusal, not a collision miss. Multiple filters compose
in authored order by taking the smallest certified step. Armijo retains every
filter result and begins its ordinary sufficient-decrease trials from that
step. A refusal becomes `step-filter-refused`; the minimizer reports
`line-search-refused` rather than mislabelling it as numerical exhaustion.

For a point–static-hyperplane barrier, the signed open-domain margin along a
line-search segment is affine:

$$
g(\tau)=(1-\tau)g_0+\tau g_1,\qquad 0\leq\tau\leq1.
$$

If `g0 > 0` and `g1 <= 0`, the exact boundary fraction is

$$
\tau_{\mathrm{impact}}=\frac{g_0}{g_0-g_1}.
$$

`XpbdParticleHyperplaneBarrierStepFilterN` retains a strict fraction of that
impact step:

```ts
import {
  XpbdParticleHyperplaneBarrierStepFilterN,
  compileXpbdIncrementalPotentialProblemN
} from '@holotope/physics';

const floorFilter = new XpbdParticleHyperplaneBarrierStepFilterN({
  id: 'floor/point-0/step-filter',
  barrier: floorBarrier,
  conservativeScale: 0.9
});

const problem = compileXpbdIncrementalPotentialProblemN({
  dimension: 4,
  particles,
  predictedPositions,
  deltaTime,
  providers: [material, floorBarrier],
  stepFilters: [floorFilter]
});
```

This calculation is exact for the registered RN point and static hyperplane.
It does not generate missing collision pairs or certify unregistered geometry.
A global collision-free claim still requires a valid initial state and a
complete set of relevant filters.

### Source-indexed point–plane families

`XpbdParticleHyperplaneBarrierFamilyN` lifts the single-point construction over
an existing `XpbdParticleHyperplaneFamilyN`. The normal family remains the
authoritative mapping from each `CellComplex` vertex ordinal to its exact
particle, plane, and clearance. The barrier family reuses that mapping and
compiles one energy provider plus its paired admissible-step filter per source
vertex.

The normal projection constraints, conservative barriers, and velocity-level
friction are therefore independent policies over one geometric definition.
Compiling a barrier family does not implicitly register the normal constraints.

```ts
import {
  compileXpbdParticleHyperplaneBarrierFamilyN
} from '@holotope/physics';

const floorBarriers = compileXpbdParticleHyperplaneBarrierFamilyN({
  id: 'floor/barriers',
  contacts: floorContacts,
  activationDistance: (vertex) => vertex.minimumDistance + 0.1,
  stiffness: 250,
  conservativeScale: 0.9
});

const problem = compileXpbdIncrementalPotentialProblemN({
  dimension: 4,
  particles,
  predictedPositions,
  deltaTime,
  ...floorBarriers.incrementalPotentialTerms()
});
```

The returned provider and filter arrays are frozen and source-ordered. Optional
base terms are retained first, so material providers and multiple barrier
families can be composed without mutating their arrays. Pairing the arrays
behind `incrementalPotentialTerms()` makes omission of a matching filter less
likely while leaving both inspectable. This is still an authored
vertex–static-plane family, not automatic mesh contact generation.

## Bounded first-order reference

`minimizeXpbdIncrementalPotentialN()` closes the first-order reference loop.
By default each iterate uses the packed direction `p = -gradient` and delegates
acceptance to the Armijo search. The direction choice is an explicit policy:

```ts
import {
  minimizeXpbdIncrementalPotentialN,
  xpbdMassPreconditionedDirectionN
} from '@holotope/physics';

const result = minimizeXpbdIncrementalPotentialN({
  problem,
  initialCoordinates: coordinates,
  directionPolicy: xpbdMassPreconditionedDirectionN,
  gradientTolerance: 1e-8,
  maximumIterations: 128
});

console.log(
  result.status,
  result.directionPolicyId,
  result.final.gradientNorm
);
for (const iteration of result.iterations) {
  console.log(
    iteration.index,
    iteration.stepNorm,
    iteration.objectiveDecrease,
    iteration.search.trials
  );
}
```

`xpbdSteepestDescentDirectionN` is the default and preserves the original
golden path. `xpbdMassPreconditionedDirectionN` computes

$$
p_{i,a}=-w_i\,g_{i,a},
$$

where $w_i$ is the inverse mass of free particle $i$. This is the exact
inverse of the diagonal inertial block, repeated across every RN axis. It is a
first-order preconditioner, not a material Hessian or Newton direction. Armijo
still decides whether any proposed step is acceptable.

Custom `XpbdIncrementalPotentialDirectionPolicyN` implementations receive
defensive copies of the packed coordinates, gradient, free-particle indices,
and inverse masses. Their finite output must exactly match the packed variable
count. Policy identity is retained on the complete result and every accepted
iteration. A zero or ascent direction retains the existing
`stalled/not-descent` evidence rather than being silently repaired.

The result is one of `converged`, `iteration-limit`,
`line-search-exhausted`, `line-search-refused`, or `stalled`. It retains the
initial and final evaluations and every Armijo-accepted iterate. Exhaustion
includes the failed search; refusal preserves the blocking step filter; a
stall states whether Float64 coordinate resolution, objective resolution, or a
defensive non-descent result prevented further progress.

Convergence means only that the absolute packed-gradient norm is at or below
the authored tolerance. It is not a statement about a global minimum. The
routine validates all policy values even if the initial state is already
converged or the iteration budget is zero, and it does not catch malformed
provider evidence or an invalid base state. Every result retains the exact
compiled problem that produced it; this identity is used by the application
transaction below.

## Matrix-free curvature reference

`estimateXpbdIncrementalPotentialHessianVectorN()` differentiates the complete
packed gradient along one supplied direction without assembling a matrix:

$$
H(x)v\approx
\frac{\nabla E(x+h v)-\nabla E(x-h v)}{2h}.
$$

```ts
import {
  estimateXpbdIncrementalPotentialHessianVectorN
} from '@holotope/physics';

const curvature =
  estimateXpbdIncrementalPotentialHessianVectorN({
    problem,
    coordinates: packed.coordinates,
    direction
  });

if (curvature.status === 'evaluated') {
  console.log(curvature.product, curvature.quadraticForm);
}
```

The default parameter-space step makes the coordinate perturbation
scale-relative:

$$
h=\sqrt[3]{\epsilon}\,
\frac{\max(1,\lVert x\rVert_2)}{\lVert v\rVert_2},
$$

where $\epsilon$ is `Number.EPSILON`. Callers may instead supply an explicit
positive step for convergence studies. The result retains the base evaluation
and both signed probe evaluations, the defensive direction copy, `Hv`, and
the directional curvature `vᵀHv`.

A zero direction returns exact zero evidence without offset probes. If
Float64 rounds away any requested nonzero coordinate displacement, the result
is `indeterminate/coordinate-resolution`. If an offset leaves a registered
potential's open mathematical domain, the result is `probe-refused` with the
signed side and typed law evidence. An invalid base state and ordinary
provider failures remain errors.

This construction is a deterministic differential reference for checking
analytic, assembled, GPU, or solver-specific curvature paths. It is not an
exact Hessian, a definiteness guarantee, or a Newton direction. In particular,
`vᵀHv` may be negative when the underlying objective has negative curvature;
positive-semidefinite modification is a separate policy.

### Exact provider composition

A conservative provider may additionally implement
`XpbdConservativeHessianVectorProviderN`. Its
`evaluatePotentialHessianVectorAt()` method receives defensive particle-space
position and direction queries and returns the mathematical product
`∇²U(q)v` in provider particle order. This is deliberately the potential
Hessian sign, not the derivative of force `-∇U`.

`evaluateXpbdIncrementalPotentialAnalyticHessianVectorN()` composes those
products with the exact inertial block:

$$
\nabla^2E(q)v=Mv+h^2\nabla^2U(q)v.
$$

```ts
import {
  evaluateXpbdIncrementalPotentialAnalyticHessianVectorN
} from '@holotope/physics';

const analytic =
  evaluateXpbdIncrementalPotentialAnalyticHessianVectorN({
    problem,
    coordinates: packed.coordinates,
    direction
  });

if (analytic.status === 'evaluated') {
  console.log(analytic.product, analytic.quadraticForm);
} else if (analytic.status === 'unsupported-provider') {
  console.log(analytic.providerIds);
}
```

For a nonzero direction, every provider must expose the optional capability.
The function preflights the complete authored provider list and returns every
unsupported id before requesting any partial product. It therefore never
misrepresents a subset of conservative curvature as the Hessian of the full
objective. A zero direction remains exact zero and requires no provider
capability.

The successful result separates the packed mass product, full particle-space
potential products, the packed `h²`-scaled potential contribution, and their
sum. Fixed particles occupy no packed coordinate but retain reaction curvature
in the full potential-product array.

`XpbdParticleHyperplaneBarrierN` supplies the first exact provider
specialization. Because its signed-distance coordinate is affine with unit
normal `n`,

$$
\nabla^2U(q)v=b''(d(q))\,n(n^Tv).
$$

This analytic composition and the centered reference are complementary:
provider products give exact local algebra when coverage is complete, while
the differential construction checks that algebra and remains available for
provider mixtures without analytic support. Neither path modifies negative
curvature or chooses a solver direction.

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

$$
v_{n+1}=\frac{q_{n+1}-q_n}{h},
$$

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
  stepXpbdIncrementalPotentialN,
  xpbdMassPreconditionedDirectionN
} from '@holotope/physics';

const step = stepXpbdIncrementalPotentialN({
  dimension: 4,
  particles,
  providers: [elasticFamily, measureBarrierFamily],
  deltaTime: 1 / 120,
  gravity: [0, -9.81, 0, 0],
  minimization: {
    directionPolicy: xpbdMassPreconditionedDirectionN,
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
first-order sufficient-decrease search, ordered admissible-step filtering with
an exact RN point–static-plane specialization, a bounded non-mutating
direction-policy golden path with steepest and inertial-mass specializations,
an independently auditable matrix-free curvature estimate, exact analytic
composition for completely capable provider mixtures, an explicit atomic state
transition, and a single-call transactional reference step. They do not:

- assemble an exact Hessian or linear system, or project one to a definiteness
  class;
- provide Newton, quasi-Newton, or material-Hessian directions;
- apply `XpbdWorldN` velocity responses or state guards to the optimization
  path;
- perform mesh-wide continuous-collision-filtered search automatically;
- build mesh-wide active collision sets from edge or face stencils;
- certify an intersection-free trajectory; or
- implement Incremental Potential Contact.

The minimizer is intended for small reference problems and differential
testing, not as the production path for large stiff systems. More advanced
solvers can consume the same problem without changing its mass, energy,
identity, and sign conventions.
