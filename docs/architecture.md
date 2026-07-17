# Architecture

Decisions that shape Holotope.js, with their reasoning. Status: living document; the API is pre-1.0 and expected to move, but these foundations are meant to hold.

## 1. N-D kernel + renderer adapters, never a fork

GPU rasterization consumes 3D clip space and produces 2D fragments — there is no "native N-D rendering" at the hardware level. Every higher-dimensional system therefore ends in a 3D visualization product. Given that, the design is:

- **`@holotope/core`** — a zero-dependency kernel where all N-dimensional state lives and stays N-dimensional until the last responsible moment. Float64 on the CPU is the source of truth.
- **Renderer adapters** (`@holotope/three` first) — thin packages that turn *projections* of that state into ordinary renderer objects. three.js is a peer dependency, never forked and never subclassed: its 3D assumptions (`Vector3` positions, quaternions, frusta) are load-bearing, and quaternions do not even generalize past 4D.
- **`@holotope/physics`** — a separate headless simulation world. It consumes core geometry and math but does not depend on a renderer or make a visible projection/slice authoritative. Render-object synchronization remains an explicit adapter boundary.

## 2. Render products are explicit

"Show me a 4D object" has several honest answers that solve different problems and must not be conflated — wireframe projection, exact cross-section, thick-slice volume, implicit raymarching. Each is a named class with its own correct behavior for picking, sorting, and transparency:

| Product | What it is |
|---|---|
| `ProjectedEdges3D` | the 1-skeleton, projected N→3, as line segments |
| `SlicedComplex3D` | exact hyperplane cross-section of tetrahedral cells, as a mesh |
| `SampledSlicedField3D` | approximate isosurface of an implicit R4 field restricted to a sampled affine 3-flat |
| `RaymarchedField3D` | adaptive fragment-stage restriction of any `ImplicitFieldNode4` to an affine 3-flat; no extracted mesh |
| `RaymarchedQuaternionJulia3D`, `RaymarchedBicomplexJulia3D` | convenience specializations which pair a field node and record-driven style with `RaymarchedField3D` |
| planned: `ThickSliceVolume3D` | |

Projections themselves (`PerspectiveProjection`, `OrthographicProjection`, `HyperplaneSlice4`) are first-class objects, not hidden defaults.

A projection is generally many-to-one, so traceability is not implemented by
pretending to invert a 3D coordinate. Render products carry the identity of the
source primitive or evaluation record alongside the representation. Exact
slices additionally have an affine lift back into their ambient hyperplane.
See [representation provenance](representation-provenance.md) for the current
lookup contracts and their precision boundary.

GPU field rendering is split at three explicit seams. `ImplicitFieldNode4` is
the mathematical realization and is always paired with its CPU
`ImplicitField4`; `RaymarchedField3D` owns ray transport and the live slice;
`RaymarchedFieldStyle3D` maps the packed record to color. A new field family can
therefore reuse the renderer without inheriting another family's palette or
copying its ray loop.

The CPU and GPU products share observable hit semantics. `traceFieldSliceRay3`
is the deterministic headless reference; `RaymarchedField3D.intersectRay()`
adapts a Three.js world-space ray and returns the slice-space hit, ambient R4
point, normal, and full CPU evaluation record. The fragment product writes the
marched surface depth—not its proxy cube depth—so ordinary scene depth testing
remains meaningful. Its monotonic `revision` is the invalidation boundary for
temporal render pipelines.

## 3. The n=3 invariant

**The 3D specialization must reproduce ordinary three.js behavior.** Holotope rotations, transforms, and projections at `dim: 3` are tested numerically against three.js `Matrix4` — if that suite fails, the N-D generalization has drifted from semantics users already trust. This is the project's core correctness contract.

## 4. Geometry is topology-first

`CellComplex` stores vertices in ambient Rⁿ plus cell groups by intrinsic dimension (edges, faces, 3-cells…), with `ambientDim` explicit on every object and never inferred from buffer sizes. Simplex-based algorithms (slicing, future volume/physics work) operate on tetrahedralized cells; `tetrahedralizeCuboidCells` provides the Kuhn 6-tetrahedra decomposition.

