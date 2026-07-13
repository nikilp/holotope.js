import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  PerspectiveCamera,
  Scene
} from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  HyperplaneSlice4,
  QuaternionJuliaField,
  type Vec4f64
} from '@holotope/core';
import { SampledSlicedField3D } from '@holotope/three';
import {
  QuaternionJuliaGPU,
  RaymarchedQuaternionJulia3D,
  compareQuaternionJuliaGPU
} from '@holotope/three/webgpu';
import { setupShowcaseUI } from './ui';

const container = document.getElementById('app')!;
const scene = new Scene();
scene.background = new Color(0x080910);
scene.fog = new Fog(0x080910, 5, 10);

const camera = new PerspectiveCamera(44, innerWidth / innerHeight, 0.1, 50);
camera.position.set(0.3, 0.2, 4.8);
const renderer = new WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
container.appendChild(renderer.domElement);
await renderer.init();
const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
document.getElementById('backend')!.textContent = isWebGPU
  ? 'WebGPU · WGSL field evaluation'
  : 'WebGL2 fallback · TSL ray marcher';

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.55;

// Used only by the sampled diagnostic mesh. The ray-marched product performs
// its own field-gradient lighting in the fragment graph.
scene.add(new AmbientLight(0x8ba4d8, 1.35));
const key = new DirectionalLight(0xffffff, 2.7);
key.position.set(3, 4, 5);
scene.add(key);
const rim = new DirectionalLight(0x765cff, 2.1);
rim.position.set(-4, -2, -3);
scene.add(rim);

const PRESETS: Record<string, { label: string; parameter: Vec4f64 }> = {
  rabbit: { label: 'rabbit · −0.123 + 0.745i', parameter: [0.745, 0, 0, -0.123] },
  basilica: { label: 'basilica · −1', parameter: [0, 0, 0, -1] },
  spiral: { label: 'spiral · −0.8 + 0.156i', parameter: [0.156, 0, 0, -0.8] },
  dendrite: { label: 'dendrite · i', parameter: [1, 0, 0, 0] }
};

const QUALITY: Record<string, { label: string; maxSteps: number; epsilon: number }> = {
  preview: { label: '72 steps', maxSteps: 72, epsilon: 0.0025 },
  balanced: { label: '112 steps', maxSteps: 112, epsilon: 0.0015 },
  fine: { label: '160 steps', maxSteps: 160, epsilon: 0.0009 }
};

const slice = HyperplaneSlice4.axisAligned(2);
const palette = new Color();
let preset = 'spiral';
let parameterReal = -0.8;
let parameterImaginary = 0.155;
let renderMode = 'raymarch';
let quality = 'balanced';
let resolution = 38;
let sliceAngle = 0;
let sliceOffset = 0;
let sampled: SampledSlicedField3D | null = null;
let raymarched: RaymarchedQuaternionJulia3D | null = null;
let rebuildTimer = 0;
let parityGeneration = 0;

function colorForIteration(iteration: number): number {
  const normalized = Math.max(0, Math.min(1, iteration / 28));
  palette.setHSL(0.52 + normalized * 0.28, 0.82, 0.48 + normalized * 0.22);
  return palette.getHex();
}

