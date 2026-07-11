import {
  BufferAttribute,
  BufferGeometry,
  Color,
  LineBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  PerspectiveProjection,
  Rotor4,
  TransformN,
  createHopfFiber
} from '@holotope/core';
import { DragRotation4D, ProjectedEdges3D } from '@holotope/three';
import { setupShowcaseUI } from './ui';

const container = document.getElementById('app')!;

const scene = new Scene();
scene.background = new Color(0x0a0a12);

const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 4.5, 13);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const drag4d = new DragRotation4D().attach(renderer.domElement);

// Stereographic projection of S³ from its pole: iterated perspective
// with the view point on the sphere itself. viewDistance sits slightly
// outside the radius so fibers passing near the pole stay finite.
const radius = 1.5;
const projection = new PerspectiveProjection({ fromDim: 4, viewDistance: radius * 1.12 });

let fibers: ProjectedEdges3D[] = [];
const paletteScratch = new Color();

// The isoclinic flow maps every fiber to itself, so the projected
// circles are pointwise stationary — invisible motion. One bright bead
// per fiber, carried by the same transform, makes the flow observable:
// beads stream along circles that never move.
let beadSeeds = new Float64Array(0);
let beadWorld = new Float64Array(0);
const beadGeometry = new BufferGeometry();
let beadAttribute = new BufferAttribute(new Float32Array(0), 3);
const beads = new Points(
  beadGeometry,
  new PointsMaterial({ color: 0xffffff, size: 0.09, sizeAttenuation: true })
);
beads.frustumCulled = false;
scene.add(beads);

function rebuild(latitudes: number, fibersEach: number): void {
  for (const f of fibers) {
    scene.remove(f.object);
    f.dispose();
  }
  fibers = [];
  // Base points on latitude rings of S², kept away from the projection
  // pole's antipode so no fiber blows up through infinity.
  for (let ring = 0; ring < latitudes; ring++) {
    const zBase = -0.85 + (1.55 * (ring + 0.5)) / latitudes;
    const rBase = Math.sqrt(1 - zBase * zBase);
    for (let k = 0; k < fibersEach; k++) {
      const phi = (k / fibersEach) * 2 * Math.PI;
      const base: [number, number, number] = [rBase * Math.cos(phi), rBase * Math.sin(phi), zBase];
      // Color = base point: hue from longitude, lightness from latitude.
      const color = paletteScratch
        .setHSL(phi / (2 * Math.PI), 0.8, 0.4 + 0.25 * (zBase + 0.85) / 1.55)
        .getHex();
      const complex = createHopfFiber({ base, radius, segments: 128 });
      const fiber = new ProjectedEdges3D(complex, projection, {
        material: new LineBasicMaterial({ color })
      });
      scene.add(fiber.object);
      fibers.push(fiber);
    }
  }
  // One bead seed per fiber: its θ = 0 point.
  beadSeeds = new Float64Array(fibers.length * 4);
  for (let f = 0; f < fibers.length; f++) {
    beadSeeds.set(fibers[f]!.complex.positions.subarray(0, 4), f * 4);
  }
  beadWorld = new Float64Array(fibers.length * 4);
  beadAttribute = new BufferAttribute(new Float32Array(fibers.length * 3), 3);
  beadGeometry.setAttribute('position', beadAttribute);
}

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

let latitudes = 4;
let fibersEach = 10;
let spin = 0.2;
bindRange('latitudes', 0, (v) => {
  latitudes = v;
  rebuild(latitudes, fibersEach);
});
bindRange('fibersEach', 0, (v) => {
  fibersEach = v;
  rebuild(latitudes, fibersEach);
});
bindRange('spin', 2, (v) => (spin = v));

setupShowcaseUI({ drag4d });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let angle = 0;
let lastTime = 0;

renderer.setAnimationLoop((timeMs) => {
  const dt = Math.min((timeMs - lastTime) / 1000, 0.1);
  lastTime = timeMs;
  angle += dt * spin;

  controls.enabled = !drag4d.active && drag4d.modifier !== 'none';

  // The equal-angle double rotation is the fiber flow itself: every
  // Hopf circle maps to itself, sliding along its own length, so the
  // projected picture is stationary until a 4D drag tilts the pole.
  const transform = new TransformN(
    4,
    drag4d.rotor.multiply(
      Rotor4.fromPlanes([
        { i: 0, j: 1, angle },
        { i: 2, j: 3, angle }
      ])
    )
  );
  for (const fiber of fibers) fiber.update(transform);
  // Beads: same transform, one point per fiber — the visible flow.
  transform.applyToPositions(beadSeeds, beadWorld, fibers.length);
  projection.projectPositions(beadWorld, fibers.length, beadAttribute.array as Float32Array);
  beadAttribute.needsUpdate = true;
  controls.update();
  renderer.render(scene, camera);
});
