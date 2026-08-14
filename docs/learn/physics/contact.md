# Contact generation and response

Turning an intersection into a manifold with persistent identity, then into an impulse: patches, margins, the R4 friction ball, and the pipelines that orchestrate them.

## What these queries operate on

Every query on this page takes support shapes rather than meshes: a
`SupportShapeN` answers "how far does this body extend in direction d", which is
all GJK and EPA need. `ConvexHullSupportShapeN`, `HyperboxSupportShape4`,
`GlomeSupportShapeN`, and `TransformedSupportShapeN` all satisfy it.

<!-- doc-check: context -->

```ts
import type {
  GjkMarginResult,
  GlomeSupportShapeN,
  HyperboxSupportShape4,
  HyperboxContactResult4,
  HyperboxContactKinematics4,
  HyperplaneColliderN,
  PhysicsWorld4,
  RigidBody4,
  SupportShapeN
} from '@holotope/physics';
import type { TransformN } from '@holotope/core';

// The subjects the examples below operate on.
declare const hullA: SupportShapeN;
declare const hullB: SupportShapeN;
declare const hull: SupportShapeN;
declare const a: SupportShapeN;
declare const b: SupportShapeN;
declare const shapeA: SupportShapeN;
declare const shapeB: SupportShapeN;
declare const box: HyperboxSupportShape4;
declare const boxA: HyperboxSupportShape4;
declare const boxB: HyperboxSupportShape4;
declare const glome: GlomeSupportShapeN;
declare const polytope: SupportShapeN;
declare const movingTransform: TransformN;
declare const body: RigidBody4;
declare const bodyA: RigidBody4;
declare const bodyB: RigidBody4;
declare const world: PhysicsWorld4;
declare const fixedDt: number;

// Results carried between steps: a previous query warm-starts the next one,
// and a tracked patch is fed back for persistent contact identity.
declare const next: GjkMarginResult;
declare const contact: HyperboxContactResult4;
declare const previousPlatformPose: TransformN;
// The previous step's kinematics, or undefined on the first step. Feeding its
// tangent basis forward is what keeps friction directions coherent frame to
// frame; the R4 tangent space is three-dimensional, so an arbitrary basis
// would spin.
declare const previousFrame: HyperboxContactKinematics4 | undefined;
declare const floor: HyperplaneColliderN;
declare const currentPlatformPose: TransformN;
```

## Source-simplex pair distance

For a point against a line segment, triangle, or tetrahedron, use the narrower
exact boundary:

```ts
import { evaluateExactPointSimplexResult } from '@holotope/physics';

const result = evaluateExactPointSimplexResult(
  [0.25, 0.125, 2],
  [0, 0, 0, 1, 0, 0, 0, 1, 0],
  3
);

if (result.status === 'projected') {
  console.log(result.witness.distance, result.witness.weights);
  console.log(result.error.directionErrorBound);
}
```

The operation treats each supplied finite Float64 as its exact dyadic value.
It decides affine rank, the closest active face, and exact zero without a
tolerance. A success publishes one coherent Float64 witness: the point,
distance, and direction are derived from the same source-ordered weights.
Absolute error bounds are rounded outward. `rank-deficient` is an exact
geometric decision; `uncertified` means that the exact decision cannot be
represented honestly by this Float64 evidence surface. Returned evidence is
owned and frozen; caller arrays remain caller-owned. The supported source
simplex dimensions are 1 through 3.

`XpbdParticleSourceSimplexBarrierN` and its candidate family use this exact
path and retain the caller's `SourceSimplexReferenceN`. The barrier evaluation
exposes the exact decision as `pointSimplex` beside the legacy-shaped
`projection` convenience view.

### Publication uncertainty is a typed refusal, not an internal error

The exact query's mathematics is unchanged by this boundary work. What changed
is what its principal consumer does with an `uncertified` result: each
publication reason is forwarded **one to one** into the barrier's
potential-domain vocabulary, so a caller branches on a recovery class instead
of parsing a message.

| query publication reason | barrier domain reason |
| --- | --- |
| `weight-underflow` | `point-simplex-weight-underflow` |
| `value-overflow` | `point-simplex-value-overflow` |
| `value-underflow` | `point-simplex-value-underflow` |
| `accuracy-bound-overflow` | `point-simplex-accuracy-bound-overflow` |

These leave through `XpbdPotentialDomainErrorN`, exactly like the measured
distance refusals, and `evaluate()` and `evaluateAt()` classify identically.

