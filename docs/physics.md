# Moved: physics documentation is organised by task

The mechanics documentation is now seven pages under `learn/physics/`, each
covering one task rather than one file covering the package. Sections moved
verbatim; heading levels were promoted one step where a `###` became a
page-level `##`.

| Was in this file | Now lives in |
| --- | --- |
| Convex mass properties · Principal frames | [learn/physics/mass-and-inertia.md](./learn/physics/mass-and-inertia.md) |
| Scene synchronization · Momentum-primary free flight | [learn/physics/rigid-bodies.md](./learn/physics/rigid-bodies.md) |
| Convex support mappings and GJK · Linear casts and time of impact · Explicit R4 rigid trajectories and casts · General R4 penetration | [learn/physics/collision.md](./learn/physics/collision.md) |
| Vertex-polytope contact manifolds · Shallow contact with margins · Infinite hyperplanes · Complete vertex-polytope contact with a plane · Exact smooth point contact · Exact mixed analytic contact in R4 · Oriented hyperboxes and SAT · Hyperbox contact patches · Persistent identity and contact kinematics · Contact response and the R4 friction ball · Broadphase candidate providers · Capability-aware narrowphase · Mixed R4 contact orchestration · Deterministic hyperbox contact orchestration | [learn/physics/contact.md](./learn/physics/contact.md) |
| Bilateral R4 point joints · Scalar rigid-Jacobian rows with force bounds · Distance coordinates in N dimensions and R4 · SO(4) orientation coordinates · Coupled equality and one-bounded blocks · Direction preservation and its SO(3) stabilizer · Fixed-relative-frame orientation · Planar rotation and its SO(2) stabilizer | [learn/physics/constraints.md](./learn/physics/constraints.md) |
| Dimension-independent simplex materials · Source particles and intrinsic mass · Dimension-generic compliant point constraints · RN point–hyperplane contact | [learn/physics/deformable.md](./learn/physics/deformable.md) |
| Current correctness boundary | [learn/physics/boundaries.md](./learn/physics/boundaries.md) |

## Where new physics documentation goes

Append to the page whose task it belongs to, not to this file and not to a new
one. If a feature genuinely fits none of the seven, that is the signal to add an
eighth page — not to reopen the single-file pattern that produced this notice.

Start at [learn/physics/index.md](./learn/physics/index.md).
