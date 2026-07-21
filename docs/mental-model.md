# The Holotope mental model

Holotope is not a 3D renderer with an extra coordinate hidden in a material.
It keeps an authoritative state in `R^N`, then makes every lower-dimensional
view an explicit observation of that state. Simulation, if present, also acts
on the source state rather than on a projected mesh.

```text
CellComplex / field / state in R^N                 @holotope/core
              │
              ├── TransformN, Rotor4, or RigidBody4 pose     core / physics
              │
              ├── Projection or HyperplaneSlice4             core
              │       │
              │       └── ProjectedEdges3D / ProjectedSurface3D /
              │           SlicedComplex3D                    @holotope/three
              │                     │
              │                     └── ordinary Three.js scene and Raycaster
              │
              └── RepresentationHitN ── source identity / exact lift when available
```

The reverse arrow is deliberately not automatic. A projection can overlap
distinct source points, so a click may recover a source cell but not a unique
ambient point. Holotope reports that distinction instead of inventing an
inverse.

## Package responsibilities

| Package | Owns | Does not own |
| --- | --- | --- |
| `@holotope/core` | Float64 N-D math, topology, exact constructions, source references, transformations, projections, slices, fields, spectral and coupling kernels | Three.js objects, GPU state, time integration |
| `@holotope/physics` | Headless R4 rigid bodies, mass properties, collision/query kernels, rigid constraints, and separate RN XPBD point systems | Rendering, implicit automatic conversion from a mesh to a simulation |
| `@holotope/three` | Three.js render products, WebGPU fast paths, pointer-driven visual R4 rotation, and conversion of Three ray hits into source-aware results | Authoritative geometry or physics state |

`@holotope/three` has `three` as a peer dependency. Its products are ordinary
`Object3D` instances: add `product.object` to a normal Three scene and keep
calling `product.update(...)` from your animation loop.

## The three common pipelines

### Geometry → observation

Use this for a static or procedurally transformed object.

1. Build a `CellComplex` in `R^N`.
2. Create a `TransformN` if the source moves or rotates.
3. Choose a `PerspectiveProjection`, `CoordinateProjection`, or
   `HyperplaneSlice4`.
4. Create render products and call `update(transform)` each frame.

A projection is a shadow-like map and may be ambiguous. A slice is an exact
cross-section, represented in its own 3D in-plane chart.

### R4 rigid body → observation

Use this for a compact ballistic body.

1. Derive R4 mass properties from a valid tetrahedralized boundary.
2. Create a `RigidBody4` and add it to `PhysicsWorld4`.
3. After `world.step(dt)`, form `new TransformN(4, body.rotation, body.position)`.
4. Feed that transform to every render product of the body.

`PhysicsWorld4` provides force, torque, gravity, and pose integration. It is
not a one-call all-shapes collision world; contact policies are deliberately
explicit through its velocity-constraint callback and the contact pipeline
APIs. This keeps capability and approximation boundaries visible.

### Pick → source evidence → controlled edit

Use a Three `Raycaster` against a Holotope render product, then call its
matching `representationHitFrom…` function. The result identifies the source
cell and reports whether an exact ambient point is available. Treat the source
cell reference as the stable identity; use an ambient point only when
`ambientPointStatus === 'exact'`.

When a product was updated with a transform, a lifted ambient point is in that
transformed R4 frame. Apply the same transform's inverse only if the next
operation specifically needs the complex's body-local coordinates.

## Coordinate conventions worth memorizing

- `VecN` coordinates are in ordinary source-axis order. In R4: `[x, y, z, w]`.
- `BivectorN` has `n(n-1)/2` plane coefficients. In R4 their order is
  `[01, 02, 03, 12, 13, 23]`, equivalently `[xy, xz, xw, yz, yw, zw]`.
- `HyperplaneSlice4.axisAligned(3, offset)` means the `w = offset` slice.
  Axis indices are `0=x`, `1=y`, `2=z`, `3=w`.
- `CoordinateProjection({ fromDim: 4, axes: [0, 1, 3] })` is an exact XYW
  coordinate view; it is not a perspective camera.

## Exactness and performance

The normal development path is an auditable Float64 CPU implementation in
`core` or `physics`, with dimensional checks and explicit degeneracy policies.
Some `@holotope/three/webgpu` products accelerate rendering or field
evaluation, but they do not replace the source-space CPU contract. Use a GPU
product when it exists for your operation; retain the CPU path for validation,
picking policy, or scientific evidence.

## Before writing an application

Decide these four things explicitly:

1. What is authoritative: a `CellComplex`, a field, a rigid body pose, or an
   RN particle world?
2. Is the desired view a projection, a coordinate view, or an exact slice?
3. Does the interaction need a source cell, an exact ambient point, or a
   deliberately chosen inverse/least-squares policy?
4. Is the result visual manipulation, physical motion, or source editing?

Those choices prevent the most common category error: treating a rendered 3D
representation as though it were the higher-dimensional object itself.