**A publication reason says what could not be represented. It does not, by
itself, say whether a shorter step helps.** Every one of the four is
repairable from some start states and not from others, so branching recovery
on the reason alone gives the wrong answer roughly half the time.

The question that does predict the outcome is asked of the *state*: can the
exact query publish at the position you are standing on right now?

- **It can.** The refusal came from somewhere along the step, so a shorter one
  is worth trying. Measured through a real Armijo search: `weight-underflow`
  accepts at step `0.5` and `value-overflow` at step `0.25`, each after real
  domain refusals, with the obstacle untouched.
- **It cannot.** No step length helps — every contracted trial converges back
  onto the position that already fails. Change the state instead: reposition,
  or re-scale this obstacle. The search will not even hand you a refused
  trial; it evaluates the potential at your base point first, so the typed
  error arrives as an exception before any step length is proposed.

The failing region is a neighbourhood of the simplex's vertices whose size is
fixed *relative* to the obstacle, not an all-or-nothing property of the scene.
Against a segment of extent `S`, the boundary sits near `S · 2^-1074` — the
point at which a positive barycentric weight can no longer be represented.
Measured across five scales from `2^200` to `2^1000`, the boundary tracks that
relation exactly, and every candidate outside the neighbourhood publishes.

An exactly rank-deficient source simplex stays a configuration error rather
than a recoverable refusal — no shorter step repairs authored geometry. Because
the barrier reads its source complex on every query, a caller that mutates the
complex after construction can surface that error mid-flight.

### Direction usability is caller policy

`maximumDirectionError` is a **dimensionless Euclidean radius** on the
published unit direction. It is required on the exact source dimensions 1–3,
must be finite, and must lie in the open interval `(0, 2)`: two unit vectors
are at most 2 apart, so a bound at or above 2 would admit even the exact
opposite direction while looking like a policy.

A published `directionErrorBound` **equal** to the authored policy is admitted;
only a strictly greater bound raises `direction-error-exceeds-policy`.

There is no default. There is no universal correct value, so the library does
not invent one — and it is **not** a force-accuracy guarantee: it bounds the
direction the force is built from, and says nothing about the resulting force's
error.

No monotonicity in the gap is promised. Measured on an ordinary contact
geometry, the published direction bound is not a monotone function of either
the normal gap or the tangential position: at fixed gap it alternates between
exactly zero and one positive value across *adjacent* representable
coordinates, in regions rather than at isolated points. Do not bisect for a
threshold; test the configurations you care about.

Higher-dimensional point–simplex barriers (source dimensions 4–17) currently
fall back to the legacy Float64 projector. They do not expose `pointSimplex`
evidence, publish no direction enclosure, and are outside this exact claim.

They are also **slow**, and the cost is worth stating in numbers rather than
adjectives: at `k = 17` a single `evaluateAt()` was measured at roughly
**7.8–12.2 seconds**. That is a batch-scale cost. It is suitable for offline
study of a fixed configuration and unsuitable for anything driven by a clock —
no interactive loop, no per-frame stepping, no throughput figure, and no
production workload should be planned around it. Because they cannot honour a
direction policy, supplying `maximumDirectionError` there is a construction
error rather than a silently ignored option — so a dimension-generic caller
branches on the simplex dimension.

The paired step filter certifies from the segment's **start state alone**.
Distance to a closed convex simplex is convex and 1-Lipschitz, so each of its
three proofs — `stationary`, `convex-nondecreasing`, `global-lipschitz` —
bounds the whole segment from the start's certified distance and the
displacement vector. The endpoint's own distance appears in none of them, so
the filter does not query it: an endpoint the exact query declines to publish
does not invalidate a prefix that provably exists.

Its refusals are correspondingly narrow. `initial-domain-violation` means the
start published a distance that fails to clear the open minimum; a start that
could not be published at all forwards the exact query's own reason, because
unknown is not violated. Both carry `certifiedFraction: 0` and no
`maximumStepLength`, and neither carries a `certification` — that field names
the proof used, and a refusal has none. When the start could not be published
there is no start evidence in the result at all, rather than `NaN`: a
fabricated distance is indistinguishable from a measured one at the call site.

The broader `evaluateSourceSimplexPairDistanceN` surface remains experimental.
Its current Float64 comparison bands are not similarity-invariant at extreme
scales, so its 0-simplex specialization is not an alternative point–simplex
authority. Replacing those bands for the genuinely moving feature-pair case is
separate work.

