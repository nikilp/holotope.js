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

<!-- doc-check: sequential -->

## The system these steps operate on

Every step below runs on one particle system: a small set of degrees of
freedom, one of them fixed, in R4. The stages then thread through it —
predict, evaluate, search, curvature, apply.

<!-- doc-check: context -->

```ts
import {
  XpbdParticleN,
  type XpbdConservativeForceProviderN,
  type XpbdParticleBindingN,
  type XpbdParticleHyperplaneFamilyN
} from '@holotope/physics';

const particles = [
  new XpbdParticleN({ id: 'anchor', position: [0, 0, 0, 0], inverseMass: 0 }),
  new XpbdParticleN({ id: 'free-a', position: [1, 0, 0, 0] }),
  new XpbdParticleN({ id: 'free-b', position: [1, 1, 0, 0] })
];

// A trial configuration the objective is evaluated at: one position per
// particle, in the same order.
const candidatePositions = particles.map((particle) => particle.position);

// The conservative providers whose energies make up U(q), and the hyperplane
// contact set the barrier family is compiled over. Building them is the
// deformable page's subject; here they are the inputs the steps consume.
declare const elasticFamily: XpbdConservativeForceProviderN;
declare const measureBarrierFamily: XpbdConservativeForceProviderN;
declare const material: XpbdConservativeForceProviderN;
declare const floorContacts: XpbdParticleHyperplaneFamilyN;

// A single free particle, for the one-barrier examples.
const particle = particles[1]!;

// The inertial prediction qHat, and the step it was taken over. Later stages
// evaluate against these; the prediction step above is where they come from.
const predictedPositions = candidatePositions;
const deltaTime = 1 / 60;

// Two trial directions in packed free-coordinate space, for the curvature
// examples: a Hessian-vector product takes one packed vector per apply.
declare const direction0: Float64Array;
declare const direction1: Float64Array;

// The binding these particles came from; writing back is how a converged step
// reaches the source complex.
declare const binding: XpbdParticleBindingN;
```

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

Called directly, it evaluates the base state itself, which is one full pass
over every registered provider. The minimizer below does not pay that: its
current iterate is already an evaluation of those coordinates, so it reuses it.
On a contact-dense problem, where a provider pass dominates the step, that is
one fewer pass per accepted iteration.

Only `XpbdPotentialDomainErrorN` is recoverable during backtracking.
`SimplexConstitutiveDomainErrorN` specializes that common type, as do
open-distance barriers. Collapse, inversion, non-positive measure, or crossing
an authored lower boundary can therefore request a smaller step. Malformed
inputs, Float64 overflow, stale source lineage, and arbitrary provider errors
are rethrown rather than disguised as optimization difficulty. A typed domain
refusal at the base point is also rethrown because there is no valid state from
which to establish sufficient decrease.

## Scalar and particle–hyperplane barriers

`evaluateClampedLogBarrierAtOrderN()` exposes the dimension-independent scalar
law

$$
b(d;\widehat d)=
\begin{cases}
-\kappa(d-\widehat d)^2\log(d/\widehat d),
  &0<d<\widehat d,\\
0,&d\geq\widehat d,
\end{cases}
$$

to exactly the **requested derivative order** — `0` for the energy, `1`
adding the first derivative, `2` adding the second. The order is a required
argument: there is no default, so a caller cannot silently pay for (or come
to depend on) a curvature it never asked for. The open boundary `d = 0` is
deliberately outside the evaluator's domain and raises the typed permanent
`ClampedLogBarrierInputErrorN`. At and above the activation coordinate, value
and requested derivatives are exactly zero with `active: false`. The same
scalar kernel supplies the simplex lower-measure barrier and contact-distance
providers, so they share one curvature and boundary convention.

Each requested component is **graded on its own account** as
`{ available: true, value }` or
`{ available: false, reason: 'outside-float64' }`, and availability is
**non-monotone**: deep in the support the energy can round to zero while the
curvature is a healthy number, and the curvature can overflow while the
energy is representable. Neither direction implies the other, and no
component is withheld because another was unavailable. Three consequences
are worth reading twice:

- **A correctly rounded zero is an answer.** When the barrier is active and
  a component's exact value rounds to Float64 zero, the component is
  published as `{ available: true, value: 0 }`, never refused. `active` is
  what separates that underflow statement from the clamp's exact zero.
- **Signed zero is preserved, not promised.** The correctly rounded signed
  zero the arithmetic produces is passed through — an underflowed first
  derivative arrives as `-0` because $b'$ is strictly negative on the active
  domain — but semantics come from `active` plus the value; no caller may
  use the sign bit as its only discriminator.
- **Classification at the Infinity threshold carries a measured
  accommodation.** Within the accuracy budget of the rounding threshold to
  ±Infinity ($2^{1024}(1-2^{-54})$, relative width $16\cdot2^{-53}$), an
  `available: false` may arrive one budget-width before exact classification
  would demand it. This is a numerical accommodation the implementation
  inherits, not a theorem.

The **assembled directional product is outside the scalar guarantee**: the
contract grades its own three outputs, and a dot product of delivered
components with a caller's direction can underflow to zero while every
component is finite and nonzero. The caller owns that composition and its
diagnostic — the scalar result cannot see it.

Measured cost (batched spans, never single-call timing): requesting order 0
is roughly **4× cheaper** and order 1 roughly **1.4× cheaper** than the old
all-orders evaluation, while order 2 costs about **1.3–1.4×** — an accepted,
documented trade for correctly rounded subnormal behaviour and no-throw
availability semantics; the exponent-tracked repair itself contributes
roughly 9% of it. The inactive clamp performs no arithmetic at all.

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

