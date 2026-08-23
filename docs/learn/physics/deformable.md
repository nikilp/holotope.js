# Deformable materials and XPBD

Dimension-independent simplex constitutive laws, intrinsic mass, and the RN compliant-constraint kernel that runs on point coordinates rather than rigid bodies.

<!-- doc-check: sequential -->

## What the examples build on

The material, constraint, and contact examples below are one thread over a
single deformable source: a tesseract, its cuboid 3-cells, and the simplex
decomposition a constitutive law is defined over.

<!-- doc-check: context -->

```ts
import {
  createHypercube,
  type CellComplex,
  type CellGroup,
  type VecN
} from '@holotope/core';
import { XpbdWorldN, compileXpbdParticleBindingN } from '@holotope/physics';

const source: CellComplex = createHypercube({
  dim: 4,
  size: 1,
  maxCellDimension: 3
});
const cuboidGroup: CellGroup = source
  .cellsOfDim(3)
  .find((group) => group.kind === 'cuboid')!;

// The degrees of freedom every family below is compiled against. A binding
// maps source vertices to particles; `particles` is that array, and examples
// pass it directly.
const binding = compileXpbdParticleBindingN({
  id: 'deformable-points',
  source,
  mass: 1,
  fixed: ({ sourceVertexIndex }) => sourceVertexIndex === 0
});
const particles = binding.particles;

// Rest configuration a constitutive family measures deformation against, and
// the step's starting configuration a trajectory guard compares against.
declare const restPositions: readonly VecN[];
declare const startPositions: readonly VecN[];
declare const endPositions: readonly VecN[];

const world = binding.addToWorld(new XpbdWorldN({
  dimension: 4,
  gravity: [0, -9.81, 0, 0],
  solverIterations: 12
}));
```

## Dimension-independent simplex materials

Matching rest and current k-simplices in $\mathbb{R}^N$ define an intrinsic material
coordinate without choosing an ambient normal. `evaluateSimplexMetricDeformationN()`
forms the rest and current Gram metrics, normalizes by a deterministic Cholesky
basis, and reports the right Cauchy--Green tensor `C`, Green--Lagrange strain
`E = (C - I) / 2`, principal stretches, measure ratio, and conditioning. The
same contract therefore covers a line, an embedded membrane, or a
full-dimensional solid for every `1 <= k <= N`.

Constitutive evaluators share `SimplexConstitutiveEvaluationN`: the intrinsic
deformation record, material parameters, rest measure, energy density and
total energy, symmetric second Piola stress, one analytic current-vertex
gradient per simplex vertex, and the net translation residual. The common
Float64 completion step maps a law's stress through the same deterministic
rest-material basis, so separate laws do not acquire separate geometry or
gradient conventions.

`evaluateSimplexStVenantKirchhoffN()` is the first constitutive consumer of
that coordinate. For Lamé parameters `lambda` and `mu`, it evaluates the
energy density per unit rest k-measure

$$
\psi(E)=\mu\lVert E\rVert_F^2+\frac{\lambda}{2}\operatorname{tr}(E)^2,
$$

its second Piola stress

$$
S=\lambda\operatorname{tr}(E)I+2\mu E,
$$

and the analytic gradient of total energy with respect to every current
vertex. `currentGradients[i]` is `dU/dx_i`; an internal force is its negative.
The parameters must satisfy `mu > 0` and `lambda + 2 mu / k > 0`. The API takes
Lamé parameters directly because converting Young's modulus and Poisson ratio
requires a caller-owned physical convention such as a solid, plane-strain, or
plane-stress model.

```ts
import { VecN } from '@holotope/core';
import { evaluateSimplexStVenantKirchhoffN } from '@holotope/physics';

const rest = [
  new VecN([0, 0, 0, 0]),
  new VecN([1, 0, 0, 0]),
  new VecN([0, 1, 0, 0]),
  new VecN([0, 0, 1, 0]),
  new VecN([0, 0, 0, 1])
];
const current = rest.map((point) => point.clone());
current[1]!.data[0] = 1.2;

const sample = evaluateSimplexStVenantKirchhoffN(rest, current, {
  firstLameParameter: 2,
  shearModulus: 3
});

console.log(sample.energy, sample.currentGradients);
```

The energy is metric-based, so a reflected full-dimensional simplex can have
the same value as a proper one. The accompanying deformation record retains
its signed orientation classification instead of hiding an inversion penalty
inside the material law. StVK is a small-strain reference model; time
integration, damping, bending, collision, and no-inversion barriers are
intentionally separate consumers.

`evaluateSimplexCompressibleNeoHookeanN()` supplies a large-strain reference
over the same coordinate. For positive intrinsic measure ratio `J`,

$$
\psi(C)=\frac{\mu}{2}(\operatorname{tr}C-k)-\mu\log J+
\frac{\lambda}{2}(\log J)^2,
$$

$$
S=\mu(I-C^{-1})+\lambda\log J\,C^{-1}.
$$

The reference requires `mu > 0` and `lambda >= 0`. Embedded simplices use the
positive intrinsic measure ratio and need no ambient normal. A
full-dimensional simplex instead uses its signed current/rest measure ratio
and must preserve orientation. Rank collapse or full-dimensional inversion is
outside this constitutive chart and refuses before logarithm or matrix
inversion; it is never hidden by `abs(det F)`.

```ts
import { evaluateSimplexCompressibleNeoHookeanN } from '@holotope/physics';

const robustSample = evaluateSimplexCompressibleNeoHookeanN(
  rest,
  current,
  { firstLameParameter: 2, shearModulus: 3 }
);

console.log(
  robustSample.energy,
  robustSample.volumetricLogStrain,
  robustSample.currentGradients
);
```

Its compression energy grows as `J` approaches zero, unlike StVK's polynomial
response. The refusal boundary is still not a no-tunnelling guarantee: an
explicit step can propose an invalid state, and a solver must roll back, line
search, or apply a separately specified orientation barrier.

`SimplexConstitutiveLawN` is the typed pure-evaluator seam over that common
result. The immutable `simplexStVenantKirchhoffLawN` and
`simplexCompressibleNeoHookeanLawN` descriptors are its first consumers.
`compileSimplexConstitutiveFamilyN()` assembles one chosen law over one
explicitly selected simplex group in a `CellComplex`. It copies rest positions
at compile time, validates and canonicalizes element material records at rest,
binds current positions to one existing `XpbdParticleN` per source vertex, and
retains a `SourceCellReferenceN` plus structural `SourceCellIdN` for every
element. Shared-vertex force is the deterministic sum of incident negative
energy gradients. A family evaluation reports the law id, total potential
energy, one constitutive record per element, assembled particle forces,
maximum strain, minimum measure ratio, orientation counts, and the residual of
total internal force.

The family is also an `XpbdForceProviderN`. Calling `addToWorld()` registers
the material without turning source edges into springs or copying another
particle set. Particles must already belong to the RN world. Full-dimensional
cuboids compose through `simplexizeCuboidGroupN()` by adding its generated,
named simplex group to the source before compilation; no private material-only
decomposition is required.

