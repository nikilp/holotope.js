# Changelog

## v0.0.8

### `@holotope/physics@0.0.8`

**Breaking.** `XpbdIncrementalPotentialDirectionPolicyN.evaluate()` now returns
a discriminated outcome — a packed direction, a proposal carrying evidence, or
an explicit refusal — instead of `ArrayLike<number>` alone. Implementations
returning a bare packed direction are unaffected. Callers invoking `evaluate()`
directly and using the result as an array must narrow first.

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
- Added a transactional one-step wrapper that compiles, minimizes, and applies
  within a single boundary, refusing stale particle state without mutation.
- Added the compactly supported C2-clamped log barrier and an RN
  particle–hyperplane barrier potential over an open admissible domain, where
  contact is a typed range refusal rather than a large number.
- Added collision-free incremental-potential step filters that certify a
  requested particle-space segment, limit it to a strict prefix, or refuse —
  an indeterminate result being a refusal, never a missed collision.
- Added source-indexed particle–hyperplane barrier families that compile one
  barrier and one admissible-step filter per source vertex, so the two cannot
  drift apart, with per-vertex scalar policies.
- Added a matrix-free incremental-potential curvature reference: a centered
  gradient difference costing two evaluations regardless of coordinate count,
  usable as a differential oracle for the analytic path.
- Added exact analytic Hessian-vector composition over compiled providers,
  preflighting the complete authored provider list and naming every
  incapable provider before requesting any partial product.
- Added exact analytic curvature for the St. Venant–Kirchhoff, compressible
  Neo-Hookean, and C2-clamped lower-measure-barrier simplex laws. Products are
  translation invariant exactly, and the measure barrier contributes exactly
  zero outside its compact activation support.
- Added incremental-potential direction policies, including a mass-diagonal
  preconditioner. It turns the search direction only when free particles differ
  in mass; under uniform mass it rescales, and the line search owns step length.
- Added a bounded matrix-free Newton-direction reference: preconditioned
  conjugate gradients over the analytic objective product, refusing incomplete
  provider mixtures and non-positive curvature rather than returning a falsely
  certified direction.
- Added the Newton direction as a composable direction policy. A rejected
  curvature ray stays rejected and the minimization terminates as
  `direction-refused` with the rejected ray, product, quadratic form, and
  threshold retained. Continuing first-order past a refusal is authored, never
  inferred. Steepest descent remains the default everywhere.
- Fixed `EstimateEpaResult4` collapsing an absent error bound into zero, which
  reported an unbounded result as exact.
- Exported the value-policy type and other types that public signatures already
  named.

### `@holotope/core@0.0.8`

- Added exact window-pruned model-set enumeration. Choosing the strategy
  changes the work and never the answer: pruning rejects only coefficient
  prefixes whose every completion already lies outside a window halfspace, and
  equality is never pruned, so both strategies return identical points, order,
  and boundary classification.
- Re-orthogonalized `CameraN.lookAt()` after near-axis cancellation and made
  its strict frame proof deterministic across local and release runners.
- Exported types that public signatures already named.

### `@holotope/three@0.0.8`

- `SlicedComplex3D.update()` now rejects a transform whose dimension does not
  match its source complex, instead of producing a silently wrong section.
- Exported types that public signatures already named.

### `@holotope/experiment@0.0.8`

- Added the first inert `holotope.experiment/0` document contract for authored
  sources, models, representations, parameters, actions, observations,
  presentation panes, and backend requirements.
- Added bounded raw JSON intake that retains duplicate-key evidence and rejects
  prototype-sensitive keys, plus non-mutating structural and semantic
  validation with typed JSON-Pointer failures.
- Added canonical JSON preparation with stable dependency order, SHA-256
  document identity, an independent copied value, and deep freezing.
- Added headless compilation through explicit caller-supplied capabilities into
  a registry of live core objects. Documents can never name, request, or load a
  capability, and lineage is derived from the constructed object rather than
  from the descriptor.
- Added a document-level integer clock and an abstract compiled-model contract
  expressible in core types alone, so the registry can drive a model whose
  mathematics it does not depend on. A representation following a model
  compiles to a pose *binding* rather than a copied transform.
- Added the parameter and observation surface. Parameter state is read-through
  — the compiled object is the state — and a monotone revision counter bumps
  once per accepted mutation. Observation records are freshly computed and
  stamped with the revision and step they were computed at; staleness is a
  caller-side comparison, not a flag. Count observations report what a product
  actually emits, never an ideal-shape count.
- Added snapshots, traces, and replay. Numeric state travels as little-endian
  Float64 in base64 rather than JSON numbers, so signed zero and denormals
  survive. Restore is transactional and bound to `documentHash`; it sets the
  clock from the snapshot and bumps the revision. Replay re-executes recorded
  events through the public mutation paths. Only the `exact-cpu` replay level
  is emitted; the weaker levels are declared but not yet produced.

### `@holotope/experiment-physics@0.0.8`

- New package. Compiles `physics.model.rigid4` descriptors into live R4 rigid
  bodies driven by the document clock, and implements the model capability
  seams for field application, observation, and state capture/restore.
- The pose a representation reads is motion relative to where the source
  geometry was authored, not the body's principal frame, so it is exactly
  identity at rest and the source complex is never rebased.
- Kept as its own package so `@holotope/experiment` stays core-only and no
  physics consumer inherits an experiment dependency.

### Showcase

- Added a live code playground that runs each documented example beside its
  result, with alternative examples reachable and the viewport dropped when an
  example computes rather than draws.
- Fixed the section viewer reporting a bare zero for a cut lying outside the
  solid, a slider readout that changed width while dragging, and an embedded
  panel that clipped its last reading.

### Documentation

- Linked types borrowed across package boundaries, which previously rendered as
  plain text; an unresolvable link is now a build failure rather than a silently
  degraded name.
- Added a coverage-leverage report and per-package documented/total figures
  beside the regression gate.

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
