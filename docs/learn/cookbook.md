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

See it running in the [tesseract demo](https://nikilp.github.io/holotope.js/tesseract.html),
or read its [full source](https://github.com/nikilp/holotope.js/blob/main/examples/showcase/src/tesseract.ts).

## Sweep and reorient a 4D slice

Changing `offset` moves the same affine plane. `setNormal()` changes its
orientation and updates the slice display frame in place, so the existing
`SlicedComplex3D` can be retained.

```ts
import {
  HyperplaneSlice4,
  TransformN,
  createHypercube,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import { SlicedComplex3D } from '@holotope/three';

const complex = tetrahedralizeCuboidCells(createHypercube({ dim: 4, size: 2 }));
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
const intersection = intersections.find((value) => value.faceIndex !== undefined);

if (intersection?.faceIndex !== undefined) {
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
