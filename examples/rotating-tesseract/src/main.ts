import {
  AmbientLight,
  Color,
  DirectionalLight,
  LineBasicMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  HyperplaneSlice4,
  PerspectiveProjection,
  TransformN,
  createHypercube,
  rotationFromPlanes,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import { ProjectedEdges3D, SlicedComplex3D } from '@holotope/three';

const container = document.getElementById('app')!;

const scene = new Scene();
scene.background = new Color(0x0a0a12);

const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 3.2, 8.4);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new AmbientLight(0xffffff, 0.45));
const sun = new DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 5, 4);
scene.add(sun);

// One 4D object, two render products of the same rotating tesseract:
// a perspective projection (left) and an exact hyperplane cross-section
// (right). Both update from the same 4D transform each frame.
const tesseract = tetrahedralizeCuboidCells(createHypercube({ dim: 4, size: 2 }));

const projection = new PerspectiveProjection({ fromDim: 4, viewDistance: 4 });
const wireframe = new ProjectedEdges3D(tesseract, projection, {
  material: new LineBasicMaterial({ color: 0x7fd4ff })
});
wireframe.object.position.x = -2.6;
scene.add(wireframe.object);

const slice = HyperplaneSlice4.axisAligned(3, 0);
const section = new SlicedComplex3D(tesseract, slice);
section.object.position.x = 2.6;
scene.add(section.object);

// Controls
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

let xwSpeed = 0.5;
let yzSpeed = 0.3;
bindRange('sliceOffset', (v) => (slice.offset = v));
bindRange('xwSpeed', (v) => (xwSpeed = v));
bindRange('yzSpeed', (v) => (yzSpeed = v));

const bindToggle = (id: string, onChange: (checked: boolean) => void): void => {
  const input = document.getElementById(id) as HTMLInputElement;
  input.addEventListener('change', () => onChange(input.checked));
  onChange(input.checked);
};
bindToggle('showWireframe', (on) => (wireframe.object.visible = on));
bindToggle('showSlice', (on) => (section.object.visible = on));

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

  const transform = new TransformN(
    4,
    rotationFromPlanes(4, [
      { i: 0, j: 3, angle: xwAngle }, // xw
      { i: 1, j: 2, angle: yzAngle } // yz
    ])
  );
  wireframe.update(transform);
  section.update(transform);
  controls.update();
  renderer.render(scene, camera);
});
