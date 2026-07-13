import { AmbientLight, Color, DirectionalLight, Fog, PerspectiveCamera, Scene } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  BicomplexJuliaField,
  HyperplaneSlice4,
  idempotentToBicomplex,
  type Complex2,
  type Vec4f64
} from '@holotope/core';
import { SampledSlicedField3D } from '@holotope/three';
import {
  BicomplexJuliaGPU,
  RaymarchedBicomplexJulia3D,
  compareBicomplexJuliaGPU
} from '@holotope/three/webgpu';
import { setupShowcaseUI } from './ui';

interface ProductPreset { label: string; first: Complex2; second: Complex2 }
const PRESETS: Record<string, ProductPreset> = {
  rabbitSpiral: { label: 'rabbit × spiral', first: [0.745, -0.123], second: [0.156, -0.8] },
  basilicaSpiral: { label: 'basilica × spiral', first: [0, -1], second: [0.156, -0.8] },
  basilicaRabbit: { label: 'basilica × rabbit', first: [0, -1], second: [0.745, -0.123] },
  matchedSpiral: { label: 'spiral × spiral', first: [0.156, -0.8], second: [0.156, -0.8] }
};

const QUALITY: Record<string, { label: string; maxSteps: number; epsilon: number }> = {
  preview: { label: '112 steps', maxSteps: 112, epsilon: 0.0025 },
  balanced: { label: '176 steps', maxSteps: 176, epsilon: 0.0015 },
  fine: { label: '256 steps', maxSteps: 256, epsilon: 0.0009 }
};

const container = document.getElementById('app')!;
const scene = new Scene();
scene.background = new Color(0x080910);
scene.fog = new Fog(0x080910, 5, 10);
const camera = new PerspectiveCamera(44, innerWidth / innerHeight, 0.1, 50);
camera.position.set(0.4, 0.25, 4.7);
const renderer = new WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
container.appendChild(renderer.domElement);
await renderer.init();
const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
document.getElementById('backend')!.textContent = isWebGPU
  ? 'WebGPU · WGSL factorized field'
  : 'WebGL2 fallback · TSL ray marcher';

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.5;

// These lights illuminate only the sampled diagnostic mesh. Ray-marched
// mode evaluates its own field-gradient lighting in the fragment graph.
scene.add(new AmbientLight(0xa498d8, 1.4));
const key = new DirectionalLight(0xffffff, 2.8);
key.position.set(4, 3, 5);
scene.add(key);
const rim = new DirectionalLight(0xff4fb8, 1.8);
rim.position.set(-4, -2, -3);
scene.add(rim);

const slice = HyperplaneSlice4.axisAligned(3);
const palette = new Color();
let preset = 'rabbitSpiral';
let first: Complex2 = [...PRESETS[preset]!.first];
let second: Complex2 = [...PRESETS[preset]!.second];
let renderMode = 'raymarch';
let quality = 'balanced';
let resolution = 38;
let sliceAngle = 0;
let sliceOffset = 0;
let sampled: SampledSlicedField3D | null = null;
let raymarched: RaymarchedBicomplexJulia3D | null = null;
let rebuildTimer = 0;
let parityGeneration = 0;

