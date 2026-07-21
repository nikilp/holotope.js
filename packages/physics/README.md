# @holotope/physics

Headless higher-dimensional mechanics for Holotope. The first Stage C release
implements 4D convex mass properties, principal-plane inertia, dynamic
`RigidBody4` state, a momentum-primary ballistic `PhysicsWorld4`, and
fixed-step interpolation into the renderer-neutral `ObjectN` scene graph. The
current Stage D layer adds support/GJK queries, complete oriented-hyperbox
contact patches, warm-started contact response with a coupled R4 tangent
friction ball, a coupled four-coordinate bilateral point joint, scalar rigid
Jacobian rows with generalized-force bounds, rigid distance equalities,
two-guardian distance intervals, force-limited distance motors, and
deterministic mixed-shape collider/body orchestration. Its rotational
foundation also exposes paired-bivector coordinates, branch-aware relative
SO(4) logarithms, analytic exponential/logarithm Jacobians, and the exact
angular-velocity operator norm. A common one-to-six-row equality-block solver
now serves point joints and three genuinely R4 rotational policies: preservation
of one oriented material direction with its SO(3) stabilizer free, and
preservation of an ordered two-frame with one complementary SO(2) rotation
free, or preservation of a complete relative material frame with no rotational
stabilizer free.
Candidate generation is dimension-independent and includes exhaustive and
temporally coherent sweep-and-prune providers; static and linearly swept AABBs
share the same candidate contract, while infinite planes remain in an explicit
exhaustive boundary lane. A capability-aware dispatcher distinguishes
general distance, rounded shallow contact, bounded general R4 EPA penetration,
complete vertex-polytope and exact hyperbox deep manifolds,
analytic N-ball/N-ball and N-ball/hyperplane deep contact, exact R4
glome/hyperbox, hyperbox/hyperplane, and general vertex-polytope/hyperplane
contact, and unsupported requests. Dimension-independent conservative
advancement adds compact/compact linear casts, while compact/infinite-plane
casts are analytic. R4 also has explicit constant-generator rigid trajectories
and conservative compact/compact and compact/plane casts whose angular
closing bound uses the exact SO(4) operator norm.

A separate `XpbdConstraintSolverN` supplies an auditable dimension-generic
Float64 position-level kernel for compliant scalar relations. Equalities are
unbounded and declared `C(x) >= 0` inequalities project total multipliers onto
the non-negative ray. Results expose the total XPBD multiplier, signed force
estimate, raw compliant residual, and projected KKT residual, while exact RN
distance, unsigned intrinsic simplex measure, and signed full-dimensional
simplex measure constraints provide equality consumers and exact RN
particle–hyperplane contact provides the first inequality consumer.
This does not replace or silently couple to the velocity-level R4 rigid
constraint solver.
`XpbdWorldN` wraps that kernel in explicit RN point-mass prediction, velocity
reconstruction, ordered post-projection velocity responses, force accumulation,
substeps, ownership checks, and atomic world-step rollback. Its first responses
provide exact particle–plane Coulomb friction over the complete RN tangent ball
and named timestep-invariant exponential damping.

World-frame angular momentum is authoritative. Free flight therefore does not
numerically integrate a gyroscopic force or silently lose momentum; angular
velocity is derived through the body's principal inertia each step and the
orientation remains on Spin(4) through paired-quaternion normalization.

Spatial-tree broadphases, moving infinite-plane pose policies, distance servos, rolling
resistance, and sleeping are not yet part of this package. R4 Coulomb
friction is represented by one rotationally symmetric three-dimensional
tangent ball, never by three independent scalar clamps.