Topology-only operators preserve that separation. The unweighted graph
Laplacian is constructed from canonical 1-cell incidence and is invariant under
embedding, translation, rotation, and scale. Sparse `Lx` is the primary
contract; dense materialization and deterministic Jacobi modes are the
auditable reference path. Repeated eigenvalues are represented by clustered
eigenspaces and basis-independent projectors rather than unstable individual
eigenvector identities.

## 5. Rotations without quaternions

General N-D rotations are orthonormal matrices built from Givens plane rotations (`rotationInPlane`, `rotationFromPlanes`), with modified Gram–Schmidt re-orthonormalization to repair accumulated drift. Planned: pluggable backends — so(n) exponential map for integration, a paired-quaternion `Rotor4` fast path for the 4D case.

## 6. Numerical policies

- Float64 for all CPU math; Float32 only at the GPU boundary.
- Degeneracies are policy, not accident: slice distances snap to zero within epsilon and count as non-negative, so hyperplane-coincident cells are suppressed while neighbors emit shared faces exactly once — cross-sections are continuous as the slice reaches a boundary cell.
- Perspective divides are clamped, with proper 4D frustum clipping planned as an explicit stage.

## 7. CPU golden path before GPU

Every algorithm ships first as an auditable CPU reference implementation with conservation tests (e.g. tesseract boundary 3-volume = 64, cross-section area = 24 at every interior offset). GPU acceleration (three.js TSL vertex projection, WebGPU compute slicing) comes second and is validated against the CPU output via readback.

## 8. three.js version policy

`@holotope/three` pins a narrow tested peer range (currently `>=0.185.0 <0.186.0`) rather than claiming broad compatibility: the adapter will grow into TSL/WebGPU internals that change between three.js releases. Compatibility widens per release after testing, not by default.

## 9. Structured-space views retain provenance

Some higher-dimensional objects have exact algebraic models that admit several real readings. E8's icosian model, for example, stores four coordinates in Z[phi]; evaluating phi or its algebraic conjugate produces two complementary R4 views. The exact ring-valued point remains the identity, while either Float64 embedding is only a renderable view of it.

This extends the "last responsible moment" rule: an embedding may change metric relationships, so adjacency and shell membership are computed before conversion to Float64 and carried as provenance. A folded view never silently becomes the source object.

Cut-and-project follows the same rule. Lattice coefficients, parallel/internal projections, and convex-window membership stay in the exact ring. Enumeration always names a finite coefficient box, and equality at a window facet is reported as a singular boundary event with an explicit convention. Only accepted physical/internal coordinates are converted for display.

## Roadmap

1. ✅ Math kernel, cell complexes, polytopes, projections, CPU slicing, three.js adapter, tesseract demo
2. ✅ Rotation backends (`Rotor4`, so(n) exp), 4D camera/controls, projection provenance for picking
3. ✅ TSL vertex-stage projection and WebGPU compute slicing (CPU fallback retained)
4. ✅ Exact Coxeter/Wythoff construction and structured E8→H4 views
5. ✅ Cut-and-project foundation; Fibonacci, Ammann–Beenker, 3D AKN, and exact Elser–Sloane sections
6. ✅ Escape-time field core; CPU sampling, quaternion/bicomplex sliced products, both GPU differentials, quaternion ray marching, DE audits, slice redundancy, and Platonic tricomplex parameter certificates
7. ✅ Couplings; generic provenance decoration, canonical Elser–Sloane `c=pi_perpendicular`, exact H4 equivariance, skew-product rotor flow, and null/nontrivial periodic holonomy certificates
8. Materials/lighting policies for projected and sliced surfaces, transparency strategies
9. ✅ Spectral foundation: general symmetric eigensystems and combinatorial modes of any `CellComplex` 1-skeleton
10. ◐ `@holotope/physics`: convex R4 mass properties, ballistic bodies, scene synchronization, GJK with coherent caches, dimension-independent swept broadphase, conservative linear casts, and opt-in R4 event stepping, bounded general R4 EPA penetration, persistent clipped vertex-polytope manifolds with reusable dimension-independent facet topology, complete vertex-polytope/plane support-face contact, capability-aware narrowphase, exact N-D N-ball contacts, oriented-hyperbox and R4 mixed analytic contacts, persistent kinematics, coupled three-ball friction impulses, and deterministic mixed-shape orchestration; rotational CCD and joints pending
11. Formats: `.hyper.json` container, OFF import/export, glTF export with projected fallback
