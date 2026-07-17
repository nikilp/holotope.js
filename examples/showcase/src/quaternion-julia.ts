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
  type QuaternionJuliaEvaluation,
  type Vec4f64
} from '@holotope/core';
import {
  FieldRelief3D,
  SampledSlicedField3D,
  sampleFractalPalette,
  type FractalPaletteId
} from '@holotope/three';
import {
  QuaternionJuliaGPU,
  RaymarchedQuaternionJulia3D,
  SettledSupersampling3D,
  compareQuaternionJuliaGPU
} from '@holotope/three/webgpu';
import { setupShowcaseUI } from './ui';

type RenderMode = 'raymarch' | 'mesh' | 'relief';

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
const supersampling = new SettledSupersampling3D(renderer, scene, camera, {
  sampleLevel: 2,
  settleFrames: 2
});

// The CPU mesh and relief use scene lights. The ray marcher performs its own
// field-gradient lighting in the fragment graph.
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
const classicMeshColor = new Color();
let preset = 'spiral';
let parameterReal = -0.8;
let parameterImaginary = 0.155;
let renderMode: RenderMode = 'raymarch';
let paletteId: FractalPaletteId = 'classic';
let quality = 'balanced';
let resolution = 38;
let reliefResolution = 160;
let reliefHeight = 0.9;
let reliefDepth = 0;
let sliceAngle = 0;
let secondarySliceAngle = 0;
let sliceOffset = 0;
let settledSsaa = false;
let sampled: SampledSlicedField3D | null = null;
let relief: FieldRelief3D<QuaternionJuliaEvaluation> | null = null;
let raymarched: RaymarchedQuaternionJulia3D | null = null;
let rebuildTimer = 0;
let parityGeneration = 0;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function colorForIteration(iteration: number): number {
  const normalized = clamp01(iteration / 28);
  if (paletteId === 'classic') {
    // This is the exact pre-relief diagnostic-mesh palette.
    classicMeshColor.setHSL(0.52 + normalized * 0.28, 0.82, 0.48 + normalized * 0.22);
    return classicMeshColor.getHex();
  }
  return sampleFractalPalette(paletteId, normalized);
}

function reliefHeightFor(record: QuaternionJuliaEvaluation): number {
  const dwell = clamp01(record.continuousIteration / 32);
  const ridges = 0.84 + 0.16 * Math.cos(Math.log1p(record.orbitTrap) * 34);
  return reliefHeight * (0.025 + Math.pow(dwell, 1.45) * ridges);
}

function reliefColorFor(record: QuaternionJuliaEvaluation): number {
  const dwell = clamp01(record.continuousIteration / 32);
  const bands = 0.5 + 0.5 * Math.cos(Math.log1p(record.orbitTrap) * 34);
  return sampleFractalPalette(paletteId, clamp01(dwell * 0.82 + bands * 0.18));
}

function updateSlice(): void {
  const primary = (sliceAngle * Math.PI) / 180;
  const secondary = (secondarySliceAngle * Math.PI) / 180;
  const secondaryCosine = Math.cos(secondary);
  slice.setNormal([
    Math.sin(secondary),
    0,
    secondaryCosine * Math.cos(primary),
    secondaryCosine * Math.sin(primary)
  ]);
  slice.offset = sliceOffset;
}

