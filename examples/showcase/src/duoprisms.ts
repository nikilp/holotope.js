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
  Rotor4,
  TransformN,
  createDuoprism
} from '@holotope/core';
import { DragRotation4D, ProjectedEdges3D, SlicedComplex3D } from '@holotope/three';
import { setupShowcaseUI } from './ui';

const container = document.getElementById('app')!;

const scene = new Scene();
scene.background = new Color(0x0a0a12);

const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 3.0, 8.6);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const drag4d = new DragRotation4D().attach(renderer.domElement);

scene.add(new AmbientLight(0xffffff, 0.45));
const sun = new DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 5, 4);
scene.add(sun);

const projection = new PerspectiveProjection({ fromDim: 4, viewDistance: 4 });
const slice = HyperplaneSlice4.axisAligned(3, 0);

// The duoprism is rebuilt whenever p, q, or the radius ratio changes;
// render products are recreated with it.
let p = 6;
let q = 4;
let radius2 = 1;
let wireframe: ProjectedEdges3D | null = null;
let section: SlicedComplex3D | null = null;

// Responsive layout: side by side in landscape, stacked in portrait.
let wasPortrait: boolean | null = null;
const layout = (): void => {
  const portrait = window.innerHeight > window.innerWidth;
  wireframe?.object.position.set(portrait ? 0 : -2.6, portrait ? 2.1 : 0, 0);
  section?.object.position.set(portrait ? 0 : 2.6, portrait ? -2.1 : 0, 0);
  if (portrait !== wasPortrait) {
    camera.position.set(0, portrait ? 2.2 : 3.0, portrait ? 11.5 : 8.6);
    wasPortrait = portrait;
  }
};

function rebuild(): void {
  if (wireframe) {
    scene.remove(wireframe.object);
    wireframe.dispose();
  }
  if (section) {
    scene.remove(section.object);
    section.dispose();
  }
  const complex = createDuoprism({ p, q, radius1: 1, radius2 });
  wireframe = new ProjectedEdges3D(complex, projection, {
    material: new LineBasicMaterial({ color: 0x7fd4ff })
  });
  scene.add(wireframe.object);
  section = new SlicedComplex3D(complex, slice);
  scene.add(section.object);
  layout();
}
rebuild();

const bindRange = (id: string, digits: number, onInput: (value: number) => void): void => {
  const input = document.getElementById(id) as HTMLInputElement;
  const label = document.getElementById(`${id}Value`);
  const apply = () => {
    const value = Number(input.value);
    if (label) label.textContent = value.toFixed(digits);
    onInput(value);
  };
  input.addEventListener('input', apply);
  apply();
};

let xySpeed = 0.3;
let zwSpeed = 0.2;
bindRange('pSides', 0, (v) => {
  if (v !== p) {
    p = v;
    rebuild();
  }
});
bindRange('qSides', 0, (v) => {
  if (v !== q) {
    q = v;
    rebuild();
  }
});
bindRange('radius2', 2, (v) => {
  if (v !== radius2) {
    radius2 = v;
    rebuild();
  }
});
bindRange('sliceOffset', 2, (v) => (slice.offset = v));
bindRange('xySpeed', 2, (v) => (xySpeed = v));
bindRange('zwSpeed', 2, (v) => (zwSpeed = v));

setupShowcaseUI({ drag4d });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  layout();
});

let xyAngle = 0;
let zwAngle = 0;
let lastTime = 0;

renderer.setAnimationLoop((timeMs) => {
  const dt = Math.min((timeMs - lastTime) / 1000, 0.1);
  lastTime = timeMs;
  xyAngle += dt * xySpeed;
  zwAngle += dt * zwSpeed;

  controls.enabled = !drag4d.active && drag4d.modifier !== 'none';

  // The duoprism's natural motion is the double rotation in its two
  // defining planes (equal speeds give a Clifford displacement); alt-drag
  // adds rotations through the hidden planes on top.
  const rotor = drag4d.rotor.multiply(
    Rotor4.fromPlanes([
      { i: 0, j: 1, angle: xyAngle }, // xy: spins the p-gon
      { i: 2, j: 3, angle: zwAngle } // zw: spins the q-gon through w
    ])
  );
  const transform = new TransformN(4, rotor);
  wireframe?.update(transform);
  section?.update(transform);
  controls.update();
  renderer.render(scene, camera);
});