```ts
import {
  ObjectN,
  SceneN,
  createHypercube,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import {
  PhysicsWorld4,
  RigidBody4,
  RigidBodyObject4Binding,
  massPropertiesFromCellComplex4,
  rebasePositionsToPrincipalFrame4
} from '@holotope/physics';

const geometry = tetrahedralizeCuboidCells(createHypercube({ dim: 4 }));
const mass = massPropertiesFromCellComplex4(geometry);
const principalPositions = rebasePositionsToPrincipalFrame4(geometry.positions, mass);
const body = RigidBody4.fromMassProperties(mass);
const scene4 = new SceneN(4);
const object4 = new ObjectN(4);
scene4.add(object4);
const binding = new RigidBodyObject4Binding(body, object4);

new PhysicsWorld4().addBody(body).step(1 / 60);
const alpha = 0.5; // normally renderAccumulator / fixedStep
binding.capture().apply(alpha);
scene4.updateWorld();
```

`PointJoint4` binds a body-local anchor to another body or a fixed world point.
Resolve it inside the world's velocity-constraint callback and pass the result
to `PointJointSolver4`; the solver exposes the complete 4x4 point response and
solves all four bilateral coordinates as one block.

`ConstraintRowSolver4` solves scalar rigid-Jacobian rows with optional
`minForce` and `maxForce`. It converts those generalized-force bounds to
impulse bounds using the substep duration, then projects every accumulated
impulse. Omitting both bounds gives an unrestricted equality row. Results
separate raw equality residual from same-sign projected KKT residual, so valid
saturation is distinguishable from a row that has not converged. Aggregate
coordinate impulse, error, and residual values are scale-dependent solver
diagnostics, not physical totals across unlike rows.

`DistanceCoordinate4` is the persistent anchor binding shared by three
policies. `DistanceJoint4` enforces a positive rest length.
`DistanceIntervalJoint4.constraints(dt)` always returns stable minimum and
maximum unilateral guardian rows. Inside `[minLength, maxLength]`, their speed
targets bound the next first-order position; outside, signed error produces
recovery bias. Keeping both guardians in the solve lets them catch unsafe
radial velocity introduced by motors or other rows during iteration.
`interval(dt)` reports the currently observed crossing state for diagnostics
only. `DistanceMotor4` tracks radial speed with symmetric `maxForce`, with
positive speed lengthening the coordinate. Place its row before both guardians
when solving them together. The coordinate geometry is also exposed through
`evaluateDistanceCoordinateN()` and `evaluateDistanceConstraintN()` for any
`VecN` dimension. At exact coincidence, solver rows require an authored scalar
direction branch and refuse transverse or negative-branch relative motion;
diagnostics may still observe one-sided distance growth without manufacturing
a solve gradient.

`XpbdConstraintSolverN` instead projects scalar relations over mutable RN point
coordinates. One solve batch has an explicit dimension and initializes one
total multiplier per constraint. Compliance is physical inverse stiffness and
is scaled by `1 / dt^2` inside the update; results report the corresponding
signed force and `C + alpha/dt^2 * lambda` residual. A greater-than-or-equal
relation projects the total multiplier to `lambda >= 0`; its projected KKT
residual treats valid positive slack as zero error. Custom evaluators are pure,
dimension-checked functions with one gradient per unique point. Invalid batches
restore every participating position. `XpbdDistanceConstraintN` reuses the
same exact distance coordinate and coincidence-branch rule as the rigid
adapter.

`evaluateSimplexSquaredMeasureN()` evaluates the intrinsic k-measure of any
k-simplex embedded in RN from `det(E^T E) / (k!)^2`, together with Float64
ambient gradients. `XpbdSimplexSquaredMeasureConstraintN` constrains that
squared coordinate directly, so its compliance units depend on k. The
coordinate is translation- and rotation-invariant and needs no dimension-
specific cross product. It is deliberately unsigned: it preserves measure
magnitude but is not an inversion barrier. Cofactor gradients remain finite at
singular Gram matrices; a collapsed simplex whose first derivative vanishes
reports `no-dynamic-response` rather than receiving an invented recovery
normal.

`evaluateOrientedSimplexMeasureN()` instead evaluates
`det([x1 - x0, ..., xN - x0]) / N!` for exactly `N + 1` points in `R^N`.
Its cofactor gradients transform covariantly under SO(N), while reflection or
an odd vertex permutation reverses the scalar sign.
`XpbdOrientedSimplexMeasureConstraintN` can therefore preserve and report
material-cell orientation as well as magnitude. The full-dimensional
restriction is intentional: an embedded `k < N` simplex needs an additional
normal-frame convention before it has a scalar orientation. This equality is
also not a no-tunnelling barrier; a sufficiently large discrete update may
cross or land on the zero-measure set.

