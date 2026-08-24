# The ND contact demo

A worked demonstration that one incremental-potential contact step drives R2, R3,
and R4 without branching on dimension — and an honest account of how narrow that
demonstration is.

The page lives at `examples/showcase/nd-contact.html`, with its logic in
`examples/showcase/src/nd-contact/` and its assertions in
`examples/showcase/test/nd-contact.test.ts`. It is deliberately not listed in the
showcase gallery: it is an instrument for reading solver behaviour, not an
exhibit.

## What it demonstrates

**One stepping path.** `advanceNdContact` calls `stepXpbdIncrementalPotentialN`
once, passing `scene.dimension` as data. Scene *construction* branches on
dimension — a corner in RN needs one floor and N−1 walls — but nothing else does.

**Dimension independence, stated sharply.** The three panes do not merely all
converge. A scene differing only in how many axes it has evolves through the
*same doubles* in the axes it shares. That is asserted with `toEqual` on raw
coordinate traces, not with a tolerance.

This is a stronger claim than "no dimension branch is visible on reading", and it
is the claim worth checking wherever dimension genericity is asserted.

**Axis independence.** The R4 pane spreads its extra axes so its hyperplane
section has something to reveal. Doing so leaves the shared coordinates bitwise
unchanged, because each barrier is built on an axis-aligned `HyperplaneColliderN`
and gravity acts along one axis, so a coordinate enters only its own axis's
barrier. This holds for axis-aligned barriers; a tilted plane or any coupled
constraint would break it.

## The escalation ladder

The demo's `direction` control moves between search-direction policies on an
otherwise identical scene. Measured over 200 steps in R3, four particles falling
onto a floor barrier, each solve warm-started from the current state:

| Direction | Steps applied | Terminal speed | Outcome |
| --- | --- | --- | --- |
| default (steepest descent) | 41 of 200 | 3.3517 | freezes at first contact |
| `mass-diagonal` | 41 of 200 | 3.3517 | identical to default |
| `newton-cg` | 200 of 200 | 0.0000 | settles |

Two things follow, and both matter more than the numbers.

**The default path does not sustain resting contact.** Once the solve reaches its
iteration budget the step is refused, and a refused step applies nothing — so
positions and velocities stop updating entirely. The scene is not resting; it has
halted mid-fall with unresolved velocity. A stability check of the form "nothing
tunnelled" is satisfied trivially by that state, which is why every assertion in
the demo's suite is liveness-first: it proves the scene moved before it claims
anything about where it stopped.

**Newton is the remedy, at default settings** — no tolerance change, no raised
iteration budget. The `mass-diagonal` policy is not an intermediate rung; on
this problem it is a no-op, producing numbers identical to the default.
Both policies are named directly through `minimization.directionPolicy`, so a
caller need not construct a policy around the internally compiled problem.

## The admissible warm start

The inertial prediction remains the default minimizer base. Near an open
contact barrier that prediction can already be inadmissible. With the demo's
step filters registered, the automatic movement toward it is certified first
and `limited` to the admissible prefix, so the step proceeds from a certified
base; with no filter registered, an inadmissible base returns the typed
`initial-state-refused` terminal rather than throwing through the integrated
step.

This demo selects `warmStart: 'previous-positions'`. The last live positions
remain the minimizer base while the inertial prediction still defines the
objective's inertial target. Explicit `initialPositions`, when supplied, remain
authoritative over either warm-start policy.

## The trap the demo also shows

Loosening `gradientTolerance` past the objective's gradient norm at the current
state — about `1.4e-3` for this scene — makes every solve converge at its initial
point in zero iterations. Every step then reports `applied` and the scene never
moves at all.

That is the worst available debugging gradient: the knob that silences the
refusals also stops the physics. Every integrated result now carries `progress`,
including accepted iterations, minimizer displacement, objective decrease, and
the convergence point. The demo passes that evidence to
`diagnoseXpbdIncrementalPotentialStepN`; its readout names the
`converged-without-iteration` condition and offers *lowering* the tolerance as
the only legitimate response. The helper does not decide whether zero-iteration
convergence means genuine rest or an unexpectedly frozen scene.

## The R4 pane, and one representation choice

The R4 pane shows a single source through two maps: a perspective projection into
R3, and an exact section by the hyperplane `w = offset`.

A particle is a point, and a hyperplane section of a point set is empty almost
everywhere — so sectioning the source literally would show nothing. Each particle
is therefore given an authored 4-ball purely so that it can be seen; its section
is a 3-ball whose radius shrinks to nothing as the plane sweeps past.

**That radius carries no physics.** It is a property of the picture. A particle
absent from the section has not left the simulation, and the solver is still
resolving its contacts on coordinates the section cannot display.

The readout prints the consequence as one comparison: a particle's signed
distance to the floor in the source, beside the height a viewer would read off
the projected image. They disagree, the disagreement grows with the hidden
coordinate, and the barrier was evaluated on the first.

## What this does not show

Read this part before generalising anything above.

**This demo is point–hyperplane only.** `XpbdParticleHyperplaneBarrierN` is the
only barrier it uses. The package also exposes an authored point–finite-source-
simplex proximity pair, but this demo has no finite-feature candidate
generation, edge–edge contact, or self-collision. Every scene here is particles
against static planes.

**The `indeterminate` step-filter verdict never occurs.** The three-valued
`safe` / `limited` / `indeterminate` vocabulary is real and is a genuine
improvement on implementations that conflate "no collision found" with "the test
gave up". But `XpbdParticleHyperplaneBarrierStepFilterN` is an exact predicate: it
always either certifies a whole segment or limits it to a computable prefix, and
never has to decline for an admissible start. The finite-simplex filter can
likewise refuse an already inadmissible start, but automatic mesh candidate
generation is not present. The demo shows `limited` instead, which is frequent
and does show the collision-aware line search restricting a step.

**Friction is not at the fidelity the literature's benchmarks need.** The
mollified static friction with a velocity bound, and the lagged solves that go
with it, are not implemented for mesh contacts.

**The published Incremental Potential Contact scenes are out of reach**, and not
by a small margin. Their flagship results — twisting mats and rods, the card
house, the masonry arch, chains, the funnel, the compactor, the rollers — are all
dominated by self-contact between deforming bodies. Beyond the missing contact
types, the reported cost is prohibitive for a browser: the twisting-mat example
runs at roughly 776 seconds per timestep on an 8-core workstation, which is about
three weeks of compute for one shot. Nothing in this package changes that
arithmetic, and no amount of demo work will.

What the demo can honestly claim is narrower and, for this library's purposes,
more interesting: the barrier and the collision-filtered line search are
dimension-independent, and here that is demonstrable rather than asserted.

## Related pages

- [Deformable materials and XPBD](./deformable) — the constitutive laws and the
  RN compliant-constraint kernel the incremental potential is built on.
- [Troubleshooting incremental-potential steps](./incremental-potential-troubleshooting)
  — warm starts, progress evidence, and the diagnosis vocabulary.
- [Correctness boundaries](./boundaries) — what the package verifies, what it
  approximates, and what it does not implement.
- [Contact generation and response](./contact) — the separate rigid-body contact
  path, which shares no semantics with this one.
