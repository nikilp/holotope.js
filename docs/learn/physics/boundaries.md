# Correctness boundaries

What is verified, what is approximate, and what is deliberately not implemented yet. Read this before trusting a result.

## Current correctness boundary

The test suite pins:

- the closed-form volume, covariance, and inertia of a translated tesseract;
- isotropic inertia for all six regular convex polychora;
- SO(4) matrix↔paired-quaternion round trips;
- exact torque-free world angular momentum over 10,000 steps;
- bounded anisotropic energy error with approximately quadratic timestep scaling;
- the invariant embedded 3D rotation subalgebra;
- force, gravity, torque, and accumulator semantics.
- closed-form XPBD scalar multipliers, compliant residuals, force scaling,
  mass-weighted corrections, fixed-point evidence, R2/R3/R4/R7 specialization,
  Euclidean invariance, coupled-chain convergence, degeneracy refusal, and
  atomic rollback after custom-evaluator failure;
- RN point-mass semi-implicit prediction through R7, force holding across
  substeps, fixed-point semantics, repeated hard-distance support, compliant
  static extension and force at two timesteps, oscillator recurrence parity,
  center-of-mass preservation, registration ownership, and complete world-step
  rollback;
- analytic glome–glome and axis-aligned box–box convex distances;
- deterministic randomized box-pair differentials in R4;
- transformed support points, rank-deficient simplices, and R3 specialization;
- exact-ring predicate provenance for exact-coordinate hulls.
- coherent feature-pair warm starts across moving R4 hulls;
- shallow margin separation/contact and explicit core-contact refusal;
- ordinary-axis and hidden-axis analytic hyperplane queries.
- exact ordered N-ball/N-ball witnesses from R1 through R8, reversal symmetry,
  margins, tolerance contact, and the coincident-center degeneracy;
- exact ordered N-ball/hyperplane witnesses in both shape orders and 800
  deterministic differentials against the one-support plane query;
- exact ordered glome/hyperbox face, edge, and corner witnesses, compact
  margins, reversal symmetry, unique interior exits, and explicit interior
  ties;
- glome/hyperbox separation differentials against GJK over deterministic
  translated and full-rotation poses;
- hyperbox/hyperplane support features from point through 3D polyhedron,
  ordered anchors, compact margins, and differentials against the generic
  one-support plane query;
- complete 56-family oriented-hyperbox SAT and a cross-family-only regression;
- SAT/GJK boolean agreement over 20,000 deterministic full R4 poses.
- hyperbox contact dimensionality from point through 3D polyhedron;
- a 20-vertex aligned patch reduced to eight affine-spanning solver points;
- 20,000 deterministic full-SO(4) contact constructions with zero failures.
- feature-pair contact IDs, consecutive ages, and explicit retirements;
- analytic `v + Ωr` point velocity and six-rate kinematic pose extraction;
- coherent one-normal plus three-tangent velocity decomposition.
- exterior-product angular impulses and world-space inverse inertia;
- analytic Newton restitution from zero through perfectly elastic impacts;
- total linear and angular momentum conservation for off-center body pairs;
- rotational effective mass against an immovable surface;
- restitution thresholds, bounded penetration bias, and kinematic drivers;
- persistent warm impulses with timestep scaling, normal coherence, and retirement;
- a two-body stack held against gravity through the world constraint seam.
- one coupled Coulomb three-ball rather than axis-wise friction clamps;
- exact sticking and sliding limits for arbitrary three-component slip;
- full anisotropic 3x3 tangent-response differentials;
- tangent-coordinate invariance and three normal–tangent glome spin modes;
- preservation of all three tangent-only glome spin modes under point friction;
- tangent warm starts transported in world space with timestep scaling;
- linear and angular momentum conservation when witness anchors coincide.
- body-local hyperbox pose synchronization and explicit fixed poses;
- deterministic pair dispatch independent of collider insertion order;
- group/mask filtering before narrowphase and explicit material mixing;
- automatic cache retirement when colliders separate or are disabled;
- an automatically dispatched hyperbox stack held against gravity.
- exhaustive pair generation in canonical stable-ID order;
- randomized sweep-and-prune equality with brute-force AABB overlap from R1
  through R8;
- coherent sweep-order reuse and exact adjacent-swap diagnostics;
- zero broadphase false negatives across 5,000 deterministic full-SO(4) SAT
  contact poses;
- default sweep and exhaustive-pipeline agreement for separated/contacting
  behavior.
- best-mode selection across general distance, rounded shallow contact, exact
  R4 penetration, hyperbox deep manifolds, and analytic smooth deep contact;
- explicit distance/shallow overrides and typed unsupported deep requests;
- preservation of the shallow core-overlap refusal without fabricated normal
  or penetration depth;
- ordered-pair GJK cache reuse, canonical batch ordering, disabling, deletion,
  and immediate retirement;
- exact dispatcher/direct-query differentials for all implemented capability
  paths;
- the hyperbox world pipeline requesting and exposing `deep-manifold` rather
  than bypassing capability dispatch.
- exact smooth-point response in both ordered glome/plane roles;
- deterministic mixed compact/plane candidate accounting and filtering;
- body-local glome synchronization and stable smooth-point warm-start identity;
- a glome held against gravity for 600 fixed steps;
- central elastic glome/glome response and retained hyperbox dispatch inside
  the mixed pipeline;
- exact glome/hyperbox point response and eight-point hyperbox/plane response
  in either ordered plane role;
- a hyperbox held against gravity on an infinite floor through the world seam;
- honest no-response handling for coincident glome centers and ambiguous
  interior glome/hyperbox minimum translations.
