# Rigid bodies and free flight

Momentum-primary integration of `RigidBody4`, and how a fixed-step simulation is handed to a renderer without making the view authoritative.

## The body these examples act on

<!-- doc-check: context -->

```ts
import { RigidBody4 } from '@holotope/physics';

const body = new RigidBody4({
  mass: 1,
  // Six plane inertias, in [xy, xz, xw, yz, yw, zw] order.
  inertiaDiagonal: [1, 1, 1, 1, 1, 1],
  position: [0, 2, 0, 0]
});
```

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

const world = new PhysicsWorld4({ gravity: [0, -9.81, 0, 0] });
world.addBody(body);

const binding = new RigidBodyObject4Binding(body, node);
const fixedDt = 1 / 120;

// After every fixed simulation step:
world.step(fixedDt);
binding.capture();

// Once per rendered frame, with accumulator/fixedDt in [0, 1]:
const alpha = 0.5;
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

## Sectioning a moving source

A 4D body that has moved is only visible through a 3D section of it, and taking
that section means composing three things: the authored source, the frame the
body actually carries, and the hyperplane being cut with. The middle one is the
one that goes quietly wrong.

`RigidBody4.fromMassProperties` adopts `principalRotor` as the body's rotation,
so a body built from an authored box is posed in the box's *principal* frame,
not the frame its half-extents were written in. Anything placed alongside that
body has to agree — which is why a `HyperboxCollider4` must be handed its
half-extents sorted ascending. The section path asks for none of that:

```ts
import {
  RigidBody4,
  massPropertiesOfHyperbox4,
  sectionOfHyperbox4
} from '@holotope/physics';
import { HyperplaneSliceN } from '@holotope/core';

// Authored in the caller's own axes, in no particular order.
const authoredHalfExtents = [3.5, 2, 1.25, 0.5];
const crate = RigidBody4.fromMassProperties(
  massPropertiesOfHyperbox4(authoredHalfExtents)
);

const plane = new HyperplaneSliceN({ normal: [0.3, -0.5, 0.2, 0.78], offset: 0.35 });
const crateSection = sectionOfHyperbox4(
  { kind: 'hyperbox', halfExtents: authoredHalfExtents },
  { body: crate, slice: plane }
);
```

The hyperplane is any affine `⟨normal, x⟩ = offset` in R4, not only `w = const`,
and the result is expressed in that hyperplane's own R3 chart.

### What comes back

The result is a union, because a plane and a solid can miss each other:

| `status` | Means | Carries |
| --- | --- | --- |
| `'empty'` | no intersection | `provenance` only — there is no geometry to describe |
| `'tangent'` | touched with no volume — a point or an edge | `chartPositions` |
| `'ball'` | a glome's section, exactly a 3-ball | `chartCenter`, `radius`, `signedDistance` |
| `'polyhedral'` | a triangulated section surface | `section`, the released section result |

A `'polyhedral'` result carries the section machinery's own lineage, so every
drawn primitive still names the authored cell it came from:

```ts
import { HyperplaneSliceN } from '@holotope/core';
import {
  RigidBody4,
  massPropertiesOfHyperbox4,
  sectionOfHyperbox4
} from '@holotope/physics';

const boxHalfExtents = [3.5, 2, 1.25, 0.5];
const boxBody = RigidBody4.fromMassProperties(massPropertiesOfHyperbox4(boxHalfExtents));
const boxSection = sectionOfHyperbox4(
  { kind: 'hyperbox', halfExtents: boxHalfExtents },
  { body: boxBody, slice: HyperplaneSliceN.axisAligned(4, 3, 0) }
);

if (boxSection.status === 'polyhedral') {
  const { parentCells, lineage, cellCount } = boxSection.section;
  console.log(parentCells.length === cellCount); // one authored cell per primitive
  console.log(lineage.sourceVertices.length > 0); // and authored vertices per vertex
}
```

Every result — empty and tangent included — carries `provenance`, which retains
the authored source **by reference** rather than by an invented identifier,
along with the pose and the hyperplane that produced it.

### The frames involved

| Step | Map | Who applies it |
| --- | --- | --- |
| authored source | — | you write it |
| → centred principal | `Qᵀ (x − c)` from `MassProperties4` | the section path |
| → world | the body's current pose | the section path |
| → hyperplane | `⟨normal, x⟩ = offset` | the section path |
| → R3 chart | the slice's orthonormal basis | the section path |

The two middle steps are composed into one transform and applied once. The
cancellation is exact — `Q` in the pose against `Qᵀ` in the rebase — **when the
frame used is the one the body was posed from**. For a body built by
`fromMassProperties` that is automatic: a box's covariance is exactly diagonal,
so the eigensolver rotates nothing and the frame recomputed from the authored
half-extents is bit-for-bit the one the body carries.

### An inertia basis is not a box symmetry

It is tempting to conclude that any valid principal basis will do, since they
all describe the same inertia. For an analytic hyperbox they will not, and the
distinction is worth stating exactly:

