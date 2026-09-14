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
- `SectionChart3D` — any RN section drawn in its own chart (points, segments, or coherently wound triangles), with parent cells and original-source affine ancestry on every pick
- `SampledSlicedField3D` — deterministic implicit-field sampling plus an inspectable approximate mesh
- `DragRotation4D` — pointer controls for rotating through hidden planes
- `@holotope/three/webgpu` — `ProjectedEdgesGPU` (vertex-shader 4D projection) and
  `SlicedComplexGPU` (WGSL compute-shader slicing), `QuaternionJuliaGPU`
  and `BicomplexJuliaGPU` (packed-point field evaluation), plus
  `RaymarchedQuaternionJulia3D` and `RaymarchedBicomplexJulia3D`
  (adaptive fragment-stage slicing) for `WebGPURenderer`

## Tested three.js compatibility

`three` is a peer dependency; the declared range is **`>=0.184.0 <0.187.0`**.
That range is *tested*, not inferred from semver, and it is not a promise
about revisions that do not exist yet.

**A range is wider than the sample that supports it.** The range claims a
continuum; the table below lists the exact revisions that were actually run.
Every **minor** in the range has a driven representative, and
`pnpm check:three-compat` fails if one does not — but the revisions in this
table are the only ones exercised. A patch release inside a covered minor is
claimed on its minor's representative and on upstream's patch-release
discipline. That is an inference, not a measurement, and this table should not
be read as a per-patch guarantee.

| revision | driven | runtime (import, adapters, pick, bundle) | real-browser render | strict TypeScript (`skipLibCheck: false`) |
| --- | --- | --- | --- | --- |
| r182 and earlier | — | **not supported** — `three/tsl` lacks node functions the WebGPU entry imports | — | — |
| 0.183.0 | P57 | passes | WebGL2 + WebGPU | **blocked**: `@types/three@0.183.0` references a `RenderPipeline.js` it does not ship |
| 0.183.1 | P57 | passes | WebGL2 + WebGPU | passes |
| 0.183.2 | P57 | passes | WebGL2 + WebGPU | **blocked**: no `@types/three@0.183.2` is published |
| **0.184.0** | **CI, every run** | passes | WebGL2 + WebGPU (P57) | passes |
| **0.185.0** | P57 | passes | WebGL2 + WebGPU | passes |
| **0.185.1** | **CI, every run** | passes | WebGL2 + WebGPU | passes |
| **0.186.0** | **CI, every run** | passes | WebGL2 + WebGPU | passes |

The r183 patches are excluded from the supported range for a **declaration
packaging** reason rather than a runtime one, and because a supported range
must be contiguous: `0.183.2` sits between two typed revisions with no
declarations at all. Every r183 row rendered a real WebGL *and* WebGPU frame
with no console output.

The render column is a **one-off measurement per revision**, not a CI column:
each row rendered from freshly packed artifacts in a real browser at the time
that revision was admitted, on one configuration only (Chrome, Apple GPU).
`WebGLRenderer` is WebGL2-only across this whole window, so "WebGL2" is what
that column means. The compute-backed WebGPU products (`SlicedComplexGPU` and
the other `*GPU` adapters) have **no WebGL fallback** and cannot have one —
compute shaders have none — so a WebGL2 tick never covers them. No Firefox,
Safari, Windows, discrete-GPU or mobile configuration has been exercised.

`0.186.0` is the exact reproducibility reference — the version this repository
develops, bundles, publishes CDN examples against, and runs packed-consumer
conformance on. A peer *window* and a reproducibility *anchor* are different
objects, and widening the first does not move the second; this anchor moved
because the reference was deliberately advanced, not to follow the range.

CI drives the matrix (`0.184.0`, `0.185.1`, `0.186.0` — one representative per
claimed minor) from freshly packed artifacts on every run —
`pnpm check:three-compat` — and drives **both columns** at each revision: a
live runtime lifecycle *and* a strict TypeScript
compile of a composition of both entry points against that revision's own
published declarations (`strict`, `skipLibCheck: false`,
`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`). The
strict-TypeScript column is the one this table's exclusions turn on, so it is
checked at the declared **minimum**, not only at the pinned reference. A
revision whose declarations are unpublished fails the guard rather than
skipping it, and a run that reaches the runtime column without the typecheck
fails its own postcondition.

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
