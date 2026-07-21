# Rigid-body mechanics and contact in R4

`@holotope/physics` is a headless simulation package. It does not render and it
does not treat a visible slice as a simulation boundary. Its implemented
foundation covers mass properties, 4D rigid-body motion, convex
distance/intersection, linear time-of-impact queries, and explicit conservative
R4 rigid casts, exact point contact for N-balls and infinite
hyperplanes, exact contact patches for oriented R4 hyperboxes, warm-started
normal plus coupled tangent contact response, and a capability-aware
narrowphase plus deterministic mixed-shape and specialized hyperbox world-step
pipelines. A Float64 EPA fallback adds bounded minimum-translation witnesses for
general full-dimensional convex R4 pairs; vertex-enumerable R4 polytopes
graduate that witness into a complete clipped manifold with persistent source
feature identities. Opt-in event stepping resolves certified rigid impacts;
the branch-aware SO(4) logarithm and its analytic Jacobians now form the local
coordinate kernel for rotational constraints. Direction preservation and
one-parameter planar rotation are explicit stabilizer-classified policies;
the planar policy's torque-limited motor and continuous-angle guardians are
implemented. A separate dimension-generic XPBD reference kernel now projects
compliant scalar relations over point coordinates, including exact RN
point--hyperplane inequalities, without imposing R4 rigid-body semantics.
Prescribed compact-body pose trajectories share the same
contact and CCD path as dynamic bodies; moving infinite planes and sleeping
remain later contracts.

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

### Explicit R4 rigid trajectories and casts

`RigidTrajectory4` declares one normalized world-left screw path:

```text
p(t) = p0 + t delta_p
R(t) = exp(t Delta_Omega) R0.
```

`convexRigidCast4()` and `supportShapeHyperplaneRigidCast4()` advance along
that declared path. For a support shape enclosed by pivot radius `r`, the
angular contribution to any material point's speed is bounded by
`angularVelocityOperatorNorm4(Delta_Omega) * r`. In R4 that operator norm is
computed exactly from the paired-bivector split, so the conservative step uses
a mathematical bound rather than sampled support velocities.

`supportShapeBoundingRadius4()` infers auditable radii for glomes, rounded and
transformed built-ins, and vertex-enumerable shapes. An opaque support function
must supply its bound explicitly; a supplied value smaller than an inferable
radius is refused. Zero-angular casts delegate to the existing linear cast and
preserve its status, time, witnesses, iteration counts, and trace semantics.
Pure rotation is therefore a supported query even when both endpoint samples
are separated.

`planRigidBodyPose4()` freezes the exact momentum-derived Lie-midpoint
generator used by `PhysicsWorld4.integratePoses()`. Applying any normalized
sample of that plan is absolute, so collision queries and body advancement can
share one trajectory without accumulating interpolation drift.

`rigidTrajectoryFromTransforms4(start, end)` constructs the matching principal
screw segment from two coherent poses. A relative central inversion is refused
because two endpoints do not select a unique SO(4) logarithm; an animation
driver must subdivide there or author the generator explicitly.

`KinematicBody4` attaches physical time to one such segment. It owns position
and orientation for collider synchronization and exposes

```text
v = delta_p / duration
omega = Delta_Omega / duration
```

for contact response, but it has no mass and never receives an impulse.
Successive `planKinematicBodyPose4()` calls return exact suffixes of the
authored segment, and absolute application advances both its pose and elapsed
time. A replacement segment must begin at the current pose, while an overrun
is refused before the physics world is mutated.

```ts
const driver = KinematicBody4.fromTransforms(
  previousPlatformPose,
  nextPlatformPose,
  fixedDt
);
const platform = new HyperboxCollider4({
  id: 'platform',
  halfExtents: [2, 0.25, 1, 1],
  participant: driver
});
pipeline.addCollider(platform);
```

`KinematicTrackDriver4` is the renderer-independent bridge from authored
animation to those physical segments. It samples a position function and a
`Rotor4Track` at fixed clock boundaries, creates a persistent
`KinematicBody4`, and installs the next segment only after the current one is
exhausted:

```ts
import { Rotor4Track } from '@holotope/core';
import { KinematicTrackDriver4 } from '@holotope/physics';

const trackDriver = new KinematicTrackDriver4({
  fixedStep: 1 / 120,
  positionAt: (time) => [Math.sin(time), 0, 0, 0],
  rotationTrack
});

pipeline.addCollider(new HyperboxCollider4({
  id: 'animated-platform',
  halfExtents: [2, 0.25, 1, 1],
  participant: trackDriver.body
}));

pipeline.stepWorldContinuous(world, trackDriver.fixedStep);
trackDriver.advanceSegment();
```

