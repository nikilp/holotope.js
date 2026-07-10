# @holotope/three

three.js adapter for [`@holotope/core`](https://www.npmjs.com/package/@holotope/core):
turns explicit projections and cross-sections of N-dimensional geometry into
ordinary three.js objects.

- `ProjectedEdges3D` — the projected 1-skeleton as `LineSegments`
- `ProjectedSurface3D` — the projected 2-faces as a translucent `Mesh`
- `SlicedComplex3D` — the exact 4D cross-section, with per-triangle picking provenance
- `DragRotation4D` — pointer controls for rotating through hidden planes
- `@holotope/three/webgpu` — `ProjectedEdgesGPU` (vertex-shader 4D projection) and
  `SlicedComplexGPU` (WGSL compute-shader slicing) for `WebGPURenderer`

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
```

MIT © Nikolay Petrov
