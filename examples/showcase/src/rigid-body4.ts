import {
  AmbientLight,
  Color,
  DirectionalLight,
  LineBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  BivectorN,
  ObjectN,
  PerspectiveProjection,
  SceneN,
  TransformN,
  VecN,
  createHypercube,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import { DragRotation4D, ProjectedEdges3D, ProjectedSurface3D } from '@holotope/three';
import {
  PhysicsWorld4,
  RigidBody4,
  RigidBodyObject4Binding,
  massPropertiesFromCellComplex4,
  rebasePositionsToPrincipalFrame4,
  rotateBivector4
} from '@holotope/physics';
import { setupShowcaseUI } from './ui';

const container = document.getElementById('app')!;
const scene = new Scene();
scene.background = new Color(0x060711);
const camera = new PerspectiveCamera(44, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0.4, 2.7, 8.4);
const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 4;
controls.maxDistance = 20;
const drag4d = new DragRotation4D().attach(renderer.domElement);
setupShowcaseUI({ drag4d });

scene.add(new AmbientLight(0x8aa0cf, 1.3));
const keyLight = new DirectionalLight(0xffffff, 3.5);
keyLight.position.set(4, 6, 8);
scene.add(keyLight);
const rimLight = new DirectionalLight(0x6a75ff, 2.2);
rimLight.position.set(-5, -2, -4);
scene.add(rimLight);

const geometry = tetrahedralizeCuboidCells(createHypercube({ dim: 4, size: 1 }));
const sideLengths = [3.6, 2.2, 1.3, 0.7];
for (let vertex = 0; vertex < geometry.vertexCount; vertex++) {
  for (let axis = 0; axis < 4; axis++) {
    geometry.positions[vertex * 4 + axis]! *= sideLengths[axis]!;
  }
}
const properties = massPropertiesFromCellComplex4(geometry);
geometry.positions = rebasePositionsToPrincipalFrame4(geometry.positions, properties);

const projection = new PerspectiveProjection({ fromDim: 4, viewDistance: 5.8 });
const surface = new ProjectedSurface3D(geometry, projection, {
  material: new MeshStandardMaterial({
    color: 0x547de8,
    emissive: 0x111b42,
    roughness: 0.46,
    metalness: 0.18,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
    flatShading: true
  })
});
const edges = new ProjectedEdges3D(geometry, projection, {
  material: new LineBasicMaterial({
    color: 0xb9ddff,
    transparent: true,
    opacity: 0.95
  })
});
scene.add(surface.object, edges.object);

const ghosts = Array.from({ length: 5 }, (_, index) => {
  const ghost = new ProjectedEdges3D(geometry, projection, {
    material: new LineBasicMaterial({
      color: index % 2 === 0 ? 0x815de8 : 0x54d6c2,
      transparent: true,
      opacity: 0.06 + index * 0.018,
      depthWrite: false
    })
  });
  scene.add(ghost.object);
  return ghost;
});

const physicsScene = new SceneN(4);
const bodyNode = new ObjectN(4);
physicsScene.add(bodyNode);
physicsScene.updateWorld();
const body = RigidBody4.fromMassProperties(properties, { gravityScale: 0 });
const world = new PhysicsWorld4({ gravity: [0, 0, 0, 0] }).addBody(body);
const binding = new RigidBodyObject4Binding(body, bodyNode);

type Preset = 'intermediate' | 'double' | 'generic';
let preset: Preset = 'double';
let paused = false;
let timeScale = 0.8;
let fixedHz = 120;
let accumulator = 0;
let simulationTime = 0;
let nextHistorySample = 0;
let initialEnergy = 1;
let initialMomentumNorm = 1;
let initialAxis = new VecN([0, 0, 1, 0]);
let poseHistory: TransformN[] = [];

function presetVelocityBody(value: Preset): BivectorN {
  switch (value) {
    case 'intermediate':
      return new BivectorN(4, [0.035, 1.85, 0, 0.022, 0, 0]);
    case 'double':
      return new BivectorN(4, [0.06, 1.45, 0.18, -0.08, -0.92, 0.05]);
    case 'generic':
      return new BivectorN(4, [0.42, -0.73, 0.31, 1.08, -0.37, 0.58]);
  }
}

function momentumNorm(): number {
  return Math.hypot(...body.angularMomentumWorld.coeffs);
}

function resetMotion(): void {
  body.position.data.set(properties.centerOfMass.data);
  body.rotation = properties.principalRotor.clone();
  body.linearVelocity.data.fill(0);
  body.angularMomentumWorld.coeffs.fill(0);
  body.clearAccumulators();
  body.setAngularVelocityWorld(
    rotateBivector4(presetVelocityBody(preset), body.rotation)
  );
  binding.snap().apply();
  physicsScene.updateWorld();
  accumulator = 0;
  simulationTime = 0;
  nextHistorySample = 0;
  initialEnergy = body.rotationalKineticEnergy();
  initialMomentumNorm = momentumNorm();
  initialAxis = body.rotation.applyToPoint(new VecN([0, 0, 1, 0]));
  poseHistory = Array.from({ length: ghosts.length }, () => binding.poseAt(1));
  updateModeText();
}

function updateModeText(): void {
  const labels: Record<Preset, string> = {
    intermediate: 'embedded R³ control · only planes 01, 02, 12 are active',
    double: 'full R⁴ motion · complementary planes couple both Spin(4) factors',
    generic: 'full R⁴ motion · all six bivector components are excited'
  };
  document.getElementById('mode')!.textContent = labels[preset];
  const minimum = Math.min(...properties.inertiaDiagonal);
  document.getElementById('inertia')!.textContent =
    'principal-plane inertia 01…23 / min · ' +
    Array.from(properties.inertiaDiagonal, (value) => (value / minimum).toFixed(2))
      .join('  ');
}

function sampleHistory(): void {
  poseHistory.shift();
  poseHistory.push(binding.poseAt(1));
  nextHistorySample += 0.22;
}

function updateDiagnostics(stepCount: number): void {
  const energyDrift =
    (body.rotationalKineticEnergy() - initialEnergy) / initialEnergy;
  const momentumDrift =
    (momentumNorm() - initialMomentumNorm) / initialMomentumNorm;
  const orthogonality = body.rotation.toMatrix().orthogonalityError();
  const omega = body.angularVelocityBody().coeffs;
  document.getElementById('velocity')!.textContent =
    'body angular velocity 01…23 · ' +
    Array.from(omega, (value) => value.toFixed(2)).join('  ');
  document.getElementById('conservation')!.textContent =
    `relative drift · energy ${energyDrift.toExponential(2)} · |L| ${momentumDrift.toExponential(2)} · RᵀR ${orthogonality.toExponential(1)}`;
  const axis = body.rotation.applyToPoint(new VecN([0, 0, 1, 0]));
  document.getElementById('stepState')!.textContent =
    `${paused ? 'paused' : 'running'} · t=${simulationTime.toFixed(2)} s · body-axis correlation ${axis.dot(initialAxis).toFixed(3)} · ${stepCount} fixed steps this frame`;
}

const presetInput = document.getElementById('preset') as HTMLSelectElement;
presetInput.addEventListener('change', () => {
  preset = presetInput.value as Preset;
  resetMotion();
});
const speedInput = document.getElementById('speed') as HTMLInputElement;
speedInput.addEventListener('input', () => {
  timeScale = Number(speedInput.value);
  document.getElementById('speedValue')!.textContent = timeScale.toFixed(2);
});
const fixedInput = document.getElementById('fixedHz') as HTMLSelectElement;
fixedInput.addEventListener('change', () => {
  fixedHz = Number(fixedInput.value);
  accumulator = 0;
});
const viewDistanceInput = document.getElementById('viewDistance') as HTMLInputElement;
viewDistanceInput.addEventListener('input', () => {
  projection.viewDistance = Number(viewDistanceInput.value);
  document.getElementById('viewDistanceValue')!.textContent =
    projection.viewDistance.toFixed(1);
});
const afterimagesInput = document.getElementById('afterimages') as HTMLInputElement;
afterimagesInput.addEventListener('change', () => {
  for (const ghost of ghosts) ghost.object.visible = afterimagesInput.checked;
});
document.getElementById('pause')!.addEventListener('click', () => {
  paused = !paused;
  document.getElementById('pause')!.textContent = paused ? 'resume' : 'pause';
});
document.getElementById('reset')!.addEventListener('click', resetMotion);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

resetMotion();
let lastTime = 0;
renderer.setAnimationLoop((timeMs) => {
  const frameDt = lastTime === 0
    ? 0
    : Math.max(0, Math.min((timeMs - lastTime) / 1000, 0.05));
  lastTime = timeMs;
  controls.enabled = !drag4d.active;

  let stepCount = 0;
  if (!paused) accumulator += frameDt * timeScale;
  const fixedDt = 1 / fixedHz;
  while (accumulator >= fixedDt && stepCount < 12) {
    world.step(fixedDt);
    binding.capture();
    accumulator -= fixedDt;
    simulationTime += fixedDt;
    stepCount++;
    if (simulationTime >= nextHistorySample) sampleHistory();
  }
  if (stepCount === 12 && accumulator >= fixedDt) accumulator = fixedDt;

  binding.apply(paused ? 1 : Math.min(1, accumulator / fixedDt));
  physicsScene.updateWorld();
  const observation = new TransformN(4, drag4d.rotor);
  surface.update(observation.compose(bodyNode.world));
  edges.update(observation.compose(bodyNode.world));
  for (let index = 0; index < ghosts.length; index++) {
    ghosts[index]!.update(observation.compose(poseHistory[index]!));
  }

  updateDiagnostics(stepCount);
  controls.update();
  renderer.render(scene, camera);
});
