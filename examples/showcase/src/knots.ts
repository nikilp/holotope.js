import { Color, LineBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  PerspectiveProjection,
  Rotor4,
  TransformN,
  createCliffordCurve,
  createDuoprism
} from '@holotope/core';
import { DragRotation4D, ProjectedEdges3D } from '@holotope/three';
import { setupShowcaseUI } from './ui';

const container = document.getElementById('app')!;

const scene = new Scene();
scene.background = new Color(0x0a0a12);

const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 2.0, 6.4);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const drag4d = new DragRotation4D().attach(renderer.domElement);

const projection = new PerspectiveProjection({ fromDim: 4, viewDistance: 4 });
const radius = 1.6;

// The knot polyline and, behind it, the ghost of the p×q duoprism whose
// vertices the knot threads through — the discrete and continuous faces
// of the same Clifford-torus construction.
let p = 2;
let q = 3;
let knot: ProjectedEdges3D | null = null;
let ghost: ProjectedEdges3D | null = null;

function rebuild(): void {
  if (knot) {
    scene.remove(knot.object);
    knot.dispose();
  }
  if (ghost) {
    scene.remove(ghost.object);
    ghost.dispose();
  }
  knot = new ProjectedEdges3D(createCliffordCurve({ p, q, radius, segments: 512 }), projection, {
    material: new LineBasicMaterial({ color: 0xf2a65a })
  });
  scene.add(knot.object);
  // Polygons need at least 3 sides, so the ghost only exists for p, q ≥ 3
  // (the (2, 3) trefoil has a knot but no duoprism).
  ghost = null;
  if (p >= 3 && q >= 3) {
    const r = radius / Math.SQRT2;
    ghost = new ProjectedEdges3D(createDuoprism({ p, q, radius1: r, radius2: r }), projection, {
      material: new LineBasicMaterial({ color: 0x2e4468 })
    });
    ghost.object.visible = ghostToggle.checked;
    scene.add(ghost.object);
  }
}

const bindRange = (id: string, onInput: (value: number) => void): void => {
  const input = document.getElementById(id) as HTMLInputElement;
  const label = document.getElementById(`${id}Value`);
  const apply = () => {
    const value = Number(input.value);
    if (label) label.textContent = Number.isInteger(value) ? String(value) : value.toFixed(2);
    onInput(value);
  };
  input.addEventListener('input', apply);
  apply();
};

const ghostToggle = document.getElementById('showGhost') as HTMLInputElement;
ghostToggle.addEventListener('change', () => {
  if (ghost) ghost.object.visible = ghostToggle.checked;
});

let xySpeed = 0.3;
let zwSpeed = 0.3;
bindRange('pWind', (v) => {
  if (v !== p) {
    p = v;
    rebuild();
  }
});
bindRange('qWind', (v) => {
  if (v !== q) {
    q = v;
    rebuild();
  }
});
bindRange('xySpeed', (v) => (xySpeed = v));
bindRange('zwSpeed', (v) => (zwSpeed = v));
rebuild();

setupShowcaseUI({ drag4d });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
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

  // Equal xy/zw speeds give the isoclinic Clifford displacement, whose
  // flow is tangent to the knot — it visibly slides along itself.
  const rotor = drag4d.rotor.multiply(
    Rotor4.fromPlanes([
      { i: 0, j: 1, angle: xyAngle },
      { i: 2, j: 3, angle: zwAngle }
    ])
  );
  const transform = new TransformN(4, rotor);
  knot?.update(transform);
  if (ghost?.object.visible) ghost.update(transform);
  controls.update();
  renderer.render(scene, camera);
});
