# @holotope/three

three.js adapter for [`@holotope/core`](https://www.npmjs.com/package/@holotope/core):
turns explicit projections and cross-sections of N-dimensional geometry into
ordinary three.js objects.

Picking remains connected to the source through `RepresentationHitN` and the
`representationHitFrom*` adapters. Projected segments and triangles retain
Float64 homogeneous depth and validity, allowing a perspective-correct exact
lift on the selected source simplex when it is valid and nondegenerate. This
does not erase global projection overlap. Affine slices return exact ambient
points and retain each emitted vertex's source edge and interpolation
parameter; sampled and raymarched fields declare their approximation and
first-hit policies. The common hit and lineage vocabulary is defined in core,
with this package re-exporting the types.

- `ProjectedEdges3D` — the projected 1-skeleton as `LineSegments`
- `ProjectedSurface3D` — the projected 2-faces as a translucent `Mesh`
- `SlicedComplex3D` — the exact 4D cross-section, with per-triangle picking provenance
- `SampledSlicedField3D` — deterministic implicit-field sampling plus an inspectable approximate mesh
- `DragRotation4D` — pointer controls for rotating through hidden planes
- `@holotope/three/webgpu` — `ProjectedEdgesGPU` (vertex-shader 4D projection) and
  `SlicedComplexGPU` (WGSL compute-shader slicing), `QuaternionJuliaGPU`
  and `BicomplexJuliaGPU` (packed-point field evaluation), plus
  `RaymarchedQuaternionJulia3D` and `RaymarchedBicomplexJulia3D`
  (adaptive fragment-stage slicing) for `WebGPURenderer`

`three` (≥0.185 <0.186) is a peer dependency.

**[Live showcase](https://nikilp.github.io/holotope.js/)** ·
**[Repository & docs](https://github.com/nikilp/holotope.js)**

```ts
import { PerspectiveProjection, TransformN, createHypercube, rotationFromPlanes } from '@holotope/core';
import { ProjectedEdges3D } from '@holotope/three';

const edges = new ProjectedEdges3D(
  createHypercube({ dim: 4, size: 2 }),
  new PerspectiveProjection({ fromDim: 4, viewDistance: 4 })
);
scene.add(edges.object);
// per frame:
edges.update(new TransformN(4, rotationFromPlanes(4, [{ i: 0, j: 3, angle: t }])));

// pointLocal is expressed in edges.object's local representation frame.
const lift = edges.liftSegmentPoint(segmentIndex, pointLocal);
if (lift.kind === 'exact') {
  console.log(lift.point, lift.sourceWeights);
}
```

MIT © Nikolay Petrov