function updateSlice(): void {
  const angle = (sliceAngle * Math.PI) / 180;
  slice.setNormal([0, 0, Math.cos(angle), Math.sin(angle)]);
  slice.offset = sliceOffset;
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

function parityPoints(): Float32Array {
  const coordinates = [-1.3, -0.45, 0.45, 1.3];
  const points = new Float32Array(coordinates.length ** 4 * 4);
  let offset = 0;
  for (const i of coordinates) {
    for (const j of coordinates) {
      for (const k of coordinates) {
        for (const real of coordinates) {
          points.set([i, j, k, real], offset);
          offset += 4;
        }
      }
    }
  }
  return points;
}

async function updateParity(field: QuaternionJuliaField): Promise<void> {
  const generation = ++parityGeneration;
  const target = document.getElementById('parity')!;
  if (!isWebGPU) {
    target.textContent = 'compute readback unavailable on the WebGL2 fallback';
    return;
  }
  target.textContent = 'checking Float32 GPU records against Float64 CPU…';
  try {
    const points = parityPoints();
    const evaluator = new QuaternionJuliaGPU(field, points);
    const gpu = await evaluator.evaluate(renderer);
    if (generation !== parityGeneration) return;
    const differential = compareQuaternionJuliaGPU(field, points, gpu);
    target.textContent =
      `${differential.count} CPU↔GPU probes · ${differential.escapeMismatches} escape mismatches · ` +
      `max |Δdistance| ${differential.maxDistanceError.toExponential(1)}`;
  } catch (error) {
    if (generation !== parityGeneration) return;
    target.textContent = `GPU readback failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function rebuild(runParity = true): void {
  const started = performance.now();
  updateSlice();
  removeProducts();
  const field = new QuaternionJuliaField({
    parameter: [parameterImaginary, 0, 0, parameterReal],
    maxIterations: 32,
    escapeRadius: 4
  });

  if (renderMode === 'raymarch') {
    const selected = QUALITY[quality]!;
    raymarched = new RaymarchedQuaternionJulia3D(field, slice, {
      extent: 1.65,
      maxSteps: selected.maxSteps,
      surfaceEpsilon: selected.epsilon,
      normalEpsilon: selected.epsilon * 2.5
    });
    scene.add(raymarched.object);
    document.getElementById('stats')!.textContent =
      `adaptive fragment-stage field · ≤ ${selected.label} per ray · no voxel mesh`;
    document.getElementById('escape')!.textContent =
      `gradient normals + orbit-trap bands · ${field.options.maxIterations} orbit iterations`;
    if (runParity) void updateParity(field);
  } else {
    sampled = new SampledSlicedField3D(field, slice, {
      resolution,
      extent: 1.65,
      colorForIteration
    });
    scene.add(sampled.object);
    const elapsed = performance.now() - started;
    document.getElementById('stats')!.textContent =
      `${sampled.sample.count.toLocaleString()} CPU samples · ${sampled.triangleCount.toLocaleString()} approximate triangles · ${elapsed.toFixed(0)} ms`;
    document.getElementById('escape')!.textContent =
      `${sampled.sample.escapedCount.toLocaleString()} escaped · ${sampled.sample.count - sampled.sample.escapedCount} bounded at 32 iterations`;
    document.getElementById('parity')!.textContent = 'mesh mode exposes every Float64 sample and source grid cell';
    parityGeneration++;
  }
  document.getElementById('parameterValue')!.textContent =
    PRESETS[preset]?.label ??
    `custom · ${parameterReal.toFixed(3)} ${parameterImaginary < 0 ? '−' : '+'} ${Math.abs(parameterImaginary).toFixed(3)}i`;
  document.getElementById('modeValue')!.textContent =
    renderMode === 'raymarch' ? 'ray-marched field' : 'sampled diagnostic mesh';
  resolutionInput.disabled = renderMode === 'raymarch';
  qualityInput.disabled = renderMode !== 'raymarch';
}

function scheduleSliceUpdate(): void {
  window.clearTimeout(rebuildTimer);
  updateSlice();
  if (raymarched) {
    raymarched.update();
  } else {
    rebuildTimer = window.setTimeout(() => rebuild(false), 80);
  }
}

const presetInput = document.getElementById('preset') as HTMLSelectElement;
presetInput.addEventListener('change', () => {
  preset = presetInput.value;
  const selected = PRESETS[preset];
  if (selected) {
    parameterImaginary = selected.parameter[0];
    parameterReal = selected.parameter[3];
    syncParameterControls();
  }
  rebuild();
});
preset = presetInput.value;

const parameterRealInput = document.getElementById('parameterReal') as HTMLInputElement;
const parameterImaginaryInput = document.getElementById('parameterImaginary') as HTMLInputElement;
const parameterRealValue = document.getElementById('parameterRealValue')!;
const parameterImaginaryValue = document.getElementById('parameterImaginaryValue')!;

function syncParameterControls(): void {
  parameterRealInput.value = String(parameterReal);
  parameterImaginaryInput.value = String(parameterImaginary);
  parameterRealValue.textContent = parameterReal.toFixed(3).replace('-', '−');
  parameterImaginaryValue.textContent = parameterImaginary.toFixed(3).replace('-', '−');
}

function scheduleParameterRebuild(): void {
  preset = 'custom';
  presetInput.value = 'custom';
  syncParameterControls();
  window.clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(() => rebuild(), 120);
}

parameterRealInput.addEventListener('input', () => {
  parameterReal = Number(parameterRealInput.value);
  scheduleParameterRebuild();
});
parameterImaginaryInput.addEventListener('input', () => {
  parameterImaginary = Number(parameterImaginaryInput.value);
  scheduleParameterRebuild();
});
const initialPreset = PRESETS[preset]!;
parameterImaginary = initialPreset.parameter[0];
parameterReal = initialPreset.parameter[3];
syncParameterControls();

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
resolutionInput.addEventListener('change', () => {
  resolution = Number(resolutionInput.value);
  rebuild(false);
});
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
rotateInput.addEventListener('change', () => {
  controls.autoRotate = rotateInput.checked;
});
controls.autoRotate = rotateInput.checked;

setupShowcaseUI();
rebuild();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
