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
  coxeterA4,
  coxeterB4,
  coxeterD4,
  coxeterF4,
  coxeterH4,
  createGrandAntiprismCompiled,
  createSnub24CellCompiled,
  createWythoffPolytope,
  fVector,
  type CompiledPolytope,
  type CoxeterDiagram
} from '@holotope/core';
import {
  DragRotation4D,
  ProjectedEdges3D,
  ProjectedSurface3D,
  SlicedComplex3D
} from '@holotope/three';
import { setupShowcaseUI } from './ui';

const container = document.getElementById('app')!;

const scene = new Scene();
scene.background = new Color(0x0a0a12);

const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);

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

const GROUPS: Record<string, () => CoxeterDiagram> = {
  A4: coxeterA4,
  B4: coxeterB4,
  D4: coxeterD4,
  F4: coxeterF4,
  H4: coxeterH4
};

const projection = new PerspectiveProjection({ fromDim: 4, viewDistance: 4 });
const slice = HyperplaneSlice4.axisAligned(3, 0);

// Golden-angle palette over exact tetToCell provenance.
const paletteScratch = new Color();
const cellColor = (cell: number): number =>
  paletteScratch.setHSL((cell * 0.618034) % 1, 0.85, 0.55).getHex();

let wireframe: ProjectedEdges3D | null = null;
let faces: ProjectedSurface3D | null = null;
let section: SlicedComplex3D | null = null;
let compiled: CompiledPolytope | null = null;

const groupSelect = document.getElementById('group') as HTMLSelectElement;
const ringInputs = [0, 1, 2, 3].map((i) => document.getElementById(`ring${i}`) as HTMLInputElement);
const facesToggle = document.getElementById('showFaces') as HTMLInputElement;
const colorCellsToggle = document.getElementById('colorCells') as HTMLInputElement;
const fvectorLabel = document.getElementById('fvector')!;

function rebuild(): void {
  const exceptional = groupSelect.value === 'S24' || groupSelect.value === 'GAP';
  const rings = ringInputs.map((input) => input.checked);
  for (const input of ringInputs) input.disabled = exceptional;
  if (!exceptional && !rings.some(Boolean)) {
    fvectorLabel.textContent = 'ring at least one mirror';
    return;
  }
  for (const product of [wireframe, faces, section]) {
    if (product) {
      scene.remove(product.object);
      product.dispose();
    }
  }
  compiled = exceptional
    ? groupSelect.value === 'S24'
      ? createSnub24CellCompiled({ radius: 1.5 })
      : createGrandAntiprismCompiled({ radius: 1.5 })
    : createWythoffPolytope(GROUPS[groupSelect.value]!(), rings, { radius: 1.5 });
  const { complex, lattice, tetrahedralization } = compiled;
  const f = fVector(lattice);
  fvectorLabel.textContent = `(${f.join(', ')})  ·  ${tetrahedralization.indices.length / 4} tets`;

  wireframe = new ProjectedEdges3D(complex, projection, {
    material: new LineBasicMaterial({ color: 0x7fd4ff })
  });
  scene.add(wireframe.object);

  faces = new ProjectedSurface3D(complex, projection);
  faces.object.visible = facesToggle.checked;
  scene.add(faces.object);

  section = new SlicedComplex3D(complex, slice, {
    material: new MeshStandardMaterial({
      color: colorCellsToggle.checked ? 0xffffff : 0xff9d5c,
      side: DoubleSide,
      flatShading: true,
      vertexColors: colorCellsToggle.checked
    }),
    // Exact provenance: tetToCell comes straight from the face lattice.
    colorForTet: (tet) => cellColor(tetrahedralization.tetToCell[tet]!)
  });
  scene.add(section.object);
  layout();
}

// Responsive layout: side by side in landscape, stacked in portrait.
let wasPortrait: boolean | null = null;
const layout = (): void => {
  const portrait = window.innerHeight > window.innerWidth;
  wireframe?.object.position.set(portrait ? 0 : -2.4, portrait ? 2.1 : 0, 0);
  faces?.object.position.copy(wireframe!.object.position);
  section?.object.position.set(portrait ? 0 : 2.4, portrait ? -2.1 : 0, 0);
  if (portrait !== wasPortrait) {
    camera.position.set(0, portrait ? 2.2 : 2.8, portrait ? 11.5 : 8.6);
    wasPortrait = portrait;
  }
};

groupSelect.addEventListener('change', rebuild);
for (const input of ringInputs) input.addEventListener('change', rebuild);
facesToggle.addEventListener('change', () => {
  if (faces) faces.object.visible = facesToggle.checked;
});
colorCellsToggle.addEventListener('change', () => {
  if (!section) return;
  const material = section.object.material as MeshStandardMaterial;
  material.vertexColors = colorCellsToggle.checked;
  material.color.setHex(colorCellsToggle.checked ? 0xffffff : 0xff9d5c);
  material.needsUpdate = true;
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
rebuild();

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
  wireframe?.update(transform);
  if (faces?.object.visible) faces.update(transform);
  section?.update(transform);
  controls.update();
  renderer.render(scene, camera);
});
