# @holotope/core

Zero-dependency N-dimensional geometry kernel: vectors and matrices of any
dimension, plane rotations and the so(n) exponential map, a paired-quaternion
`Rotor4` fast path with slerp, N-D rigid transforms and cameras, cell
complexes, polytope builders (n-cube, simplex, orthoplex, all six regular
polychora, duoprisms), perspective/orthographic N→3 projection, and exact
hyperplane slicing via marching tetrahedra.

All math runs in Float64 on the CPU and is renderer-agnostic; pair it with
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
