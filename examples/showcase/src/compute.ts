import {
  AmbientLight,
  Color,
  DirectionalLight,
  PerspectiveCamera,
  Scene
} from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  HyperplaneSlice4,
  Rotor4,
  TransformN,
  create120Cell
} from '@holotope/core';
import { DragRotation4D, SlicedComplex3D } from '@holotope/three';
import { SlicedComplexGPU } from '@holotope/three/webgpu';
import { setupShowcaseUI } from './ui';

const container = document.getElementById('app')!;

const scene = new Scene();
scene.background = new Color(0x0a0a12);

const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 2.4, 7.4);

const renderer = new WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);
await renderer.init();

const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
document.getElementById('backend')!.textContent = isWebGPU
  ? 'WebGPU (WGSL compute)'
  : 'WebGL 2 — no compute shaders; showing the CPU path only';

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const drag4d = new DragRotation4D().attach(renderer.domElement);

scene.add(new AmbientLight(0xffffff, 0.45));
const sun = new DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 5, 4);
scene.add(sun);

const cell120 = create120Cell({ radius: 1.5 });
const slice = HyperplaneSlice4.axisAligned(3, 0);

// GPU compute path (left): the marching-tetrahedra kernel runs on the
// GPU each frame; only uniforms cross the bus.
const gpu = isWebGPU ? new SlicedComplexGPU(cell120, slice) : null;
if (gpu) scene.add(gpu.object);

// CPU golden path (right): the Float64 reference of the exact same cut.
const cpu = new SlicedComplex3D(cell120, slice);
scene.add(cpu.object);

// Responsive layout: side by side in landscape, stacked in portrait.
let wasPortrait: boolean | null = null;
const layout = (): void => {
  const portrait = window.innerHeight > window.innerWidth;
  gpu?.object.position.set(portrait ? 0 : -2.2, portrait ? 2.0 : 0, 0);
  cpu.object.position.set(gpu ? (portrait ? 0 : 2.2) : 0, gpu && portrait ? -2.0 : 0, 0);
  if (portrait !== wasPortrait) {
    camera.position.set(0, portrait ? 1.6 : 2.4, portrait ? 10.5 : 7.4);
    wasPortrait = portrait;
  }
};
layout();

const bindRange = (id: string, onInput: (value: number) => void): void => {
  const input = document.getElementById(id) as HTMLInputElement;
  const label = document.getElementById(`${id}Value`);
  const apply = () => {
    const value = Number(input.value);
    if (label) label.textContent = value.toFixed(2);
    onInput(value);
  };
  input.addEventListener('input', apply);
  apply();
};

let xwSpeed = 0.25;
let yzSpeed = 0.15;
bindRange('sliceOffset', (v) => (slice.offset = v));
bindRange('xwSpeed', (v) => (xwSpeed = v));
bindRange('yzSpeed', (v) => (yzSpeed = v));
const cpuToggle = document.getElementById('showCpu') as HTMLInputElement;
cpuToggle.addEventListener('change', () => (cpu.object.visible = cpuToggle.checked));

// Differential verification, live: read the GPU section back and compare
// triangle count and total area against the CPU slicer's output.
const stats = document.getElementById('stats')!;

const triangleArea = (
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number
): number => {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const crx = uy * vz - uz * vy;
  const cry = uz * vx - ux * vz;
  const crz = ux * vy - uy * vx;
  return Math.sqrt(crx * crx + cry * cry + crz * crz) / 2;
};

const gpuStats = (section: Float32Array): { triangles: number; area: number } => {
  let triangles = 0;
  let area = 0;
  // Packed vec4 vertices, 6 per tet; non-emitted slots are all-zero.
  for (let t = 0; t < section.length; t += 12) {
    let allZero = true;
    for (let k = 0; k < 12 && allZero; k++) allZero = section[t + k] === 0;
    if (allZero) continue;
    triangles++;
    area += triangleArea(
      section[t]!, section[t + 1]!, section[t + 2]!,
      section[t + 4]!, section[t + 5]!, section[t + 6]!,
      section[t + 8]!, section[t + 9]!, section[t + 10]!
    );
  }
  return { triangles, area };
};

const cpuStats = (): { triangles: number; area: number } => {
  const positions = cpu.geometry.getAttribute('position').array as Float32Array;
  const count = cpu.geometry.drawRange.count;
  let area = 0;
  for (let v = 0; v < count; v += 3) {
    area += triangleArea(
      positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!,
      positions[v * 3 + 3]!, positions[v * 3 + 4]!, positions[v * 3 + 5]!,
      positions[v * 3 + 6]!, positions[v * 3 + 7]!, positions[v * 3 + 8]!
    );
  }
  return { triangles: count / 3, area };
};

let readbackBusy = false;
const refreshStats = async (): Promise<void> => {
  if (!gpu || readbackBusy) return;
  readbackBusy = true;
  try {
    const section = await gpu.readSection(renderer);
    const g = gpuStats(section);
    const c = cpuStats();
    stats.textContent =
      `GPU ${g.triangles} tris, area ${g.area.toFixed(4)} · ` +
      `CPU ${c.triangles} tris, area ${c.area.toFixed(4)}`;
  } catch {
    // Buffers may not exist before the first compute dispatch — retry
    // on the next tick.
  } finally {
    readbackBusy = false;
  }
};
if (gpu) setInterval(() => void refreshStats(), 500);
else stats.textContent = 'GPU compute unavailable on this backend';

setupShowcaseUI({ drag4d });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  layout();
});

let xwAngle = 0;
let yzAngle = 0;
let lastTime = 0;

renderer.setAnimationLoop((timeMs) => {
  const dt = Math.min((timeMs - lastTime) / 1000, 0.1);
  lastTime = timeMs;
  xwAngle += dt * xwSpeed;
  yzAngle += dt * yzSpeed;

  controls.enabled = !drag4d.active && drag4d.modifier !== 'none';

  const transform = new TransformN(
    4,
    drag4d.rotor.multiply(
      Rotor4.fromPlanes([
        { i: 0, j: 3, angle: xwAngle },
        { i: 1, j: 2, angle: yzAngle }
      ])
    )
  );
  gpu?.update(transform, renderer); // uniforms + one compute dispatch
  if (cpu.object.visible) cpu.update(transform); // full CPU remarch
  controls.update();
  renderer.render(scene, camera);
});
