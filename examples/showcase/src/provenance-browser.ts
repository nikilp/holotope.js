/**
 * Embeddable viewer for representation provenance, selected by URL fragment:
 *
 *   provenance-browser.html#representationHitFromSlicedComplex
 *
 * A projection is many-to-one, so a 3D coordinate cannot identify the point it
 * came from. Traceability is instead carried: each render product retains, per
 * rendered primitive, the source cell that produced it. Clicking here resolves
 * a Raycaster intersection into a `RepresentationHitN` and reports what that
 * record does and does not establish — including whether an exact ambient
 * point exists at all, which for a projection it generally does not.
 *
 * The picked source cell is highlighted in the wireframe, which is the claim
 * made visible: the highlight follows the source through rotation because it
 * indexes the source, not the picture.
 */
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  LineBasicMaterial,
  LineSegments,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  type CellComplex,
  type CellComplexDirectionalBoundsN,
  HyperplaneSlice4,
  PerspectiveProjection,
  type RepresentationHitN,
  TransformN,
  cellComplexBoundsAlongAxisN,
  createHypercube,
  rotationFromPlanes,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import {
  ProjectedEdges3D,
  type RepresentationIntersection3D,
  SlicedComplex3D,
  representationHitFromProjectedEdge,
  representationHitFromSlicedComplex
} from '@holotope/three';
import { presentObservation } from './provenance-observation.js';
import {
  type Param,
  type Values,
  bindControls,
  reportCounts,
  reportFailure,
  selectedEntry,
  setTitle
} from './viewer-ui';

interface PickableSpec {
  /** What the reader clicks on. */
  readonly instruction: string;
  readonly resolve: (intersection: RepresentationIntersection3D) => RepresentationHitN;
  readonly pickTarget: () => import('three').Object3D;
}

// --- source ------------------------------------------------------------------
// One tesseract, decomposed so it can also be cut. Both products observe this
// single complex; neither owns it.
const source: CellComplex = tetrahedralizeCuboidCells(
  createHypercube({ dim: 4, maxCellDimension: 3 })
);

const projection = new PerspectiveProjection({ fromDim: 4, viewDistance: 3.4 });
const slice = HyperplaneSlice4.axisAligned(3, 0);
const sliceOffsetBounds: CellComplexDirectionalBoundsN =
  cellComplexBoundsAlongAxisN(source, 3);

const wireframe = new ProjectedEdges3D(source, projection, {
  material: new LineBasicMaterial({ color: 0x4a5a80 })
});

/**
 * Whether the section is expressed in the projection's frame decides what a
 * pick on it can establish, so the product is rebuilt when that changes.
 *
 * In the slice's own frame the cut is a genuine R⁴ object and a picked point
 * lifts exactly. Drawn in projection space it lands inside the wireframe it
 * came from, which reads better — but the projection is many-to-one, so the
 * lift is no longer defined and the hit says so rather than guessing.
 */
let section: SlicedComplex3D;

function buildSection(overlay: boolean): void {
  if (section) scene.remove(section.object);
  section = overlay
    ? new SlicedComplex3D(source, slice, { projection })
    : new SlicedComplex3D(source, slice);
  scene.add(section.object);
}

// --- highlight ---------------------------------------------------------------
// Shares the wireframe's position attribute, so the highlighted edges track the
// source under rotation without being recomputed: the indices name source
// vertices, and those are what the projection rewrites.
const highlightGeometry = new BufferGeometry();
highlightGeometry.setAttribute(
  'position',
  wireframe.geometry.getAttribute('position') as BufferAttribute
);
highlightGeometry.setIndex([]);
const highlight = new LineSegments(
  highlightGeometry,
  new LineBasicMaterial({ color: 0xffffff })
);
highlight.frustumCulled = false;

const SPECS: Record<string, PickableSpec> = {
  representationHitFromSlicedComplex: {
    instruction: 'click the cross-section',
    resolve: (i) => representationHitFromSlicedComplex(section, i),
    pickTarget: () => section.object
  },
  representationHitFromProjectedEdge: {
    instruction: 'click an edge of the wireframe',
    resolve: (i) => representationHitFromProjectedEdge(wireframe, i),
    pickTarget: () => wireframe.object
  }
};

const selected = selectedEntry('representationHitFromSlicedComplex');
const registered = SPECS[selected];

if (!registered) {
  reportFailure(`No viewer is registered for "${selected}".`);
  throw new Error(`provenance-browser: unknown entry ${selected}`);
}
const spec: PickableSpec = registered;
setTitle(selected);

// --- scene -------------------------------------------------------------------
const container = document.getElementById('app')!;

