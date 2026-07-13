import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LineBasicMaterial,
  LineSegments,
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
  elserSloaneInflate,
  elserSloaneNormPatch,
  elserSloaneSection,
  elserSloaneSectionEdges,
  phiRing,
  type ElserSloanePhasonOffset,
  type ExactValue,
  type ModelPoint
} from '@holotope/core';
import { setupShowcaseUI } from './ui';

const container = document.getElementById('app')!;
const scene = new Scene();
scene.background = new Color(0x080910);

const camera = new PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 0.5, 13);
const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
const physicalGroup = new Group();
physicalGroup.position.x = -3.1;
const internalGroup = new Group();
internalGroup.position.x = 3.1;
scene.add(physicalGroup, internalGroup);

const internalProjection = new PerspectiveProjection({ fromDim: 4, viewDistance: 3.8 });
const patchCache = new Map<string, ReturnType<typeof elserSloaneNormPatch>>();
let maxNorm = 8;
let levelIndex = 0;
let levels: ExactValue[] = [];
let showInflation = true;
let motion = true;
let speed = 0.18;
let elapsed = 0;
let internalSource = new Float64Array();
let internalWorld = new Float64Array();
let internalPosition: BufferAttribute | null = null;
let phason = 'canonical';

const PHASON_PRESETS: Record<string, ElserSloanePhasonOffset | undefined> = {
  canonical: undefined,
  regular: [
    { a: -2n, b: -2n },
    { a: -2n, b: -2n },
    { a: -2n, b: 1n },
    { a: 0n, b: -1n }
  ]
};

function patchFor(norm: number): ReturnType<typeof elserSloaneNormPatch> {
  const key = `${norm}:${phason}`;
  let patch = patchCache.get(key);
  if (!patch) {
    const phasonOffset = PHASON_PRESETS[phason];
    patch = elserSloaneNormPatch({
      maxE8Norm: norm,
      ...(phasonOffset === undefined ? {} : { phasonOffsetElevenths: phasonOffset })
    });
    patchCache.set(key, patch);
  }
  return patch;
}

function clearGroup(group: Group): void {
  for (const child of group.children.slice()) {
    group.remove(child);
    if (child instanceof LineSegments || child instanceof Points) {
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material.dispose();
    }
  }
}

function exactKey(value: ExactValue): string {
  return phiRing.key(value);
}

function formatHalfExact(value: ExactValue): string {
  if (value.a === 0n && value.b === 0n) return '0';
  const terms: string[] = [];
  if (value.a !== 0n) terms.push(String(value.a));
  if (value.b !== 0n) {
    const sign = value.b < 0n ? '-' : terms.length > 0 ? '+' : '';
    const magnitude = value.b < 0n ? -value.b : value.b;
    terms.push(`${sign}${magnitude === 1n ? '' : magnitude}φ`);
  }
  return `(${terms.join('')})/2`;
}

function makePointColors(
  points: readonly ModelPoint[],
  inflatedKeys: ReadonlySet<string>,
  baseColor: number
): BufferAttribute {
  const colors = new Float32Array(points.length * 3);
  const color = new Color();
  for (let i = 0; i < points.length; i++) {
    const isInflationImage = inflatedKeys.has(points[i]!.coefficients.join(','));
    color.set(showInflation && isInflationImage ? 0xffbd66 : baseColor);
    color.toArray(colors, i * 3);
  }
  return new BufferAttribute(colors, 3);
}

function installView(
  group: Group,
  positions: BufferAttribute,
  colors: BufferAttribute,
  edges: Uint32Array,
  lineColor: number
): void {
  const lineGeometry = new BufferGeometry();
  lineGeometry.setAttribute('position', positions);
  lineGeometry.setIndex(new BufferAttribute(edges, 1));
  const lines = new LineSegments(
    lineGeometry,
    new LineBasicMaterial({ color: lineColor, transparent: true, opacity: 0.38 })
  );
  lines.frustumCulled = false;
  group.add(lines);

  const pointGeometry = new BufferGeometry();
  pointGeometry.setAttribute('position', positions);
  pointGeometry.setAttribute('color', colors);
  const pointCloud = new Points(
    pointGeometry,
    new PointsMaterial({ size: 0.075, sizeAttenuation: true, vertexColors: true })
  );
  pointCloud.frustumCulled = false;
  group.add(pointCloud);
}