`evaluateSourceSimplexPairDistanceN` answers the feature-pair question the
point queries cannot: the certified minimum distance between two finite
source simplices in RN, with source-ordered barycentric witnesses on both
sides, ties returned as complete evidence (never a fabricated winner), zero
distance certified without an invented normal, and an indeterminate band that
refuses with its own residuals. It is the kernel under the deformable
feature-contact stack described on the deformable page.

Friction over these pairs is a separate, lagged potential described on the
deformable page: it is conservative only while one frozen lag is held, and it
is not the post-projection velocity response used by the projected-XPBD path.

## Vertex-polytope contact manifolds

A support function alone cannot reveal the topology of the face selected by
EPA. `SupportShapeN.enumerateVertices()` is therefore an optional, explicit
polytope capability. `ConvexHullSupportShapeN`, rigid transformed hulls, and
`HyperboxSupportShape4` provide it; smooth and opaque support shapes do not.

```ts
import { polytopeContactPatch4 } from '@holotope/physics';

const result = polytopeContactPatch4(hullA, hullB);
if (result.patch) {
  console.log(result.patch.kind, result.patch.vertices);
  console.log(result.patch.solverPoints);
}
```

`polytopeContactPatch4()` derives the convex R4 facet halfspaces from stable
source vertex IDs. It uses EPA's minimum-translation axis, aligns A's and B's
support faces exactly along that direction, and restricts both hulls to their
common three-dimensional contact hyperplane. Intersecting the projected
halfspaces produces the complete point, segment, polygon, or polyhedron patch.
A deterministic reduction retains at most eight solver points without losing
the patch's affine span.

Each patch vertex is classified by the minimal source face on A and B. A face
is represented by its sorted source vertex IDs, so the resulting pair ID is
independent of world coordinates and remains stable under coherent rigid
motion until the contact topology changes. `PolytopeCollider4` and
`contactConstraintsFromPolytopePatch4()` carry those IDs into the existing
normal-plus-three-tangent solver and its warm impulse cache.

The current facet derivation is the auditable Float64 CPU reference and has an
explicit candidate budget. It is appropriate for modest vertex hulls; large
polytopes and repeated queries can compile that incidence once:

```ts
import {
  CompiledPolytopeSupportShapeN,
  compileConvexPolytopeTopologyN
} from '@holotope/physics';

const compiled = compileConvexPolytopeTopologyN(hull);
if (compiled.topology) {
  const accelerated = new CompiledPolytopeSupportShapeN(hull, compiled.topology);
  // Wrap `accelerated` in TransformedSupportShapeN for live rigid poses.
}
```

`compileConvexPolytopeTopologyN()` is dimension-independent. It records each
facet as a stable set of source vertex IDs while retaining the compilation-frame
plane for audit. A live query reconstructs the planes from the current vertices
and validates dimension, source IDs, affine rank, convex support, and coplanar
membership. A rigid transform therefore reuses the incidence, while an
incompatible or topology-changing hull is refused instead of receiving stale
planes.

Compilation remains the exhaustive Float64 golden path. Instantiation reduces
repeated work from candidate-hyperplane enumeration to a facet-by-vertex
validation pass. `PolytopeCollider4` caches the default product by source-shape
identity, so rigid instances share it, and also accepts an explicit reusable
topology. Diagnostics distinguish original candidates
from candidate hyperplanes evaluated by the current query.

Rank-deficient geometry, an exhausted facet budget, or inconsistent clipping
returns `indeterminate` without response data.

## Shallow contact with margins

`gjkMarginDistance()` surrounds two convex cores with spherical margins while
running GJK on the cores. As long as the cores remain separated, their closest
axis defines the rounded-shape normal, signed distance, margin penetration, and
witness midpoint:

```ts
import { gjkMarginDistance } from '@holotope/physics';

const contact = gjkMarginDistance(a, b, {
  marginA: 0.05,
  marginB: 0.05,
  warmStart: next.coreResult.warmStart
});
```

This positive-distance construction is intentionally honest at its boundary.
If the convex cores themselves touch or overlap, the result becomes
`core-contact` and leaves the normal and penetration depth unavailable. It
does not disguise a closest-point query as a deep-penetration solver.

## Infinite hyperplanes

An infinite floor or wall is not a compact support shape. It therefore has a
separate analytic query requiring one support point in the negative plane
normal:

```ts
import {
  HyperplaneColliderN,
  querySupportShapeHyperplane
} from '@holotope/physics';

const floor = new HyperplaneColliderN([0, 1, 0, 0], 0);
const floorQuery = querySupportShapeHyperplane(a, floor);
```

