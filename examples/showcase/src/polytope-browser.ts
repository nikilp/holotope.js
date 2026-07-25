/**
 * Embeddable viewer for the polytope builders, selected by URL fragment:
 *
 *   polytope-browser.html#createHypercube
 *
 * One page serves every builder. A builder contributes a `PolytopeSpec`
 * naming its parameters and how to construct a complex from them; the
 * controls, the rebuild, and the reported cell counts follow from that
 * description, so registering a builder does not add a page.
 *
 * The animated rotation always includes the last axis. A rotation confined to
 * the first three axes is indistinguishable from orbiting the camera, whereas
 * one involving the projected-away axis changes the shape of the wireframe —
 * which is the property the projection is there to show.
 */
import { Color, LineBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  type CellComplex,
  PerspectiveProjection,
  TransformN,
  create24Cell,
  create120Cell,
  create600Cell,
  createCrossPolytope,
  createDuoprism,
  createHypercube,
  createSimplex,
  rotationFromPlanes
} from '@holotope/core';
import { ProjectedEdges3D } from '@holotope/three';

interface NumericParam {
  readonly name: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
}

interface PolytopeSpec {
  readonly params: readonly NumericParam[];
  readonly build: (value: (name: string) => number) => CellComplex;
  /** Camera distance; a 120-cell needs more room than a simplex. */
  readonly distance?: number;
}

const DIM: NumericParam = { name: 'dim', label: 'dim', min: 2, max: 6, step: 1, value: 4 };
const RADIUS: NumericParam = {
  name: 'radius',
  label: 'radius',
  min: 0.5,
  max: 1.6,
  step: 0.05,
  value: 1
};

const SPECS: Record<string, PolytopeSpec> = {
  createHypercube: {
    params: [DIM, { name: 'size', label: 'size', min: 0.4, max: 2, step: 0.05, value: 1 }],
    build: (v) => createHypercube({ dim: v('dim'), size: v('size') })
  },
  createSimplex: {
    params: [DIM, { name: 'edgeLength', label: 'edge', min: 0.5, max: 2.5, step: 0.05, value: 1.4 }],
    build: (v) => createSimplex({ dim: v('dim'), edgeLength: v('edgeLength') })
  },
  createCrossPolytope: {
    params: [DIM, RADIUS],
    build: (v) => createCrossPolytope({ dim: v('dim'), radius: v('radius') })
  },
  createDuoprism: {
    params: [
      { name: 'p', label: 'p', min: 3, max: 24, step: 1, value: 6 },
      { name: 'q', label: 'q', min: 3, max: 24, step: 1, value: 6 }
    ],
    build: (v) => createDuoprism({ p: v('p'), q: v('q') })
  },
  create24Cell: {
    params: [RADIUS],
    build: (v) => create24Cell({ radius: v('radius') })
  },
  create600Cell: {
    params: [RADIUS],
    build: (v) => create600Cell({ radius: v('radius') }),
    distance: 5.2
  },
  create120Cell: {
    params: [RADIUS],
    build: (v) => create120Cell({ radius: v('radius') }),
    distance: 5.6
  }
};

const selected = decodeURIComponent(location.hash.slice(1)) || 'createHypercube';
const registered = SPECS[selected];

if (!registered) {
  const box = document.getElementById('err')!;
  box.style.display = 'grid';
  box.textContent = `No viewer is registered for "${selected}".`;
  throw new Error(`polytope-browser: unknown builder ${selected}`);
}
const spec: PolytopeSpec = registered;

document.getElementById('title')!.textContent = selected;

// --- scene ------------------------------------------------------------------
const container = document.getElementById('app')!;

const scene = new Scene();
scene.background = new Color(0x0a0a12);

const camera = new PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 0, spec.distance ?? 4.2);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;

const material = new LineBasicMaterial({ color: 0x8fb6ff, transparent: true, opacity: 0.85 });

// --- parameters -------------------------------------------------------------
const values: Record<string, number> = {};
for (const p of spec.params) values[p.name] = p.value;

const stats = document.getElementById('stats')!;
let product: ProjectedEdges3D | null = null;
let dim = 4;

const edgeCount = (complex: CellComplex): number =>
  complex.cellsOfDim(1).reduce((n, g) => n + g.indices.length / g.verticesPerCell, 0);

function rebuild(): void {
  if (product) {
    scene.remove(product.object);
    product.object.geometry.dispose();
  }

  const complex = spec.build((name) => values[name] ?? 0);
  dim = complex.ambientDim;

  // A projection is defined from one ambient dimension, so it is rebuilt with
  // the complex rather than reused when `dim` is among the parameters.
  const projection = new PerspectiveProjection({ fromDim: dim, viewDistance: 3.2 });
  product = new ProjectedEdges3D(complex, projection, { material });
  scene.add(product.object);

  stats.replaceChildren();
  const line = (value: number | string, text: string): void => {
    const strong = document.createElement('b');
    strong.textContent = String(value);
    stats.append(strong, ` ${text}`, document.createElement('br'));
  };
  line(complex.vertexCount, 'vertices');
  line(edgeCount(complex), 'edges');
  line(dim, 'ambient dimensions');
}

const host = document.getElementById('controls')!;
for (const p of spec.params) {
  const row = document.createElement('div');
  row.className = 'row';

  const label = document.createElement('label');
  label.textContent = p.label;

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(p.min);
  input.max = String(p.max);
  input.step = String(p.step);
  input.value = String(p.value);

  const out = document.createElement('output');
  out.textContent = String(p.value);

  input.addEventListener('input', () => {
    values[p.name] = Number(input.value);
    out.textContent = input.value;
    rebuild();
  });

  row.append(label, input, out);
  host.append(row);
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

let angle = 0;
renderer.setAnimationLoop(() => {
  angle += 0.0045;
  orbit.update();

  if (product) {
    // One rotation in the plane of the first and last axes, and a slower one
    // among the retained axes so the solid also turns in view.
    const planes = [{ i: 0, j: dim - 1, angle }];
    if (dim >= 4) planes.push({ i: 1, j: 2, angle: angle * 0.55 });
    product.update(new TransformN(dim, rotationFromPlanes(dim, planes)));
  }

  renderer.render(scene, camera);
});
