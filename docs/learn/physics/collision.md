# Collision queries

Support mappings, GJK distance, linear and rigid casts with time of impact, and the EPA penetration fallback.

## What these queries operate on

The casts and pipelines below act on support shapes and rigid poses, not on
meshes.

<!-- doc-check: context -->

```ts
import type { Rotor4Track, TransformN, VecN } from '@holotope/core';
import type {
  ContactPipeline4,
  HyperplaneColliderN,
  PhysicsWorld4,
  SupportShapeN
} from '@holotope/physics';

declare const world: PhysicsWorld4;
declare const a: SupportShapeN;
declare const b: SupportShapeN;
declare const shapeA: SupportShapeN;
declare const shapeB: SupportShapeN;

// A linear cast sweeps one shape by a displacement; a rigid cast interpolates
// between two authored poses.
declare const displacementA: VecN;
declare const displacementB: VecN;
declare const fixedDt: number;
declare const floor: HyperplaneColliderN;
declare const previousPlatformPose: TransformN;
declare const nextPlatformPose: TransformN;
declare const rotationTrack: Rotor4Track;
declare const pipeline: ContactPipeline4;
```

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
`n + 1` support points in $\mathbb{R}^n$. In addition to the boolean and distance it
returns closest points on both shapes, a separating normal, stable source
feature IDs, convex weights, a conditioning estimate, and an explicit
termination reason.

The result taxonomy separates a stable numerical *estimate* from a certified
*result*. `separated` is only ever reported with a support-gap certificate —
the projection optimality condition checked against the shape itself — and
`intersecting` with an origin-enclosure proof. A query that obtains neither
refuses explicitly: `iteration-limit` means the proof was not reached within
the compute budget, and its `distance` is the best current estimate, not a
claim. A distance that has merely stopped changing between iterations is never
converted into a separation.

Equal and nearly tied support directions — a probe on the symmetry axis of a
box, a lattice point over a regular face — terminate with the certificate:
when the support map repeats itself, the accumulated support set is
reprojected with certificate-aware selection, which decides configurations
whose per-iteration distance improvement is below Float64 comparison noise. A
proved fixpoint refuses immediately as `duplicate-support` rather than
spending the remaining budget re-entering the same state.

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

## Linear casts and time of impact

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

## Explicit R4 rigid trajectories and casts

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

## General R4 penetration

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