`XpbdParticleN` adds velocity, force, gravity scale, and a stable world-local id
to that point coordinate. `XpbdWorldN.step()` performs semi-implicit prediction,
XPBD projection, velocity reconstruction, then ordered
`XpbdVelocityResponseN` policies for every substep. Responses may change only
declared registered velocities and retain their evidence beside the matching
solve result. Forces are held across the outer step and clear only on success.
Late evaluator or response errors restore position, velocity, force, and
gravity scale transactionally. Fixed particles remain outside prediction and
do not acquire an inferred kinematic trajectory.

`compileXpbdParticleBindingN()` owns the topology-neutral one-particle-per-
source-vertex correspondence and transactional source write-back. It keeps
positive physical mass separate from the fixed mobility policy, so pinning a
vertex does not erase its mass evidence. `lumpSimplexMassesN()` supplies an
auditable diagonal reference mass by integrating density against intrinsic
simplex rest measure and equally accumulating each element mass onto its
incident vertices. It reports element and vertex totals independently.

`XpbdParticleHyperplaneConstraintN` declares the normalized point gap to an
oriented RN hyperplane as a non-negative scalar relation.
`compileXpbdParticleHyperplaneFamilyN()` composes one such constraint per
source vertex over an existing particle binding, retaining source ordinal,
compile-time gap, clearance, compliance, and exact particle identity. It is a
discrete point-contact reference. The optional
`compileXpbdParticleHyperplaneFrictionFamilyN()` consumes the same normal
solves after velocity reconstruction and projects the desired stopping impulse
onto the complete RN Coulomb tangent ball. In R4 that is an isotropic
three-ball, not three scalar clamps. `XpbdExponentialVelocityDampingN` provides
separate timestep-invariant decay with an inverse-seconds rate. These are not
deformable surface contact, restitution, or continuous collision.

`compileXpbdDistanceNetworkN()` turns one explicitly selected two-vertex
`CellComplex` 1-cell group into distance constraints. It can retain its
compatible self-contained particle-authoring path or compose over an existing
source-indexed particle binding. In the composed path it preserves exact
particle identities and takes rest lengths from source geometry, so compiling
constraints after deformation does not silently redefine rest. Every edge
retains structural source identity. Source positions do not alias the
simulation; an explicit binding or standalone-network write synchronizes them
only after complete validation.

`compileXpbdSimplexMeasureFamilyN()` compiles one explicitly selected simplex
cell group onto an existing source-indexed `XpbdParticleN` array. It retains a
structural source id and vertex tuple per cell, derives default rest measure
from source geometry rather than possibly deformed live particles, and keeps
rest/compliance policies separate from topology. The family owns no particles
and performs no write-back. `addToWorld()` requires the exact particle objects
to be registered already, then preflights every lineage and constraint id
before attaching the family atomically. This lets distance and local measure
coordinates share one RN state without implying a complete deformable-body
model.

`compileXpbdOrientedCuboidFamilyN()` accepts an explicitly selected
full-dimensional cuboid group and applies the core's deterministic Kuhn
simplexization internally. Each generated signed-measure constraint retains
the structural id of its authored parent cuboid, the parent-cell ordinal, the
axis-permutation ordinal and tuple, and both source vertex tuples. The raw
simplex signs alternate with permutation parity; the compiler preserves that
auditable ordering rather than silently rewinding cells. Rest coordinates come
from source geometry, material callbacks remain separate, and the family
shares an existing source-indexed particle array. World attachment preflights
all parent lineage, particle ownership, and constraint ids before adding any
constraint.

