# Playground

Runnable code beside its result. Edit and re-run in place — nothing is
installed, and nothing leaves the page.

<iframe
  src="https://nikilp.github.io/holotope.js/playground.html#ProjectedEdges3D"
  title="Holotope playground"
  loading="lazy"
  style="width:100%;aspect-ratio:16/9;min-height:420px;border:1px solid var(--vp-c-divider);border-radius:8px;margin:1.25rem 0;"
></iframe>

## What is already in scope

Everything the library exports, by name — there are no imports to write.
Alongside them:

| name | what it is |
| --- | --- |
| `scene` | a three.js `Scene`, already lit and rendered |
| `camera` | the `PerspectiveCamera` looking at it, under orbit control |
| `renderer` | the `WebGLRenderer` driving the frame |
| `onFrame(fn)` | runs `fn(t)` every frame, `t` in seconds since the run |
| `log(…)` | prints below the editor |

Add an object to `scene` to see it. Return a value — or end on an expression —
and the panel reports it, which is how an example that computes rather than
draws still shows its result.

```js
const product = new ProjectedEdges3D(
  createHypercube({ dim: 4 }),
  new PerspectiveProjection({ fromDim: 4, viewDistance: 4 })
);
scene.add(product.object);

onFrame((t) =>
  product.update(new TransformN(4, rotationFromPlanes(4, [{ i: 0, j: 3, angle: t }])))
);
```

That last part is the whole idea in miniature: the rotation happens in R⁴ and
the projection is recomputed from it. Rotating `product.object` instead would
spin a shadow.

::: tip It runs JavaScript
The library is written in TypeScript and the reference shows TypeScript, but a
browser runs JavaScript. Snippets here are the same code with the annotations
removed — which for these examples means no change at all, since they call
functions rather than annotate types. Paste an annotation and the panel will
say so.
:::

## Runnable examples

Every symbol whose documentation carries an example can be opened directly.
These are the same snippets the reference pages show, so anything improved
there is improved here.

<!-- runnable-examples -->