The plane equation is `normal · x = offset`; its normal points toward the
allowed half-space. The query returns separated, touching, or penetrating
status plus source-feature and closest-point witnesses. It works unchanged for
a hidden-axis plane such as `w = constant`.

## Complete vertex-polytope contact with a plane

In R4, a vertex-enumerable convex polytope can promote that one-support query
to its complete minimum-support face:

```ts
import {
  HyperplaneColliderN,
  polytopeHyperplaneContact4
} from '@holotope/physics';

const plane = new HyperplaneColliderN([0, 1, 0, 0], 0);
const contact = polytopeHyperplaneContact4(polytope, plane, {
  polytopeMargin: 0.05
});

if (contact.patch) {
  console.log(contact.patch.kind, contact.patch.solverPoints);
}
```

The construction is analytic with respect to the plane: it selects every
source vertex at the minimum normal projection, verifies that set against the
polytope's facet incidence, and translates it onto the plane. The resulting
patch follows the complete R4 boundary ladder—point, segment, polygon, or
three-dimensional polyhedron—and retains stable source-vertex and minimal-face
identities. Reversing the shape order reverses the normal and preserves the
ordered surface anchors.

`polytopeHyperplaneContact4()` reuses an attached
`ConvexPolytopeTopologyN`; otherwise it compiles the same exhaustive Float64
golden topology used by polytope/polytope contact. More than eight support
vertices are reduced deterministically without losing the patch's affine span.
Rank-deficient geometry, an exhausted compilation budget, invalid incidence,
or a support set that is not a genuine source face returns a typed refusal
without response data. Spherical margin is supported on the compact polytope;
an infinite plane itself has no finite margin.

## Exact smooth point contact

Two analytic families promote distance to a complete deep-contact result in
any dimension: N-ball against N-ball, and N-ball against an infinite
hyperplane. In R4 an N-ball is often called a glome.

```ts
import {
  GlomeSupportShapeN,
  HyperplaneColliderN,
  glomeGlomeContactN,
  glomeHyperplaneContactN
} from '@holotope/physics';

const a = new GlomeSupportShapeN([0, 0, 0, 0], 1);
const b = new GlomeSupportShapeN([1.5, 0, 0, 0], 1);
const pair = glomeGlomeContactN(a, b);

const floor = new HyperplaneColliderN([0, 1, 0, 0], 0);
const floorContact = glomeHyperplaneContactN(a, floor);
```

Both functions return signed distance, actual ordered surface witnesses, the
normal from B toward A, and—when touching or overlapping—the translation of A
which aligns those witnesses. Spherical margins remain analytic for two
N-balls and on the N-ball side of a plane query. Reversing the shape order
swaps the witnesses and reverses the normal without changing signed distance.

Coincident N-ball centers are an explicit degeneracy: penetration depth is
known, but the minimum-translation direction is not unique. The result reports
`coincident-centers` and leaves the normal and point patch null instead of
inventing a coordinate-axis preference.

In R4, `contactConstraintFromSmoothPointPatch4()` adapts a non-degenerate
smooth patch directly to the same normal-plus-three-tangent response solver used
by polyhedral contacts. The adapter preserves the two actual surface anchors;
it does not substitute the diagnostic resolved point for either body's lever
arm.

## Exact mixed analytic contact in R4

The R4 glome, oriented hyperbox, and infinite hyperplane families also have
closed-form mixed queries:

```ts
import {
  glomeHyperboxContact4,
  hyperboxHyperplaneContact4
} from '@holotope/physics';

const roundedCorner = glomeHyperboxContact4(glome, box, {
  glomeMargin: 0.05,
  hyperboxMargin: 0.1
});
const supportFeature = hyperboxHyperplaneContact4(box, floor);
```

`glomeHyperboxContact4()` clamps the glome center in the box's local frame.
Outside the box core, the residual gives the exact face, edge, or corner
normal and Euclidean distance, including spherical Minkowski margins on both
compact shapes. If the center is inside, the nearest signed face exit gives
the minimum translation. A tie is reported as `ambiguous-interior` with no
invented normal or response patch.

`hyperboxHyperplaneContact4()` retains the entire minimum-support feature of
the box. In R4 that feature can be a point, segment, polygon, or a
three-dimensional polyhedron with eight vertices. Each vertex carries actual
ordered anchors plus the common translation that aligns them. A spherical box
margin remains analytic; a margin on the infinite plane is not defined.

Both queries preserve the ordered B-to-A normal convention. Their patches
adapt to the same response solver as box/box and smooth-point contact without
flattening their different geometric structures.

