# Mechanics in R4

`@holotope/physics` is a headless simulation package. It never renders, and it
never treats a visible projection or slice as a simulation boundary — the
simulation acts on the authoritative R4 state, and a renderer is handed pose
snapshots across an explicit adapter boundary.

It is two separate simulation layers that do not share semantics:
`RigidBody4` / `PhysicsWorld4` for R4 rigid motion, and `XpbdParticleN` /
`XpbdWorldN` for dimension-generic compliant point dynamics.

## Pages

| Page | What it covers |
| --- | --- |
| [Mass properties and principal frames](./mass-and-inertia) | Exact convex volume, centre of mass, covariance, and the diagonalised inertia that R4 rigid motion is built on. |
| [Rigid bodies and free flight](./rigid-bodies) | Momentum-primary integration of `RigidBody4`, and how a fixed-step simulation is handed to a renderer without making the view authoritative. |
| [Collision queries](./collision) | Support mappings, GJK distance, linear and rigid casts with time of impact, and the EPA penetration fallback. |
| [Contact generation and response](./contact) | Turning an intersection into a manifold with persistent identity, then into an impulse: patches, margins, the R4 friction ball, and the pipelines that orchestrate them. |
| [Joints, constraints, and motors](./constraints) | Scalar Jacobian rows and coupled blocks, distance and orientation coordinates, and the stabilizer-classified rotation policies. |
| [Deformable materials and XPBD](./deformable) | Dimension-independent simplex constitutive laws, intrinsic mass, and the RN compliant-constraint kernel that runs on point coordinates rather than rigid bodies. |
| [Correctness boundaries](./boundaries) | What is verified, what is approximate, and what is deliberately not implemented yet. Read this before trusting a result. |

## Implemented scope


`@holotope/physics` is a headless simulation package. It does not render and it
does not treat a visible slice as a simulation boundary. Its implemented
foundation covers mass properties, 4D rigid-body motion, convex
distance/intersection, linear time-of-impact queries, and explicit conservative
R4 rigid casts, exact point contact for N-balls and infinite
hyperplanes, exact contact patches for oriented R4 hyperboxes, warm-started
normal plus coupled tangent contact response, and a capability-aware
narrowphase plus deterministic mixed-shape and specialized hyperbox world-step
pipelines. A Float64 EPA fallback adds bounded minimum-translation witnesses for
general full-dimensional convex R4 pairs; vertex-enumerable R4 polytopes
graduate that witness into a complete clipped manifold with persistent source
feature identities. Opt-in event stepping resolves certified rigid impacts;
the branch-aware SO(4) logarithm and its analytic Jacobians now form the local
coordinate kernel for rotational constraints. Direction preservation and
one-parameter planar rotation are explicit stabilizer-classified policies;
the planar policy's torque-limited motor and continuous-angle guardians are
implemented. A separate dimension-generic XPBD reference kernel now projects
compliant scalar relations over point coordinates, including exact RN
point--hyperplane inequalities, without imposing R4 rigid-body semantics.
Prescribed compact-body pose trajectories share the same
contact and CCD path as dynamic bodies; moving infinite planes and sleeping
remain later contracts.