- a rotation inside a degenerate inertia eigenspace **is** a valid inertia
  basis — orthonormal, determinant +1, reconstructing the same covariance
  exactly;
- it is **not** something a collider at the default pose can follow. Turn a tied
  pair of extents by 45° and every moment is unchanged while the solid is not;
- `HyperboxCollider4` does accept a `localTransform`, but `sectionOfHyperbox4`
  is never told about one. A section taken in such a frame would therefore part
  company with a plainly-attached collider sharing its body.

So `sectionOfHyperbox4` accepts the signed permutations that sort these
half-extents. That set is a change of basis rather than a symmetry group — for
unsorted extents the permutation maps the authored box onto a differently-shaped
one. Where extents tie, several such permutations exist, and *those* differ from
each other by symmetries of the box: a 90° turn of a tied pair is one, while 17°
and 45° turns are refused.

A source that genuinely needs an arbitrary frame has somewhere to say so.
`ComplexSectionSource4` carries authored coordinates, which hold the geometry a
`MassProperties4` record cannot:

```ts
import {
  HyperplaneSliceN,
  createHyperrectangle,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import {
  RigidBody4,
  massPropertiesFromCellComplex4,
  sectionOfComplex4
} from '@holotope/physics';

// The same box, authored as coordinates rather than as four numbers. Whatever
// frame its body carries, the authored positions still say where the solid is.
const spunBox = tetrahedralizeCuboidCells(
  createHyperrectangle({ dim: 4, edgeLengths: [2, 2, 4, 6], maxCellDimension: 3 })
);
const spunProperties = massPropertiesFromCellComplex4(spunBox);
const spunBody = RigidBody4.fromMassProperties(spunProperties);
const tracked = sectionOfComplex4(
  { kind: 'complex', complex: spunBox, massProperties: spunProperties },
  { body: spunBody, slice: HyperplaneSliceN.axisAligned(4, 3, 0) }
);
console.log(tracked.status);
```

A supplied frame is checked, and moment ratios alone are **not** what shows it
"describes this box" — they identify the inertia, not the geometry, and are
blind to both translation and tied-axis rotation. The frame must also have a
centre of mass at the authored origin (to a tolerance measured per axis, so a
thin axis is held to its own scale), be a signed permutation of the box's axes,
carry ascending principal moments, and associate each of those moments with the
authored extent its own column points at.

Note that `pose` — the alternative to `body` — stands in for a *body's* pose, so
it maps the centred principal frame into the world rather than the authored one.
`pose: identity` therefore places a box in its principal axes, half-extents
ascending, exactly as an unpositioned body would.

`provenance.worldFromSource` is that composed map, which is exactly what an
existing render product needs:

```ts
import {
  HyperplaneSliceN,
  createHyperrectangle,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import {
  RigidBody4,
  massPropertiesFromCellComplex4,
  sectionOfComplex4
} from '@holotope/physics';
import { SectionChart3D } from '@holotope/three';

const sourceComplex = tetrahedralizeCuboidCells(
  createHyperrectangle({ dim: 4, edgeLengths: [1, 2.5, 4, 7], maxCellDimension: 3 })
);
const tetrahedra = sourceComplex.groups.find(
  (group) => group.dim === 3 && group.verticesPerCell === 4
)!;
const cutting = HyperplaneSliceN.axisAligned(4, 3, 0);
const mover = RigidBody4.fromMassProperties(massPropertiesFromCellComplex4(sourceComplex));

const chart = new SectionChart3D(sourceComplex, tetrahedra, cutting);
const moving = sectionOfComplex4(
  { kind: 'complex', complex: sourceComplex },
  { body: mover, slice: cutting }
);
chart.update(moving.provenance.worldFromSource);
```

### A glome needs no frame at all

A ball has no preferred axes, so its section depends only on where its centre
is. The section is a 3-ball of radius `√(r² − d²)` for `d` the signed distance
from the plane to that centre, and it is unchanged by any rotation the body
carries:

```ts
import { HyperplaneSliceN } from '@holotope/core';
import {
  RigidBody4,
  massPropertiesOfGlome4,
  sectionOfGlome4
} from '@holotope/physics';

const ball = RigidBody4.fromMassProperties(massPropertiesOfGlome4(1.3));
const ballSection = sectionOfGlome4(
  { kind: 'glome', radius: 1.3 },
  { body: ball, slice: new HyperplaneSliceN({ normal: [0, 0, 0, 1], offset: 0.25 }) }
);

if (ballSection.status === 'ball') {
  console.log(ballSection.radius); // √(1.3² − 0.25²)
}
```

### What this is not

These take a source and a pose and return geometry. They hold no registry of
bodies, own no lifecycle, and do not decide when anything is re-sectioned — a
caller sections what it wants, when it wants. Sources are never mutated, so the
same authored complex can back any number of sections at any number of poses,
and returning a body to a previous pose reproduces its earlier section exactly.
