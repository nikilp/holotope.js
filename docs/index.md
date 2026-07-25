---
layout: home

hero:
  name: Holotope.js
  text: N-dimensional geometry for TypeScript
  tagline: Keep the state N-dimensional. Make every lower-dimensional view an explicit, traceable observation of it.
  actions:
    - theme: brand
      text: The mental model
      link: /learn/mental-model
    - theme: alt
      text: Cookbook
      link: /learn/cookbook
    - theme: alt
      text: Playground
      link: /learn/playground
    - theme: alt
      text: API reference
      link: /api/core/
    - theme: alt
      text: Live showcase
      link: https://nikilp.github.io/holotope.js/

features:
  - title: The source is never the picture
    details: A projected mesh is an observation, not the object. Simulation, picking, and editing act on the authoritative N-dimensional state — and a pick carries its source identity back, rather than guessing it from 3D coordinates.
    link: /learn/representation-provenance
    linkText: Representation provenance

  - title: Render products are explicit
    details: "\"Show me a 4D object\" has several honest answers that solve different problems. Wireframe projection, exact cross-section, projected surface, and raymarched field are each a named class with its own correct picking, sorting, and transparency."
    link: /learn/architecture
    linkText: Architecture

  - title: Exact where it matters
    details: Coxeter groups, E8 and the icosians, and cut-and-project model sets are computed over exact rings as bigint pairs. Float64 conversion happens once, at the end, when a renderer finally needs it.
    link: /learn/theory/model-sets
    linkText: Exact constructions

  - title: Mechanics on the source, not the slice
    details: A headless R4 simulation package with exact inertia, momentum-primary integration, GJK/EPA/SAT collision, and a dimension-generic XPBD kernel. It never renders and never treats a visible slice as a simulation boundary.
    link: /learn/physics/
    linkText: Mechanics
---

## Install

```sh
pnpm add @holotope/core @holotope/three three
```

`@holotope/core` is zero-dependency. `@holotope/three` takes `three` as a peer
dependency — it is never forked and never subclassed. `@holotope/physics` is
headless and depends on neither.

## The one rule

Higher-dimensional state stays higher-dimensional until the last responsible
moment. Everything else in this documentation follows from that.

```ts
import { PerspectiveProjection, TransformN, createHypercube } from '@holotope/core';
import { ProjectedEdges3D } from '@holotope/three';

const tesseract = createHypercube(4);              // source lives in R^4
const product = new ProjectedEdges3D(tesseract, new PerspectiveProjection(4, 3));

scene.add(product.object);                         // an ordinary three.js object
product.update(TransformN.fromRotation(4, 0, 3, t)); // rotate the SOURCE, not the mesh
```

That last line is the whole idea: the rotation happens in R⁴ and the projection
is recomputed. Rotating `product.object` instead would spin a shadow.

::: tip Pre-1.0
The API is expected to move. The reference on this site is generated from source
at build time, so it always matches the commit it was built from.
:::