Each accepted boundary is sampled once. The cached end pose of one segment is
the next segment's start, so stateful animation samplers cannot produce a seam
by being asked twice for the same clock time. Continuous collision may split
and replay suffixes of the frozen segment without resampling animation. A
sampler failure, malformed position, discontinuous body pose, or relative
central inversion is refused before the driver clock or body trajectory is
changed. The fixed step must be fine enough to represent the intended authored
path between its endpoint samples; no endpoint-only adapter can infer hidden
turns across a branch cut.

`ContactPipeline4.stepWorldContinuous()` is the opt-in rigid R4 event loop. It
integrates forces into velocity once per substep, advances poses to the earliest
certified linear or rotational impact, invokes the existing complete
manifold/impulse path at that pose, and continues through a bounded number of
events. Each remaining interval gets one frozen pose plan per dynamic or
pose-owning kinematic body;
the selected cast and actual pose advance consume those same plans. After
response changes dynamic momentum, only the remainder is replanned; prescribed
motion continues on its authored path. Ordinary `stepWorld()` advances the same
kinematic bodies once per discrete substep. The continuous result is `partial`
whenever velocity-only prescribed motion or an indeterminate cast falls back;
an exhausted event budget reports the unadvanced remainder. Centered glomes
use the exact analytic linear lane. Supported dynamic and kinematic hyperboxes,
polytopes, and offset glomes use rigid casts, and the legacy angular-fallback
list remains empty for those trajectories.

Compact candidates are pruned with swept axis-aligned bounds. For a starting
box `[min,max]` and complete translation `d`, `sweptBoundsN()` takes the hull of
the start and end intervals independently on every axis. That box contains
every intermediate translated shape, so overlap is only a necessary condition:
the broadphase may admit extra casts but cannot declare an impact or reject a
true linearly swept contact. Infinite planes remain on the analytic exhaustive
lane. Angular motion is enclosed by a conservative ball about its rigid pivot
before narrowphase casting. Each continuous
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

### Dimension-independent simplex materials

Matching rest and current k-simplices in R^N define an intrinsic material
coordinate without choosing an ambient normal. `evaluateSimplexMetricDeformationN()`
forms the rest and current Gram metrics, normalizes by a deterministic Cholesky
basis, and reports the right Cauchy--Green tensor `C`, Green--Lagrange strain
`E = (C - I) / 2`, principal stretches, measure ratio, and conditioning. The
same contract therefore covers a line, an embedded membrane, or a
full-dimensional solid for every `1 <= k <= N`.

`evaluateSimplexStVenantKirchhoffN()` is the first constitutive consumer of
that coordinate. For Lamé parameters `lambda` and `mu`, it evaluates the
energy density per unit rest k-measure

\[
\psi(E)=\mu\lVert E\rVert_F^2+\frac{\lambda}{2}\operatorname{tr}(E)^2,
\]

its second Piola stress

\[
S=\lambda\operatorname{tr}(E)I+2\mu E,
\]

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

`compileSimplexStVenantKirchhoffFamilyN()` assembles that evaluator over one
explicitly selected simplex group in a `CellComplex`. It copies rest positions
at compile time, binds current positions to one existing `XpbdParticleN` per
source vertex, and retains a `SourceCellReferenceN` plus structural
`SourceCellIdN` for every element. Shared-vertex force is the deterministic sum
of incident element forces. A family evaluation reports total potential
energy, one P12 record per element, assembled particle forces, maximum strain,
orientation counts, and the residual of total internal force.

The family is also an `XpbdForceProviderN`. Calling `addToWorld()` registers
the material without turning source edges into springs or copying another
particle set. Particles must already belong to the RN world. Full-dimensional
cuboids compose through `simplexizeCuboidGroupN()` by adding its generated,
named simplex group to the source before compilation; no private material-only
decomposition is required.

```ts
import { simplexizeCuboidGroupN } from '@holotope/core';
import {
  compileSimplexStVenantKirchhoffFamilyN
} from '@holotope/physics';

const decomposition = simplexizeCuboidGroupN(cuboidGroup, {
  outputKey: 'solid-simplices'
});
source.addGroup(decomposition.simplexGroup);

const solid = compileSimplexStVenantKirchhoffFamilyN({
  id: 'solid',
  source,
  simplexGroup: decomposition.simplexGroup,
  particles,
  material: { firstLameParameter: 2, shearModulus: 3 }
});

solid.addToWorld(world);
```

### Source particles and intrinsic mass

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

### Dimension-generic compliant point constraints

`XpbdConstraintSolverN` is the Float64 reference path for scalar extended
position-based dynamics (XPBD) over point generalized coordinates. It is
dimension-explicit and independent of the velocity-level R4 rigid solver. For
a scalar equality `C(x) = 0`, inverse point masses `w_i`, gradients `g_i`,
physical compliance `alpha`, and step duration `h`, each sequential visit uses

\[
\widetilde\alpha=\frac{\alpha}{h^2},
\qquad
W=\sum_i w_i\|g_i\|^2,
\]

