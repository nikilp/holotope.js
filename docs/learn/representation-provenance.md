# Representation provenance

Higher-dimensional state remains authoritative when Holotope constructs a 3D
representation. The renderer receives a projection, section, sampled surface,
or ray-marched restriction; it does not replace the source object.

## What the examples read from

Provenance is carried by render products and read back through a Three
intersection, so the examples below need a product, a hit, and a source
reference.

<!-- doc-check: context -->

```ts
import type { Intersection } from 'three';
import type { SourceCellReferenceN, VecN } from '@holotope/core';
import type { ProjectedEdges3D, ProjectedSurface3D, SlicedComplex3D } from '@holotope/three';

declare const surface: ProjectedSurface3D;
declare const edges: ProjectedEdges3D;
declare const section: SlicedComplex3D;
declare const intersection: Intersection;

// A source edge and a point to project onto it, in ambient R4.
declare const edgeReference: SourceCellReferenceN;
declare const ambientPoint: readonly number[];

// Renderer-local coordinates a lift is asked about. A lift takes plain
// coordinates rather than a VecN, whose `length` is a method.
declare const segmentIndex: number;
declare const faceIndex: number;
declare const pointLocal: readonly number[];
```

## Traceability is carried, not inferred

For a representation map

$$
R : X_N \longrightarrow Y_3,
$$

an ordinary projection is generally many-to-one. Different N-dimensional
points may have the same 3D image, so coordinates in `Y3` do not define an
inverse. Traceability instead comes from a second map retained during
construction:

$$
P : \text{render primitive or hit} \longrightarrow
    \text{source primitive or evaluation record}.
$$

This distinguishes two questions:

1. Which higher-dimensional feature generated what was selected?
2. Is there a unique ambient point corresponding to the selected 3D point?

The first can be answered by provenance even when the second is mathematically
ambiguous.

## Core result and map lineage

`RepresentationHitN` is defined by `@holotope/core`; renderer adapters only
translate their native intersection records into it. `@holotope/three`
re-exports the type for compatibility. This keeps source identity, ambient
point precision, ambiguity, and map history available to headless consumers.

Every hit carries a dimension-checked `RepresentationLineageN`. Its ordered
steps are discriminated recipes for operations that exist in the library:

- affine section and affine slice chart;
- orthographic, coordinate-subspace, iterated-perspective, or explicitly
  custom projection;
- exact field restriction to an affine chart;
- approximate sampled-isosurface realization;
- first-hit ray realization.

A section remains distinct from its chart. The section restricts R4 while
retaining ambient coordinates; its chart then expresses that hyperplane in
R3. A section rendered through perspective instead composes the R4 restriction
with the R4-to-R3 projection. `createRepresentationLineageN()` rejects recipes
whose dimensions do not compose.

Recipes are snapshots of the map at inspection time. They identify the
mathematical path and its parameters, not renderer objects, executable scene
graphs, or a universal inverse operation.

The discriminated recipes also expose capability queries without collapsing
their different inverse semantics. `representationMapCapabilitiesN()` reports
point-forward, point-lift, inverse-fibre, attribute-transport, and
source-identity capability independently.
`representationLineageCapabilitiesN()` composes those quality records
monotonically across an ordered lineage. For example, an orthographic map has
an exact inverse fibre but no unique point lift, while an affine section chart
has an exact point lift on its domain but no non-trivial inverse fibre.

`evaluateRepresentationLineagePointN()` is the renderer-independent Float64
forward path for recipes that contain complete point mathematics. It supports
affine sections and their charts, coordinate/orthographic projections, and the
certified unclamped branch of iterated perspective. An off-plane section point
or a point crossing a perspective guard returns typed `unavailable` evidence;
it is never passed through the renderer's legacy clamp. Custom projections,
field sampling, and ray realization likewise refuse when their recipe alone
lacks the evaluator or retained record needed to answer honestly.

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

`ProjectedEdges3D` preserves source vertex order. Its `BufferGeometry` is
indexed: the position attribute contains one projected entry per source vertex,
while the index buffer contains the segment endpoints. Do not read adjacent
position entries as one edge. For a picked line segment,
`edgeVertices(segmentIndex)` returns the two source-complex vertex indices.

