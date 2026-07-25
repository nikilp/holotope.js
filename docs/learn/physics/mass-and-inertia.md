# Mass properties and principal frames

Exact convex volume, centre of mass, covariance, and the diagonalised inertia that R4 rigid motion is built on.

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