## Oriented hyperboxes and SAT

Low-feature boxes also have a specialized separating-axis query:

```ts
import {
  HyperboxSupportShape4,
  hyperboxSat4
} from '@holotope/physics';

const boxA = new HyperboxSupportShape4([1, 1, 1, 1]);
const boxB = new HyperboxSupportShape4(
  [0.8, 1.2, 0.6, 1],
  movingTransform
);
const sat = hyperboxSat4(boxA, boxB);
```

`HyperboxSupportShape4` is both a stable-feature support shape for GJK and a
full-dimensional oriented-box representation for SAT. Its transform must be
rigid and its four half extents positive.

The complete R4 box test constructs 56 candidate axes before numerical
deduplication:

- four facet normals from A and four from B;
- 24 duals of an edge direction from A wedged with a 2-face plane from B;
- 24 duals of a 2-face plane from A wedged with an edge direction from B.

The cross family is edge∧2-face, not edge×edge. The result retains the winning
feature class and local axis indices, the oriented world axis, projected
separation or minimum overlap, and counts for generated, degenerate,
duplicate, and tested axes. Its separation is an axis certificate; callers
needing general closest witnesses should continue to use GJK.

## Hyperbox contact patches

For touching or overlapping hyperboxes, the SAT certificate can be promoted
to the complete convex contact set:

```ts
import { hyperboxContactPatch4 } from '@holotope/physics';

const contact = hyperboxContactPatch4(boxA, boxB, {
  maxSolverPoints: 8
});

if (contact.patch) {
  console.log(contact.patch.kind);          // point, segment, polygon, polyhedron
  console.log(contact.patch.vertices);      // complete convex patch
  console.log(contact.patch.solverPoints);  // deterministic bounded subset
}
```

For an overlap, A is translated along the oriented minimum-overlap SAT axis
until the boxes just touch. Every returned vertex is in that resolved
configuration, not the original penetrating pose. `translationA` exposes the
exact relationship, while `normal` and `planeOffset` define the contact
3-flat by `normal · point = planeOffset`.

The implementation intersects both boxes' 16 halfspaces inside that 3-flat,
enumerates its convex vertices, and measures their affine rank. It therefore
retains the actual R4 feature ladder: isolated point, segment, 2D polygon, or
3D polyhedron. Every vertex includes stable positive/negative local-axis masks
for both boxes. Large aligned patches keep all geometric vertices while a
deterministic extreme/farthest-point reduction supplies at most eight points
for the bounded constraint path.

This function remains contact geometry, not response: it never mutates a body.
The normal solver below consumes its retained points through an explicit
adapter.

## Persistent identity and contact kinematics

Patch vertices carry canonical IDs derived from the pair of local box features,
not their changing world coordinates. `HyperboxContactTracker4` turns those
IDs into consecutive ages and explicit retirement events without guessing
nearest-neighbour matches across a real topological change:

```ts
import {
  HyperboxContactTracker4,
  hyperboxContactKinematics4,
  rigidMotionFromBody4,
  rigidMotionFromTransforms4
} from '@holotope/physics';

const tracker = new HyperboxContactTracker4();
const tracked = tracker.update(contact.patch);

const dynamicMotion = rigidMotionFromBody4(bodyA);
const kinematicMotion = rigidMotionFromTransforms4(
  previousPlatformPose,
  currentPlatformPose,
  fixedDt
);

if (contact.patch) {
  const velocities = hyperboxContactKinematics4(
    contact.patch,
    dynamicMotion,
    kinematicMotion,
    previousFrame ? { previousTangentBasis: previousFrame.tangentBasis } : {}
  );
}
```

Rigid point velocity is dimension-independent in form: `v + Ω·r`. In R4,
`Ω` is a six-component bivector acting through its skew matrix. An overlapping
patch is stored in the resolved pose, so kinematics first recovers the actual
surface anchors: A's anchor is `resolvedPoint - translationA`; B's anchor is
the resolved point. Angular velocity therefore uses lever arms from the
original body poses rather than the displaced diagnostic geometry.

The relative convention is `velocityA - velocityB`. Its contact-normal scalar
is positive for separation and negative for closing. Removing that component
leaves a vector in the three-dimensional tangent space. The API returns both
that invariant R4 vector and all three coordinates in a coherent orthonormal
tangent basis. Supplying the preceding basis projects it into the new contact
plane before re-orthonormalization, preventing arbitrary tangent-coordinate
flips under small normal changes.

