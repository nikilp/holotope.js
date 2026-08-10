/**
 * Tested Three.js compatibility guard.
 *
 *   node scripts/check-three-compatibility.mjs [--keep]
 *
 * `@holotope/three` declares a peer range, and a range is a claim. This drives
 * that claim from **freshly packed artifacts** at both ends of it:
 *
 *   - the declared minimum supported revision, and
 *   - the exact reproducibility reference the repository develops against.
 *
 * Both are installed into consumers created outside every workspace, and each
 * must clear TWO independent columns:
 *
 *   - **runtime**: import both entry points, exercise the four CPU adapters
 *     through a real lifecycle, resolve a real `Raycaster` pick, and prove that
 *     exactly one Three copy backs the adapters and the application; and
 *   - **strict TypeScript**: compile a composition of both entry points against
 *     that revision's own published declarations under `strict`,
 *     `skipLibCheck: false`, `exactOptionalPropertyTypes` and
 *     `noUncheckedIndexedAccess`.
 *
 * The second column is the one the whole r183 exclusion turns on, so it is
 * driven at the declared **minimum**, not only at the pinned reference. An
 * install that merely succeeds proves nothing and is never accepted as
 * evidence, and neither does a row that skipped a column: each row must report
 * both `runtimeDriven` and `typechecked`, and the guard fails if either is
 * missing — a revision whose declarations are unavailable is a failure, not a
 * skip.
 *
 * The revisions driven here are the *tested* interval. They are not a promise
 * about revisions that do not exist yet: a wider peer range may only follow a
 * wider measured matrix (P57 Track V drove r183.0-r185.1 to set this one).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packPublicPackages } from './pack-public-packages.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const KEEP = process.argv.includes('--keep');

/** Read from the manifests so the guard cannot drift from the claim. */
const peerRange = JSON.parse(
  fs.readFileSync(path.join(REPO, 'packages/three/package.json'), 'utf8')
).peerDependencies.three;
const minimum = />=\s*([\d.]+)/.exec(peerRange)?.[1];
const reference = JSON.parse(
  fs.readFileSync(path.join(REPO, 'examples/showcase/package.json'), 'utf8')
).dependencies.three;

if (minimum === undefined) {
  console.error(`check-three-compatibility: cannot read a minimum from "${peerRange}"`);
  process.exit(2);
}

const REVISIONS = [...new Set([minimum, reference])];
console.log(
  `check-three-compatibility: peer range "${peerRange}", reference ${reference}; ` +
  `driving ${REVISIONS.join(', ')}`
);

