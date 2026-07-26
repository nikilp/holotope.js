/**
 * Embeddable viewer for the render products, selected by URL fragment:
 *
 *   product-browser.html#SlicedComplex3D
 *
 * The polytope viewer varies the shape and fixes the product. This one does
 * the reverse, because the products are not alternative renderings of one
 * picture: a projection and a section are different observations of the same
 * R⁴ object and disagree on purpose.
 *
 * The source rotates in a plane containing the fourth axis, which is what
 * separates them. A projected wireframe changes shape as hidden extent turns
 * into visible extent; a section changes because a different hyperplane of the
 * object meets the fixed cutting hyperplane. Neither is the camera moving.
 */
import {
  AmbientLight,
  Color,
  DirectionalLight,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Scene,
  WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  type CellComplex,
  HyperplaneSlice4,
  PerspectiveProjection,
  TransformN,
  create24Cell,
  create120Cell,
  create600Cell,
  createHypercube,
  rotationFromPlanes,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import { ProjectedEdges3D, ProjectedSurface3D, SlicedComplex3D } from '@holotope/three';
import {
  type Param,
  type Values,
  bindControls,
  reportCounts,
  reportFailure,
  selectedEntry,
  setTitle
} from './viewer-ui';

/** A product exposes an Object3D and is refreshed from a source transform. */
interface Product {
  readonly object: Object3D;
  update(transform: TransformN): void;
}

interface ProductSpec {
  /** Extra controls beyond the shape selector. */
  readonly params?: readonly Param[];
  readonly create: (complex: CellComplex, v: Values) => Product;
  /** Reported alongside the shape's own figures. */
  readonly describe: (product: Product) => readonly (readonly [number | string, string])[];
  readonly distance?: number;
  /** Runs each frame before the product is updated. */
  readonly animate?: (v: Values, time: number) => void;
}

// --- shapes -----------------------------------------------------------------
// Every entry carries 1-, 2-, and 3-cells, so one set serves all products. The
// tesseract's cells are cuboid, and a section marches tetrahedra, so it is
// decomposed first.
// Ordered by number of 3-cells, which is what each name counts: a tesseract
// is bounded by 8 cubes, a 120-cell by 120 dodecahedra, a 600-cell by 600
// tetrahedra. Ordering by vertices instead would read as unsorted, since the
// 600-cell has 120 of them and the 120-cell has 600.
const SHAPES: Record<string, () => CellComplex> = {
  tesseract: () => tetrahedralizeCuboidCells(createHypercube({ dim: 4, maxCellDimension: 3 })),
  '24-cell': () => create24Cell(),
  '120-cell': () => create120Cell(),
  '600-cell': () => create600Cell()
};

const SHAPE: Param = {
  kind: 'choice',
  name: 'shape',
  label: 'shape',
  options: Object.keys(SHAPES),
  value: 'tesseract'
};

const projection = new PerspectiveProjection({ fromDim: 4, viewDistance: 3.4 });

// One cutting hyperplane, reused so its offset control persists across
// rebuilds; a section product holds a reference to it.
const slice = HyperplaneSlice4.axisAligned(3, 0);

const SPECS: Record<string, ProductSpec> = {
  ProjectedEdges3D: {
    create: (complex) => new ProjectedEdges3D(complex, projection),
    describe: (p) => [[(p as ProjectedEdges3D).complex.cellsOfDim(1).length, 'edge groups']]
  },

  ProjectedSurface3D: {
    // The product's own default is used rather than an override: it is what a
    // caller gets, and it disables depth writing, without which translucent
    // triangles of a self-intersecting projected surface occlude each other
    // by buffer order and flicker as the source turns.
    create: (complex) => new ProjectedSurface3D(complex, projection),
    describe: () => []
  },

  SlicedComplex3D: {
    // The offset moves the cutting hyperplane along the hidden axis; the
    // section is empty once it passes beyond the object's extent.
    params: [{ name: 'offset', label: 'offset', min: -1.4, max: 1.4, step: 0.02, value: 0 }],
    create: (complex) => new SlicedComplex3D(complex, slice),
    describe: (p) => [[(p as SlicedComplex3D).triangleCount, 'section triangles']],
    animate: (v) => {
      slice.offset = v.number('offset');
    }
  }
};

// --- selection --------------------------------------------------------------
const selected = selectedEntry('ProjectedEdges3D');
const registered = SPECS[selected];

if (!registered) {
  reportFailure(`No viewer is registered for "${selected}".`);
  throw new Error(`product-browser: unknown product ${selected}`);
}
const spec: ProductSpec = registered;
setTitle(selected);

// --- scene ------------------------------------------------------------------
const container = document.getElementById('app')!;

const scene = new Scene();
scene.background = new Color(0x0a0a12);
scene.add(new AmbientLight(0xffffff, 0.5));
const sun = new DirectionalLight(0xffffff, 2.1);
sun.position.set(3, 5, 4);
scene.add(sun);

const camera = new PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 0, spec.distance ?? 4.6);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;

