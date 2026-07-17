# @holotope/physics

Headless higher-dimensional mechanics for Holotope. The first Stage C release
implements 4D convex mass properties, principal-plane inertia, dynamic
`RigidBody4` state, a momentum-primary ballistic `PhysicsWorld4`, and
fixed-step interpolation into the renderer-neutral `ObjectN` scene graph. The
current Stage D layer adds support/GJK queries, complete oriented-hyperbox
contact patches, warm-started contact response with a coupled R4 tangent
friction ball, and deterministic mixed-shape collider/body orchestration.
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

Spatial-tree broadphases, rotational CCD, joints, rolling resistance, and
sleeping are not yet part of this package. R4 Coulomb
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
