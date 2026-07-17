# Changelog

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
