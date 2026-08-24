# Changelog

## v0.0.21

All five packages are synchronized at `0.0.21`. The substantive change is a
**behavioural correction** in `@holotope/physics`; the other four packages are
version-synchronized with no substantive behavioural change. The public surface
is additive against `0.0.20`: one interface added, nothing removed, renamed or
retyped.

### `@holotope/physics@0.0.21` — fixed

- **An automatically selected warm-start base is now certified by the
  registered step filters before it is installed.** The released composition
  installed the minimizer base without consulting any filter: an unsigned
  contact law calls a far-side placement feasible with energy exactly zero, so
  `feasible-inertial-prediction` — and the default `inertial-prediction` —
  could begin the solve on the other side of an obstacle, the minimizer
  converged at that base with no line-search segment for the filters to
  certify, and the world applied the full crossing while the paired filter,
  asked independently about the same movement, answered `limited`.
- **The rule is generic composition, not a law-specific patch.** The
  anchor-to-prediction displacement is submitted to every registered filter as
  one segment: `safe` installs the exact prediction — the installed base
  coordinates are bit-identical to the previous behaviour — `limited` installs
  the certified prefix (the filter's published maximum step LENGTH, converted
  through the requested length exactly once), and `indeterminate` installs the
  authored anchor, so an uncertifiable automatic movement does not happen. The
  `feasible-inertial-prediction` chord search then runs within the certified
  movement, and may settle shorter still; a prefix of a certified prefix is
  certified.
- **Filter authors: your filter is now consulted once more per step, at a new
  scale.** The certification calls every registered filter's `evaluate` once
  before the base is installed, with `requestedStepLength` equal to the packed
  Euclidean norm of the anchor-to-prediction displacement — not the Armijo
  line-search parameter (historically the default `1`). The contract was
  always parametric in the caller's scale; a filter that hardcoded a constant
  for a `safe` echo instead of returning `context.requestedStepLength` now
  fails loudly (`a safe evaluation must preserve requestedStepLength`) with
  full state rollback, instead of silently passing at one caller's scale.
- **An inadmissible authored state no longer self-recovers through an
  automatic warm start.** Filters refuse to certify any segment from a start
  inside their open boundary, so a scene whose previous positions violate a
  registered law's domain now refuses every automatic warm start —
  including a retreat away from the obstacle — where the previous behaviour
  jumped to any endpoint-feasible prediction through the same uncertified
  mechanism that tunnelled. Repair such a state explicitly with
  `initialPositions`, the documented uncertified bypass.
- **Point feasibility and segment admissibility stay separate evidence.** The
  new `warmStartCertification` field on the step result carries the per-filter
  records, the outcome, and the requested and certified lengths, alongside the
  existing `feasibleBaseRecovery` point evidence, and the step diagnosis
  surfaces both.
- **Migration — `feasibleBaseRecovery` fractions are in the certified frame.**
  This follows from the correction above and is intentional, not a defect:
  whenever registered filters certify a `feasible-inertial-prediction` movement
  to anything short of `safe`, the chord recovery is rebased onto the certified
  movement, so it runs from the authored anchor to the **certified endpoint**
  rather than to the inertial prediction. Its `fraction` one therefore means
  *the target the recovery was given* — the certified prefix under a `limited`
  outcome, and **the authored anchor itself under `indeterminate`**, where
  `target-feasible` with fraction one means nothing moved at all. A
  `target-feasible` result no longer implies the prediction was installed.
- **Who must migrate, and to what.** Code that reconstructed a coordinate as
  `anchor + fraction × (prediction − anchor)`, or that pinned a particular
  historical numeric fraction, must change. That reconstruction still agrees
  under a `safe` certification, when no filter is registered, and wherever the
  reported fraction is zero — which names the anchor in every frame. For every
  nonzero fraction under any other outcome it is wrong, and it is worst under
  `indeterminate`, where it
  returns the full inertial prediction while the step in fact moved nothing —
  the very coordinate the certification exists to refuse. **Do not guard the
  old formula on `outcome === 'limited'`.** Read the coordinate instead of
  rebuilding it: `feasibleBaseRecovery.evaluation.coordinates` for the accepted
  coordinate (absent on the `anchor-refused` result, which accepted none), or
  `minimization.initial.coordinates` for the base the solve started from
  (`minimization.initialCoordinates` on the `initial-state-refused` terminal,
  which accepted no base evaluation). The repository's own packed-consumer
  fixture is the worked example — its warm-start check now asserts
  `target-feasible` and the certification outcome instead of the numeric
  fraction it previously pinned, because the target itself is now the certified
  endpoint.