| symbol | |
| --- | --- |
| [`CameraN`](/api/core/projection/classes/CameraN) | [open](https://nikilp.github.io/holotope.js/playground.html#CameraN) |
| [`CellComplex`](/api/core/geometry/classes/CellComplex) | [open](https://nikilp.github.io/holotope.js/playground.html#CellComplex) |
| [`HyperplaneSliceN`](/api/core/projection/classes/HyperplaneSliceN) | [open](https://nikilp.github.io/holotope.js/playground.html#HyperplaneSliceN) |
| [`ModelSetWindowPrunedSampleOptions`](/api/core/lattice/interfaces/ModelSetWindowPrunedSampleOptions) | [open](https://nikilp.github.io/holotope.js/playground.html#ModelSetWindowPrunedSampleOptions) |
| [`PlaneEmbedding3D`](/api/core/projection/classes/PlaneEmbedding3D) | [open](https://nikilp.github.io/holotope.js/playground.html#PlaneEmbedding3D) |
| [`ProjectedEdges3D`](/api/three/index/classes/ProjectedEdges3D) | [open](https://nikilp.github.io/holotope.js/playground.html#ProjectedEdges3D) |
| [`ProjectedSurface3D`](/api/three/index/classes/ProjectedSurface3D) | [open](https://nikilp.github.io/holotope.js/playground.html#ProjectedSurface3D) |
| [`Rotor4Track`](/api/core/animation/classes/Rotor4Track) | [open](https://nikilp.github.io/holotope.js/playground.html#Rotor4Track) |
| [`SectionChart3D`](/api/three/index/classes/SectionChart3D) | [open](https://nikilp.github.io/holotope.js/playground.html#SectionChart3D) |
| [`SlicedComplex3D`](/api/three/index/classes/SlicedComplex3D) | [open](https://nikilp.github.io/holotope.js/playground.html#SlicedComplex3D) |
| [`TransformN`](/api/core/math/classes/TransformN) | [open](https://nikilp.github.io/holotope.js/playground.html#TransformN) |
| [`XpbdParticleHyperplaneBarrierFamilyN`](/api/physics/classes/XpbdParticleHyperplaneBarrierFamilyN) | [open](https://nikilp.github.io/holotope.js/playground.html#XpbdParticleHyperplaneBarrierFamilyN) |
| [`XpbdParticleHyperplaneBarrierStepFilterN`](/api/physics/classes/XpbdParticleHyperplaneBarrierStepFilterN) | [open](https://nikilp.github.io/holotope.js/playground.html#XpbdParticleHyperplaneBarrierStepFilterN) |
| [`compileXpbdIncrementalPotentialAnalyticHessianOperatorN`](/api/physics/functions/compileXpbdIncrementalPotentialAnalyticHessianOperatorN) | [open](https://nikilp.github.io/holotope.js/playground.html#compileXpbdIncrementalPotentialAnalyticHessianOperatorN) |
| [`compileXpbdParticleSourceConvexHullBarrierFamilyN`](/api/physics/functions/compileXpbdParticleSourceConvexHullBarrierFamilyN) | [open](https://nikilp.github.io/holotope.js/playground.html#compileXpbdParticleSourceConvexHullBarrierFamilyN) |
| [`compileXpbdSourceSimplexAabbHierarchyN`](/api/physics/functions/compileXpbdSourceSimplexAabbHierarchyN) | [open](https://nikilp.github.io/holotope.js/playground.html#compileXpbdSourceSimplexAabbHierarchyN) |
| [`compileXpbdSourceSimplexCosineBendingFamilyN`](/api/physics/functions/compileXpbdSourceSimplexCosineBendingFamilyN) | [open](https://nikilp.github.io/holotope.js/playground.html#compileXpbdSourceSimplexCosineBendingFamilyN) |
| [`create24Cell`](/api/core/polytope/functions/create24Cell) | [open](https://nikilp.github.io/holotope.js/playground.html#create24Cell) |
| [`create600Cell`](/api/core/polytope/functions/create600Cell) | [open](https://nikilp.github.io/holotope.js/playground.html#create600Cell) |
| [`createCrossPolytope`](/api/core/polytope/functions/createCrossPolytope) | [open](https://nikilp.github.io/holotope.js/playground.html#createCrossPolytope) |
| [`createDuoprism`](/api/core/polytope/functions/createDuoprism) | [open](https://nikilp.github.io/holotope.js/playground.html#createDuoprism) |
| [`createHypercube`](/api/core/polytope/functions/createHypercube) | [open](https://nikilp.github.io/holotope.js/playground.html#createHypercube) |
| [`createHyperrectangle`](/api/core/polytope/functions/createHyperrectangle) | [open](https://nikilp.github.io/holotope.js/playground.html#createHyperrectangle) |
| [`createSimplex`](/api/core/polytope/functions/createSimplex) | [open](https://nikilp.github.io/holotope.js/playground.html#createSimplex) |
| [`createSourceCellLookupN`](/api/core/representation/functions/createSourceCellLookupN) | [open](https://nikilp.github.io/holotope.js/playground.html#createSourceCellLookupN) |
| [`cuboidCellFacetN`](/api/core/geometry/functions/cuboidCellFacetN) | [open](https://nikilp.github.io/holotope.js/playground.html#cuboidCellFacetN) |
| [`describeRepresentationHitN`](/api/core/representation/functions/describeRepresentationHitN) | [open](https://nikilp.github.io/holotope.js/playground.html#describeRepresentationHitN) |
| [`estimateXpbdIncrementalPotentialHessianVectorN`](/api/physics/functions/estimateXpbdIncrementalPotentialHessianVectorN) | [open](https://nikilp.github.io/holotope.js/playground.html#estimateXpbdIncrementalPotentialHessianVectorN) |
| [`evaluateClampedLogBarrier`](/api/physics/functions/evaluateClampedLogBarrier) | [open](https://nikilp.github.io/holotope.js/playground.html#evaluateClampedLogBarrier) |
| [`evaluateSimplexHingeCosineN`](/api/physics/functions/evaluateSimplexHingeCosineN) | [open](https://nikilp.github.io/holotope.js/playground.html#evaluateSimplexHingeCosineN) |
| [`evaluateSimplexMeasureBarrierHessianVectorN`](/api/physics/functions/evaluateSimplexMeasureBarrierHessianVectorN) | [open](https://nikilp.github.io/holotope.js/playground.html#evaluateSimplexMeasureBarrierHessianVectorN) |
| [`evaluateSimplexStVenantKirchhoffHessianVectorN`](/api/physics/functions/evaluateSimplexStVenantKirchhoffHessianVectorN) | [open](https://nikilp.github.io/holotope.js/playground.html#evaluateSimplexStVenantKirchhoffHessianVectorN) |
| [`evaluateXpbdIncrementalPotentialAnalyticHessianVectorN`](/api/physics/functions/evaluateXpbdIncrementalPotentialAnalyticHessianVectorN) | [open](https://nikilp.github.io/holotope.js/playground.html#evaluateXpbdIncrementalPotentialAnalyticHessianVectorN) |
| [`fibonacciPatch`](/api/core/lattice/functions/fibonacciPatch) | [open](https://nikilp.github.io/holotope.js/playground.html#fibonacciPatch) |
| [`findIncidentCellsN`](/api/core/geometry/functions/findIncidentCellsN) | [open](https://nikilp.github.io/holotope.js/playground.html#findIncidentCellsN) |
| [`gjkDistance`](/api/physics/functions/gjkDistance) | [open](https://nikilp.github.io/holotope.js/playground.html#gjkDistance) |
| [`massPropertiesFromCellComplex4`](/api/physics/functions/massPropertiesFromCellComplex4) | [open](https://nikilp.github.io/holotope.js/playground.html#massPropertiesFromCellComplex4) |
| [`sectionSimplexGroupN`](/api/core/projection/functions/sectionSimplexGroupN) | [open](https://nikilp.github.io/holotope.js/playground.html#sectionSimplexGroupN) |
| [`solveXpbdIncrementalPotentialNewtonDirectionN`](/api/physics/functions/solveXpbdIncrementalPotentialNewtonDirectionN) | [open](https://nikilp.github.io/holotope.js/playground.html#solveXpbdIncrementalPotentialNewtonDirectionN) |
| [`stepXpbdIncrementalPotentialWorldN`](/api/physics/functions/stepXpbdIncrementalPotentialWorldN) | [open](https://nikilp.github.io/holotope.js/playground.html#stepXpbdIncrementalPotentialWorldN) |
| [`tetrahedralizeCuboidCells`](/api/core/geometry/functions/tetrahedralizeCuboidCells) | [open](https://nikilp.github.io/holotope.js/playground.html#tetrahedralizeCuboidCells) |
| [`xpbdMassPreconditionedDirectionN`](/api/physics/variables/xpbdMassPreconditionedDirectionN) | [open](https://nikilp.github.io/holotope.js/playground.html#xpbdMassPreconditionedDirectionN) |
| [`xpbdNewtonDirectionPolicyN`](/api/physics/functions/xpbdNewtonDirectionPolicyN) | [open](https://nikilp.github.io/holotope.js/playground.html#xpbdNewtonDirectionPolicyN) |

## Why these are trustworthy

The examples are compiled. Each one is extracted from its doc comment and
typechecked against the real signatures as part of the build, so a method that
does not exist or a call with the wrong number of arguments fails the build
rather than the reader.

That check exists because the first version of these examples contained four
errors that read perfectly well: a method named `evaluate` where the accessor
is `sample`, a two-argument call to a one-argument function, references to
variables nothing defined, and a `VecN` built with both a dimension and values
— which silently produced a zero vector and demonstrated nothing while
appearing to work.
