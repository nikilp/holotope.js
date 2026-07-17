# Rigid-body mechanics and contact in R4

`@holotope/physics` is a headless simulation package. It does not render and it
does not treat a visible slice as a simulation boundary. Its implemented
foundation covers mass properties, 4D rigid-body motion, convex
distance/intersection and linear time-of-impact queries, exact point contact for N-balls and infinite
hyperplanes, exact contact patches for oriented R4 hyperboxes, warm-started
normal plus coupled tangent contact response, and a capability-aware
narrowphase plus deterministic mixed-shape and specialized hyperbox world-step
pipelines. A Float64 EPA fallback adds bounded minimum-translation witnesses for
general full-dimensional convex R4 pairs; vertex-enumerable R4 polytopes
graduate that witness into a complete clipped manifold with persistent source
feature identities. Opt-in event stepping resolves certified linear impacts;
rotational CCD, joints, and sleeping remain separate later contracts.

## Convex mass properties

A tetrahedralized convex boundary in R4 is integrated by coning every boundary
tetrahedron to an interior numerical reference point. Each cone is a
4-simplex, so its volume, first moment, and second moment have closed forms.
The implementation translates near the vertex centroid and uses compensated
sums before shifting the covariance to the center of mass.

```ts
import { createHypercube, tetrahedralizeCuboidCells } from '@holotope/core';
import { massPropertiesFromCellComplex4 } from '@holotope/physics';

const boundary = tetrahedralizeCuboidCells(
  createHypercube({ dim: 4, size: 1 })
);
const properties = massPropertiesFromCellComplex4(boundary, { density: 1 });

console.log(properties.volume);          // 1
console.log(properties.centerOfMass);    // the origin
console.log(properties.inertiaDiagonal); // six entries, each 1/6
```

The returned covariance is a 4×4 integral at the center of mass. A symmetric
Jacobi solve diagonalizes that matrix; if its principal second moments are
`m0…m3`, the inertia of the coordinate-plane bivector `e_i∧e_j` is `mi + mj`.
This produces six principal inertias in the kernel's lexicographic order:
`01, 02, 03, 12, 13, 23`.

The current boundary API is deliberately named `ConvexBoundary4`. It uses
positive cone volumes and must not be used for concave or self-intersecting
boundaries. Those require a consistently oriented signed-volume decomposition.

## Principal frames

`principalAxes` and `principalRotor` both map principal coordinates back into
the source geometry frame. `rebasePositionsToPrincipalFrame4()` subtracts the
center of mass and applies the inverse frame. Together they preserve the source
pose while giving the body a diagonal inertia:

```ts
import {
  RigidBody4,
  rebasePositionsToPrincipalFrame4
} from '@holotope/physics';

const principalPositions = rebasePositionsToPrincipalFrame4(
  boundary.positions,
  properties
);
const body = RigidBody4.fromMassProperties(properties);
```

For any rebased point `p`, `body.rotation.applyToPoint(p) + body.position`
reconstructs its original source-frame point at the initial pose. The kernel's
`Rotor4.fromMatrix()` performs the general SO(4) matrix factorization required
by this bridge.

## Convex support mappings and GJK

A support shape exposes the farthest point in any direction. This is a compact
renderer-independent contract: a convex vertex hull, a transformed hull, an
N-ball, and a rounded convex core can all participate in the same query without
being converted to a visible mesh or slice.

```ts
import { TransformN, VecN, createHypercube } from '@holotope/core';
import {
  ConvexHullSupportShapeN,
  TransformedSupportShapeN,
  gjkDistance
} from '@holotope/physics';

const hull = ConvexHullSupportShapeN.fromCellComplex(
  createHypercube({ dim: 4, size: 2 })
);
const a = new TransformedSupportShapeN(hull);
const b = new TransformedSupportShapeN(
  hull,
  new TransformN(4, undefined, new VecN([3, 0, 0, 0]))
);

const query = gjkDistance(a, b);
console.log(query.intersects); // false
console.log(query.distance);   // 1

// Rehydrate the previous feature simplex after a small coherent pose change.
const next = gjkDistance(a, b, { warmStart: query.warmStart });
```

`gjkDistance()` is dimension-generic; its active simplex contains at most
`n + 1` support points in R^n. In addition to the boolean and distance it
returns closest points on both shapes, a separating normal, stable source
feature IDs, convex weights, a conditioning estimate, and an explicit
termination reason. An iteration-budget result is reported as indeterminate
rather than silently treated as separated.

