# Build a source-retained dimension bridge

<!-- doc-check: sequential -->

One authoritative R4 body, moved by a rigid model, observed three ways at once,
and picked back to its source. This is the complete typed pipeline the flagship
example runs, small enough to read in one sitting.

Every section below builds on the one before it, and all of them compile.

## 1. Declare the body and what observes it

An experiment document is inert data. It names a source, an optional model, and
the representations that observe them — nothing else, and no executable code.

```ts
import {
  type ExperimentDocumentV0
} from '@holotope/experiment';

const document = {
  schema: 'holotope.experiment/0',
  title: 'Dimension bridge',
  ambientDim: 4,
  sources: {
    body: {
      // One full edge length per ambient axis, centred on the origin.
      // Unequal lengths give the body non-isotropic inertia, so its motion is
      // a genuine R4 tumble rather than a rotation a cube could fake.
      kind: 'core.source.hyperrectangle',
      dim: 4,
      edgeLengths: [2.7, 1.84, 1.32, 0.86],
      // Exact sections cut tetrahedra, and R4 mass integration reads the same
      // simplex boundary.
      tetrahedralize: true
    }
  },
  models: {
    tumble: {
      kind: 'physics.model.rigid4',
      source: 'body',
      initialAngularMomentum: [0.42, 0.16, 0, 0.88, -0.31, 0],
      fixedStep: 1 / 120,
      substeps: 2
    }
  },
  representations: {
    // A shadow-like map: many-to-one, so a pick on it is never globally unique.
    shadow: {
      kind: 'core.representation.perspective',
      source: 'body',
      fromDim: 4,
      viewDistance: 5.4,
      transform: { fromModel: 'tumble' },
      product: 'both'
    },
    // An exact coordinate view: keep three axes, drop the fourth. Not a
    // camera — no foreshortening, and no hidden-axis divide to guard.
    axes: {
      kind: 'core.representation.coordinate',
      source: 'body',
      fromDim: 4,
      retainedAxes: [0, 1, 3],
      transform: { fromModel: 'tumble' },
      product: 'both'
    },
    // An exact cross-section in its own 3D chart.
    cut: {
      kind: 'core.representation.section4',
      source: 'body',
      normal: [0, 0, 0, 1],
      offset: 0.12,
      frame: 'canonical',
      transform: { fromModel: 'tumble' }
    }
  },
  parameters: [
    {
      id: 'sliceOffset',
      label: 'Slice offset',
      value: { type: 'number', default: 0.12, min: -2.5, max: 2.5, step: 0.005 },
      dimension: 'length',
      frame: { space: 'ambient', dim: 4 },
      unit: 'm',
      target: { kind: 'representation-field', ref: 'cut', field: 'offset' }
    }
  ]
} satisfies ExperimentDocumentV0;
```

Write `satisfies`, not a cast. `prepareExperimentDocumentV0` accepts `unknown`
by design, so `as never` would let a malformed document through the type system
and fail only at runtime.

## 2. Prepare and compile with explicit capabilities

Preparation validates, canonicalizes, hashes, copies, and freezes. Compilation
turns descriptors into live objects — and refuses any kind no supplied
capability serves, rather than loading something by name.

```ts
import {
  compileExperimentDocumentV0,
  coreExperimentCompilerV0,
  prepareExperimentDocumentV0
} from '@holotope/experiment';
import { physicsExperimentCompilerV0 } from '@holotope/experiment-physics';

const prepared = await prepareExperimentDocumentV0(document);
if (!prepared.ok) throw new Error(JSON.stringify(prepared.failures));

const compiled = compileExperimentDocumentV0(prepared.value, {
  compilers: [coreExperimentCompilerV0(), physicsExperimentCompilerV0()]
});
if (!compiled.ok) throw new Error(JSON.stringify(compiled.failures));

const compilation = compiled.value;

// Capture this now: reset later is a restore, not a list of fields to rewrite.
const initial = compilation.snapshot();
if (!initial.ok) throw new Error(JSON.stringify(initial.failures));
```

## 3. Retrieve the source, model, and maps

Registry entries are a discriminated union. Check the category rather than
asserting it, so a mis-typed id fails where it happens.

