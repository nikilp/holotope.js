# Cookbook

These recipes use the stable public package boundaries. They are intentionally
small; use the linked showcase sources as complete browser scaffolds.

## Render one R4 complex as a projection and an exact section

`SlicedComplex3D` needs tetrahedral 3-cells to cut. A cuboid tesseract should
therefore be tetrahedralized before it is given to a section product.

```ts
import {
  HyperplaneSlice4,
  PerspectiveProjection,
  TransformN,
  createHypercube,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import {
  ProjectedEdges3D,
  SlicedComplex3D
} from '@holotope/three';

const complex = tetrahedralizeCuboidCells(
  createHypercube({ dim: 4, size: 2 })
);
const transform = TransformN.identity(4);
const shadow = new ProjectedEdges3D(
  complex,
  new PerspectiveProjection({ fromDim: 4, viewDistance: 4 })
);
const section = new SlicedComplex3D(
  complex,
  HyperplaneSlice4.axisAligned(3, 0)
);

scene.add(shadow.object, section.object);

function render() {
  shadow.update(transform);
  section.update(transform);
  renderer.render(scene, camera);
}
```

See the complete [tesseract example](../examples/showcase/src/tesseract.ts).

## Sweep and reorient a 4D slice

Changing `offset` moves the same affine plane. `setNormal()` changes its
orientation and updates the slice display frame in place, so the existing
`SlicedComplex3D` can be retained.

```ts
const slice = HyperplaneSlice4.axisAligned(3, 0); // w = 0 initially
const section = new SlicedComplex3D(complex, slice);

function updateSlice(timeSeconds: number, transform: TransformN) {
  slice.offset = 0.85 * Math.sin(timeSeconds * 0.7);
  slice.setNormal([0.2 * Math.sin(timeSeconds * 0.3), 0, 0, 1]);
  section.update(transform);
}
```

For an axis-aligned scan, omit `setNormal()` and animate only `offset`.
`axisAligned(3, offset)` is a W scan; it does not animate a camera.

## Add visual 4D rotation from pointer drag

Use `DragRotation4D` for inspection. It maps pointer deltas to a `Rotor4` in
chosen coordinate planes; it does not apply a physical torque.

```ts
import { TransformN } from '@holotope/core';
import { DragRotation4D } from '@holotope/three';

const drag4d = new DragRotation4D({
  horizontalPlane: [0, 3], // xw
  verticalPlane: [1, 3],   // yw
  modifier: 'alt'
}).attach(renderer.domElement);

function render() {
  orbitControls.enabled = !drag4d.active;
  const transform = new TransformN(4, drag4d.rotor);
  shadow.update(transform);
  section.update(transform);
}
```

For authored angular motion, use `BivectorN.fromPlanes(4, …)` or `Rotor4`.
For a physical R4 body, set angular velocity or apply an impulse rather than
sharing the visual drag rotor directly.

## Pick a projected triangle and recover source-space evidence

This is the corrected form of the common raycast recipe. A homogeneous
perspective product can lift a point on a visible source triangle; overlapping
projected geometry remains explicitly ambiguous.

```ts
import { TransformN } from '@holotope/core';
import { representationHitFromProjectedSurface } from '@holotope/three';

const intersections = raycaster.intersectObject(surface.object, false);
const intersection = intersections.find((value) => value.faceIndex !== undefined);

if (intersection?.faceIndex !== undefined) {
  const hit = representationHitFromProjectedSurface(surface, {
    point: intersection.point,
    faceIndex: intersection.faceIndex
  });

  console.log(hit.source.id); // stable source-cell identity

  if (hit.ambientPointStatus === 'exact') {
    const pointInUpdatedR4Frame = hit.ambientPoint;
    const pointInBodyLocalR4 = bodyTransform.inverse()
      .applyToPoint(pointInUpdatedR4Frame);
    console.log(pointInBodyLocalR4.data);
  }
}
```

The inverse is appropriate only when `surface.update(bodyTransform)` supplied
that transformed frame. If you called `surface.update()` without a transform,
the exact ambient point is already in complex-local coordinates. For a
projected slice or an unsupported projection, expect source identity without
an exact ambient point.

## Apply a world-space R4 impulse or angular velocity

`RigidBody4` is headless. Advance it in `PhysicsWorld4`, then pass its pose to
render products through `TransformN`.

```ts
import { BivectorN, TransformN } from '@holotope/core';
import { PhysicsWorld4, RigidBody4 } from '@holotope/physics';

const world = new PhysicsWorld4({ gravity: [0, -9.81, 0, 0] });
world.addBody(body);

// A central impulse changes translation without adding angular momentum.
body.applyImpulseAtWorldPoint([0, 1.5, 0, 0], body.position);
body.setAngularVelocityWorld(BivectorN.fromPlanes(4, [
  { i: 0, j: 3, angle: 0.7 }, // xw angular velocity
  { i: 1, j: 2, angle: -0.2 } // yz angular velocity
]));

world.step(1 / 120);
const pose = new TransformN(4, body.rotation, body.position);
surface.update(pose);
section.update(pose);
```

