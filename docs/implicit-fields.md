# Implicit fields in R4

`ImplicitField4` is the backend-neutral contract for scalar fields over four-dimensional space. A field evaluation returns more than a scalar: it retains the escape decision, iteration count, potential, distance estimate, orbit-trap value, and final point. Renderers can therefore color or inspect a section without rerunning the orbit.

The core package currently provides two quadratic families:

- `QuaternionJuliaField` evaluates `q -> q^2 + c`. Parameters are restricted to the `(real,i)` plane, which makes the declared circle symmetry in the `(j,k)` plane valid. Restricting the field to `(real,i)` reproduces the ordinary complex quadratic iteration.
- `BicomplexJuliaField` changes exactly to idempotent coordinates and evaluates two independent complex quadratic orbits. Its evaluation record retains both factor records.

Coordinates are explicit throughout: quaternion values use `[i,j,k,real]`; bicomplex values use `[i1,i2,i1*i2,real]`; complex factors use `[imaginary,real]`.

## Headless evaluation

The browser is not required to evaluate or inspect a field. `sampleFieldPoints4` probes packed R4 points, while `sampleFieldSlice3` evaluates a regular grid in any affine `HyperplaneSlice4`.

```ts
import {
  HyperplaneSlice4,
  QuaternionJuliaField,
  extractSampledIsosurface3,
  sampleFieldPoints4,
  sampleFieldSlice3
} from '@holotope/core';

const field = new QuaternionJuliaField({
  parameter: [0.156, 0, 0, -0.8],
  maxIterations: 32,
  escapeRadius: 4
});

const probes = sampleFieldPoints4(field, [
  0, 0, 0, 0,
  0.5, 0, 0, 0
]);

const slice = HyperplaneSlice4.axisAligned(2);
const samples = sampleFieldSlice3(field, slice, {
  resolution: 38,
  extent: 1.65
});
const surface = extractSampledIsosurface3(samples);

console.log(probes.records, samples.valueRange, surface.triangleCount);
```

The sampler uses Float64 and deterministic traversal order, making it suitable as a golden path for tests, parameter searches, and future CPU/GPU differential checks. Full family-specific records remain available in `records`, alongside packed numeric channels for efficient downstream processing. The extracted marching-tetrahedra surface is intentionally marked `approximate`; the sample arrays and source grid-cell index for every triangle remain available.

## Sampled Three.js product

`SampledSlicedField3D` wraps the same headless pipeline in an ordinary Three.js `Mesh`:

```ts
import { SampledSlicedField3D } from '@holotope/three';

const product = new SampledSlicedField3D(field, slice, {
  resolution: 38,
  extent: 1.65,
  colorForIteration: (iteration) => iteration > 20 ? 0xff66cc : 0x6699ff
});

scene.add(product.object);
console.log(product.sample.escapedCount, product.triangleCount);
```

Changing a slice and calling `update()` resamples it. The rendering adapter does not hide the numerical product: `sample`, `surface`, `triangleCount`, and `sourceCellOfFace()` remain inspectable.

## GPU evaluation and ray marching

`QuaternionJuliaGPU` evaluates packed points in a WebGPU compute shader and reads the resulting Float32 records back for differential comparison with the Float64 field. It is a verification and pipeline primitive, not a second mathematical definition:

```ts
import {
  QuaternionJuliaGPU,
  compareQuaternionJuliaGPU
} from '@holotope/three/webgpu';

const points = new Float32Array([
  0, 0, 0, 0,
  0.5, 0.25, 0, -0.75
]);
const evaluator = new QuaternionJuliaGPU(field, points);
const gpuRecords = await evaluator.evaluate(renderer);
const differential = compareQuaternionJuliaGPU(field, points, gpuRecords);

console.log(differential.escapeMismatches, differential.maxDistanceError);
```

`BicomplexJuliaGPU` follows the same contract, but preserves the records of both
complex factors as well as the combined bicomplex record:

