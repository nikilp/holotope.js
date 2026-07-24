# Changelog

## Unreleased

### `@holotope/core`

- Re-orthogonalized `CameraN.lookAt()` after near-axis cancellation and made
  its strict frame proof deterministic across local and release runners.

### `@holotope/physics`

- Added pure candidate-state evaluation for conservative RN force providers,
  including non-mutating simplex-family `evaluateAt()` and identity-based
  assembly of trial potential energy and mathematical gradients.
- Added a non-mutating RN inertial predictor plus a scaled Backward-Euler
  incremental objective that composes particle mass, prescribed coordinates,
  and candidate conservative providers without claiming a nonlinear solver.
- Added deterministic dynamic-particle coordinate packing and an auditable
  Armijo backtracking reference that recovers only typed constitutive-domain
  refusals and never applies accepted candidates to live state.
- Added a bounded, deterministic steepest-descent reference over packed
  incremental objectives, with complete accepted-iterate evidence and typed
  convergence, budget, line-search, and Float64-stall terminal states.
- Bound every minimization result to its exact compiled one-step problem and
  added atomic converged-result application with defensive live-state
  snapshots, fresh evidence verification, explicit velocity/force policy,
  typed expected refusals, and rollback around final provider failures.

## v0.0.7

### `@holotope/core@0.0.7`

- Added opt-in higher-dimensional cuboid cells to `createHypercube()` while
  retaining byte-stable legacy groups by default, plus dimension-generic Kuhn
  simplexization with parent-cell and permutation provenance.
- Added author-keyed structural source-cell ids with typed resolution across
  compatible complex regeneration and explicit topology-retirement evidence.
- Added independent map/lineage capability queries and an auditable Float64
  forward evaluator for affine sections, slice charts, coordinate projections,
  orthographic projection, and certified perspective branches.

### `@holotope/three@0.0.7`

- Kept the three.js adapter aligned with the synchronized workspace release;
  the representation products introduced in earlier releases remain the
  renderer boundary for the new mechanics and lineage consumers.

### `@holotope/physics@0.0.7`

- Added an atomic dimension-generic Float64 XPBD scalar-constraint kernel with
  physical compliance, total-multiplier force and residual diagnostics, typed
  zero-response evidence, and an exact RN distance consumer.
- Added a renderer-neutral RN point-mass world with semi-implicit prediction,
  XPBD projection, velocity reconstruction, substep force semantics, registered
  ownership, and atomic position/velocity/force rollback.
- Added an explicit `CellComplex` 1-cell-to-XPBD compiler that preserves source
  vertex and edge identity, keeps material policy separate from topology, and
  validates lineage before atomically writing simulated RN positions back.
- Added a dimension-generic unsigned simplex squared-measure evaluator and XPBD
  constraint based on Float64 Gram determinants and cofactor gradients, with
  explicit compliance units, embedded-dimensional parity, and typed zero-
  response behavior for collapsed simplices.
- Added signed full-dimensional simplex measure and XPBD equality coordinates
  with analytic cofactor gradients, reflection/inversion observability, and an
  explicit distinction from no-tunnelling barrier constraints.
- Added a provenance-preserving `CellComplex` simplex-family compiler that
  shares existing RN particles, separates source-derived rest geometry from
  live state, and atomically attaches structurally identified constraints.
- Added a full-dimensional cuboid-to-oriented-simplex compiler that retains
  parent structural identity and Kuhn-permutation provenance while sharing an
  existing RN particle binding and attaching constraints atomically.
- Added dimension-independent simplex metric deformation with rest/current
  Gram metrics, right Cauchy–Green and Green–Lagrange tensors, principal
  stretches, measure ratio, conditioning evidence, and explicit embedded vs
  full-dimensional orientation semantics.
- Added traced simplex material assembly, source-particle lumped masses, and
  dimension-independent StVK and compressible Neo-Hookean constitutive
  reference paths with auditable energy, stress, and force diagnostics.
- Added RN point-contact inequality projection and tangent friction response
  without imposing renderer or R4-only assumptions on the deformable layer.
- Added accepted-state adaptive stepping with continuous full-dimensional
  orientation and embedded-simplex measure guards, so rejected candidates do
  not leak partial state into the simulation.
- Added a smooth C2-clamped logarithmic lower-measure barrier with a shared
  positive-measure constitutive branch, analytic forces, and explicit active-
  set evidence.

### Showcase

- Routed the canonical source-to-simulation markers through the headless
  lineage evaluator and exposed resolvable structural source ids.
- Added the dimensional mechanics workbench, relating the same constitutive
  experiment across an embedded R3 body and a full R4 body with live invariant
  evidence.
- Improved the tesseract page so a selected projected cut and its exact affine
  cross-section expose their source-cell correspondence in both views.

### Documentation

- Added a package-responsibility mental model, task-oriented cookbook, and
  concise AI context covering the source-to-representation-to-simulation
  pipeline and its principal public interfaces.

## v0.0.6

### `@holotope/core@0.0.6`

- Kept the core API aligned with the synchronized workspace release; no public
  core API changed since 0.0.5.

### `@holotope/three@0.0.6`

- Kept the three.js adapter aligned with the synchronized workspace release;
  no public adapter API changed since 0.0.5.

### `@holotope/physics@0.0.6`

- Added branch-aware relative SO(4) coordinates, analytic exponential and
  logarithm Jacobians, and the exact angular-velocity operator norm.
- Added a shared one-to-six-row equality-block solver with explicit rank
  policy, basis-invariant bias, transported warm starts, and full diagnostics.
- Added distinct direction-preservation and planar-rotation policies classified
  by their SO(3) and SO(2) stabilizers rather than an ambiguous “4D hinge.”
