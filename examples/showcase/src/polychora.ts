import {
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  LineBasicMaterial,
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
  CameraN,
  HyperplaneSlice4,
  PerspectiveProjection,
  Rotor4,
  TransformN,
  VecN,
  create24Cell,
  create120Cell,
  create600Cell,
  createCrossPolytope,
  createHypercube,
  createSimplex,
  tetrahedralizeCuboidCells,
  type CellComplex
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

const camera3 = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera3.position.set(0, 0.6, 18.5);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera3, renderer.domElement);
controls.enableDamping = true;

const drag4d = new DragRotation4D().attach(renderer.domElement);

scene.add(new AmbientLight(0xffffff, 0.45));
const sun = new DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 5, 4);
scene.add(sun);

// All six regular polychora, in canonical order by cell count — every one
// of them sliceable.
const polychora: Array<{ complex: CellComplex; color: number; cells: number }> = [
  { complex: createSimplex({ dim: 4, edgeLength: 2 }), color: 0xff6b81, cells: 5 },
  { complex: tetrahedralizeCuboidCells(createHypercube({ dim: 4, size: 2 })), color: 0xffd166, cells: 8 },
  { complex: createCrossPolytope({ dim: 4, radius: 1.3 }), color: 0x7fd4ff, cells: 16 },
  { complex: create24Cell({ radius: 1.3 }), color: 0x9b8cff, cells: 24 },
  { complex: create120Cell({ radius: 1.3 }), color: 0x6ee7a8, cells: 120 },
  { complex: create600Cell({ radius: 1.3 }), color: 0xf2a65a, cells: 600 }
];

// One 4D camera views all projections; sections share the same 4D rotation.
const camera4 = new CameraN(4);
const cameraDistance = 2.5;
const projection = new PerspectiveProjection({ fromDim: 4, viewDistance: 4 });
const slice = HyperplaneSlice4.axisAligned(3, 0);

const wireframes = polychora.map(({ complex, color }) => {
  const edges = new ProjectedEdges3D(complex, projection, {
    material: new LineBasicMaterial({ color })
  });
  scene.add(edges.object);
  return edges;
});
// Golden-angle hue walk: adjacent cell indices land far apart on the
// color wheel, so neighboring cells in the section contrast.
const paletteScratch = new Color();
const cellColor = (cell: number): number =>
  paletteScratch.setHSL((cell * 0.618034) % 1, 0.85, 0.55).getHex();

const sections = polychora.map(({ complex, color, cells }) => {
  const tetGroup = complex
    .cellsOfDim(3)
    .find((g) => g.kind === 'simplex' && g.verticesPerCell === 4)!;
  const perCell = tetGroup.indices.length / 4 / cells;
  const section = new SlicedComplex3D(complex, slice, {
    material: new MeshStandardMaterial({ color, side: DoubleSide, flatShading: true }),
    // Paint by source cell: the section reads as an assembly of the
    // polytope's own cells (vertexColors off until toggled).
    colorForTet: (tet) => cellColor(Math.floor(tet / perCell))
  });
  scene.add(section.object);
  return section;
});

// Projected 2-faces as a translucent skin — including the 120-cell's
// pentagons, stored as polygon 2-cells.
const surfaces = polychora.map(({ complex, color }) => {
  if (complex.cellsOfDim(2).length === 0) return null;
  const surface = new ProjectedSurface3D(complex, projection, {
    material: new MeshStandardMaterial({
      color,
      side: DoubleSide,
      flatShading: true,
      transparent: true,
      opacity: 0.35,
      depthWrite: false
    })
  });
  surface.object.visible = false;
  scene.add(surface.object);
  return surface;
});

// Picking, generalized from the tesseract page: every builder emits a
// uniform number of tetrahedra per 3-cell, so the slicer's per-triangle
// tet provenance maps straight to a source cell by integer division.
// The cell's boundary surface is recovered generically: among the cell's
// tet faces, exactly the unshared ones lie on its polyhedral boundary.
const TET_FACES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]
];
const tetInfo = polychora.map(({ complex, cells }) => {
  const tets = complex
    .cellsOfDim(3)
    .find((g) => g.kind === 'simplex' && g.verticesPerCell === 4)!.indices;
  return { tets, perCell: tets.length / 4 / cells };
});
// One highlight mesh per polychoron, sharing the wireframe's projected
// position attribute so it tracks the 4D rotation for free.
const highlights = polychora.map((_, i) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', wireframes[i]!.geometry.getAttribute('position'));
  geometry.setIndex([]);
  const mesh = new Mesh(
    geometry,
    new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
      side: DoubleSide,
      depthWrite: false
    })
  );
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
});