```ts
import {
  type ExperimentCompiledRepresentationV0,
  type ExperimentCompiledSourceV0
} from '@holotope/experiment';
import { type ExperimentRigidModel4RuntimeV0 } from '@holotope/experiment-physics';

function sourceById(id: string): ExperimentCompiledSourceV0 {
  const entry = compilation.get(id);
  if (!entry.ok || entry.value.category !== 'source') {
    throw new Error(`${id} is not a compiled source`);
  }
  return entry.value;
}

function representationById(id: string): ExperimentCompiledRepresentationV0 {
  const entry = compilation.get(id);
  if (!entry.ok || entry.value.category !== 'representation') {
    throw new Error(`${id} is not a compiled representation`);
  }
  return entry.value;
}

const modelEntry = compilation.get('tumble');
if (!modelEntry.ok || modelEntry.value.category !== 'model') {
  throw new Error('tumble is not a compiled model');
}
const model = modelEntry.value;
const runtime = model.runtime as ExperimentRigidModel4RuntimeV0;

const source = sourceById('body');
const shadowMap = representationById('shadow').map;
const axesMap = representationById('axes').map;
const cutMap = representationById('cut').map;
if (shadowMap.kind !== 'projection') throw new Error('shadow is not a projection');
if (axesMap.kind !== 'projection') throw new Error('axes is not a projection');
if (cutMap.kind !== 'slice4') throw new Error('cut is not a slice');

log(source.complex.vertexCount); // 16
```

## 4. Give the compiled objects to Three.js products

Use the map object the compilation built. Constructing an equivalent projection
from the same numbers would render something the document does not describe,
and a pick on it would carry provenance that only looks right.

```ts
import {
  ProjectedEdges3D,
  ProjectedSurface3D,
  SlicedComplex3D
} from '@holotope/three';

// Two products can share one map: a filled surface and its wireframe are two
// views of the same projection, not two projections.
const surface = new ProjectedSurface3D(source.complex, shadowMap.projection);
const axesSurface = new ProjectedSurface3D(source.complex, axesMap.projection);
const axesEdges = new ProjectedEdges3D(source.complex, axesMap.projection);
const section = new SlicedComplex3D(source.complex, cutMap.slice);

scene.add(surface.object, axesSurface.object, axesEdges.object, section.object);
```

All four read the same `source.complex`. Nothing here copies geometry — a
render product holds a reference and rebuilds only its own output buffers.

## 5. Advance, parameterize, and reset through the compilation

The document owns time and parameters. Stepping the physics world directly, or
writing `slice.offset`, changes what is drawn without the document knowing — so
its clock, revision, and trace stop describing what you see.

```ts
// One advance per frame. The pose it publishes is motion relative to where the
// source geometry was authored, not the body's principal-frame pose.
compilation.advance(2);
const pose = model.pose();
for (const product of [surface, axesSurface, axesEdges, section]) {
  product.update(pose);
}

// Parameters are validated against their declared domain before they apply.
const applied = compilation.setParameter('sliceOffset', 0.35);
log(applied.outcome); // 'applied'

// Reset is a restore.
compilation.restore(initial.value);
log(compilation.step); // 0
```

Beyond the body's extent a cut emits nothing. Here the `w` edge is `0.86`, so
an offset past `±0.43` leaves an empty section — honest, not an error.

## 6. Read a pick without inventing an inverse

Raycast the product with an ordinary Three `Raycaster` and hand the intersection
to the matching adapter. Then branch on the claim rather than combining
precision and uniqueness yourself.

```ts
import { PerspectiveCamera, Raycaster, Vector2 } from 'three';
import { describeRepresentationHitN } from '@holotope/core';
import { representationHitFromSlicedComplex } from '@holotope/three';

section.object.updateMatrixWorld(true);
const camera = new PerspectiveCamera(60, 1, 0.01, 1000);
camera.position.set(0, 0, 25);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);
const raycaster = new Raycaster();
raycaster.setFromCamera(new Vector2(0, 0), camera);

const [intersection] = raycaster.intersectObject(section.object, false);
if (intersection !== undefined) {
  const report = describeRepresentationHitN(
    representationHitFromSlicedComplex(section, intersection)
  );

  // Identity survives whatever the claim is.
  log(report.source.kind); // 'cell'

  if (report.ambient.claim === 'unique') {
    // An exact section is one-to-one, so this really is the source point.
    log(report.ambient.point.data);
  } else if (report.ambient.claim === 'on-selected-primitive') {
    // A projection is many-to-one. Present the point against the primitive the
    // ray selected, or not at all.
    log(report.ambient.point.data, report.ambient.ambiguity);
  }
}
```

A pick on the perspective product goes through
`representationHitFromProjectedSurface` and answers
`on-selected-primitive` with `projection-overlap` — that is the map being
honest, not a failure. See [what a pick may claim](/learn/representation-claims).

## 7. Dispose every owner

```ts
for (const product of [surface, axesSurface, axesEdges, section]) {
  product.dispose();
}
// Releases the source, body, world, and maps the registry holds.
compilation.dispose();
```

## What this bought

The body is an exact source, not a cube with an undisclosed deformation. One
`CellComplex` is authoritative, and all three views observe it rather than
holding copies. Time, parameters, and reset run through one clock. A pick
returns source identity plus an honest statement of what may be claimed about
the point.

The [dimension bridge example](https://nikilp.github.io/holotope.js/dimension-bridge.html)
is this pipeline with materials, controls, and cross-view markers added.