\[
\Delta\lambda=
\frac{-C(x)-\widetilde\alpha\lambda}
{W+\widetilde\alpha},
\qquad
\Delta x_i=w_i g_i\Delta\lambda.
\]

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

\[
\lambda' = \max(0,\lambda+\Delta\lambda^*),
\qquad
\Delta\lambda=\lambda'-\lambda.
\]

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

const fixed = { position: new VecN([0, 0, 0, 0]), inverseMass: 0 };
const point = { position: new VecN([1.4, 0, 0, 0]), inverseMass: 1 };
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

\[
v^*=v+h\left(g_s g+w f\right),
\qquad
\widetilde x=x+h v^*,
\qquad
x'=\operatorname{project}_{XPBD}(\widetilde x,h),
\qquad
v'=\frac{x'-x}{h},
\qquad
v''=\operatorname{respond}(v',h).
\]

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

Every constraint, force-provider, or velocity-response point must be one of the
registered particle objects. Particle, constraint, provider, and response ids
are unique, and removing a point still referenced by any policy refuses. After
velocity reconstruction, ordered `XpbdVelocityResponseN` policies receive the
matching position solve and may mutate only the velocities of their declared
particles. The world rejects position, force, gravity-scale, foreign-velocity,
or non-finite mutations. A world step snapshots the complete particle state;
any late constraint, provider, or response failure restores it and the original
accumulators. Each substep result retains its solve, ordered provider evidence,
and ordered response evidence, while the outer result separately aggregates raw
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

### RN point–hyperplane contact

`XpbdParticleHyperplaneConstraintN` is the first projected consumer. For a
normalized oriented plane `normal dot x = offset`, with the positive side
allowed and non-negative clearance `r`, it declares

\[
C(x)=normal\cdot x-offset-r\ge 0,
\qquad \nabla C=normal.
\]

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

\[
v_t=v-n(n\cdot v),
\]

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
Coupled position constraints, surface-feature contact, restitution, robust
large-strain materials, continuous collision, and accelerated backends remain
separate later consumers. Named exponential damping and discrete
particle--hyperplane Coulomb friction are the first post-reconstruction
velocity consumers described above.

### Bilateral R4 point joints

`PointJointSolver4` constrains two world-space anchors to have one shared
velocity. Unlike contact, this is a bilateral constraint: its impulse may point
anywhere in R4. The four coordinates are solved as one block because an
off-centre impulse along one coordinate can change anchor velocity along the
others through the full six-plane inertia operator.

For relative anchor velocity `v = vA - vB`, the solver constructs the symmetric
positive-definite response

\[
K_{ij} = e_i^T(W_A + W_B)e_j,
\]

where `W` includes inverse linear mass and the angular response of
`r ∧ e_j`. One Cholesky solve produces the unconstrained update

\[
\Delta\lambda = K^{-1}(v_{target} - v).
\]

There is no component-wise projection: all four coordinates remain coupled.
`PointJointResult4` exposes `K`, its inverse effective-mass matrix, initial
anchor error and velocity, bounded bias target, warm and accumulated world
impulses, and the final residual.

`PointJoint4` is the persistent pose binding. It stores body-local anchors and
resolves a fresh `PointJointConstraint4` at the current poses; a fixed-world
joint stores its second anchor directly in world R4.

```ts
import { PointJoint4, PointJointSolver4 } from '@holotope/physics';

const pin = new PointJoint4({
  id: 'pin/body-a',
  bodyA,
  localAnchorA: [0, 0.5, 0, 0.25],
  worldAnchorB: [0, 2, 0, 0]
});
const jointSolver = new PointJointSolver4({ iterations: 8 });

world.step(fixedDt, 1, (substepDt) => {
  jointSolver.solve([pin.constraint()], substepDt);
});
```

The low-level constraint also accepts a prescribed `RigidMotion4` or `null` at
either side when the caller supplies current world anchors. At least one side
must be dynamic. Persistent IDs warm-start the full R4 impulse and retire
immediately when absent or when participant identity changes.

Equal and opposite impulses at a coincident anchor conserve total linear and
angular momentum. If numerical drift separates the two anchors, Baumgarte bias
deliberately trades exact angular-momentum conservation for bounded positional
repair, just as separated penetration witnesses do in contact. Set
`baumgarte: 0` when a momentum-only velocity solve is required.

### Scalar rigid-Jacobian rows with force bounds

`ConstraintRow4` is the reusable scalar primitive beneath distance equalities,
unilateral distance bounds, and distance motors. A row stores one R4 rigid
Jacobian per participant: four coefficients act on linear velocity and six
bivector coefficients act on angular velocity. Its generalized coordinate
speed is

\[
v_c = J_A v_A + J_B v_B,
\qquad
k = J M^{-1}J^T,
\qquad
m_{eff}=k^{-1}.
\]