`ProjectedSurface3D` expands source faces into a triangle soup while retaining
both mappings needed for inspection:

- `sourceFaceOfTriangle(faceIndex)` returns the source 2-cell;
- `faceVertices(faceIndex)` returns the three source vertex indices used by the
  rendered triangle.

`SlicedComplex3D` retains the source tetrahedron for every emitted triangle:

- `sourceTetOfFace(faceIndex)` returns the source tetrahedron;
- `facesOfSourceTet(tetIndex)` returns every current section face produced by
  that tetrahedron, or an empty array when it does not meet the current cut;
- `sourceTetVertices(tetIndex)` returns its four source vertex indices.

Retained vertex ids also let separate observations meet again in source
topology. `findIncidentCellsN(group, vertices)` returns every cell in a
homogeneous group whose vertex tuple contains the complete query. A projected
triangle can therefore identify its incident source tetrahedra, and an exact
section can highlight only the section triangles produced by those tetrahedra.
This is combinatorial containment, not geometric proximity and not inferred
refinement ancestry.

It also retains the construction of every section vertex:

- `sourceCrossingOfFaceVertex(faceIndex, corner)` returns the source edge and
  interpolation parameter `t`;
- `sourceCrossingsOfFace(faceIndex)` returns the three records together.

Each point therefore satisfies `p = from + t(to - from)` in the current
ambient R4 state. The CPU `sliceTetrahedra()` and
`sliceTetrahedraAmbient()` functions expose the same optional packed
provenance buffers.

A slice has a stronger coordinate property than a projection. Its display
frame is an affine coordinate system for one hyperplane, so
`HyperplaneSlice4.embedPoint(point3)` lifts a point in that frame uniquely back
to ambient R4. In the other direction,
`HyperplaneSlice4.projectPointToChart(point4)` returns both the chart
coordinates of the point's orthogonal projection and its signed distance from
the hyperplane. The distance is essential: chart coordinates alone cannot say
whether an arbitrary ambient point actually belongs to the section.
`sliceTetrahedraAmbient()` exposes the actual R4 intersection vertices when a
downstream product needs them before projection.

### Ancestry that survives a second section

One source edge plus an interpolation parameter is complete provenance for a
single cut and provably incomplete for two: an edge of an already-sectioned
complex is generally not an edge of the original source, so a second cut
described that way names a vertex the reader never supplied.

`sectionSimplexGroupN` therefore retains, for every output vertex, a sparse
affine combination of **original** source vertices — indices and weights
summing to one. Affine combinations compose, because the interpolation of two
combinations is again a combination of the same ancestors, so passing a
previous section's `lineage` back in keeps an `R5 → R4 → R3` chain expressed in
R5 vertices rather than in the intermediate complex's numbering. That is a
qualification of ancestry, not an inverse: it says which source vertices a
section point is a combination of, which is exactly what a projected pixel's
fibre cannot say.

Vertices weld by original-source identity — a source vertex where the plane
passes through one, an unordered source edge where it crosses one — so adjacent
cells sharing a cut feature share an output vertex instead of cracking. Chart
coordinates depend on the frame policy the slice was built with; the ambient
positions do not.

`SlicedComplex3D.sourceCellChart()` also carries numerical defaults appropriate
to its stored representation. A Three.js product uses Float32 chart positions,
so its source-coordinate tolerance is looser than the headless Float64 chart's.
`resolveRepresentationChartPointToSourceCellN()` uses those chart-owned
defaults unless a caller explicitly overrides them.

When a section is constructed with `colorForTet`, that callback builds a
source-tetrahedron palette once; remarching does not reevaluate application
state. Call `recolorBySourceTet()` to replace the palette and recolor the
current faces without rebuilding the section geometry.

Changing a live slice normal transports its preceding in-plane basis into the
new hyperplane by default. This prevents display coordinates from snapping
when the canonical coordinate-axis ordering changes during animation. Call
`setNormal(normal, { frame: 'canonical' })` when a reproducible frame derived
only from the new normal is required instead.

## Taking a chart point back to one source cell

