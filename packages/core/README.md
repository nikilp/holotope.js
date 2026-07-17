# @holotope/core

Zero-dependency N-dimensional geometry kernel: vectors, matrices, and exterior
products in any dimension, plane rotations and the so(n) exponential map, a paired-quaternion
`Rotor4` fast path with slerp, N-D rigid transforms and cameras, cell
complexes, polytope builders (n-cube, simplex, orthoplex, all six regular
polychora, duoprisms), perspective/orthographic N→3 projection, and exact
hyperplane slicing via marching tetrahedra. Its structured-space layer also
includes the exact 240-root E8 orbit and the icosian folding into conjugate
4-spaces, plus exact cut-and-project lattices, flats, convex windows, and
finite model-set patches, including complete-shell Elser–Sloane sections.
The implicit-field layer adds inspectable quaternion and bicomplex Julia
families, deterministic packed-point and affine-slice sampling, and an
approximate isosurface extractor whose full evaluation records remain available.
Exact Airbrot, Firebrot, and Earthbrot specifications independently cover the
Platonic parameter slices of the tricomplex Mandelbrot set. The coupling layer
adds provenance-driven parameter decorations, including the canonical
Elser–Sloane internal-coordinate map and an exact finite-orbit equivariance
checker for its H4 action. `SkewProductFlow` adds state-dependent SO(4) fiber
dynamics with periodic-orbit closure and holonomy reports.
The spectral layer provides a deterministic symmetric eigensolver plus sparse
unweighted graph Laplacians, connected components, complete modal bases, and
basis-independent repeated-mode projectors for any `CellComplex` 1-skeleton.

Renderable coordinates run in Float64 on the CPU, while supported lattice,
window, and group decisions stay in exact quadratic rings. The kernel is renderer-agnostic; pair it with
[`@holotope/three`](https://www.npmjs.com/package/@holotope/three) to render
with three.js.

**[Live showcase](https://nikilp.github.io/holotope.js/)** ·
**[Repository & docs](https://github.com/nikilp/holotope.js)**

```ts
import { HyperplaneSlice4, create600Cell, sliceTetrahedra } from '@holotope/core';

const cell600 = create600Cell({ radius: 1.5 });
const slice = HyperplaneSlice4.axisAligned(3, 0); // the w = 0 hyperplane
// ...march its tetrahedra into an exact 3D cross-section
```

MIT © Nikolay Petrov