`rigidMotionFromTransforms4()` is the kinematic-driver bridge. Translation is
finite-differenced, while the relative `Rotor4` uses its paired-quaternion
principal logarithm to recover all six world angular rates. A one-step central
inversion has no unique logarithm and is rejected; authored motion must be
sampled or subdivided coherently rather than inventing a rotation branch.

The tracker is useful when an application needs contact ages independently.
`NormalContactSolver4` uses the same feature-pair IDs as its accumulated-impulse
cache boundary.

## Contact response and the R4 friction ball

`ContactSolver4` is a warm-started projected block Gauss–Seidel solver. Every
contact has one unilateral normal coordinate and one coupled three-coordinate
tangent impulse. A participant can be a dynamic `RigidBody4`, a prescribed
`RigidMotion4`, or `null` for an immovable surface. Only dynamic participants
receive momentum.

```ts
import {
  ContactSolver4,
  contactConstraintsFromHyperboxPatch4
} from '@holotope/physics';

const solver = new ContactSolver4({
  iterations: 8,
  restitutionThreshold: 0.5,
  baumgarte: 0.2,
  penetrationSlop: 0.005
});

world.step(fixedDt, 1, (substepDt) => {
  // Synchronize collider transforms with the current body poses first.
  const query = hyperboxContactPatch4(boxA, boxB);
  const constraints = query.patch
    ? contactConstraintsFromHyperboxPatch4(
        query.patch,
        bodyA,
        bodyB,
        { pairId: 'body-a/body-b', restitution: 0.25, friction: 0.6 }
      )
    : [];
  const report = solver.solve(constraints, substepDt);
});
```

The patch normal points from B toward A and the relative convention remains
`vA - vB`. At one witness pair, the scalar normal speed is

$$
v_n = n^T[(v_A + \Omega_A r_A) - (v_B + \Omega_B r_B)].
$$

A unit normal impulse changes both linear momentum and angular momentum
`r ∧ n`. The effective mass therefore includes the six-component R4 inertia
response, not only inverse linear masses. Each iteration applies

$$
\lambda' = \max(0,\;\lambda + m_{eff}(v_{target}-v_n)).
$$

The non-negative projection prevents attraction. `v_target` is the larger of
the thresholded Newton-restitution speed and a bounded penetration-bias speed.
The result exposes both contributions, initial/final normal speed, effective
mass, warm-started impulse, and accumulated impulse for every point.

Persistent IDs must be unique within a solver. The hyperbox adapter namespaces
its stable local feature-pair ID with the caller's `pairId`. Across coherent
steps the cached impulse is scaled by the timestep ratio and projected by the
dot product of the previous and current normals. Missing IDs retire
immediately; a real feature transition never inherits a nearby point's impulse.

For an orthonormal tangent basis `T = [t1 t2 t3]`, the solver constructs the
complete symmetric point-response matrix

$$
K_t = T^T(W_A + W_B)T,
$$

where each `W` includes linear inverse mass and the world-space inverse-inertia
response of `r ∧ t_j`. A Cholesky solve produces the unconstrained block update,
then the accumulated vector is projected once:

$$
\lambda_t^* = \lambda_t - K_t^{-1}v_t,
\qquad
\lambda_t' = \operatorname{proj}_{\|x\|\le\mu\lambda_n}(\lambda_t^*).
$$

This is a rotationally symmetric three-ball, not three independently clamped
intervals. The world-space result is therefore invariant under changing the
tangent basis. Results expose the basis, full response matrix, initial/final
tangent speeds, world and coordinate impulses, ball radius, and
inactive/sticking/sliding state.

Warm starting stores the tangent impulse in world R4. On the next coherent
contact it is timestep-scaled, projected into the new tangent hyperplane, and
expressed in a tangent frame transported from the prior one. The ball is then
reapplied using the warm normal impulse.

Point friction removes slip; it is not rolling resistance. For a glome resting
on a hyperplane, the three rotation planes containing the contact normal move
the contact point and can be brought to rolling contact. The three bivector
components wholly inside the tangent 3-flat do not move that point and are not
artificially damped.

`NormalContactSolver4` and
`normalContactConstraintsFromHyperboxPatch4()` remain available as explicit
frictionless compatibility interfaces.

## Broadphase candidate providers

Candidate generation is a separate dimension-independent contract.
`AxisAlignedBoundsN` stores closed intervals, `supportShapeBoundsN()` derives a
conservative AABB from the `2n` axial supports of any compact support shape,
and a `BroadphaseCandidateProviderN<T>` maps stable-ID proxies to unordered
pairs. Two reference implementations are provided:

