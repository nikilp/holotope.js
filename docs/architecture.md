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

Projections themselves (`PerspectiveProjection`, `OrthographicProjection`, `HyperplaneSlice4`) are first-class objects, not hidden defaults. Orthographic
and perspective projections expose Float64 homogeneous matrices, packed
homogeneous evaluation, and exact affine inverse fibres. Perspective fibres
carry every stage's open validity half-space: final homogeneous depth alone
cannot certify an iterated projection when an earlier divide may have reached
its viewpoint.

A projection is generally many-to-one, so traceability is not implemented by
pretending to invert a 3D coordinate. Render products carry the identity of the
source primitive or evaluation record alongside the representation. Projected
segments and triangles additionally retain Float64 homogeneous evidence, so a
valid point on the selected nondegenerate source simplex has a
perspective-correct conditional lift. Exact slices have an affine lift back
into their ambient hyperplane. Selected-point precision and global projection
overlap remain separate facts.
See [representation provenance](representation-provenance.md) for the current
lookup contracts and their precision boundary.

The shared `RepresentationHitN` vocabulary lives in core, not in a renderer
adapter. Each hit carries a dimension-checked lineage of the actual operations
that produced it. Section, chart, projection, field restriction, sampling, and
ray realization remain distinct recipe kinds because they have different
precision and inverse semantics; there is no universal `invert()` facade.

Source-coordinate inference has the same separation. A deterministic Float64
linear-constraint primitive owns weighting, unit normalization, rank,
null-space priors, conditioning, and residual certificates. Edge parameters
and barycentric simplex weights both consume it, but their closed-segment and
closed-simplex domain policies remain distinct. A common solver therefore does
not pretend that unlike geometric parameterizations are interchangeable.
Longer-lived consumers compose these observations through immutable named
constraint-system snapshots. Stable keys identify replaceable evidence;
optional labels remain presentation metadata. Core owns copied coefficients
and targets, so a historical snapshot cannot change through caller mutation.

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

`CellComplex` stores vertices in ambient Rⁿ plus cell groups by intrinsic dimension, with `ambientDim` explicit on every object and never inferred from buffer sizes. `createHypercube` keeps edge/face/cube topology as its compatible default and can opt into higher cuboid cells through `maxCellDimension`. `simplexizeCuboidGroupN` applies the Kuhn decomposition in any practical intrinsic dimension and retains parent-cell plus local-permutation provenance; `tetrahedralizeCuboidCells` is its compatible six-tetrahedra cube wrapper. This lets simplex-based consumers distinguish a tetrahedralized boundary from an authored full-dimensional interior.

In-memory source-cell references anchor identity to a particular complex and
group object plus a group-local ordinal and vertex tuple. They survive geometry
and group-order changes but retire on topology replacement. For compatible
regeneration, `SourceCellIdN` adds the structural `(groupKey, ordinal)` layer
without replacing that fast object identity. Explicit `CellGroup.key` values
survive group reordering; unkeyed groups use a labelled order-derived fallback.
Resolution verifies ambient dimension, metadata, and the source vertex tuple,
so changed topology returns typed retirement evidence instead of silently
retargeting an observation.

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
- Every CPU section vertex may retain its source edge and exact interpolation
  parameter. Animated slice normals transport the preceding display frame by
  default; canonical axis-based recomputation remains an explicit option.
- The existing affine render path clamps perspective divides. Its homogeneous
  CPU reference does not hide that guard: it reports every intermediate raw
  denominator, the corresponding projective-domain margin, and whether the
  legacy path clamped. Proper geometric clipping remains a separate stage.

## 7. CPU golden path before GPU

Every algorithm ships first as an auditable CPU reference implementation with conservation tests (e.g. tesseract boundary 3-volume = 64, cross-section area = 24 at every interior offset). GPU acceleration (three.js TSL vertex projection, WebGPU compute slicing) comes second and is validated against the CPU output via readback.

## 8. three.js version policy

`@holotope/three` pins a narrow tested peer range (currently `>=0.185.0 <0.186.0`) rather than claiming broad compatibility: the adapter will grow into TSL/WebGPU internals that change between three.js releases. Compatibility widens per release after testing, not by default.

## 9. Structured-space views retain provenance

Some higher-dimensional objects have exact algebraic models that admit several real readings. E8's icosian model, for example, stores four coordinates in Z[phi]; evaluating phi or its algebraic conjugate produces two complementary R4 views. The exact ring-valued point remains the identity, while either Float64 embedding is only a renderable view of it.

This extends the "last responsible moment" rule: an embedding may change metric relationships, so adjacency and shell membership are computed before conversion to Float64 and carried as provenance. A folded view never silently becomes the source object.

Cut-and-project follows the same rule. Lattice coefficients, parallel/internal projections, and convex-window membership stay in the exact ring. Enumeration always names a finite coefficient box, and equality at a window facet is reported as a singular boundary event with an explicit convention. Only accepted physical/internal coordinates are converted for display.

## 10. Physics coordinates, bindings, and policies are separate layers

A mechanical coordinate should not be fused to one solver policy. Distance is
therefore evaluated first as dimension-independent geometry: displacement,
length, and unit gradient. `DistanceCoordinate4` then binds that coordinate to
R4 body-local or fixed-world anchors. Equality, closed-interval, and velocity-
motor behavior are separate policy objects over the same binding contract.

