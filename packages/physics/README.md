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
now serves point joints and two genuinely R4 rotational policies: preservation
of one oriented material direction with its SO(3) stabilizer free, and
preservation of an ordered two-frame with one complementary SO(2) rotation
free.
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
casts are analytic.

World-frame angular momentum is authoritative. Free flight therefore does not
numerically integrate a gyroscopic force or silently lose momentum; angular
velocity is derived through the body's principal inertia each step and the
orientation remains on Spin(4) through paired-quaternion normalization.

Spatial-tree broadphases, rotational CCD, planar-rotation motors and limits,
full-frame joint policies, distance servos, rolling resistance, and sleeping are not yet part
of this package. R4 Coulomb
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

`relativeOrientationCoordinates4()` provides the analogous local coordinate
for rotation. It chooses one lift of the paired-quaternion double cover,
returns a reusable branch token for coherent timesteps, and reports the full
SO(4) logarithm cut locus as a discriminated result rather than manufacturing
an axis. `orientationDexp4()` and `orientationDlog4()` expose the matching 6x6
Jacobians in either world-left or body-right trivialization. The right factor
uses the opposite Jacobian sign because `Rotor4` composes that quaternion in
reverse order. These are proof-kernel primitives; no hinge, cone, limit, or
motor policy is implied yet.

`ConstraintBlockSolver4` couples one to six unbounded equality rows through
their complete `J M^-1 J^T` response. Its default rank policy refuses lost
coordinates; an explicit `minimum-norm` policy exposes a deterministic
spectral pseudoinverse for diagnostics. Bias limiting and warm-start transport
operate on the complete coordinate vector, preserving orthogonal row-basis
invariance. `PointJointSolver4` is now a compatibility wrapper over this shared
kernel.

`DirectionJoint4` binds one body-local unit direction to another local or
fixed-world direction. `constraint()` returns either a regular three-row block
or a typed `antipodal` refusal. The three rows constrain the tangent space of
the direction sphere and leave the non-abelian SO(3) stabilizer free, so the
joint deliberately exposes no fictitious scalar “hinge angle.”

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

For automatic mixed contact, register `GlomeCollider4`, `PolytopeCollider4`,
`HyperplaneContactCollider4`, and/or `HyperboxCollider4` instances with
`ContactPipeline4`, then call `pipeline.stepWorld(world, fixedDt)`. Finite
colliders share conservative AABBs and temporally coherent sweep-and-prune;
infinite planes are paired explicitly with every admitted compact collider.
`HyperboxContactPipeline4` remains the narrower homogeneous box path. The
exhaustive O(n²) finite provider remains available as the CPU golden reference.
For fast linearly moving bodies, `pipeline.stepWorldContinuous()` is an opt-in
event loop which advances to certified first impact before using the same
manifold solver. Compact pairs are pruned by conservative swept AABBs, and each
event scan retains broadphase diagnostics; the exhaustive provider remains the
differential reference. Its result explicitly reports rotational,
prescribed-motion, and cast-uncertainty fallbacks; the discrete default is
unchanged.

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
