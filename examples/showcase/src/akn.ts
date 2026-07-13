import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  Vector3,
  WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import {
  aknPatch,
  createAKNModelSet,
  phiRing,
  type AKNPhasonOffset,
  type AKNPatch
} from '@holotope/core';
import { setupShowcaseUI } from './ui';

const container = document.getElementById('app')!;
const scene = new Scene();
scene.background = new Color(0x080910);
const camera = new PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 1.1, 14);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);

const physicalGroup = new Group();
const internalGroup = new Group();
physicalGroup.position.x = -3.9;
internalGroup.position.x = 3.9;
scene.add(physicalGroup, internalGroup);

const model = createAKNModelSet();
let patch: AKNPatch;
let patchRadius = 5;
let spin = 0.12;
let showEdges = true;
let showWindow = true;
let phason = 'centered';

const exact = (a: bigint, b = 0n) => ({ a, b });
const PHASON_PRESETS: Record<string, AKNPhasonOffset | undefined> = {
  centered: undefined,
  regular: [exact(1n), exact(1n), exact(2n)],
  east: [exact(2n), exact(1n), exact(2n)],
  skew: [exact(1n), exact(-1n), exact(2n)]
};

function disposeGroup(group: Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    const object = child as Mesh | Points | LineSegments;
    object.geometry?.dispose();
    const material = object.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose();
  }
}

function colorsForPatch(): Float32Array {
  const colors = new Float32Array(patch.points.length * 3);
  const color = new Color();
  for (let i = 0; i < patch.points.length; i++) {
    const [x, y, z] = patch.points[i]!.perpendicular;
    const hue = (Math.atan2(y!, x!) / (2 * Math.PI) + 1) % 1;
    const light = 0.52 + 0.18 * Math.tanh(z! * 0.7);
    color.setHSL(hue, 0.82, light).toArray(colors, i * 3);
  }
  return colors;
}

function pointGeometry(space: 'parallel' | 'perpendicular', colors: Float32Array): BufferGeometry {
  const positions = new Float32Array(patch.points.length * 3);
  for (let i = 0; i < patch.points.length; i++) {
    const source = space === 'parallel' ? patch.points[i]!.parallel : patch.points[i]!.perpendicular;
    positions.set(source, i * 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors.slice(), 3));
  return geometry;
}

function windowVertices(): Vector3[] {
  const generators = Array.from({ length: 6 }, (_, column) =>
    model.flat.perpendicularProjection.map((row) => phiRing.toNumber(row[column]!))
  );
  return Array.from({ length: 64 }, (_, mask) => {
    const point = [0, 0, 0];
    for (let generator = 0; generator < 6; generator++) {
      const sign = (mask & (1 << generator)) === 0 ? -0.5 : 0.5;
      for (let axis = 0; axis < 3; axis++) point[axis]! += sign * generators[generator]![axis]!;
    }
    return new Vector3(point[0]!, point[1]!, point[2]!);
  });
}

function rebuild(): void {
  const phasonOffset = PHASON_PRESETS[phason];
  patch = aknPatch({
    coefficientRadius: 2,
    physicalRadius: patchRadius,
    ...(phasonOffset === undefined ? {} : { phasonOffsetSevenths: phasonOffset })
  });
  disposeGroup(physicalGroup);
  disposeGroup(internalGroup);
  const colors = colorsForPatch();

  const physicalGeometry = pointGeometry('parallel', colors);
  const physicalPoints = new Points(
    physicalGeometry,
    new PointsMaterial({ size: 0.085, sizeAttenuation: true, vertexColors: true })
  );
  physicalPoints.frustumCulled = false;
  physicalGroup.add(physicalPoints);
  const edgeGeometry = pointGeometry('parallel', colors);
  edgeGeometry.setIndex(new BufferAttribute(patch.edges, 1));
  const physicalEdges = new LineSegments(
    edgeGeometry,
    new LineBasicMaterial({ color: 0x6780ad, transparent: true, opacity: 0.28 })
  );
  physicalEdges.visible = showEdges;
  physicalEdges.frustumCulled = false;
  physicalGroup.add(physicalEdges);

  const internalPoints = new Points(
    pointGeometry('perpendicular', colors),
    new PointsMaterial({ size: 0.06, sizeAttenuation: true, vertexColors: true })
  );
  internalPoints.renderOrder = 2;
  internalPoints.frustumCulled = false;
  internalGroup.add(internalPoints);

  const hull = new ConvexGeometry(windowVertices());
  const windowMesh = new Mesh(
    hull,
    new MeshBasicMaterial({
      color: 0x63e6ff,
      transparent: true,
      opacity: 0.055,
      depthWrite: false,
      side: DoubleSide
    })
  );
  windowMesh.visible = showWindow;
  internalGroup.add(windowMesh);
  const windowEdges = new LineSegments(
    new EdgesGeometry(hull, 1),
    new LineBasicMaterial({ color: 0x63e6ff, transparent: true, opacity: 0.58 })
  );
  windowEdges.visible = showWindow;
  internalGroup.add(windowEdges);

  physicalGroup.scale.setScalar(3.15 / patchRadius);
  const internalRadius = Math.max(...windowVertices().map((point) => point.length()));
  internalGroup.scale.setScalar(2.75 / internalRadius);
  document.getElementById('stats')!.textContent =
    `${patch.points.length} vertices · ${patch.edges.length / 2} visible edges · ${patch.boundaryCount} exact boundary hits`;
}

const phasonInput = document.getElementById('phason') as HTMLSelectElement;
phasonInput.addEventListener('change', () => {
  phason = phasonInput.value;
  rebuild();
});
phason = phasonInput.value;

const radiusInput = document.getElementById('radius') as HTMLInputElement;
const radiusValue = document.getElementById('radiusValue')!;
radiusInput.addEventListener('input', () => {
  patchRadius = Number(radiusInput.value);
  radiusValue.textContent = patchRadius.toFixed(1);
  rebuild();
});
patchRadius = Number(radiusInput.value);
radiusValue.textContent = patchRadius.toFixed(1);

const spinInput = document.getElementById('spin') as HTMLInputElement;
const spinValue = document.getElementById('spinValue')!;
spinInput.addEventListener('input', () => {
  spin = Number(spinInput.value);
  spinValue.textContent = spin.toFixed(2);
});
spin = Number(spinInput.value);
spinValue.textContent = spin.toFixed(2);

const edgesInput = document.getElementById('edges') as HTMLInputElement;
edgesInput.addEventListener('change', () => {
  showEdges = edgesInput.checked;
  if (physicalGroup.children[1]) physicalGroup.children[1].visible = showEdges;
});
showEdges = edgesInput.checked;

const windowInput = document.getElementById('window') as HTMLInputElement;
windowInput.addEventListener('change', () => {
  showWindow = windowInput.checked;
  for (const child of internalGroup.children.slice(1)) child.visible = showWindow;
});
showWindow = windowInput.checked;

setupShowcaseUI();
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

rebuild();
let lastTime = 0;
renderer.setAnimationLoop((timeMs) => {
  const dt = Math.min((timeMs - lastTime) / 1000, 0.1);
  lastTime = timeMs;
  physicalGroup.rotation.y += dt * spin;
  internalGroup.rotation.y += dt * spin;
  physicalGroup.rotation.x = internalGroup.rotation.x = -0.18;
  controls.update();
  renderer.render(scene, camera);
});
