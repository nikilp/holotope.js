# Architecture

Decisions that shape Holotope.js, with their reasoning. Status: living document; the API is pre-1.0 and expected to move, but these foundations are meant to hold.

## 1. N-D kernel + renderer adapters, never a fork

GPU rasterization consumes 3D clip space and produces 2D fragments — there is no "native N-D rendering" at the hardware level. Every higher-dimensional system therefore ends in a 3D visualization product. Given that, the design is:

- **`@holotope/core`** — a zero-dependency kernel where all N-dimensional state lives and stays N-dimensional until the last responsible moment. Float64 on the CPU is the source of truth.
- **Renderer adapters** (`@holotope/three` first) — thin packages that turn *projections* of that state into ordinary renderer objects. three.js is a peer dependency, never forked and never subclassed: its 3D assumptions (`Vector3` positions, quaternions, frusta) are load-bearing, and quaternions do not even generalize past 4D.

## 2. Render products are explicit

"Show me a 4D object" has several honest answers that solve different problems and must not be conflated — wireframe projection, exact cross-section, thick-slice volume, implicit raymarching. Each is a named class with its own correct behavior for picking, sorting, and transparency:

| Product | What it is |
|---|---|
| `ProjectedEdges3D` | the 1-skeleton, projected N→3, as line segments |
| `SlicedComplex3D` | exact hyperplane cross-section of tetrahedral cells, as a mesh |
| planned: `ProjectedSurface3D`, `ThickSliceVolume3D`, `RaymarchedField3D` | |

Projections themselves (`PerspectiveProjection`, `OrthographicProjection`, `HyperplaneSlice4`) are first-class objects, not hidden defaults.

## 3. The n=3 invariant

**The 3D specialization must reproduce ordinary three.js behavior.** Holotope rotations, transforms, and projections at `dim: 3` are tested numerically against three.js `Matrix4` — if that suite fails, the N-D generalization has drifted from semantics users already trust. This is the project's core correctness contract.

## 4. Geometry is topology-first

`CellComplex` stores vertices in ambient Rⁿ plus cell groups by intrinsic dimension (edges, faces, 3-cells…), with `ambientDim` explicit on every object and never inferred from buffer sizes. Simplex-based algorithms (slicing, future volume/physics work) operate on tetrahedralized cells; `tetrahedralizeCuboidCells` provides the Kuhn 6-tetrahedra decomposition.

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

## Roadmap

1. ✅ Math kernel, cell complexes, polytopes, projections, CPU slicing, three.js adapter, tesseract demo
2. Rotation backends (`Rotor4`, so(n) exp), 4D camera/controls, projection provenance for picking
3. TSL vertex-stage projection and WebGPU compute slicing (CPU fallback retained)
4. Materials/lighting policies for projected and sliced surfaces, transparency strategies
5. `@holotope/physics`: N-D rigid bodies (bivector angular momentum), GJK in Rⁿ
6. Formats: `.hyper.json` container, OFF import/export, glTF export with projected fallback