`evaluateSimplexMetricDeformationN()` compares matching rest and current
k-simplices in RN through their intrinsic edge Gram metrics. Cholesky
normalization expresses the current metric in an orthonormal rest-material
basis, yielding the right Cauchy–Green tensor, Green–Lagrange strain, ordered
principal stretches, measure ratio, rest-conditioning evidence, and spectral
residual. It applies equally to embedded curves/membranes and full-dimensional
solids without an ambient cross product. Only the full-dimensional case reports
a signed measure ratio and preserved/inverted/collapsed state; embedded
simplices require an authored normal frame before scalar orientation is
meaningful. The coordinate selects no constitutive energy and produces no
forces by itself.

`relativeOrientationCoordinates4()` provides the analogous local coordinate
for rotation. It chooses one lift of the paired-quaternion double cover,
returns a reusable branch token for coherent timesteps, and reports the full
SO(4) logarithm cut locus as a discriminated result rather than manufacturing
an axis. `orientationDexp4()` and `orientationDlog4()` expose the matching 6x6
Jacobians in either world-left or body-right trivialization. The right factor
uses the opposite Jacobian sign because `Rotor4` composes that quaternion in
reverse order. These are proof-kernel primitives; no hinge, cone, limit, or
motor policy is implied yet.

`ConstraintBlockSolver4` couples one to six rows through their complete
`J M^-1 J^T` response. Equality blocks retain the original default. An
explicit `one-bounded` projection may add exactly one force-limited coordinate:
the solver eliminates the remaining equalities through a scalar Schur
complement, clamps that coordinate, and re-solves the equality subspace
exactly. Diagnostics distinguish raw speed error from the projected KKT
residual. The default rank policy refuses lost coordinates; an explicit
`minimum-norm` policy remains available only for unbounded equality
diagnostics. Bias limiting and warm-start transport preserve orthogonal
equality-basis invariance. `PointJointSolver4` is a compatibility wrapper over
this shared kernel.

`DirectionJoint4` binds one body-local unit direction to another local or
fixed-world direction. `constraint()` returns either a regular three-row block
or a typed `antipodal` refusal. The three rows constrain the tangent space of
the direction sphere and leave the non-abelian SO(3) stabilizer free, so the
joint deliberately exposes no fictitious scalar “hinge angle.”

`OrientationJoint4` binds a complete body-local frame to another material
frame or a fixed world frame. Its six equality rows are the full rotational
analogue of a weld; combine them with the four rows of `PointJoint4` when both
orientation and translation must be fixed. The error is
`log(inverse(frameB) * frameA)`, expressed in frame B, and the analytic
world-left rate rows are exact negatives for the two participants. This makes
the coordinate invariant under common world rotation and keeps internal
angular impulses equal and opposite. The paired-quaternion lift is retained
across evaluations, while the non-unique SO(4) cut locus returns a typed result
with no solver block.

`PlanarRotationJoint4` binds an ordered body-local orthonormal two-frame to a
local or fixed-world frame. Its five-row Stiefel constraint fixes that frame
and leaves only SO(2) rotation in the orthogonal plane. First-axis antipodes and
degenerate second bisectors are typed refusals. This is deliberately distinct
from oriented-plane preservation, which would leave a two-angle torus free.

`PlanarRotationCoordinate4` attaches one phase-reference direction to each
side of that joint. It reports a signed wrapped angle, a persistent unwrapped
angle, the positively oriented complementary-plane bivector, and its angular
speed. A sample exactly half a turn from the preceding branch is a typed
`unwrap-ambiguous` result until the caller chooses its sign; samples must be
frequent enough that an unobserved advance never reaches `pi`.

`PlanarRotationMotor4` adds the oriented phase row to the five frame rows and
tracks signed angular speed under a symmetric `maxTorque` bound.
`PlanarRotationIntervalJoint4` returns two persistent guardian blocks over the
continuous unwrapped angle. Their first-order speed corridor catches unsafe
motion introduced by earlier motor or constraint blocks in the same projected
iteration. Singular frame charts and ambiguous half-turn lifts remain typed
results rather than implicit branch choices.