Vertex hulls can resolve those stable feature IDs at a new pose, so a result's
`warmStart` contains the terminating feature pairs and axis needed by the next
coherent query. Smooth and rounded supports cannot reconstruct a support point
from a feature ID alone; they reuse only the cached axis. The result reports
how many feature pairs were actually accepted, keeping the optimization
observable rather than implicit.

For geometry that retains exact integer or quadratic-ring feature coordinates,
`createExactRingGjkSignOracle()` can classify the barycentric signs which
select the active simplex face. The returned witness coordinates remain fast
Float64 values; the exact path certifies only the combinatorial branch. A shape
whose pose is not represented exactly must use the ordinary floating path
rather than claiming inherited exactness.

This is a query boundary, not collision response. A zero distance does not
provide penetration depth, a contact manifold, or an impulse. Those products
need distinct APIs because their numerical and physical guarantees differ from
closest-point GJK.

### Linear casts and time of impact

`convexLinearCastN()` promotes the distance kernel into a
dimension-independent first-impact query for two compact convex shapes moving
by fixed translations:

```ts
import {
  convexLinearCastN,
  supportShapeHyperplaneLinearCastN
} from '@holotope/physics';

const compactImpact = convexLinearCastN(
  shapeA,
  displacementA,
  shapeB,
  displacementB
);

const floorImpact = supportShapeHyperplaneLinearCastN(
  shapeA,
  displacementA,
  floor
);
```

The compact/compact route uses conservative advancement. At each sampled pose,
GJK supplies the closest distance and separating normal; relative displacement
projected onto that normal gives a lower bound on how long the plane remains
separating. The cast advances only by that certified interval. Its normalized
`time` lies in `[0,1]`, while `[0, safeTime)` is certified outside the requested
contact band.

Results distinguish `impact`, `initial-overlap`, `miss`, and `indeterminate`.
A miss records whether motion cannot close the current separating plane or the
first possible impact lies beyond the supplied displacement. GJK budget
exhaustion, advancement stagnation, and advancement-budget exhaustion remain
typed uncertainty rather than becoming a false miss. A positive
`targetDistance` provides a shape-cast skin without changing either source
shape.

An infinite plane remains outside compact GJK.
`supportShapeHyperplaneLinearCastN()` evaluates its minimum-support feature
once and solves the signed-distance motion analytically, including a plane whose
normal lies along a hidden coordinate.

`ContactPipeline4.stepWorldContinuous()` is the opt-in R4 event loop. It
integrates forces into velocity once per substep, advances poses to the earliest
certified linear impact, invokes the existing complete manifold/impulse path at
that pose, and continues through a bounded number of events. Ordinary
`stepWorld()` retains its discrete behavior. The continuous result is
`partial` whenever a spinning non-spherical or offset collider, externally
prescribed motion, or an indeterminate cast falls back to the discrete path;
an exhausted event budget reports the unadvanced remainder. No linear cast is
presented as a rotational CCD guarantee.

Compact candidates are pruned with swept axis-aligned bounds. For a starting
box `[min,max]` and complete translation `d`, `sweptBoundsN()` takes the hull of
the start and end intervals independently on every axis. That box contains
every intermediate translated shape, so overlap is only a necessary condition:
the broadphase may admit extra casts but cannot declare an impact or reject a
true linearly swept contact. Infinite planes remain on the analytic exhaustive
lane. Unsupported angular motion is enclosed by a conservative ball about its
rigid pivot before the pair is reported as a typed fallback. Each continuous
substep retains one `sweptBroadphase` diagnostic record per event scan, and the
`AllPairsCandidateProviderN` remains selectable as the differential oracle.

### General R4 penetration

`epaPenetration4()` continues an intersecting GJK query into the Minkowski
difference and returns one ordered minimum-translation witness for
full-dimensional compact convex shapes in R4:

```ts
import { epaPenetration4 } from '@holotope/physics';

const penetration = epaPenetration4(a, b, { recordTrace: true });
if (penetration.status === 'penetrating') {
  console.log(penetration.penetrationDepth, penetration.normal);
  console.log(penetration.lowerBound, penetration.upperBound);
}
```

The R4 expansion polytope has tetrahedral boundary facets. Removing its visible
facets exposes a horizon that must be a closed triangle surface; the
implementation verifies that every horizon edge occurs exactly twice before it
adds replacement tetrahedra. The terminating facet retains its four support
feature pairs and barycentric weights, so the ordered witnesses on A and B are
auditable. The selected facet distance is an inner-polytope lower bound, the
support plane is an upper bound, and `errorBound` exposes the remaining gap.