function removeProducts(): void {
  if (sampled) {
    scene.remove(sampled.object);
    sampled.dispose();
    sampled = null;
  }
  if (relief) {
    scene.remove(relief.object);
    relief.dispose();
    relief = null;
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

function syncControlAvailability(): void {
  qualityInput.disabled = renderMode !== 'raymarch';
  ssaaInput.disabled = renderMode !== 'raymarch';
  resolutionInput.disabled = renderMode !== 'mesh';
  reliefResolutionInput.disabled = renderMode !== 'relief';
  reliefHeightInput.disabled = renderMode !== 'relief';
  reliefDepthInput.disabled = renderMode !== 'relief';
}

function rebuild(runParity = true): void {
  const started = performance.now();
  supersampling.invalidate();
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
      normalEpsilon: selected.epsilon * 2.5,
      palette: paletteId
    });
    scene.add(raymarched.object);
    document.getElementById('stats')!.textContent =
      `adaptive fragment-stage field · ≤ ${selected.label} per ray · no voxel mesh`;
    document.getElementById('escape')!.textContent =
      `gradient normals + orbit-trap bands · ${field.options.maxIterations} orbit iterations`;
    if (runParity) void updateParity(field);
  } else if (renderMode === 'mesh') {
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
    document.getElementById('parity')!.textContent =
      'original mesh mode retains every Float64 sample and source grid cell';
    parityGeneration++;
  } else {
    relief = new FieldRelief3D(field, slice, {
      resolution: reliefResolution,
      extent: 1.65,
      planeAxes: [0, 2],
      planeOffset: reliefDepth,
      heightFor: ({ record }) => reliefHeightFor(record),
      colorFor: ({ record }) => reliefColorFor(record)
    });
    scene.add(relief.object);
    const escaped = relief.records.reduce((count, record) => count + Number(record.escaped), 0);
    const elapsed = performance.now() - started;
    document.getElementById('stats')!.textContent =
      `${relief.records.length.toLocaleString()} retained 2D field records (${reliefResolution}²) · ${relief.triangleCount.toLocaleString()} relief triangles · ${elapsed.toFixed(0)} ms CPU`;
    document.getElementById('escape')!.textContent =
      `${escaped.toLocaleString()} escaped · height = continuous dwell + orbit ridges · plane depth ${reliefDepth.toFixed(2)}`;
    document.getElementById('parity')!.textContent =
      'explanatory scalar-field graph · not a geometric zero-set section';
    parityGeneration++;
  }

  document.getElementById('parameterValue')!.textContent =
    PRESETS[preset]?.label ??
    `custom · ${parameterReal.toFixed(3)} ${parameterImaginary < 0 ? '−' : '+'} ${Math.abs(parameterImaginary).toFixed(3)}i`;
  document.getElementById('modeValue')!.textContent =
    renderMode === 'raymarch'
      ? `ray-marched field · ${paletteId}`
      : renderMode === 'mesh'
        ? `sampled diagnostic mesh · ${paletteId}`
        : `2D field relief · ${paletteId}`;
  syncControlAvailability();
}

function scheduleSliceUpdate(): void {
  window.clearTimeout(rebuildTimer);
  updateSlice();
  if (raymarched) {
    raymarched.update();
    supersampling.invalidate();
  }
  else rebuildTimer = window.setTimeout(() => rebuild(false), 80);
}

function setCameraForMode(previous: RenderMode, next: RenderMode): void {
  if (previous === next) return;
  if (next === 'relief') {
    camera.position.set(3.65, 2.75, 4.2);
    controls.target.set(0, 0.35, 0);
  } else if (previous === 'relief') {
    camera.position.set(0.3, 0.2, 4.8);
    controls.target.set(0, 0, 0);
  }
  controls.update();
}

const presetInput = document.getElementById('preset') as HTMLSelectElement;
const parameterRealInput = document.getElementById('parameterReal') as HTMLInputElement;
const parameterImaginaryInput = document.getElementById('parameterImaginary') as HTMLInputElement;
const parameterRealValue = document.getElementById('parameterRealValue')!;
const parameterImaginaryValue = document.getElementById('parameterImaginaryValue')!;
const modeInput = document.getElementById('renderMode') as HTMLSelectElement;
const paletteInput = document.getElementById('palette') as HTMLSelectElement;
const qualityInput = document.getElementById('quality') as HTMLSelectElement;
const resolutionInput = document.getElementById('resolution') as HTMLSelectElement;
const reliefResolutionInput = document.getElementById('reliefResolution') as HTMLSelectElement;
const reliefHeightInput = document.getElementById('reliefHeight') as HTMLInputElement;
const reliefDepthInput = document.getElementById('reliefDepth') as HTMLInputElement;
const ssaaInput = document.getElementById('ssaa') as HTMLInputElement;
const samplingValue = document.getElementById('sampling')!;

function syncParameterControls(): void {
  parameterRealInput.value = String(parameterReal);
  parameterImaginaryInput.value = String(parameterImaginary);
  parameterRealValue.textContent = parameterReal.toFixed(3).replace('-', '−');
  parameterImaginaryValue.textContent = parameterImaginary.toFixed(3).replace('-', '−');
}

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