`ConstraintRowSolver4` performs projected Gauss--Seidel updates. Authored
`minForce` and `maxForce` are generalized-force bounds, so a step of duration
`Δt` converts them to impulse bounds before projection:

\[
\lambda_{min}=f_{min}\Delta t,
\qquad
\lambda_{max}=f_{max}\Delta t,
\]

\[
\lambda' =
\Pi_{[\lambda_{min},\lambda_{max}]}
\left(\lambda + m_{eff}(v_{target}-v_c)\right),
\qquad
\Delta\lambda=\lambda'-\lambda.
\]

Omitting the bounds gives the unrestricted equality row. Setting one bound to
zero produces a unilateral row; finite bounds produce force-limited behavior
that remains consistent when the fixed timestep changes. A signed
`positionError` contributes bounded Baumgarte bias to the authored
`velocityTarget`. Its sign follows the Jacobian orientation: positive error is
reduced by negative coordinate speed.

The solver exposes both `residualSpeed` and `projectedResidualSpeed`. The raw
equality residual may correctly remain nonzero when a force bound is active.
The projected residual instead tests the bounded-row optimality condition:

\[
r_p = \frac{
\lambda-\Pi_{[\lambda_{min},\lambda_{max}]}
(\lambda+m_{eff}(v_{target}-v_c))
}{m_{eff}}.
\]

This sign matches `residualSpeed = v_c - v_target`; `r_p = 0` means the row is
solved even at saturation. `impulseState` reports whether the impulse is
unbounded, within bounds, at either bound, or fixed. Warm starts retain scalar
impulse, timestep, participant identities, and the previous Jacobian. The old
generalized impulse is timestep-scaled, projected onto the current row, and
clamped before application, so coherent direction changes and exact row-sign
reversal remain safe.

Low-level row values inherit the coordinate scale chosen by `J`. In
particular, generalized force, impulse, position error, and coordinate speed
need not share units across unlike rows. The solve aggregates
`sumAbsoluteCoordinateImpulse`, `maxResidualSpeed`,
`maxProjectedResidualSpeed`, and `maxAbsoluteCoordinateError` are convergence
and debugging diagnostics; they are not physical totals that may be summed or
compared without a shared coordinate convention.

`pointConstraintRow4()` constructs the exact linear and lever-arm bivector
coefficients for a world-space point direction. Purely angular coordinates may
instead provide their six-plane Jacobian directly.

### Distance coordinates in N dimensions and R4

The geometric part of a distance constraint is dimension-independent. For
anchors `a` and `b` and positive rest length `ℓ`,

\[
C = \|a-b\|-\ell,
\qquad
n = \frac{a-b}{\|a-b\|},
\qquad
\dot C = n\cdot(v_A-v_B).
\]

`evaluateDistanceCoordinateN()` returns `a-b`, `n`, and the current distance
for any `VecN` dimension. `evaluateDistanceConstraintN()` additionally returns
the signed equality error. Coincident anchors have no unique distance gradient,
so that case requires an explicit nonzero `directionHint`; the API never
substitutes an arbitrary coordinate axis.

`DistanceCoordinate4` binds that geometry to two body-local anchors, or to one
body-local anchor and a fixed world point. It retains the most recent coherent
direction for subsequent coincident evaluations. Equality, interval, and motor
policies share this binding instead of independently redefining R4 lever arms.

#### Rigid distance equality

`DistanceJoint4` binds that geometry to R4 rigid bodies. It stores local
anchors, captures the construction distance when `restLength` is omitted, and
returns a `DistanceJointConstraint4` consumable by the general row solver:

```ts
import {
  ConstraintRowSolver4,
  DistanceJoint4
} from '@holotope/physics';

const rod = new DistanceJoint4({
  id: 'rod/a-b',
  bodyA,
  localAnchorA: [0.4, 0, 0, 0.2],
  bodyB,
  localAnchorB: [-0.3, 0.1, 0, 0],
  restLength: 1.5
});
const rows = new ConstraintRowSolver4({ iterations: 8 });

world.step(fixedDt, 1, (substepDt) => {
  rows.solve([rod.constraint()], substepDt);
});
```

The point impulses are `λn` and `-λn`. Because `n` is parallel to the anchor
separation, their net torque is `(a-b)∧(λn)=0`; a body-to-body distance solve
therefore conserves total linear momentum and all six components of total
angular momentum even when its anchors are separated. Baumgarte stabilization
changes kinetic energy but not that internal-force momentum identity. A zero
rest length instead belongs to `PointJoint4`, whose four-coordinate gradient
remains defined at coincidence.

#### Distance interval

`DistanceIntervalJoint4` constrains the same scalar coordinate to a closed
interval

\[
\ell_{min} \le \|a-b\| \le \ell_{max},
\qquad 0\le\ell_{min}<\ell_{max}.
\]

