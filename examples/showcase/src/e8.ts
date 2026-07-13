import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
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
  Rotor4Track,
  TransformN,
  createElserSloaneGermComplex,
  createFoldedE8Roots,
  createFoldedE8Shells,
  elserSloaneGerm,
  icosianE8Data,
  type PhiEmbedding
} from '@holotope/core';
import { DragRotation4D, ProjectedEdges3D } from '@holotope/three';
import { setupShowcaseUI } from './ui';

const container = document.getElementById('app')!;
const scene = new Scene();
scene.background = new Color(0x080910);

const camera = new PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0.4, 13);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
const drag4d = new DragRotation4D().attach(renderer.domElement);
const projection = new PerspectiveProjection({ fromDim: 4, viewDistance: 4.5 });
const data = icosianE8Data();
const germ = elserSloaneGerm();

type ViewEdgeClass = 'shells' | 'inShell' | 'strut';

const edgeStyle: Record<ViewEdgeClass, { color: number; opacity: number }> = {
  shells: { color: 0x63e6ff, opacity: 0.9 },
  inShell: { color: 0xa986ff, opacity: 0.17 },
  strut: { color: 0xffbd66, opacity: 0.3 }
};

interface FoldedView {
  group: Group;
  products: Record<ViewEdgeClass, ProjectedEdges3D>;
  points: Points;
}

function makeView(embedding: PhiEmbedding, x: number): FoldedView {
  const group = new Group();
  group.position.x = x;
  scene.add(group);

  const products = Object.fromEntries(
    (Object.keys(edgeStyle) as ViewEdgeClass[]).map((edgeClass) => {
      const style = edgeStyle[edgeClass];
      const product = new ProjectedEdges3D(
        edgeClass === 'shells'
          ? createFoldedE8Shells({ embedding, scale: 1.55 })
          : createFoldedE8Roots({
              embedding,
              edgeClasses:
                edgeClass === 'inShell'
                  ? ['parallel-skeleton', 'perpendicular-skeleton', 'chord']
                  : ['strut'],
              scale: 1.55
            }),
        projection,
        {
          material: new LineBasicMaterial({
            color: style.color,
            transparent: style.opacity < 1,
            opacity: style.opacity,
            depthWrite: style.opacity === 1
          })
        }
      );
      group.add(product.object);
      return [edgeClass, product];
    })
  ) as unknown as Record<ViewEdgeClass, ProjectedEdges3D>;

  const colors = new Float32Array(240 * 3);
  const color = new Color();
  for (let i = 0; i < 240; i++) {
    color.set(data.shells[i] === 'unit' ? 0x72efff : 0xff6fcf);
    color.toArray(colors, i * 3);
  }
  const pointGeometry = new BufferGeometry();
  // All products preserve source-vertex order. Sharing this live position
  // attribute keeps roots and exact edge provenance visually locked.
  pointGeometry.setAttribute('position', products.shells.geometry.getAttribute('position'));
  pointGeometry.setAttribute('color', new BufferAttribute(colors, 3));
  const points = new Points(
    pointGeometry,
    new PointsMaterial({ size: 0.055, sizeAttenuation: true, vertexColors: true })
  );
  points.frustumCulled = false;
  group.add(points);
  return { group, products, points };
}

const parallel = makeView('parallel', -3.05);
const perpendicular = makeView('perpendicular', 3.05);
const views = [parallel, perpendicular];

interface GermView {
  group: Group;
  products: readonly ProjectedEdges3D[];
  points: Points;
}

function makeGermView(embedding: PhiEmbedding, x: number): GermView {
  const group = new Group();
  group.position.x = x;
  group.visible = false;
  scene.add(group);
  const products = (['root', 'second-shell'] as const).map(
    (sourceShell) =>
      new ProjectedEdges3D(
        createElserSloaneGermComplex({ embedding, scale: 1.25, sourceShell }),
        projection,
        {
          material: new LineBasicMaterial({
            color: sourceShell === 'root' ? 0x63e6ff : 0xffbd66,
            transparent: true,
            opacity: sourceShell === 'root' ? 0.65 : 0.78
          })
        }
      )
  );
  for (const product of products) group.add(product.object);
  const colors = new Float32Array(germ.points.length * 3);
  const color = new Color();
  for (let i = 0; i < germ.points.length; i++) {
    color.set(germ.points[i]!.sourceShell === 'root' ? 0x72efff : 0xffbd66);
    color.toArray(colors, i * 3);
  }
  const pointGeometry = new BufferGeometry();
  pointGeometry.setAttribute('position', products[0]!.geometry.getAttribute('position'));
  pointGeometry.setAttribute('color', new BufferAttribute(colors, 3));
  const points = new Points(
    pointGeometry,
    new PointsMaterial({ size: 0.06, sizeAttenuation: true, vertexColors: true })
  );
  points.frustumCulled = false;
  group.add(points);
  return { group, products, points };
}

