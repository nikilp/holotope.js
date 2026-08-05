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

// Rendering-only path: this supplies the tetrahedral 3-cells a section needs
// and drops `sourceCellIndices`, so a pick can name the cut tetrahedron but not
// the cuboid it came from. If the application must report the parent cell,
// build the simplices with `simplexizeCuboidGroupN` and keep that map.
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

Those two products do **not** share a coordinate system. A projection maps R4
into its own 3D output; a section is expressed in the cutting hyperplane's own
display frame. Adding both to one scene, as above, shows two honest views that
happen to sit in different local frames.

At `offset: 0` they coincide, which is why the snippet looks right — the
perspective scale at `w = 0` is exactly 1. Sweep the offset and they separate:
at `w = 0.5` the section is 14% wider through the projection than in its own
frame, and at `w = 0.9` it is 29% wider.

So pick one deliberately:

- **separate views** — keep them in different `Group`s or different parts of
  the scene, and let each speak in its own frame;
- **one overlay** — pass the projection to the section so both land in the same
  space:

```ts
import {
  HyperplaneSlice4,
  PerspectiveProjection,
  createHypercube,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import { SlicedComplex3D } from '@holotope/three';

const cut = tetrahedralizeCuboidCells(createHypercube({ dim: 4, size: 2 }));
const shared = new PerspectiveProjection({ fromDim: 4, viewDistance: 4 });

const overlaid = new SlicedComplex3D(
  cut,
  HyperplaneSlice4.axisAligned(3, 0.5),
  { projection: shared }
);
```