### Finite source-simplex proximity

`XpbdParticleSourceSimplexBarrierN` replaces the infinite plane with one
persistent finite source simplex. For its closed convex hull $C$, it uses

$$
\delta(q)=\lVert q-\Pi_C(q)\rVert,
\qquad
U(q)=b(\delta(q)-d_{\min};d_{\mathrm{active}}-d_{\min}).
$$

The closest point $\Pi_C(q)$ is returned with its barycentric coordinate and
source-cell reference. Thus the same evaluation records whether the nearest
part is the simplex interior, an edge, or a vertex instead of discarding that
transition. In R4, a point and a tetrahedron form the complementary
zero-dimensional/three-dimensional contact-feature pair.

For line segments, triangles, and tetrahedra, the projection decision is exact
on the supplied Float64 geometry: Float64 coordinates are decoded as dyadic
rationals, affine rank and every feasible active face are decided without a
tolerance, and exact zero remains distinct from positive distance. The public
result is still a practical Float64 object. Its point, distance, and direction
come from one published set of barycentric weights, and its absolute error
bounds are rounded outward. If either the witness or its accuracy evidence
cannot fit Float64, the query refuses by a typed reason instead of substituting
a scale-dependent band.

```ts
import {
  CellComplex,
  createSourceCellReferenceN,
  createSourceSimplexReferenceN
} from '@holotope/core';
import {
  XpbdParticleN,
  XpbdParticleSourceSimplexBarrierN,
  XpbdParticleSourceSimplexBarrierStepFilterN,
  type XpbdParticleSourceSimplexBarrierDomainReasonN,
  type XpbdParticleSourceSimplexBarrierEvaluationN,
  type XpbdParticleSourceSimplexBarrierNOptions,
  type XpbdParticleSourceSimplexBarrierStepFilterEvaluationN,
  type XpbdParticleSourceSimplexBarrierStepFilterEvidenceN,
  type XpbdParticleSourceSimplexBarrierStepFilterNOptions,
  type XpbdParticleSourceSimplexBarrierStepFilterRefusalReasonN
} from '@holotope/physics';

const finiteSimplexGroup = {
  dim: 3,
  verticesPerCell: 4,
  kind: 'simplex' as const,
  indices: new Uint32Array([0, 1, 2, 3])
};
const finiteSimplexSource = new CellComplex(4, new Float64Array([
  0, 0, 0, 0,
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0
]), [finiteSimplexGroup]);
const finiteSimplexReference = createSourceSimplexReferenceN(
  createSourceCellReferenceN(finiteSimplexSource, finiteSimplexGroup, 0)
);
const finiteSimplexParticle = new XpbdParticleN({
  id: 'probe', position: [0.2, 0.2, 0.2, 0.4]
});
const finiteSimplexBarrierOptions:
  XpbdParticleSourceSimplexBarrierNOptions = {
  id: 'obstacle/tetrahedron',
  particle: finiteSimplexParticle,
  simplex: finiteSimplexReference,
  minimumDistance: 0.01,
  activationDistance: 0.1,
  stiffness: 250
};
const finiteSimplexBarrier = new XpbdParticleSourceSimplexBarrierN(
  finiteSimplexBarrierOptions
);
const finiteSimplexFilterOptions:
  XpbdParticleSourceSimplexBarrierStepFilterNOptions = {
    id: 'obstacle/tetrahedron/filter',
    barrier: finiteSimplexBarrier
  };
const finiteSimplexFilter =
  new XpbdParticleSourceSimplexBarrierStepFilterN(
    finiteSimplexFilterOptions
  );

const finiteSimplexSample:
  XpbdParticleSourceSimplexBarrierEvaluationN =
    finiteSimplexBarrier.evaluate();
const finiteSimplexStep:
  XpbdParticleSourceSimplexBarrierStepFilterEvaluationN =
    finiteSimplexFilter.evaluate({
      dimension: 4,
      requestedStepLength: 1,
      positionBefore: () => finiteSimplexParticle.position.clone(),
      positionAfter: () => finiteSimplexParticle.position.clone()
    });
const finiteSimplexStepEvidence:
  XpbdParticleSourceSimplexBarrierStepFilterEvidenceN = finiteSimplexStep;
const finiteSimplexDomainReason:
  XpbdParticleSourceSimplexBarrierDomainReasonN =
    'at-or-below-minimum-distance';
const finiteSimplexFilterReason:
  XpbdParticleSourceSimplexBarrierStepFilterRefusalReasonN =
    'initial-domain-violation';
console.log(
  finiteSimplexSample.distance,
  finiteSimplexSample.projection.coordinate.weights,
  finiteSimplexSample.barrierCoordinate,
  finiteSimplexSample.barrierActivation,
  finiteSimplexSample.separationNormal,
  finiteSimplexStepEvidence.certifiedFraction,
  finiteSimplexDomainReason,
  finiteSimplexFilterReason
);
```

The paired filter makes a different claim from the plane filter. Distance to a
closed convex simplex is convex and 1-Lipschitz, so it can prove a complete
non-closing segment safe or retain a conservative strict prefix of a closing
segment. It reports `certifiedFraction`, never `impactFraction`: it has not
solved the piecewise closest-feature impact time exactly.