- **Unchanged by design:** explicit `initialPositions` remain the
  authoritative, uncertified bypass; `previous-positions` moves nothing and
  certifies nothing; with no filter registered, behaviour is identical — the
  guarantee is scoped to the filters actually registered and driven, never a
  universal continuous-collision claim.

## v0.0.20

All five packages are synchronized at `0.0.20`. The substantive change is
**purely additive** and is in `@holotope/physics`; the other four packages are
version-synchronized with no substantive behavioural change. Nothing released
at `0.0.19` changed behaviour.

### `@holotope/physics@0.0.20` — added

- **Measure-weighted normal contact.**
  `compileXpbdSourceSimplexMeasureBarrierN` compiles one conservative force
  provider and its paired step filter for the energy
  `E(q) = mu0 * sum_j w_j * psi(d_j(q) - dmin)`, where `mu0` is the deforming
  cell's reference k-measure, `w_j` is a fixed equal-weight rule over `k + 1`
  distinct strictly interior nodes, `d_j` is the exact distance from node `j`
  to the opposing source simplex, and `psi` is the released clamped
  logarithmic barrier at order 1.
- **A contact now resists by the size of the touching feature rather than by
  the number of vertices describing it.** The released pair family's summed
  energy is discretization-defined — four cells under one contact carry four
  terms — and this law carries the measure once instead, so splitting a cell
  does not answer twice.
- **That is measure consistency, not invariance under subdivision.** The
  integrand is a nonlinear barrier of a distance field and the rule is a fixed
  finite quadrature, so subdivision moves the sample locations and normally
  changes the estimate. Subdivision is exactly additive only when the sampled
  barrier is constant over the cell. Measured on two legal refinements of one
  source region: a tilted cell split in half changes by about 27%, and an
  uneven split of a curved arrangement by about 44%.
- **The refinement sequence converges to the continuum integral**, measured at
  second order in the cell size against an independent composite
  Gauss--Legendre reference built from the released exact query and barrier,
  with the single-cell estimate about 28% below the continuum value. That is a
  measurement on a named fixture; no truncation bound is proved or claimed.
- **The measure is the rest one, read once from the binding's validated
  snapshot and frozen.** That is what makes the published forces the complete
  gradient of the published energy; a current-measure weight would give the
  energy a second path through the cell's own deformation. It also means only
  the rest cell must be non-degenerate — a cell that degenerates at a
  candidate is evaluated normally, because a node is a fixed affine
  combination of its vertices either way.
- **The quadrature is fixed and not authorable.** It is a reference measure,
  not a quadrature with a truncation bound: the energy is the weighted node
  sum, so a refined rule would be a different law rather than a closer
  approximation of this one.
- **`maximumDirectionError` is required, with no default**, following the
  released point--simplex barrier: the exact query publishes a direction
  enclosure and no universal radius is right for every scene.
- **The law's non-authorable state is exposed as no public property, option or
  API.** The compiled terms are frozen objects carrying exactly the members the
  released provider and filter interfaces require; everything else lives in
  closure. There is no rule option to pass and no rule, reference measure,
  obstacle snapshot or conservative scale property to overwrite.
- **That is a statement about the public surface, not about observability.**
  Same-realm JavaScript metaprogramming — numeric accessors installed on
  `Array.prototype` before compilation, or a replaced inherited operation —
  can observe otherwise-private arrays, including the static-obstacle snapshot,
  the fixed rule and a private particle partition. Those arrays are frozen, so
  once the intrinsic is restored they cannot be modified to change a later
  evaluation. Ephemeral per-call geometry can be observed too, and retaining or
  mutating it cannot affect later evaluations either. The guarantee is about
  consequence, not concealment.
- **The provider's published `particles` are excluded from that guarantee, by
  design.** They are the caller's own live inputs, deliberately public, and
  moving them changes later evaluations — that is what a contact term reading
  live state is for.
- **The paired step filter reads geometry only at the segment start.** The law
  measures unsigned distance and has no notion of side, so a segment can begin
  above the obstacle and end below it with both ends admissible; an endpoint
  check would certify the tunnel. The two-sided Lipschitz bound is a lower
  envelope over the whole segment, taken from one placement, and certifies
  against the worst node.