The returned `EpaPointContactPatch4` is intentionally a structural point
witness, not a persistent contact manifold. It is useful for minimum-translation
queries and for seeding later feature extraction, but it does not claim the
stable multi-point information needed by a stack solver. Rank-deficient input,
invalid horizons, degeneracies, and exhausted budgets return `indeterminate`
without manufacturing a normal. Smooth analytic families should use their
exact contact routes; a faceted EPA approximation of a smooth Minkowski boundary
can require substantially more expansion.

### Vertex-polytope contact manifolds

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

### Shallow contact with margins

`gjkMarginDistance()` surrounds two convex cores with spherical margins while
running GJK on the cores. As long as the cores remain separated, their closest
axis defines the rounded-shape normal, signed distance, margin penetration, and
witness midpoint:

```ts
import { gjkMarginDistance } from '@holotope/physics';

const contact = gjkMarginDistance(a, b, {
  marginA: 0.05,
  marginB: 0.05,
  warmStart: next.warmStart
});
```

This positive-distance construction is intentionally honest at its boundary.
If the convex cores themselves touch or overlap, the result becomes
`core-contact` and leaves the normal and penetration depth unavailable. It
does not disguise a closest-point query as a deep-penetration solver.

### Infinite hyperplanes

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

### Complete vertex-polytope contact with a plane

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

### Exact smooth point contact

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

### Exact mixed analytic contact in R4

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

### Oriented hyperboxes and SAT

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

### Hyperbox contact patches

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

### Persistent identity and contact kinematics

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

### Contact response and the R4 friction ball

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

\[
v_n = n^T[(v_A + \Omega_A r_A) - (v_B + \Omega_B r_B)].
\]

A unit normal impulse changes both linear momentum and angular momentum
`r ∧ n`. The effective mass therefore includes the six-component R4 inertia
response, not only inverse linear masses. Each iteration applies

\[
\lambda' = \max(0,\;\lambda + m_{eff}(v_{target}-v_n)).
\]

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

\[
K_t = T^T(W_A + W_B)T,
\]

where each `W` includes linear inverse mass and the world-space inverse-inertia
response of `r ∧ t_j`. A Cholesky solve produces the unconstrained block update,
then the accumulated vector is projected once:

\[
\lambda_t^* = \lambda_t - K_t^{-1}v_t,
\qquad
\lambda_t' = \operatorname{proj}_{\|x\|\le\mu\lambda_n}(\lambda_t^*).
\]

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

### Broadphase candidate providers

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

### Capability-aware narrowphase

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

### Mixed R4 contact orchestration

`ContactPipeline4` joins the dispatcher and solver without erasing
shape-specific guarantees. `GlomeCollider4` can follow a dynamic body's center
or a body-local offset, `PolytopeCollider4` gives a vertex hull an explicit
rigid pose, and `HyperplaneContactCollider4` represents an infinite fixed or
prescribed-motion boundary:

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

### Deterministic hyperbox contact orchestration

`HyperboxContactPipeline4` joins broadphase, the capability dispatcher, exact
hyperbox contact geometry, and response at `PhysicsWorld4`'s
velocity-constraint seam. A `HyperboxCollider4` owns stable identity, half
extents, a body-local pose, material values, and group/mask filtering. For a
dynamic participant its world pose is synchronized from `RigidBody4`; fixed
and prescribed-motion participants retain an explicit world transform.

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

## Scene synchronization and fixed-step interpolation

Physics is headless, but `RigidBodyObject4Binding` connects a simulated world
pose to core's renderer-neutral `ObjectN`. The binding deliberately targets the
scene graph rather than three.js: any render adapter that consumes
`ObjectN.world` sees the same result.

```ts
import { ObjectN, SceneN } from '@holotope/core';
import {
  PhysicsWorld4,
  RigidBodyObject4Binding
} from '@holotope/physics';

const scene = new SceneN(4);
const node = new ObjectN(4);
scene.add(node);

const binding = new RigidBodyObject4Binding(body, node);
const fixedDt = 1 / 120;

// After every fixed simulation step:
world.step(fixedDt);
binding.capture();

// Once per rendered frame, with accumulator/fixedDt in [0, 1]:
binding.apply(alpha);
scene.updateWorld();
```

The body pose is authoritative and world-space. For a parented target the
binding computes the corresponding local transform through the parent's
current world transform, so hierarchy composition recovers the simulated pose.
It writes only `node.local`; applications retain the efficient contract of one
root `updateWorld()` traversal per rendered frame. `snap()` resets both stored
samples after a teleport, avoiding interpolation across a discontinuity.