- Added an oriented planar-rotation phase with explicit branch tokens,
  multi-turn unwrapping, half-turn ambiguity, and angular-rate diagnostics.
- Extended the small-block solver with an exact one-bounded active set,
  Schur-complement elimination, equality-preserving warm transport, and
  projected KKT diagnostics.
- Added torque-limited planar SO(2) motors and two-sided continuous-angle
  guardians that remain coupled to all five frame constraints.
- Added a six-row fixed-relative-frame orientation joint with invariant
  frame-local SO(4) error, exact analytic rate rows, explicit branch history,
  and typed cut-locus refusal.
- Added explicit world-left R4 screw trajectories, auditable support-shape
  radius inference, and conservative rigid compact/compact and compact/plane
  casts using the exact SO(4) angular operator norm.
- Added frozen Lie-midpoint body pose plans and connected those same plans to
  rotational continuous-event casting and advancement, retaining exact
  no-impact parity with ordinary free flight.
- Added pose-owning `KinematicBody4` segments and coherent pose-pair trajectory
  construction, connecting authored motion to collider synchronization,
  contact velocity, discrete stepping, swept broadphase, and rigid CCD.
- Added `KinematicTrackDriver4`, which samples authored `Rotor4Track` motion on
  the fixed physics clock and extracts coherent linear and angular velocities
  for contact and continuous-collision consumers.

### Showcase

- Added a canonical source-to-simulation bridge: one authoritative R4 body
  feeds perspective, coordinate-subspace, and exact affine-section views.
- Added cross-view source-backed selection, explicit source-edge coordinates,
  retained material-point motion, named section-incidence policy, and compact
  lineage, ambiguity, numerical, and conservation evidence.
- Retained the original tesseract projection/cross-section page as the simpler
  foundation and fallback.

## v0.0.5

### `@holotope/core@0.0.5`

- Added homogeneous orthographic and iterated-perspective maps with explicit
  validity domains, affine inverse fibres, and conditional projected-simplex
  lifts.
- Added renderer-independent representation lineage, lifecycle-aware in-memory
  source-cell references, and exact section-edge construction provenance.
- Added source-edge and source-simplex coordinates plus a deterministic
  Float64 linear-constraint solver with compatibility, rank, null-space,
  conditioning, and residual certificates.
- Added immutable named constraint systems for stable evidence composition,
  replacement, removal, and reproducible snapshots.

### `@holotope/three@0.0.5`

- Connected projected edges, projected surfaces, exact sections, sampled
  fields, and WebGPU field hits to the shared representation-lineage contract.
- Added conditional ambient-point recovery for valid projected segments and
  triangles while preserving global projection-overlap ambiguity separately.
- Extended exact sliced-complex products with source-edge interpolation records
  for every emitted vertex.

### `@holotope/physics@0.0.5`

- Added coupled R4 point joints and a reusable force-bounded scalar rigid-body
  constraint row.
- Added dimension-independent distance-coordinate geometry with R4 equality,
  closed-interval guardian, and force-limited motor policies.
- Added projected KKT residuals, explicit coincidence branches, persistent
  warm starting, and deterministic multi-row diagnostics.

### Showcase

- Extended the projection/cross-section entry point with a live source trace:
  the exact affine slice reports its recovered R4 point, while the projected
  view retains source identity and explicitly reports inverse ambiguity.
- Clarified the public design thesis around accountable composition of existing
  mathematics rather than isolated higher-dimensional effects.

## v0.0.4

### `@holotope/core@0.0.4`

- Added deterministic symmetric eigensystems and graph-Laplacian modes for any
  `CellComplex` 1-skeleton, including canonical handling of repeated
  eigenspaces.
- Added renderer-independent implicit-field ray records and distance-estimator
  audit utilities.
- Extended R4 rotor/bivector operations and slice-source provenance used by
  animation, mechanics, and representation tracing.

### `@holotope/three@0.0.4`

- Added a unified representation-hit contract across projected surfaces,
  exact cross-sections, sampled fields, and WebGPU render products.
- Added reusable field relief and fractal-palette products.
- Reworked quaternion and bicomplex Julia ray marching around a shared implicit
  field realization with settled supersampling and CPU/GPU differential data.

### `@holotope/physics@0.0.1`

- Introduced momentum-primary R4 rigid bodies, exact convex mass properties,
  fixed-step world integration, and renderer-neutral pose binding.
- Added dimension-independent support shapes, GJK distance, conservative swept
  broadphase, linear time-of-impact casts, and analytic infinite-plane casts.
- Added bounded R4 EPA penetration, compiled convex-polytope topology, complete
  polytope and hyperbox contact manifolds, exact smooth/mixed contact families,
  and capability-aware narrowphase dispatch.
- Added persistent normal response with a coupled three-dimensional tangent
  friction ball, mixed collider orchestration, and opt-in continuous event
  stepping with explicit rotational and kinematic fallbacks.

### Showcase

- Clarified which pages demonstrate reusable dimensional primitives, exact
  mathematical consumers, and renderer/compute validation.
- Added source-trace language to the projection/cross-section entry point.
- Added a torque-free R4 rigid-body page comparing embedded R3 motion with
  coupled six-plane R4 motion and exposing conservation signals.
- Upgraded quaternion and bicomplex field pages with adaptive ray realization,
  inspectable sampled products, parameter controls, and artistic palettes.

## v0.0.3

- Added exact lattice/model-set foundations, higher-dimensional field products,
  certified couplings, R4 scene graphs, instanced rendering, and rotation
  animation.

## v0.0.2

- Added guided showcase narratives and responsive per-page explanations.

## v0.0.1

- Initial N-dimensional geometry, projection, slicing, and three.js adapter
  release.