- **Eleven typed refusal reasons**, each raised as the released
  `XpbdPotentialDomainErrorN` carrying the term's `id` as its `lawId`,
  including one-to-one forwarding of every exact point--simplex publication
  failure. Authored configuration — a rest-degenerate cell, a rank-deficient
  static obstacle, an obstacle binding contributing a particle that is not
  kinematic — stays a permanent `Error` and never enters that channel.

## v0.0.19

All five packages are synchronized at `0.0.19`. The substantive change — a
**breaking pre-1.0 contract change** — is in `@holotope/physics`; the other
four packages are version-synchronized with no substantive behavioural
change.

### `@holotope/physics@0.0.19` — breaking

- **Replaced the all-orders clamped-log barrier evaluator with a graded
  evaluator at a required derivative order.** `evaluateClampedLogBarrier`,
  which always computed the energy and both derivatives, is replaced by
  `evaluateClampedLogBarrierAtOrderN(inputs, order)`. This is a breaking
  pre-1.0 change: every caller must now say what it needs.
- **Orders 0, 1 and 2 publish only their requested prefix.** Order 0 returns
  the energy; order 1 adds the first derivative; order 2 adds the second.
  There is no way to receive a derivative that was not requested, and no
  cost is paid for one. Order 0 performs 2 core operations, order 1 performs
  4, order 2 performs 7, and the inactive clamp performs none.
- **Availability is per component, and non-monotone.** Each requested
  component is graded on its own account as
  `{ available: true, value }` or
  `{ available: false, reason: 'outside-float64' }` — with no `value` key at
  all when unavailable, so reading a number off it is a type error rather
  than a `NaN`. An energy may round to zero while its curvature is healthy,
  and a curvature may leave Float64 while the energy is representable;
  neither direction implies the other, and no component is withheld because
  another was unavailable.
- **A correctly rounded zero is an answer, not a refusal.** When the barrier
  is active and a component's exact value rounds to Float64 zero, it is
  published as `{ available: true, value: 0 }`. The `active` flag is what
  separates that underflow statement from the clamp's exact zero at and
  above the activation coordinate.
- **Runtime order validation, with no default and no fail-open path.** The
  signature rejects a wrong order at the type level, but types erase: any
  `order` that is not strictly `0`, `1` or `2` on arrival — including an
  omitted argument, a boxed `new Number(1)`, `true` or `"1"` — throws
  `ClampedLogBarrierInputErrorN`. There is no coercion, truthiness check,
  clamp or fallback, and in particular no silent promotion to order 2.
- **One captured scalar triple governs validation, computation and
  evidence.** Each of `coordinate`, `activation` and `stiffness` is read from
  the caller's object exactly once, into a frozen compiler-owned snapshot;
  that snapshot is then the only input validated, computed from and
  published as `result.inputs`. An accessor- or Proxy-backed input can no
  longer make the three answers disagree, and the caller's own object is
  never frozen. A getter that throws escapes unchanged, before any
  validation, arithmetic or result object exists.
- **All released callers were migrated to their own required order.** The
  hyperplane, source-simplex, source-simplex-pair, convex-hull family,
  simplex-measure material and pair-friction providers each request exactly
  the order they consume.
- **Difficult underflow, overflow and subnormal regimes are handled without
  the old all-or-nothing refusal.** The core sums exponent-tracked terms at
  a common scale with a single final rounding per output, so regimes where
  the previous evaluator threw outright now return, with each component
  graded independently.
- **Assembled directional-product representability remains caller-owned.**
  A scalar component may be finite and nonzero while its product with a
  caller's direction underflows or overflows; the scalar result cannot
  observe that composition, and the caller owns the diagnostic.
- **The evaluator is materially slower per scalar call** than the one it
  replaces, on inputs where both return. This was an accepted trade for
  graded availability, correct subnormal rounding and no-throw semantics on
  the open domain. The documentation reports per-call absolutes measured on
  one local environment, with the CPU and runtime named, and deliberately
  **claims no portable multiplier**: the ratio depends strongly on the
  requested order, varies run to run on a single machine, and has not been
  measured across hardware or runtimes.

### Unchanged in this release

- The exact point–simplex boundary and the source-simplex work introduced in
  `v0.0.18` are intact and unmodified.
