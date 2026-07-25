# E8 roots through the H4 folding

The 240 roots of E8 admit two complementary exact descriptions in Holotope.js.

The Coxeter description starts from the rank-8 E8 diagram and reflects one simple root. The orbit has only 240 points, so `e8RootOrbit()` visits the orbit directly; it does not construct the Weyl group's 696,729,600 chambers.

The icosian description identifies R8 with four coordinates over Z[phi]. Coordinates are stored as bigint pairs `a + b phi`, doubled so that halves never enter the representation. The roots are

```
2I union (1 - phi) 2I,
```

where `2I` denotes the 120 unit icosians, the vertices of a 600-cell. The integral quadratic form is obtained from the quaternionic norm `N(q) = a + b phi` by `Q(q) = 2(a + b)`. Every root has `Q = 2`.

The two descriptions are connected by `e8BaseChange`: an exact integer 8×8 matrix maps doubled icosian coefficients to doubled standard E8 coordinates, and its inverse has common denominator two. `icosianToE8Integer()` and `e8IntegerToIcosian()` retain this correspondence without a Float64 conversion.

## Two real readings

There are two embeddings of Z[phi] into the reals:

```
parallel:      phi -> (1 + sqrt(5)) / 2
perpendicular: phi -> (1 - sqrt(5)) / 2
```

Applying an embedding coordinate-wise turns the same exact icosian into a point in R4. In parallel space the two root shells have radii `1` and `1/phi`; in perpendicular space they have radii `1` and `phi`. The small shell in one reading is the large shell in the other.

This is a view of an 8-dimensional root system through two complementary 4-dimensional representations. `createFoldedE8Roots()` therefore returns a renderable 4D view, not a replacement for the E8 lattice itself.

## Exact edge provenance

Two E8 roots form a minimal pair exactly when their integral bilinear product is `1`. This gives 6,720 edges, classified without floating tolerances:

- 720 pairs are metric shell edges in the parallel embedding;
- another 720 are metric shell edges in the perpendicular embedding;
- 2,400 remaining in-shell pairs are chords in both embeddings;
- 2,880 pairs join the two shells.

The asymmetry is important: Galois embedding preserves the algebraic representation, not Euclidean distance. In particular, the conjugate shell is a 600-cell as a vertex set, but its metric skeleton is not a subset of the E8 minimal-edge graph.

```ts
import { createFoldedE8Roots, icosianE8Data } from '@holotope/core/lattice';

const exact = icosianE8Data();
const physical = createFoldedE8Roots({
  embedding: 'parallel',
  edgeClasses: ['parallel-skeleton', 'strut']
});
const internal = createFoldedE8Roots({ embedding: 'perpendicular' });
```

`createFoldedE8Shells()` instead returns the 1,440 metric-nearest pairs of both 600-cell vertex sets. Of those, the conjugate shell's 720 edges are deliberately not presented as E8 minimal pairs.

The exact roots and shell labels remain available through `icosianE8Data()` so applications can carry provenance into projection, coloring, selection, or later cut-and-project windows.
