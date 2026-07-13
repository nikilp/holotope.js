# Exact cut-and-project model sets

A cut-and-project scheme reads one lattice point in two complementary coordinate systems:

```
physical position:  pi_parallel(x)
internal position:  pi_perpendicular(x)
```

Given a compact internal-space window `W`, the model set contains exactly those physical positions whose internal coordinate lies in the window:

```
Lambda(W) = { pi_parallel(x) : x in L and pi_perpendicular(x) in W }.
```

Holotope.js keeps the lattice point and both projections exact until the result reaches a renderer:

- `LatticeN` stores a finite-rank basis over one exact ring;
- `FlatN` stores the exact parallel and perpendicular linear maps, with optional offsets;
- `ConvexWindow` stores ring-valued halfspaces;
- `ModelSet` enumerates an explicitly bounded coefficient box and returns each accepted point with its lattice coefficients and both exact projections.

The finite bound is part of the call rather than hidden state. Generic sampling uses a coefficient box; specialized helpers may use complete lattice-norm shells. A returned patch is therefore an honest sample of an infinite model set, not a claim to have generated the whole object.

## Boundary conventions

Window membership is an exact ordered-ring comparison. A point is classified as `inside`, `outside`, or `boundary`; no epsilon participates.

Each facet may include its boundary, exclude it, or defer to the model set's global `include | exclude | error` policy. The patch reports the number of boundary hits even when every hit has an explicit facet decision. This makes singular cuts visible and testable.

## Fibonacci chain

The Fibonacci scheme starts from `Z^2` and uses the two real readings of `Z[phi]`:

```
pi_parallel(m,n)      = m + n phi
pi_perpendicular(m,n) = m + n (1 - phi).
```

The canonical half-open window is

```
[phi - 2, phi - 1).
```

It is singular: one projected lattice point meets each facet. Including the lower facet and excluding the upper produces the fixed point of `L -> LS, S -> L` exactly. Consecutive physical gaps are `phi^2` and `phi`; rescaling by `1/phi` gives the familiar long and short lengths `phi` and `1`.

```ts
import { fibonacciPatch } from '@holotope/core/lattice';

const patch = fibonacciPatch(34);
patch.tiles.join(''); // LSLLSLSLLSLLS...
patch.points[0].coefficients; // exact lattice provenance
```

## Ammann–Beenker octagonal model set

The Ammann–Beenker scheme identifies `Z^4` with the cyclotomic integers `Z[zeta_8]`. The physical embedding reads `zeta_8` as a 45-degree rotation; the star map sends `zeta_8` to `zeta_8^3` for the internal embedding.

The implementation stores doubled projection numerators over `Z[sqrt(2)]` and records a common denominator two. This keeps every decision exact while exposing standard unit-edge Float64 coordinates:

```
2 pi_parallel(n) = (
  2n0 + sqrt(2)(n1-n3),
  2n2 + sqrt(2)(n1+n3)
)

2 pi_perpendicular(n) = (
  2n0 + sqrt(2)(-n1+n3),
 -2n2 + sqrt(2)(n1+n3)
).
```

The window is the internal projection of the unit four-cube: a centered regular octagon of edge length one. In doubled internal coordinates its exact halfspaces are

```
|x|, |y|       <= 1 + sqrt(2)
|x+y|, |x-y|   <= 2 + sqrt(2).
```

This centered cut is nonsingular. Multiplication by `zeta_8` acts on lattice coefficients as an exact 45-degree symmetry. Silver-mean inflation is another integer provenance map: it multiplies physical coordinates by `1+sqrt(2)` and internal coordinates by the conjugate `1-sqrt(2)`, which contracts them back into the window.

```ts
import { ammannBeenkerPatch, ammannBeenkerInflate } from '@holotope/core/lattice';

const patch = ammannBeenkerPatch({ physicalRadius: 8 });
const inflated = ammannBeenkerInflate(patch.points[0].coefficients);
```

The canonical helper is parameterized by an exact internal offset. The showcase exposes several quarter-unit phason presets; each translates the internal coordinates before window membership and therefore selects a distinct locally related pattern. Arbitrary applications can construct `FlatN` and `ConvexWindow` directly for other exact offsets or window geometries.

## Rhombic Penrose multi-window model set

The Penrose scheme uses the cyclotomic module `Z[zeta_5]`, represented by four integer coefficients in the basis

```
1, zeta_5, zeta_5^2, zeta_5^3.
```

The physical embedding reads `zeta_5` as a 72-degree rotation. The star map sends `zeta_5` to `zeta_5^2` and supplies a second exact planar coordinate over `Z[phi]`. Unlike a single-window model set, Penrose also retains the coefficient sum modulo five. Its four nonzero classes route the internal coordinate to

```
W(1) = P
W(2) = -phi P
W(3) =  phi P
W(4) = -P,
```

where `P` is the regular pentagon whose vertices are the five powers of `zeta_5`. `PenroseModelSet` keeps this finite `C5` component explicit and exposes all four windows separately.

The default internal translation is `(1,1)/7` in the exact `{1,zeta_5}` basis. No lattice point can meet a window facet under this shift: reducing a hypothetical facet equality modulo seven leaves a nonzero normal-offset pairing. The centered cut is available by passing a zero offset, but it is singular and therefore requires an explicit include or exclude policy.