See it running in the [tesseract demo](https://nikilp.github.io/holotope.js/tesseract.html),
which does both — a section in its own frame and a second one overlaid inside
the wireframe — or read its
[full source](https://github.com/nikilp/holotope.js/blob/main/examples/showcase/src/tesseract.ts).

Setting the section material to `wireframe: true` exposes the triangle soup
produced by marching tetrahedra, including coplanar subdivision edges. It is
useful for inspecting the algorithm, but it is not a clean outline of the
section. For a presentation outline, derive a Three.js `EdgesGeometry` from
only the active `triangleCount * 3` vertices; the product's backing buffer is
larger than its current draw range and may contain vertices from an earlier
cut. The result is a floating-point crease visualization, not additional exact
source topology.

## Author a small cell complex from literals

`CellComplex` is itself the strict authoring boundary; a factory is not
required. Flatten vertex coordinates and each homogeneous cell group
explicitly so ambient dimension, cell dimension, arity, and interpretation
remain visible and independently validated.

```ts
import { CellComplex } from '@holotope/core';

const vertices = [
  [0, 0, 0, 0],
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0]
];
const edges = [
  [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]
];

const authored = new CellComplex(
  4,
  Float64Array.from(vertices.flat()),
  [{
    key: 'tetrahedron-edges',
    dim: 1,
    kind: 'simplex',
    verticesPerCell: 2,
    indices: Uint32Array.from(edges.flat())
  }]
);
```

The constructor retains the typed arrays rather than copying them: mutating
`authored.positions` is an explicit source-geometry edit. It validates every
index immediately. It does not infer missing edges or faces from higher cells;
that topological derivation needs an explicit policy and remains a separate
operation.

## Compile a whole scene from one document

When a scenario should be reproducible — the same body, motion, and views every
time, with an identity you can hash — declare it once and compile it, rather
than constructing the pieces separately and keeping them in agreement by hand.

```ts
import {
  compileExperimentDocumentV0,
  coreExperimentCompilerV0,
  prepareExperimentDocumentV0
} from '@holotope/experiment';

const preparedScene = await prepareExperimentDocumentV0({
  schema: 'holotope.experiment/0',
  title: 'Tesseract section',
  ambientDim: 4,
  sources: {
    body: { kind: 'core.source.hypercube', dim: 4, size: 2, tetrahedralize: true }
  },
  representations: {
    cut: {
      kind: 'core.representation.section4',
      source: 'body',
      normal: [0, 0, 0, 1],
      offset: 0,
      frame: 'canonical'
    }
  }
});
if (preparedScene.ok) {
  const compiledScene = compileExperimentDocumentV0(preparedScene.value, {
    compilers: [coreExperimentCompilerV0()]
  });
  log(compiledScene.ok);
}
```

The compiled registry hands back the same `CellComplex` and slice objects a
direct caller builds, so every recipe on this page still applies to them.
[Build a dimension bridge](/learn/source-retained-dimension-bridge) walks the
complete pipeline through to render products and picking.

## Sweep and reorient a 4D slice

Changing `offset` moves the same affine plane. `setNormal()` changes its
orientation and updates the slice display frame in place, so the existing
`SlicedComplex3D` can be retained.

```ts
import {
  HyperplaneSlice4,
  TransformN,
  cellComplexBoundsAlongDirectionN,
  createHypercube,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import { SlicedComplex3D } from '@holotope/three';

const complex = tetrahedralizeCuboidCells(createHypercube({ dim: 4, size: 2 }));
const slice = HyperplaneSlice4.axisAligned(3, 0); // w = 0 initially
const section = new SlicedComplex3D(complex, slice);

function updateSlice(timeSeconds: number, transform: TransformN) {
  slice.setNormal([0.2 * Math.sin(timeSeconds * 0.3), 0, 0, 1]);
  const range = cellComplexBoundsAlongDirectionN(complex, slice.normal, transform);
  const requestedOffset = 0.85 * Math.sin(timeSeconds * 0.7);
  slice.offset = Math.max(range.min, Math.min(range.max, requestedOffset));
  section.update(transform);
}
```

The default `continuous` frame policy is load-bearing when `setNormal()` runs
over time: it transports the preceding display basis so the section does not
snap between equally valid coordinate frames. Request `frame: 'canonical'`
when each normal must independently reproduce the same axis-derived frame,
such as document reconstruction or a stateless comparison.

The returned interval bounds the transformed vertex hull. A disconnected or
non-convex source can still have empty cuts inside it; the helper prevents the
universal and confusing case where a slider moves beyond the entire source.
For an axis-aligned scan, omit `setNormal()` and animate only `offset`.
`axisAligned(3, offset)` is a W scan; it does not animate a camera.

A Cartesian-product source has a correspondingly repetitive scan. In
particular, an axis-aligned 4-orthotope is a 3-box times an interval, so every
interior cut orthogonal to that interval is the same 3-box. Prefer a simplex,
cross-polytope, or another non-product source when changing section geometry is
the subject of the visualization.

## Add visual 4D rotation from pointer drag

Use `DragRotation4D` for inspection. It maps pointer deltas to a `Rotor4` in
chosen coordinate planes; it does not apply a physical torque.

```ts
import {
  HyperplaneSlice4,
  PerspectiveProjection,
  TransformN,
  createHypercube,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import { DragRotation4D, ProjectedEdges3D, SlicedComplex3D } from '@holotope/three';

const complex = tetrahedralizeCuboidCells(createHypercube({ dim: 4, size: 2 }));
const shadow = new ProjectedEdges3D(
  complex,
  new PerspectiveProjection({ fromDim: 4, viewDistance: 4 })
);
const section = new SlicedComplex3D(complex, HyperplaneSlice4.axisAligned(3, 0));

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
import {
  PerspectiveProjection,
  TransformN,
  createHypercube,
  describeRepresentationHitN,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import {
  ProjectedSurface3D,
  representationHitFromProjectedSurface
} from '@holotope/three';

const complex = tetrahedralizeCuboidCells(createHypercube({ dim: 4, size: 2 }));
const bodyTransform = TransformN.identity(4);
const surface = new ProjectedSurface3D(
  complex,
  new PerspectiveProjection({ fromDim: 4, viewDistance: 4 })
);
surface.update(bodyTransform);

const intersections = raycaster.intersectObject(surface.object, false);
const intersection = intersections.find((value) => value.faceIndex != null);

if (intersection?.faceIndex != null) {
  // A Three Intersection is structurally accepted as-is.
  const hit = representationHitFromProjectedSurface(surface, intersection);
  const report = describeRepresentationHitN(hit);

  // `source` is a union; the cell variant is the one that carries an id.
  if (report.source.kind === 'cell') {
    console.log(report.source.id); // stable source-cell identity
  }

  // Branch on the claim rather than combining precision and uniqueness by
  // hand: a projected pick reports `ambientPointStatus: 'exact'` while its
  // `ambiguity` is `'projection-overlap'`, and reading only the first is the
  // mistake this shape removes.
  const ambient = report.ambient;
  if (ambient.claim === 'unavailable') {
    console.log('identity only', ambient.ambiguity);
  } else {
    const inBodyLocalR4 = bodyTransform.inverse().applyToPoint(ambient.point);
    if (ambient.claim === 'unique') {
      console.log(inBodyLocalR4.data); // safe to present as the source point
    } else {
      // Exact on the triangle the ray selected, not unique under the
      // projection. Report it against that primitive or not at all.
      console.log(inBodyLocalR4.data, ambient.ambiguity, report.source.kind);
    }
  }
}
```

The inverse is appropriate only when `surface.update(bodyTransform)` supplied
that transformed frame. If you called `surface.update()` without a transform,
the exact ambient point is already in complex-local coordinates. For a
projected slice or an unsupported projection, expect source identity without
an exact ambient point.

## Name the parent cell a section triangle came from

`tetrahedralizeCuboidCells` gives a sliceable complex but drops the map from
each tetrahedron back to the cuboid cell it came from. When a pick must name the
parent cell, build the simplices with `simplexizeCuboidGroupN` and keep that
map.

```ts
import { createHypercube, simplexizeCuboidGroupN } from '@holotope/core';

const complex = createHypercube({ dim: 4, size: 2 });
const cubes = complex.cellsOfDim(3).find((group) => group.kind === 'cuboid');
if (cubes === undefined) throw new Error('no cuboid 3-cells');

const simplexization = simplexizeCuboidGroupN(cubes);
complex.addGroup(simplexization.simplexGroup);

// Parallel arrays, indexed by output-simplex ordinal:
simplexization.sourceCellIndices;   // Uint32Array: which cuboid cell
simplexization.permutationIndices;  // Uint32Array: which Kuhn permutation
simplexization.simplicesPerCell;    // 6 for a 3-cuboid
simplexization.sourceCellCount;     // 8 for a tesseract

// The ordinal a section pick reported; any tetrahedron index works here.
const tetrahedronIndex = 17;
const parentCell = simplexization.sourceCellIndices[tetrahedronIndex];
```

The ordering is the same one `tetrahedralizeCuboidCells` produces, so a
tetrahedron ordinal from a section pick indexes straight into
`sourceCellIndices`.

## Name the facet a cubic cell lies on

Cells carry no facet metadata: a `CellGroup` is positions plus indices, and
`createHypercube` records nothing about which side a cell came from. The facet
is recoverable from the geometry, because a cuboid cell of a hypercube lies on
the hyperplane where one coordinate is constant — and `cuboidCellFacetN` does
that recovery:

```ts
import { createHypercube, cuboidCellFacetN } from '@holotope/core';

const complex = createHypercube({ dim: 4, size: 2, maxCellDimension: 3 });
const cubes = complex.cellsOfDim(3).find((group) => group.kind === 'cuboid')!;

const facet = cuboidCellFacetN(complex, cubes, 0);
// { axis: 3, sign: -1, coordinate: -1 }  — the w = -1 facet
```

Do not hand-roll this from coordinates. The two obvious shortcuts are both
wrong in ways that stay silent:

- comparing a coordinate against a literal `±1` assumes `size: 2`, and names no
  facet at all for any other size;
- taking `Math.sign` of the coordinate assumes the body is centred on the
  origin, and gives every cell the same sign once it is translated clear of it.

`sign` is resolved against the complex's own extent along the axis, so it
survives both. `null` comes back when the cell lies on no single facet.

Facet order is a contract, not an accident: cubic cells enumerate axis triples
`a < b < c` lexicographically, so the omitted axis — the facet normal —
descends, and the low side precedes the high one. A tesseract gives
`3:- 3:+ 2:- 2:+ 1:- 1:+ 0:- 0:+`.

## Ask whether a section is empty

A cut past the body's extent emits nothing. `SlicedComplex3D.triangleCount` is
an accessor, not a method, and it is the direct answer:

::: warning The two extremes do not agree
A cut exactly *at* the extent is empty at the minimum and non-empty at the
maximum. For a `size: 2` tesseract, `w = -1` emits nothing and `w = +1` emits a
full section.

This is the slicer's tie-break, not a bug. Signed distances within `epsilon`
snap to zero and count as **non-negative**, so a vertex lying on the plane is
treated as above it. At the maximum some vertices then fall below the plane and
the cut emits; at the minimum nothing is below it. The convention is what makes
on-plane vertices interpolate exactly to themselves and stops a cell lying
wholly in the hyperplane from being emitted twice.

Do not correct it into symmetry. If you need a symmetric rule, compare the
offset against the extent yourself before cutting.
:::

```ts
import {
  HyperplaneSlice4,
  TransformN,
  createHypercube,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import { SlicedComplex3D } from '@holotope/three';

const complex = tetrahedralizeCuboidCells(createHypercube({ dim: 4, size: 2 }));
const section = new SlicedComplex3D(
  complex,
  HyperplaneSlice4.axisAligned(3, 0.5)
);
section.update(TransformN.identity(4));
const empty = section.triangleCount === 0; // false at w = 0.5
```

Without a render product, slice the tetrahedra yourself. Size the output buffer
for the worst case: one tetrahedron can emit two triangles, so six vertices.

Both slicers take the same trailing parameters, and their buffer sizes are
worst-case per source tetrahedron. With `tetCount = tets.length / 4`:

| parameter | default | size |
| --- | --- | --- |
| `epsilon` | `1e-9` | snapping distance for the on-plane tie-break above |
| `outPositions` | — | `tetCount * 18` chart floats; `tetCount * 24` ambient |
| `outProvenance` | — | `tetCount * 2` — the source tetra index per triangle |
| `outVertexProvenance.edgeVertices` | — | `tetCount * 12` — two endpoints per vertex |
| `outVertexProvenance.edgeParameters` | — | `tetCount * 6` — one interpolation parameter per vertex |

Undersized buffers throw rather than truncate.

```ts
import {
  HyperplaneSlice4,
  createHypercube,
  sliceTetrahedra,
  sliceTetrahedraAmbient,
  tetrahedralizeCuboidCells
} from '@holotope/core';

const complex = tetrahedralizeCuboidCells(createHypercube({ dim: 4, size: 2 }));
const slice = HyperplaneSlice4.axisAligned(3, 0.5);

const tets = complex.cellsOfDim(3)
  .find((group) => group.kind === 'simplex' && group.verticesPerCell === 4)!;
const tetCount = tets.indices.length / 4;

// Chart coordinates: 3 numbers per emitted vertex.
const chart = new Float32Array(tetCount * 6 * 3);
const chartVertices = sliceTetrahedra(
  complex.positions, tets.indices, slice, chart
);

// Ambient R4 coordinates: 4 numbers per emitted vertex.
const ambient = new Float64Array(tetCount * 6 * 4);
const ambientVertices = sliceTetrahedraAmbient(
  complex.positions, tets.indices, slice, ambient
);
```

Both return the number of vertices written, so an empty section returns `0`.

## Move one ambient point between a slice and its chart

An ambient point does not necessarily lie on the slice. Preserve that fact
when expressing it in the slice's 3D frame:

```ts
import { HyperplaneSlice4 } from '@holotope/core';

const slice = new HyperplaneSlice4({
  normal: [1, -2, 0.5, 3],
  offset: 0.2
});
const observation = slice.projectPointToChart([0.4, -0.1, 0.7, 0.3]);

observation.coordinates;  // orthogonal projection in the slice display frame
observation.signedDistance; // zero only when the R4 point belongs to the slice

const projectedR4 = slice.embedPoint(observation.coordinates);
```

Do not describe `projectedR4` as the original point unless
`signedDistance === 0` within an authored tolerance. For source-linked section
highlighting, `section.facesOfSourceTet(tetIndex)` gives the current rendered
faces of one known source tetrahedron; it returns an empty array when that cell
does not intersect the present cut.

## Section a simplicial complex with an arbitrary RN hyperplane

Marching tetrahedra is the R4 specialization. For any ambient dimension, build
the chart with `HyperplaneSliceN` and cut a simplicial group with
`sectionSimplexGroupN`. Two things the result carries are worth reading before
you use it: `diagnostics`, which distinguishes "the plane missed this complex"
from "cells were suppressed because they lie in it", and `lineage`, which names
the **original** source vertices each output vertex is an affine combination of.

```ts
import { CellComplex, HyperplaneSliceN, sectionSimplexGroupN } from '@holotope/core';

// One tetrahedron in R5, straddling the x4 = 0 hyperplane.
const positions = Float64Array.from([
  0, 0, 0, 0, -1,
  2, 0, 0, 0, 1,
  0, 2, 0, 0, 1,
  0, 0, 2, 0, 1
]);
const complex = new CellComplex(5, positions, [
  { dim: 3, verticesPerCell: 4, kind: 'simplex', indices: Uint32Array.from([0, 1, 2, 3]) }
]);
const group = complex.groups[0];
if (group === undefined) throw new Error('expected one simplicial group');

const slice = HyperplaneSliceN.axisAligned(5, 4, 0);
const section = sectionSimplexGroupN({ complex, group, slice });

section.cellDim; // 2 — a 3-simplex cut by a hyperplane is a surface
section.chartDim; // 4 — the chart of a hyperplane in R5
section.diagnostics.sectionedCells; // 1, so the result is not empty by accident
section.diagnostics.suppressedOnPlaneCells; // 0 — nothing was silently dropped

// Ancestry: vertex 0 is a blend of original source vertices.
const from = section.lineage.offsets[0] ?? 0;
const to = section.lineage.offsets[1] ?? 0;
Array.from(section.lineage.sourceVertices.subarray(from, to)); // e.g. [0, 1]
```

Non-simplicial groups are refused rather than triangulated implicitly — run
`simplexizeCuboidGroupN` first, which returns the source-cell mapping you need
to keep provenance. Chart coordinates depend on the slice's frame policy, so
compare ambient positions, not chart coordinates, when checking two sections
against each other. To chain, pass the previous result's `lineage` into the next
call: `sectionSimplexGroupN({ ..., lineage: section.lineage })` keeps the second
cut's ancestry expressed in the first complex's original vertices.

## Pick headlessly, with no renderer

Picking needs geometry and a ray, not a canvas. A render product builds its
`BufferGeometry` on `update()`, so a `Raycaster` works in Node with no
`WebGLRenderer` anywhere — useful for tests, for verification, and for
answering provenance questions in a script.

```ts
import { PerspectiveCamera, Raycaster, Vector2 } from 'three';
import {
  HyperplaneSlice4,
  TransformN,
  createHypercube,
  describeRepresentationHitN,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import { SlicedComplex3D, representationHitFromSlicedComplex } from '@holotope/three';

const complex = tetrahedralizeCuboidCells(createHypercube({ dim: 4, size: 2 }));
const slice = HyperplaneSlice4.axisAligned(3, 0);

const section = new SlicedComplex3D(complex, slice);
section.update(TransformN.identity(4)); // builds the geometry a ray can meet

const camera = new PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(0, 0, 8);
camera.lookAt(0, 0, 0);

const raycaster = new Raycaster();
raycaster.setFromCamera(new Vector2(0, 0), camera);

const [intersection] = raycaster.intersectObject(section.object, false);
if (intersection !== undefined) {
  const report = describeRepresentationHitN(
    representationHitFromSlicedComplex(section, intersection)
  );
  report.ambient.claim; // 'unique' for an unprojected section
}
```

`section.object` is an ordinary `Mesh`, so nothing else is required. See
[what a pick may claim](/learn/representation-claims) for reading the result.

## Apply a world-space R4 impulse or angular velocity

`RigidBody4` is headless. Advance it in `PhysicsWorld4`, then pass its pose to
render products through `TransformN`.

```ts
import {
  BivectorN,
  PerspectiveProjection,
  TransformN,
  createHypercube,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import { PhysicsWorld4, RigidBody4 } from '@holotope/physics';
import { ProjectedSurface3D } from '@holotope/three';

const complex = tetrahedralizeCuboidCells(createHypercube({ dim: 4, size: 2 }));
const surface = new ProjectedSurface3D(
  complex,
  new PerspectiveProjection({ fromDim: 4, viewDistance: 4 })
);

const body = new RigidBody4({
  mass: 1,
  // Six plane inertias, in [xy, xz, xw, yz, yw, zw] order.
  inertiaDiagonal: [1, 1, 1, 1, 1, 1],
  position: [0, 2, 0, 0]
});

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
surface.update(pose); // every render product of this body takes the same pose
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
`PhysicsWorld4`. Compose the named contact pipeline explicitly while the
automatic convenience layer remains under development.

<!-- doc-check: sequential -->

The recipes below are one pipeline rather than independent entries: each stage
consumes the previous stage's product, so read them in order.

## Set up the deformable pipeline

Every stage below builds on this: a tetrahedralized source, its simplex group,
the particle binding that carries the degrees of freedom, and the world they
are stepped in.

```ts
import {
  createHypercube,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import {
  XpbdWorldN,
  compileXpbdParticleBindingN,
  type XpbdConservativeForceProviderN
} from '@holotope/physics';

const source = tetrahedralizeCuboidCells(
  createHypercube({ dim: 4, size: 1, maxCellDimension: 3 })
);
const simplexGroup = source
  .cellsOfDim(3)
  .find((group) => group.kind === 'simplex' && group.verticesPerCell === 4)!;

const binding = compileXpbdParticleBindingN({
  id: 'tesseract-points',
  source,
  mass: 1,
  fixed: ({ sourceVertexIndex }) => sourceVertexIndex === 0
});

const world = binding.addToWorld(new XpbdWorldN({
  dimension: 4,
  gravity: [0, -9.81, 0, 0],
  solverIterations: 12
}));

// A contact barrier provider. The objective and search stages use one before
// this page reaches "Compile barriers for every bound source vertex", which is
// where it is built; it is declared here so those stages read in order.
declare const barrier: XpbdConservativeForceProviderN;

// A trial configuration the objective is evaluated at: one position per
// particle, in the same order.
const candidatePositions = binding.particles.map((p) => p.position);
```

## Rest dynamic points against one static convex support

When an obstacle's cells merely decompose one solid, do not sum per-cell
barriers — each cell pushes away from itself, so the sum acquires a
decomposition-dependent tangential force. Compile the convex-hull family
instead: its `sourceGroup` cells **select vertices**, and the represented set
is their convex hull, answered by one certified closest-point query per bound
particle.

```ts
import { CellComplex } from '@holotope/core';
import {
  XpbdPotentialDomainErrorN,
  compileXpbdParticleBindingN,
  compileXpbdParticleSourceConvexHullBarrierFamilyN
} from '@holotope/physics';

// A flat rectangular support in R3, cut into two triangles. The cut is
// irrelevant to contact: only the four corner vertices define the hull.
const support = new CellComplex(3, Float64Array.from([
  0, 0, 0, 2, 0, 0, 0, 2, 0, 2, 2, 0
]), [{
  key: 'support', dim: 2, verticesPerCell: 3, kind: 'simplex',
  indices: Uint32Array.from([0, 1, 2, 1, 3, 2])
}]);

const probes = new CellComplex(3, Float64Array.from([
  0.5, 0.5, 0.4, 1.5, 1.2, 0.7
]), [{
  key: 'probes', dim: 0, verticesPerCell: 1, kind: 'simplex',
  indices: Uint32Array.from([0, 1])
}]);
const binding = compileXpbdParticleBindingN({
  id: 'probes', source: probes, mass: 1
});

const contact = compileXpbdParticleSourceConvexHullBarrierFamilyN({
  id: 'support-contact',
  binding,
  obstacle: support,
  sourceGroup: support.groups[0]!,
  minimumDistance: 0.05,
  activationDistance: 0.8,
  stiffness: 2
});

// One certified query per particle; the witness names the source vertices
// behind each closest point, and interior pushes are exactly normal.
const evaluation = contact.evaluate();
for (const record of evaluation.activeBarriers) {
  record.distance;                   // unsigned distance to the hull
  record.witness.sourceVertices;     // authoritative support vertices
  record.witness.separationNormal;   // unit direction the barrier pushes
}

// An undecided query is a typed refusal, not an answer. Starving the query
// budget forces one, and nothing is mutated on the way out.
try {
  compileXpbdParticleSourceConvexHullBarrierFamilyN({
    id: 'starved', binding, obstacle: support,
    sourceGroup: support.groups[0]!,
    minimumDistance: 0.05, activationDistance: 0.8, stiffness: 2,
    maximumQueryIterations: 1
  }).evaluate();
} catch (error) {
  if (error instanceof XpbdPotentialDomainErrorN) {
    error.reason; // 'closest-point-indeterminate'
  }
}

// The paired filter travels with the provider into any solve:
// ...contact.incrementalPotentialTerms() spreads both.
```

The set is the **hull**: concavities between the selected vertices are filled,
so a non-convex obstacle needs explicitly managed convex pieces. The hull is
**static** — moved source coordinates are refused, never silently followed —
and proximity to a lower-dimensional hull is unsigned and two-sided.

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

## Evaluate material energy at a trial configuration

Use a candidate-state evaluation when an optimizer, parameter study, or
diagnostic must inspect positions without editing the live world. Providers
may share particles; assembly follows object identity rather than list order.

```ts
import { evaluateXpbdPotentialStateN } from '@holotope/physics';

// Perturb one vertex along w. `VecN.data` is a Float64Array, so an indexed
// read is `number | undefined` under the strictness this library compiles
// with; bind the vector once rather than asserting twice.
const selectedVertex = 1;
const candidate = binding.particles.map((particle) => particle.position.clone());
const moved = candidate[selectedVertex]!;
moved.data[3] = moved.data[3]! + 0.1;

const trial = evaluateXpbdPotentialStateN({
  dimension: 4,
  particles: binding.particles,
  positions: candidate,
  providers: [material, barrier]
});

console.log(trial.potentialEnergy, trial.gradientNorm);
```

The returned vectors are `dU/dx`; conservative provider forces use the
opposite sign. Live position, velocity, and force buffers remain unchanged.
This evaluates an objective only—it is not a time step or line search.

## Build an inertial-plus-material objective

Use the incremental objective when an optimization time step needs inertia and
the composed conservative energy in one auditable evaluation.

```ts
import {
  evaluateXpbdIncrementalPotentialN,
  predictXpbdInertialStateN
} from '@holotope/physics';

const prediction = predictXpbdInertialStateN({
  dimension: 4,
  particles: binding.particles,
  deltaTime: 1 / 60,
  gravity: [0, -9.81, 0, 0]
});

const trial = evaluateXpbdIncrementalPotentialN({
  dimension: 4,
  particles: binding.particles,
  positions: prediction.positions,
  predictedPositions: prediction.positions,
  deltaTime: prediction.deltaTime,
  providers: [material, barrier]
});

console.log(trial.objective, trial.gradientNorm);
```

The predictor consumes accumulated particle forces as explicit forces and
leaves conservative provider forces for implicit evaluation through their
energies. A fixed particle's candidate must equal its prediction. The nested
`trial.potential` retains its reaction gradient even though the top-level
free-coordinate gradient is zero.

This constructs neither a Hessian nor a solver. A future optimizer can call
the same evaluator for every accepted or rejected line-search candidate.

## Pack free coordinates and backtrack a descent direction

Compile one stable solver view after particles, inverse masses, predictions,
and conservative providers are known:

```ts
import {
  compileXpbdIncrementalPotentialProblemN,
  searchXpbdIncrementalPotentialArmijoN
} from '@holotope/physics';

const problem = compileXpbdIncrementalPotentialProblemN({
  dimension: 4,
  particles: binding.particles,
  predictedPositions: prediction.positions,
  deltaTime: prediction.deltaTime,
  providers: [material, barrier]
});

const coordinates = problem.packPositions(candidatePositions);
const base = problem.evaluate(coordinates);
const direction = Float64Array.from(base.gradient, (value) => -value);
const search = searchXpbdIncrementalPotentialArmijoN({
  problem,
  coordinates,
  direction
});

if (search.status === 'accepted') {
  const acceptedPositions = search.accepted.positions;
  console.log(search.stepLength, search.accepted.objective);
}
```

Packing follows authored particle order and excludes fixed particles. The
Armijo search records every attempted step. Typed constitutive-domain
refusals backtrack; unrelated errors are rethrown. Neither compilation nor an
accepted result changes live particle position, velocity, force, or mass.

## Keep a point–plane barrier search inside its open domain

Pair the conservative barrier provider with its exact step filter. The
provider contributes energy and force; the filter limits a proposed search
segment before it reaches the open distance boundary.

```ts
import {
  HyperplaneColliderN,
  XpbdParticleHyperplaneBarrierN,
  XpbdParticleHyperplaneBarrierStepFilterN,
  compileXpbdIncrementalPotentialProblemN
} from '@holotope/physics';

const floorBarrier = new XpbdParticleHyperplaneBarrierN({
  id: 'floor/point-0',
  particle: binding.particles[0]!,
  plane: new HyperplaneColliderN([0, 1, 0, 0], 0),
  minimumDistance: 0.01,
  activationDistance: 0.1,
  stiffness: 250
});
const floorFilter = new XpbdParticleHyperplaneBarrierStepFilterN({
  id: 'floor/point-0/filter',
  barrier: floorBarrier,
  conservativeScale: 0.9
});

const filteredProblem = compileXpbdIncrementalPotentialProblemN({
  dimension: 4,
  particles: binding.particles,
  predictedPositions: prediction.positions,
  deltaTime: prediction.deltaTime,
  providers: [material, floorBarrier],
  stepFilters: [floorFilter]
});

const filteredBase = filteredProblem.packPositions(candidatePositions);
const filteredEvaluation = filteredProblem.evaluate(filteredBase);
const filteredDirection = Float64Array.from(
  filteredEvaluation.gradient,
  (value) => -value
);
const filteredSearch = searchXpbdIncrementalPotentialArmijoN({
  problem: filteredProblem,
  coordinates: filteredBase,
  direction: filteredDirection
});

if (filteredSearch.status === 'step-filter-refused') {
  console.warn(filteredSearch.reason, filteredSearch.blockingFilter);
}
```

The exact specialization is dimension-independent and retains signed distances,
impact fraction, and maximum step as evidence. It protects only the registered
point and static plane. A complete deformable collision-free step requires
complete collision candidates and corresponding filters.

## Compile barriers for every bound source vertex

Reuse a normal contact family as the authoritative source-to-particle mapping.
Its clearance becomes each barrier's open minimum distance; adding its
projection constraints to an `XpbdWorldN` remains optional.

```ts
import {
  HyperplaneColliderN,
  compileXpbdParticleHyperplaneBarrierFamilyN,
  compileXpbdParticleHyperplaneFamilyN,
  stepXpbdIncrementalPotentialN
} from '@holotope/physics';

const floorContacts = compileXpbdParticleHyperplaneFamilyN({
  id: 'floor/contacts',
  source,
  particles: binding.particles,
  plane: new HyperplaneColliderN([0, 1, 0, 0], 0),
  clearance: 0.01
});

const floorBarriers = compileXpbdParticleHyperplaneBarrierFamilyN({
  id: 'floor/barriers',
  contacts: floorContacts,
  activationDistance: (vertex) => vertex.minimumDistance + 0.1,
  stiffness: 250,
  conservativeScale: 0.9
});

const step = stepXpbdIncrementalPotentialN({
  dimension: 4,
  particles: binding.particles,
  ...floorBarriers.incrementalPotentialTerms({
    providers: [material],
    stepFilters: []
  }),
  deltaTime: 1 / 120,
  gravity: [0, -9.81, 0, 0]
});
```

Every compiled vertex retains its source ordinal, compile-time source position
and signed distance, exact particle identity, normal-contact record, barrier,
and filter. The family covers every source vertex against this one static
plane. It neither selects an active subset nor discovers other collision
features.

## Minimize a small incremental-potential problem

Use the bounded Float64 reference when correctness evidence is more important
than large-system performance:

```ts
import {
  minimizeXpbdIncrementalPotentialN,
  xpbdMassPreconditionedDirectionN
} from '@holotope/physics';

const result = minimizeXpbdIncrementalPotentialN({
  problem,
  initialCoordinates: coordinates,
  directionPolicy: xpbdMassPreconditionedDirectionN,
  gradientTolerance: 1e-8,
  maximumIterations: 128
});

if (result.status === 'converged') {
  console.log(result.final.positions);
} else if (result.status === 'initial-state-refused') {
  // No iterate was ever evaluated, so there is no `final` to report.
  console.log(result.status, result.problem.dimension);
} else {
  console.log(result.status, result.final.gradientNorm);
}
```

Omit `directionPolicy` for the unchanged steepest-descent reference. The mass
policy scales every free-particle gradient block by inverse mass and is exact
for the diagonal inertial term; it remains a first-order policy, not a Newton
solve. Every accepted iteration retains policy identity, direction, step norm,
objective decrease, and complete Armijo search. `line-search-exhausted`,
`line-search-refused`, and `stalled` are evidence, not silent success. The
result is still detached from the live world: applying positions and
reconstructing velocity are separate state-transition policies. For large or
stiff systems, treat this routine as a golden reference for a more capable
optimizer rather than the final solver.

## Apply a converged optimization result

The application boundary verifies that the particles and result still belong
to the same compiled step before it writes anything:

```ts
import {
  applyXpbdIncrementalPotentialResultN
} from '@holotope/physics';

const applied = applyXpbdIncrementalPotentialResultN({
  result,
  velocityUpdate: 'backward-euler',
  clearForces: true
});

if (applied.status === 'applied') {
  console.log(applied.particles);
} else {
  console.log(applied.reason, applied);
}
```

Only `converged` is eligible. The default velocity is
`(finalPosition - positionBeforeStep) / deltaTime` for dynamic particles;
fixed velocities are retained. Use `velocityUpdate: 'preserve'` for a
configuration-relaxation workflow. `clearForces` defaults to true, matching a
successful `XpbdWorldN` outer step.

Stale live particles, altered result buffers, and changed provider evidence
produce typed refusal records without writes. Provider exceptions still throw,
but the complete particle state is restored first. A successful application
does not write a bound `CellComplex`; call the binding's
`writeSourcePositions()` at that explicit source synchronization boundary.

## Advance a conservative particle system in one call

Use the integrated reference step for a small system when you want the full
optimization transaction but do not need to author each layer separately:

```ts
import {
  stepXpbdIncrementalPotentialN,
  xpbdMassPreconditionedDirectionN
} from '@holotope/physics';

const step = stepXpbdIncrementalPotentialN({
  dimension: 4,
  particles: binding.particles,
  providers: [material, barrier],
  deltaTime: 1 / 120,
  gravity: [0, -9.81, 0, 0],
  minimization: {
    directionPolicy: xpbdMassPreconditionedDirectionN,
    gradientTolerance: 1e-8,
    maximumIterations: 128
  }
});

if (step.status === 'applied') {
  binding.writeSourcePositions();
} else {
  console.warn(step.stage, step.reason);
}
```

The result retains prediction, compiled problem, minimization trace, and—on
success—verified application evidence. Refusal and thrown failure restore the
complete pre-step particle state. This is the Float64 correctness path for
small systems and backend comparisons, not a large-mesh production optimizer.

## Add a proactive lower-measure barrier

Compile the barrier as a second constitutive family over the same named
simplices and exact particle objects. This keeps the elastic law, barrier, and
acceptance policy independently inspectable.

```ts
import {
  compileSimplexConstitutiveFamilyN,
  simplexMeasureBarrierLawN
} from '@holotope/physics';

const barrier = compileSimplexConstitutiveFamilyN({
  id: 'solid-measure-barrier',
  source,
  simplexGroup,
  particles: binding.particles,
  law: simplexMeasureBarrierLawN,
  material: {
    minimumMeasureRatio: 0.1,
    activationMeasureRatio: 0.8,
    stiffness: 4
  }
});

material.addToWorld(world);
barrier.addToWorld(world);
```

The barrier is exactly zero above the activation ratio and grows without bound
as `J` approaches the minimum from above. It supplies an explicit force but
cannot guarantee that an explicit step will not overshoot the boundary. Use
the endpoint and trajectory guards below when the minimum is an invariant.

## Reject and retry an inadmissible material step

Keep material energy and accepted-state policy explicit. The family supplies
forces; a separate guard checks the completed substep; the world owns rollback
and bounded subdivision.

```ts
import {
  compileSimplexConstitutiveFamilyStateGuardN,
  compileSimplexConstitutiveFamilyMeasureTrajectoryGuardN,
  compileSimplexConstitutiveFamilyTrajectoryGuardN
} from '@holotope/physics';

const guard = compileSimplexConstitutiveFamilyStateGuardN({
  id: 'material-domain',
  family: material,
  minimumMeasureRatio: 0.1
});
guard.addToWorld(world);

const trajectoryGuard = simplexGroup.dim === source.ambientDim
  // Full-dimensional: retain signed orientation as well as measure.
  ? compileSimplexConstitutiveFamilyTrajectoryGuardN({
      id: 'material-linear-orientation',
      family: material,
      minimumSignedMeasureRatio: 0.1
    })
  // Embedded: certify intrinsic rank/measure without inventing a normal frame.
  : compileSimplexConstitutiveFamilyMeasureTrajectoryGuardN({
      id: 'material-linear-measure',
      family: material,
      minimumMeasureRatio: 0.1
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
polynomial query. Full-dimensional families use signed determinant ratio;
embedded families use intrinsic squared-measure ratio. Neither is a
certificate for a nonlinear solver trajectory nor an implicit inversion
barrier.

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

## Accelerate a large static obstacle without changing what contact means

A source-simplex candidate family scans every dynamic vertex against every
obstacle simplex. That scan is the correctness oracle and stays the default.
When the obstacle is large enough for it to dominate, compile a hierarchy over
it **once** and query it many times:

```ts
import { CellComplex } from '@holotope/core';
import {
  compileXpbdParticleBindingN,
  compileXpbdParticleSourceSimplexBarrierFamilyN,
  compileXpbdSourceSimplexAabbHierarchyN
} from '@holotope/physics';

// A static obstacle: two well-separated R4 tetrahedra.
const obstacleGroup = {
  key: 'terrain', dim: 3, verticesPerCell: 4, kind: 'simplex' as const,
  indices: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7])
};
const obstacleComplex = new CellComplex(4, Float64Array.from([
  0, 0, 0, 0, 0.7, 0, 0, 0, 0, 0.7, 0, 0, 0, 0, 0.7, 0,
  9, 0, 0, 0, 9.7, 0, 0, 0, 9, 0.7, 0, 0, 9, 0, 0.7, 0
]), [obstacleGroup]);

const contactBinding = compileXpbdParticleBindingN({
  id: 'contact-points',
  source: new CellComplex(4, Float64Array.from([0.2, 0.2, 0.2, 0.05]), [])
});

// Compiled once, outside the step loop. Building it per frame would pay the
// construction cost the tree exists to avoid.
const obstacleHierarchy = compileXpbdSourceSimplexAabbHierarchyN({
  obstacle: obstacleComplex,
  simplexGroup: obstacleGroup,
  leafSize: 8
});

const contact = compileXpbdParticleSourceSimplexBarrierFamilyN({
  id: 'terrain-contact',
  binding: contactBinding,
  obstacle: obstacleComplex,
  simplexGroup: obstacleGroup,
  minimumDistance: 0.01,
  activationDistance: 0.1,
  stiffness: 250,
  candidateHierarchy: obstacleHierarchy
});

// Queried many times: every point evaluation and every segment filter reuses
// the same tree.
const candidates = contact.evaluate().candidateQuery;
console.log(
  candidates.diagnostics.strategy,                       // 'static-aabb-hierarchy'
  candidates.diagnostics.hierarchy?.testedSimplexBounds, // work actually done
  candidates.diagnostics.hierarchy?.totalSimplices
);
```

Pass the same `obstacle` and `simplexGroup` **objects** to both calls. A
structurally identical hierarchy built from a different complex is refused,
because the bounds it cached describe coordinates this family never sees.

Candidate identities and their order are exactly what the exhaustive scan
returns, so nothing downstream can tell which strategy ran except by reading
`diagnostics`. Retention is still not contact: the exact barrier measures the
distance and the paired step filter certifies the admissible prefix. Keep
passing `contact.stepFilter` to the solver — a hierarchy narrows which pairs
are asked and answers none of them.

## Rebuild a hierarchy after the obstacle moves

The hierarchy computes its bounds once, so it requires the obstacle to hold
still. Move the source and the next query throws rather than answering from
stale geometry:

```ts
const movedCoordinate = obstacleComplex.positions[0];
if (movedCoordinate === undefined) throw new Error('empty obstacle');
obstacleComplex.positions[0] = movedCoordinate + 0.5;

let refusal = '';
try {
  contact.evaluate();
} catch (error) {
  refusal = error instanceof Error ? error.message : String(error);
}
// "…the indexed obstacle moved — vertex 0 axis 0 is …, was …. This hierarchy
//  indexes a static obstacle and is not rebuilt automatically; compile a new
//  one after moving the source."
console.log(refusal.includes('indexed obstacle moved'));
```

There is no automatic rebuild, and that is deliberate: a rebuild that happens
by itself is indistinguishable from a tree that was never stale, which is
exactly the failure worth being loud about. Compile a new hierarchy and a new
family after moving the source, or use the exhaustive default — it reads the
obstacle's current coordinates on every query and needs no rebuild at all.

Moving obstacles, incremental refit, and a revision protocol are a separate
stage; this API is a static reference.

## Give a flat membrane bending stiffness and step it

A stretch material resists deforming each simplex, but not folding *between*
simplices — a sheet creased along an edge has every triangle undeformed. That
missing extrinsic term is what a bending family supplies.

Before the code: this is a **discrete cosine-fold stiffness, not a shell
model**. The energy is quartic in the fold angle, does not converge under mesh
refinement, and the stiffness below belongs to this mesh rather than to a
material.

```ts
import { CellComplex } from '@holotope/core';
import {
  XpbdWorldN,
  compileXpbdParticleBindingN,
  compileXpbdSourceSimplexCosineBendingFamilyN,
  stepXpbdIncrementalPotentialWorldN
} from '@holotope/physics';

// A 3x3 R4 sheet, creased along its middle row.
const sheetPositions: number[] = [];
for (let row = 0; row < 3; row += 1) {
  for (let column = 0; column < 3; column += 1) {
    sheetPositions.push(column, row, row === 1 ? 0.45 : 0, 0);
  }
}
const sheetIndices: number[] = [];
for (let row = 0; row < 2; row += 1) {
  for (let column = 0; column < 2; column += 1) {
    const at = row * 3 + column;
    sheetIndices.push(at, at + 1, at + 3, at + 1, at + 4, at + 3);
  }
}
const sheetGroup = {
  key: 'sheet', dim: 2, verticesPerCell: 3, kind: 'simplex' as const,
  indices: Uint32Array.from(sheetIndices)
};
const sheet = new CellComplex(4, Float64Array.from(sheetPositions), [sheetGroup]);
const sheetBinding = compileXpbdParticleBindingN({
  id: 'sheet-points', source: sheet
});

const sheetBending = compileXpbdSourceSimplexCosineBendingFamilyN({
  id: 'sheet-bending',
  binding: sheetBinding,
  simplexGroup: sheetGroup,
  stiffness: 25,
  restCoordinate: 1,        // flat, so the crease is a deformation to resist
  minimumMeasureRatio: 0.05
});

console.log(
  sheetBending.hinges.length,        // 8 interior hinges, found from the source
  sheetBending.boundaryFaceCount,    // 8 boundary edges, counted and skipped
  sheetBending.evaluate().potentialEnergy > 0   // true: the crease costs energy
);

const sheetWorld = new XpbdWorldN({ dimension: 4 });
sheetBinding.addToWorld(sheetWorld);
sheetBending.addToWorld(sheetWorld);

const advance = stepXpbdIncrementalPotentialWorldN({
  world: sheetWorld,
  deltaTime: 1 / 120,
  stepFilters: [sheetBending.stepFilter],   // never omit this
  warmStart: 'feasible-inertial-prediction',
  minimization: { directionPolicy: 'steepest-descent' }
});
console.log(advance.step.status, advance.diagnosis.condition);
```

Omitting `restCoordinate` captures each hinge's fold from the authored
geometry instead, so the mesh as drawn becomes its own relaxed shape and the
family resists deviation from *that*. Writing new coordinates through
`sheetBinding.writeSourcePositions()` afterwards does not retarget the captured
rest — that would silently redefine the shape being resisted. Recompile to
change it.

`stepFilters: [sheetBending.stepFilter]` is load-bearing rather than
decorative. A search segment can begin and end with valid hinges while passing
through zero conormal height in between, where the fold coordinate does not
exist; only the filter sees that crossing.

Two behaviours worth expecting rather than debugging: a flat rest has a
vanishing first derivative, so small folds produce very little restoring
force; and `'newton-cg'` will refuse a mixture containing this provider, with
named unsupported-provider evidence, because it exposes no analytic curvature.