const TYPED_DRIVE = `import * as THREE from 'three';
import { Matrix4, Raycaster, Vector3, Vector4, MeshStandardMaterial } from 'three';
import {
  CellComplex,
  HyperplaneSlice4,
  HyperplaneSliceN,
  PerspectiveProjection,
  PlaneEmbedding3D,
  TransformN,
  VecN,
  type CellGroup,
  type DisplayMap3D
} from '@holotope/core';
import {
  ProjectedEdges3D,
  ProjectedSurface3D,
  SectionChart3D,
  SlicedComplex3D,
  representationHitFromProjectedEdge,
  representationHitFromProjectedSurface,
  representationHitFromSectionChart,
  type RepresentationIntersection3D,
  type SectionChart3DOptions
} from '@holotope/three';

/**
 * Strict-TypeScript composition of BOTH published entry points.
 *
 * This file exists to be compiled, not run: the runtime drive lives beside it.
 * It is compiled under \`strict\`, \`skipLibCheck: false\`,
 * \`exactOptionalPropertyTypes\` and \`noUncheckedIndexedAccess\`, so it fails if
 * the installed \`three\` declarations disagree with what \`@holotope/three\`
 * publishes — which is exactly the column the peer range's minimum claims.
 *
 * Every indexed read is guarded, because \`noUncheckedIndexedAccess\` is one of
 * the flags under test and silently non-null-asserting it away would hide the
 * very disagreement this is here to catch.
 */

function requireGroup(complex: CellComplex, at: number): CellGroup {
  const group = complex.groups[at];
  if (group === undefined) throw new Error(\`typed-drive: no group \${at}\`);
  return group;
}

function hypercube(): CellComplex {
  const positions: number[] = [];
  for (let corner = 0; corner < 16; corner++) {
    for (let axis = 0; axis < 4; axis++) {
      positions.push((corner >> axis) & 1 ? 1 : -1);
    }
  }
  const edges: number[] = [];
  const triangles: number[] = [];
  for (let corner = 0; corner < 16; corner++) {
    for (let axis = 0; axis < 4; axis++) {
      const other = corner ^ (1 << axis);
      if (other > corner) edges.push(corner, other);
      for (let second = axis + 1; second < 4; second++) {
        const b = corner ^ (1 << axis);
        const c = corner ^ (1 << second);
        if (b > corner && c > corner) triangles.push(corner, b, c);
      }
    }
  }
  return new CellComplex(4, Float64Array.from(positions), [
    { dim: 1, verticesPerCell: 2, kind: 'simplex', indices: Uint32Array.from(edges) },
    { dim: 2, verticesPerCell: 3, kind: 'simplex', indices: Uint32Array.from(triangles) }
  ]);
}

/** Typed composition of the ordinary entry point. */
export function composeMainEntryPoint(): number {
  const complex = hypercube();
  const projection = new PerspectiveProjection({ fromDim: 4, viewDistance: 4 });

  const material = new THREE.LineBasicMaterial({ color: 0xffffff });
  const edges = new ProjectedEdges3D(complex, projection, { material });
  edges.update(new TransformN(4, undefined, new VecN([0.25, 0, 0, 0])));
  const edgeAttribute = edges.geometry.getAttribute('position');
  const edgeCount = edgeAttribute.count;

  const surface = new ProjectedSurface3D(complex, projection);
  surface.object.updateMatrixWorld(true);
  const surfaceHits = new Raycaster(
    new Vector3(0, 0, 12), new Vector3(0, 0, -1), 0.01, 200
  ).intersectObject(surface.object, true);
  const firstSurfaceHit = surfaceHits[0];
  let surfaceAmbientDim = 0;
  if (firstSurfaceHit !== undefined) {
    const intersection: RepresentationIntersection3D = firstSurfaceHit;
    surfaceAmbientDim = representationHitFromProjectedSurface(surface, intersection).ambientDim;
  }

  // The R2 display map: a DisplayMap3D that is not a Projection.
  const square = new CellComplex(2, Float64Array.from([0, 0, 2, 0, 2, 2, 0, 2]), [
    { dim: 1, verticesPerCell: 2, kind: 'simplex', indices: Uint32Array.from([0, 1, 1, 2, 2, 3, 3, 0]) }
  ]);
  const embedding: DisplayMap3D = new PlaneEmbedding3D();
  const embedded = new ProjectedEdges3D(square, embedding);
  embedded.object.updateMatrixWorld(true);
  const embeddedHits = new Raycaster(
    new Vector3(1, 0, 5), new Vector3(0, 0, -1), 0.01, 100
  ).intersectObject(embedded.object, true);
  const firstEmbeddedHit = embeddedHits[0];
  let embeddedStatus = 'none';
  if (firstEmbeddedHit !== undefined) {
    embeddedStatus = representationHitFromProjectedEdge(embedded, firstEmbeddedHit)
      .ambientPointStatus;
  }

  const solid = new CellComplex(4, Float64Array.from([
    0, 0, 0, -2, 6, 0, 0, 2, 0, 6, 0, 2, 0, 0, 6, 2, 3, 3, 3, 2
  ]), [{
    dim: 3, verticesPerCell: 4, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 2, 3, 0, 1, 2, 4, 0, 1, 3, 4, 0, 2, 3, 4])
  }]);
  const slice4 = HyperplaneSlice4.axisAligned(3, 0);
  const sliced = new SlicedComplex3D(solid, slice4);
  slice4.offset = 40;
  sliced.update();
  const emptied = sliced.geometry.drawRange.count;

  const tetra = new CellComplex(4, Float64Array.from([
    0, 0, 0, -1, 2, 0, 0, 1, 0, 2, 0, 1, 0, 0, 2, 1
  ]), [{ dim: 3, verticesPerCell: 4, kind: 'simplex', indices: Uint32Array.from([0, 1, 2, 3]) }]);
  const chartOptions: SectionChart3DOptions = { material: new MeshStandardMaterial() };
  const chart = new SectionChart3D(
    tetra, requireGroup(tetra, 0), HyperplaneSliceN.axisAligned(4, 3, 0), chartOptions
  );
  chart.object.updateMatrixWorld(true);
  const chartHits = new Raycaster(
    new Vector3(0.4, 0.4, 10), new Vector3(0, 0, -1), 0.01, 100
  ).intersectObject(chart.object, true);
  const firstChartHit = chartHits[0];
  let chartAmbiguity = 'none';
  if (firstChartHit !== undefined) {
    chartAmbiguity = representationHitFromSectionChart(chart, {
      point: firstChartHit.point,
      faceIndex: firstChartHit.faceIndex ?? 0
    }).ambiguity;
  }
  const box = chart.geometry.boundingBox;
  const boxIsEmpty = box === null ? true : box.isEmpty();

  edges.dispose();
  surface.dispose();
  embedded.dispose();
  sliced.dispose();
  chart.dispose();
  material.dispose();

  return edgeCount + surfaceAmbientDim + emptied + (boxIsEmpty ? 0 : 1) +
    embeddedStatus.length + chartAmbiguity.length;
}

/** Typed composition of the WebGPU/TSL entry point. */
export async function composeWebgpuEntryPoint(): Promise<number> {
  const gpu = await import('@holotope/three/webgpu');
  const frame = new Matrix4();
  gpu.sliceToGpuUniforms(HyperplaneSlice4.axisAligned(3, 0.25), frame);
  const rotation = new Matrix4();
  const translation = new Vector4();
  gpu.transformToGpuUniforms(new TransformN(4), rotation, translation);

  const complex = hypercube();
  const edgesGpu = new gpu.ProjectedEdgesGPU(complex, { viewDistance: 4 });
  const object = edgesGpu.object;
  edgesGpu.dispose();

  const firstElement = frame.elements[0] ?? 0;
  const firstRotation = rotation.elements[0] ?? 0;
  return firstElement + firstRotation + translation.length() + (object === undefined ? 0 : 1);
}

export const composedRevision: string = THREE.REVISION;
`;