The barrier is unsigned and two-sided. It is not an inside/outside predicate,
does not move the simplex, does not generate point--simplex pairs from a mesh,
and does not supply analytic Hessian-vector products. A Newton-CG solve over a
provider mixture containing it therefore reports the existing
`unsupported-provider` evidence; first-order minimization remains available.

### Source-indexed finite-obstacle candidates

`XpbdParticleSourceSimplexBarrierFamilyN` lifts that exact pair over a dynamic
source-vertex binding and a separate static simplex group. The family does not
precompile every possible barrier. At each point evaluation it exhaustively
visits the bipartite source-feature space, rejects pairs only when a point AABB
expanded by `activationDistance` is separated from the simplex AABB, and
evaluates P44 barriers for the retained pairs. Its paired filter repeats the
same conservative query over the complete proposed segment.

```ts
import {
  compileXpbdParticleBindingN,
  compileXpbdParticleSourceSimplexBarrierFamilyN,
  type XpbdParticleSourceSimplexBarrierFamilyEvaluationN,
  type XpbdParticleSourceSimplexCandidateQueryN
} from '@holotope/physics';

const candidateDynamicSource = new CellComplex(
  4,
  new Float64Array([0.2, 0.2, 0.2, 0.4]),
  []
);
const candidateBinding = compileXpbdParticleBindingN({
  id: 'dynamic-points', source: candidateDynamicSource
});
const finiteObstacleFamily =
  compileXpbdParticleSourceSimplexBarrierFamilyN({
    id: 'finite-obstacle',
    binding: candidateBinding,
    obstacle: finiteSimplexSource,
    simplexGroup: finiteSimplexGroup,
    minimumDistance: 0.01,
    activationDistance: 0.1,
    stiffness: 250
  });
const finiteObstacleEvaluation:
  XpbdParticleSourceSimplexBarrierFamilyEvaluationN =
    finiteObstacleFamily.evaluate();
const finiteObstacleCandidates: XpbdParticleSourceSimplexCandidateQueryN =
  finiteObstacleEvaluation.candidateQuery;

const finiteObstacleProblem = compileXpbdIncrementalPotentialProblemN({
  dimension: 4,
  particles: candidateBinding.particles,
  predictedPositions: candidateBinding.particles.map(
    (particle) => particle.position.clone()
  ),
  deltaTime: 1 / 60,
  ...finiteObstacleFamily.incrementalPotentialTerms()
});
console.log(
  finiteObstacleCandidates.diagnostics.possiblePairs,
  finiteObstacleCandidates.diagnostics.candidatePairs,
  finiteObstacleEvaluation.activeCandidates.map(({ candidate }) => candidate.id),
  finiteObstacleProblem.stepFilters[0]?.id
);
```

The query reports three separate quantities: all possible pairs, conservative
AABB candidates, and exact active barriers. A candidate ID combines the
dynamic source vertex with the persistent obstacle cell; it is stable across
queries, while the candidate set itself is valid only for the point or segment
that produced it. `indeterminate` remains a refusal and names its blocking
candidate rather than becoming a collision miss.

This is the auditable Float64 reference active set. Its obstacle is one-sided
and static during a solve. It does not implement moving--moving pairs,
self-contact, edge--edge candidates, exact finite-feature impact, or analytic
curvature.

#### Extrinsic bending is a first-order provider

