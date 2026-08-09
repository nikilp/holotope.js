# The Holotope mental model

Holotope is not a 3D renderer with an extra coordinate hidden in a material.
It keeps an authoritative state in $\mathbb{R}^N$, then makes every lower-dimensional
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

Optional declarative entry:

ExperimentDocumentV0                              @holotope/experiment
              │ explicit compiler capabilities
              ├── core source + representation maps
              └── rigid model                    @holotope/experiment-physics
                         │
                         └── the same objects and render products shown above
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
| `@holotope/experiment` | Inert versioned documents, validation, canonical identity, explicit-capability compilation, parameters, actions, observations, snapshots, traces, and replay | Physics implementation, rendering, dynamic package loading |
| `@holotope/experiment-physics` | The explicit capability that compiles `physics.model.rigid4` descriptors into the public physics runtime | Core geometry construction, presentation, an implicit global compiler registry |

`@holotope/three` has `three` as a peer dependency. Its products are ordinary
`Object3D` instances: add `product.object` to a normal Three scene and keep
calling `product.update(...)` from your animation loop.

Experiment documents are an optional reproducibility layer, not a second
engine. Their explicit compiler capabilities produce the same `CellComplex`,
projection/slice, and physics objects a direct caller constructs. Presentation
remains renderer-owned: a document can declare a representation, but a Three.js
adapter still decides how that map is drawn and how a real ray intersection is
converted into source evidence.

## The three common pipelines

### Geometry → observation

Use this for a static or procedurally transformed object.

1. Build a `CellComplex` in $\mathbb{R}^N$.
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

### Experiment document → the same live pipeline

Use a document when the scenario itself should be validated, hashed, replayed,
or passed between tools without embedding executable code.

1. Author a typed `ExperimentDocumentV0`.
2. Call `prepareExperimentDocumentV0()` to validate, canonicalize, hash, copy,
   and freeze it.
3. Call `compileExperimentDocumentV0()` with explicit capabilities such as
   `coreExperimentCompilerV0()` and `physicsExperimentCompilerV0()`.
4. Retrieve the compiled source, model, and representation maps by id.
5. Give those maps and the authoritative source to ordinary Three.js products;
   advance, parameterize, snapshot, and reset through the compilation.

Nothing in the document chooses code by name or loads a package. The host
supplies every compiler capability, and the compiled registry refuses a kind
that no supplied capability honestly serves.

### Pick → source evidence → controlled edit

Use a Three `Raycaster` against a Holotope render product, then call its
matching `representationHitFrom…` function. The result answers three
independent questions, and reading only one of them is the usual mistake:

| Question | Field |
| --- | --- |
| which source primitive produced this? | `source` |
| is the lifted point exact on that primitive? | `ambientPointStatus` |
| is that point unique under the map? | `ambiguity` |

Treat the source cell reference as the stable identity. `ambientPointStatus:
'exact'` is exact *relative to the primitive the ray selected* — a projected
triangle routinely reports it while `ambiguity` is `'projection-overlap'`,
because the complete projection is many-to-one. Present a point as **the**
source point only when `ambiguity === 'none'`; otherwise say which primitive it
is conditional on.

When a product was updated with a transform, a lifted ambient point is in that
transformed R4 frame. Apply the same transform's inverse only if the next
operation specifically needs the complex's body-local coordinates.

## Reading a `CellComplex`

A `CellComplex` is flat positions plus indexed cell groups, and callers reach
for it constantly, so the whole surface is worth stating.

```ts
import { createHypercube } from '@holotope/core';

const complex = createHypercube({ dim: 4, size: 2, maxCellDimension: 3 });
const index = 0;

complex.ambientDim;        // 4 for an R4 source
complex.vertexCount;       // number of vertices
complex.positions;         // Float64Array, ambientDim numbers per vertex
complex.groups;            // every CellGroup, all dimensions
complex.cellsOfDim(3);     // the groups of one dimension
complex.cellCount(3);      // cells across those groups
complex.getPosition(index) // one vertex
```

A `CellGroup` is a plain record: `{ dim, verticesPerCell, kind, indices, key? }`,
where `kind` is `'simplex'`, `'cuboid'`, or `'polygon'`, and `indices` is a flat
`Uint32Array` of `verticesPerCell` vertex indices per cell.

Two things that surprise first-time callers, both worth knowing before you write
against this:

- **A group carries no cell count.** There is no `group.count`. The number of
  cells is `group.indices.length / group.verticesPerCell`.
- **`getPosition` returns a bare `Float64Array`, not a `VecN`.** Ambient points
  recovered from a pick are `VecN` and are read through `.data`; a raw vertex
  position is already the array. The two conventions sit next to each other and
  are not interchangeable.

### `tetrahedralizeCuboidCells` adds, it does not replace

It appends a simplex 3-cell group and **keeps the cuboid group**. After calling
it on a tesseract, `cellsOfDim(3)` holds both: eight cuboid cells and the 48
tetrahedra cut from them. A caller expecting the cuboid cells to be gone will
mis-count, and one expecting the parent map to survive will not find it — the
wrapper drops `sourceCellIndices`, which is what
[the cookbook's parent-cell recipe](/learn/cookbook) exists to recover.

## Coordinate conventions worth memorizing

- `VecN` coordinates are in ordinary source-axis order. In R4: `[x, y, z, w]`.
- `BivectorN` has `n(n-1)/2` plane coefficients. In R4 their order is
  `[01, 02, 03, 12, 13, 23]`, equivalently `[xy, xz, xw, yz, yw, zw]`.
- `HyperplaneSlice4.axisAligned(3, offset)` means the `w = offset` slice.
  Axis indices are `0=x`, `1=y`, `2=z`, `3=w`.
- `HyperplaneSliceN.axisAligned(ambientDim, hiddenAxis, offset)` is the same
  idea in any dimension, and takes `ambientDim` first because there is no
  normal to infer it from. Its `signedDistance` takes one array, where the R4
  class takes four scalars — a different signature on a different class, not a
  change to the old one.
- A **section** is an intersection and a **projection** is a many-to-one map.
  Both lose information, but not the same information: a projection loses
  distinctness, so a pixel may not name a source point; a section loses
  dimension, and every point it keeps names exactly one source point.
- An **embedding** loses nothing. `PlaneEmbedding3D` places R2 content into
  display R3 as `[x, y] → [x, y, 0]`, injectively: every image point has
  exactly one preimage, recovered by `invertPoint` or refused by typed
  off-image status for `z ≠ 0`. It is not a projection and has no fibre —
  there is nothing collapsed to disclose. What render products consume is the
  common supertype `DisplayMap3D`; only genuinely lossy maps are
  `Projection`s. A Float32 pick on an embedded image still inverts to an
  *approximate* point: injectivity makes the inverse of the exact image
  unique, not the observation exact.
- `CoordinateProjection({ fromDim: 4, axes: [0, 1, 3] })` is an exact XYW
  coordinate view; it is not a perspective camera.
- `createHypercube`'s `size` is the **edge length**, and the body is centred on
  the origin — so `size: 2` puts vertices at `±1`, and `size: 3` at `±1.5`. The
  default is `1`. Nothing in the library assumes the `size: 2` case that most
  examples use; code that compares a coordinate against a literal `1` does.

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
2. Is the desired view a projection, a coordinate view, an exact slice, or —
   for content already at display dimension or below — an embedding?
3. Does the interaction need a source cell, an exact ambient point, or a
   deliberately chosen inverse/least-squares policy?
4. Is the result visual manipulation, physical motion, or source editing?

Those choices prevent the most common category error: treating a rendered 3D
representation as though it were the higher-dimensional object itself.
