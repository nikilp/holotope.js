import {
  AmbientLight,
  Color,
  DirectionalLight,
  DoubleSide,
  LineBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  HyperplaneSlice4,
  PerspectiveProjection,
  Rotor4,
  TransformN,
  createHypercube,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import { DragRotation4D, ProjectedEdges3D, SlicedComplex3D } from '@holotope/three';

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

// Alt-drag rotates the object through 4D planes the camera can't reach
// (xw horizontally, yw vertically); plain drag stays a 3D orbit.
const drag4d = new DragRotation4D().attach(renderer.domElement);

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

// The same cut rendered through the projection, overlaid inside the
// wireframe: shows exactly where the cross-section lives in the "shadow".
const overlay = new SlicedComplex3D(tesseract, slice, {
  projection,
  material: new MeshStandardMaterial({
    color: 0xff9d5c,
    side: DoubleSide,
    flatShading: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false
  })
});
overlay.object.position.x = -2.6;
scene.add(overlay.object);

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
bindToggle('showOverlay', (on) => (overlay.object.visible = on));

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

  // Pause the 3D orbit while a 4D drag gesture is active.
  controls.enabled = !drag4d.active;

  // User 4D rotation composed on top of the auto-rotation, all on the
  // Rotor4 fast path.
  const rotation = drag4d.rotor.multiply(
    Rotor4.fromPlanes([
      { i: 0, j: 3, angle: xwAngle }, // xw
      { i: 1, j: 2, angle: yzAngle } // yz
    ])
  );
  const transform = new TransformN(4, rotation);
  wireframe.update(transform);
  section.update(transform);
  overlay.update(transform);
  controls.update();
  renderer.render(scene, camera);
});