## Momentum-primary free flight

`RigidBody4` stores world-frame angular momentum as its authoritative angular
state. Every step changes it only through applied torque. Angular velocity is
derived by rotating momentum into the principal body frame, applying the six
inverse inertias, and rotating the result back to the world frame.

`PhysicsWorld4` uses semi-implicit translation and a Lie midpoint orientation
step. The optional velocity-constraint callback runs after forces and torques
change momentum but before pose integration. The midpoint evaluation keeps the
rotor on Spin(4), conserves torque-free world angular momentum by construction,
and gives bounded second-order energy error for anisotropic free flight.

```ts
import { PhysicsWorld4 } from '@holotope/physics';

const world = new PhysicsWorld4({ gravity: [0, -9.81, 0, 0] });
world.addBody(body);

body.applyForce([4, 0, 0, 0]);
body.applyTorque([0.2, 0, 0, 0, 0, 0]);
world.step(1 / 60, 2);
```

Forces and torques are held constant across the requested substeps and cleared
after the outer step. Gravity uses the y-down convention so freezing the fourth
coordinate retains the usual y-up/y-down 3D embedding and its differential
tests.

## Current correctness boundary

The test suite pins:

- the closed-form volume, covariance, and inertia of a translated tesseract;
- isotropic inertia for all six regular convex polychora;
- SO(4) matrix↔paired-quaternion round trips;
- exact torque-free world angular momentum over 10,000 steps;
- bounded anisotropic energy error with approximately quadratic timestep scaling;
- the invariant embedded 3D rotation subalgebra;
- force, gravity, torque, and accumulator semantics.
- analytic glome–glome and axis-aligned box–box convex distances;
- deterministic randomized box-pair differentials in R4;
- transformed support points, rank-deficient simplices, and R3 specialization;
- exact-ring predicate provenance for exact-coordinate hulls.
- coherent feature-pair warm starts across moving R4 hulls;
- shallow margin separation/contact and explicit core-contact refusal;
- ordinary-axis and hidden-axis analytic hyperplane queries.
- exact ordered N-ball/N-ball witnesses from R1 through R8, reversal symmetry,
  margins, tolerance contact, and the coincident-center degeneracy;
- exact ordered N-ball/hyperplane witnesses in both shape orders and 800
  deterministic differentials against the one-support plane query;
- exact ordered glome/hyperbox face, edge, and corner witnesses, compact
  margins, reversal symmetry, unique interior exits, and explicit interior
  ties;
- glome/hyperbox separation differentials against GJK over deterministic
  translated and full-rotation poses;
- hyperbox/hyperplane support features from point through 3D polyhedron,
  ordered anchors, compact margins, and differentials against the generic
  one-support plane query;
- complete 56-family oriented-hyperbox SAT and a cross-family-only regression;
- SAT/GJK boolean agreement over 20,000 deterministic full R4 poses.
- hyperbox contact dimensionality from point through 3D polyhedron;
- a 20-vertex aligned patch reduced to eight affine-spanning solver points;
- 20,000 deterministic full-SO(4) contact constructions with zero failures.
- feature-pair contact IDs, consecutive ages, and explicit retirements;
- analytic `v + Ωr` point velocity and six-rate kinematic pose extraction;
- coherent one-normal plus three-tangent velocity decomposition.
- exterior-product angular impulses and world-space inverse inertia;
- analytic Newton restitution from zero through perfectly elastic impacts;
- total linear and angular momentum conservation for off-center body pairs;
- rotational effective mass against an immovable surface;
- restitution thresholds, bounded penetration bias, and kinematic drivers;
- persistent warm impulses with timestep scaling, normal coherence, and retirement;
- a two-body stack held against gravity through the world constraint seam.
- one coupled Coulomb three-ball rather than axis-wise friction clamps;
- exact sticking and sliding limits for arbitrary three-component slip;
- full anisotropic 3x3 tangent-response differentials;
- tangent-coordinate invariance and three normal–tangent glome spin modes;
- preservation of all three tangent-only glome spin modes under point friction;
- tangent warm starts transported in world space with timestep scaling;
- linear and angular momentum conservation when witness anchors coincide.
- body-local hyperbox pose synchronization and explicit fixed poses;
- deterministic pair dispatch independent of collider insertion order;
- group/mask filtering before narrowphase and explicit material mixing;
- automatic cache retirement when colliders separate or are disabled;
- an automatically dispatched hyperbox stack held against gravity.
- exhaustive pair generation in canonical stable-ID order;
- randomized sweep-and-prune equality with brute-force AABB overlap from R1
  through R8;