R4 bivector coefficients are plane coordinates, not a 3D axis-angle vector.
The order is `[xy, xz, xw, yz, yw, zw]`.

## Choose the correct simulation layer

Use `RigidBody4` and `PhysicsWorld4` for compact rigid bodies. Use
`XpbdParticleN`, `XpbdWorldN`, and the compiled families for source-vertex
point systems and deformable references. They are distinct systems with
explicit conversion/composition boundaries.

Current rigid contact is exposed through named query, manifold, and pipeline
APIs; it is not automatically enabled by merely adding multiple bodies to
`PhysicsWorld4`. The Kitchen contact laboratories are the most complete
integration references while that public convenience layer remains under
development.

## Choose and assemble a simplex material law

Use StVK as the polynomial small-strain reference. Use compressible
Neo-Hookean when you need logarithmic resistance to large compression and can
honor its positive-measure domain.

```ts
import {
  compileSimplexConstitutiveFamilyN,
  simplexCompressibleNeoHookeanLawN
} from '@holotope/physics';

const material = compileSimplexConstitutiveFamilyN({
  id: 'solid-material',
  source,
  simplexGroup,
  particles: binding.particles,
  law: simplexCompressibleNeoHookeanLawN,
  material: { firstLameParameter: 8, shearModulus: 5 }
});

material.addToWorld(world);
```

The selected group must already contain simplices; a cuboid source can use
`simplexizeCuboidGroupN()` first. The family copies rest positions and retains
source-cell lineage. It owns no particles and does not write simulation state
back to the source. Named `compileSimplexStVenantKirchhoffFamilyN()` and
`compileSimplexCompressibleNeoHookeanFamilyN()` wrappers are available when a
fixed law is clearer.

## Reject and retry an inadmissible material step

Keep material energy and accepted-state policy explicit. The family supplies
forces; a separate guard checks the completed substep; the world owns rollback
and bounded subdivision.

```ts
import {
  compileSimplexConstitutiveFamilyStateGuardN,
  compileSimplexConstitutiveFamilyTrajectoryGuardN
} from '@holotope/physics';

const guard = compileSimplexConstitutiveFamilyStateGuardN({
  id: 'material-domain',
  family: material,
  minimumMeasureRatio: 0.1
});
guard.addToWorld(world);

// Full-dimensional simplices only: certify J along each straight substep chord.
const trajectoryGuard = compileSimplexConstitutiveFamilyTrajectoryGuardN({
  id: 'material-linear-orientation',
  family: material,
  minimumSignedMeasureRatio: 0.1
});
trajectoryGuard.addToWorld(world);

const accepted = world.stepAdaptive(1 / 60, {
  initialSubsteps: 1,
  maximumSubsteps: 16,
  growthFactor: 2
});

console.log(accepted.attempts); // rejected attempts, then the accepted count
```

Only a typed guard rejection is retryable. Invalid APIs, NaNs, and arbitrary
solver failures escape immediately. The first guard checks the completed
material state. The second independently certifies the straight line between
the substep's exact endpoint snapshots using a conservative Bernstein
polynomial query. It requires an N-simplex in R^N and is neither a certificate
for a nonlinear solver trajectory nor an implicit inversion barrier.

## Add a frictional RN floor to a particle system

Normal contact is a position inequality; Coulomb friction is an ordered
post-reconstruction velocity policy over the same exact contact identities.

```ts
import {
  HyperplaneColliderN,
  XpbdExponentialVelocityDampingN,
  compileXpbdParticleHyperplaneFamilyN,
  compileXpbdParticleHyperplaneFrictionFamilyN
} from '@holotope/physics';

const floor = compileXpbdParticleHyperplaneFamilyN({
  id: 'floor',
  source,
  particles: binding.particles,
  plane: new HyperplaneColliderN([0, 1, 0, 0], -2)
});
floor.addToWorld(world);

compileXpbdParticleHyperplaneFrictionFamilyN({
  id: 'floor-friction',
  contacts: floor,
  friction: 0.6
}).addToWorld(world);

world.addVelocityResponse(new XpbdExponentialVelocityDampingN({
  id: 'ambient-damping',
  particles: binding.particles,
  rate: 0.18 // inverse seconds
}));
```

Register friction after its normal family. Register damping after friction when
you want the contact evidence to describe the undamped reconstructed velocity.
The friction response acts on the complete RN tangent vector; it does not pick
visible axes or inspect a rendered floor.