- `AllPairsCandidateProviderN` emits every pair in canonical ID order. It is
  the auditable O(n²) golden path.
- `SweepAndPruneCandidateProviderN` adaptively chooses the coordinate with the
  largest proxy-center spread, sweeps its closed intervals, and rejects on all
  remaining coordinates. It reuses the preceding primary-axis order through
  insertion sort when proxy identities and the chosen axis remain coherent.

Both providers are dimension-independent. Candidate output is canonically
sorted regardless of input or sweep order. The sweep result reports its axis,
primary overlaps, secondary interval tests, whether it reused the prior order,
and the number of adjacent swaps required.

## Capability-aware narrowphase

`NarrowphaseDispatcherN` reports what a shape pair can actually provide rather
than normalizing unlike algorithms into a fictitious universal contact type.
Its result is a discriminated union with five outcomes:

- `distance` — dimension-independent GJK distance/intersection for any two
  compact `SupportShapeN` values;
- `shallow-contact` — rounded-core distance, witnesses, normal, and margin
  penetration only while the convex cores remain separated;
- `penetration` — a bounded EPA minimum-translation witness for a zero-margin,
  full-dimensional compact R4 pair, explicitly not a persistent manifold;
- `deep-manifold` — a complete contact result for zero-margin R4
  vertex-enumerable polytope pairs, hyperbox pairs, N-ball pairs, ordered
  N-ball/hyperplane pairs, R4 glome/hyperbox pairs, and R4
  hyperbox/hyperplane and vertex-polytope/hyperplane pairs;
- `unsupported` — a typed refusal when a requested capability is unavailable.

```ts
import { NarrowphaseDispatcherN } from '@holotope/physics';

const narrowphase = new NarrowphaseDispatcherN();
const result = narrowphase.dispatch({
  pairId: 'ordered-a/b',
  shapeA,
  shapeB,
  mode: 'best',
  marginA: 0.05,
  marginB: 0.05,
  smoothContactOptions: { tolerance: 1e-12 }
});

switch (result.kind) {
  case 'distance':
    console.log(result.query.distance);
    break;
  case 'shallow-contact':
    console.log(result.query.status, result.query.penetrationDepth);
    break;
  case 'penetration':
    console.log(result.query.status, result.query.errorBound);
    break;
  case 'deep-manifold':
    switch (result.algorithm) {
      case 'hyperbox4':
      case 'polytope4':
        console.log(result.query.patch?.vertices);
        break;
      case 'glome-glome':
      case 'glome-hyperplane':
      case 'glome-hyperbox4':
        console.log(result.query.patch?.resolvedPoint);
        break;
      case 'hyperbox-hyperplane4':
      case 'polytope-hyperplane4':
        console.log(result.query.patch?.solverPoints);
        break;
    }
    break;
  case 'unsupported':
    console.log(result.reason);
}
```

`best` selects the strongest complete algorithm for the pair. That means deep
contact for zero-margin R4 hyperbox pairs, N-ball pairs, and every supported
mixed pairing among R4 glomes, hyperboxes, and planes. A zero-margin pair of
vertex-enumerable R4 polytopes also receives a complete `polytope4` manifold.
An R4 vertex-enumerable polytope against a plane receives a complete
`polytope-hyperplane4` support-face patch. Compact-side spherical margins
remain exact for the analytic mixed families and the polytope/plane route;
other compact support pairs use shallow contact when either margin is positive,
the general R4 EPA penetration route at zero margin, and distance outside R4.
An explicit mode is never silently weakened. In particular,
shallow contact retains its
`core-contact` refusal after the cores overlap, and a deep request for a general
support pair returns `unsupported` rather than disguising GJK as a manifold.

Deep results carry an `algorithm` discriminator because a complete smooth
point contact and a polyhedral patch do not have the same data shape. The
dispatcher does not flatten them into a lossy universal manifold. Infinite
planes also remain outside compact-support GJK: analytic glome/plane,
hyperbox/plane, and vertex-polytope/plane algorithms admit those pairings
without pretending the plane is a finite support shape.

Stable pair IDs identify ordered shape pairs. Distance, shallow, EPA
penetration, and vertex-polytope manifold queries reuse their GJK
feature/direction seed through the dispatcher cache;
`dispatchBatch()` canonically sorts requests and immediately reports caches
retired by absence or a capability change. Specialized analytic deep queries
do not pretend to consume a GJK cache.

## Mixed R4 contact orchestration