const germViews = [makeGermView('parallel', -3.05), makeGermView('perpendicular', 3.05)];

const track = new Rotor4Track(
  [0, 5, 10, 15],
  [
    Rotor4.identity(),
    Rotor4.fromPlanes([
      { i: 0, j: 3, angle: 1.35 },
      { i: 1, j: 2, angle: -0.7 }
    ]),
    Rotor4.fromPlanes([
      { i: 0, j: 1, angle: 2.1 },
      { i: 2, j: 3, angle: 1.4 }
    ]),
    Rotor4.identity()
  ],
  'cubic'
);

let motion = true;
let speed = 0.45;
let elapsed = 0;

const bindRange = (id: string, onInput: (value: number) => void): void => {
  const input = document.getElementById(id) as HTMLInputElement;
  const label = document.getElementById(`${id}Value`)!;
  const apply = () => {
    const value = Number(input.value);
    label.textContent = value.toFixed(2);
    onInput(value);
  };
  input.addEventListener('input', apply);
  apply();
};

bindRange('speed', (value) => (speed = value));
for (const edgeClass of Object.keys(edgeStyle) as ViewEdgeClass[]) {
  const input = document.getElementById(edgeClass) as HTMLInputElement;
  const apply = () => {
    for (const view of views) view.products[edgeClass].object.visible = input.checked;
  };
  input.addEventListener('change', apply);
  apply();
}
const motionInput = document.getElementById('motion') as HTMLInputElement;
motionInput.addEventListener('change', () => (motion = motionInput.checked));
motion = motionInput.checked;
const rootsInput = document.getElementById('roots') as HTMLInputElement;
const applyPoints = () => {
  for (const view of views) view.points.visible = rootsInput.checked;
  for (const view of germViews) view.points.visible = rootsInput.checked;
};
rootsInput.addEventListener('change', applyPoints);
applyPoints();

const modeInput = document.getElementById('mode') as HTMLSelectElement;
const counts = document.getElementById('counts')!;
const parallelLabel = document.getElementById('parallel-label')!;
const perpendicularLabel = document.getElementById('perpendicular-label')!;
const rootOnlyControls = Array.from(document.querySelectorAll<HTMLElement>('.root-only'));
const applyMode = () => {
  const windowOn = modeInput.value === 'germ';
  for (const view of views) view.group.visible = !windowOn;
  for (const view of germViews) view.group.visible = windowOn;
  for (const label of rootOnlyControls) {
    label.style.opacity = windowOn ? '0.38' : '1';
    const input = label.querySelector('input');
    if (input) input.disabled = windowOn;
  }
  counts.textContent = windowOn
    ? `${germ.rootCount}/240 roots + ${germ.secondShellCount}/2,160 norm-4 vectors · ${germ.boundaryCount} exact boundary points`
    : '240 roots · 6,720 E8 edges · 2,880 inter-shell struts';
  parallelLabel.innerHTML = windowOn
    ? '<strong>physical space · window on</strong><br />accepted radii 1 and φ'
    : '<strong>parallel space</strong><br />radii 1 and 1/φ';
  perpendicularLabel.innerHTML = windowOn
    ? '<strong>internal space</strong><br />window boundary shell + accepted interior shell'
    : '<strong>perpendicular space</strong><br />radii 1 and φ';
};
modeInput.addEventListener('change', applyMode);
applyMode();

setupShowcaseUI({ drag4d });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let lastTime = 0;
renderer.setAnimationLoop((timeMs) => {
  const dt = Math.min((timeMs - lastTime) / 1000, 0.1);
  lastTime = timeMs;
  if (motion) elapsed += dt * speed;
  const sampled = track.sample(elapsed % track.times[track.keyCount - 1]!);
  const transform = new TransformN(4, drag4d.rotor.multiply(sampled));
  for (const view of views) {
    for (const product of Object.values(view.products)) product.update(transform);
  }
  for (const view of germViews) {
    for (const product of view.products) product.update(transform);
  }
  controls.enabled = !drag4d.active && drag4d.modifier !== 'none';
  controls.update();
  renderer.render(scene, camera);
});
