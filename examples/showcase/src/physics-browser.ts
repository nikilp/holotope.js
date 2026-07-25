/**
 * Embeddable viewer for simulation on source state, selected by URL fragment:
 *
 *   physics-browser.html#RigidBody4
 *
 * The body tumbles in R⁴ under no torque. A projected wireframe and an exact
 * cross-section are drawn from the same pose, and neither is the simulation:
 * the integrator never reads them, and switching the section on or off changes
 * nothing it computes.
 *
 * The claim is checkable rather than asserted. Torque-free motion conserves
 * angular momentum and rotational energy exactly, so the panel reports their
 * relative drift and the orthogonality error of the accumulated rotation.
 * Those figures stay at rounding error while the body visibly tumbles, which
 * is what distinguishes a simulation from an animation of one.
 */
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
  BivectorN,
  HyperplaneSlice4,
  ObjectN,
  PerspectiveProjection,
  SceneN,
  createHypercube,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import {
  PhysicsWorld4,
  RigidBody4,
  RigidBodyObject4Binding,
  massPropertiesFromCellComplex4,
  rotateBivector4
} from '@holotope/physics';
import { ProjectedEdges3D, SlicedComplex3D } from '@holotope/three';
import {
  type Param,
  type Values,
  bindControls,
  reportCounts,
  reportFailure,
  selectedEntry,
  setTitle
} from './viewer-ui';

/**
 * One scene serves each symbol; the entry names which part of it the reader
 * arrived for, so the panel says what this page's symbol contributes.
 */
const SPECS: Record<string, { readonly role: string }> = {
  RigidBody4: { role: 'state: momentum and orientation in R⁴' },
  PhysicsWorld4: { role: 'fixed-step integration of that state' },
  RigidBodyObject4Binding: { role: 'pose handed across the adapter boundary' }
};

const selected = selectedEntry('RigidBody4');
const registered = SPECS[selected];
if (!registered) {
  reportFailure(`No viewer is registered for "${selected}".`);
  throw new Error(`physics-browser: unknown entry ${selected}`);
}
const spec = registered;
setTitle(selected);

// --- source and simulation ---------------------------------------------------
const geometry = tetrahedralizeCuboidCells(createHypercube({ dim: 4, size: 1 }));
const properties = massPropertiesFromCellComplex4(geometry);

const physicsScene = new SceneN(4);
const node = new ObjectN(4);
physicsScene.add(node);
physicsScene.updateWorld();

const body = RigidBody4.fromMassProperties(properties, { gravityScale: 0 });
const world = new PhysicsWorld4({ gravity: [0, 0, 0, 0] }).addBody(body);
const binding = new RigidBodyObject4Binding(body, node);

/**
 * Angular velocities in the body frame. R⁴ rotation has six plane components,
 * so a spin can occupy one invariant plane, two at once, or neither cleanly —
 * the last being where the tumble is least periodic.
 */
const SPINS: Record<string, readonly number[]> = {
  'single plane': [0.02, 1.85, 0, 0.02, 0, 0],
  'double rotation': [0.06, 1.45, 0.18, -0.08, -0.92, 0.05],
  generic: [0.44, 1.12, -0.63, 0.28, -0.71, 0.35]
};

let referenceEnergy = 1;
let referenceMomentum = 1;
let elapsed = 0;

const momentumNorm = (): number => Math.hypot(...body.angularMomentumWorld.coeffs);

function restart(spin: string): void {
  // Start in the principal frame, where the inertia is diagonal and the spin
  // components below name invariant planes rather than arbitrary ones.
  body.rotation = properties.principalRotor.clone();
  body.angularMomentumWorld.coeffs.fill(0);
  body.clearAccumulators();
  const bodySpin = new BivectorN(4, SPINS[spin] ?? SPINS['double rotation']!);
  body.setAngularVelocityWorld(rotateBivector4(bodySpin, body.rotation));
  binding.snap().apply();
  physicsScene.updateWorld();
  referenceEnergy = body.rotationalKineticEnergy();
  referenceMomentum = momentumNorm();
  elapsed = 0;
}

// --- observation -------------------------------------------------------------
const projection = new PerspectiveProjection({ fromDim: 4, viewDistance: 3.6 });
const slice = HyperplaneSlice4.axisAligned(3, 0);

const wireframe = new ProjectedEdges3D(geometry, projection, {
  material: new LineBasicMaterial({ color: 0x6f86bb })
});
const section = new SlicedComplex3D(geometry, slice, { projection });

const container = document.getElementById('app')!;
const scene = new Scene();
scene.background = new Color(0x0a0a12);
scene.add(wireframe.object, section.object);
scene.add(new AmbientLight(0xffffff, 0.55));
const sun = new DirectionalLight(0xffffff, 2.0);
sun.position.set(3, 5, 4);
scene.add(sun);

const camera = new PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 0, 4.4);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;

const PARAMS: readonly Param[] = [
  { kind: 'choice', name: 'spin', label: 'spin', options: Object.keys(SPINS), value: 'double rotation' },
  { kind: 'toggle', name: 'section', label: 'show section', value: true },
  { kind: 'toggle', name: 'running', label: 'running', value: true }
];
// Only a change of spin restarts. Showing or hiding the section must leave
// the trajectory untouched — that is the claim the viewer exists to make, and
// a control that silently reset it would contradict the panel beside it.
let activeSpin = 'double rotation';
const values: Values = bindControls(PARAMS, () => {
  const chosen = values.choice('spin');
  if (chosen === activeSpin) return;
  activeSpin = chosen;
  restart(chosen);
});

restart(activeSpin);

// --- loop --------------------------------------------------------------------
function resize(): void {
  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const FIXED_DT = 1 / 120;
let accumulator = 0;
let previous = performance.now();
let sinceReport = 0;

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const frame = Math.min((now - previous) / 1000, 0.1);
  previous = now;
  orbit.update();

  if (values.toggle('running')) accumulator += frame;

  // Fixed steps, so the trajectory does not depend on frame rate; the
  // remainder is used to interpolate the pose handed to the renderer.
  let steps = 0;
  while (accumulator >= FIXED_DT && steps < 12) {
    world.step(FIXED_DT);
    binding.capture();
    accumulator -= FIXED_DT;
    elapsed += FIXED_DT;
    steps++;
  }
  binding.apply(values.toggle('running') ? Math.min(1, accumulator / FIXED_DT) : 1);
  physicsScene.updateWorld();

  // Both products read the same pose. The simulation produced it without
  // consulting either.
  const pose = node.world;
  wireframe.update(pose);
  section.object.visible = values.toggle('section');
  if (section.object.visible) section.update(pose);

  if (++sinceReport >= 10) {
    sinceReport = 0;
    const energyDrift = (body.rotationalKineticEnergy() - referenceEnergy) / referenceEnergy;
    const momentumDrift = (momentumNorm() - referenceMomentum) / referenceMomentum;
    reportCounts([
      [elapsed.toFixed(1) + ' s', 'simulated'],
      [energyDrift.toExponential(1), 'energy drift'],
      [momentumDrift.toExponential(1), '|L| drift'],
      [body.rotation.toMatrix().orthogonalityError().toExponential(1), 'RᵀR error'],
      [section.object.visible ? 'shown' : 'hidden', 'section — unread by the solver'],
      ['', spec.role]
    ]);
  }

  renderer.render(scene, camera);
});