- coherent sweep-order reuse and exact adjacent-swap diagnostics;
- zero broadphase false negatives across 5,000 deterministic full-SO(4) SAT
  contact poses;
- default sweep and exhaustive-pipeline agreement for separated/contacting
  behavior.
- best-mode selection across general distance, rounded shallow contact, exact
  R4 penetration, hyperbox deep manifolds, and analytic smooth deep contact;
- explicit distance/shallow overrides and typed unsupported deep requests;
- preservation of the shallow core-overlap refusal without fabricated normal
  or penetration depth;
- ordered-pair GJK cache reuse, canonical batch ordering, disabling, deletion,
  and immediate retirement;
- exact dispatcher/direct-query differentials for all implemented capability
  paths;
- the hyperbox world pipeline requesting and exposing `deep-manifold` rather
  than bypassing capability dispatch.
- exact smooth-point response in both ordered glome/plane roles;
- deterministic mixed compact/plane candidate accounting and filtering;
- body-local glome synchronization and stable smooth-point warm-start identity;
- a glome held against gravity for 600 fixed steps;
- central elastic glome/glome response and retained hyperbox dispatch inside
  the mixed pipeline;
- exact glome/hyperbox point response and eight-point hyperbox/plane response
  in either ordered plane role;
- a hyperbox held against gravity on an infinite floor through the world seam;
- honest no-response handling for coincident glome centers and ambiguous
  interior glome/hyperbox minimum translations.
- bounded R4 EPA depth, witnesses, and termination certificates;
- exact axis-aligned penetration and ordered-pair reversal;
- 500 deterministic full-SO(4) EPA differentials against complete hyperbox
  SAT, plus a shape-generic transformed 4-simplex case;
- explicit rank-deficient and finite-budget failure without fabricated
  response data.
- complete vertex-polytope point-through-polyhedron manifolds with minimal
  source-face identities and affine-span-preserving reduction;
- 100 deterministic full-SO(4) manifold differentials against complete
  hyperbox SAT/contact geometry, plus transformed 4-simplex contact;
- coherent general-polytope IDs, dispatcher cache reuse, collider pose
  synchronization, shared response, and warm impulse reuse.
- dimension-independent simplex topology from R1 through R5, n-cube facet
  counts, serialized topology re-instantiation, wrong/deformed hull refusal,
  and compiled-versus-exhaustive manifold equality.
- complete vertex-polytope/hyperplane point-through-polyhedron support faces,
  ordered anchors, compact margins, and affine-span-preserving reduction;
- 100 deterministic full-SO(4) differentials against exact
  hyperbox/hyperplane contact, plus transformed 4-simplex incidence;
- specialized hyperbox dispatch precedence, typed plane-margin refusal, and
  stable general-polytope/plane response through the mixed world pipeline.
- analytic N-ball linear impact times from R1 through R8 and exact static-plane
  casts on ordinary and hidden axes;
- 240 axis-aligned cube casts against analytic slab entry from R1 through R6;
- 100 fully rotated R4 hyperbox casts against complete 56-axis SAT impact time;
- fast compact/compact, compact/plane, and general tesseract/plane tunnelling
  regressions through opt-in event stepping;
- swept-bound containment from R1 through R8 and zero broadphase false
  negatives against randomized analytic moving N-ball contacts;
- equal event identity, impact time, and final body state between swept
  sweep-and-prune and the exhaustive continuous provider in a distractor scene;
- explicit angular and prescribed-motion fallback plus bounded event-limit
  remainder without a fabricated continuous guarantee.

A manifold is not implied by a black-box convex support query. EPA supplies a
bounded general R4 minimum-translation witness; a response-grade general
polytope manifold additionally requires stable vertex enumeration. Specialized
hyperbox, smooth, and mixed analytic families retain their stronger direct
routes. Each complete family has a response adapter, and mixed orchestration
responds only when the dispatcher supplies one of those complete patches. Field
ray hits and rendered slices remain observation/query products, not physical
surfaces unless an explicit collider is constructed from them. The finite
broadphase is conservative AABB sweep-and-prune; infinite planes use an
exhaustive lane. Linear CCD uses conservative swept AABBs before its certified
casts, with the exhaustive candidate provider retained as a reference lane.
Rotational CCD, spatial trees, joints, rolling resistance, and sleeping are not
implied by this stage.
Exact total angular-momentum conservation applies when the two impulse anchors
coincide; penetrated witness pairs are distinct constraint anchors and
positional stabilization is intentionally non-conservative.
