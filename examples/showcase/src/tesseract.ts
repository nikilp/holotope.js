import {
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  HyperplaneSlice4,
  PerspectiveProjection,
  Rotor4,
  TransformN,
  VecN,
  createHypercube,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import {
  DragRotation4D,
  ProjectedEdges3D,
  ProjectedSurface3D,
  SlicedComplex3D
} from '@holotope/three';

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

// The projected 2-faces as a translucent shaded skin over the wireframe.
const faces = new ProjectedSurface3D(tesseract, projection);
faces.object.position.x = -2.6;
faces.object.visible = false;
scene.add(faces.object);

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

// Picking: click the cross-section (either view) to highlight the cubic
// cell of the tesseract it came from. The highlight shares the wireframe's
// projected position attribute, so it follows the rotation for free; only
// its index (the selected cube's 12 edges) changes on click.
const CUBE_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3],
  [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]
];
// The cube's 6 quad faces (local bit indices), pre-split into triangles.
const CUBE_FACE_TRIANGLES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 3], [0, 3, 2], [4, 5, 7], [4, 7, 6],
  [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6],
  [0, 2, 6], [0, 6, 4], [1, 3, 7], [1, 7, 5]
];
const cuboids = tesseract.cellsOfDim(3).find((g) => g.kind === 'cuboid')!;
const highlightGeometry = new BufferGeometry();
highlightGeometry.setAttribute('position', wireframe.geometry.getAttribute('position'));
highlightGeometry.setIndex([]);
const highlight = new LineSegments(highlightGeometry, new LineBasicMaterial({ color: 0xffffff }));
highlight.position.copy(wireframe.object.position);
highlight.frustumCulled = false;
scene.add(highlight);

// Translucent fill of the selected cell's faces — shares the same projected
// position attribute, so it tracks the 4D rotation like the edge highlight.
const highlightFillGeometry = new BufferGeometry();
highlightFillGeometry.setAttribute('position', wireframe.geometry.getAttribute('position'));
highlightFillGeometry.setIndex([]);
const highlightFill = new Mesh(
  highlightFillGeometry,
  new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.3,
    side: DoubleSide,
    depthWrite: false
  })
);
highlightFill.position.copy(wireframe.object.position);
highlightFill.frustumCulled = false;
scene.add(highlightFill);

const wireframeMaterial = wireframe.object.material as LineBasicMaterial;

const highlightCube = (cube: number | null): void => {
  if (cube === null) {
    highlightGeometry.setIndex([]);
    highlightFillGeometry.setIndex([]);
    wireframeMaterial.color.setHex(0x7fd4ff);
    return;
  }
  const base = cube * 8;
  const edgeIndices: number[] = [];
  for (const [a, b] of CUBE_EDGES) {
    edgeIndices.push(cuboids.indices[base + a]!, cuboids.indices[base + b]!);
  }
  highlightGeometry.setIndex(edgeIndices);
  const faceIndices: number[] = [];
  for (const [a, b, c] of CUBE_FACE_TRIANGLES) {
    faceIndices.push(cuboids.indices[base + a]!, cuboids.indices[base + b]!, cuboids.indices[base + c]!);
  }
  highlightFillGeometry.setIndex(faceIndices);
  // Dim the rest of the wireframe so the selected cell stands out.
  wireframeMaterial.color.setHex(0x33566e);
};

const raycaster = new Raycaster();
const pointerNdc = new Vector2();
let downX = 0;
let downY = 0;
renderer.domElement.addEventListener('pointerdown', (e) => {
  downX = e.clientX;
  downY = e.clientY;
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.altKey || Math.hypot(e.clientX - downX, e.clientY - downY) > 4) return;
  pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointerNdc, camera);
  const hit = raycaster
    .intersectObjects([section.object, overlay.object], false)
    .find((h) => h.faceIndex !== undefined && h.object.visible);
  if (!hit) {
    highlightCube(null);
    return;
  }
  const product = hit.object === section.object ? section : overlay;
  const tet = product.sourceTetOfFace(hit.faceIndex!);
  // tetrahedralizeCuboidCells emits 6 Kuhn tets per cube, cube-major.
  highlightCube(Math.floor(tet / 6));
});

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

// Tilt the cutting hyperplane away from w-aligned: rotate e_w through the
// xw and zw planes and hand the result to setNormal, which rebuilds the
// slice's display frame in place — both section views pick it up live.
let tiltXw = 0;
let tiltZw = 0;
const applyTilt = (): void => {
  const normal = Rotor4.fromPlanes([
    { i: 0, j: 3, angle: tiltXw },
    { i: 2, j: 3, angle: tiltZw }
  ]).applyToPoint(VecN.basis(4, 3));
  slice.setNormal(normal);
};
bindRange('tiltXw', (v) => {
  tiltXw = v;
  applyTilt();
});
bindRange('tiltZw', (v) => {
  tiltZw = v;
  applyTilt();
});
bindRange('xwSpeed', (v) => (xwSpeed = v));
bindRange('yzSpeed', (v) => (yzSpeed = v));

const bindToggle = (id: string, onChange: (checked: boolean) => void): void => {
  const input = document.getElementById(id) as HTMLInputElement;
  input.addEventListener('change', () => onChange(input.checked));
  onChange(input.checked);
};
bindToggle('showWireframe', (on) => (wireframe.object.visible = on));
bindToggle('showFaces', (on) => (faces.object.visible = on));
bindToggle('showSlice', (on) => (section.object.visible = on));
bindToggle('showOverlay', (on) => (overlay.object.visible = on));

// Smoothly slerp the accumulated 4D drag back to identity — the isoclinic
// interpolation is the geodesic in SO(4), so the return path is the
// straightest possible 4D rotation.
let resetAnimation: { from: Rotor4; start: number } | null = null;
document.getElementById('resetRotation')!.addEventListener('click', () => {
  resetAnimation = { from: drag4d.rotor.clone(), start: performance.now() };
});

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

  if (resetAnimation) {
    const t = Math.min((timeMs - resetAnimation.start) / 800, 1);
    const eased = 1 - (1 - t) ** 3;
    drag4d.rotor = Rotor4.slerp(resetAnimation.from, Rotor4.identity(), eased);
    if (t >= 1) resetAnimation = null;
  }

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
  if (faces.object.visible) faces.update(transform);
  section.update(transform);
  overlay.update(transform);
  controls.update();
  renderer.render(scene, camera);
});