- P66 surface-integral contact is **not** part of this release.

### `@holotope/core@0.0.19`, `@holotope/experiment@0.0.19`, `@holotope/three@0.0.19`, `@holotope/experiment-physics@0.0.19`

- Version-synchronized with `@holotope/physics`. No substantive behavioural
  change.

## v0.0.18

All five packages are synchronized at `0.0.18`; the substantive additions and
breaking pre-1.0 contract changes are in `@holotope/physics`.

### `@holotope/physics@0.0.18`

- Added `evaluateExactPointSimplexResult` for a point against a segment,
  triangle or tetrahedron. It treats each supplied Float64 as its exact dyadic
  value, decides affine rank, the closest active face and exact zero without a
  fitted tolerance, and publishes one coherent, frozen Float64 witness with
  source-ordered weights and outward-rounded error bounds.
- Replaced the point source-simplex barrier's tolerance-driven projection
  authority with explicit
  `projected`, `zero`, `rank-deficient` and `uncertified` outcomes. Publication
  failures distinguish weight underflow, value overflow, value underflow and
  accuracy-bound overflow rather than silently choosing a witness or leaking
  an untyped arithmetic error.
- Migrated the point source-simplex barrier and its compiled family to that
  exact boundary for simplex dimensions 1–3. Publication uncertainty and a
  caller-authored direction-error policy now leave through named
  `XpbdPotentialDomainErrorN` reasons; equality with the policy is admitted,
  and construction requires a finite `maximumDirectionError` in `(0, 2)` on
  the exact arm.
- Re-derived the paired step filter from the segment's certified start state.
  It now performs one exact query rather than querying an uncertifiable
  endpoint, forwards an unpublishable start without fabricated `NaN` evidence,
  and attaches a certification only when a positive prefix was actually
  proved.
- Added public regression ownership for the historical negative-barycentric,
  ill-conditioned active-face and extreme-scale publication failures, plus
  barrier, Armijo, world-step, family and packed-consumer composition.

The direction enclosure is a bound on the unit direction, not on the final
force, so `maximumDirectionError` is intentionally caller policy rather than a
library default. Point–simplex barriers of dimensions 4–17 retain the legacy
Float64 projector and no exact evidence claim; at `k = 17`, one `evaluateAt()`
was measured at roughly 7.8–12.2 seconds and is suitable only for offline
study. The broader moving simplex-pair query remains experimental: its current
comparison bands are not similarity-invariant at extreme scales, and this
release does not claim mesh–mesh contact or self-contact.

## v0.0.17

All five packages are synchronized at `0.0.17`; the behavioural change is in
`@holotope/physics`. No public symbol was added, removed, renamed or retyped.

### `@holotope/physics@0.0.17`

- Reworked `evaluateSimplexSquaredMeasureN` to evaluate the embedded-simplex
  Gram determinant through the Cauchy–Binet sum of squared minors, with value
  gradients derived from the same minors. This improves the conditioning
  signature from the Gram route's approximately `epsilon * kappa^2` to
  approximately `epsilon * kappa`; the remaining loss is in forming the edge
  differences, upstream of the determinant calculation.
- Made every minor's rank decision exact for the supplied Float64 coordinates:
  power-of-two-scaled integer entries are evaluated with fraction-free `BigInt`
  elimination. Exactly rank-deficient cells return exactly zero measure and
  gradients without a fitted tolerance, while positive cells as small as the
  pinned `2^-46` triangle are no longer mistaken for rank loss.
- Took the minor magnitude from the exact determinant as well as its zero/nonzero
  decision. This restores vertex-order symmetry and removes data-dependent
  pivoting noise that changed one unsigned measure by `2.345x` under a harmless
  permutation.
- Added public regression coverage for exact rank loss, a nearby positive cell,
  embedding, reflection, reordering, power-of-two scaling, gradient covariance,
  and all three downstream degeneracy guards.

The exact predicate is unconditional, not a rare fallback. Its cost depends on
integer width: the independently reviewed worst case was `8.00x` the v0.0.16
evaluator at R7/k4 with at least 1,260 `BigInt` allocations. No value-only fast
path is claimed, and no conditioning threshold or public surface-measure
quadrature API is introduced in this release.

## v0.0.16

All five packages published at `0.0.16`; the substantive additions are in
`@holotope/three` and `@holotope/physics`.

### `@holotope/three@0.0.16`