The family additionally implements `XpbdConservativeForceProviderN`.
`evaluateAt(positionOf)` evaluates the same source-identified energy and
negative-gradient forces at arbitrary trial positions without writing live
particles. `evaluateXpbdPotentialStateN()` composes several conservative
providers by particle identity and returns total potential energy plus
mathematical gradients in a caller-authored particle order. This is the pure
candidate-objective seam described in
[Candidate-state conservative potentials](../theory/candidate-potentials.md); it does
not itself advance time or choose a nonlinear solver.

`predictXpbdInertialStateN()` and
`evaluateXpbdIncrementalPotentialN()` form the next pure layer. The predictor
matches the point world's semi-implicit gravity and accumulated-external-force
semantics without mutating it. The evaluator combines that prediction with
the candidate energy as

$$
E(q)=\frac{1}{2}\sum_{i\ \mathrm{dynamic}}
m_i\lVert q_i-\widehat q_i\rVert^2+h^2U(q).
$$

Fixed particles remain prescribed coordinates and therefore receive zero
free-coordinate gradient; their complete conservative reaction remains in the
nested potential evidence. See
[Incremental potential objectives](../theory/incremental-potentials.md). The predictor
and evaluator alone do not choose a search direction or advance state.

`compileXpbdIncrementalPotentialProblemN()` packs only dynamic particle axes
into a deterministic solver vector while restoring fixed coordinates from the
prediction. `searchXpbdIncrementalPotentialArmijoN()` supplies a first-order
sufficient-decrease reference over that vector. It backtracks only typed
`XpbdPotentialDomainErrorN` refusals, including its
`SimplexConstitutiveDomainErrorN` specialization; every malformed, arithmetic,
lineage, or generic-provider failure escapes. An accepted search result is
still only a candidate snapshot and does not write particle state.

Optional `XpbdIncrementalPotentialStepFilterN` instances inspect the complete
particle-space segment before any Armijo objective trial. They certify it,
shorten it to a safe prefix, or explicitly refuse. The exact
`XpbdParticleHyperplaneBarrierStepFilterN` specialization solves an RN
point–static-plane crossing in closed form and stops at a conservative fraction
of impact. Results remain on the search evidence. `indeterminate` becomes
`step-filter-refused`, and the minimizer preserves the distinction as
`line-search-refused`; neither state is a collision miss or ordinary line
search exhaustion.

For one authored finite obstacle feature,
`XpbdParticleSourceSimplexBarrierN` instead uses unsigned distance to a
persistent closed source simplex and retains its closest barycentric source
coordinate. For source dimensions 1 through 3, the query makes its rank,
active-face, and zero-distance decisions exactly on the supplied Float64
geometry, then publishes a coherent Float64 witness with outward error bounds.
It has no rank or barycentric tolerance knobs. Its paired step filter certifies
a complete non-closing segment or a conservative Lipschitz prefix, reading the
segment's **start state alone** — convexity and the global 1-Lipschitz bound
make the endpoint's own distance irrelevant to both proofs, so an endpoint the
exact query cannot publish does not refuse a prefix that exists. That prefix is
not an exact impact time, and neither class discovers candidate pairs from a
mesh.

Higher-dimensional source simplices currently use the legacy Float64 projector
and therefore do not expose exact `pointSimplex` evidence. They are also slow
enough to plan around: roughly 7.8–12.2 seconds per `evaluateAt()` at `k = 17`,
a batch-scale cost with no interactive or per-frame use.

For a bounded dynamic-source/static-obstacle scene,
`compileXpbdParticleSourceSimplexBarrierFamilyN()` adds that missing discovery
layer without changing the pair law. It keeps the dynamic source vertex and
static source simplex in every candidate ID, culls only through a conservative
swept-AABB envelope, evaluates exact-on-supplied-Float64 barriers for
point-query-active pairs,
and aggregates the per-pair prefix certificates through one paired step
filter. When a candidate refuses, the aggregate reports **that candidate's own
reason** rather than an aggregate-specific relabelling of it, and
`blockingCandidateId` names which candidate it came from. The diagnostics keep
possible, retained, and exact-active counts separate. This remains an exhaustive reference query rather than a spatial
hierarchy, and it deliberately refuses to present a same-source mesh as
self-contact because obstacle reaction and moving simplex geometry are not yet
part of the contract.

`compileXpbdParticleSourceConvexHullBarrierFamilyN()` answers a different
question: what if the obstacle's cells are not independently meaningful
features but merely a decomposition of one solid? Summing one barrier per cell
is exactly right for the former and exactly wrong for the latter — each cell
pushes away from *itself*, so over a flat support the sum acquires a
decomposition-dependent tangential component. The convex-hull family instead
represents **one static convex set**: the convex hull of the obstacle vertices
its `sourceGroup` selects, queried by one certified closest-point computation
per bound particle. The force is the barrier's negative gradient along the
separation normal; the witness retains which authoritative source vertices
support the closest feature; and the diagnostics count set queries — exactly
one per particle, never one per cell. Three boundaries are part of the
contract rather than caveats: the represented set is the *hull*, so
concavities between selected vertices are filled; the hull is *static*, its
coordinates snapshotted at compile time and refused if moved; and proximity to
a lower-dimensional hull (a flat slab in R4, say) is *unsigned and two-sided*,
because such a set has no ambient inside.

A fourth boundary is easy to read past. One barrier per bound particle means the
certificate is *per-vertex*: every constrained particle stays outside the
minimum-distance shell. That is not a claim about the surface between them. A
triangle can cross a convex set with all three vertices legally outside it, so a
mesh whose vertices are all constrained here can still have interior geometry
inside the support. Refinement does not remove that: measured over one authored
scene at two resolutions, the finer mesh breached earlier in its own run than the
coarser one, each following that scene's own departure from the support rather
than its vertex spacing. Constraining the surface needs edge- and face-level
candidates, which this family does not provide. A distance query that cannot certify
its answer surfaces as a typed `closest-point-indeterminate` refusal rather
than a guess, and the paired filter certifies conservative prefixes with the
same convexity/Lipschitz argument as the point–simplex filter.

`compileXpbdParticleHyperplaneBarrierFamilyN()` expands the same pair over the
source-vertex mapping retained by `XpbdParticleHyperplaneFamilyN`. Per-vertex
activation distance, stiffness, and conservative scale may be uniform or
source-indexed callbacks. `incrementalPotentialTerms()` returns the frozen
provider/filter arrays together for direct use by a compiled problem or the
transactional step. Adding the barrier family to `XpbdWorldN` registers only
its conservative forces; normal projection constraints remain opt-in.

