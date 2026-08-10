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
 * must import both entry points, exercise the four CPU adapters through a real
 * lifecycle, resolve a real `Raycaster` pick, and prove that exactly one Three
 * copy backs the adapters and the application. An install that merely succeeds
 * proves nothing and is never accepted as evidence.
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

const failures = [];
for (const revision of REVISIONS) {
  const consumer = fs.mkdtempSync(path.join(os.tmpdir(), `holotope-three-${revision}-`));
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
      pnpm: { overrides: { ...dependencies } }
    }, null, 2) + '\n');
    fs.writeFileSync(path.join(consumer, 'drive.mjs'), DRIVE);
    execFileSync('pnpm', ['install', '--ignore-workspace', '--no-frozen-lockfile'], {
      cwd: consumer, stdio: 'pipe', encoding: 'utf8'
    });
    const installed = JSON.parse(fs.readFileSync(
      path.join(consumer, 'node_modules/three/package.json'), 'utf8'
    )).version;
    if (installed !== revision) {
      throw new Error(`resolved three ${installed}, requested ${revision}`);
    }
    const output = execFileSync('node', ['drive.mjs'], {
      cwd: consumer, stdio: 'pipe', encoding: 'utf8'
    });
    if (!output.includes('three-compat ok')) {
      throw new Error(`drive produced no success line: ${output.slice(0, 300)}`);
    }
    console.log(`check-three-compatibility: ${revision} - ${output.trim()}`);
  } catch (error) {
    const detail = [error.stdout, error.stderr, error.message]
      .map((part) => String(part ?? '')).filter(Boolean).join('\n');
    failures.push(`${revision}: ${detail.slice(0, 900)}`);
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
console.log(`\ncheck-three-compatibility: ${REVISIONS.length} tested revision(s) pass.`);
