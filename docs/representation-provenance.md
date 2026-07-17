# Representation provenance

Higher-dimensional state remains authoritative when Holotope constructs a 3D
representation. The renderer receives a projection, section, sampled surface,
or ray-marched restriction; it does not replace the source object.

## Traceability is carried, not inferred

For a representation map

\[
R : X_N \longrightarrow Y_3,
\]

an ordinary projection is generally many-to-one. Different N-dimensional
points may have the same 3D image, so coordinates in `Y3` do not define an
inverse. Traceability instead comes from a second map retained during
construction:

\[
P : \text{render primitive or hit} \longrightarrow
    \text{source primitive or evaluation record}.
\]

This distinguishes two questions:

1. Which higher-dimensional feature generated what was selected?
2. Is there a unique ambient point corresponding to the selected 3D point?

The first can be answered by provenance even when the second is mathematically
ambiguous.

## Explicit geometry products

The Three.js adapter normalizes product-specific picking through
`RepresentationHitN`. Its adapters accept the renderer intersection and return
one common record containing the world-space 3D point, ambient dimension,
source reference, ambient-point precision, and ambiguity policy:

```ts
import {
  representationHitFromProjectedSurface,
  representationHitFromSlicedComplex
} from '@holotope/three';

const projectedHit = representationHitFromProjectedSurface(surface, intersection);
const slicedHit = representationHitFromSlicedComplex(section, intersection);
```

The contract is deliberately capability-sensitive. `ambientPoint` is optional;
`ambientPointStatus` is `exact`, `approximate`, or `unavailable`; and
`ambiguity` states whether the hit is unique in an affine slice, selected amid
projection overlap, derived from a sampled surface, or the first surface found
along a field ray.

`ProjectedEdges3D` preserves source vertex order. For a picked line segment,
`edgeVertices(segmentIndex)` returns the two source-complex vertex indices.

`ProjectedSurface3D` expands source faces into a triangle soup while retaining
both mappings needed for inspection:

- `sourceFaceOfTriangle(faceIndex)` returns the source 2-cell;
- `faceVertices(faceIndex)` returns the three source vertex indices used by the
  rendered triangle.

`SlicedComplex3D` retains the source tetrahedron for every emitted triangle:

- `sourceTetOfFace(faceIndex)` returns the source tetrahedron;
- `sourceTetVertices(tetIndex)` returns its four source vertex indices.

A slice has a stronger coordinate property than a projection. Its display
frame is an affine coordinate system for one hyperplane, so
`HyperplaneSlice4.embedPoint(point3)` lifts a point in that frame uniquely back
to ambient R4. `sliceTetrahedraAmbient()` exposes the actual R4 intersection
vertices when a downstream product needs them before projection.

## Implicit products

`SampledSlicedField3D` keeps the complete Float64 sample and field records.
`sourceCellOfFace(faceIndex)` maps an extracted triangle to the sampled grid
cell that produced it. The extracted isosurface is explicitly approximate; the
cell and records are the auditable provenance.

`RaymarchedField3D.intersectRay(ray)` performs the CPU golden trace rather than
reporting a proxy-box intersection. A successful hit includes:

- world and local slice-space position and normal;
- the ambient R4 point;
- trace count and inside/outside state;
- the complete family-specific field evaluation record.

Thus an implicit surface need not have a source mesh to remain inspectable.
`intersectRaymarchedRepresentation()` wraps this result in the same
`RepresentationHitN` contract used by explicit geometry.

## Precision and ambiguity boundary

Primitive identity does not by itself make a perspective projection invertible.
For example, a picked projected triangle identifies its source face and
vertices, but reconstructing an exact point on that face requires the
projection's perspective-depth data and perspective-correct interpolation.
Ordinary 3D barycentric weights are sufficient only for affine projections.
The current surface lookup therefore promises exact source-feature identity,
not an invented ambient point.

Overlapping projected features may also share the same apparent location. The
renderer resolves the visible hit through its depth and picking policy;
provenance identifies the feature actually selected. Applications that need
all higher-dimensional candidates must query source geometry rather than treat
one visible hit as proof of uniqueness.

The invariant across these products is: every dimensional reduction declares
what it can recover—source feature, unique ambient point, approximate source
cell, or full evaluation record—without silently promoting the representation
to source truth.