`minimizeXpbdIncrementalPotentialN()` composes those two pieces into a bounded
first-order golden path. Its default
`xpbdSteepestDescentDirectionN` preserves negative-gradient descent, while
`xpbdMassPreconditionedDirectionN` applies the exact inverse diagonal inertial
mass block. It records policy identity plus every accepted direction, step,
objective decrease, and line search, and terminates as `converged`,
`iteration-limit`, `line-search-exhausted`, `line-search-refused`, or
`stalled`. Convergence is an authored absolute gradient-norm test, not a
global-minimum claim. The routine is intentionally non-mutating and intended
for small reference problems and differential tests; it is not a Hessian-based
production material solver.

`applyXpbdIncrementalPotentialResultN()` is the explicit atomic transition
from that detached evidence to particle state. Each minimization result retains
its exact compiled problem, whose defensive live-state snapshot provides
`q_n`. Only converged results are eligible. The default dynamic velocity is
`(q_(n+1) - q_n) / h`, fixed velocity is preserved, and accumulated external
force clears after success. Preserved-velocity and retained-force policies are
explicit options. Live-state drift, changed result evidence, and verifier
mutation return typed refusals; generic provider or arithmetic errors escape
only after rollback. Application still does not compose an automatic world
step, velocity responses, state guards, or adaptive retry.

`stepXpbdIncrementalPotentialN()` supplies the first single-call conservative
reference step by composing prediction, compilation, bounded minimization,
verification, and application. It retains every intermediate result rather
than flattening the process into a boolean. Both typed refusal and thrown-error
paths restore the complete particle state captured before prediction; only an
`applied` result advances the live particles. The default initial iterate is
the inertial prediction, with an explicit particle-ordered warm start
available. This remains a small-system first-order golden path. It does
not fabricate `XpbdWorldN` constraint-solve evidence, so velocity responses,
accepted-state guards, adaptive retry, material-Hessian directions, and
automatic world-level collision orchestration remain outside this step.
Authored point–plane families and the dynamic-point/static-simplex candidate
family can protect the pairs they describe. Moving--moving mesh candidates,
self-contact, and pair refresh outside the candidate-aware family still carry
no implied collision-free guarantee.

## Extrinsic stiffness: discrete cosine-fold bending

The constitutive families above resist stretching within a simplex. They do
not resist *folding* between adjacent simplices, because an intrinsic metric
cannot see it — a sheet folded along an edge has every triangle undeformed.

`compileXpbdSourceSimplexCosineBendingFamilyN()` supplies that missing
extrinsic term. **Read this before the first snippet: it is a discrete
cosine-fold stiffness, not a shell model.** The coordinate is the
orientation-neutral cosine of the fold from flat,

$$
c=-u_A\cdot u_B,\qquad u_A=\frac{(I-QQ^{T})(a-f_0)}{\lVert(I-QQ^{T})(a-f_0)\rVert},
$$

with `Q` spanning the shared face's edge directions. Flat is `c = 1`, fully
folded is `c = -1`, and for an R3 triangle hinge `c = -cos(φ)` for the
conventional interior dihedral. It is **unsigned**: it cannot distinguish a
mountain fold from a valley fold, because the convention that would give it a
sign is specific to R3.

The energy is `0.5 · stiffness · (c - cRest)²`. Quadratic in the cosine is
**quartic in the fold angle**, which has two consequences worth knowing before
you tune anything:

- **It is not mesh-convergent.** Refining a fixed cylindrical strip in place
  drives the total energy to zero as `n^-2.99`. No weighting repairs this —
  the Discrete Shells face/height weight was measured too and still gives
  `n^-2.00` — which is why only unit weighting is exposed. A stiffness tuned
  on one mesh does not transfer to a refinement of it.
- **Flat rest responds weakly to small folds.** At `c = 1` the first
  derivative vanishes, so this resists large folds firmly and barely notices
  small ones.

```ts
import { CellComplex } from '@holotope/core';
import {
  compileXpbdParticleBindingN,
  compileXpbdSourceSimplexCosineBendingFamilyN
} from '@holotope/physics';

// Two R4 triangles sharing one edge, creased out of plane.
const membraneGroup = {
  key: 'membrane', dim: 2, verticesPerCell: 3, kind: 'simplex' as const,
  indices: Uint32Array.from([0, 1, 2, 1, 3, 2])
};
const membrane = new CellComplex(4, Float64Array.from([
  0, 0, 0, 0,
  1, 0, 0, 0,
  0, 1, 0.4, 0,
  1, 1, 0, 0
]), [membraneGroup]);
const membraneBinding = compileXpbdParticleBindingN({
  id: 'membrane-points', source: membrane
});

const bending = compileXpbdSourceSimplexCosineBendingFamilyN({
  id: 'membrane-bending',
  binding: membraneBinding,
  simplexGroup: membraneGroup,
  stiffness: 25,          // discretization-dependent, not a material constant
  restCoordinate: 1,      // flat; omit to capture the authored shape instead
  minimumMeasureRatio: 0.05
});

const bendingEvaluation = bending.evaluate();
console.log(
  bending.hinges.length,                 // interior hinges found
  bending.boundaryFaceCount,             // faces with one incident cell
  bendingEvaluation.weighting,           // 'unit-discrete'
  bendingEvaluation.netForceResidual     // ~0: no net force from bending
);
```

Hinges are discovered from the source, not authored: every codimension-one
face with exactly two incident cells becomes one. Boundary faces are counted
and skipped. A face with three or more incident cells refuses the whole
compilation rather than pairing two of them and inventing an adjacency the
mesh never had.

Rest geometry is snapshotted at compilation, exactly as
`compileSimplexConstitutiveFamilyN()` snapshots rest positions. Writing new
coordinates through `binding.writeSourcePositions()` therefore deforms the
mesh *against* its captured rest shape rather than silently redefining it.
Changing the rest state is a recompilation.

### The paired filter is not optional

```ts
const bendingTerms = bending.incrementalPotentialTerms();
// bendingTerms.providers -> [bending]
// bendingTerms.stepFilters -> [bending.stepFilter]
```

Endpoint evaluation cannot protect this coordinate on its own. A linear search
segment can begin and end with perfectly good hinges while passing through
zero conormal height in between — at that instant the fold coordinate does not
exist, and both endpoints look finite. The paired filter reuses
`analyzeLinearSimplexMeasureN` over each distinct source simplex, because
non-zero intrinsic measure on both incident cells implies a full-rank shared
face and a non-zero apex conormal. What it returns is a conservative
admissible prefix and an intrinsic-rank certificate, never an exact collapse
time.

Always pass `bending.stepFilter` to the solve alongside the provider.

This family is first-order only. It exposes no Hessian, so Newton-CG refuses
the provider mixture with named unsupported-provider evidence rather than
quietly dropping the bending block.

