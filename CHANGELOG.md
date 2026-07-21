# Changelog

## Unreleased

### `@holotope/physics`

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
