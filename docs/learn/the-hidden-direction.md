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
can vanish from the picture without going anywhere: it has moved, or the slice
has, along a direction the slice cannot show.

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
| **the camera** | drag the picture; *Re-centre camera* or C | where you look from; never what is cut |
| **the object** | chapter V only: drag the box's angle | the box, in a separate scene, by a prescribed turn |

Hold Shift with an arrow key for a step ten times larger. Moving the slice or the
camera never changes the world: no body moves and no clock runs.

## The chapters

Each chapter sets up its stated starting state in full, whatever you did before,
and says what that state is under its title.

1. **[Something passes through](https://nikilp.github.io/holotope.js/spatial-4d-turn.html#arrival).**
   Press play. A ball follows a prescribed orbit through w and leaves your
   slice. Follow it: on the map, its footprint is still there.
2. **[One block, many slices](https://nikilp.github.io/holotope.js/spatial-4d-turn.html#cuts).**
   The block never moves. Turn your slice and watch the cut change, then lift
   the shadow. Tap a coloured face to follow that face across the slice and the
   shadow.
3. **[A collision you cannot see](https://nikilp.github.io/holotope.js/spatial-4d-contact.html#collision).**
   A box is struck by a ball your slice cannot show. The map shows where the
   ball is.
4. **[A spin in a hidden plane](https://nikilp.github.io/holotope.js/spatial-4d-contact.html#spin).**
   The same drop lands off-centre and sets the box turning in the x–w plane. On
   the map, the box's footprint turns.
5. **[Turn the object, not the slice](https://nikilp.github.io/holotope.js/spatial-4d-contact.html#turning).**
   A separate scene turns the same box by hand while your slice stays fixed at
   w = 0. Compare a turn through w with an ordinary turn.

**[Explore freely](https://nikilp.github.io/holotope.js/spatial-4d-turn.html#free)**
leaves everything where it is and unlocks every instrument in both worlds.

## Three clocks

- **The prescribed orbit** moves the ball in chapters I and II. No physics is
  involved: no force acts, and nothing is integrated.
- **The physics clock** runs the collision in fixed steps of 1/120 s. It only
  steps forward. *Step −1*, *Just before the blow* and *Replay launch* each build
  a fresh run from the launch; nothing is rewound.
- **The prescribed turn** in chapter V is a separate scene with its own angle and
  slice. It reads and writes nothing of the collision.

*Freeze & compare* stops whichever clock is running and lifts the shadow.

## When the picture is empty

An empty picture is explained in the picture, with a way back. There are four
causes, and the page names which one applies:

- **Outside your slice.** The body lies wholly to one side, ana or kata, at a
  stated distance. *Slide your slice to it* moves the slice if the slider can
  reach it.
- **Touching your slice.** The slice meets the body only along its boundary,
  within 10⁻⁹. Such a cut is a face, an edge or a point, and only solids are
  drawn.
- **Outside the camera's view.** The body is in your slice but out of frame.
  *Turn the camera to it* moves the camera only.
- **Not drawn.** The body is in your slice by the library's test, but the
  renderer was given nothing to draw. The scenes here never reach this case, but
  it is named so that it is never mistaken for absence.

## Keyboard, touch and motion

Everything can be done from the keyboard. Tab reaches every control. The map
and the gauge are sliders that respond to the arrow keys, and Home returns
each to zero. Space plays or pauses, `.` and `,` step the physics clock, S lifts the
shadow, F freezes, R resets the slice and 1–6 choose a chapter. On a phone, the
picture stays pinned at the top while you scroll to the instruments. If your
system asks for reduced motion, the camera stops gliding and the transitions
are removed.

## What this is not

These are two small, prepared scenes: one unmoving block and a ball on a stated
path, and one box struck once by one ball. They show what a slice of R⁴ does to
rigid bodies, exactly, within those scenes. They make no claim to give you an
intuition for four dimensions, and none about general multi-body physics.

The [classic instruments](https://nikilp.github.io/holotope.js/spatial-4d-turn-classic.html)
these chapters were built from are still available, with every number on show.