When that obstacle grows large enough for the pair scan to dominate, compile a
static AABB hierarchy over it and pass it as `candidateHierarchy`. It is opt-in
and object-bound: nothing switches strategy by mesh size, and a tree over a
structurally identical but different source is refused. Candidate identity and
order are unchanged, and the exact barrier and paired filter still decide
contact — the tree narrows which pairs are asked and answers none of them. It
also requires the obstacle to hold still: it snapshots the coordinates it
indexed and refuses a moved source by name instead of rebuilding itself. See
[the theory page](../theory/incremental-potentials.md#selecting-a-static-aabb-hierarchy).

`stepXpbdIncrementalPotentialWorldN()` advances that same transaction from an
authored `XpbdWorldN`. Everything on this page adds its provider to a world
with `addToWorld()`, so the world already holds the dimension, the particle
order, the gravity vector, and the provider registry the step needs; passing
them separately makes the solved system and the authored one two different
things that nothing checks. The world-scoped call reads all four from the
registry and delegates once, and `result.step` is the unchanged result
described above.

It does not soften the boundary this section states — it makes it enforceable.
A state guard registered on the same world, as below, is exactly what the
optimization path cannot apply; rather than being quietly ignored, its
presence is a configuration error naming the guard. The same holds for a
scalar constraint, a velocity response, and a force provider that is not
conservative. So a world authored for `stepAdaptive()` is not silently
accepted by the optimization path, and choosing between the two paths stays a
decision the caller makes for each physical interval.

```ts
import { simplexizeCuboidGroupN } from '@holotope/core';
import {
  compileSimplexConstitutiveFamilyN,
  simplexCompressibleNeoHookeanLawN
} from '@holotope/physics';

const decomposition = simplexizeCuboidGroupN(cuboidGroup, {
  outputKey: 'solid-simplices'
});
source.addGroup(decomposition.simplexGroup);

const solid = compileSimplexConstitutiveFamilyN({
  id: 'solid',
  source,
  simplexGroup: decomposition.simplexGroup,
  particles,
  law: simplexCompressibleNeoHookeanLawN,
  material: { firstLameParameter: 2, shearModulus: 3 }
});

solid.addToWorld(world);
```

`compileSimplexStVenantKirchhoffFamilyN()` remains the compatible named StVK
surface. `compileSimplexCompressibleNeoHookeanFamilyN()` is the equivalent
discoverable Neo-Hookean convenience surface. Both are thin typed wrappers over
the same generic lineage, ownership, rest-state, accumulation, and world
composition behavior; neither creates another particle set or private
simplexization.

`evaluateSimplexMeasureBarrierN()` is an optional lower-measure constitutive
component over the same intrinsic coordinate. Given minimum ratio `m`,
activation ratio `a`, stiffness `kappa`, and `d = J - m`, `h = a - m`, its
energy density is

$$
\psi_b(J)=
\begin{cases}
-\kappa(d-h)^2\log(d/h), & m < J < a,\\
0, & J \ge a.
\end{cases}
$$

It is exactly zero and C2 at `a`, and diverges as `J` approaches `m` from
above. The evaluator exposes both scalar derivatives with respect to `J` and
uses `S = (d psi_b / dJ) J C^{-1}` for its analytic second Piola stress and
ambient vertex gradients. Embedded simplices use positive intrinsic measure;
full-dimensional simplices must preserve signed orientation. The clamped
scalar shape is adapted from equation 6 of Li et al.,
[“Incremental Potential Contact” (2020)](https://ipc-sim.github.io/file/IPC-paper-fullRes.pdf),
but this API is a constitutive component only—it does not by itself implement
the complete IPC algorithm or inherit its guarantees.

```ts
import {
  compileSimplexConstitutiveFamilyN,
  simplexMeasureBarrierLawN
} from '@holotope/physics';

const barrier = compileSimplexConstitutiveFamilyN({
  id: 'solid-measure-barrier',
  source,
  simplexGroup: decomposition.simplexGroup,
  particles,
  law: simplexMeasureBarrierLawN,
  material: {
    minimumMeasureRatio: 0.1,
    activationMeasureRatio: 0.8,
    stiffness: 4
  }
});

solid.addToWorld(world);
barrier.addToWorld(world);
```

The two families deliberately share source ids and particle identity while
retaining separate energies and force evidence. A finite explicit force can
still overshoot the boundary; the barrier therefore complements rather than
replaces the endpoint and continuous-chord guards.

An accepted-state policy remains separate from force evaluation. The optional
`compileSimplexConstitutiveFamilyStateGuardN()` adapter reevaluates one generic
family after each completed point-world substep. It rejects a typed
constitutive-domain refusal, any full-dimensional orientation change, or a
current/rest measure ratio below an explicit positive threshold. Its result
retains the law id, threshold, margin, orientation counts, potential energy,
and complete family evaluation when the law remains in domain.

```ts
import {
  compileSimplexConstitutiveFamilyStateGuardN
} from '@holotope/physics';

const guard = compileSimplexConstitutiveFamilyStateGuardN({
  id: 'solid-domain',
  family: solid,
  minimumMeasureRatio: 0.1
});
guard.addToWorld(world);

const accepted = world.stepAdaptive(1 / 60, {
  initialSubsteps: 1,
  maximumSubsteps: 16,
  growthFactor: 2
});
console.log(accepted.attempts);
```

`stepAdaptive()` retries only typed state-guard rejection. Every failed attempt
is rolled back to the same outer-step snapshot, and a successful attempt still
advances exactly the requested duration. Malformed callbacks, non-finite
values, ownership violations, and ordinary numerical/programming errors are
not retried. Exhaustion throws `XpbdAdaptiveStepFailureErrorN` with the complete
attempt sequence while leaving the world unchanged. Subdivision checks each
completed substep; it does not prove that the continuous path stayed
orientation-preserving between endpoints and is not an inversion barrier or
implicit material solve.

For full-dimensional simplices, `analyzeLinearSimplexOrientationN()` closes
that specific endpoint gap along a straight substep chord. If every particle
position is linearly interpolated from its substep start to end, the normalized
oriented determinant is a polynomial of degree at most N. The Float64 reference
path constructs its coefficients by determinant multilinearity, converts them
to the Bernstein basis, and subdivides left-to-right with de Casteljau. A
strictly positive Bernstein convex-hull lower bound certifies an interval;
otherwise the result conservatively encloses the earliest possible contact
with the requested signed-measure threshold, including a tangency that does
not change endpoint signs.

```ts
import {
  analyzeLinearSimplexOrientationN,
  compileSimplexConstitutiveFamilyTrajectoryGuardN
} from '@holotope/physics';

const analysis = analyzeLinearSimplexOrientationN({
  restPositions,
  startPositions,
  endPositions,
  minimumSignedMeasureRatio: 0.1
});

if (analysis.status === 'possible-violation') {
  console.log(analysis.timeBracket, analysis.bernsteinBounds);
}

const trajectoryGuard = compileSimplexConstitutiveFamilyTrajectoryGuardN({
  id: 'solid-linear-orientation',
  family: solid,
  minimumSignedMeasureRatio: 0.1
});
trajectoryGuard.addToWorld(world);
```

The family policy uses the world's exact pre-substep position snapshot and the
completed positions, retains the candidate source element and its polynomial
evidence, and rejects through the same transactional adaptive-step seam. It is
independent of the endpoint material-domain guard; attach both when both
policies matter. The query accepts only an N-simplex in $\mathbb{R}^N$. Its auditable
coefficient construction costs `O(2^N N^3)`, so this is a
small-N CPU golden path rather than the eventual high-dimensional backend.
Within its explicit Float64 coefficient and subdivision tolerances it certifies
the linear chord, not the nonlinear solver trajectory, curved prescribed
motion, or a formal outward-rounded interval.

For any non-degenerate k-simplex embedded in $\mathbb{R}^N$,
`analyzeLinearSimplexMeasureN()` supplies the complementary intrinsic query.
With edge matrix `E(t)`, the Gram determinant
`det(E(t)^T E(t)) / det(Erest^T Erest)` is the squared current/rest k-measure
ratio. Its degree is at most `2k` along a linear chord. The reference path
constructs the three Gram coefficient matrices, expands their determinant by
column multilinearity, and applies the same shared Bernstein classifier.

<!-- doc-check: skip — guards `embeddedMaterial`, a membrane family this page discusses but never constructs -->

```ts
import {
  analyzeLinearSimplexMeasureN,
  compileSimplexConstitutiveFamilyMeasureTrajectoryGuardN
} from '@holotope/physics';

const intrinsic = analyzeLinearSimplexMeasureN({
  restPositions,
  startPositions,
  endPositions,
  minimumMeasureRatio: 0.1
});

const intrinsicGuard =
  compileSimplexConstitutiveFamilyMeasureTrajectoryGuardN({
    id: 'membrane-linear-measure',
    family: embeddedMaterial,
    minimumMeasureRatio: 0.1
  });
intrinsicGuard.addToWorld(world);
```

The intrinsic query detects rank loss without choosing a normal frame. Its
polynomial and reported margins are in squared-measure-ratio units. It neither
assigns an orientation to embedded geometry nor distinguishes reflected
embedded frames. For a full-dimensional material, prefer the signed
orientation guard; the intrinsic guard is only a rank/measure policy. Its
coefficient construction costs `O(3^k k^3 + N k^2)` and has the same linear
chord, Float64 tolerance, and non-formal-certificate boundary.


## Feature contact: source-simplex pairs

Point barriers constrain vertices, and P53d measured their exact boundary:
every sheet vertex can remain legally outside a support while a triangle
interior cuts through it. Feature contact closes that gap by constraining
**pairs of source simplices**:

- `evaluateSourceSimplexPairDistanceN` — the certified minimum distance
  between two finite source features (any arities: vertex–face and edge–edge
  are the same query), with ordered barycentric witnesses on both sides. The
  result union is the contract: `separated-unique` carries a measured
  uniqueness margin (the gradient's justification, by Danskin's theorem);
  `separated-multiple` returns every tied witness — parallel edges are the
  canonical case — and **no gradient**, because none uniquely exists;
  `zero-distance` certifies contact with no invented normal; `indeterminate`
  refuses with its own residuals.
- `XpbdSourceSimplexPairBarrierN` — the same clamped-log law the point
  barrier uses, over the pair distance, with forces distributed through the
  witness weights (the envelope form). Two moving sides conserve net force
  and the RN antisymmetric first moment to roundoff. Everything without a
  unique gradient refuses by type.
- `XpbdSourceSimplexPairBarrierStepFilterN` — the two-sided Lipschitz proof
  `d(t) ≥ d(0) − t·(maxDispA + maxDispB)`. A **certified fraction, never a
  collision time**; a tied start is accepted because the bound needs only the
  certified distance.
- `compileXpbdSourceSimplexPairBarrierFamilyN` — one pair per source cell of
  a deforming group against one static feature. The summed energy's density
  is **discretization-defined**: a contact under an edge shared by two cells
  carries both cells' terms (measured: exactly 2× one term; a refinement
  placing four cells there, exactly 4×) — stated in the docs, like the
  bending family's stiffness, rather than averaged away.

### Measure-weighted contact: resisting by size, not by vertex count

The pair family above states its density honestly: the summed energy is
**discretization-defined**, so a contact under an edge shared by two cells
carries both cells' terms, and a refinement placing four cells there carries
four. `compileXpbdSourceSimplexMeasureBarrierN` is the law that removes that
dependence. Its energy is the cell's **reference** measure times the average of
the barrier over a fixed set of interior nodes:

```text
E(q) = mu0 * sum_j w_j * psi(d_j(q) - dmin)
```

Splitting a cell splits `mu0` between the halves, so two cells do not answer
twice for one contact. When the sampled barrier is **constant** along the cell
— as it is for a strip parallel to a flat obstacle — subdivision is exactly
additive:

```ts
import {
  CellComplex,
  createSourceCellReferenceN,
  createSourceSimplexReferenceN
} from '@holotope/core';
import {
  compileXpbdParticleBindingN,
  compileXpbdSourceSimplexMeasureBarrierN
} from '@holotope/physics';

const floor = new CellComplex(3, Float64Array.from([
  -40, 0, -40, 60, 0, -40, -40, 0, 60
]), [{
  dim: 2, verticesPerCell: 3, kind: 'simplex',
  indices: Uint32Array.from([0, 1, 2])
}]);
const obstacle = createSourceSimplexReferenceN(
  createSourceCellReferenceN(floor, floor.groups[0]!, 0)
);

function energyOf(from: number, to: number): number {
  const strip = new CellComplex(3, Float64Array.from([
    from, 0.5, 0, to, 0.5, 0
  ]), [{
    dim: 1, verticesPerCell: 2, kind: 'simplex',
    indices: Uint32Array.from([0, 1])
  }]);
  const { provider } = compileXpbdSourceSimplexMeasureBarrierN({
    id: `contact-${from}`,
    binding: compileXpbdParticleBindingN({ id: `strip-${from}`, source: strip }),
    cell: createSourceSimplexReferenceN(
      createSourceCellReferenceN(strip, strip.groups[0]!, 0)
    ),
    obstacle,
    minimumDistance: 0.05,
    activationDistance: 1,
    stiffness: 2,
    maximumDirectionError: 1e-6
  });
  return provider.evaluate().potentialEnergy;
}

// One cell, or the two that subdivide it: the same number — for this
// constant-distance arrangement, and because of it.
console.log(energyOf(0, 1), energyOf(0, 0.5) + energyOf(0.5, 1));
```

### Subdivision is not invariance

That calibration is easy to over-read, so state the boundary plainly. The
integrand is a nonlinear barrier of a distance field, integrated by a **fixed
finite quadrature**. Subdivision moves the sample locations, so it normally
changes the estimate. Three separate facts:

| | |
|---|---|
| **Constant integrand** | subdivision is exactly additive, up to Float64 reduction — the case above |
| **General nonconstant integrand** | subdivision changes the estimate: a tilted cell split into two equal subcells moves by **≈27%**, an uneven split of a curved arrangement by **≈44%** |
| **Convergence** | the refinement sequence approaches the continuum integral — measured at **second order** in the cell size against an independent composite Gauss–Legendre reference, with the single-cell estimate ≈28% *below* the continuum value |

The third row is a **measurement on a named fixture**, not a bound. No
truncation estimate is proved for this rule and none is claimed. If a scene
needs a converged contact integral rather than a consistent one, refine the
source mesh and measure — the sequence is what tells you where you are.

What reference-measure weighting *does* remove is direct cell-count
multiplication: the released pair family carries one term per source cell, so
four cells under one contact carry four terms, while this law carries the
measure once. Neither statement implies exact invariance under remeshing.

Four things about that call are deliberate.

**The measure is the REST one.** It is read once, from the binding's validated
snapshot of the source, and frozen. Weighting by the current measure would give
the energy a second path through the cell's own deformation, and the published
forces — which are the exact gradient of the published energy — would then be
incomplete. It also means a cell that degenerates at a candidate is not this
term's problem: a node is a fixed affine combination of the vertices whether or
not they span anything. Only the *rest* cell must be non-degenerate, and that is
a configuration error, raised once at compile time.

**The quadrature is fixed and not authorable.** The `k + 1` nodes are the
barycentric orbit of `(alpha, beta, ..., beta)` with `alpha = 2/(k+2)`: distinct,
strictly interior, equally weighted, averaging to the centroid. It is a
**reference measure**, not a quadrature with a truncation bound — the energy *is*
the weighted node sum, so a refined rule would be a different law rather than a
better approximation of this one. Every property stated here is a property of
this rule, which is why there is no knob.

**`maximumDirectionError` has no default.** The exact point–simplex query
publishes a direction enclosure and no universal radius is right for every
scene, so the policy is authored or the construction fails. A node whose
published direction is less accurate than the policy admits refuses with
`direction-error-exceeds-policy`, and the term refuses **as a whole**: a single
node that cannot be evaluated leaves the sum undefined, so no partial energy is
published.

**The paired filter reads geometry only at the segment start**, and that is the
safety argument rather than an optimization. The law measures unsigned distance
and has no notion of side, so a segment can begin `0.5` above the obstacle and
end `0.5` below it with *both ends admissible*; a filter that checked the two
endpoints would certify the tunnel. The two-sided Lipschitz bound cannot,
because it is a lower envelope over the whole segment taken from one placement,
and it certifies against the worst node rather than the average one. Register it
alongside the provider — the two are only sound together:

```ts
import { XpbdWorldN, stepXpbdIncrementalPotentialWorldN } from '@holotope/physics';
import type { XpbdSourceSimplexMeasureBarrierTermsN } from '@holotope/physics';

declare const terms: XpbdSourceSimplexMeasureBarrierTermsN;
declare const world: XpbdWorldN;

world.addForceProvider(terms.provider);
const advance = stepXpbdIncrementalPotentialWorldN({
  world,
  deltaTime: 1 / 120,
  stepFilters: [terms.stepFilter],
  warmStart: 'feasible-inertial-prediction'
});
console.log(advance.step.status);
```

### What this term claims, and what it does not

| | |
|---|---|
| supported source dimensions | `k = 1, 2, 3` — the range over which the exact point–simplex query publishes a direction enclosure |
| successful evaluation | exactly `potentialEnergy` and `forces`; no inspection surface and no Layer-2 record exists |
| the quadrature | fixed, not authorable, and not reachable at runtime — the compiled terms are frozen and hold every non-authorable value in closure |
| runtime privacy | persistent state is read by index and never used as the receiver of an inherited operation; everything handed to released code is built fresh per call. The claim is not that a hostile same-realm consumer can observe nothing, but that nothing it captures can change a later evaluation |
| truncation | none proved and none claimed; convergence is a measurement on a named fixture |
| subdivision | generally changes the sampling and may change the energy |
| the companion filter | **required**, not optional — see the unsigned-distance argument above |
| `newton-cg` | this term supplies the first-derivative seam only, so a Newton-CG search without a fallback terminates as `direction-refused`; the default first-order path and an authored fallback both drive it |
| scope | **normal contact only** — friction is the separate lagged pair-friction term |
| performance | no portable timing or performance multiplier is claimed |

A moving obstacle is supported through `obstacleBinding`, and every particle it
contributes must be kinematic (`inverseMass === 0`). The reaction on those
vertices is still published, so the term stays a closed statement about the
energy — but the energy weights the *cell's* measure alone, and letting the
obstacle respond to a force derived from a measure that is not its own would not
be a contact law anyone authored.

### Lagged friction inside the objective

`XpbdSourceSimplexPairFrictionN` adds the first dissipative contact term that
lives *in* the incremental objective rather than after the solve:

- **`prepare()` freezes one lag** at an accepted state — the certified normal,
  the source-ordered witness weights, and the paired barrier's own normal-force
  magnitude. While that snapshot is held the term is an ordinary conservative
  potential with an exact gradient, so every line-search trial sees one
  consistent objective. Dissipation appears *between* accepted states, when the
  lag is refreshed. It is **not** a globally conservative physical force.
- **Only `separated-unique` may create a lag.** Tied witnesses, certified zero
  distance, uncertified comparisons and sub-minimum distances refuse by type —
  a friction frame cannot be chosen from among equally optimal witnesses, and a
  zero gap has no tangent plane at all.
- **No authored tangent basis.** `I − n nᵀ` is applied directly, which is what
  makes the term dimension-generic instead of a 3D construction with extra
  cases.
- **The regularized Coulomb law** is C¹, with a force that stays linear through
  zero slip (`u/‖u‖` is never evaluated) and satisfies `‖f‖ ≤ μ·λ_lag` by
  construction. Its parameter, `slipRegularization`, written as a bare number is
  a **length** in world units — not a velocity threshold and not scaled by the
  timestep, and never reinterpreted as one.
- **A fixed length does not survive timestep refinement.** Per-step slip is
  `‖tangential velocity‖ · deltaTime`, so inside the regularized branch the
  force goes as `deltaTime` and a fixed horizon's total impulse as `deltaTime` —
  friction vanishes, measured at 0.133 of its coarse value over an eight-fold
  refinement. `{ kind: 'slip-velocity', velocity }` resolves the length as
  `velocity · deltaTime` once per `prepare({ deltaTime })`, cancelling the
  timestep out of `slip / length`; the same refinement then holds the impulse to
  1.06. `deltaTime` is required at `prepare` under a slip velocity and refused
  under a slip length. A velocity-resolved scale is still a smoothing scale: it
  is not static friction and not finite-support retention.
- **`regime` and `contactActive` are orthogonal.** `regime` is a statement about
  slip alone; `contactActive` is exactly `forceLimit > 0`. Neither implies the
  other — in the sheet probe 144 of 192 evaluations read `'sliding'` while
  exerting exactly zero force.
- **A consumed lag is a named failure**, never an implicit refresh, so a lag
  cannot move between Armijo trials.
- `compileXpbdSourceSimplexPairFrictionFamilyN` lifts it over a contact family
  with atomic consume/rollback, and **effective friction follows mesh
  topology** (shared edge 2×, four-cell refinement 4×) — measured and stated,
  never averaged away.

Two things this is not. It is not `XpbdParticleHyperplaneFrictionN`, the
post-projection velocity response for `world.step()`; the incremental path
refuses velocity responses and this term satisfies the conservative contract
honestly instead of routing around that. And observed energy decay is **not**
evidence that friction did the work: an integrator can lose energy on its own,
so the work has to be measured.

What this is not: self-contact, mesh–mesh continuous collision detection,
moving-obstacle friction, adhesion, restitution, or anisotropic friction.
Those remain explicitly out of scope until their own slices prove them.

## Source particles and intrinsic mass

Simulation state is bound to source topology independently of any constraint or
material family. `compileXpbdParticleBindingN()` creates exactly one live
`XpbdParticleN` per source vertex, preserves source ordinal correspondence, and
owns the explicit transactional write back to `CellComplex.positions`. Its
`mass` policy is strictly positive physical evidence. A separate `fixed`
policy maps mobility to zero inverse mass, so pinning does not erase an
object's authored mass.

For a selected k-simplex family, `lumpSimplexMassesN()` integrates
`density * rest k-measure` and assigns an equal share of each element mass to
its `k + 1` incident vertices. Measure is intrinsic: the same operation covers
lines, embedded membranes, volumes, and full-dimensional cells without an
ambient normal. The returned record retains source identity per element and
reports both element and vertex totals plus their Float64 residual.

```ts
import {
  compileXpbdParticleBindingN,
  lumpSimplexMassesN
} from '@holotope/physics';

const masses = lumpSimplexMassesN({
  source,
  simplexGroup: decomposition.simplexGroup,
  density: 1.25
});

const binding = compileXpbdParticleBindingN({
  id: 'solid-points',
  source,
  mass: ({ sourceVertexIndex }) => masses.vertexMasses[sourceVertexIndex]!,
  fixed: ({ sourceVertexIndex }) => sourceVertexIndex === 0
});
```

Equal lumping is the diagonal reference mass model, not a consistent mass
matrix. Vertices unused by the selected family receive zero in the mass
record; a particle binding must assign those vertices another positive mass or
exclude them at a higher modeling boundary.

## Dimension-generic compliant point constraints

`XpbdConstraintSolverN` is the Float64 reference path for scalar extended
position-based dynamics (XPBD) over point generalized coordinates. It is
dimension-explicit and independent of the velocity-level R4 rigid solver. For
a scalar equality `C(x) = 0`, inverse point masses `w_i`, gradients `g_i`,
physical compliance `alpha`, and step duration `h`, each sequential visit uses

$$
\widetilde\alpha=\frac{\alpha}{h^2},
\qquad
W=\sum_i w_i\|g_i\|^2,
$$

$$
\Delta\lambda=
\frac{-C(x)-\widetilde\alpha\lambda}
{W+\widetilde\alpha},
\qquad
\Delta x_i=w_i g_i\Delta\lambda.
$$

The total multiplier starts at zero for each `solve()` call, so one call is one
position-projection phase of a time step. Results expose `lambda`, the signed
force estimate `lambda / h^2`, and the compliant residual
`C + alpha-tilde * lambda`; constraint value alone is not a convergence test
when compliance is nonzero. A batch has one explicit ambient dimension, and
every point and gradient must agree with it. A constraint whose weighted
gradient has no movable response returns `no-dynamic-response` instead of
dividing by zero.

A scalar inequality declares `relation: 'greater-than-or-equal'` and means
`C(x) >= 0`. Its trial update uses the same denominator, then projects the
total multiplier onto the non-negative ray:

$$
\lambda' = \max(0,\lambda+\Delta\lambda^*),
\qquad
\Delta\lambda=\lambda'-\lambda.
$$

An inactive inequality may have positive compliant slack. Results therefore
retain `compliantResidual` as raw evidence and expose a separate
`projectedKktResidual`: it is the raw residual for an active constraint and
the negative part of that residual when the multiplier is zero. Equality
results report the same value through both fields. Solve and world results
aggregate `maxAbsProjectedKktResidual` independently.

```ts
import { VecN } from '@holotope/core';
import {
  XpbdConstraintSolverN,
  XpbdDistanceConstraintN
} from '@holotope/physics';

// A particle is a constructed XpbdParticleN, not a bare literal: it carries an
// id, velocity, and force alongside the position. Zero inverse mass fixes it.
const fixed = new XpbdParticleN({
  id: 'anchor',
  position: [0, 0, 0, 0],
  inverseMass: 0
});
const point = new XpbdParticleN({
  id: 'bob',
  position: [1.4, 0, 0, 0],
  inverseMass: 1
});
const spring = new XpbdDistanceConstraintN({
  id: 'spring',
  pointA: point,
  pointB: fixed,
  restLength: 1,
  compliance: 1e-3
});

const result = new XpbdConstraintSolverN({
  dimension: 4,
  iterations: 8
}).solve([spring], 1 / 60);
```

Custom scalar constraints provide one pure evaluation and one gradient per
unique point. The reference implementation snapshots all participating
positions and restores them if validation or a later evaluation fails, so a
malformed batch cannot leave a partial Gauss--Seidel correction. The exact RN
distance consumer retains the prior coherent direction and requires an
explicit branch at coincidence.

`XpbdWorldN` supplies the corresponding renderer-neutral point-mass time-step
boundary. It owns registered `XpbdParticleN` values and uses, for every substep
of duration `h`,

$$
v^*=v+h\left(g_s g+w f\right),
\qquad
\widetilde x=x+h v^*,
\qquad
x'=\operatorname{project}_{XPBD}(\widetilde x,h),
\qquad
v'=\frac{x'-x}{h},
\qquad
v''=\operatorname{respond}(v',h).
$$

Here `w` is inverse mass, `g_s` is the particle's gravity scale, and `f` is the
sum of the persistent external accumulator and registered state-dependent
providers. External force is held across all requested substeps and cleared
after a successful outer step. Each pure `XpbdForceProviderN` is instead
reevaluated at the current configuration before every substep and accumulated
in a private scratch buffer, so elastic forces neither become frame-constant
nor leak into the external accumulator. Provider evaluations remain attached
to the corresponding substep result. A zero-inverse-mass particle is fixed:
prediction and velocity reconstruction do not move it. The world neither
infers a kinematic path nor a collision velocity when a caller explicitly
edits such a point between steps.

Every constraint, force-provider, velocity-response, or state-guard point must be one of the
registered particle objects. Particle, constraint, provider, and response ids
are unique within their policy classes, and removing a point still referenced by any policy refuses. After
velocity reconstruction, ordered `XpbdVelocityResponseN` policies receive the
matching position solve and may mutate only the velocities of their declared
particles. The world rejects position, force, gravity-scale, foreign-velocity,
or non-finite mutations. A world step snapshots the complete particle state;
any late constraint, provider, response, or state-guard failure restores it and
the original accumulators. Read-only `XpbdStateGuardN` policies run after all
velocity responses and cannot mutate any particle state. Each substep result
retains its solve, ordered provider, response, and state-guard evidence, while
the outer result separately aggregates raw
constraint value, compliant residual, and projected KKT residual.

```ts
import { XpbdParticleN, XpbdWorldN } from '@holotope/physics';

const world = new XpbdWorldN({
  dimension: 4,
  gravity: [0, -9.81, 0, 0],
  solverIterations: 8
})
  .addParticle(fixed)
  .addParticle(point)
  .addConstraint(spring);

const step = world.step(1 / 60, 2);
console.log(step.maxAbsCompliantResidual);
console.log(step.maxAbsProjectedKktResidual);
```

`XpbdExponentialVelocityDampingN` is the first general response. Its authored
rate has units of inverse seconds and each substep applies
`exp(-rate * h)`. Subdividing one duration therefore leaves the final decay
factor unchanged, unlike an anonymous per-frame multiplier. Its evaluation
reports the factor, affected particle count, and kinetic-energy change.

## RN point–hyperplane contact

`XpbdParticleHyperplaneConstraintN` is the first projected consumer. For a
normalized oriented plane `normal dot x = offset`, with the positive side
allowed and non-negative clearance `r`, it declares

$$
C(x)=normal\cdot x-offset-r\ge 0,
\qquad \nabla C=normal.
$$

`compileXpbdParticleHyperplaneFamilyN()` composes one contact per source
vertex over an existing particle binding. Each record retains its source
ordinal, copied source position and compile-time signed gap, exact particle
identity, clearance, compliance, and stable constraint id.

```ts
import {
  HyperplaneColliderN,
  XpbdWorldN,
  compileXpbdParticleHyperplaneFamilyN
} from '@holotope/physics';

const world4 = binding.addToWorld(new XpbdWorldN({
  dimension: 4,
  gravity: [0, -9.81, 0, 0],
  solverIterations: 8
}));

const floorContacts = compileXpbdParticleHyperplaneFamilyN({
  id: 'floor',
  source,
  particles: binding.particles,
  plane: new HyperplaneColliderN([0, 1, 0, 0], -2),
  clearance: 0,
  compliance: 0
});

floorContacts.addToWorld(world4);
```

The optional `compileXpbdParticleHyperplaneFrictionFamilyN()` composes directly
over that normal family. For an active contact it interprets the XPBD position
multiplier as the normal impulse `J_n = lambda_n / h`, computes the complete
ambient tangent velocity

$$
v_t=v-n(n\cdot v),
$$

and projects the desired stopping impulse onto the isotropic Coulomb ball
`||J_t|| <= mu J_n`. No tangent basis is introduced. The implementation is the
same in every ambient dimension; in R4 the admissible tangent impulse is a true
three-ball rather than three independent coordinate clamps.

```ts
import {
  XpbdExponentialVelocityDampingN,
  compileXpbdParticleHyperplaneFrictionFamilyN
} from '@holotope/physics';

const floorFriction = compileXpbdParticleHyperplaneFrictionFamilyN({
  id: 'floor-friction',
  contacts: floorContacts,
  friction: ({ sourceVertexIndex }) => sourceVertexIndex === 0 ? 0.8 : 0.5
});
floorFriction.addToWorld(world4); // after the normal family

world4.addVelocityResponse(new XpbdExponentialVelocityDampingN({
  id: 'ambient-damping',
  particles: binding.particles,
  rate: 0.18
}));
```

Per-contact evidence distinguishes disabled, inactive, sticking, and sliding
states and reports normal/tangent impulse, tangent speed, the Coulomb limit,
and kinetic-energy change. Family evidence retains each source vertex ordinal
and aggregates contact counts, impulse, residual slip, and energy. Response
order is meaningful: the example applies contact friction before ambient
damping.

This remains discrete particle contact against an immovable plane. It does not
claim deformable face contact, restitution, adhesion, rolling resistance,
self-collision, continuous collision, or a swept no-tunnelling guarantee.
Cross-step XPBD multiplier persistence is also separate: cached multipliers
need an explicit timestep-scaling and retirement contract. The plane is
source-space mechanics; no rendered projection determines its normal.

An explicitly selected two-vertex 1-cell group can be compiled from shared
topology rather than reconstructed as private simulation data:

```ts
import { createHypercube } from '@holotope/core';
import {
  XpbdWorldN,
  compileXpbdDistanceNetworkN,
  compileXpbdParticleBindingN
} from '@holotope/physics';

const source = createHypercube({ dim: 4, size: 1 });
const edges = source.cellsOfDim(1)[0]!;
edges.key = 'tesseract-edges';

const binding = compileXpbdParticleBindingN({
  id: 'tesseract-points',
  source,
  mass: 1,
  fixed: ({ sourceVertexIndex }) => sourceVertexIndex === 0
});

const network = compileXpbdDistanceNetworkN({
  id: 'elastic-tesseract',
  source,
  edgeGroup: edges,
  particles: binding.particles,
  compliance: 1e-5
});

const world4 = binding.addToWorld(new XpbdWorldN({
  dimension: 4,
  gravity: [0, -9.81, 0, 0],
  solverIterations: 12
}));
network.addToWorld(world4);
world4.step(1 / 60, 2);
binding.writeSourcePositions();
```

This operation is intentionally a compiler, not a material assumption. It
creates constraints only for the selected edge family. With an existing
binding, every constraint points to the caller's exact particle objects while
rest lengths still come from source geometry; vertex authoring policies are
therefore refused in that mode. The compatible standalone form can still
create one particle per source vertex and accept inverse-mass, gravity-scale,
and initial-velocity policies. Duplicate source edges remain distinct
constraints.

Each compiled edge retains a live `SourceCellReferenceN` and a structural
`SourceCellIdN`. Particle state does not alias `CellComplex.positions` while the
world is stepping. A network-owned write validates particle coordinates and
edge lineage; the topology-neutral binding write validates the complete point
layout. Both update the entire packed source buffer only after validation.
Once synchronized, projections, sections, graph-Laplacian analysis, and other
consumers observe the evolved source without losing its cell identity.

The XPBD projection kernel implements equations 17–18 of Macklin, Müller, and Chentanez,
[“XPBD: Position-Based Simulation of Compliant Constrained Dynamics”
(2016)](https://matthias-research.github.io/pages/publications/XPBD.pdf).
Coupled position constraints, surface-feature contact, restitution, implicit
material integration, continuous deformable collision, and accelerated
material backends remain separate later consumers. Named
exponential damping and discrete particle--hyperplane Coulomb friction are the
first post-reconstruction velocity consumers described above.
