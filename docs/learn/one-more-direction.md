# One More Direction — how to explore

A short guide for visitors to
[One More Direction](https://nikilp.github.io/holotope.js/flatland.html), the
showcase's way in before
[The Hidden Direction](./the-hidden-direction). It describes what is on the
screen, what each control moves, and what the page does not claim.

## What you are looking at

Two worlds, one rung apart, built the same way:

- **A cube and a plane.** The world has three directions; the plane has two. The
  plane's missing direction is up and down, and the picture shows it, because
  you see the cube and the plane from outside the plane.
- **A tesseract and your space.** The world has four directions; your space, the
  whole picture, has three. Its two ways along the missing fourth direction, w,
  are called **ana** and **kata**; they are not up and down. There is no outside
  to see the tesseract from: the gauge shows where it lies along w, and the dial
  the plane it turns in. Both draw ana toward their top, a convention of the
  drawing, not a direction in the picture. Chapter IV names them, and free
  exploration's second world says all of this, for a visitor who starts there.

In both worlds, two things are all the slice can have of the object:

- **The cut** is where the object meets the slice, drawn filled. In the plane,
  each side of the cut takes the colour of the cube face it lies in, and the
  cube's edges that cross the plane are lit, one for each corner of the cut. One
  rung up, each face of the cut solid takes the colour of the tesseract cell it
  lies in: x red, y green, z blue, w gold, darker on the − side.
- **The shadow** is all of the object, dropped straight along the missing
  direction, drawn as lines. Where several corners land on one point, its dot is
  larger and says how many. Two corners on one point are still two corners.
  While chapter III or V asks how many land on a point, every dot is drawn the
  same size, and nothing beside the picture counts them: not the gauge's ticks,
  not the readouts, not the list of points. Picking the point, or the answer,
  brings the counts back.

The **camera** is only how you look.

## Four hands, each changing one thing

| hand | how | changes | never changes |
| --- | --- | --- | --- |
| **Look** | drag the picture; Q and E turn the camera, + and − bring it nearer or farther, *Re-centre camera* or C brings it home | the camera | the object, the cut, the shadow |
| **Slide** | tap or drag the gauge; ↑ ↓ in steps of 0.1; Page Up and Page Down jump to the next layer of corners; *Pass through* | where the slice is, along the missing direction | the object |
| **Turn** | drag the dial's knob, or choose a named pose; ← → | the object's pose, rigidly | its shape and every edge's length |
| **Cast** | *Show the shadow*, or S | whether the shadow is shown | the object, the cut |

The gauge shows the object's reach along the missing direction, with a tick for
each layer of corners: the heights where the cut can change, each with how many
corners share it. A drag near a tick lands on it exactly. Page Up and Page Down
go from tick to tick and pass over the cuts between them; ↑ and ↓ show those.
The dial draws the object in the plane it turns in, with the missing direction
toward the top.

In the third chapter, and in free exploration, *Hide the cube* takes the cube
out of the picture, not out of the world: what is left is what the plane holds.

## The chapters

Each chapter sets up the starting state its card describes, whatever you did
before. The camera is the one thing a chapter leaves alone.

1. **[Through the plane](https://nikilp.github.io/holotope.js/flatland.html#through).**
   A cube hangs above the plane, face first. Slide the plane up through it.
2. **[Stand it on a corner](https://nikilp.github.io/holotope.js/flatland.html#corner).**
   The same cube on its corner. Guess what the plane meets halfway, then slide.
3. **[Light from the missing direction](https://nikilp.github.io/holotope.js/flatland.html#shadow).**
   The cut and the shadow together. Guess what lands on the shadow's centre.
4. **[One rung up](https://nikilp.github.io/holotope.js/flatland.html#up).**
   A tesseract and your space; it starts out of reach, ana of your space. Slide
   through it, then carry a rule up from the cube: what does your space hold just
   past a corner?
5. **[Its shadow, one rung up](https://nikilp.github.io/holotope.js/flatland.html#up-shadow).**
   The tesseract's cut and shadow, and the way on to The Hidden Direction.

**[Explore freely](https://nikilp.github.io/holotope.js/flatland.html#free)**
leaves both worlds as you left them, with every hand.

The page's earlier links still work: `#section` opens chapter II,
`#projection` chapter III, and `#tesseract` chapter IV.

## Guessing first

Chapters II to V each ask one question with a few answers to choose from. You
need not answer before you act. The answer is worked out from the numbers on
screen, and shown when you find it:

- in chapters II and IV, by sliding to the cut the question asks about, by hand
  or with *Pass through*. A turn that lands there shows the cut, but the question
  stays open until you slide;
- in chapters III and V, by picking the point of the shadow it asks about.

The button under the answers offers one step at a time. In chapter II it is
*Corner first*, then a slide just past the lowest corner, then one to the
middle; in chapter IV, *Corner first*, then a slide just past the first corner.
In chapters III and V it is the pose the question needs, then *Point out*, which
rings the place in the picture without saying what lands there, then *Show me
what lands there*, which picks it. Your own hands work as well.

## Picking a point

Click or tap a corner of the cut to see the source edge it lies on and how far
along it, or a point of the shadow to see every corner that lands there and how
far each lies from the slice. The cube's own corners can be picked in the plane.
The same points are listed under *What exactly am I seeing?*, as buttons, for
the keyboard; the shadow's points are left out of that list while chapter III or
V asks about them.

## When nothing is cut

An empty cut is not an absent object. The card says what the slice meets and how
far away the nearest corner is, on which side. When the picture has nothing at
all to show — nothing cut, no shadow, no object drawn — a note in the picture
says the same, with a way back.

When the slice only touches the object, the card names what it shares: a single
corner, an edge, or a whole face or cell. Whether anything is drawn then depends
on the library's sectioner, and the card says which of two reasons applies:

- from the far side, the sectioner cuts only where a corner lies strictly below
  the slice (strictly kata of it, one rung up), and it counts a corner in the
  slice as lying above (ana); so nothing is drawn;
- from the near side, a whole face or cell in the slice is drawn, but a corner
  or an edge alone collapses to a point or a segment, which the sectioner leaves
  out.

*What exactly am I seeing?* lists the sectioner's own count of the cells it
examined, so that "nothing is drawn" is never a guess.

## Keyboard, touch and motion

Tab reaches every control. The gauge and the dial are sliders: while one has
focus, its arrow keys are its own, Home on the gauge puts the slice through the
middle, and Home and End on the dial choose the first and last named poses. With
nothing focused, ↑ and ↓ slide, Page Up and Page Down jump to the next layer of
corners, ← and → turn, Space passes through or stops, S casts the shadow, H hides
or shows the cube, R resets the chapter, Escape stops a passage or, with none
running, lets go of a picked point, and 1–6 choose a chapter.

On a phone held upright, the picture stays pinned at the top with the gauge
beside it while the card and the other instruments scroll; held sideways, the
picture stays on the left. On a touch screen every control is at least 44
pixels tall.

*Pass through* runs only when you press it, and stops when you ask, when you
turn the object, and when you slide, reset or change chapter: the slice never
slides on by itself while the object turns. It carries the slice on from where
it is, or from below the object once the slice has passed it, to beyond the
object, and rests on the exact middle for 0.9 seconds when it crosses it. If
your system asks for reduced motion, it moves the slice in steps of 0.1, one
every 0.35 seconds, rather than gliding, and rests on the middle the same way; named
poses are reached at once rather than turned to, and the camera stops gliding.
↑ and ↓, or taps on the gauge, take you through the same cuts with no motion at
all.

## What this is not

One cube and one tesseract, each cut by a slice that never tilts, and each
shadow cast straight along the missing direction. The page has no nets, no
unfolding and no view from inside the plane: something living in the plane
would meet even the cut only edge-on. A cut keeps one slice and a shadow piles
corners together, so neither alone tells you the whole object. The page makes no
claim to give you an intuition for four dimensions.
