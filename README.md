# Holotope.js

N-dimensional geometry for TypeScript.

**[Live showcase →](https://nikilp.github.io/holotope.js/)** — the six regular polychora, duoprisms, exact 4D cross-sections, and GPU-computed slicing, running in the browser.

Holotope.js is an experimental open-source library for building, transforming, projecting, and rendering higher-dimensional geometry on the web. It provides a modular foundation for 4D and N-dimensional visual systems, including vectors, transforms, projections, polytopes, cell complexes, and rendering adapters.

## Architecture

Higher-dimensional state stays higher-dimensional until the last responsible moment. The zero-dependency core does all N-D math in Float64 on the CPU; renderer adapters turn explicit **projections** of that state into ordinary 3D objects.

```
@holotope/core            zero-dependency N-D kernel
  ├─ math                 VecN, MatN, plane rotations, so(n) exp, Rotor4 (+slerp), TransformN
  ├─ geometry             CellComplex (N-D counterpart of a mesh), tetrahedralization
  ├─ polytope             n-cube/simplex/orthoplex families; all six regular polychora; duoprisms
  └─ projection           CameraN, perspective/orthographic N→3, hyperplane slicing

@holotope/three           three.js adapter (three as peer dependency)
  ├─ ProjectedEdges3D     render product: projected 1-skeleton as LineSegments
  ├─ ProjectedSurface3D   render product: projected 2-faces as a translucent Mesh
  ├─ SlicedComplex3D      render product: exact 4D cross-section, with picking provenance
  └─ DragRotation4D       pointer controls for rotating through hidden planes

@holotope/three/webgpu    WebGPU/TSL fast paths (WebGPURenderer)
  ├─ ProjectedEdgesGPU    4D→3D projection in the vertex shader; updates are uniforms-only
  └─ SlicedComplexGPU     marching-tetrahedra slicing in a WGSL compute shader
```

A core correctness contract: **the n=3 specialization must reproduce ordinary three.js behavior.** The test suite verifies Holotope rotations and transforms against three.js `Matrix4` directly, and the GPU products are verified differentially against their Float64 CPU counterparts.

## Quick start

```ts
import { PerspectiveProjection, TransformN, createHypercube, rotationFromPlanes } from '@holotope/core';
import { ProjectedEdges3D } from '@holotope/three';

const tesseract = createHypercube({ dim: 4, size: 2 });
const projection = new PerspectiveProjection({ fromDim: 4, viewDistance: 4 });

const edges = new ProjectedEdges3D(tesseract, projection);
scene.add(edges.object); // an ordinary three.js scene

// per frame: rotate in 4D, then reproject
edges.update(new TransformN(4, rotationFromPlanes(4, [
  { i: 0, j: 3, angle: t * 0.5 }, // xw plane
  { i: 1, j: 2, angle: t * 0.3 }  // yz plane
])));
```

Slicing instead of projecting:

```ts
import { HyperplaneSlice4, create120Cell } from '@holotope/core';
import { SlicedComplex3D } from '@holotope/three';

const slice = HyperplaneSlice4.axisAligned(3, 0);   // the w = 0 hyperplane
const section = new SlicedComplex3D(create120Cell({ radius: 1.5 }), slice);
scene.add(section.object);
// per frame: section.update(transform); animate slice.offset to sweep the cut
```

## Development

```sh
pnpm install
pnpm build             # build packages (required before typecheck)
pnpm test              # vitest across all packages
pnpm --filter @holotope/showcase dev   # run the showcase gallery locally
```

## Status

Early research and prototyping. The API is expected to change while the core concepts are explored.

The decisions that shape the library — and why — are in [`docs/architecture.md`](docs/architecture.md).

## Roadmap (abridged)

- ✅ Rotation backends: so(n) exponential map, paired-quaternion `Rotor4` fast path + slerp
- ✅ 4D camera/controls; `ProjectedSurface3D`; slicer provenance for picking
- ✅ WebGPU/TSL acceleration: vertex-stage 4D projection, compute-shader slicing
- GPU surface/section rendering and the materials/transparency phase
- Wythoff construction for the uniform polychora
- `.hyper.json` container format and OFF import/export
- `@holotope/physics`: N-D rigid bodies (bivector angular momentum), GJK in Rⁿ

## License

MIT