`constraints(dt)` always returns two unilateral guardian rows with stable
`:minimum` and `:maximum` ID suffixes. At the minimum, `minForce: 0` permits
only a positive radial impulse, so the row may push the anchors apart but
cannot pull them together. At the maximum, `maxForce: 0` permits only a
negative radial impulse, so the row may pull inward but cannot push outward.

While the coordinate lies inside the interval, their targets are

\[
v_{min}=\frac{\ell_{min}-\ell}{\Delta t},
\qquad
v_{max}=\frac{\ell_{max}-\ell}{\Delta t}.
\]

Together they enforce the first-order safe-speed corridor

\[
v_{min}\le\dot\ell\le v_{max},
\]

so constant substep velocity cannot cross either boundary. Outside the
interval, the violated row instead carries signed position error and zero
authored speed; the solver's bounded Baumgarte term supplies recovery bias.
The opposite guardian remains present.

Keeping both rows in every solve is stronger than selecting a row from the
velocity observed before solving. A motor, contact, or another joint may create
unsafe radial speed during projected Gauss--Seidel iteration. A guardian row
that is already in the row set sees that updated velocity and projects it back
into the corridor. When row order is authored directly, place producers such
as the distance motor before the two guardians so the final guardians observe
their update.

`interval(dt)` is diagnostic only. It reports the current or first-order
destination bound as `minimum` or `maximum`, and otherwise reports `inactive`,
including correct destination selection for full-span crossings. It does not
return a solver row and must not be used to select the row set;
`constraints(dt)` is the sole solver input.

At exact coincidence, `\|a-b\|` has no single scalar gradient. Guardian rows
therefore require an authored `directionHint` and accept only the chosen
positive branch: relative motion must be longitudinal and non-negative along
that direction. Transverse or negative-branch motion is refused rather than
being assigned an incorrect scalar derivative. The diagnostic `interval(dt)`
can still use `\|v_A-v_B\|` to report one-sided distance growth, but that
observation does not manufacture a valid solve branch. A positive minimum also
requires the hint at construction so recovery has an explicit direction.

#### Force-limited distance motor

`DistanceMotor4` prescribes radial coordinate speed with symmetric generalized
force bounds. Positive `targetSpeed` lengthens the anchor distance, negative
speed shortens it, and `maxForce` produces

\[
-f_{max}\le f\le f_{max}.
\]

Both policy values are mutable between solves. Because the motor and interval
are independent rows on the same coordinate, the motor composes with both
guardian rows in the same solver:

```ts
import {
  ConstraintRowSolver4,
  DistanceIntervalJoint4,
  DistanceMotor4
} from '@holotope/physics';

const interval = new DistanceIntervalJoint4({
  id: 'link/a-b',
  bodyA,
  localAnchorA: [0.4, 0, 0, 0.2],
  bodyB,
  localAnchorB: [-0.3, 0.1, 0, 0],
  minLength: 1,
  maxLength: 2
});
const motor = new DistanceMotor4({
  id: 'drive/a-b',
  bodyA,
  localAnchorA: [0.4, 0, 0, 0.2],
  bodyB,
  localAnchorB: [-0.3, 0.1, 0, 0],
  targetSpeed: 0.5,
  maxForce: 20
});
const rows = new ConstraintRowSolver4({ iterations: 8 });

world.step(fixedDt, 1, (substepDt) => {
  const guardians = interval.constraints(substepDt);
  rows.solve(
    [motor.constraint(), ...guardians],
    substepDt
  );
});
```

The motor is deliberately ordered before the guardians: each guardian then
sees any radial speed the motor introduced, including when the pre-solve
diagnostic state was inactive.

A motor at coincidence also requires `directionHint`, because “positive
lengthening” otherwise has no unique world direction. A body-to-body motor may
inject or remove kinetic energy, but its equal and opposite radial impulses
retain the same total linear- and angular-momentum identity as a distance
equality. A fixed-world endpoint is an external constraint and does not carry
that closed-system guarantee.

### SO(4) orientation coordinates

`Rotor4` represents an SO(4) orientation by two unit quaternions with the
shared double-cover identification `(qL, qR) ~ (-qL, -qR)`. A relative
orientation therefore cannot choose the sign of each factor independently.
`relativeOrientationCoordinates4()` compares the two valid pair lifts, returns
the selected pair sign as a branch token, and accepts that token on the next
coherent evaluation. The scalar guard `|qL.w + qR.w|` vanishes on the complete
pair-geodesic cut locus. At that locus the function returns
`status: 'cut-locus'` and no bivector error.

```ts
import {
  orientationDlog4,
  relativeOrientationCoordinates4
} from '@holotope/physics';

const coordinate = relativeOrientationCoordinates4(current, target, {
  trivialization: 'world-left',
  previousBranch
});

if (coordinate.status === 'regular') {
  const jacobian = orientationDlog4(coordinate.error, 'world-left');
  previousBranch = coordinate.branch;
  // A joint policy may now map authored coordinates through `jacobian`.
} else {
  // Retain a prior chart or choose an authored branch.
}
```