function rebuild(resetToZero = false): void {
  const patch = patchFor(maxNorm);
  const byLevel = new Map<string, ExactValue>();
  for (const point of patch.points) byLevel.set(exactKey(point.parallelExact[3]!), point.parallelExact[3]!);
  const previousKey = levels[levelIndex] ? exactKey(levels[levelIndex]!) : phiRing.key(phiRing.zero);
  levels = [...byLevel.values()].sort(phiRing.compare);
  const zeroIndex = Math.max(0, levels.findIndex((value) => phiRing.sign(value) === 0));
  const preserved = levels.findIndex((value) => exactKey(value) === previousKey);
  levelIndex = resetToZero || preserved < 0 ? zeroIndex : preserved;

  const levelInput = document.getElementById('section') as HTMLInputElement;
  levelInput.max = String(Math.max(0, levels.length - 1));
  levelInput.value = String(levelIndex);
  const level = levels[levelIndex] ?? phiRing.zero;
  const section = elserSloaneSection(patch.points, level);
  const edges = elserSloaneSectionEdges(section);
  const inflatedKeys = new Set(
    phason === 'canonical'
      ? patch.points.map((point) => elserSloaneInflate(point.coefficients).join(','))
      : []
  );

  clearGroup(physicalGroup);
  clearGroup(internalGroup);
  const physicalPositions = new Float32Array(section.length * 3);
  internalSource = new Float64Array(section.length * 4);
  internalWorld = new Float64Array(section.length * 4);
  for (let i = 0; i < section.length; i++) {
    for (let coordinate = 0; coordinate < 3; coordinate++) {
      physicalPositions[i * 3 + coordinate] = section[i]!.parallel[coordinate]! * 0.72;
    }
    for (let coordinate = 0; coordinate < 4; coordinate++) {
      internalSource[i * 4 + coordinate] = section[i]!.perpendicular[coordinate]! * 1.8;
    }
  }
  const physicalAttribute = new BufferAttribute(physicalPositions, 3);
  internalPosition = new BufferAttribute(new Float32Array(section.length * 3), 3);
  const physicalColors = makePointColors(section, inflatedKeys, 0x63e6ff);
  const internalColors = makePointColors(section, inflatedKeys, 0xa986ff);
  installView(physicalGroup, physicalAttribute, physicalColors, edges, 0x63e6ff);
  installView(internalGroup, internalPosition, internalColors, edges, 0xa986ff);

  document.getElementById('sectionValue')!.textContent = formatHalfExact(level);
  document.getElementById('counts')!.textContent =
    `${patch.candidateCount.toLocaleString()} E8 candidates · ${patch.points.length} accepted · ` +
    `${section.length} in section · ${edges.length / 2} exact nearest edges`;
  document.getElementById('boundary')!.textContent =
    phason === 'canonical'
      ? `${patch.boundaryCount} exact boundary points · symmetric singular cut`
      : `${patch.boundaryCount} exact boundary points · regular shifted cut`;
  document.getElementById('physical-label')!.innerHTML =
    `<strong>physical 3-space</strong><br />exact f₄ section = ${formatHalfExact(level)}`;
  const inflationCount = section.filter((point) => inflatedKeys.has(point.coefficients.join(','))).length;
  document.getElementById('inflationCount')!.textContent =
    phason === 'canonical'
      ? `${inflationCount}/${section.length} visible points are in the finite φ-image`
      : 'φ-image and icosahedral section symmetry belong to the canonical window origin';
}

const phasonInput = document.getElementById('phason') as HTMLSelectElement;
const inflationInput = document.getElementById('inflation') as HTMLInputElement;
phasonInput.addEventListener('change', () => {
  phason = phasonInput.value;
  const canonical = phason === 'canonical';
  inflationInput.disabled = !canonical;
  inflationInput.checked = canonical;
  showInflation = canonical;
  rebuild(true);
});
phason = phasonInput.value;

const normInput = document.getElementById('norm') as HTMLSelectElement;
normInput.addEventListener('change', () => {
  maxNorm = Number(normInput.value);
  rebuild(true);
});
maxNorm = Number(normInput.value);

const sectionInput = document.getElementById('section') as HTMLInputElement;
sectionInput.addEventListener('input', () => {
  levelIndex = Number(sectionInput.value);
  rebuild(false);
});

inflationInput.addEventListener('change', () => {
  showInflation = inflationInput.checked;
  rebuild(false);
});
showInflation = inflationInput.checked;

const motionInput = document.getElementById('motion') as HTMLInputElement;
motionInput.addEventListener('change', () => (motion = motionInput.checked));
motion = motionInput.checked;

const speedInput = document.getElementById('speed') as HTMLInputElement;
const speedValue = document.getElementById('speedValue')!;
const applySpeed = () => {
  speed = Number(speedInput.value);
  speedValue.textContent = speed.toFixed(2);
};
speedInput.addEventListener('input', applySpeed);
applySpeed();

setupShowcaseUI();
rebuild(true);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

let lastTime = 0;
renderer.setAnimationLoop((timeMs) => {
  const dt = Math.min((timeMs - lastTime) / 1000, 0.1);
  lastTime = timeMs;
  if (motion) elapsed += dt * speed;
  if (internalPosition) {
    const rotor = Rotor4.fromPlanes([
      { i: 0, j: 3, angle: elapsed },
      { i: 1, j: 2, angle: -0.63 * elapsed }
    ]);
    const transform = new TransformN(4, rotor);
    transform.applyToPositions(internalSource, internalWorld, internalSource.length / 4);
    internalProjection.projectPositions(
      internalWorld,
      internalSource.length / 4,
      internalPosition.array as Float32Array
    );
    internalPosition.needsUpdate = true;
  }
  controls.update();
  renderer.render(scene, camera);
});