// --- build ------------------------------------------------------------------
let product: Product | null = null;
let sourceCounts: readonly (readonly [number | string, string])[] = [];
let sinceReport = 0;

/**
 * The pose currently on screen. A rebuild reports figures for whatever it last
 * updated with, so rebuilding at the identity would report a different cut
 * than the one being displayed — visible as a flicker, and as a zero whenever
 * the identity pose puts the cut outside the object.
 */
let pose = new TransformN(4);

/** Elapsed rotation, shared so a rebuild can reproduce the current pose. */
let angle = 0;

const values: Values = bindControls([SHAPE, ...(spec.params ?? [])], () => rebuild());

function rebuild(): void {
  if (product) {
    scene.remove(product.object);
    (product.object as Mesh).geometry?.dispose();
  }

  const complex = (SHAPES[values.choice('shape')] ?? SHAPES.tesseract)!();
  product = spec.create(complex, values);
  scene.add(product.object);

  const edges = complex
    .cellsOfDim(1)
    .reduce((n, g) => n + g.indices.length / g.verticesPerCell, 0);
  const faces = complex
    .cellsOfDim(2)
    .reduce((n, g) => n + g.indices.length / g.verticesPerCell, 0);

  spec.animate?.(values, angle);
  product.update(pose);

  sourceCounts = [
    [edges, 'source edges'],
    [faces, 'source faces']
  ];
  refreshCounts();
}

/**
 * A section's size is a property of the current cut, not of the source, so it
 * is read after each update rather than once at construction.
 */
function refreshCounts(): void {
  if (!product) return;
  reportCounts([...sourceCounts, ...spec.describe(product)]);
}

rebuild();

// --- animation --------------------------------------------------------------
function resize(): void {
  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop(() => {
  angle += 0.0038;
  orbit.update();

  if (product) {
    spec.animate?.(values, angle);
    // Turning in a single plane containing the hidden axis leaves that axis
    // aligned with the object's own, so a section stays a translate of one
    // shape — a tesseract yields nothing but boxes. Two such planes at
    // incommensurate rates tilt the cutting hyperplane against the cells, and
    // the section runs through the polyhedra that plane actually meets. The
    // third rotation is within the retained axes and only turns the result in
    // view.
    pose = new TransformN(
      4,
      rotationFromPlanes(4, [
        { i: 0, j: 3, angle },
        { i: 1, j: 3, angle: angle * 0.61 },
        { i: 1, j: 2, angle: angle * 0.23 }
      ])
    );
    product.update(pose);

    // Reading the section every frame would rewrite the panel 60 times a
    // second for a figure that changes slowly.
    if (++sinceReport >= 12) {
      sinceReport = 0;
      refreshCounts();
    }
  }

  renderer.render(scene, camera);
});
