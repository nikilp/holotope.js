import { Color, LineBasicMaterial, PerspectiveCamera, Scene } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  ObjectN,
  PerspectiveProjection,
  Rotor4,
  SceneN,
  TransformN,
  VecN,
  create24Cell,
  createCrossPolytope,
  createHypercube,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import { DragRotation4D, ProjectedEdges3D } from '@holotope/three';
import { ProjectedEdgesInstancedGPU } from '@holotope/three/webgpu';
import { setupShowcaseUI } from './ui';

const container = document.getElementById('app')!;

const scene = new Scene();
scene.background = new Color(0x0a0a12);

const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 3.5, 11);

const renderer = new WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);
await renderer.init();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const drag4d = new DragRotation4D().attach(renderer.domElement);

const projection = new PerspectiveProjection({ fromDim: 4, viewDistance: 6 });

// ---- The hierarchy: sun ⟵ planet ⟵ two moons, each orbiting in its
// own 4D plane. World transforms compose down the tree; the render
// products just read node.world each frame.
const root = new SceneN(4);
const sun = new ObjectN(4);
const planet = new ObjectN(4, new TransformN(4, Rotor4.identity(), new VecN([3.2, 0, 0, 0])));
const moonA = new ObjectN(4, new TransformN(4, Rotor4.identity(), new VecN([1.3, 0, 0, 0])));
const moonB = new ObjectN(4, new TransformN(4, Rotor4.identity(), new VecN([0, 0, 1.1, 0])));
root.add(sun);
sun.add(planet);
planet.add(moonA);
planet.add(moonB);

const sunEdges = new ProjectedEdges3D(create24Cell({ radius: 1.1 }), projection, {
  material: new LineBasicMaterial({ color: 0xf2a65a })
});
const planetEdges = new ProjectedEdges3D(
  tetrahedralizeCuboidCells(createHypercube({ dim: 4, size: 1.0 })),
  projection,
  { material: new LineBasicMaterial({ color: 0x7fd4ff }) }
);
const moonEdgesA = new ProjectedEdges3D(createCrossPolytope({ dim: 4, radius: 0.3 }), projection, {
  material: new LineBasicMaterial({ color: 0x6ee7a8 })
});
const moonEdgesB = new ProjectedEdges3D(createCrossPolytope({ dim: 4, radius: 0.3 }), projection, {
  material: new LineBasicMaterial({ color: 0xff6b81 })
});
for (const e of [sunEdges, planetEdges, moonEdgesA, moonEdgesB]) scene.add(e.object);

// ---- The instanced field: one 16-cell geometry, hundreds of rigid
// copies in a single draw call. Instance transforms scatter through a
// 4D shell and spin in individually-phased planes.
const fieldComplex = createCrossPolytope({ dim: 4, radius: 0.22 });
const MAX_INSTANCES = 1024;
let field = new ProjectedEdgesInstancedGPU(fieldComplex, {
  count: MAX_INSTANCES,
  color: 0x2e4468,
  viewDistance: 6
});
scene.add(field.object);

interface Seed {
  offset: VecN;
  plane: [number, number];
  phase: number;
  rate: number;
}
const seeds: Seed[] = [];
{
  // Deterministic scatter: golden-angle sweep over two planes.
  const GA = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < MAX_INSTANCES; i++) {
    const r = 4.2 + 3.6 * ((i * 0.618034) % 1);
    const a = i * GA;
    const b = i * GA * 0.618034;
    seeds.push({
      offset: new VecN([
        r * Math.cos(a) * Math.cos(b),
        r * Math.sin(a) * Math.cos(b),
        r * Math.cos(a) * Math.sin(b),
        r * Math.sin(a) * Math.sin(b)
      ]),
      plane: ([[0, 1], [0, 3], [1, 2], [2, 3]] as const)[i % 4]! as [number, number],
      phase: (i % 32) / 32 * 2 * Math.PI,
      rate: 0.5 + ((i * 0.381966) % 1)
    });
  }
}

const stats = document.getElementById('stats')!;
const edgeCountOf = (n: number): number =>
  n * (fieldComplex.cellsOfDim(1)[0]!.indices.length / 2);

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

let instanceCount = 512;
let orbitSpeed = 0.4;
let fieldSpin = 0.25;
bindRange('instances', 0, (v) => {
  instanceCount = v;
  field.geometry.instanceCount = v;
  stats.textContent = `1 draw call · ${v} instances · ${edgeCountOf(v).toLocaleString()} field edges`;
});
bindRange('orbitSpeed', 2, (v) => (orbitSpeed = v));
bindRange('fieldSpin', 2, (v) => (fieldSpin = v));

setupShowcaseUI({ drag4d });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let time = 0;
let lastTime = 0;
const instanceTransform = new TransformN(4);

renderer.setAnimationLoop((timeMs) => {
  const dt = Math.min((timeMs - lastTime) / 1000, 0.1);
  lastTime = timeMs;
  time += dt;

  controls.enabled = !drag4d.active && drag4d.modifier !== 'none';

  // Shared 4D frame: the user's drag rotor parents everything.
  root.local = new TransformN(4, drag4d.rotor);

  // Hierarchy animation: planet orbits the sun in xw, the moons orbit
  // the planet in yz and xy — each a local rotation, composed by the
  // scene graph into world transforms.
  const orbit = time * orbitSpeed;
  sun.local = new TransformN(4, Rotor4.fromPlanes([{ i: 0, j: 3, angle: orbit }]));
  planet.local = new TransformN(
    4,
    Rotor4.fromPlanes([{ i: 1, j: 2, angle: orbit * 2.3 }]),
    new VecN([3.2, 0, 0, 0])
  );
  moonA.local = new TransformN(
    4,
    Rotor4.fromPlanes([{ i: 0, j: 1, angle: orbit * 4 }]),
    new VecN([1.3, 0, 0, 0])
  );
  moonB.local = new TransformN(
    4,
    Rotor4.fromPlanes([{ i: 2, j: 3, angle: orbit * 3.1 }]),
    new VecN([0, 0, 1.1, 0])
  );
  root.updateWorld();

  sunEdges.update(sun.world);
  planetEdges.update(planet.world);
  moonEdgesA.update(moonA.world);
  moonEdgesB.update(moonB.world);

  // Field: per-instance spin composed with the shared drag frame.
  for (let i = 0; i < instanceCount; i++) {
    const seed = seeds[i]!;
    const rotor = drag4d.rotor.multiply(
      Rotor4.fromPlanes([{ i: seed.plane[0], j: seed.plane[1], angle: seed.phase + time * fieldSpin * seed.rate }])
    );
    instanceTransform.rotation = rotor;
    instanceTransform.position = rotor.applyToPoint(seed.offset);
    field.setInstanceTransform(i, instanceTransform);
  }

  controls.update();
  renderer.render(scene, camera);
});