```ts
import {
  BicomplexJuliaGPU,
  compareBicomplexJuliaGPU
} from '@holotope/three/webgpu';

const productRecords = await new BicomplexJuliaGPU(bicomplexField, points).evaluate(renderer);
const productDifferential = compareBicomplexJuliaGPU(
  bicomplexField,
  points,
  productRecords
);

console.log(
  productDifferential.factorEscapeMismatches,
  productDifferential.maxFactorDistanceError
);
```

The compute graph performs the exact idempotent basis change, runs the two
quadratic factors independently, then combines their distance estimates in the
orthogonal product metric. The combined state remains derivable from the two
retained factor records rather than becoming an independent source of truth.

`RaymarchedQuaternionJulia3D` uses the same field parameter and affine slice but evaluates them adaptively for each fragment. No regular voxel grid or extracted triangle surface is involved:

```ts
import { RaymarchedQuaternionJulia3D } from '@holotope/three/webgpu';

const raymarched = new RaymarchedQuaternionJulia3D(field, slice, {
  extent: 1.65,
  maxSteps: 112,
  surfaceEpsilon: 0.0015
});
scene.add(raymarched.object);

slice.offset = 0.2;
raymarched.update();
```

`RaymarchedBicomplexJulia3D` applies the same rendering contract to the exact
two-factor product:

```ts
import { RaymarchedBicomplexJulia3D } from '@holotope/three/webgpu';

const product = new RaymarchedBicomplexJulia3D(bicomplexField, slice, {
  maxSteps: 176,
  surfaceEpsilon: 0.0015
});
scene.add(product.object);
```

The fragment graph changes each R4 point to idempotent coordinates, evaluates both complex factors, and sphere-traces their distances combined in the orthogonal product metric. Its color may expose which factor controls the local outside distance; this is record-driven shading, not a change to the field.

Both ray products reconstruct the R4 point from the full `HyperplaneSlice4` frame and compute normals from field gradients. The containing box is only a ray proxy: its exit faces are rendered so rays remain available after the camera enters the box. High-frequency quaternion orbit bands are attenuated from their screen-space derivatives when they become smaller than a pixel. The products are transparent with depth writes disabled; compositing actual hit depth, picking a ray hit, and exporting a surface remain separate future contracts. Use the sampled product when per-sample records or mesh provenance are required.

## Exact structure and approximate pictures

Escape-time images are numerical approximations, but several identities are structural contracts:

- quaternion iteration on the complex plane follows the complex reference implementation;
- rotations of the quaternion `(j,k)` plane preserve the declared field;
- bicomplex iteration is exactly the product of its two complex factor records after the idempotent basis change.

These contracts are tested independently of visualization. Both Julia showcases can switch between ray-marched presentation and sampled diagnostic products, and both expose continuous parameter controls, with presets serving only as useful landmarks. On WebGPU each page reports a live packed-point differential. The browser presents and validates the rendering realization; it is not the source of truth for the field calculations.

## Tricomplex Mandelbrot parameter slices

The Airbrot, Firebrot, and Earthbrot are not additional Julia fields in R4. They are
three-dimensional parameter-space slices of the tricomplex Mandelbrot set. In their
declared bases, the parameter separates into four real quadratic orbits (three plus
an unused zero factor for the Earthbrot). Because the real Mandelbrot locus is the
exact interval `[-2, 1/4]`, the corresponding linear interval constraints produce a
regular octahedron, regular tetrahedron, and cube.

```ts
import {
  evaluateTricomplexMandelbrotSlice3,
  tricomplexPlatonicSlice3,
  tricomplexPlatonicValue3
} from '@holotope/core';

const firebrot = tricomplexPlatonicSlice3('firebrot');
const boundaryValue = tricomplexPlatonicValue3('firebrot', [0.25, 0.25, 0.25]);
const finiteOrbit = evaluateTricomplexMandelbrotSlice3(
  'firebrot',
  [0.25, 0.25, 0.25],
  { maxIterations: 128 }
);

console.log(firebrot.vertices, boundaryValue, finiteOrbit.escaped);
```

The theorem data and finite escape-time realization remain separate. `vertices`,
`faces`, and `edgeLength` describe the exact Platonic set; the finite record reports
what a bounded-iteration algorithm observed at a parameter. This prevents a
Mandelbrot parameter slice from being mislabeled as a bicomplex Julia section.