`representationHitFromSlicedComplex` and the headless experiment `probe` both
answer "which source cell produced this?" through the same mechanism, and it is
worth knowing what that mechanism refuses.

A cell chart retains one persistent source-cell reference per rendered
triangle. `SlicedComplex3D.sourceCellChart()` hands you the chart the product
already built, and `resolveRepresentationChartPointToSourceCellN()` locates a
chart point in it.

Three outcomes, and the middle one is why the `triangleIndex` option exists:

| point | outcome |
| --- | --- |
| inside one triangle | `resolved` |
| on a vertex where several triangles meet | `unavailable`, `ambiguous-source-cell` |
| off the section entirely | `unavailable`, `outside-representation` |

```ts
import {
  HyperplaneSlice4,
  TransformN,
  createHypercube,
  resolveRepresentationChartPointToSourceCellN,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import { SlicedComplex3D } from '@holotope/three';

const sectioned = tetrahedralizeCuboidCells(createHypercube({ dim: 4, size: 2 }));
const cut = new SlicedComplex3D(sectioned, HyperplaneSlice4.axisAligned(3, 0));
cut.update(TransformN.identity(4));
const chart = cut.sourceCellChart()!;
const emitted = cut.geometry.getAttribute('position');

// Interior of the first emitted triangle: containment alone is enough.
const interior = [
  (emitted.getX(0) + emitted.getX(1) + emitted.getX(2)) / 3,
  (emitted.getY(0) + emitted.getY(1) + emitted.getY(2)) / 3,
  (emitted.getZ(0) + emitted.getZ(1) + emitted.getZ(2)) / 3
];
log(resolveRepresentationChartPointToSourceCellN(chart, interior).kind); // 'resolved'

// A vertex of that triangle. Six triangles from six different source cells
// meet there, so the resolver refuses rather than picking one.
const corner = [emitted.getX(0), emitted.getY(0), emitted.getZ(0)];
log(resolveRepresentationChartPointToSourceCellN(chart, corner).kind); // 'unavailable'

// The same point resolves once you say which triangle it came from -- which a
// renderer always knows, because the raycaster reported a faceIndex.
log(
  resolveRepresentationChartPointToSourceCellN(chart, corner, { triangleIndex: 0 })
    .kind
); // 'resolved'
```

A resolved answer names the triangle it selected and, when the chart has an
exact lift, a source-local coordinate. For an unprojected section that
coordinate is `exact`.

