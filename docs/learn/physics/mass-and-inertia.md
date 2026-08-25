# Mass properties and principal frames

Exact convex volume, centre of mass, covariance, and the diagonalised inertia that R4 rigid motion is built on.

<!-- doc-check: sequential -->

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
`m0…m3`, the inertia of the coordinate-plane bivector $e_i \wedge e_j$ is `mi + mj`.
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

## Analytic shapes

A collider authored from four half-extents or from one radius has no complex to
integrate, and building a boundary purely to derive inertia is a lot of
scaffolding for a closed form. Two helpers give the same `MassProperties4`
directly:

```ts
import {
  RigidBody4,
  massPropertiesOfGlome4,
  massPropertiesOfHyperbox4
} from '@holotope/physics';

const box = massPropertiesOfHyperbox4([0.5, 1.25, 2, 3.5], { density: 1 });
console.log(box.volume);          // 16·h0·h1·h2·h3
console.log(box.inertiaDiagonal); // m(hi² + hj²)/3, in plane order

const ball = massPropertiesOfGlome4(1, { density: 1 });
console.log(ball.volume);          // π²r⁴/2
console.log(ball.inertiaDiagonal); // m·r²/3, the same in all six planes

const boxBody = RigidBody4.fromMassProperties(box);
```

Both describe a **uniform solid**: homogeneous material filling the shape.
Density defaults to `1`, and mass scales with it linearly.

These are the same quantities `massPropertiesFromCellComplex4` produces for the
same solid — volume, mass, centre, source covariance, principal moments and the
reconstructed inertia operator all agree — reached in closed form rather than by
integration.

### The frame these return

Half-extents and radius are read in the axes you write them in, and the result
is the canonical principal representation, exactly as the boundary integrator
returns. Because `principalSecondMoments` is ordered ascending and a box's
second moment grows with its extent, **the principal frame is the authored axes
permuted so the half-extents ascend**. Write them ascending and the permutation
is the identity.

That matters when a collider shares the body. `RigidBody4.fromMassProperties`
adopts `principalRotor` as the body's rotation, so a `HyperboxCollider4` on that
body must be given its half-extents in the same principal order:

```ts
import { HyperboxCollider4 } from '@holotope/physics';

const authored = [3.5, 2, 1.25, 0.5];
const crateProperties = massPropertiesOfHyperbox4(authored);
const crate = RigidBody4.fromMassProperties(crateProperties);

// Sorted, because the body is now posed in the principal frame. Passing the
// authored order here would describe a differently oriented box than the one
// the mass properties describe.
const collider = new HyperboxCollider4({
  id: 'crate',
  halfExtents: [...authored].sort((a, b) => a - b),
  participant: crate
});
```

This is the analytic counterpart of rebasing a complex with
`rebasePositionsToPrincipalFrame4`. A glome needs none of it: a ball has no
preferred axes, so its principal frame is the identity and its rotor is the
identity rotor.

### When not to use them

Collider geometry does not determine mass distribution. A collider is often a
proxy — a hull around a dense core, a shell, a character whose handling is
authored rather than physical — and for those the authored inertia is the right
answer and these helpers are not. They describe a solid of uniform density and
claim nothing else.