```ts
import {
  penrosePatch,
  penroseVertexStarCensus
} from '@holotope/core/lattice';

const patch = penrosePatch({ physicalRadius: 9 });
const stars = penroseVertexStarCensus(patch, { interiorRadius: 7.5 });
stars.size; // 7 geometric vertex-star types
```

Two accepted points share a rhomb edge when their cyclotomic provenance differs by one of the five powers of `zeta_5`. Converting the exact `{1,zeta_5}` coordinates to an orthonormal plane makes all such edges unit length. The resulting local edge stars realize the seven geometric Penrose vertex types modulo the full local dihedral action.

## Ammann–Kramer–Neri icosahedral model set

The AKN scheme raises both sides of cut-and-project to three dimensions. Six integer coefficients multiply the six golden-axis generators

```
(+/-1, phi, 0), (0, +/-1, phi), (phi, 0, +/-1).
```

Replacing `phi` by `1-phi` gives the internal generators. The window is the internal projection of the six-cube, a rhombic triacontahedron.

Holotope.js derives the window rather than storing a floating hull. Every pair of its six generator zones has an exact cross-product normal. The support value of the projected cube is the sum of the six exact absolute dot products, with the cube's half-width cleared algebraically. Fifteen generator pairs produce thirty ring-valued halfspaces.

Two signed permutations of the six lattice coefficients pin icosahedral symmetry: one closes after three applications and one after five. The centered, fully symmetric window is singular; its canonical helper uses an explicit closed-window convention and reports all boundary hits in every finite patch.

An optional exact internal translation selects regular members of the same hull. The `(1,1,2)/7` preset is globally nonsingular: none of the thirty facet normals pairs to zero with its numerator modulo seven. Shifted patches therefore use the strict `error` boundary policy by default and can expose phason rearrangements without a floating perturbation.

```ts
import { aknPatch, aknRotate5, phiRing } from '@holotope/core/lattice';

const patch = aknPatch({
  physicalRadius: 5,
  phasonOffsetSevenths: [phiRing.one, phiRing.one, phiRing.fromInt(2)]
});
const rotated = aknRotate5(patch.points[0].coefficients);
```

## Elser-Sloane canonical model set and sections

The Elser-Sloane scheme applies cut-and-project to the E8 lattice itself. Its two four-dimensional readings are the Galois-conjugate icosian embeddings already used by the E8 folding construction. The physical coordinate is an icosian `x`; the internal coordinate is its conjugate `x*`.

The canonical acceptance window is a four-dimensional convex polytope with 720 vertices. After clearing the common orthogonal-projection normalization, the vertices remain in `Z[phi]`: 120 belong to a 600-cell orbit and 600 to its reciprocal 120-cell orbit. The implementation stores the resulting H-description as ten exact H4 facet seeds whose signed even-permutation orbits produce 1,200 supporting halfspaces.

The innermost finite germ gives two exact shell checks:

- 120 of the 240 E8 roots meet the window, on its 600-cell boundary;
- 120 of the 2,160 norm-4 E8 vectors lie inside it.

Both accepted sets form 600-cell metric skeletons in physical space. Their lattice vector, source shell, internal coordinate, and boundary status remain attached as provenance.

```ts
import { elserSloaneGerm, elserSloaneWindowHalfspaces } from '@holotope/core/lattice';

const germ = elserSloaneGerm();
germ.rootCount;        // 120
germ.secondShellCount; // 120
elserSloaneWindowHalfspaces().length; // 1200
```

The full bounded scheme uses a fixed unimodular E8 root basis with four physical and four internal icosian coordinates. Two finite sampling policies are available:

- `elserSloanePatch` enumerates an explicit coefficient box, matching the generic `ModelSet` contract;
- `elserSloaneNormPatch` enumerates complete E8 shells through a requested quadratic norm, preserving complete symmetry orbits for explanatory renders.

Both samplers accept an optional exact internal phason in eleventh-coordinate units. The built-in regular showcase shift has numerator

```
(-2-2phi, -2-2phi, -2+phi, -phi).
```

Its pairing with every facet normal is nonzero modulo eleven, so no E8 lattice point can meet the translated boundary. This gives a globally regular companion to the singular centered model. Translating the window origin breaks the centered H4 symmetry and the canonical same-window inflation inclusion; applications should not carry either claim across unchanged.

Inflation is an integer automorphism `S` of the E8 coefficients. It satisfies

```
S^2 = S + I,
```

and therefore acts by `phi` on physical coordinates and by `1-phi` internally. The latter contracts the window, so every accepted point inflates to another accepted point without a floating rescaling decision.

For any pair of points, the product of their physical and conjugate squared distances reduces to an integer in the unnormalized icosian convention (`1/20` times that integer in the orthonormal E8 projection convention). `elserSloaneGaloisProduct` evaluates this conservation law exactly.

Fixing the fourth physical coordinate produces a three-dimensional section. The section helper compares the exact `Z[phi]` coordinate and its nearest-edge graph is also selected by exact squared distance. No slab thickness participates.

```ts
import {
  elserSloaneInflate,
  elserSloaneNormPatch,
  elserSloaneSection
} from '@holotope/core/lattice';

const patch = elserSloaneNormPatch({ maxE8Norm: 8 });
const section = elserSloaneSection(patch.points); // exact fourth coordinate = 0
const image = elserSloaneInflate(section[0].coefficients);
```