function parameterOf(): Vec4f64 { return idempotentToBicomplex(first, second); }
function colorForIteration(iteration: number): number {
  const normalized = Math.max(0, Math.min(1, iteration / 28));
  palette.setHSL(0.78 + normalized * 0.18, 0.82, 0.47 + normalized * 0.22);
  return palette.getHex();
}
function updateSlice(): void {
  const angle = (sliceAngle * Math.PI) / 180;
  slice.setNormal([0, 0, Math.sin(angle), Math.cos(angle)]);
  slice.offset = sliceOffset;
}
function parityPoints(): Float32Array {
  const coordinates = [-1.2, -0.4, 0.4, 1.2];
  const points = new Float32Array(coordinates.length ** 4 * 4);
  let offset = 0;
  for (const i1 of coordinates) for (const i2 of coordinates) {
    for (const product of coordinates) for (const real of coordinates) {
      points.set([i1, i2, product, real], offset);
      offset += 4;
    }
  }
  return points;
}
async function updateParity(field: BicomplexJuliaField): Promise<void> {
  const generation = ++parityGeneration;
  const target = document.getElementById('parity')!;
  if (!isWebGPU) {
    target.textContent = 'factor readback unavailable on the WebGL2 fallback';
    return;
  }
  target.textContent = 'checking both complex factor records against Float64 CPU…';
  try {
    const points = parityPoints();
    const gpu = await new BicomplexJuliaGPU(field, points).evaluate(renderer);
    if (generation !== parityGeneration) return;
    const differential = compareBicomplexJuliaGPU(field, points, gpu);
    target.textContent =
      `${differential.count} product probes · ${differential.factorEscapeMismatches} factor escape mismatches · ` +
      `max factor |Δdistance| ${differential.maxFactorDistanceError.toExponential(1)}`;
  } catch (error) {
    if (generation !== parityGeneration) return;
    target.textContent = `GPU factor readback failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}
function factorLabel(factor: Complex2): string {
  return `${factor[1].toFixed(3)} ${factor[0] < 0 ? '−' : '+'} ${Math.abs(factor[0]).toFixed(3)}i`;
}
function removeProducts(): void {
  if (sampled) {
    scene.remove(sampled.object);
    sampled.dispose();
    sampled = null;
  }
  if (raymarched) {
    scene.remove(raymarched.object);
    raymarched.dispose();
    raymarched = null;
  }
}
function rebuild(runParity = true): void {
  const started = performance.now();
  updateSlice();
  removeProducts();
  const field = new BicomplexJuliaField({ parameter: parameterOf(), maxIterations: 32, escapeRadius: 4 });
  if (renderMode === 'raymarch') {
    const selected = QUALITY[quality]!;
    raymarched = new RaymarchedBicomplexJulia3D(field, slice, {
      extent: 1.65,
      maxSteps: selected.maxSteps,
      surfaceEpsilon: selected.epsilon,
      normalEpsilon: selected.epsilon * 2.5
    });
    scene.add(raymarched.object);
    document.getElementById('stats')!.textContent =
      `adaptive fragment-stage product · ≤ ${selected.label} per ray · no voxel mesh`;
    document.getElementById('escape')!.textContent =
      `proven product-metric distance · factor-dominance shading · ${field.options.maxIterations} orbit iterations`;
    if (runParity) void updateParity(field);
  } else {
    sampled = new SampledSlicedField3D(field, slice, { resolution, extent: 1.65, colorForIteration });
    scene.add(sampled.object);
    const elapsed = performance.now() - started;
    document.getElementById('stats')!.textContent =
      `${sampled.sample.count.toLocaleString()} slice-grid probes (${resolution}³) · ${sampled.triangleCount.toLocaleString()} approximate boundary triangles · ${elapsed.toFixed(0)} ms CPU`;
    document.getElementById('escape')!.textContent =
      `${sampled.sample.escapedCount.toLocaleString()} escaped by ${field.options.maxIterations} iterations · ${sampled.sample.count - sampled.sample.escapedCount} still bounded in both factors`;
    document.getElementById('parity')!.textContent =
      'mesh mode exposes every Float64 sample, factor record, and source grid cell';
    parityGeneration++;
  }
  document.getElementById('factorValue')!.textContent =
    PRESETS[preset]?.label ?? `custom · (${factorLabel(first)}) × (${factorLabel(second)})`;
  document.getElementById('modeValue')!.textContent =
    renderMode === 'raymarch' ? 'ray-marched product' : 'sampled diagnostic mesh';
  resolutionInput.disabled = renderMode === 'raymarch';
  qualityInput.disabled = renderMode !== 'raymarch';
}
function scheduleRebuild(runParity = false): void {
  window.clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(() => rebuild(runParity), 100);
}
function scheduleSliceUpdate(): void {
  window.clearTimeout(rebuildTimer);
  updateSlice();
  if (raymarched) raymarched.update();
  else rebuildTimer = window.setTimeout(() => rebuild(false), 80);
}

const presetInput = document.getElementById('preset') as HTMLSelectElement;
const factorInputs = {
  firstReal: document.getElementById('firstReal') as HTMLInputElement,
  firstImaginary: document.getElementById('firstImaginary') as HTMLInputElement,
  secondReal: document.getElementById('secondReal') as HTMLInputElement,
  secondImaginary: document.getElementById('secondImaginary') as HTMLInputElement
};
function syncFactorControls(): void {
  factorInputs.firstReal.value = String(first[1]);
  factorInputs.firstImaginary.value = String(first[0]);
  factorInputs.secondReal.value = String(second[1]);
  factorInputs.secondImaginary.value = String(second[0]);
  for (const [id, input] of Object.entries(factorInputs)) {
    document.getElementById(`${id}Value`)!.textContent = Number(input.value).toFixed(3).replace('-', '−');
  }
}
presetInput.addEventListener('change', () => {
  preset = presetInput.value;
  const selected = PRESETS[preset];
  if (selected) {
    first = [...selected.first];
    second = [...selected.second];
    syncFactorControls();
  }
  rebuild();
});
preset = presetInput.value;
function setCustomFactors(): void {
  first = [Number(factorInputs.firstImaginary.value), Number(factorInputs.firstReal.value)];
  second = [Number(factorInputs.secondImaginary.value), Number(factorInputs.secondReal.value)];
  preset = 'custom';
  presetInput.value = 'custom';
  syncFactorControls();
  scheduleRebuild(true);
}
for (const input of Object.values(factorInputs)) input.addEventListener('input', setCustomFactors);
syncFactorControls();

const modeInput = document.getElementById('renderMode') as HTMLSelectElement;
modeInput.addEventListener('change', () => {
  renderMode = modeInput.value;
  rebuild();
});
renderMode = modeInput.value;
const qualityInput = document.getElementById('quality') as HTMLSelectElement;
qualityInput.addEventListener('change', () => {
  quality = qualityInput.value;
  rebuild(false);
});
quality = qualityInput.value;
const resolutionInput = document.getElementById('resolution') as HTMLSelectElement;
resolutionInput.addEventListener('change', () => { resolution = Number(resolutionInput.value); rebuild(false); });
resolution = Number(resolutionInput.value);
const angleInput = document.getElementById('angle') as HTMLInputElement;
const angleValue = document.getElementById('angleValue')!;
angleInput.addEventListener('input', () => {
  sliceAngle = Number(angleInput.value);
  angleValue.textContent = `${sliceAngle.toFixed(0)}°`;
  scheduleSliceUpdate();
});
sliceAngle = Number(angleInput.value);
angleValue.textContent = `${sliceAngle.toFixed(0)}°`;
const offsetInput = document.getElementById('offset') as HTMLInputElement;
const offsetValue = document.getElementById('offsetValue')!;
offsetInput.addEventListener('input', () => {
  sliceOffset = Number(offsetInput.value);
  offsetValue.textContent = sliceOffset.toFixed(2);
  scheduleSliceUpdate();
});
sliceOffset = Number(offsetInput.value);
offsetValue.textContent = sliceOffset.toFixed(2);
const rotateInput = document.getElementById('rotate') as HTMLInputElement;
rotateInput.addEventListener('change', () => { controls.autoRotate = rotateInput.checked; });
controls.autoRotate = rotateInput.checked;

setupShowcaseUI();
rebuild();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