const highlightCell = (shape: number | null, cell = 0): void => {
  highlights.forEach((h, k) => {
    if (k !== shape) h.geometry.setIndex([]);
  });
  if (shape === null) return;
  const { tets, perCell } = tetInfo[shape]!;
  // Boundary extraction: interior faces are shared by two tets of the
  // cell and cancel; faces seen once form the cell's surface.
  const boundary = new Map<string, readonly [number, number, number]>();
  for (let t = cell * perCell; t < (cell + 1) * perCell; t++) {
    for (const [a, b, c] of TET_FACES) {
      const tri = [tets[t * 4 + a]!, tets[t * 4 + b]!, tets[t * 4 + c]!] as const;
      const key = [...tri].sort((x, y) => x - y).join(',');
      if (boundary.has(key)) boundary.delete(key);
      else boundary.set(key, tri);
    }
  }
  const indices: number[] = [];
  for (const tri of boundary.values()) indices.push(...tri);
  highlights[shape]!.geometry.setIndex(indices);
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
  raycaster.setFromCamera(pointerNdc, camera3);
  const hit = raycaster
    .intersectObjects(sections.map((s) => s.object), false)
    .find((h) => h.faceIndex !== undefined);
  if (!hit) {
    highlightCell(null);
    return;
  }
  const shape = sections.findIndex((s) => s.object === hit.object);
  const tet = sections[shape]!.sourceTetOfFace(hit.faceIndex!);
  highlightCell(shape, Math.floor(tet / tetInfo[shape]!.perCell));
});

// Responsive layout. Landscape: six columns, projections above their
// sections. Portrait: a 2 × 3 grid of polychora, each cell stacking the
// projection over its section — the wide row can't fit a phone.
const columnX = [-8.5, -5.1, -1.7, 1.7, 5.1, 8.5];
const layout = (): void => {
  const portrait = window.innerHeight > window.innerWidth;
  for (let i = 0; i < polychora.length; i++) {
    if (portrait) {
      const x = i % 2 === 0 ? -1.9 : 1.9;
      const rowY = 5.2 - Math.floor(i / 2) * 5.2;
      wireframes[i]!.object.position.set(x, rowY + 1.15, 0);
      sections[i]!.object.position.set(x, rowY - 1.15, 0);
    } else {
      wireframes[i]!.object.position.set(columnX[i]!, 1.9, 0);
      sections[i]!.object.position.set(columnX[i]!, -1.9, 0);
    }
    highlights[i]!.position.copy(wireframes[i]!.object.position);
    surfaces[i]?.object.position.copy(wireframes[i]!.object.position);
  }
};
layout();

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

const facesToggle = document.getElementById('showFaces') as HTMLInputElement;
facesToggle.addEventListener('change', () => {
  for (const s of surfaces) {
    if (s) s.object.visible = facesToggle.checked;
  }
});

const colorCellsToggle = document.getElementById('colorCells') as HTMLInputElement;
colorCellsToggle.addEventListener('change', () => {
  sections.forEach((section, i) => {
    const material = section.object.material as MeshStandardMaterial;
    material.vertexColors = colorCellsToggle.checked;
    // White base lets the vertex colors through unfiltered.
    material.color.setHex(colorCellsToggle.checked ? 0xffffff : polychora[i]!.color);
    material.needsUpdate = true;
  });
});

setupShowcaseUI({ drag4d });

window.addEventListener('resize', () => {
  camera3.aspect = window.innerWidth / window.innerHeight;
  camera3.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  layout();
});

let xwAngle = 0;
let yzAngle = 0;
let lastTime = 0;
const origin4 = new VecN(4);

renderer.setAnimationLoop((timeMs) => {
  const dt = Math.min((timeMs - lastTime) / 1000, 0.1);
  lastTime = timeMs;
  xwAngle += dt * xwSpeed;
  yzAngle += dt * yzSpeed;

  controls.enabled = !drag4d.active && drag4d.modifier !== 'none';

  // Shared 4D rotation: user drag composed with the auto-rotation.
  const rotor = drag4d.rotor.multiply(
    Rotor4.fromPlanes([
      { i: 0, j: 3, angle: xwAngle },
      { i: 1, j: 2, angle: yzAngle }
    ])
  );

  // Top row: orbit the 4D camera (inverse rotor keeps its apparent motion
  // in the same direction as the section rotation below).
  camera4.position = rotor.conjugate().applyToPoint(new VecN([0, 0, 0, cameraDistance]));
  camera4.lookAt(origin4);
  const view = camera4.viewTransform();
  for (const wireframe of wireframes) wireframe.update(view);
  if (facesToggle.checked) {
    for (const surface of surfaces) surface?.update(view);
  }

  // Bottom row: rotate the objects and slice them with the fixed hyperplane.
  const objectTransform = new TransformN(4, rotor);
  for (const section of sections) section.update(objectTransform);

  controls.update();
  renderer.render(scene, camera3);
});
