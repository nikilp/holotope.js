# Holotope.js

N-dimensional geometry for TypeScript.

**[Live showcase →](https://nikilp.github.io/holotope.js/)** — dimension-traceable projections and cross-sections, source-space XPBD materials, exact constructions, inspectable fields, GPU realization, and R4 mechanics running in the browser.

Holotope.js is an experimental open-source library for building, transforming, projecting, and rendering higher-dimensional geometry on the web. It provides a modular foundation for 4D and N-dimensional visual systems, including vectors, transforms, projections, polytopes, cell complexes, and rendering adapters.

## Design thesis

Projection, slicing, higher-dimensional algebra, numerical simulation, and
scientific visualization each have deep existing traditions. Holotope does not
claim novelty for every constituent algorithm. Its purpose is to connect those
pieces into one accountable dimensional framework: an authoritative N-D source,
explicit lower-dimensional maps, traceable source identity, constrained
interaction through those maps, and simulation that continues to operate on the
source rather than its picture.

Established theory and compatible open implementations are inputs to that
framework when they survive the same requirements as native work: clear
attribution and licensing, an auditable Float64 CPU reference, explicit
degeneracy policy, and differential tests. The intended outcome is higher
dimensional intuition grounded in inspectable mathematics rather than isolated
visual effects.

## Architecture

Contact can also dissipate: friction enters the incremental objective as a
term that is conservative while one lag snapshot is frozen and dissipative
across accepted states, never as a post-solve velocity correction smuggled
into the minimizer. Contact constrains features, not just points: the exact
point–simplex path decides rank, zero distance, and the closest active face on
the supplied Float64 geometry, publishes one coherent witness with outward
error bounds, and lets step filters certify prefixes rather than collision
times. The generic moving simplex-pair path remains experimental while its
scale-dependent Float64 comparison policy is replaced. Higher-dimensional
state stays higher-dimensional until the last responsible moment. The
zero-dependency core does all N-D math in Float64 on the CPU; renderer adapters
turn explicit **projections** of that state into ordinary 3D objects.

```
@holotope/core            zero-dependency N-D kernel
  ├─ math                 VecN, MatN, exterior products, so(n) exp, Rotor4 (+slerp), TransformN
  ├─ geometry             CellComplex, opt-in N-cube cells, provenance-mapped Kuhn simplexization
  ├─ polytope             n-cube/simplex/orthoplex families; all six regular polychora; duoprisms
  ├─ lattice              exact E8/icosians; cut-and-project model sets and windows
  ├─ field                inspectable R4 Julia fields; exact tricomplex Mandelbrot parameter slices
  ├─ coupling             provenance-driven parameters and exact equivariance certificates
  ├─ spectral             symmetric eigensystems and CellComplex graph-Laplacian modes
  ├─ projection           CameraN, homogeneous N→3 maps, inverse fibres, simplex lifts, slicing;
  │                       RN affine charts and simplicial sections with composable source weights
  ├─ representation       map lineage, source references, and renderer-independent hit results;
  │                       candidate grouping separates point ambiguity from acting-target count
  └─ coxeter              exact Coxeter groups, Wythoff construction of the uniform polychora

@holotope/three           three.js adapter (three as peer dependency)
  ├─ ProjectedEdges3D     render product: projected 1-skeleton as LineSegments
  ├─ ProjectedSurface3D   render product: projected 2-faces as a translucent Mesh
  ├─ SlicedComplex3D      render product: exact 4D cross-section, with picking provenance
  ├─ SectionChart3D       render product: RN sections in their own chart, ancestry through picks
  ├─ SampledSlicedField3D render product: sampled implicit-field section with retained records
  └─ DragRotation4D       pointer controls for rotating through hidden planes

@holotope/three/webgpu    WebGPU/TSL fast paths (WebGPURenderer)
  ├─ ProjectedEdgesGPU    4D→3D projection in the vertex shader; updates are uniforms-only
  ├─ SlicedComplexGPU     marching-tetrahedra slicing in a WGSL compute shader
  ├─ QuaternionJuliaGPU   packed-point field evaluation with readback for CPU differential checks
  ├─ BicomplexJuliaGPU    two-factor field evaluation with record-level CPU differential checks
  ├─ RaymarchedQuaternionJulia3D adaptive fragment-stage slicing without a voxel mesh
  └─ RaymarchedBicomplexJulia3D product-distance ray marching after exact factorization

@holotope/physics         headless higher-dimensional mechanics
  ├─ mass properties      convex R4 volume, COM, covariance, and principal inertia,
  │                       by complex integration or in closed form for a glome or hyperbox
  ├─ RigidBody4           world bivector momentum + Spin(4) orientation
  ├─ PhysicsWorld4        fixed-step gravity, force, torque, and ballistic integration
  ├─ ObjectN binding      fixed-step pose snapshots and renderer-neutral interpolation
  ├─ collision queries    support/GJK, swept broadphase, linear CCD, EPA, polytope manifolds
  ├─ narrowphase          typed distance, shallow, penetration, deep-manifold capabilities
  ├─ contact response     warm-started normal impulses + coupled R4 friction ball
  ├─ contact pipeline     mixed glomes, planes, hyperboxes, vertex polytopes
  ├─ exact sections       R3 sections of a moving R4 glome, hyperbox, or authored complex
  ├─ rigid constraints    scalar rows + 1..6-row blocks; point and stabilizer-classified rotation joints
  ├─ distance policies    N-D geometry + R4 equality, guardians, and motor bindings
  ├─ material geometry    typed StVK/Neo-Hookean + smooth measure barrier + guards
  ├─ RN stepping          XPBD contact/friction + transactional adaptive subdivision
  └─ hyperbox pipeline    specialized homogeneous box orchestration

@holotope/experiment      versioned experiment documents and headless compilation
@holotope/experiment-physics  physics model capability for experiment documents
  ├─ intake               bounded JSON parsing with duplicate-key evidence
  ├─ validation           typed structural, reference, dimension, frame, and unit refusals
  ├─ preparation          canonical JSON, SHA-256 identity, immutable copy, dependency order
  └─ compilation          explicit caller capabilities, registry-owned ids, derived lineage
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

## Documentation

**[Documentation site →](https://nikilp.github.io/holotope.js/docs/)** — the guide plus a
generated API reference for every exported symbol, with full-text search across both.

New here? Read [the mental model](docs/learn/mental-model.md) first — it is the one page that
explains why a projected mesh is never the source object — then work from
[the cookbook](docs/learn/cookbook.md).

| Guide | What it answers |
| --- | --- |
| [Mental model](docs/learn/mental-model.md) | How source, representation, interaction, and simulation relate |
| [Architecture](docs/learn/architecture.md) | The decisions that shape the library, and why |
| [Experiment documents](docs/learn/experiment-documents.md) | Safe authored recipes and their headless explicit-capability compilation |
| [Build a dimension bridge](docs/learn/source-retained-dimension-bridge.md) | The complete typed pipeline end to end: one R4 body, a rigid model, three views, and an honest pick |
| [Cookbook](docs/learn/cookbook.md) | Verified task-oriented recipes |
| [Representation provenance](docs/learn/representation-provenance.md) | Tracing a 3D pick back to its N-D source |
| [Mechanics](docs/learn/physics/) | Mass, rigid bodies, collision, contact, constraints, XPBD |
| [Exact constructions](docs/learn/theory/model-sets.md) | Cut-and-project, [E8 folding](docs/learn/theory/e8-folding.md), [fields](docs/learn/theory/implicit-fields.md), [spectra](docs/learn/theory/spectral-analysis.md) |
| [Provenance-driven decorations](docs/learn/couplings.md) | Assigning parameters from retained source identity |

[`llms.txt`](llms.txt) is the concise AI-assistant context file.

## Roadmap (abridged)

- ✅ Rotation backends: so(n) exponential map, paired-quaternion `Rotor4` fast path + slerp
- ✅ 4D camera/controls; map lineage, projected-simplex lifts, and edge-exact slice provenance
- ✅ WebGPU/TSL acceleration: vertex-stage 4D projection, compute-shader slicing
- ✅ Wythoff construction: exact face lattices for the uniform polychora (all rank-4 groups, snub 24-cell, grand antiprism)
- ✅ Exact E8 root orbit + icosian folding into conjugate 4-spaces
- ✅ Exact cut-and-project foundation + symbol-exact Fibonacci model set
- ✅ Exact window-pruned model-set enumeration with exhaustive differential oracle
- ✅ Ammann–Beenker octagonal model set with exact 8-fold symmetry and silver inflation
- ✅ 3D Ammann–Kramer–Neri model set with a derived 30-facet triacontahedral window
- ✅ Elser–Sloane canonical model set: 720-vertex window, complete E8 shell bounds, inflation, exact 3D sections
- ✅ Escape-time field core: R4 Julia products, GPU differentials, DE audits, and certified Platonic tricomplex parameter slices
- ✅ Canonical couplings: Elser–Sloane internal-coordinate decoration, exact H4 equivariance, skew-product rotor flow, and periodic holonomy certificates
- ✅ Spectral foundation: deterministic symmetric eigensystems and dimension-independent CellComplex graph-Laplacian modes
- ✅ Source-coordinate constraints: deterministic weighted Float64 solving with shared compatibility, rank, null-space, conditioning, and residual diagnostics
- ✅ Immutable named constraint composition with stable evidence replacement, removal, snapshots, and keyed diagnostics
- ◐ Versioned experiment documents: bounded intake, validation, canonical identity, dependency planning, explicit-capability source/model/representation compilation, live parameter reads and writes, bounded actions, stamped observations, exact CPU snapshots, traces, replay, and renderer-deferred presentation panes shipped. Source vocabulary now includes an exact N-dimensional hyperrectangle, whose unequal edges give a body non-isotropic R4 inertia; the dimension-bridge example compiles its whole scene — source, rigid model, and three representation maps — from one typed document. Presentation remains renderer- and application-owned; broader descriptor vocabularies remain
- ✅ Published-artifact conformance: the five package tarballs are packed once, installed into a project outside every workspace, and exercised through their public entry points — strict declarations, runtime composition, representation claims, and a browser production build — before the same bytes are published
- ◐ GPU realization. Shipped: vertex-stage 4D projection, compute-shader
  marching-tetrahedra slicing, and packed-point field evaluation with readback for
  CPU differential checks. Remaining: broader GPU coverage of the product surface,
  streaming/zero-copy geometry upload, and the materials/transparency phase
- `.hyper.json` container format and OFF import/export
- ◐ `@holotope/physics`. Read **Current limitations** before deciding whether this
  fits your problem; everything else here is what exists inside them.

  **Shipped — mechanics.** Ballistic and prescribed-kinematic R4 bodies,
  fixed-clock animation-to-trajectory driving, intrinsic density-based simplex
  mass lumping, and a renderer-neutral RN point world. Linear CCD, conservative
  rotational casts, a shared pose-plan event loop, bounded R4 EPA penetration,
  persistent clipped polytope manifolds, analytic mixed contact, coupled
  three-ball friction, and deterministic mixed-shape response. Branch-aware SO(4)
  coordinates, exact small equality and one-bounded blocks, SO(3)-stabilizer
  direction, SO(2)-stabilizer planar rotation with motors and continuous-angle
  guardians, and six-row fixed-relative-frame orientation joints.

  **Shipped — deformables and contact.** Typed StVK and compressible
  Neo-Hookean materials with exact matrix-free constitutive Hessian-vector
  products. Source-retained barriers for a point against a static plane, a finite
  simplex, and a convex hull, each with typed refusals and a paired
  convexity/Lipschitz prefix filter. **Source-simplex feature contact** (v0.0.15):
  `evaluateSourceSimplexPairDistanceN` returns the exact closest-point distance
  between two source-retained simplex features in any dimension as a typed union —
  `separated-unique` with a uniqueness gap, `separated-multiple` carrying every
  tied witness and no gradient, `zero-distance` with no invented normal, and
  `indeterminate` with its own residuals — plus a clamped-log pair barrier, a
  two-sided Lipschitz step filter certifying a conservative prefix, and a
  per-source-cell family against one static opposing feature. **Lagged pair
  friction** (v0.0.16) with length- and velocity-authored regularization that
  freezes the resolved length into each lag. Source-retained discrete cosine-fold
  bending with a closed-form gradient, exact rigid null modes, and a paired
  intrinsic-rank segment certificate.

  **Shipped — solvers and numerics.** One world-scoped nonlinear advance deriving
  dimension, particle order, gravity and conservative providers from an authored
  world, refusing unrepresentable registrations rather than skipping them.
  Mass-weighted incremental objectives, deterministic free-coordinate packing,
  first-order Armijo backtracking, ordered admissible-step filters, matrix-free
  preconditioned-CG Newton directions with explicit unsupported-provider and
  non-positive-curvature evidence, opt-in dense provider-local and exact
  provider-block PSD curvature, and atomic converged-result application with
  staleness proofs. A **convergence-policy union** (v0.0.16) separating the legacy
  packed-gradient norm from a maximum per-particle acceleration residual — neither
  criterion is presented as universally superior. Projected Float64 XPBD relations
  with exact RN particle–hyperplane contact, post-projection velocity policies,
  bounded transactional adaptive subdivision, isotropic particle–plane Coulomb
  friction, timestep-invariant damping, and distance plus unsigned and
  full-dimensional signed simplex compliance. An **exact-rank embedded-simplex
  measure** (v0.0.17) evaluated through the Cauchy–Binet sum of squared minors,
  improving conditioning from about `ε·κ²` to about `ε·κ`, with every minor's rank
  decision made exactly by fraction-free `BigInt` elimination rather than a fitted
  tolerance.

  **Current limitations.**

  - **Contact candidates are authored, not automatic.** Feature pairs are named
    by the caller or enumerated per source cell against **one static** opposing
    feature. There is no automatic active-set search, no self-contact, no
    mesh–mesh CCD, and no moving-obstacle family. Cloth, stacked deformables and a
    rod in a knot remain out of reach.
  - **Contact stiffness follows mesh topology in the per-cell families.**
    Their contact energy is a sum over source cells, so a closest approach on a
    shared sub-feature contributes one term per adjacent cell, and a stiffness
    tuned on one mesh does not transfer to a refinement of it. Lagged friction
    inherits this: its effective coefficient follows contact-term multiplicity,
    and it demonstrates sliding deceleration, not static friction or sticking.
    `compileXpbdSourceSimplexMeasureBarrierN` is the reference-measure
    alternative: it carries a cell's rest measure once, so splitting a cell does
    not answer twice and the weighting stops following cell count. That is
    measure consistency, **not** invariance under subdivision and not a
    continuum bound — the integrand is a nonlinear barrier under a fixed finite
    quadrature.
  - **Spatial acceleration is opt-in and static-only.** A compiled AABB hierarchy
    over an unmoving obstacle is selected explicitly and refuses a moved source
    rather than rebuilding.
  - **The linear solve is matrix-free** — a preconditioned conjugate gradient
    rather than a sparse direct factorization. That is a convergence limit rather
    than a speed one, since the barrier Hessian conditions like `1/d²` as a gap
    closes.
  - **A world carries two solver paths and they are alternatives, not stages.**
    Projected XPBD applies registered constraints, responses and guards; the
    optimization path represents none of the three and refuses their presence by
    name. Pick one per physical interval.

  **Reference-measure surface contact — shipped in v0.0.20.**
  `compileXpbdSourceSimplexMeasureBarrierN` weights contact by a source cell's
  **reference** k-measure and averages a clamped-log barrier over fixed interior
  nodes, rather than summing a term per cell at its vertices. It compiles one
  conservative provider and one paired step filter for `k = 1, 2, 3` — the range
  over which the exact point–simplex query publishes a direction enclosure. The
  current-measure form and a caller-authored force-usability policy remain held
  back for want of a certified enclosure of the assembled contact force.

  **Longer-term research.** Cached sparse/global PSD assembly and globally
  admissible Newton material stepping; automatic and dynamic broadphase with
  moving-source refit and deformable–deformable candidate generation;
  continuum-convergent shell bending; topology-independent contact and friction
  density; self-contact and mesh–mesh continuous collision; distance servos;
  rolling resistance; and sleeping.

## License

MIT