`ContactPipeline4` joins the dispatcher and solver without erasing
shape-specific guarantees. `GlomeCollider4` can follow a dynamic or kinematic
body's center or body-local offset, `PolytopeCollider4` gives a vertex hull an
explicit rigid pose, and `HyperplaneContactCollider4` represents an infinite
fixed or velocity-prescribed boundary:

```ts
import {
  ContactPipeline4,
  GlomeCollider4,
  HyperplaneContactCollider4
} from '@holotope/physics';

const contacts = new ContactPipeline4({
  solverOptions: { iterations: 12 }
})
  .addCollider(new GlomeCollider4({
    id: 'body',
    radius: 1,
    participant: body,
    material: { friction: 0.7 }
  }))
  .addCollider(new HyperplaneContactCollider4({
    id: 'floor',
    normal: [0, 1, 0, 0],
    material: { friction: 0.8 }
  }));

const step = contacts.stepWorld(world, fixedDt);
```

Finite glomes, hyperboxes, and vertex polytopes share the configured
dimension-independent AABB broadphase. An infinite plane has no finite AABB,
so the pipeline exposes a separate deterministic compact/plane candidate lane.
Plane/plane pairs are not queried. Diagnostics distinguish compact candidates,
exhaustive plane candidates, broadphase rejections, distance-only pairs,
unsupported pairs, complete contacts, and responding constraints.

Every admitted pair goes through `NarrowphaseDispatcherN.dispatchBatch()`, so
general compact pairs still retain coherent GJK caches and retire them when a
pair disappears. Every pairing among hyperboxes and glomes can produce exact
response constraints. Against an infinite plane, both compact analytic
families and a general vertex-enumerable R4 polytope use complete
response-grade patches. Pairs of vertex-enumerable R4 polytopes use the general
clipped manifold and the same persistent response path. Ambiguous interior
glome/box configurations remain observable but do not respond until a unique
minimum translation exists.

Infinite planes cannot own a finite dynamic `RigidBody4`. They may carry a
`RigidMotion4` for prescribed point velocity, but their geometric equation is
updated explicitly. This keeps infinite-boundary kinematics honest rather than
assigning a fictitious finite mass and inertia.

## Deterministic hyperbox contact orchestration

`HyperboxContactPipeline4` joins broadphase, the capability dispatcher, exact
hyperbox contact geometry, and response at `PhysicsWorld4`'s
velocity-constraint seam. A `HyperboxCollider4` owns stable identity, half
extents, a body-local pose, material values, and group/mask filtering. For a
dynamic or pose-owning kinematic participant its world pose is synchronized
from the body; fixed and velocity-only participants retain an explicit world
transform.

```ts
import { TransformN } from '@holotope/core';
import {
  HyperboxCollider4,
  HyperboxContactPipeline4
} from '@holotope/physics';

const pipeline = new HyperboxContactPipeline4({
  solverOptions: { iterations: 12, restitutionThreshold: 0.5 }
});

pipeline
  .addCollider(new HyperboxCollider4({
    id: 'body',
    halfExtents: [0.5, 0.5, 0.5, 0.5],
    participant: body,
    material: { friction: 0.6, restitution: 0.1 }
  }))
  .addCollider(new HyperboxCollider4({
    id: 'floor',
    halfExtents: [5, 0.5, 5, 5],
    transform: TransformN.identity(4),
    material: { friction: 0.8 }
  }));

const step = pipeline.stepWorld(world, fixedDt);
console.log(step.final.contactPairs, step.final.constraintCount);
```

Every solve synchronizes body poses, constructs conservative hyperbox AABBs,
runs the configured candidate provider, applies symmetric collision masks and
an optional pair filter, mixes materials, requests the dispatcher's
`deep-manifold` capability, and submits every responding point to one shared
solver batch. The default provider is sweep-and-prune; passing
`new AllPairsCandidateProviderN()` restores the exhaustive differential path.

Pair IDs are canonical and delimiter-safe; point IDs add the patch's stable
feature pair. Contacts that disappear—including pairs removed by broadphase,
disabling, or filtering—therefore retire from the warm-start cache on the next
solve.

The default material policy uses the geometric mean for friction and the
maximum for restitution. Both mixers are replaceable. Fixed–fixed and
prescribed–fixed overlaps remain observable contact pairs but do not invent a
dynamic response.

This remains the specialized homogeneous hyperbox pipeline. It
reports possible, broadphase-rejected, candidate, filtered, narrowphase,
contact, responding, and constraint counts. The mixed `ContactPipeline4` uses
the same proxy and response contracts for general vertex polytopes.