The lexicographic bivector chart `(01,02,03,12,13,23)` is related to the two
quaternion-log vectors by `splitBivectorPair4()` and
`combineBivectorPair4()`. In this convention the factor Lie bracket is twice
the ordinary cross product. `orientationDexp4()` and `orientationDlog4()` use
that scale exactly; world-left and body-right trivializations exchange the
factor signs because `Rotor4` composes its right quaternion in reverse order.
`angularVelocityOperatorNorm4()` returns the tight norm of the dense 4x4 skew
map, `|u| + |v|`, without constructing that matrix.

These functions deliberately stop at local geometry. They do not decide what
an authored rotational joint preserves, how limits cross a branch, or how a
motor should spend force. Those remain explicit policies over this common
coordinate and the existing rigid-Jacobian solver.

### Coupled equality and one-bounded blocks

`ConstraintBlockSolver4` couples one to six `ConstraintRow4` values through
the exact small dense response

\[
K_{ij}=J_i M^{-1}J_j^T.
\]

The auditable Float64 path uses the shared deterministic symmetric eigensolver.
Its relative threshold is measured against `trace(K) / k`; the default
`rankPolicy: 'reject'` refuses a lost coordinate, while the explicitly authored
`minimum-norm` policy uses the spectral pseudoinverse and reports the effective
rank. Bias slop and speed bounds apply to the norm of the complete coordinate
vector, not to its components. Warm starts project the preceding generalized
impulse into the current row basis through the cross-response, so an orthogonal
basis change does not change the world impulse.

The default `projection` is `equality` and continues to refuse finite force
bounds. The additive `one-bounded` projection requires exactly one bounded row
and a full-rank response. If `E` denotes the equality rows and `b` the bounded
row, the solver forms the scalar Schur response

\[
S=K_{bb}-K_{bE}K_{EE}^{-1}K_{Eb}.
\]

It solves and clamps the accumulated `b` impulse, then re-solves

\[
\Delta\lambda_E=K_{EE}^{-1}
  (r_E-K_{Eb}\Delta\lambda_b).
\]

This is the complete active-set solution for one bounded coordinate, not a
componentwise approximation. Equality residuals therefore remain zero even
at torque saturation. The block result reports both the raw speed residual
and the reduced projected KKT residual; only the latter is expected to vanish
when a bound is active. Warm transport applies the same projection and
equality re-solve after timestep scaling.

The four-coordinate `PointJointSolver4` now delegates to this kernel without
changing its public result. This migration is differential evidence that the
block abstraction is shared behavior rather than a speculative solver layer.

### Direction preservation and its SO(3) stabilizer

`DirectionJoint4` preserves one oriented material direction. In R4 the
rotations fixing a vector form SO(3), so this policy constrains exactly three
rotational coordinates and leaves three free. It is not named a hinge: its
free subgroup is non-abelian and does not admit one global joint angle.

For current unit world directions `a` and `b`, the regular reference direction
is their normalized bisector `m = (a+b)/|a+b|`. The difference `a-b` lies in
the three-dimensional tangent space `m^perp`. A transported orthonormal basis
`t_i` gives the residual and angular rows

\[
C_i=t_i\cdot(a-b),\qquad
J_{A,i}=a\wedge t_i,\qquad
J_{B,i}=-(b\wedge t_i).
\]

At `a=-b`, the bisector and correction direction are not unique.
`constraint()` therefore returns `status: 'antipodal'` and no solver block.
This is a quotient-space singularity distinct from the full SO(4) logarithm
cut locus: a free SO(3) twist may reach the latter while both material
directions still agree perfectly. The joint consequently uses its defining
direction geometry rather than falsely constraining the free twist through a
full-frame logarithm.

```ts
import {
  ConstraintBlockSolver4,
  DirectionJoint4
} from '@holotope/physics';

const direction = new DirectionJoint4({
  id: 'body/up',
  bodyA,
  localDirectionA: [0, 1, 0, 0],
  worldDirectionB: [0, 1, 0, 0]
});
const blocks = new ConstraintBlockSolver4({ iterations: 8 });

world.step(fixedDt, 1, (dt) => {
  const evaluation = direction.constraint();
  if (evaluation.status === 'regular') {
    blocks.solve([evaluation.block], dt);
  }
});
```

### Fixed-relative-frame orientation

`OrientationJoint4` preserves a complete oriented material frame. Its
stabilizer is the identity, so it contributes all six rotational equality
rows. It is intentionally not called a universal weld: composing it with the
four translational rows of `PointJoint4` gives the complete R4 weld.

For current material frames `A` and `B`, the coordinate is expressed in frame
B:

\[
E=B^{-1}A,\qquad e=\log(E).
\]

