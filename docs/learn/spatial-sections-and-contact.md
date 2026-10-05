# Turning a section, and contact through the hidden direction

Two linked showcase pages about watching R⁴ through a three-dimensional
section. The first turns and slides the section through a block that never
moves and a small glome that moves only along a prescribed orbit, with no
physics. The second launches a ball at a box along w, the one direction the
reference section cannot show, and asks how to find the cause of a collision
you cannot see in the cut.

The two pages are now the **classic instruments**. Their former routes open
[The Hidden Direction](#the-hidden-direction), a guided experience built on the
same modules; the classic pages are unchanged at their own routes.

- **Turn through the same object** —
  [live](https://nikilp.github.io/holotope.js/spatial-4d-turn-classic.html); page
  `examples/showcase/spatial-4d-turn-classic.html`, modules
  `examples/showcase/src/spatial-4d-turn/`, tests
  `examples/showcase/test/spatial-4d-turn/`.
- **Interaction through the hidden direction** —
  [live](https://nikilp.github.io/holotope.js/spatial-4d-contact-classic.html); page
  `examples/showcase/spatial-4d-contact-classic.html`, modules
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
a body. *Play* and *Step +1* advance the simulation by its own fixed step. Every
other change of simulation time builds a fresh simulation: a reset launches it
again, and *Step −1* and the jumps replay the same launch for a fixed number of
steps. The page never poses a body or rewinds a velocity. The rotation study is a separate scene with its own
slice, angle and clock, labelled "prescribed turn — not a physics simulation".

## What the two pages demonstrate

**Turn through the same object**

- A section of a rigid, unmoving object changes shape only because the section
  moves. At zero offset, along the turned x axis, its half-length is
  min(2.2/|cos θ|, 1.6/|sin θ|).
  It is widest where the two bounds meet, at |tan θ| = 1.6/2.2 (about 36.03°),
  and that is also where the bounding faces swap from the x faces to the w faces.
- Faces keep their identity. Each drawn triangle is traced back to the source
  cube it came from, and picking names that face.
- An empty section is told apart from a miss. A knife lying exactly on the −w
  face touches the block and draws nothing, and the page says so. On the +w
  face the sectioner's boundary convention draws that face instead. A knife
  clear of the block would report the nearest corner's distance and side. The
  turn page's offset range never clears the block, so only the tests reach that
  state; the contact page reaches it when the box leaves the cut.
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
| library capability, not used here | joints, motors, and constraint rows or blocks authored by the caller (the contact solver builds point-constraint rows internally; the pages author none) | [Joints, constraints, and motors](./physics/constraints) |
| library capability, not used here | snapshots, traces and replay of compiled experiment documents | [Experiment documents](./experiment-documents#snapshots-traces-and-honest-replay) |
| library capability, not used here | multi-point contact patches and persistent contact identity for hyperboxes | [Contact generation and response](./physics/contact#hyperbox-contact-patches) |
| bounded example | the two scenes, the two presets, one impact per run | the pages |
| bounded example | the page's own replay, `ContactSimulation.atStep`: a fresh simulation stepped again from launch. It is page composition, not the experiment-document replay above | `src/spatial-4d-contact/simulation.ts` |
| exploratory composition | `ChartProjection`, a `DisplayMap3D` adapter whose methods only call `projectPointToChart`; face naming from cube corners; the mirrored sectioner tolerance (`ON_PLANE_EPSILON = 1e-9`, in both pages) | `src/spatial-4d-turn/`, `src/spatial-4d-contact/views.ts` |
| proposal, not implemented | let `HyperplaneSliceN` serve as a `DisplayMap3D` (or add a slice chart projection), and export the sectioner's tolerance instead of mirroring it | — |

The pages do not use or validate continuous collision, joints or experiment
replay. Those exist in the library, with their own tests; these two scenes are
evidence for none of them.

## The Hidden Direction

The former routes now open a guided experience built on these modules:
`spatial-4d-turn.html` opens at chapter I and `spatial-4d-contact.html` at
chapter III, and `#arrival`, `#cuts`, `#collision`, `#spin`, `#turning` or
`#free` opens either page at that chapter. The
[visitor guide](./the-hidden-direction) explains the controls. Sources are in
`examples/showcase/src/hidden-direction/`, and tests in
`examples/showcase/test/hidden-direction/`.

It composes the modules above and adds no physics of its own. The geometry it
computes is read from their posed corners, centres and drawn bounds: each
body's extent and gap across the slice, its footprint on the x–w plane, the
chord the slice cuts through it, and what the slice meets on a body's
boundary. It also samples whether the orbit meets the slice, and tests drawn
bounds against the camera's view.

- **One owner per scene.** `worlds.ts` holds one instance each of the turning
  scene's section products and projection context, and of the contact page's
  `ContactSimulation`, `SceneViews` and `RotationStudy`. It calls only their
  public functions.
- **Actions sorted by what they may touch.** `experience.ts` is the one entry
  point every control uses. Each action is one of four kinds. A *view* action
  moves the slice, the shadow or the focus, and never the simulation, the
  orbit or the study. A *time* action moves a clock. A *study* action moves
  only the separate turning scene. A *chapter* action establishes its stated
  turn, offset, launch and phase in full. Each guided chapter, I to V,
  re-establishes its stated state, unlike the classic guided stages (see the
  limits below). Free exploration keeps everything as it was. Chapter V
  pauses the collision's clock and changes nothing else of it. While the
  turning scene is open, slice actions and the collision's clock are refused.
  A clock advances only with its world in front.
- **The hidden plane.** `plane.ts` flattens each body onto the x–w plane along
  y and z: the convex hull of its posed corners, or a disc. The slice is the
  line n·q = offset. While the normal n lies in the x–w plane, n·p reads only
  x and w, so the slice meets a body exactly when the line meets its
  footprint. Whether the map draws a chord is decided by the library's own
  status for the body; the footprint gives the chord its shape, with the
  sectioner's 10⁻⁹ tolerance. Used alone, the footprint arithmetic rounds
  differently from the library's ball classifier, and so disagrees with it
  within a few ulps of the tolerance band's edge. The map draws no line for a
  normal with a y or z component.
- **Words as functions of the model.** `copy.ts` writes every sentence from
  the model's numbers. An empty view names one of four causes: outside the
  slice, meeting the slice only on the body's boundary, outside the camera's
  view, or not drawn. A boundary meeting is described by three separate facts:
  whether the slice meets the body, which is the library's status; what the
  meeting is and its dimension, read from the posed corners within 10⁻⁹ and
  called "not established" when the corners leave it open; and what was drawn.
  At the turning scene's kata limit, the slice lies on the block's −w face, a
  solid 4.4 × 2.6 × 1.6 cuboid. Nothing is drawn there, because the sectioner
  cuts only cells with a corner strictly kata of the slice. At the ana limit,
  the +w face is drawn. Where a recovery exists, it moves only the slice or only the
  camera. When the struck bodies have carried on beyond the slider's reach, the
  view instead offers a replay of the physics clock from the launch.

At the new routes it resolves these presentation notes from the classic
pages:

- **Camera framing.** The home frame keeps every section the turning scene can
  draw in view, on a sampled grid of turns, offsets and orbit phases at aspect
  ratios from 0.56 (phones) to 2.2. When the struck box drifts out of frame,
  the page says so and offers a camera-only recovery.
- **Phone layout.** On a narrow screen held upright, the picture and its gauge
  stay pinned while the card, the chapters and the hidden plane scroll beneath
  them. On a phone held sideways, they stay pinned on the left and the rest
  scrolls beside them.
- **Small distances.** A body in the slice never prints 0.00, and no reading
  prints a signed zero: a non-zero value under the last place prints as its
  bound ("under 0.005"), and an exact zero prints without a sign. A keyboard
  step, or a slide to a body, that comes within 10⁻¹² of zero lands on zero; a
  drag is kept as given. A value the page derives — a component of the
  normal, a body's extent — prints as zero within 10⁻¹², and the map's slide
  reads the normal without components under 10⁻¹². At a turn of exactly 90°
  the normal's w component is 2.2·10⁻¹⁶.
- **Absence wording.** One vocabulary describes absence, and the clock line
  says when it is paused.

The classic pages are unchanged, and their notes below still hold for them.

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

In both presets the ball's surface reaches the box's +w face at step 72
(t = 0.600 s, gap 4.4e−15), and the impulse is applied at step 73
(t = 0.608 s). The rotation
study's x–w face transition is at tan α = 1.0/1.2, about 39.81°.

## Reproducing the evidence

From a checkout of this repository:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm exec vitest run examples/showcase/test/spatial-4d-turn examples/showcase/test/spatial-4d-contact
pnpm exec vitest run examples/showcase/test/hidden-direction
pnpm --filter @holotope/showcase typecheck
pnpm --filter @holotope/showcase dev
```

`pnpm build` comes first because the test lane resolves `@holotope/physics` from
its build. With the dev server running, open `/spatial-4d-turn-classic.html`
and `/spatial-4d-contact-classic.html` for the classic pages, and
`/spatial-4d-turn.html` and `/spatial-4d-contact.html` for The Hidden Direction.

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

The Hidden Direction's suite holds 839 tests in 14 files. They drive the
controller through the same entry point the page uses, and their oracles are
independent: fresh instances, closed forms and literals. They do not drive the
page's own wiring of controls to that entry point (`app.ts`), which needs a
browser. That wiring was checked by genuine input in a browser, outside this
suite.

- **Kind boundaries.** Every action variant is applied from seven prior
  states, and the state the action's kind must not touch is compared bitwise.
- **Chapter setup.** Each chapter, entered from messy states, gives the same
  view, internals and continuation as a fresh chapter.
- **The map against the library.** The map draws a chord exactly when the
  library says a body is not outside the slice. This holds by construction,
  and it is checked over 29 750 readings and at the band-edge case that
  separates the two roundings.
- **What a slice meets.** Both of the turning scene's reference limits are
  read with the dimensions of the meeting and with what was drawn. So are
  turned and posed faces of the contact box, and a touching ball.
- **Event lines against the meeting.** In both worlds, the slice is moved onto
  a box's faces from inside by arrow keys and gauge drags, and back in. In the
  contact world it also reaches them from outside, and by map turns. The
  block's faces lie at the slider's limits, so they have no outside. The
  physics clock is driven by playing, by its buttons (Step, Step −1, Just
  before the blow, Replay launch and each launch) and by the empty view's
  replay to just after the blow.
  - After every key press, pointer move, button and tick, each sentence of the
    line on screen is parsed for what it says about a body.
  - The claim is checked against the body's reading now. A reported change
    ("appeared", "now passes through") is checked against its reading before,
    and the change's cause ("you moved your slice", "it moved", a replay, a
    launch) against the input that made it.
  - A body whose meeting changed must be named in the new line. A change of
    status leads it, and when nothing named changed, nothing new may be said.
  - The test does not use the rule that decides when the page speaks.
- **Replays and blows.** Strike hints, replays and new launches are driven
  through the page's own button bindings and the empty view's replay action,
  at retained offsets.
- **Identity, absence and the observer.** The tests cover face identity across
  the slice and the shadow, the four empty-view causes and their recoveries,
  and the observer note read from the live slice. The note is also pinned on
  the classic contact page, which previously had no test for it.
- **The authored contract, by literal.** These include the restitution of 1,
  the friction of 0, the settings and the presets.

## Limits and open questions

- **Prepared scenes, discrete stepping.**
  - The contact page steps discretely and does not use continuous collision.
    Its scene is two bodies and one impact per run, with no gravity, friction,
    stacking or third body. That says nothing about general multi-body
    robustness or continuous-collision coverage.
  - Zero penetration at detection is a coincidence of the authored gap: the
    touch falls exactly on a step boundary.
  - At speed 2 and a step of 1/120 s the ball moves 0.0167 per step, 3.3% of
    its radius, so tunnelling is not reachable here. That figure follows from
    the scene's constants; no test asserts it, and it is a property of these
    scenes, not of discrete stepping.
- **A body is not contained in a section.** In stage A both centres lie in the
  x = 0 section, so the cut passes through the middle of each. Neither body is
  contained in it: the box spans 2.4 in x and the ball 1.0. The section of a 4D
  solid is not the solid.
- **The guided stages assume the offset is 0.** Stage A's action turns the knife
  to 90° and stage D's turns it back to 0°, but each sets only the turn and
  keeps any offset already set. Replaying a preset keeps the knife as well.
  Stage B asks you to move the offset, so restore it to 0 before you follow
  stage A's "x = 0" or stage D's reference view. Otherwise their claims do not
  hold. For example, with the offset left at +1.6, the ball's centre is at
  w = 1.5 at the first touch, so stage D's knife cuts the ball in a sphere of
  radius 0.49, although the stage says the ball never appears.
- **The containment check is a spot-check.** A test sweeps the stage texts, the
  guided script and the page markup with patterns for wording that claims a
  body is contained in the section. It does not scan prose the page generates
  at runtime. Those patterns are subject- and voice-limited.
  Phrasings such as "the section contains both bodies" or "the ball lies wholly
  within this cut" pass them. The substantive guard is the positive pinning of
  the exact required sentences, on top of asserted scene geometry.
- **Presentation notes, kept as they are.** The narrow-width notes come from
  desktop-browser emulation at 375 px, not a phone:
  - On the contact page, below 880 px the stage is not sticky, so it scrolls
    out of view under the lower controls. Its two checkboxes are 13 px, the
    browser default.
  - On the turn page at 375 px, the default camera clips the block's right side
    and can leave the ball out of frame while the readout says it is in the
    section. The stage and the controls do not fit on screen together.
  - On the contact page, after *Pause* the time note still reads "Playing:
    fixed steps from the wall clock."
  - On the turn page, *Reset section* also returns the ball's phase to 0 and
    stops *Play*.
  - Stage B says "While paused…", but arriving at stage B does not pause the
    clock. Its first action, *Jump to the first touch*, does.
  - One idea has three words: the stage asks until both bodies are "gone from
    the cut", while the readout calls the box "absent" and the ball "hidden".
  - Small negative distances display as −0.00.
- **Numbers with distinct roles.**
  - Membership in the cut is a geometric predicate, |signed distance| ≤ 1e−9,
    never a rounded display. A point at 0.004 displays as 0.00 and is not in
    the cut.
  - Drawn buffers are Float32, so values read back from them are held to 1e−5.
  - Restitution is enforced to nine places. Contact-point |1 − e| was also
    measured across 108 settings: both presets × dt {1/120, 1/240, 1/480,
    1/1200, 1/12000, 1/120000} × substeps {1, 2, 4} × solver iterations
    {8, 16, 32}. The worst was 4.4e−16, at preset B, dt 1/480, 1 substep and 8
    iterations. That is a measurement of the build it ran on, not a portability
    guarantee, and no test asserts it.
  - The graze band (0.02) and the ball's three circles are display
    conventions, not geometry.
- **Tolerances are mirrored.** The sectioner's tolerance is copied, not read,
  because the library does not export it.
- **States no preset reaches.** "Overlapping", and "unsupported here" (the
  query's ambiguous-interior state), are labelled but never reached.
- **Open design.** A knife turning in two planes at once is not designed. The
  page steps by wall-clock accumulation, at most eight fixed steps per frame, so
  two sessions can differ in how many steps have run at a given moment. The
  state per step is what the tests hold.

## Review it yourself

A short task for a reviewer with only this repository:

1. **Reproduce the reference collision.** Run the commands above. On the contact
   page, choose preset A, press *Jump to the first touch*, then *Step +1*.
   Confirm: the touch at step 72; the impulse at step 73; the ball leaving at
   +2/3 and the box at −4/3 along w; no spin.
   Compare with `examples/showcase/test/spatial-4d-contact/simulation.test.ts`,
   section 2.
2. **Change the observer without changing the bodies.** Pause just after the
   impact. Turn the knife, slide the offset, toggle the projection and orbit the
   camera, and confirm that no position or velocity in the readout moved.
   `views.test.ts` holds the same claim bitwise across 180 steps. Check that the
   probe moved something, or the claim is vacuous.
3. **Inspect the hidden-plane spin.** In guided stage E, choose preset B and
   *Jump to just after the impact*. Read the box's spin in the x–w plane and the conserved total.
   Then open the rotation study and compare a prescribed x–w turn with the
   collision's.
4. **Attack the limits above.** For example:
   - start the ball at w = 2.66 instead of 2.7, which needs an edit to the
     presets in `src/spatial-4d-contact/simulation.ts`, and look at penetration
     at detection;
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