For automatic mixed contact, register `GlomeCollider4`, `PolytopeCollider4`,
`HyperplaneContactCollider4`, and/or `HyperboxCollider4` instances with
`ContactPipeline4`, then call `pipeline.stepWorld(world, fixedDt)`. Finite
colliders share conservative AABBs and temporally coherent sweep-and-prune;
infinite planes are paired explicitly with every admitted compact collider.
`HyperboxContactPipeline4` remains the narrower homogeneous box path. The
exhaustive O(n²) finite provider remains available as the CPU golden reference.
For fast rigidly moving bodies, `pipeline.stepWorldContinuous()` is an opt-in
event loop which advances to certified first impact before using the same
manifold solver. Compact pairs are pruned by conservative swept AABBs, and each
event scan retains broadphase diagnostics; the exhaustive provider remains the
differential reference. Its result explicitly reports prescribed-motion and
cast-uncertainty fallbacks; the discrete default is unchanged.

`RigidTrajectory4` makes an R4 screw path an explicit reusable value rather
than an assumption hidden inside a solver. `convexRigidCast4()` and
`supportShapeHyperplaneRigidCast4()` conservatively advance along that exact
path. Their closing-speed certificate adds each body's tight
`angularVelocityOperatorNorm4(generator) * boundingRadius` contribution to the
linear normal closure. Built-in glomes, rounded shapes, transformed shapes,
and vertex-enumerable polytopes have auditable inferred radii; opaque support
functions must provide a validated explicit bound. `RigidBodyPosePlan4`
freezes the same momentum-derived Lie-midpoint generator used by ordinary free
flight. `stepWorldContinuous()` gives each event scan those plans and applies
the exact same plans to the selected impact; response then changes momentum
and causes the remainder to be replanned. No-impact rotational advancement is
therefore endpoint-identical to `PhysicsWorld4.integratePoses()`.

`rigidTrajectoryFromTransforms4()` constructs the principal screw segment
between two coherent R4 poses. `KinematicBody4` attaches a physical duration to
that segment, owns its current position and rotation, and exposes the exact
linear and world-left angular rates used by contact response. It accepts no
impulses. Discrete world seams and `stepWorldContinuous()` advance registered
kinematic compact colliders through the same absolute subplans used by swept
broadphase and casting. Centered glomes preserve the analytic linear fast path;
rotating hyperboxes, polytopes, and offset glomes use rigid casts. A legacy
velocity-only `RigidMotion4` still produces a typed partial fallback because no
geometry path can be inferred honestly from velocity alone.

`KinematicTrackDriver4` produces those segments from one position sampler and
one `Rotor4Track` on a fixed clock. It samples each accepted boundary once,
caches the shared endpoint between consecutive segments, and refuses to replace
a segment before the body reaches it. CCD therefore consumes a frozen physical
trajectory even when an event step is subdivided; animation is never resampled
inside the collision loop. The adapter has no renderer or mixer dependency.

`NarrowphaseDispatcherN` is the common query boundary. Its `best` mode selects
the strongest honest capability for the configured pair and margins; explicit
requests never silently fall back. Stable ordered pair IDs provide coherent GJK
warm starts and deterministic batch retirement. Zero-margin compact R4 pairs
can return a bounded EPA minimum-translation witness. When both shapes also
enumerate stable source vertices, `polytope4` derives their facet halfspaces and
clips a complete response-grade contact manifold whose face-pair IDs persist
under coherent rigid motion. Its dimension-independent topology compiler turns
the exhaustive facet search into reusable source-ID incidence; live queries
reconstruct and validate only the current facet planes. `PolytopeCollider4`
caches this product by source identity by default. The same incidence product
supplies complete point-through-polyhedron support-face contact against an
infinite plane, with stable source-vertex IDs and affine-span-preserving
solver-point reduction. Deep results retain an algorithm discriminator,
so a smooth point patch is never mistaken for a polyhedral patch.

`contactConstraintFromSmoothPointPatch4()` connects either analytic smooth
family to the existing coupled R4 friction solver. Coincident glome centers
remain observable but non-responding because their minimum-translation normal
is not unique. Mixed R4 adapters preserve either the single glome/box witness
or the complete point-through-polyhedron box/plane support feature; an interior
glome/box tie likewise stays observable without manufacturing a direction.

MIT © Nikolay Petrov