- bounded R4 EPA depth, witnesses, and termination certificates;
- exact axis-aligned penetration and ordered-pair reversal;
- 500 deterministic full-SO(4) EPA differentials against complete hyperbox
  SAT, plus a shape-generic transformed 4-simplex case;
- explicit rank-deficient and finite-budget failure without fabricated
  response data.
- complete vertex-polytope point-through-polyhedron manifolds with minimal
  source-face identities and affine-span-preserving reduction;
- 100 deterministic full-SO(4) manifold differentials against complete
  hyperbox SAT/contact geometry, plus transformed 4-simplex contact;
- coherent general-polytope IDs, dispatcher cache reuse, collider pose
  synchronization, shared response, and warm impulse reuse.
- dimension-independent simplex topology from R1 through R5, n-cube facet
  counts, serialized topology re-instantiation, wrong/deformed hull refusal,
  and compiled-versus-exhaustive manifold equality.
- complete vertex-polytope/hyperplane point-through-polyhedron support faces,
  ordered anchors, compact margins, and affine-span-preserving reduction;
- 100 deterministic full-SO(4) differentials against exact
  hyperbox/hyperplane contact, plus transformed 4-simplex incidence;
- specialized hyperbox dispatch precedence, typed plane-margin refusal, and
  stable general-polytope/plane response through the mixed world pipeline.
- analytic N-ball linear impact times from R1 through R8 and exact static-plane
  casts on ordinary and hidden axes;
- 240 axis-aligned cube casts against analytic slab entry from R1 through R6;
- 100 fully rotated R4 hyperbox casts against complete 56-axis SAT impact time;
- fast compact/compact, compact/plane, and general tesseract/plane tunnelling
  regressions through opt-in event stepping;
- swept-bound containment from R1 through R8 and zero broadphase false
  negatives against randomized analytic moving N-ball contacts;
- equal event identity, impact time, and final body state between swept
  sweep-and-prune and the exhaustive continuous provider in a distractor scene;
- explicit legacy velocity-only fallback plus bounded event-limit remainder
  without a fabricated continuous guarantee;
- pose-pair trajectory/rate differentials, absolute kinematic suffix plans,
  continuous segment chaining and overrun refusal, local compact-collider pose
  synchronization, discrete substep advancement, translating and pure-spin
  kinematic CCD, dynamic-only impulse response, and swept/exhaustive event
  agreement.
- analytic and randomized full-SO(4) point-joint block solves, hidden-axis
  lever coupling, embedded-R3 invariance, coincident-anchor momentum
  conservation, persistent warm starts, and fixed-world gravity support.
- dimension-independent distance gradients through R7, translation and
  embedding invariance, explicit coincident-anchor directions, unrestricted
  stretch/compression impulses, separated-anchor six-plane momentum
  conservation, embedded-R3 invariance, and long-running gravity tethers;
- scalar rigid-Jacobian differentials over randomized full-SO(4) anisotropic
  bodies, prescribed-motion response, coherent warm-row projection, and a
  pure xw angular coordinate;
- force-to-impulse bound scaling, one-sided complementarity, saturated-row KKT
  residuals, bounded warm-start projection, fixed rows, and malformed bound
  refusal;
- diagnostic crossing classification, two stable distance-guardian IDs,
  interior safe-speed corridors, lower/upper impulse signs, stale warm-impulse
  removal, full-span crossings, exact-coincidence branch refusal, embedded-R3
  closure, and full-SO(4) pair momentum conservation;
- positive and negative distance-motor tracking, exact force saturation,
  timestep-consistent acceleration, guardian enforcement of velocity created
  by other rows, motor/interval composition, and the distinction between energy
  input and internal-force momentum conservation.
- five-row planar-rotation finite differences, full-SO(4) anisotropic block
  solves, typed two-frame chart failures, transported basis invariance, exact
  SO(2) stabilizer freedom, embedded-R3 closure, and pair momentum conservation.
- signed planar-phase differentials, common-SO(4) invariance, positive ambient
  orientation, multi-turn unwrap continuity, explicit half-turn branches, and
  embedded-R3 signed-angle closure.
- six-row fixed-frame differentials for both participants, common-world
  invariance, exact anisotropic block response, pair momentum conservation,
  local material-frame binding, cut-locus refusal, branch hysteresis,
  embedded-R3 closure, and long-running world-step stability.

A manifold is not implied by a black-box convex support query. EPA supplies a
bounded general R4 minimum-translation witness; a response-grade general
polytope manifold additionally requires stable vertex enumeration. Specialized
hyperbox, smooth, and mixed analytic families retain their stronger direct
routes. Each complete family has a response adapter, and mixed orchestration
responds only when the dispatcher supplies one of those complete patches. Field
ray hits and rendered slices remain observation/query products, not physical
surfaces unless an explicit collider is constructed from them. The finite
broadphase is conservative AABB sweep-and-prune; infinite planes use an
exhaustive lane. Linear CCD uses conservative swept AABBs before its certified
casts, with the exhaustive candidate provider retained as a reference lane.
Spatial trees, moving infinite-plane pose trajectories, distance servos,
rolling resistance, and sleeping are not implied by this stage. The landed
direction, planar-rotation, and fixed-frame policies are distinct
stabilizer families, not a claim that every mechanism called a “hinge” in R4
has one meaning.
Exact total angular-momentum conservation applies when the two impulse anchors
coincide; penetrated witness pairs are distinct constraint anchors and
positional stabilization is intentionally non-conservative.
