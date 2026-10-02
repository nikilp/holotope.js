# spatial-4d-contact — the guided exploration, as a script

Page: `spatial-4d-contact.html` in the showcase, live at
<https://nikilp.github.io/holotope.js/spatial-4d-contact.html>. The guide panel
at the top of the controls walks these five stages; every button in it says
which of three things it touches — **view only** (the observer moves, the
world does not), **changes simulation time** (a fresh launch, a replay to a
fixed step count, or one fixed step), or **separate scene** (the rotation
study, which never reads or writes the collision). Nothing is animated for
you except the simulation itself while it plays; the knife is never turned on
your behalf.

## A. A familiar collision (knife at 90°)

Click *Select preset A and reset the clock*, then *Turn the knife to 90°*. The
section is now the hyperplane x = 0. Both bodies’ centres lie in this section,
so the cut passes through the middle of each. Their 4D bodies extend beyond it
— the box spans 2.4 in x, the ball 1.0 — which is why what follows looks like
an ordinary collision. Before *Play*, predict: after the hit, which body moves
faster, and which way? (Masses 1 and 2, restitution 1: the ball comes back at
a third of its speed, the box leaves at two thirds.)

## B. Hold the event; move the section

Click *Jump to the first touch*: the simulation is replayed from launch for 72
fixed steps to t = 0.600 s, where the ball's surface reaches the box's +w face
(gap 0). *Step +1* applies the impulse (step 73, t = 0.608 s); *Step −1* is
also a replay, to the previous step. While paused, drag *Section offset*. The
bodies leave the cut; the world does not change — check that no position or
velocity in the readout moved.

## C. Reveal the context

Tick *Show projection context*. The faint edges are the whole box flattened
into this chart at its current pose; the faint circles are the ball's extent.
They stay wherever the knife is. Overlap in the projection is not contact —
the readout gives the true gap along the contact normal, and the pale marker
is the last contact point projected, with its own signed distance and an
explicit "lies in / is not a point of the current cut".

## D. Back to the puzzling view

*Turn the knife back to 0°*, then *Replay preset A from launch*. In this cut the
ball never appears (its centre never comes nearer than 1.5 to the knife), yet
the box is struck at 0.608 s and leaves the cut at 1.358 s. You now know where
the cause is, and two ways to see it: turn the knife, or show the projection.

## E. The turning, then the off-centre collision

*Open the rotation study* (a separate scene — the collision keeps its state).
Two named modes turn the same box about its centre with a prescribed angle,
no translation, no collision, fixed section at w = 0:

- *Ordinary turn — x–y plane*: the section is the same rigid 3D box rotating
  inside the cut. Nothing about its shape changes.
- *Turn through the fourth direction — x–w plane*: the box stays rigid; the
  section changes shape because it cuts different parts of the object — not
  because the object deforms. Its x half-extent runs 1.2 → 1.562 at the 39.8°
  face transition → 1.0 at 90°; y and z stay 0.9 and 0.7.

Switching modes keeps the object angle and says what changed; the section
frame and the camera never move. Use the landmarks, the scrub, slow playback.

Then *Select preset B*, *Jump to just after the impact*, *Step +1*. Here the
turn is no longer prescribed: the collision produces it, and the body also
translates along w. In the reference section there is a viewing window of
about 1.3 s after the impact before the box leaves the cut; the projected
context shows the motion beyond it. Describe the two things separately: the
SECTION changes width as the box turns through the cut; the SOURCE box turns
rigidly in x–w and moves along w.