If `omega_A` and `omega_B` are world-left angular velocities and
`Ad_(B^-1)` rotates a world bivector into frame B, its exact rate is

\[
\dot e=D\log_{\mathrm{left}}(e)\,
       \operatorname{Ad}_{B^{-1}}(\omega_A-\omega_B).
\]

The two participant Jacobians are therefore exact negatives. The coordinate
does not change under a common world-left rotation, and every internal row
impulse adds equal-and-opposite world bivector momentum. At the full SO(4) cut
locus the logarithm is non-unique, so `constraint()` returns `cut-locus`
without a block. Its pair-level branch token otherwise persists from one
evaluation to the next and can be deliberately cleared with `resetBranch()`.

```ts
const orientation = new OrientationJoint4({
  id: 'body/frame',
  bodyA,
  localFrameA,
  bodyB,
  localFrameB
});
const blocks = new ConstraintBlockSolver4({ iterations: 8 });

world.step(fixedDt, 1, (dt) => {
  const evaluation = orientation.constraint();
  if (evaluation.status === 'regular') {
    blocks.solve([evaluation.block], dt);
  }
});
```

### Planar rotation and its SO(2) stabilizer

`PlanarRotationJoint4` preserves an ordered orthonormal two-frame. The
stabilizer of that datum in SO(4) is rotation in the complementary two-plane,
so exactly one rotational degree of freedom remains and five are constrained.
This is the closest analogue of a revolute joint, but the API names its actual
geometry rather than calling several inequivalent R4 mechanisms “hinges.”

Let `(a0,a1)` and `(b0,b1)` be the current world frames. The first normalized
bisector `m0` supplies three direction rows in `m0^perp`. Projecting `a1+b1`
into that space and normalizing gives `m1`; two transported vectors spanning
`span(m0,m1)^perp` supply the remaining rows. On the constraint manifold their
bivector span contains every plane except the complementary generator
`p0 wedge p1`, which is exactly the free SO(2).

The two-frame input is validated and never silently orthonormalized. A first
axis antipode returns `status: 'first-antipodal'`; a vanished projected second
bisector returns `status: 'second-degenerate'`. Neither chart failure invents
a correction plane. The coordinate frames are transported across calls, and
the equality-block solver re-expresses warm impulses when those bases move.

```ts
import {
  ConstraintBlockSolver4,
  PlanarRotationJoint4
} from '@holotope/physics';

const rotation = new PlanarRotationJoint4({
  id: 'body/planar-rotation',
  bodyA,
  // This ordered frame is fixed; its orthogonal plane is free to rotate.
  localFixedFrameA: [[1, 0, 0, 0], [0, 1, 0, 0]],
  worldFixedFrameB: [[1, 0, 0, 0], [0, 1, 0, 0]]
});
const blocks = new ConstraintBlockSolver4({ iterations: 8 });

world.step(fixedDt, 1, (dt) => {
  const evaluation = rotation.constraint();
  if (evaluation.status === 'regular') {
    blocks.solve([evaluation.block], dt);
  }
});
```

The free phase is abelian and therefore can support a globally unwrapped
scalar coordinate. `PlanarRotationCoordinate4` supplies that coordinate by
attaching one unit phase-reference direction to each side. The ordered fixed
frame orients its complement through the canonical orientation of R4:

\[
\det[m_0\ m_1\ p_0\ p_1] > 0,
\qquad F=p_0\wedge p_1.
\]

After projecting both phase references into the common complementary plane,
their signed relative angle is evaluated with `atan2`. Its instantaneous rate
is

\[
\dot\theta=F\cdot\omega_A-F\cdot\omega_B.
\]

The returned branch token retains wrapped and unwrapped angles. Successive
samples choose the unique increment in `(-pi,pi)`. An exact half-turn has two
equally short lifts, so it returns `status: 'unwrap-ambiguous'` until the caller
provides `halfTurnDirection: 1 | -1`. As with every sampled unwrap, advances of
one or more unobserved turns cannot be reconstructed; the phase change between
observations must stay below `pi`.

```ts
import { PlanarRotationCoordinate4 } from '@holotope/physics';

const phase = new PlanarRotationCoordinate4({
  joint: rotation,
  localPhaseDirectionA: [0, 0, 1, 0],
  worldPhaseDirectionB: [0, 0, 1, 0]
});

const sample = phase.evaluation();
if (sample.status === 'regular') {
  console.log(sample.angle, sample.angularSpeed);
}
```

`PlanarRotationMotor4` and `PlanarRotationIntervalJoint4` are the first policy
consumers of that bounded block. A motor combines the five frame equalities
with the phase row and symmetric torque bounds. An interval retains two stable
guardian blocks over the continuous angle: its minimum row admits only
non-negative torque and its maximum row only non-positive torque. Inside the
interval their targets encode the first-order safe-speed corridor

