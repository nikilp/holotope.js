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
  CameraN,
  HyperplaneSlice4,
  PerspectiveProjection,
  Rotor4,
  TransformN,
  VecN,
  create24Cell,
  createCrossPolytope,
  createHypercube,
  createSimplex,
  tetrahedralizeCuboidCells,
  type CellComplex
} from '@holotope/core';
import { DragRotation4D, ProjectedEdges3D, SlicedComplex3D } from '@holotope/three';

const container = document.getElementById('app')!;

const scene = new Scene();
scene.background = new Color(0x0a0a12);

const camera3 = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera3.position.set(0, 0.6, 13.5);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera3, renderer.domElement);
controls.enableDamping = true;

const drag4d = new DragRotation4D().attach(renderer.domElement);

scene.add(new AmbientLight(0xffffff, 0.45));
const sun = new DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 5, 4);
scene.add(sun);

// The four regular polychora we can build so far, all sliceable.
const polychora: Array<{ complex: CellComplex; color: number }> = [
  { complex: createSimplex({ dim: 4, edgeLength: 2 }), color: 0xff6b81 },
  { complex: createCrossPolytope({ dim: 4, radius: 1.3 }), color: 0x7fd4ff },
  { complex: tetrahedralizeCuboidCells(createHypercube({ dim: 4, size: 2 })), color: 0xffd166 },
  { complex: create24Cell({ radius: 1.3 }), color: 0x9b8cff }
];

// One 4D camera views all projections; sections share the same 4D rotation.
const camera4 = new CameraN(4);
const cameraDistance = 2.5;
const projection = new PerspectiveProjection({ fromDim: 4, viewDistance: 4 });
const slice = HyperplaneSlice4.axisAligned(3, 0);

const columnX = [-5.4, -1.8, 1.8, 5.4];
const wireframes = polychora.map(({ complex, color }, i) => {
  const edges = new ProjectedEdges3D(complex, projection, {
    material: new LineBasicMaterial({ color })
  });
  edges.object.position.set(columnX[i]!, 1.9, 0);
  scene.add(edges.object);
  return edges;
});
const sections = polychora.map(({ complex, color }, i) => {
  const section = new SlicedComplex3D(complex, slice, {
    material: new MeshStandardMaterial({ color, side: DoubleSide, flatShading: true })
  });
  section.object.position.set(columnX[i]!, -1.9, 0);
  scene.add(section.object);
  return section;
});

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

window.addEventListener('resize', () => {
  camera3.aspect = window.innerWidth / window.innerHeight;
  camera3.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let xwAngle = 0;
let yzAngle = 0;
let lastTime = 0;
const origin4 = new VecN(4);

renderer.setAnimationLoop((timeMs) => {
  const dt = Math.min((timeMs - lastTime) / 1000, 0.1);
  lastTime = timeMs;
  xwAngle += dt * xwSpeed;
  yzAngle += dt * yzSpeed;

  controls.enabled = !drag4d.active;

  // Shared 4D rotation: user drag composed with the auto-rotation.
  const rotor = drag4d.rotor.multiply(
    Rotor4.fromPlanes([
      { i: 0, j: 3, angle: xwAngle },
      { i: 1, j: 2, angle: yzAngle }
    ])
  );

  // Top row: orbit the 4D camera (inverse rotor keeps its apparent motion
  // in the same direction as the section rotation below).
  camera4.position = rotor.conjugate().applyToPoint(new VecN([0, 0, 0, cameraDistance]));
  camera4.lookAt(origin4);
  const view = camera4.viewTransform();
  for (const wireframe of wireframes) wireframe.update(view);

  // Bottom row: rotate the objects and slice them with the fixed hyperplane.
  const objectTransform = new TransformN(4, rotor);
  for (const section of sections) section.update(objectTransform);

  controls.update();
  renderer.render(scene, camera3);
});