- Widened the tested Three.js peer range to `>=0.184.0 <0.186.0`, while keeping
  development, showcase, declarations and CDN reproduction pinned exactly to
  `0.185.1`.
- Added a packed-artifact compatibility gate that strict-typechecks and
  runtime-drives both ends of that declared range, including WebGL and WebGPU
  entry points.

### `@holotope/physics@0.0.16`

- Added source-retained lagged pair friction: explicit lag preparation,
  consumption and rollback; a conservative objective for one frozen lag; typed
  reuse and configuration refusals; and a family over the v0.0.15 deformable
  feature-contact terms.
- Added a convergence-policy union separating the legacy packed-gradient norm
  from a maximum per-particle acceleration residual. Neither criterion is
  presented as universally superior; their scaling and refinement behaviour are
  deliberately different.
- Added length- and velocity-authored friction regularization, freezing the
  resolved length into each lag so a step cannot change its own objective.
- Fixed source-simplex-pair witness weights drifting by Float64 roundoff into an
  untyped coordinate-constructor exception.

Lagged friction in this release demonstrates sliding deceleration, not static
friction or sticking. Its effective coefficient follows contact-term
multiplicity and therefore mesh topology. It does not provide self-contact,
moving-obstacle friction or mesh-independent tuning.

## v0.0.15

All five packages published at `0.0.15`; the substantive additions are in
`@holotope/physics`.

### `@holotope/physics@0.0.15`

- Added `evaluateSourceSimplexPairDistanceN`: the exact closest-point distance
  between two source-retained simplex features in any dimension, returning a
  typed union rather than a number — `separated-unique` with a uniqueness gap,
  `separated-multiple` carrying **every** tied witness and no gradient,
  `zero-distance` with no invented normal, and `indeterminate` with its own
  residuals. Witness weights are reported in each source reference's own vertex
  order on both sides.
- Added `XpbdSourceSimplexPairBarrierN`, the clamped-log barrier over that
  certified distance, distributing force through the witness weights; tied
  witnesses, certified zero distance, uncertified comparisons and the open
  minimum each refuse by type instead of fabricating a force.
- Added `XpbdSourceSimplexPairBarrierStepFilterN`, a two-sided Lipschitz step
  filter that certifies a **conservative prefix** of a proposed segment. It is
  not a collision time, and the point-to-convex-set filter's convexity shortcut
  is deliberately not reused — pair distance under independently moving
  vertices is not convex in the step parameter.
- Added `compileXpbdSourceSimplexPairBarrierFamilyN`: one barrier and one paired
  filter per source cell of a deforming simplicial group against **one static**
  opposing feature. No self-contact, no mesh–mesh CCD, no moving-obstacle
  family, no friction.

### `@holotope/core@0.0.15`

- `createSourceSimplexReferenceN`'s vertex floor widened from two to one, so a
  0-simplex is a legitimate feature and vertex–face pairs are expressible.

Contact energy is a **sum over source cells**: when the closest approach falls on
a sub-feature shared by several cells, each of those cells contributes a term
naming the same witness at the same distance, so effective contact stiffness
follows local mesh topology. A stiffness tuned on one mesh does not transfer to
a refinement of it.

## v0.0.14

### `@holotope/core@0.0.14`

- Added the display-map taxonomy: `DisplayMap3D` as the contract a render
  product actually consumes, with `Projection` a type-identical specialization
  of it, plus `InvertibleDisplayMap3D` and the `isInvertibleDisplayMap3D`
  capability probe. Non-breaking by construction — no member was added,
  removed, renamed or retyped on `Projection` or its subtypes.
- Added `PlaneEmbedding3D`, the exact `[x, y] → [x, y, 0]` coordinate-plane
  embedding: injective, with a unique inverse on its `z = 0` image and a typed
  `off-image` status carrying the distance rather than a fabricated nearest
  point. It implements neither the fibre nor the homogeneous surface, because an
  embedding has no fibre to disclose.
- Added the `'plane-embedding'` lineage recipe kind behind a total
  `displayMapRecipe3` factory, leaving `projectionMapRecipeN`'s public union
  unchanged.