\[
\frac{\theta_{min}-\theta}{\Delta t}
\leq \dot\theta \leq
\frac{\theta_{max}-\theta}{\Delta t}.
\]

Outside it, signed position error supplies bounded Baumgarte repair. When a
motor and interval are composed, solve the motor block before both guardians;
the guardians then observe speed introduced during the same projected pass.

```ts
import {
  ConstraintBlockSolver4,
  PlanarRotationCoordinate4,
  PlanarRotationIntervalJoint4,
  PlanarRotationMotor4
} from '@holotope/physics';

const phase = new PlanarRotationCoordinate4({
  joint: rotation,
  localPhaseDirectionA: [0, 0, 1, 0],
  worldPhaseDirectionB: [0, 0, 1, 0]
});
const motor = new PlanarRotationMotor4({
  coordinate: phase,
  targetSpeed: 1.2,
  maxTorque: 8
});
const interval = new PlanarRotationIntervalJoint4({
  coordinate: phase,
  minAngle: -Math.PI / 3,
  maxAngle: Math.PI / 3
});

world.step(fixedDt, 1, (dt) => {
  const drive = motor.constraint();
  const limits = interval.constraints(dt);
  if (drive.status === 'regular' && limits.status === 'regular') {
    blocks.solve([
      drive.block,
      ...limits.constraints.map((entry) => entry.block)
    ], dt);
  }
});
```

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

### Deterministic hyperbox contact orchestration

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
- closed-form XPBD scalar multipliers, compliant residuals, force scaling,
  mass-weighted corrections, fixed-point evidence, R2/R3/R4/R7 specialization,
  Euclidean invariance, coupled-chain convergence, degeneracy refusal, and
  atomic rollback after custom-evaluator failure;
- RN point-mass semi-implicit prediction through R7, force holding across
  substeps, fixed-point semantics, repeated hard-distance support, compliant
  static extension and force at two timesteps, oscillator recurrence parity,
  center-of-mass preservation, registration ownership, and complete world-step
  rollback;
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
- explicit legacy velocity-only fallback plus bounded event-limit remainder
  without a fabricated continuous guarantee;
- pose-pair trajectory/rate differentials, absolute kinematic suffix plans,
  continuous segment chaining and overrun refusal, local compact-collider pose
  synchronization, discrete substep advancement, translating and pure-spin
  kinematic CCD, dynamic-only impulse response, and swept/exhaustive event
  agreement.
- analytic and randomized full-SO(4) point-joint block solves, hidden-axis
  lever coupling, embedded-R3 invariance, coincident-anchor momentum
  conservation, persistent warm starts, and fixed-world gravity support.
- dimension-independent distance gradients through R7, translation and
  embedding invariance, explicit coincident-anchor directions, unrestricted
  stretch/compression impulses, separated-anchor six-plane momentum
  conservation, embedded-R3 invariance, and long-running gravity tethers;
- scalar rigid-Jacobian differentials over randomized full-SO(4) anisotropic
  bodies, prescribed-motion response, coherent warm-row projection, and a
  pure xw angular coordinate;
- force-to-impulse bound scaling, one-sided complementarity, saturated-row KKT
  residuals, bounded warm-start projection, fixed rows, and malformed bound
  refusal;
- diagnostic crossing classification, two stable distance-guardian IDs,
  interior safe-speed corridors, lower/upper impulse signs, stale warm-impulse
  removal, full-span crossings, exact-coincidence branch refusal, embedded-R3
  closure, and full-SO(4) pair momentum conservation;
- positive and negative distance-motor tracking, exact force saturation,
  timestep-consistent acceleration, guardian enforcement of velocity created
  by other rows, motor/interval composition, and the distinction between energy
  input and internal-force momentum conservation.
- five-row planar-rotation finite differences, full-SO(4) anisotropic block
  solves, typed two-frame chart failures, transported basis invariance, exact
  SO(2) stabilizer freedom, embedded-R3 closure, and pair momentum conservation.
- signed planar-phase differentials, common-SO(4) invariance, positive ambient
  orientation, multi-turn unwrap continuity, explicit half-turn branches, and
  embedded-R3 signed-angle closure.
- six-row fixed-frame differentials for both participants, common-world
  invariance, exact anisotropic block response, pair momentum conservation,
  local material-frame binding, cut-locus refusal, branch hysteresis,
  embedded-R3 closure, and long-running world-step stability.

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
Spatial trees, moving infinite-plane pose trajectories, distance servos,
rolling resistance, and sleeping are not implied by this stage. The landed
direction, planar-rotation, and fixed-frame policies are distinct
stabilizer families, not a claim that every mechanism called a “hinge” in R4
has one meaning.
Exact total angular-momentum conservation applies when the two impulse anchors
coincide; penetrated witness pairs are distinct constraint anchors and
positional stabilization is intentionally non-conservative.
