import { Color, LineBasicMaterial, PerspectiveCamera, Scene } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  PerspectiveProjection,
  Rotor4,
  TransformN,
  create600Cell
} from '@holotope/core';
import { DragRotation4D, ProjectedEdges3D } from '@holotope/three';
import { ProjectedEdgesGPU } from '@holotope/three/webgpu';

const container = document.getElementById('app')!;

const scene = new Scene();
scene.background = new Color(0x0a0a12);

const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.6, 5.2);

const renderer = new WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);
await renderer.init();

const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
document.getElementById('backend')!.textContent = isWebGPU
  ? 'WebGPU (WGSL)'
  : 'WebGL 2 fallback (GLSL, same TSL graph)';

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const drag4d = new DragRotation4D().attach(renderer.domElement);

const viewDistance = 4;
const cell600 = create600Cell({ radius: 1.5 });

// The GPU product: 4D positions live on the GPU; projection happens in the
// vertex shader. update() only writes uniforms.
const gpu = new ProjectedEdgesGPU(cell600, { color: 0xf2a65a, viewDistance });
scene.add(gpu.object);

// CPU golden path of the same object and projection — toggle it on and the
// two wireframes must coincide exactly (differential verification).
const cpu = new ProjectedEdges3D(cell600, new PerspectiveProjection({ fromDim: 4, viewDistance }), {
  material: new LineBasicMaterial({ color: 0x7fd4ff })
});
cpu.object.visible = false;
scene.add(cpu.object);

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

let xwSpeed = 0.3;
let yzSpeed = 0.2;
bindRange('xwSpeed', (v) => (xwSpeed = v));
bindRange('yzSpeed', (v) => (yzSpeed = v));
const cpuToggle = document.getElementById('showCpu') as HTMLInputElement;
cpuToggle.addEventListener('change', () => (cpu.object.visible = cpuToggle.checked));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let xwAngle = 0;
let yzAngle = 0;
let lastTime = 0;

renderer.setAnimationLoop((timeMs) => {
  const dt = Math.min((timeMs - lastTime) / 1000, 0.1);
  lastTime = timeMs;
  xwAngle += dt * xwSpeed;
  yzAngle += dt * yzSpeed;

  controls.enabled = !drag4d.active;

  const transform = new TransformN(
    4,
    drag4d.rotor.multiply(
      Rotor4.fromPlanes([
        { i: 0, j: 3, angle: xwAngle },
        { i: 1, j: 2, angle: yzAngle }
      ])
    )
  );
  gpu.update(transform); // uniforms only
  if (cpu.object.visible) cpu.update(transform); // full CPU reprojection
  controls.update();
  renderer.render(scene, camera);
});