- Added sections of simplicial complexes by any RN hyperplane
  (`HyperplaneSliceN`, `sectionSimplexGroupN`) with ancestry that composes
  through chained cuts, so a twice-cut vertex still names original source
  vertices. Emitted section cells are oriented as the boundary of each parent's
  below-plane region, so reversing the hyperplane normal reverses the facing and
  oriented integrals accumulate instead of cancelling. The section diagnostics
  are a true partition:
  `sourceCells = sectioned + suppressedOnPlane + below + collapsed`.
- Added `maxCellDimension` to `createSimplex` and `createCrossPolytope`, so any
  simplicial face family can be authored up to the simplex's top cell. Defaults
  are byte-identical to before. A cross-polytope has no simplicial top cell and
  requesting one refuses by name; combinatorial explosions refuse
  arithmetically, with the offending numbers, before any allocation.

Authored cell groups are combinatorial and **unoriented** — render double-sided;
oriented boundaries come from `sectionSimplexGroupN`, which derives orientation
from geometry.

### `@holotope/three@0.0.14`

- Added `SectionChart3D` and `representationHitFromSectionChart`, rendering RN
  sections in their own chart with source evidence, plus two dimension-generic
  lineage recipes. Picks name the parent source cell exactly and carry each
  corner's affine ancestry; the recovered ambient point is reported
  `'approximate'`, never upgraded.
- Fixed `SectionChart3D`'s bounding volumes, which three.js computed over the
  whole padded position attribute rather than the live draw range: a section at
  x 40…41 reported a box containing the chart origin and a sphere far larger
  than the geometry. Both volumes are now maintained over exactly the live
  range, and an empty section reports explicitly empty volumes.

## v0.0.13

### `@holotope/physics@0.0.13`

- Graduated the source-retained convex-hull barrier family: one certified
  closest-point query per bound particle, source-retained witnesses, typed
  domain refusals, four-axis staleness detection, and a paired Lipschitz step
  filter whose result is a certificate rather than an impact time.
- Fixed GJK termination under equal and nearly tied supports.

The family's certificate is **per particle**, not surface disjointness: every
vertex can be legally outside a support while the material surface between them
passes through it.

### Showcase

- The source-linked sheet page was **withheld** from the built site: a certified
  audit showed the sheet surface passing through its support once it draped past
  that support's finite edge, with every vertex still legally outside. It stays
  out until surface-level contact exists to constrain it.

## v0.0.12

### `@holotope/physics@0.0.12`

- Added a world-scoped incremental-potential step
  (`stepXpbdIncrementalPotentialWorldN`) that compiles, minimizes and applies
  within one transaction, refusing stale particle state without mutating it.
- Added source-indexed simplex candidates and a **static** source-simplex AABB
  hierarchy for candidate selection — opt-in, and static-only: it refuses rather
  than silently rebuilding when its source moves.

Two solver paths now exist, and the documentation states which one owns the
world; the zero-interval rule is stated for both `XpbdWorldN` paths.

## v0.0.11

### `@holotope/core@0.0.11`

- Added rotation queries and directional bounds
  (`cellComplexBoundsAlongDirectionN` and the rotation-plane queries).
- Enforced vector and rigid-body runtime invariants that had been documented but
  unchecked.

### `@holotope/three@0.0.11`

- Validated edge styling inputs and documented slice frames.

## v0.0.10

### `@holotope/core@0.0.10`

- Added exact N-dimensional hyperrectangles, and admitted them as experiment
  sources.

### Showcase and documentation

- The flagship scenario is now declared as a typed experiment document and
  compiled from it, with picks traceable back to the compiled registry.
- Added the canonical source-retained dimension-bridge guide, and documented the
  chart resolver and the model/pane discovery seams.
- Corrected two overclaims in the hyperrectangle evidence, and exercised
  hyperrectangles from packed artifacts.

### Build

- Added a release preflight that checks CI for the exact commit being released.
- Pinned `@types/three` to the `three` revision it describes.

## v0.0.9

### `@holotope/core@0.0.9`

- Restated a representation hit as a claim a caller can act on, rather than a
  bare coordinate.
- Named the boundary facet a cuboid cell lies on.
- Fixed the lattice barrel, which did not export `phiRing`.

### Documentation and build

- Every fenced example on every learning page is now compiled on each run, and
  the cookbook's independent recipes are genuinely independent.
- The theory and physics pages were given the subjects their examples assume.
- Added a conformance build proving the packaged artifacts work outside this
  workspace, from freshly packed tarballs.
- `@holotope/experiment-physics` names its own directory in package metadata.

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