That is the whole reason a renderer pick can answer where a bare coordinate
cannot: the primitive witness is information the chart point does not carry.
It is also why the headless `probe` reports `ambiguous-primitive` for such a
point instead of attaching a cell — see
[the probe's source-cell contract](/learn/experiment-documents).

A projected chart is different again: it may preserve source identity while
reporting the coordinate as `projection-ambiguous`, because the map is
many-to-one. And a non-simplex source cell has no barycentric coordinate to
return at all.

The core affine-section constructor works in Float64. The Three.js adapter
applies a Float32-scale tolerance instead, because that is the precision the
geometry it picked was built at.

## Source-cell reference lifecycle

Cell-backed hits carry a `SourceCellReferenceN` in addition to the familiar
concatenated cell index and vertex tuple. The reference uses the in-memory
`CellComplex` and `CellGroup` objects plus a group-local cell ordinal as its
identity anchor. `inspectSourceCellReferenceN()` reports whether it is still
current.

The lifecycle is explicit:

- vertex-position edits, unrelated group insertion, and group reordering
  preserve the reference;
- removing the group, changing its cell metadata, removing the cell, or
  changing its vertex tuple retires it;
- regenerating equivalent topology into a different `CellComplex` creates a
  different identity.

This remains the fastest in-memory identity. A separate `SourceCellIdN`
provides a serializable structural identity when observations must survive
compatible regeneration. `CellGroup.key` is an optional author-supplied key
that must be unique inside a complex. `createSourceCellIdN()` snapshots that
key, ambient dimension, the group-local cell ordinal, and a topology
fingerprint containing cell metadata and its vertex tuple.

`resolveSourceCellIdN()` returns a fresh in-memory reference only when the key,
ordinal, metadata, and tuple still agree. Vertex-position changes are allowed;
missing or ambiguous keys, removed cells, and changed topology produce typed
refusals instead of silently retargeting the observation. Unkeyed groups use a
deterministic order-derived fallback and label it `derived`: it is reproducible
under order-preserving construction, not promised to survive group reordering.
This distinction lets persistent consumers request real author identity while
ordinary transient geometry remains free of mandatory UUIDs or content hashes.
Cell-backed `@holotope/three` hit adapters populate this structural id beside
the in-memory reference; the field remains optional on the core result type so
custom producers can migrate without fabricating persistence they do not own.

## Linear source-coordinate constraints

`solveLinearCoordinateConstraintsN()` is the renderer-independent Float64
golden path shared by the source-edge and source-simplex workflows. It solves
explicit blocks of linear equations `A x = b`. Each block declares a positive
weight and a positive scale, so its objective has auditable units:

$$
\underset{x}{\operatorname{minimize}}\;
  \sum_k \omega_k\left\|\frac{A_k x-b_k}{s_k}\right\|^2.
$$

The deterministic symmetric eigensolver supplies the pseudoinverse and rank.
Resolved spectral components come only from the observations; an optional
prior supplies only unresolved null-space components. The result reports:

- `compatible` or `conflicting` from the weighted normalized residual;
- `unique` or `rank-deficient` from the observed rank;
- unresolved degrees of freedom and singular-value conditioning;
- global and per-block normalized residuals;
- the normal-equation residual as a numerical certificate.

This primitive is deliberately unconstrained. A source edge owns its closed
parameter interval, while a source simplex owns barycentric sum and
non-negativity. Separating linear observation analysis from coordinate-domain
policy lets those parameterizations share rank and residual semantics without
claiming that they are the same geometry.

Longer-lived consumers can compose those blocks with
`LinearCoordinateConstraintSystemN`. The system is an immutable ordered
snapshot: `withLinearCoordinateConstraintBlockN()` replaces a matching stable
key in place or appends a new one, while
`withoutLinearCoordinateConstraintBlockN()` returns a snapshot without that
evidence. Coefficients and targets are copied into frozen owned arrays. A
machine key identifies a block across updates; its optional label is only
human-readable diagnostic text.

`solveLinearCoordinateConstraintSystemN()` delegates unchanged mathematics to
the golden solver and returns diagnostics carrying the same stable keys. This
separates persistent evidence composition from numerical policy: old snapshots
remain reproducible, removing one view makes any resulting rank loss explicit,
and no renderer or stateful editor is introduced into core.

## Explicit source-edge coordinates

A representation-space drag does not generally have one inverse in the source
space. Once an application deliberately chooses a current source 1-cell,
`SourceEdgeCoordinateN` supplies a dimension-independent one-parameter policy:

```ts
import {
  createSourceEdgeCoordinateN,
  evaluateSourceEdgeCoordinateN,
  projectPointToSourceEdgeN
} from '@holotope/core';

const projected = projectPointToSourceEdgeN(edgeReference, ambientPoint);
const coordinate = createSourceEdgeCoordinateN(
  edgeReference,
  projected.coordinate.parameter
);
const sourcePoint = evaluateSourceEdgeCoordinateN(coordinate);
```

The parameter is oriented by the referenced vertex tuple: zero is its first
vertex and one is its second. Projection clamps to the closed segment and
reports both the unclamped supporting-line parameter and squared snap distance.
Evaluation reads the edge's current Float64 endpoint positions, so a coordinate
follows geometry edits while the source reference remains current and refuses
to evaluate after retirement.

This is an explicit interaction constraint, not a claimed inverse projection.
The application is responsible for choosing the source edge; the core then
provides the auditable N-D coordinate and nearest-point calculation.

`fitSourceEdgeCoordinateToProjectionN()` adds the corresponding
view-to-source policy for any homogeneous N→3 projection. It projects the two
current, optionally transformed edge endpoints into R3, finds the closest
point on that rendered segment, and converts the ordinary rendered-segment
parameter into the perspective-correct source-edge parameter. Its result is
discriminated:

- `exact` means the requested R3 target already lies on the rendered segment;
- `least-squares` names the closest realizable point and reports the target
  residual;
- `unavailable` reports an invalid projection endpoint, singular denominator,
  visually collapsed edge, or singular source weights.

Available results also report endpoint clamping and a forward-projection
round-trip residual. A screen pointer still needs an authored policy for
becoming an R3 target—for example, preserving the selected marker's display
depth. That presentation choice remains outside core.

Several views can constrain the same named source edge without pretending
that any one view owns the source point. `fitSourceEdgeCoordinateToObservationsN()`
first performs the same homogeneous fit independently in every view. Each fit
produces an estimate `t_i` of the common, dimensionless source-edge parameter.
An observation may declare a stable `key`; otherwise its ordered index supplies
a deterministic local key. Source-simplex observations follow the same rule.
The reconciled coordinate is the auditable weighted least-squares policy

$$
t^* = \underset{0 \leq t \leq 1}{\operatorname{argmin}}
      \sum_i w_i(t-t_i)^2.
$$

The result keeps every independent fit and reports parameter spread,
parameter RMS residual, representation-space RMS residual, and maximum view
residual. It uses the shared constraint vocabulary: `compatible` means the
weighted parameter residual is within the declared tolerance; `conflicting`
means it is not. Rank, unresolved degrees, conditioning, and the normal-
equation residual use the same definitions as the simplex workflow. `exact`
additionally requires every representation target to lie exactly on its
rendered edge. Thus agreement between views and exactness within each view
remain separate claims.

This source-parameter objective is intentional. It does not mix unrelated
screen scales or claim to minimize a universal perceptual error. Applications
that need a different reconciliation policy can retain the independent fits
and apply their own weights or higher-dimensional constraints.

## Source-simplex coordinates and observational rank

An edge supplies one source degree of freedom. A source simplex generalizes
that policy to barycentric coordinates

$$
w_j \geq 0, \qquad \sum_j w_j = 1, \qquad
x = \sum_j w_j v_j.
$$

`SourceSimplexReferenceN` names an ordered vertex simplex inside a persistent
source cell. It may name a complete simplex cell or an authored triangle used
to realize a polygonal source face. Its lifecycle follows the parent
`SourceCellReferenceN`; position edits remain valid while a changed or removed
parent cell retires the derived reference.

`createSourceSimplexCoordinateN()` validates barycentric weights,
`evaluateSourceSimplexCoordinateN()` follows current vertex positions, and
`projectPointToSourceSimplexN()` computes the closest point on the closed
simplex. The CPU golden path enumerates active faces exactly and reports the
source simplex's affine rank. A configurable candidate bound makes the
exponential reference cost explicit for unusually high-arity simplices.

Multiple projected observations constrain the weights without first claiming
an inverse in any view. If source vertex `j` has homogeneous image
`(h_j, q_j)` and a view requests affine point `y`, then every displayed
coordinate contributes the linear equation

$$
\sum_j w_j\bigl(h_{j,c} - y_c q_j\bigr) = 0,
\qquad c \in \{0,1,2\}.
$$

`fitSourceSimplexCoordinateToObservationsN()` stacks these equations, solves
their weighted least-squares problem on the closed barycentric simplex, and
measures rank on its zero-sum tangent space. Every active face is expressed in
a Helmert tangent chart and delegated to the shared linear constraint solver;
the outer enumeration alone enforces barycentric non-negativity. The result
separates three independent claims:

- `exact` versus `least-squares` describes forward agreement with the view
  targets;
- `compatible` versus `conflicting` describes whether one barycentric point
  satisfies the normalized homogeneous equations;
- `unique` versus `rank-deficient` describes whether those equations constrain
  every source degree of freedom.

A single R4→R3 view cannot determine all four barycentric degrees of a
4-simplex. A complementary view can raise the combined rank to four. When a
system remains rank-deficient, an optional prior chooses only within the
unresolved null space; it does not alter components fixed by observations.
The result reports combined and per-view rank, unresolved degrees of freedom,
rank conditioning, active-face dimension, equation residual, and forward view
residuals.

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

## Homogeneous projection and inverse fibres

`PerspectiveProjection`, `OrthographicProjection`, and `CoordinateProjection`
expose a Float64 homogeneous reference path in addition to their ordinary
affine render path. `CoordinateProjection` retains any three named source axes
in a declared output order; its inverse fibre is spanned exactly by the
omitted coordinate axes.
For an ambient point `x`, `projectHomogeneousPoint(x)` returns

```text
[xTilde, yTilde, zTilde, q]
```

together with validity evidence. Dividing the first three entries by `q`
recovers the affine R3 point when that evidence is valid. The same operation
is available in packed form through `projectHomogeneousPositions()`, and
`homogeneousMatrix()` exposes its row-major 4 by `(N + 1)` matrix.

For iterated perspective, composing the unclamped stages is linear in
homogeneous coordinates. The final denominator alone is not a sufficient
validity test in dimensions above four, however: an earlier perspective stage
may reach its viewpoint even if later algebra makes final `q` positive. The
validity record therefore retains every hidden-axis divide, including its raw
and guarded denominator and its affine-domain margin. The packed path reports
the same decision as one byte per point.

The preimage of one R3 observation is represented explicitly by
`ProjectionFibreN`. It contains an affine base point, `(N - 3)` direction
vectors, and the domain on which that flat belongs to the projection:

- orthographic fibres are unbounded affine flats;
- perspective fibres are affine flats intersected with one open half-space
  for every perspective stage.

`evaluateProjectionFibre()` evaluates a chosen set of fibre parameters, while
`isPointInProjectionFibreDomain()` tests the declared projection domain. These
are headless core queries: no renderer, camera ray, or Three.js type determines
their mathematical result.

An inverse fibre does not claim that one source point is preferred. It exposes
the complete underdetermined preimage so a later source-geometry query or
authored interaction policy can select a meaningful point. Conversely, a
known source simplex plus valid homogeneous vertex data supports
perspective-correct point reconstruction.

`ProjectedEdges3D` and `ProjectedSurface3D` retain that Float64 homogeneous
data alongside the Float32 render buffer. Their headless query methods lift a
point expressed in the product's local representation frame:

```ts
const segmentLift = edges.liftSegmentPoint(segmentIndex, pointLocal);
const triangleLift = surface.liftTrianglePoint(faceIndex, pointLocal);
```

For representation-space affine weights `lambda_i` and homogeneous
denominators `q_i`, the source-simplex weights are

```text
mu_i = (lambda_i / q_i) / sum_j(lambda_j / q_j).
```

The query returns both weight sets, the lifted ambient point, the
representation residual, and simplex-conditioning evidence. It refuses a
result when a projection vertex is invalid, a denominator or source-weight
normalization is singular, the rendered simplex is degenerate, or the point
does not lie on that simplex. Custom projections without the homogeneous
capability report `unsupported-projection`.

The `representationHitFromProjectedEdge()` and
`representationHitFromProjectedSurface()` adapters apply this query
automatically. Their signatures are unchanged; a valid selected-simplex lift
now has `ambientPointStatus: 'exact'`, while a refused lift remains
`'unavailable'`. Diagnostic weights and conditioning are carried in
`details`.

## Precision and ambiguity boundary

Primitive identity does not by itself make a perspective projection
invertible. A selected projected triangle now has enough retained projective
depth to reconstruct the corresponding point on that named source triangle;
ordinary 3D barycentric weights remain sufficient only for affine
projections. This is a conditional inverse of the projection restricted to a
nondegenerate source simplex, not an inverse of the complete projection.

Overlapping projected features may also share the same apparent location. The
renderer resolves the visible hit through its depth and picking policy;
provenance identifies the feature actually selected. Applications that need
all higher-dimensional candidates must query source geometry rather than treat
one visible hit as proof of uniqueness. Consequently a projected hit can
simultaneously carry `ambientPointStatus: 'exact'` and
`ambiguity: 'projection-overlap'`: the first describes the point on the
selected source simplex, while the second describes the global observation.

The invariant across these products is: every dimensional reduction declares
what it can recover—source feature, unique ambient point, approximate source
cell, or full evaluation record—without silently promoting the representation
to source truth.
