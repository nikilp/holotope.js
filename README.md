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

Higher-dimensional state stays higher-dimensional until the last responsible moment. The zero-dependency core does all N-D math in Float64 on the CPU; renderer adapters turn explicit **projections** of that state into ordinary 3D objects.

```
@holotope/core            zero-dependency N-D kernel
  ├─ math                 VecN, MatN, exterior products, so(n) exp, Rotor4 (+slerp), TransformN
  ├─ geometry             CellComplex, opt-in N-cube cells, provenance-mapped Kuhn simplexization
  ├─ polytope             n-cube/simplex/orthoplex families; all six regular polychora; duoprisms
  ├─ lattice              exact E8/icosians; cut-and-project model sets and windows
  ├─ field                inspectable R4 Julia fields; exact tricomplex Mandelbrot parameter slices
  ├─ coupling             provenance-driven parameters and exact equivariance certificates
  ├─ spectral             symmetric eigensystems and CellComplex graph-Laplacian modes
  ├─ projection           CameraN, homogeneous N→3 maps, inverse fibres, simplex lifts, slicing
  ├─ representation       map lineage, source references, and renderer-independent hit results
  └─ coxeter              exact Coxeter groups, Wythoff construction of the uniform polychora

@holotope/three           three.js adapter (three as peer dependency)
  ├─ ProjectedEdges3D     render product: projected 1-skeleton as LineSegments
  ├─ ProjectedSurface3D   render product: projected 2-faces as a translucent Mesh
  ├─ SlicedComplex3D      render product: exact 4D cross-section, with picking provenance
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
  ├─ mass properties      convex R4 volume, COM, covariance, and principal inertia
  ├─ RigidBody4           world bivector momentum + Spin(4) orientation
  ├─ PhysicsWorld4        fixed-step gravity, force, torque, and ballistic integration
  ├─ ObjectN binding      fixed-step pose snapshots and renderer-neutral interpolation
  ├─ collision queries    support/GJK, swept broadphase, linear CCD, EPA, polytope manifolds
  ├─ narrowphase          typed distance, shallow, penetration, deep-manifold capabilities
  ├─ contact response     warm-started normal impulses + coupled R4 friction ball
  ├─ contact pipeline     mixed glomes, planes, hyperboxes, vertex polytopes
  ├─ rigid constraints    scalar rows + 1..6-row blocks; point and stabilizer-classified rotation joints
  ├─ distance policies    N-D geometry + R4 equality, guardians, and motor bindings
  ├─ material geometry    typed StVK/Neo-Hookean + smooth measure barrier + guards
  ├─ RN stepping          XPBD contact/friction + transactional adaptive subdivision
  └─ hyperbox pipeline    specialized homogeneous box orchestration

@holotope/experiment      inert, versioned experiment documents
  ├─ intake               bounded JSON parsing with duplicate-key evidence
  ├─ validation           typed structural, reference, dimension, frame, and unit refusals
  └─ preparation          canonical JSON, SHA-256 identity, immutable copy, dependency order
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
| [Experiment documents](docs/learn/experiment-documents.md) | Safe, discoverable authored recipes for future headless compilation |
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
- ◐ Versioned experiment documents: bounded intake, validation, canonical identity, and dependency planning shipped; capability compilation, runtime actions, observations, and replay pending
- GPU surface/section rendering and the materials/transparency phase
- `.hyper.json` container format and OFF import/export
- ◐ `@holotope/physics`: ballistic and prescribed-kinematic bodies, fixed-clock animation-to-trajectory driving, support/GJK, dimension-independent swept broadphase, typed StVK, compressible Neo-Hookean, smooth lower-measure and point–hyperplane barrier references with provenance-preserving generic family assembly and exact matrix-free constitutive Hessian-vector products, candidate-state conservative energy, mass-weighted incremental objectives, deterministic free-coordinate packing, first-order Armijo backtracking, ordered admissible-step filters with an exact RN point–static-plane specialization and source-indexed paired barrier/filter families, bounded non-mutating direction-policy references with steepest-descent and inertial-mass preconditioning, a bounded matrix-free preconditioned-CG Newton-direction diagnostic with explicit unsupported-provider and non-positive-curvature evidence, and atomic converged-result application with state/evidence staleness proofs, endpoint accepted-state guards, conservative full-dimensional orientation checks, and intrinsic embedded-simplex rank/measure checks along linear substep chords, intrinsic density-based simplex mass lumping, topology-neutral source-particle bindings with per-substep RN force providers, projected Float64 XPBD relations with exact RN particle–hyperplane contact, post-projection RN velocity policies, bounded transactional adaptive subdivision, isotropic particle–plane Coulomb friction, timestep-invariant damping, distance plus unsigned and full-dimensional signed simplex compliance, a renderer-neutral RN point world, provenance-preserving `CellComplex` distance networks, simplex families, and cuboid-to-oriented-simplex families, and linear CCD, explicit R4 rigid trajectories, conservative rotational casts, and a shared pose-plan event loop, bounded R4 EPA penetration, persistent clipped polytope manifolds, analytic mixed contact, coupled three-ball friction, deterministic mixed-shape response, point/distance policies, branch-aware SO(4) coordinates, exact small equality and one-bounded blocks, SO(3)-stabilizer direction, SO(2)-stabilizer planar rotation with motors and continuous-angle guardians, and six-row fixed-relative-frame orientation joints; PSD-projected and globally admissible Newton material stepping, automatic active-set mesh collision candidates and complete collision-filtered search, integrated optimization-world stepping, bending, collision-aware deformable systems, spatial trees, distance servos, rolling resistance, and sleeping remain

## License

MIT