const DRIVE = `
import * as THREE from 'three';
import { Raycaster, Vector3 } from 'three';
import { CellComplex, HyperplaneSlice4, HyperplaneSliceN, PerspectiveProjection } from '@holotope/core';
import {
  ProjectedEdges3D, ProjectedSurface3D, SectionChart3D, SlicedComplex3D,
  representationHitFromProjectedSurface, representationHitFromSectionChart
} from '@holotope/three';

const fail = (message) => { throw new Error('three-compat: ' + message); };

const positions = [];
for (let corner = 0; corner < 16; corner++) {
  for (let axis = 0; axis < 4; axis++) positions.push((corner >> axis) & 1 ? 1 : -1);
}
const edges = [];
const triangles = [];
for (let corner = 0; corner < 16; corner++) {
  for (let axis = 0; axis < 4; axis++) {
    const other = corner ^ (1 << axis);
    if (other > corner) edges.push(corner, other);
    for (let second = axis + 1; second < 4; second++) {
      const b = corner ^ (1 << axis);
      const c = corner ^ (1 << second);
      if (b > corner && c > corner) triangles.push(corner, b, c);
    }
  }
}
const hypercube = new CellComplex(4, Float64Array.from(positions), [
  { dim: 1, verticesPerCell: 2, kind: 'simplex', indices: Uint32Array.from(edges) },
  { dim: 2, verticesPerCell: 3, kind: 'simplex', indices: Uint32Array.from(triangles) }
]);

// 1. Edges: live draw, and one Three copy behind adapter and application.
const edgeProduct = new ProjectedEdges3D(
  hypercube, new PerspectiveProjection({ fromDim: 4, viewDistance: 4 })
);
if (edgeProduct.geometry.getAttribute('position').count === 0) {
  fail('ProjectedEdges3D drew nothing');
}
if (!(edgeProduct.geometry instanceof THREE.BufferGeometry)) {
  fail('the adapter and the application hold different Three copies');
}
if (!(edgeProduct.object instanceof THREE.Object3D)) fail('object is a foreign Object3D');
edgeProduct.dispose();

// 2. Surface: a real pick with representation evidence.
const surface = new ProjectedSurface3D(
  hypercube, new PerspectiveProjection({ fromDim: 4, viewDistance: 6 })
);
surface.object.updateMatrixWorld(true);
const hits = new Raycaster(new Vector3(0, 0, 12), new Vector3(0, 0, -1), 0.01, 200)
  .intersectObject(surface.object, true);
if (hits.length === 0) fail('ProjectedSurface3D was not pickable');
const surfaceHit = representationHitFromProjectedSurface(surface, hits[0]);
if (surfaceHit.ambientDim !== 4) fail('the surface hit did not report R4');
if (surfaceHit.source.kind !== 'cell') fail('the surface hit named no source cell');
surface.dispose();

// 3. Sliced complex: non-empty, empty, refilled.
const solid = new CellComplex(4, Float64Array.from([
  0, 0, 0, -2, 6, 0, 0, 2, 0, 6, 0, 2, 0, 0, 6, 2, 3, 3, 3, 2
]), [{ dim: 3, verticesPerCell: 4, kind: 'simplex',
  indices: Uint32Array.from([0, 1, 2, 3, 0, 1, 2, 4, 0, 1, 3, 4, 0, 2, 3, 4]) }]);
const slice4 = HyperplaneSlice4.axisAligned(3, 0);
const sliced = new SlicedComplex3D(solid, slice4);
if (sliced.geometry.drawRange.count === 0) fail('SlicedComplex3D drew nothing');
slice4.offset = 40;
sliced.update();
if (sliced.geometry.drawRange.count !== 0) fail('SlicedComplex3D did not empty');
slice4.offset = 0;
sliced.update();
if (sliced.geometry.drawRange.count === 0) fail('SlicedComplex3D did not refill');
sliced.dispose();

// 4. Section chart: live-range bounds after a move, and a pick there.
const tetra = new CellComplex(4, Float64Array.from([
  0, 0, 0, -1, 2, 0, 0, 1, 0, 2, 0, 1, 0, 0, 2, 1
]), [{ dim: 3, verticesPerCell: 4, kind: 'simplex', indices: Uint32Array.from([0, 1, 2, 3]) }]);
const chart = new SectionChart3D(
  tetra, tetra.groups[0], HyperplaneSliceN.axisAligned(4, 3, 0)
);
if (chart.geometry.drawRange.count === 0) fail('SectionChart3D drew nothing');
for (let vertex = 0; vertex < tetra.vertexCount; vertex++) {
  tetra.positions[vertex * 4] += 40;
}
chart.update();
if (chart.geometry.boundingBox.min.x < 39.5) {
  fail('SectionChart3D bounds included padded capacity');
}
chart.object.updateMatrixWorld(true);
const chartHits = new Raycaster(new Vector3(40.4, 0.4, 10), new Vector3(0, 0, -1), 0.01, 100)
  .intersectObject(chart.object, true);
if (chartHits.length === 0) fail('SectionChart3D was not pickable at its moved position');
const chartHit = representationHitFromSectionChart(chart, {
  point: chartHits[0].point, faceIndex: chartHits[0].faceIndex ?? 0
});
if (chartHit.ambientPointStatus !== 'approximate') {
  fail('the section hit did not qualify its ambient point');
}
chart.dispose();

// 5. The WebGPU entry point imports and converts without a device.
const gpu = await import('@holotope/three/webgpu');
for (const name of ['ProjectedEdgesGPU', 'SlicedComplexGPU', 'RaymarchedField3D',
  'sliceToGpuUniforms', 'transformToGpuUniforms']) {
  if (gpu[name] === undefined) fail('@holotope/three/webgpu is missing ' + name);
}
const frame = new THREE.Matrix4();
gpu.sliceToGpuUniforms(HyperplaneSlice4.axisAligned(3, 0.25), frame);
if (frame.elements.every((value) => value === 0)) fail('sliceToGpuUniforms wrote nothing');

console.log('three-compat ok revision=' + THREE.REVISION);
`;