`compileXpbdSourceSimplexCosineBendingFamilyN()` supplies a conservative
provider for the fold between adjacent source simplices — a **discrete
cosine-fold stiffness, not a continuum shell**; see
[the deformable page](../physics/deformable.md#extrinsic-stiffness-discrete-cosine-fold-bending)
for the coordinate and its measured non-convergence.

Two facts matter at this boundary. It implements the first-derivative seam
only, so a mixture containing it makes `'newton-cg'` refuse with named
unsupported-provider evidence rather than dropping the bending block and
returning a direction that ignores it. And it carries a paired step filter
that must travel with it:

```ts
import { CellComplex } from '@holotope/core';
import {
  compileXpbdParticleBindingN,
  compileXpbdSourceSimplexCosineBendingFamilyN
} from '@holotope/physics';

const foldGroup = {
  key: 'fold', dim: 2, verticesPerCell: 3, kind: 'simplex' as const,
  indices: Uint32Array.from([0, 1, 2, 1, 3, 2])
};
const foldSource = new CellComplex(4, Float64Array.from([
  0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0.4, 0, 1, 1, 0, 0
]), [foldGroup]);
const foldBinding = compileXpbdParticleBindingN({
  id: 'fold-points', source: foldSource
});
const bending = compileXpbdSourceSimplexCosineBendingFamilyN({
  id: 'fold-bending', binding: foldBinding, simplexGroup: foldGroup,
  stiffness: 25, restCoordinate: 1, minimumMeasureRatio: 0.05
});

const bendingProblem = compileXpbdIncrementalPotentialProblemN({
  dimension: 4,
  particles: foldBinding.particles,
  predictedPositions: foldBinding.particles.map(
    (particle) => particle.position.clone()
  ),
  deltaTime: 1 / 60,
  ...bending.incrementalPotentialTerms()
});
console.log(bendingProblem.stepFilters[0]?.id);
```

Spreading `incrementalPotentialTerms()` is what keeps the pairing honest.
Passing `bending` as a bare provider compiles and runs, and leaves every
search segment uncertified against a hinge collapsing mid-chord.

### Selecting a static AABB hierarchy

The scan above visits every dynamic vertex against every obstacle simplex. That
is what makes it the oracle, and it stays the default. When the obstacle is
large enough for the scan to dominate, compile a hierarchy over it and pass it
in:

```ts
import {
  compileXpbdSourceSimplexAabbHierarchyN
} from '@holotope/physics';

const acceleratedFamily = compileXpbdParticleSourceSimplexBarrierFamilyN({
  id: 'finite-obstacle-accelerated',
  binding: candidateBinding,
  obstacle: finiteSimplexSource,
  simplexGroup: finiteSimplexGroup,
  minimumDistance: 0.01,
  activationDistance: 0.1,
  stiffness: 250,
  candidateHierarchy: compileXpbdSourceSimplexAabbHierarchyN({
    obstacle: finiteSimplexSource,
    simplexGroup: finiteSimplexGroup,
    leafSize: 8
  })
});

const accelerated = acceleratedFamily.evaluate().candidateQuery;
console.log(
  accelerated.diagnostics.strategy,                    // 'static-aabb-hierarchy'
  accelerated.diagnostics.hierarchy?.testedSimplexBounds,
  accelerated.diagnostics.hierarchy?.totalSimplices
);
```

Nothing selects this for you. There is no `'fast'` string and no mesh-size
threshold, because a strategy the library picks silently is one you cannot
audit when it retains the wrong set. The hierarchy must index the same
`obstacle` and `simplexGroup` **objects** the family does; a structurally
identical tree over a different source is refused, since the bounds it cached
describe coordinates this family never sees.

What changes is which pairs get asked. What does not change:

- **Candidate identity and order.** The tree traverses in its own order and
  restores the persistent obstacle-cell order before returning, so
  `candidates` is the sequence the exhaustive scan produces. Tree shape is not
  observable downstream.
- **Conservatism.** Node bounds are the componentwise union of their
  descendants, so a node separated from the query on one axis is a proof about
  every simplex beneath it. Retention is still decided by the same inclusive
  AABB rule against the same per-simplex bounds.
- **Who decides contact.** Retention is not contact. The P44 exact barrier
  still measures the distance, and the paired step filter still certifies the
  admissible prefix — a hierarchy narrows the question and never answers it.
  Omitting the filter because a hierarchy exists loses the segment guarantee
  entirely.

`diagnostics.hierarchy` reports operations, not time: nodes and leaves visited,
individual simplex bounds tested, and simplices retained. On an obstacle whose
simplices cannot be separated — coincident geometry, or a query box covering
everything — `testedSimplexBounds` equals the simplex count and the ratio is
1.0. The hierarchy buys nothing there and says so rather than averaging it
away; worst-case work is linear, not sublinear.

##### The obstacle must not move

The hierarchy computes every bound once, so a later coordinate change would
invalidate all of them at once. It therefore snapshots the coordinates it
indexed and compares them before each query, refusing by naming the moved
vertex and axis:

```ts
const firstCoordinate = finiteSimplexSource.positions[0];
if (firstCoordinate === undefined) throw new Error('empty obstacle');
finiteSimplexSource.positions[0] = firstCoordinate + 1;

// The next query throws rather than answering:
//
//   XpbdParticleSourceSimplexBarrierFamilyN candidate query: the indexed
//   obstacle moved — vertex 0 axis 0 is …, was …. This hierarchy indexes a
//   static obstacle and is not rebuilt automatically; compile a new one
//   after moving the source.
```

There is no automatic rebuild. A rebuild that happens by itself is
indistinguishable from a tree that was never stale, and the failure it hides —
plausible candidates from geometry that has since moved — is exactly the one
worth being loud about. Compile a new hierarchy after moving the source.

The check is `O(indexed source coordinates)`, which is why it is affordable: it
is cheaper than the `O(dynamic vertices × simplices)` search it guards. Moving
obstacles, refit, and a revision protocol are a separate commissioned stage.

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

// `final` exists on every outcome except a refused initial state, which never
// evaluated one. Narrow on `status` rather than reaching through the union.
if (result.status === 'initial-state-refused') {
  console.log(result.status, result.problem.dimension);
} else {
  console.log(
    result.status,
    result.directionPolicyId,
    result.final.gradientNorm
  );
}
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

That packed-gradient norm is the default criterion. Which physical quantity it
bounds, and what the alternative bounds instead, is the next section.

## What the stop test bounds

Both terms of the objective carry the same unit. The inertial term is
mass·length², and `h²U(q)` is time²·energy, which is mass·length² again.
Differentiating once removes one length, so a packed gradient entry is in
mass·length — equivalently force·time². A threshold on the packed gradient is
therefore a threshold in mass·length. It is not a force, and it does not become
one by being small.

Dividing by `h²` converts it back. At a fixed threshold, the smallest force the
criterion can still distinguish from zero is `gradientTolerance / h²`, so that
floor **rises** as the timestep falls: refining the interval, which improves the
discretization in every other respect, coarsens this stop test quadratically.

The consequence is not asymptotic. One free particle of unit mass under a
constant 1000 N force, driven through the public world step over a fixed
`1e-3` s horizon, has the exact Backward-Euler answer 1 m/s at every timestep.
At the shipped default tolerance of `1e-8`:

| `deltaTime` | warm-start gradient norm | steps applied | converged at the base | final speed |
| --- | --- | --- | --- | --- |
| `1e-4` | `1e-5` | 10 / 10 | 0 | `1.0000000000000016` |
| `5e-5` | `2.5e-6` | 20 / 20 | 0 | `1.0000000000000004` |
| `1e-5` | `1e-7` | 100 / 100 | 0 | `1.0000000000000133` |
| `5e-6` | `2.5e-8` | 200 / 200 | 0 | `1.0000000000000675` |
| `2e-6` | `4e-9` | 500 / 500 | 500 | `0` |
| `1e-6` | `1e-9` | 1000 / 1000 | 1000 | `0` |

A 2.5-fold refinement takes a 1000 N force from exactly integrated to
identically absent. Every step of every row reports `applied`: converging at
the warm start is a legitimate terminal, not a refusable one, so the bottom two
rows produce no refusal to notice. `applied` therefore does not mean that every
physical force exceeded the solver's resolution — only that a converged iterate
reached the application boundary. This is the permanent test
`packages/physics/test/xpbd-incremental-potential-convergence.test.ts`.

### A criterion that does not move with the timestep

`convergence: { kind: 'maximum-acceleration-residual', tolerance }` bounds

$$
\max_{i\ \mathrm{free}}\frac{\lVert\nabla_iE\rVert}{m_ih^2}
$$

in length/time². The `h²` cancels against the one folded into the objective, so
the same authored number means the same physical thing at every timestep.

Two properties of that definition are load-bearing. Prescribed particles hold
no packed coordinate and their gradient entry is identically zero, so the
maximum is over the free set and a fixed particle can neither raise nor lower
it. And taking a per-particle maximum rather than a global norm is what keeps
the bound independent of particle count: a Euclidean norm over `N` particles
grows as `sqrt(N)` at fixed per-particle residual, and lets one heavy particle's
small acceleration conceal a light particle's large one.

### Two families, and why this is a union

Six candidate criteria were ranked on delivered physical error against a
closed-form minimizer, over an eight-fold refinement at one fixed authored
tolerance. Each column is the spread of delivered error across that refinement;
`1.0` is exact invariance.

| candidate | acceleration spread | position spread |
| --- | --- | --- |
| packed gradient norm | 45.43 | 1.48 |
| force-scaled residual | 1.0153 | 62.93 |
| maximum acceleration residual | 1.0169 | 62.83 |
| mass-weighted residual | 1.0153 | 62.93 |
| relative residual (control) | 1.0120 | 63.14 |
| per-particle position residual | 60.61 | 1.72 |

There are exactly two families, and no candidate spans both. They differ by
exactly `h²`, so a criterion that holds one quantity invariant under refinement
must let the other move by that factor. The packed norm holds position error;
the acceleration residual holds acceleration. Neither dominates the other, and
the library cannot pick for the scene — which is why the option is a
discriminated union and not a knob with a better default.

Among the acceleration-stable candidates, the per-particle maximum is the one
that is additionally mass-aware and count-invariant, which is why it is the one
shipped.

### Authoring, and what every terminal reports

```ts
import { minimizeXpbdIncrementalPotentialN } from '@holotope/physics';

const bounded = minimizeXpbdIncrementalPotentialN({
  problem,
  initialCoordinates: coordinates,
  convergence: { kind: 'maximum-acceleration-residual', tolerance: 1e-3 },
  maximumIterations: 128
});

if (bounded.status !== 'initial-state-refused') {
  console.log(
    bounded.convergence.kind,           // the criterion that decided
    bounded.convergence.tolerance,
    bounded.convergence.initialResidual,
    bounded.convergence.finalResidual,  // converged is exactly <= tolerance
    bounded.final.gradientNorm          // retained whichever criterion ran
  );
}
```

`{ kind: 'packed-gradient', tolerance }` is the same criterion `gradientTolerance`
has always named, at the same value; a scene that authors neither resolves to it
at `1e-8`. Authoring `gradientTolerance` and `convergence` together throws before
the problem is evaluated once, rather than resolving a precedence nobody wrote.

`gradientTolerance` is retained on every result whatever criterion ran, and
`gradientNorm` on every `initial` and `final` evaluation, so an existing reader
keeps the quantity it knows. `'initial-state-refused'` accepted no evaluation
at all, so it carries the criterion and its tolerance without residuals or
evaluations — narrow that status away before reading either. Under any
criterion other than `'packed-gradient'`, `gradientTolerance` is the inert
default and did not decide anything — `convergence.kind` names what did. The
same `convergence` field is accepted by the integrated step's and the world
step's `minimization` policy.

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

`XpbdParticleHyperplaneBarrierN` supplies an exact contact-barrier
specialization. Because its signed-distance coordinate is affine with unit
normal `n`,

$$
\nabla^2U(q)v=b''(d(q))\,n(n^Tv).
$$

The shipped simplex constitutive laws also expose exact matrix-free products.
For a simplex edge matrix `Ds`, directional edge matrix `V`, and deterministic
inverse rest factor `A`, they first form

$$
\dot C=A(V^TD_s+D_s^TV)A^T.
$$

They then differentiate the law's second Piola stress and assemble
`restMeasure * (V M + Ds dot(M))` back to the source vertices. The public
`evaluateSimplexStVenantKirchhoffHessianVectorN()`,
`evaluateSimplexCompressibleNeoHookeanHessianVectorN()`, and
`evaluateSimplexMeasureBarrierHessianVectorN()` functions retain both
directional material tensors and the resulting products. The generic
`SimplexConstitutiveFamilyN` assembles this capability over shared source
vertices when its selected law supplies it; custom first-order-only laws
remain valid and visibly unsupported.

This analytic composition and the centered reference are complementary:
provider products give exact local algebra when coverage is complete, while
the differential construction checks that algebra and remains available for
provider mixtures without analytic support. Neither path modifies negative
curvature or chooses a solver direction. Exact matrix-free products do not
imply positive semidefiniteness, a sparse Hessian, a Krylov solve, or a Newton
policy.

### Explicit provider-local PSD curvature

Exact negative curvature is evidence, not a defect to hide. Consequently every
analytic and Newton entry point defaults to `'exact'`: a non-positive Krylov
ray remains a typed refusal.

For modified-Newton experiments on small providers, an author can opt into a
dense CPU reference:

```ts
const linear = solveXpbdIncrementalPotentialNewtonDirectionN({
  problem,
  coordinates: packed.coordinates,
  curvaturePolicy: { kind: 'provider-local-psd' }
});
```

For each conservative provider with \(k\) local scalar variables, this policy
requests \(k\) analytic Hessian-vector products to reconstruct its local
matrix, rejects material asymmetry, diagonalizes the symmetric matrix, and
applies

$$
H_i^+=V_i\max(\Lambda_i,0)V_i^T.
$$

The incremental operator is then

$$
H^+=M+h^2\sum_i A_i^T H_i^+ A_i,
$$

so the exact positive mass block is never projected. Provider evidence retains
the raw and clamped spectra, clipped count, pre-symmetrization error,
eigensystem residuals, and HVP count.

“Provider-local” is a precise boundary. A provider may be one contact stencil,
one element, or an already assembled constitutive family. The last case means
this dense reference scales cubically with the whole family block; it is not
the eventual per-element sparse implementation. The option is explicit on
`evaluateXpbdIncrementalPotentialAnalyticHessianVectorN()`,
`solveXpbdIncrementalPotentialNewtonDirectionN()`, and
`xpbdNewtonDirectionPolicyN()` so applications cannot confuse exact and
modified curvature.

### Exact provider-block PSD curvature

Whole-provider projection can erase useful locality. Providers may therefore
expose an optional exact additive seam:

```ts
import type {
  XpbdConservativeHessianBlockN,
  XpbdConservativeHessianVectorEvaluationN,
  XpbdConservativeHessianVectorProviderN,
  XpbdParticleDirectionQueryN,
  XpbdParticlePositionQueryN
} from '@holotope/physics';

interface XpbdConservativeHessianBlockProviderN
  extends XpbdConservativeHessianVectorProviderN {
  /** Deterministic authored block order. */
  readonly potentialHessianBlocks:
    readonly XpbdConservativeHessianBlockN[];

  /** Evaluates one exact block contribution at a candidate state. */
  evaluatePotentialHessianBlockVectorAt(
    block: XpbdConservativeHessianBlockN,
    positionOf: XpbdParticlePositionQueryN,
    directionOf: XpbdParticleDirectionQueryN
  ): XpbdConservativeHessianVectorEvaluationN;
}
```

For declared blocks \(H_{ib}\), the provider contract is

$$
H_i d=\sum_b A_{ib}^T H_{ib}A_{ib}d.
$$

Blocks may overlap in particle support. Their stable ids and particle order
define the local coordinate maps; the provider's aggregate HVP remains
authoritative. The block policy can then project the smaller matrices:

```ts
const linear = solveXpbdIncrementalPotentialNewtonDirectionN({
  problem,
  coordinates: packed.coordinates,
  curvaturePolicy: { kind: 'provider-block-psd' }
});
```

Each dense block is reconstructed from exact basis HVPs, symmetry-audited,
diagonalized, and clamped independently. Before the projected product is
accepted, the unmodified block products are summed by particle identity and
compared with one exact aggregate provider HVP at the requested direction.
A mismatch is a contract error rather than an approximate result.

The returned provider evidence states whether the decomposition was
`declared` or an `implicit-provider` fallback, the raw assembly error, total
operator count, and the full spectrum and eigensystem diagnostics for every
block. Providers without a declared decomposition remain compatible by
forming one visible whole-provider block.

`SimplexConstitutiveFamilyN` specializes this seam naturally: each source
simplex is one block, in source-cell order, and its retained block record
points back to the compiled source element. Thus a family with local scalar
counts \(k_b\) changes the dense spectral work from
\(O((\sum_b k_b)^3)\) to \(\sum_b O(k_b^3)\). This is the exact Float64
golden path for element-local modified curvature. The one-shot API does not
retain matrices across calls; the fixed-coordinate compiler below reuses them
only within one authored linearization. Neither path assembles a global sparse
Hessian, constructs a scalable preconditioner, or claims a production
large-mesh solve.

### Fixed-coordinate analytic operators

A Newton linear solve asks many directional questions at one unchanged
coordinate. Reconstructing and diagonalizing the same local matrices for every
Krylov direction is mathematically redundant. The reusable boundary is:

```ts
const operator =
  compileXpbdIncrementalPotentialAnalyticHessianOperatorN({
    problem,
    coordinates: packed.coordinates,
    curvaturePolicy: { kind: 'provider-block-psd' }
  });

if (operator.status === 'compiled') {
  const Hd0 = operator.apply(direction0);
  const Hd1 = operator.apply(direction1);
}
```

The returned operator copies its fixed coordinate, retains the complete base
objective, and exposes separate construction and per-product provider HVP
counts. Its policy-dependent work is exact:

- `'exact'` compiles no matrix and requests one aggregate HVP per provider and
  nonzero product;
- `provider-local-psd` pays the provider basis HVPs and eigendecomposition once
  and subsequently applies the stored projected matrix without provider HVPs;
- `provider-block-psd` pays every block basis HVP and eigendecomposition once,
  then retains one authoritative aggregate provider HVP audit for each nonzero
  applied direction.

That last audit is not redundant. A provider declares that its blocks sum to
its aggregate Hessian. Proving the equality for every possible direction at
compile time would require reconstructing the complete provider-wide
aggregate matrix. Instead, the compiled operator stores the raw block matrices
and compares their action with the exact aggregate HVP on every direction it
actually applies. A direction-dependent disagreement remains a contract
error.

`evaluateXpbdIncrementalPotentialAnalyticHessianVectorN()` is the convenient
one-shot form of the same construction. The Newton solver compiles once per
linearization and reuses it through CG; it never carries projected matrices
across candidate coordinates or nonlinear iterations. This is a per-solve
Float64 CPU cache, not a sparse/global Hessian, cross-iteration quasi-Newton
approximation, or GPU operator.

### Bounded matrix-free Newton direction

`solveXpbdIncrementalPotentialNewtonDirectionN()` is the first bounded linear
solver over that exact analytic operator. It uses preconditioned conjugate
gradients to attempt

$$
\nabla^2E(q)\,p=-\nabla E(q)
$$

without assembling a dense or sparse Hessian. The default mass-diagonal
preconditioner applies the exact inverse of the inertial mass block; an
identity reference is also available.

```ts
import {
  solveXpbdIncrementalPotentialNewtonDirectionN
} from '@holotope/physics';

const linear = solveXpbdIncrementalPotentialNewtonDirectionN({
  problem,
  coordinates: packed.coordinates,
  preconditioner: 'mass-diagonal',
  maximumIterations: 64
});

if (linear.status === 'converged') {
  console.log(linear.direction, linear.residualNorm);
} else {
  console.log(linear.status);
}
```

The result is deliberately evidence-rich. It retains every completed Krylov
iteration, residual reduction, complete packed-product count, one-time
curvature-construction HVP count, application HVP count, and the authored
tolerances. A mixed objective with first-order-only providers returns
`unsupported-provider`. A search ray whose
`dᵀHd` is non-positive or too small relative to `||d|| ||Hd||` returns
`non-positive-curvature` with the rejecting direction and product. Exact
stationarity, convergence, and exhaustion of a finite iteration budget have
separate statuses.

This function solves only the linearized equation at one fixed coordinate.
Its default exact policy does not modify definiteness; the explicit
provider-local and provider-block PSD options are the bounded references
above. None selects an admissible nonlinear step, invokes Armijo
backtracking, mutates particles, or claims a globally convergent Newton
method. Those remain separate policies so callers cannot mistake a locally
valid direction for an accepted simulation state.

## Globalizing the Newton direction

A Newton direction is only valid where the objective is locally convex. Away
from that, the linearized equation is solving the wrong problem, and a
curvature ray with `dᵀHd ≤ 0` is the search saying so. What a globalized
method does with that fact is where designs diverge.

`xpbdNewtonDirectionPolicyN()` composes the solve into the existing
minimization stack as an ordinary [direction
policy](/api/physics/interfaces/XpbdIncrementalPotentialDirectionPolicyN).
Nothing else moves: step filters still certify the requested segment before
any trial, Armijo still owns acceptance and backtracking, and the gradient
norm still owns convergence. Steepest descent remains the default everywhere
— Newton is never selected for you.

### Refusal is the default

The common alternative is to repair the curvature: project the Hessian to its
positive part, clamp or reflect eigenvalues, or substitute a surrogate. Each
returns a direction, and each quietly changes the problem being solved. The
caller receives something shaped like a Newton direction that is no longer
one, with nothing in the result to say so.

This library refuses instead. A rejected ray stays rejected, and the
minimization terminates as `direction-refused` carrying the complete evidence
— the rejected direction, its product, the quadratic form, and the threshold
it failed. Nothing was tried and nothing moved, so the last accepted iterate
is still the final state.

### Continuing is authored, never inferred

Refusing is not always what you want. A first-order step is a perfectly good
answer to indefinite curvature — but it is a modelling decision, so it is
written down:

```ts
const policy = xpbdNewtonDirectionPolicyN({
  problem,
  fallback: {
    policy: xpbdMassPreconditionedDirectionN,
    on: ['non-positive-curvature']
  }
});
```

The fallback names both the policy and the exact outcomes it answers for. The
Newton refusal evidence is retained beside the fallback's identity, so the
record shows what was refused *and* what was done instead. The policy id
becomes `newton-cg+fallback:mass-diagonal`, so a result cannot be mistaken for
a pure Newton run.

Armijo's `not-descent` verdict is deliberately not a fallback trigger. The
policy never sees it: a Newton direction that fails sufficient decrease
surfaces as the existing `stalled/not-descent` terminal with the direction
evidence attached, rather than as a second attempt at choosing a direction.

### Truncation is honest, exhaustion is not

Exhausting the Krylov budget after at least one iteration yields
`truncated-newton`. Every completed iteration passed the curvature test, so
the accumulated direction is a genuine descent direction — just a less
complete solve. Armijo still decides whether to accept it.

A budget that completed *no* iteration is different: there is no Krylov
information at all and the accumulated direction is still zero. That is
`empty-iteration-limit`, a refusal trigger rather than a direction.

The partial direction accumulated before a rejected ray is discarded rather
than reused. Reusing it is a real technique, but it makes the outcome a
matter of degree; discarding keeps the decision binary and the evidence
readable.

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
equal their prescribed prediction. Two named opt-in alternatives remain
explicit: `previous-positions` uses the last live state, while
`feasible-inertial-prediction` validates that state as an anchor and samples a
bounded geometric chord toward the prediction. The latter retains every
objective evaluation in `feasibleBaseRecovery`; it is initialization evidence,
not a collision response or a claim that the chord is globally feasible.
Application defaults remain `backward-euler` velocity reconstruction and force
clearing.

This is a transaction over the complete authored particle state. A typed
minimization or application refusal restores the state from before prediction.
Thrown provider, validation, arithmetic, and commit failures also restore that
state before escaping. This outer boundary protects callers even when a
malformed conservative provider mutates a live particle during an early trial
evaluation.

## Step an authored world

The call above names four things the caller must keep correct by hand:
`dimension`, `particles`, `gravity`, and `providers`. An authored `XpbdWorldN`
already holds all four. Passing them separately makes the world's registry and
the solver's inputs two sources of truth for the same facts, and nothing in
the type system notices when they diverge — a particle added to the world but
omitted from the array is solved as though it were not there, and the scene
being rendered stops being the scene being solved.

`stepXpbdIncrementalPotentialWorldN()` reads those four from the world and
delegates once:

```ts
import {
  XpbdWorldN,
  stepXpbdIncrementalPotentialWorldN
} from '@holotope/physics';

const contactTerms = floorBarriers.incrementalPotentialTerms();

const world = new XpbdWorldN({ dimension: 4, gravity: [0, -9.81, 0, 0] });
for (const p of particles) world.addParticle(p);
world.addForceProvider(material);
for (const provider of contactTerms.providers) world.addForceProvider(provider);

const advance = stepXpbdIncrementalPotentialWorldN({
  world,
  deltaTime: 1 / 120,
  stepFilters: contactTerms.stepFilters,
  warmStart: 'feasible-inertial-prediction'
});

if (advance.step.status === 'applied') {
  binding.writeSourcePositions();
} else {
  console.log(advance.diagnosis.condition, advance.diagnosis.levers);
}
```

`advance.step` is the same result the direct call returns — not a simplified
success flag. Feasible-base trials, candidate identity, per-filter records,
Newton evidence, minimizer terminals, and application refusals are all still
reachable through it. `advance.diagnosis` is
`diagnoseXpbdIncrementalPotentialStepN()` applied to that result, computed
once. `advance.selection` records which registry entries the step actually ran
against, by identifier, so the evidence stays readable after the particles it
names have moved.

Three things stay the caller's:

- **Step filters.** `XpbdWorldN` owns no filter registry. An implicit global
  one would make an ordered policy invisible at the call site, so they are
  passed explicitly and are not reordered or deduplicated.
- **The interval.** `deltaTime` must be finite and strictly positive. A zero
  interval is not a cheap no-op the way `PhysicsWorld4.step(0)` is; it is not
  a physical optimization step at all, and it is rejected exactly as negative
  and non-finite intervals are. A render loop that can produce a zero elapsed
  time should skip that frame. `XpbdWorldN.step()` and `stepAdaptive()` reject
  a zero interval too, so falling back to the XPBD path on an idle frame does
  not avoid the rule — the rigid `PhysicsWorld4` is the one class in the
  library whose zero step is defined.
- **Which solver path.** See below.

### One solver path per interval

A world carries two, and they are not interchangeable:

| | `world.step()` / `stepAdaptive()` | `stepXpbdIncrementalPotentialWorldN()` |
| --- | --- | --- |
| method | projected XPBD | nonlinear optimization |
| uses | constraints, responses, guards, providers | conservative providers only |
| contact | position projection | barrier potentials and step filters |

Running both over one physical interval integrates that interval twice. The
optimization path therefore never calls either of the others, and the choice
is not made for you.

It also cannot represent three of the world's five registries. Registered
scalar constraints, velocity responses, and state guards have no
incremental-potential encoding, so their presence is a configuration error
that names the first offending entry and its registry kind rather than a
silent skip. The same holds for a registered force provider without
`evaluateAt(positionOf)`: it is not conservative, and quietly solving the
conservative subset would advance a scene nobody authored.

Configuration errors throw, because no physical step was attempted.
Mathematical and algorithmic outcomes — every refusal the direct call can
produce — stay typed in `advance.step`.

## Capability boundary

These APIs provide a deterministic Float64 objective, packed first derivative,
first-order sufficient-decrease search, ordered admissible-step filtering with
an exact RN point–static-plane specialization, a bounded non-mutating
direction-policy golden path with steepest and inertial-mass specializations,
an independently auditable matrix-free curvature estimate, exact analytic
composition for completely capable provider mixtures, bounded
preconditioned-CG Newton directions, explicit direction-policy globalization,
opt-in dense provider-local and exact provider-block PSD references, an
immutable fixed-coordinate analytic operator with per-solve projected-block
reuse, an explicit atomic state transition, and a single-call transactional
reference step. They do not:

- assemble a sparse/global Hessian or direct linear factorization;
- cache projected blocks across linearization coordinates or provide a
  scalable sparse large-mesh modified-Newton backend;
- provide quasi-Newton or trust-region directions;
- apply `XpbdWorldN` scalar constraints, velocity responses, or state guards
  to the optimization path — the world-scoped step rejects them by name
  instead;
- perform mesh-wide continuous-collision-filtered search automatically;
- build mesh-wide active collision sets from edge or face stencils;
- certify an intersection-free trajectory; or
- implement Incremental Potential Contact.

The minimizer is intended for small reference problems and differential
testing, not as the production path for large stiff systems. More advanced
solvers can consume the same problem without changing its mass, energy,
identity, and sign conventions.
