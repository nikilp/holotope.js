# Turning a section, and contact through the hidden direction

Two linked showcase pages about watching R⁴ through a three-dimensional
section. The first turns and slides the section through objects that never
move. The second launches a ball at a box along w, the one direction the
reference section cannot show, and asks how to find the cause of a collision
you cannot see in the cut.

- **Turn through the same object** —
  [live](https://nikilp.github.io/holotope.js/spatial-4d-turn.html); page
  `examples/showcase/spatial-4d-turn.html`, modules
  `examples/showcase/src/spatial-4d-turn/`, tests
  `examples/showcase/test/spatial-4d-turn/`.
- **Interaction through the hidden direction** —
  [live](https://nikilp.github.io/holotope.js/spatial-4d-contact.html); page
  `examples/showcase/spatial-4d-contact.html`, modules
  `examples/showcase/src/spatial-4d-contact/`, tests
  `examples/showcase/test/spatial-4d-contact/`. Its five guided stages are
  also written out as a script, `examples/showcase/src/spatial-4d-contact/GUIDE.md`.

The second page reuses the first page's knife, face names, projection adapter
and viewport, by import. Each page keeps its own state: every mutable value
lives inside its own `createApp`, and the shared modules hold only constants
and functions.

## What is authoritative, and what changes only the view

Both pages keep one source in R⁴ and treat everything on screen as a view of it.

**Turn.** The source is a hyperbox with half-extents (2.2, 1.3, 0.8, 1.6) at the
origin, which never moves, and a glome of radius 0.72 centred at
(3.6, 1.05, 0, 0.92). The glome can move, but only along a stated orbit in the
z–w plane: `Rotor4.fromPlane(2, 3, φ)` applied to a fixed arm, with no force and
no physics, and the two objects never touch. The knife is a `HyperplaneSliceN`
whose normal is `Rotor4.fromPlane(0, 3, θ)` applied to the reference normal
(0, 0, 0, 1), with an offset along that normal.

What changes only the view:

- the camera, the lighting and the face colours;
- which orthonormal basis of the same hyperplane is shown;
- the optional projection context, the whole block's edges flattened into the
  section's chart.

None of these changes membership or geometry. The knife is the observer: it
decides what is seen, never what exists.

**Contact.** The source is one `PhysicsWorld4` holding a dynamic box (mass 2) and
a dynamic ball (mass 1, radius 0.5). It is stepped only by
`ContactPipeline4.stepWorld` with a fixed step of 1/120 s and 2 substeps. Every
view reads the simulation and writes nothing back:

- the exact sections of both bodies;
- the projection context and the projected contact marker;
- the readout.

Moving the knife, toggling the projection or orbiting the camera never touches
a body. Every change of simulation time is a fresh simulation: a launch, or a
replay of the same launch for a fixed number of steps. The page never poses a
body or rewinds a velocity. The rotation study is a separate scene with its own
slice, angle and clock, labelled "prescribed turn — not a physics simulation".

## What the two pages demonstrate

**Turn through the same object**

- A section of a rigid, unmoving object changes shape only because the section
  moves. Along the turned x axis its half-length is min(2.2/|cos θ|, 1.6/|sin θ|).
  It is widest where the two bounds meet, at |tan θ| = 1.6/2.2 (about 36.03°),
  and that is also where the bounding faces swap from the x faces to the w faces.
- Faces keep their identity. Each drawn triangle is traced back to the source
  cube it came from, and picking names that face.
- An empty section is told apart from a miss. A knife lying exactly on a face
  touches the block without drawing a solid, and the page says which face and
  why. A knife clear of the block reports the nearest corner's distance and
  side.
- The observer's side is read from the sign of the signed distance, not assumed.
- The projection context is the whole block's edges in the same chart as the
  section. It is context, not contact: overlap in projection is not overlap in R⁴.

**Interaction through the hidden direction**

- Both bodies respond to the impact. With preset A (central, along w) the ball
  leaves at +2/3 and the box at −4/3 along w. Momentum (0, 0, 0, −2) and kinetic
  energy 2 are conserved, and neither body spins: the one-dimensional elastic
  prediction, held to nine places.
- Contact is a four-coordinate fact. The same x, y, z path strikes the box's +x
  face at w = 0.3 and passes it at w = 1.7.
- The off-centre preset B makes the box spin in the x–w plane. Total angular
  momentum, orbital plus spin, is conserved. The spin matches an independent
  point-impulse prediction that uses the box's own x–w inertia.
- At the reference knife the ball is never in the cut, yet the box is struck.
  The cause is found by turning the knife toward w or by showing the projection.
- The guided sequence (stages A–E) labels every action as view only, changes
  simulation time, or separate scene, and each action touches only that.
- The rotation study shows why a rigid turn through w changes the section: the
  object turns and the knife does not, so the section cuts different parts of
  the same rigid box.

## Library capability, bounded example, composition, proposal

These pages compose existing capabilities. They do not extend the library.

| class | what | where |
| --- | --- | --- |
| library capability, used here | exact sections of complexes and glomes: `createHyperrectangle`, `simplexizeCuboidGroupN`, `SectionChart3D`, `sectionOfGlome4` | `@holotope/core`, `@holotope/three`, `@holotope/physics` |
| library capability, used here | slices, rotors and charts: `HyperplaneSliceN` (`setNormal`, `signedDistance`, `projectPointToChart`), `Rotor4.fromPlane`, `TransformN` | `@holotope/core` |
| library capability, used here | projection and picking: `ProjectedEdges3D`, `representationHitFromSectionChart` | `@holotope/three` |
| library capability, used here | rigid motion and contact: `RigidBody4.fromMassProperties`, `PhysicsWorld4`, `ContactPipeline4.stepWorld`, `glomeHyperboxContact4`, and the contact constraints the pipeline builds and solves | `@holotope/physics` |
| library capability, not used here | continuous collision: `ContactPipeline4.stepWorldContinuous`, linear and rigid casts with time of impact | [Collision queries](./physics/collision#linear-casts-and-time-of-impact) |
| library capability, not used here | joints, constraint rows and blocks, motors | [Joints, constraints, and motors](./physics/constraints) |
| library capability, not used here | snapshots, traces and replay of compiled experiment documents | [Experiment documents](./experiment-documents#snapshots-traces-and-honest-replay) |
| library capability, not used here | multi-point contact patches and persistent contact identity for hyperboxes | [Contact generation and response](./physics/contact#hyperbox-contact-patches) |
| bounded example | the two scenes, the two presets, one impact per run | the pages |
| bounded example | the page's own replay, `ContactSimulation.atStep`: a fresh simulation stepped again from launch. It is page composition, not the experiment-document replay above | `src/spatial-4d-contact/simulation.ts` |
| exploratory composition | `ChartProjection`, a `DisplayMap3D` adapter whose methods only call `projectPointToChart`; face naming from cube corners; the mirrored sectioner tolerance (`ON_PLANE_EPSILON = 1e-9`) | `src/spatial-4d-turn/` |
| proposal, not implemented | let `HyperplaneSliceN` serve as a `DisplayMap3D` (or add a slice chart projection), and export the sectioner's tolerance instead of mirroring it | — |

The pages do not use or validate continuous collision, joints or experiment
replay. Those exist in the library, with their own tests; these two scenes are
evidence for none of them.

## Reference scenes

**Turn.**

- Pivot at the origin; reference normal (0, 0, 0, 1); offset 0.
- Turn range ±90°, offset range ±1.6.
- The knife is re-derived from the reference each update, transported in steps
  of at most 45°.
- Block half-extents (2.2, 1.3, 0.8, 1.6). Glome centre (3.6, 1.05, 0, 0.92),
  radius 0.72, orbiting in the z–w plane about (3.6, 1.05, 0, 0).

**Contact.**

- Box half-extents (1.2, 0.9, 0.7, 1.0), mass 2, at the origin, at rest.
- Ball radius 0.5, mass 1.
- No gravity, friction 0, restitution 1.
- Step 1/120 s with 2 substeps; 16 solver iterations; restitution threshold 0;
  Baumgarte 0; no warm start.
- Preset A: ball at (0, 0, 0, 2.7), velocity (0, 0, 0, −2).
- Preset B: ball at (0.8, 0, 0, 2.7), same velocity.

In both presets the ball's surface reaches the box's +w face exactly at step 72
(t = 0.600 s), and the impulse is applied at step 73 (t = 0.608 s). The rotation
study's x–w face transition is at tan α = 1.0/1.2, about 39.81°.

## Reproducing the evidence

From a checkout of this repository:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm exec vitest run examples/showcase/test/spatial-4d-turn examples/showcase/test/spatial-4d-contact
pnpm --filter @holotope/showcase typecheck
pnpm --filter @holotope/showcase dev
```

`pnpm build` comes first because the test lane resolves `@holotope/physics` from
its build. With the dev server running, open `/spatial-4d-turn.html` and
`/spatial-4d-contact.html`.

The two suites hold 199 tests in 13 files: 87 for the turn page and 112 for the
contact page. By kind:

- **Independent oracles.** Closed-form predictions computed in the tests,
  never by the code under test: section extents, face transitions, path arcs,
  elastic and point-impulse outcomes, the rotated-box support function.
- **Observer independence.** A run of either preset, 180 steps with the knife,
  the offset and the context changing every step, is bitwise identical to the
  same run with no views at all.
- **Report handling.** Hand-built pipeline results check how the page reads
  impulses and contact geometry across substeps.
- **Source and markup pins.** Every control in the HTML has a listener in the
  page's code. The page never writes a body. Each guided action touches only
  its kind.

These pins read the shipped page and module text. They prove the code says
something, not that it runs: the repository has no DOM test environment.
Behaviour in a browser needs genuine input.

## Limits and open questions

- **Prepared scenes, discrete stepping.**
  - The contact page steps discretely. It uses neither continuous collision nor
    any multi-body scene: two bodies, one impact per run, no gravity, friction,
    stacking or third body. That says nothing about general multi-body
    robustness or continuous-collision coverage.
  - Zero penetration at detection is a coincidence of the authored gap: the
    touch falls exactly on a step boundary.
  - At these speeds the ball moves about 0.0167 per step, about 3% of its
    radius, so tunnelling is not reachable here. That is a property of these
    scenes, not of discrete stepping.
- **A body is not contained in a section.** In stage A only the two centres lie
  in the x = 0 section. The box spans 2.4 in x and the ball 1.0, so each extends
  beyond the cut. The section of a 4D solid is not the solid.
- **The containment check is a spot-check.** A test sweeps the stage texts, the
  guided script and the page markup with patterns for wording that claims a
  body is contained in the section. Those patterns are subject- and voice-limited.
  Phrasings such as "the section contains both bodies" or "the ball lies wholly
  within this cut" pass them. The substantive guard is the positive pinning of
  the exact required sentences, on top of asserted scene geometry.
- **Presentation notes, kept as they are:**
  - On the contact page, below 880 px the stage is not sticky, so it scrolls
    out of view under the lower controls, and two checkboxes are 13 px.
  - The turn page has had no phone-width pass at all.
  - Stage B says "While paused…", but arriving at stage B does not pause the
    clock. Its first action, *Jump to the first touch*, does.
  - One idea has three words: the stage asks until both bodies are "gone from
    the cut", while the readout calls the box "absent" and the ball "hidden".
  - Small negative distances display as −0.00.
- **Three kinds of number, three roles.**
  - Membership in the cut is a geometric predicate, |signed distance| ≤ 1e−9,
    never a rounded display. A point at 0.004 displays as 0.00 and is not in
    the cut.
  - Drawn buffers are Float32, so values read back from them are held to 1e−5.
  - Restitution is enforced to nine places. The worst |1 − e| observed across
    the tried settings was 4.4e−16. That is a measurement of the builds it ran
    on, not a portability guarantee.
  - The graze band (0.02) and the ball's three circles are display
    conventions, not geometry.
- **Tolerances are mirrored.** The sectioner's tolerance is copied, not read,
  because the library does not export it.
- **States no preset reaches.** "Overlapping", "unsupported here" and the
  ambiguous-interior query state are labelled but never reached.
- **Open design.** A knife turning in two planes at once is not designed. The
  page steps by wall-clock accumulation, at most eight fixed steps per frame, so
  two sessions can differ in how many steps have run at a given moment. The
  state per step is what the tests hold.

## Review it yourself

A short task for a reviewer with only this repository:

1. **Reproduce the reference collision.** Run the commands above. On the contact
   page, choose preset A and press *Play*. Confirm the outcome: the impulse at
   step 73; the ball leaving at +2/3 and the box at −4/3 along w; no spin.
   Compare with `examples/showcase/test/spatial-4d-contact/simulation.test.ts`,
   section 2.
2. **Change the observer without changing the bodies.** Pause just after the
   impact. Turn the knife, slide the offset, toggle the projection and orbit the
   camera, and confirm that no position or velocity in the readout moved.
   `views.test.ts` holds the same claim bitwise across 180 steps. Check that the
   probe moved something, or the claim is vacuous.
3. **Inspect the hidden-plane spin.** Choose preset B and *Jump to just after
   the impact*. Read the box's spin in the x–w plane and the conserved total.
   Then open the rotation study and compare a prescribed x–w turn with the
   collision's.
4. **Attack the limits above.** For example:
   - start the ball at w = 2.66 instead of 2.7 and look at penetration at
     detection;
   - write a containment sentence the patterns miss;
   - arrive at stage B with the clock running;
   - load either page at 375 px wide.

Report what holds, what fails, and what the pages or this guide overstate.

## Related pages

- [Collision queries](./physics/collision)
- [Contact generation and response](./physics/contact)
- [Rigid bodies and free flight](./physics/rigid-bodies)
- [Correctness boundaries](./physics/boundaries)
- [Representation provenance](./representation-provenance)