modeInput.addEventListener('change', () => {
  const previous = renderMode;
  renderMode = modeInput.value as RenderMode;
  setCameraForMode(previous, renderMode);
  rebuild();
});
renderMode = modeInput.value as RenderMode;

paletteInput.addEventListener('change', () => {
  paletteId = paletteInput.value as FractalPaletteId;
  rebuild(false);
});
paletteId = paletteInput.value as FractalPaletteId;

qualityInput.addEventListener('change', () => {
  quality = qualityInput.value;
  rebuild(false);
});
quality = qualityInput.value;

resolutionInput.addEventListener('change', () => {
  resolution = Number(resolutionInput.value);
  rebuild(false);
});
resolution = Number(resolutionInput.value);

reliefResolutionInput.addEventListener('change', () => {
  reliefResolution = Number(reliefResolutionInput.value);
  rebuild(false);
});
reliefResolution = Number(reliefResolutionInput.value);

const reliefHeightValue = document.getElementById('reliefHeightValue')!;
reliefHeightInput.addEventListener('input', () => {
  reliefHeight = Number(reliefHeightInput.value);
  reliefHeightValue.textContent = reliefHeight.toFixed(2);
  window.clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(() => rebuild(false), 50);
});
reliefHeight = Number(reliefHeightInput.value);
reliefHeightValue.textContent = reliefHeight.toFixed(2);

const reliefDepthValue = document.getElementById('reliefDepthValue')!;
reliefDepthInput.addEventListener('input', () => {
  reliefDepth = Number(reliefDepthInput.value);
  reliefDepthValue.textContent = reliefDepth.toFixed(2);
  window.clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(() => rebuild(false), 80);
});
reliefDepth = Number(reliefDepthInput.value);
reliefDepthValue.textContent = reliefDepth.toFixed(2);

const angleInput = document.getElementById('angle') as HTMLInputElement;
const angleValue = document.getElementById('angleValue')!;
angleInput.addEventListener('input', () => {
  sliceAngle = Number(angleInput.value);
  angleValue.textContent = `${sliceAngle.toFixed(0)}°`;
  scheduleSliceUpdate();
});
sliceAngle = Number(angleInput.value);
angleValue.textContent = `${sliceAngle.toFixed(0)}°`;

const secondaryAngleInput = document.getElementById('secondaryAngle') as HTMLInputElement;
const secondaryAngleValue = document.getElementById('secondaryAngleValue')!;
secondaryAngleInput.addEventListener('input', () => {
  secondarySliceAngle = Number(secondaryAngleInput.value);
  secondaryAngleValue.textContent = `${secondarySliceAngle.toFixed(0)}°`;
  scheduleSliceUpdate();
});
secondarySliceAngle = Number(secondaryAngleInput.value);
secondaryAngleValue.textContent = `${secondarySliceAngle.toFixed(0)}°`;

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
  supersampling.invalidate();
});
controls.autoRotate = rotateInput.checked;

ssaaInput.addEventListener('change', () => {
  settledSsaa = ssaaInput.checked;
  supersampling.invalidate();
});
settledSsaa = ssaaInput.checked;

setupShowcaseUI();
rebuild();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  supersampling.invalidate();
});

let previousSamplingText = '';
renderer.setAnimationLoop(() => {
  controls.update();
  let samplingText = 'still-frame SSAA off';
  if (settledSsaa && renderMode === 'raymarch') {
    const mode = supersampling.render();
    samplingText =
      mode === 'direct'
        ? 'still-frame SSAA waiting for a stable view'
        : mode === 'supersampled'
          ? `${supersampling.sampleCount}-sample still-frame SSAA captured`
          : `${supersampling.sampleCount}-sample still-frame SSAA cached`;
  } else {
    renderer.render(scene, camera);
    if (settledSsaa) samplingText = 'still-frame SSAA available in ray-marched mode';
  }
  if (samplingText !== previousSamplingText) {
    samplingValue.textContent = samplingText;
    previousSamplingText = samplingText;
  }
});

addEventListener('beforeunload', () => supersampling.dispose(), { once: true });
