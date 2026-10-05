# The Hidden Direction — how to explore

A short guide for visitors to
[The Hidden Direction](https://nikilp.github.io/holotope.js/spatial-4d-turn.html),
the showcase's guided way into watching a four-dimensional world through a
three-dimensional slice. It describes what is on the screen, what each control
moves, and what the pages do not claim. What the scenes demonstrate, and how to
check it yourself, is in
[Turning a section, and contact](./spatial-sections-and-contact).

## What you are looking at

The world has four directions: x, y, z and w. Your screen shows a **slice** of
it — the three-dimensional set of points where a hyperplane crosses the world —
drawn in solid colour. A body appears only where the slice cuts it, so a body
can vanish from the picture and still be there: it moved, or you moved the
slice, along a direction the slice cannot show, or the physics clock was
replayed or launched afresh to an instant where it lay elsewhere. A body can also be cut and
simply outside the camera's view. The page says which of these happened.

Two words name that direction once, against your slice. **Ana** is the side the
slice's normal points to; **kata** is the other side. They never mean up or down
in the picture. With the slice untilted, its normal is +w.

Beside the picture are two instruments for your slice. Neither one is a view of
the world from inside it:

- **The hidden plane** is a map of the x–w plane, seen from outside. Every body
  is flattened onto it along y and z — its *footprint*, not its shadow — and your
  slice crosses it as a bright line, with the ana side shaded. Whatever the line
  crosses, your slice cuts. This holds exactly because the slice only ever turns
  in the x–w plane. The bright chord through a footprint is the cut, flattened.
- **Across your slice** is a gauge. Each bar is a body's extent along the slice's
  normal, and the bright line is the slice itself. A bar that crosses the line is
  in your slice.

*Lift the shadow* adds a third view inside the picture. The **shadow** is all of
each body, flattened onto your three-dimensional view along the slice's normal,
and it is drawn as lines. Solid is always the slice; lines are always the shadow.
Two shadows that overlap are not touching.

## Four ways to move, kept apart

| you move | how | what changes |
| --- | --- | --- |
| **the slice, along its normal** | drag the bright line on the gauge, or anywhere on the map; ↑ ↓ | which part of the world is cut |
| **the slice, by turning it** | drag a bright end of the line on the map; ← → | the direction of the cut, in the x–w plane |
| **the camera** | drag the picture; Q and E turn it, + and − bring it nearer or farther, *Re-centre camera* or C brings it home | where you look from; never what is cut |
| **the object** | chapter V only: drag the box's angle | the box, in a separate scene, by a prescribed turn |

Hold Shift with an arrow key for a step ten times larger. Moving the slice or the
camera never changes the world: no body moves because of it, and no clock starts,
stops or steps. When a body vanishes, the line in the picture says what happened
— the body moved, you moved your slice, or the run was replayed or launched
afresh — and on which side of your slice the body now lies. When that happens
in the same moment as the blow, the blow is said first and the body's side
after it. The line also changes when your slice moves from passing through a box
to lying on one of its faces, or back. On a phone, while the picture is empty,
the card that says why lies over the line and the camera's controls, and in a
small window it can cover part of either; they show again when the card
closes.

## The chapters

Each chapter sets up its stated starting state in full, whatever you did before,
and says what that state is under its title. The camera is the one thing a
chapter leaves alone: it stays where you left it, and *Re-centre camera* or C
brings it home.

1. **[Something passes through](https://nikilp.github.io/holotope.js/spatial-4d-turn.html#arrival).**
   Press play. A ball follows a prescribed orbit through w and leaves your
   slice. Follow it: on the map, its footprint is still there.
2. **[One block, many slices](https://nikilp.github.io/holotope.js/spatial-4d-turn.html#cuts).**
   The block never moves. Turn your slice and watch the cut change, then lift
   the shadow. Click or tap a coloured face, or press *Follow a face*, to follow
   that face across the slice and the shadow.
3. **[A collision you cannot see](https://nikilp.github.io/holotope.js/spatial-4d-contact.html#collision).**
   A box is struck by a ball your slice cannot show. The map shows where the
   ball is.
4. **[A spin in a hidden plane](https://nikilp.github.io/holotope.js/spatial-4d-contact.html#spin).**
   The same drop lands off-centre and sets the box turning in the x–w plane. On
   the map, the box's footprint turns.
5. **[Turn the object, not the slice](https://nikilp.github.io/holotope.js/spatial-4d-contact.html#turning).**
   A separate scene turns the same box by hand while your slice stays fixed at
   w = 0. Compare a turn through w with an ordinary turn. Entering this chapter
   pauses the collision's clock; nothing else of the collision changes.

**[Explore freely](https://nikilp.github.io/holotope.js/spatial-4d-turn.html#free)**
leaves everything where it is. Choose a world, and every instrument is yours in
it; the turning scene keeps its fixed slice.

## Three clocks

- **The prescribed orbit** moves the ball in chapters I and II. No physics is
  involved: no force acts, and nothing is integrated.
- **The physics clock** runs the collision in fixed steps of 1/120 s. It only
  steps forward. *Step −1*, *Just before the blow* and *Replay launch* each build
  a fresh run from the launch; nothing is rewound, and the picture says it was
  a replay, not that anything moved. Each guided chapter, chapter V included,
  starts with this clock paused.
- **The prescribed turn** in chapter V is a separate scene with its own angle and
  slice. It reads and writes nothing of the collision.

*Freeze & compare* stops whichever clock is running and lifts the shadow.

## When the picture is empty

An empty picture is explained in the picture, with a way back. There are four
causes, and the page names which one applies:

- **Outside your slice.** The body lies wholly to one side, ana or kata, at a
  stated distance. *Slide your slice to it* moves the slice if the slider can
  reach it. If the struck bodies have carried on beyond the slider's reach,
  *Replay to just after the blow* replays the physics clock from the launch.
- **Meeting your slice only on its boundary.** Within 10⁻⁹, your slice lies on
  part of a box's surface, or touches a ball. The page says what the meeting is
  and what was drawn.
  - A box's face can still be solid. At the slider's kata limit, −1.6, your
    slice lies on the block's whole −w face, a 4.4 × 2.6 × 1.6 cuboid. A turned
    slice can meet the contact box in a flat rectangle. Nothing is drawn for
    such a face when the box lies on the ana side of your slice. That is the
    convention of the library's sectioner, not a property of the meeting: it
    cuts only the cells that have a corner strictly kata of your slice, and it
    counts a corner on the slice as ana. From the kata side the same kind of
    face is drawn: at +1.6, the block's +w face.
  - A ball only ever touches at a single point. A point has no volume, so it is
    never drawn, whichever side the ball lies on; a small marker shows where.
- **Outside the camera's view.** The body is in your slice but out of frame.
  *Turn the camera to it* moves the camera only.
- **Not drawn.** The body is in your slice by the library's test, but the
  renderer was given nothing to draw. The scenes here never reach this case, but
  it is named so that it is never mistaken for absence.

A small marker with a dashed tag is not a cut. It marks where the ball touches
your slice. In the world of the block and the orbiting ball (chapters I and II,
and free exploration) it can also mark a near miss: the point where your slice
would first touch the ball.

## Keyboard, touch and motion

Tab reaches every control, and every button, slider and disclosure works from
the keyboard. The map, the gauge and the box's dial are sliders: while one has
focus, the arrow keys are its own — on the map they turn your slice, on the
gauge they slide it, on the dial they turn the box — and Home returns it to
zero. With no instrument focused, ← and → turn your slice and ↑ and ↓ slide it.
The other keys work the same with or without an instrument focused: Space plays
or pauses, `.` and `,` step the physics clock, S lifts the shadow, F freezes, R
resets the slice, and 1–6 choose a chapter. A focused button, link or
disclosure takes Space and Enter for itself. The camera has
fewer keys than the pointer. Q and E turn it about the vertical, + and − bring
it nearer or farther, and C brings it home. Tilting it up or down, and panning
it, need a pointer.

On a phone held upright, the picture stays pinned at the top while you scroll
to the instruments; held sideways, the picture stays pinned on the left and the
card scrolls beside it. On a touch screen, every button, slider, disclosure and
link on these two pages is at least 44 pixels tall. These sizes were measured in
emulation, not on a device. If your system asks for reduced motion, the camera
stops gliding and the transitions are removed.

## What this is not

These are two small, prepared scenes: one unmoving block and a ball on a stated
path, and one box struck once by one ball. They show what a slice of R⁴ does to
rigid bodies, exactly, within those scenes. They make no claim to give you an
intuition for four dimensions, and none about general multi-body physics.

The [classic instruments](https://nikilp.github.io/holotope.js/spatial-4d-turn-classic.html)
these chapters were built from are still available, with every number on show.