const packOut = path.join(REPO, '.packed-three-compat');
fs.rmSync(packOut, { recursive: true, force: true });
const packed = packPublicPackages(packOut);

/** Pinned so the guard's own compiler cannot drift with the workspace. */
const TYPESCRIPT_VERSION = '5.9.3';

const failures = [];
/** One entry per revision that cleared BOTH columns. */
const completed = [];
for (const revision of REVISIONS) {
  const consumer = fs.mkdtempSync(path.join(os.tmpdir(), `holotope-three-${revision}-`));
  // Both columns must be positively recorded. A row cannot pass by falling
  // through a branch that never typechecked: `completed` is written only after
  // both flags are asserted, and the summary re-asserts them at the end.
  let typechecked = false;
  let runtimeDriven = false;
  try {
    const vendored = path.join(consumer, 'vendor');
    fs.mkdirSync(vendored, { recursive: true });
    const dependencies = { three: revision };
    for (const entry of packed.packed) {
      const local = path.join(vendored, path.basename(entry.tarball));
      fs.copyFileSync(entry.tarball, local);
      dependencies[entry.name] = `file:./vendor/${path.basename(local)}`;
    }
    fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({
      name: `holotope-three-compat-${revision.replace(/\./g, '-')}`,
      private: true,
      type: 'module',
      dependencies,
      // The declaration package is pinned to the SAME version as the runtime.
      // If that exact version is unpublished, the install fails and the row
      // fails with it — which is the correct outcome, because a revision with
      // no usable declarations does not clear the strict-TypeScript column.
      devDependencies: { typescript: TYPESCRIPT_VERSION, '@types/three': revision },
      pnpm: { overrides: { ...dependencies } }
    }, null, 2) + '\n');
    fs.writeFileSync(path.join(consumer, 'drive.mjs'), DRIVE);
    fs.writeFileSync(path.join(consumer, 'typed-drive.ts'), TYPED_DRIVE);
    fs.writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        skipLibCheck: false,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        verbatimModuleSyntax: true,
        isolatedModules: true,
        noEmit: true,
        types: []
      },
      files: ['typed-drive.ts']
    }, null, 2) + '\n');
    execFileSync('pnpm', ['install', '--ignore-workspace', '--no-frozen-lockfile'], {
      cwd: consumer, stdio: 'pipe', encoding: 'utf8'
    });
    const installed = JSON.parse(fs.readFileSync(
      path.join(consumer, 'node_modules/three/package.json'), 'utf8'
    )).version;
    if (installed !== revision) {
      throw new Error(`resolved three ${installed}, requested ${revision}`);
    }
    // --- column 1: strict TypeScript against this revision's declarations ---
    const installedTypes = JSON.parse(fs.readFileSync(
      path.join(consumer, 'node_modules/@types/three/package.json'), 'utf8'
    )).version;
    if (installedTypes !== revision) {
      throw new Error(
        `resolved @types/three ${installedTypes}, requested ${revision}; the ` +
        'strict-TypeScript column must use this revision\'s own declarations'
      );
    }
    execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], {
      cwd: consumer, stdio: 'pipe', encoding: 'utf8'
    });
    typechecked = true;

    // --- column 2: the live runtime drive ---
    const output = execFileSync('node', ['drive.mjs'], {
      cwd: consumer, stdio: 'pipe', encoding: 'utf8'
    });
    if (!output.includes('three-compat ok')) {
      throw new Error(`drive produced no success line: ${output.slice(0, 300)}`);
    }
    runtimeDriven = true;
    console.log(
      `check-three-compatibility: ${revision} - strict tsc ok ` +
      `(@types/three@${installedTypes}) - ${output.trim()}`
    );
    if (!typechecked || !runtimeDriven) {
      throw new Error(
        `internal: row finished with typechecked=${typechecked} ` +
        `runtimeDriven=${runtimeDriven}; both columns are required`
      );
    }
    completed.push({ revision, typechecked, runtimeDriven });
  } catch (error) {
    const detail = [error.stdout, error.stderr, error.message]
      .map((part) => String(part ?? '')).filter(Boolean).join('\n');
    failures.push(
      `${revision} (strict tsc ${typechecked ? 'ok' : 'NOT REACHED'}, ` +
      `runtime ${runtimeDriven ? 'ok' : 'NOT REACHED'}): ${detail.slice(0, 900)}`
    );
  } finally {
    if (!KEEP) fs.rmSync(consumer, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  console.error('\ncheck-three-compatibility: the declared peer range is not supported:\n');
  for (const failure of failures) console.error(`  ${failure}\n`);
  console.error(
    'Either the peer range over-claims, or a genuine regression landed.\n' +
    'Narrow the range with the measurement that justifies it - never widen a\n' +
    'range to make this pass.\n'
  );
  process.exit(1);
}
// The guard's own postcondition. If a future edit ever makes the typecheck
// conditional, this fails rather than quietly reporting a green runtime-only
// run — which is precisely the gap the P57 review found in the previous
// version of this script.
const missing = REVISIONS.filter((revision) => !completed.some(
  (row) => row.revision === revision && row.typechecked && row.runtimeDriven
));
if (missing.length > 0) {
  console.error(
    '\ncheck-three-compatibility: internal — these revisions did not record ' +
    `both columns: ${missing.join(', ')}\n`
  );
  process.exit(1);
}
console.log(
  `\ncheck-three-compatibility: ${REVISIONS.length} tested revision(s) pass ` +
  'both the strict-TypeScript and runtime columns.'
);