At the dynamics layer, `ConstraintRow4` represents one scalar R4 rigid
Jacobian. Optional generalized-force bounds make the same primitive support
unrestricted equalities, one-sided inequalities, and finite actuators. Bounds
are converted to impulse units using the fixed substep duration and projected
during iteration; saturation is judged by a projected KKT residual rather than
by an equality residual that cannot vanish at an active bound. Aggregate row
impulses, errors, and speeds remain coordinate-scale diagnostics, not physical
totals across heterogeneous Jacobians.

A closed distance interval is represented by two persistent unilateral
guardian rows, not by selecting one row before the solve. Their interior speed
targets bound the next first-order distance from both sides. Because both rows
remain in projected iteration, they can respond to unsafe velocity introduced
by another constraint after pre-solve observation. Crossing classification is
a separate diagnostic and never determines which rows enter the solver.
At exact anchor coincidence, the scalar gradient is singular: a solve must
name one positive direction branch and refuse transverse or negative-branch
motion rather than disguising it as the derivative of that scalar coordinate.

This layering preserves two boundaries. The reusable coordinate geometry does
not acquire R4 inertia assumptions, while the R4 solver retains all four
linear and six angular response coordinates instead of reducing mechanics to a
visible 3D representation. New policies can compose rows without redefining
the coordinate or weakening the Float64 CPU reference path.

Position-level compliance is a separate dimension-generic layer.
`XpbdConstraintSolverN` consumes RN point coordinates, inverse masses, scalar
equalities, and gradients. It implements the total-multiplier XPBD update with
physical compliance and explicit compliant residuals. It neither reuses an R4
rigid Jacobian incorrectly nor replaces the velocity/contact pipeline. Later
point-mass and deformable systems may consume this golden path; accelerated
backends must be tested against it.
`XpbdWorldN` is the first such consumer: it owns RN point prediction, constraint
projection, velocity reconstruction, force accumulation, and transactional
step semantics. It remains distinct from `PhysicsWorld4`, whose generalized
coordinates include Spin(4) orientation and bivector momentum.

Simplex measure has two deliberately separate contracts. A Gram determinant
provides unsigned intrinsic k-measure for any `k <= N`, including embedded
simplices. An ambient determinant provides signed measure only for an
N-simplex in R^N; SO(N) preserves that sign and reflection reverses it. The
second coordinate makes full-dimensional cell inversion observable, but its
XPBD equality is not a continuous no-inversion barrier. Neither contract
authors a missing normal frame or a recovery direction at deeper-rank
collapse.

`compileXpbdDistanceNetworkN()` is the first topology-to-simulation compiler.
The caller explicitly selects one two-vertex 1-cell group from a `CellComplex`;
the compiler creates one live particle per source vertex and one distance
constraint per selected source edge. Each edge product retains both an
in-memory source reference and a structural `SourceCellIdN`, while inverse
mass, gravity scale, velocity, and compliance remain separate material
policies. Simulation therefore does not reinterpret every geometric edge as a
physical spring.

Particles deliberately copy positions rather than aliasing the source buffer.
`writeSourcePositions()` is the explicit synchronization boundary: it validates
the complete particle layout and all edge lineage first, then updates the
source positions in one pass. Projection, slicing, spectral operators, and
rendering can consequently consume the same evolved topology without making
any lower-dimensional representation authoritative.

Rotational policies are classified by the stabilizer of the geometric datum
they preserve. Fixing one oriented direction leaves SO(3) free and produces a
three-row block; fixing an ordered orthonormal two-frame leaves only SO(2)
rotation in its complementary plane and produces five rows. Preserving an
oriented plane alone would instead leave an SO(2) x SO(2) torus. These remain
distinct public types—there is no dimensionally misleading universal “hinge.”
The one-dimensional SO(2) stabilizer admits a signed, continuously unwrapped
phase; the SO(3) direction stabilizer does not. Actuation is therefore added
only where subgroup geometry supplies an honest abelian coordinate.

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
10. ◐ `@holotope/physics`: convex R4 mass properties, ballistic and prescribed-kinematic bodies, scene synchronization, GJK with coherent caches, dimension-independent swept broadphase and XPBD scalar compliance including unsigned intrinsic and signed full-dimensional simplex coordinates, an RN point world and provenance-preserving `CellComplex` distance networks, conservative linear casts, explicit constant-generator R4 trajectories and conservative rigid casts, shared dynamic/kinematic pose plans, opt-in rotational R4 event stepping, bounded general R4 EPA penetration, persistent polytope manifolds, analytic mixed contacts, coupled three-ball friction, deterministic mixed-shape orchestration, point/distance policies, branch-aware SO(4) coordinates, common small equality and one-bounded blocks, direction preservation with its SO(3) stabilizer, planar SO(2) coordinates with torque-limited motors and continuous-angle guardians, and six-row fixed-relative-frame orientation joints; bending, inversion barriers and complete volumetric deformable systems, spatial trees, distance servos, rolling resistance, and sleeping pending
11. Formats: `.hyper.json` container, OFF import/export, glTF export with projected fallback