const scene = new Scene();
scene.background = new Color(0x0a0a12);
scene.add(wireframe.object, highlight);
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
  {
    name: 'offset',
    label: 'cut offset',
    min: sliceOffsetBounds.min,
    max: sliceOffsetBounds.max,
    step: 0.02,
    value: 0
  },
  { kind: 'toggle', name: 'overlay', label: 'draw in projection', value: false },
  { kind: 'toggle', name: 'spin', label: 'rotate', value: true }
];
const values: Values = bindControls(PARAMS, () => {
  buildSection(values.toggle('overlay'));
  highlightGeometry.setIndex([]);
  reportCounts([[spec.instruction, '']]);
});

buildSection(false);

// --- picking -----------------------------------------------------------------
const raycaster = new Raycaster();
raycaster.params.Line = { threshold: 0.04 };
const pointer = new Vector2();

function describe(hit: RepresentationHitN): void {
  const rows: (readonly [number | string, string])[] = [
    [hit.representation, 'representation'],
    [hit.source.kind, 'source kind']
  ];

  // The source record is the answer a projection's coordinates cannot give.
  // Narrowed on `kind` rather than cast, so a wrong field name fails to
  // compile instead of silently reporting nothing.
  if (hit.source.kind === 'cell') {
    rows.push([hit.source.cellIndex, 'source cell index']);
    rows.push([hit.source.intrinsicDim, 'source cell dimension']);
    rows.push([hit.source.vertexIndices.join(', '), 'source vertices']);
  }

  rows.push([hit.ambientPointStatus, 'ambient point']);
  if (hit.ambientPoint) {
    rows.push([
      [...hit.ambientPoint.data].map((v) => v.toFixed(2)).join(', '),
      'in R⁴'
    ]);
  }
  rows.push([hit.ambiguity, 'ambiguity']);
  reportCounts(rows);
}

function highlightSourceCell(hit: RepresentationHitN): void {
  if (hit.source.kind !== 'cell') {
    highlightGeometry.setIndex([]);
    return;
  }
  const vertices = hit.source.vertexIndices;
  if (!vertices.length) {
    highlightGeometry.setIndex([]);
    return;
  }
  // Every pair drawn: a closed loop for an edge, a fan for anything larger.
  const indices: number[] = [];
  for (let a = 0; a < vertices.length; a++) {
    for (let b = a + 1; b < vertices.length; b++) indices.push(vertices[a]!, vertices[b]!);
  }
  highlightGeometry.setIndex(indices);
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const hits = raycaster.intersectObject(spec.pickTarget(), false);
  if (!hits.length) {
    reportCounts([[spec.instruction, '']]);
    highlightGeometry.setIndex([]);
    return;
  }

  // All-or-nothing. Every real intersection is adapted before anything is
  // grouped: taking `hits[0]` would silently pick one of several sources, and
  // grouping a partial list would name a target derived from an observation the
  // page did not fully understand. What to draw is decided in
  // `presentObservation`, away from the DOM, so the decision is testable.
  const adapted: RepresentationHitN[] = [];
  let refusal = '';
  for (const candidate of hits) {
    const intersection: RepresentationIntersection3D = {
      point: candidate.point,
      ...(candidate.faceIndex === undefined ? {} : { faceIndex: candidate.faceIndex }),
      ...(candidate.index === undefined ? {} : { index: candidate.index })
    };
    try {
      adapted.push(spec.resolve(intersection));
    } catch (error) {
      refusal = String(error instanceof Error ? error.message : error);
      break;
    }
  }

  const presentation = presentObservation(adapted, hits.length, refusal);
  if (presentation.highlightHit === null) {
    highlightGeometry.setIndex([]);
  } else {
    describe(presentation.highlightHit);
    highlightSourceCell(presentation.highlightHit);
  }
  reportCounts(presentation.rows.length > 0
    ? presentation.rows.map(([label, value]): [string, string] => [label, value])
    : [[spec.instruction, '']]);
});

reportCounts([[spec.instruction, '']]);

// --- animation ---------------------------------------------------------------
function resize(): void {
  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let angle = 0;
renderer.setAnimationLoop(() => {
  if (values.toggle('spin')) angle += 0.0032;
  orbit.update();
  slice.offset = values.number('offset');

  const transform = new TransformN(
    4,
    rotationFromPlanes(4, [
      { i: 0, j: 3, angle },
      { i: 1, j: 3, angle: angle * 0.61 }
    ])
  );
  wireframe.update(transform);
  section.update(transform);

  renderer.render(scene, camera);
});
