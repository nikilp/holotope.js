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
  type CoxeterDiagram,
  PerspectiveProjection,
  TransformN,
  create24Cell,
  create120Cell,
  create600Cell,
  createCliffordCurve,
  createCrossPolytope,
  createDuoprism,
  createGrandAntiprism,
  createHopfFiber,
  createHypercube,
  createSimplex,
  createSnub24Cell,
  createWythoffPolytope,
  coxeterA4,
  coxeterB4,
  coxeterD4,
  coxeterF4,
  coxeterH4,
  rotationFromPlanes
} from '@holotope/core';
import { ProjectedEdges3D } from '@holotope/three';

interface NumericParam {
  readonly kind?: 'number';
  readonly name: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
}

/** A ringed node of a Coxeter diagram, or any other on/off construction flag. */
interface ToggleParam {
  readonly kind: 'toggle';
  readonly name: string;
  readonly label: string;
  readonly value: boolean;
}

/** A named alternative, such as which rank-4 Coxeter group to act with. */
interface ChoiceParam {
  readonly kind: 'choice';
  readonly name: string;
  readonly label: string;
  readonly options: readonly string[];
  readonly value: string;
}

type Param = NumericParam | ToggleParam | ChoiceParam;

interface Values {
  readonly number: (name: string) => number;
  readonly toggle: (name: string) => boolean;
  readonly choice: (name: string) => string;
}

interface PolytopeSpec {
  readonly params: readonly Param[];
  readonly build: (v: Values) => CellComplex;
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
    build: (v) => createHypercube({ dim: v.number('dim'), size: v.number('size') })
  },
  createSimplex: {
    params: [DIM, { name: 'edgeLength', label: 'edge', min: 0.5, max: 2.5, step: 0.05, value: 1.4 }],
    build: (v) => createSimplex({ dim: v.number('dim'), edgeLength: v.number('edgeLength') })
  },
  createCrossPolytope: {
    params: [DIM, RADIUS],
    build: (v) => createCrossPolytope({ dim: v.number('dim'), radius: v.number('radius') })
  },
  createDuoprism: {
    params: [
      { name: 'p', label: 'p', min: 3, max: 24, step: 1, value: 6 },
      { name: 'q', label: 'q', min: 3, max: 24, step: 1, value: 6 }
    ],
    build: (v) => createDuoprism({ p: v.number('p'), q: v.number('q') })
  },
  create24Cell: {
    params: [RADIUS],
    build: (v) => create24Cell({ radius: v.number('radius') })
  },
  create600Cell: {
    params: [RADIUS],
    build: (v) => create600Cell({ radius: v.number('radius') }),
    distance: 5.2
  },
  create120Cell: {
    params: [RADIUS],
    build: (v) => create120Cell({ radius: v.number('radius') }),
    distance: 5.6
  },
  createSnub24Cell: {
    params: [RADIUS],
    build: (v) => createSnub24Cell({ radius: v.number('radius') }),
    distance: 4.6
  },
  createGrandAntiprism: {
    params: [RADIUS],
    build: (v) => createGrandAntiprism({ radius: v.number('radius') }),
    distance: 4.8
  },
  createCliffordCurve: {
    params: [
      { name: 'p', label: 'p', min: 1, max: 12, step: 1, value: 2 },
      { name: 'q', label: 'q', min: 1, max: 12, step: 1, value: 3 },
      { name: 'radiusRatio', label: 'ratio', min: 0.2, max: 1, step: 0.05, value: 0.7 }
    ],
    build: (v) =>
      createCliffordCurve({
        p: v.number('p'),
        q: v.number('q'),
        radiusRatio: v.number('radiusRatio'),
        segments: 512
      })
  },
  createHopfFiber: {
    // The fibre is the preimage of one point of the base 2-sphere, so the
    // control is that point, given in spherical coordinates.
    params: [
      { name: 'polar', label: 'polar', min: 5, max: 175, step: 1, value: 60 },
      { name: 'azimuth', label: 'azimuth', min: 0, max: 360, step: 1, value: 0 }
    ],
    build: (v) => {
      const theta = (v.number('polar') * Math.PI) / 180;
      const phi = (v.number('azimuth') * Math.PI) / 180;
      return createHopfFiber({
        base: [
          Math.sin(theta) * Math.cos(phi),
          Math.sin(theta) * Math.sin(phi),
          Math.cos(theta)
        ],
        segments: 256
      });
    }
  },
  createWythoffPolytope: {
    // A ring pattern over a rank-4 diagram selects a uniform polychoron; the
    // four toggles are the ringed nodes, and at least one must be set.
    params: [
      { kind: 'choice', name: 'group', label: 'group', options: ['A4', 'B4', 'D4', 'F4', 'H4'], value: 'A4' },
      { kind: 'toggle', name: 'r0', label: 'node 0', value: true },
      { kind: 'toggle', name: 'r1', label: 'node 1', value: false },
      { kind: 'toggle', name: 'r2', label: 'node 2', value: false },
      { kind: 'toggle', name: 'r3', label: 'node 3', value: false }
    ],
    build: (v) => {
      const rings = [v.toggle('r0'), v.toggle('r1'), v.toggle('r2'), v.toggle('r3')];
      if (!rings.some(Boolean)) rings[0] = true;
      const diagram = WYTHOFF_GROUPS[v.choice('group')] ?? coxeterA4;
      return createWythoffPolytope(diagram(), rings, { radius: 1.5 }).complex;
    },
    distance: 5.6
  }
};

const WYTHOFF_GROUPS: Record<string, () => CoxeterDiagram> = {
  A4: coxeterA4,
  B4: coxeterB4,
  D4: coxeterD4,
  F4: coxeterF4,
  H4: coxeterH4
};

// The builder is read once at load, which is all an embedding iframe needs.
// Reload when the fragment changes so the page is also navigable on its own.
window.addEventListener('hashchange', () => location.reload());

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
const state: Record<string, number | boolean | string> = {};
for (const p of spec.params) state[p.name] = p.value;

const values: Values = {
  number: (name) => Number(state[name] ?? 0),
  toggle: (name) => state[name] === true,
  choice: (name) => String(state[name] ?? '')
};

const stats = document.getElementById('stats')!;
let product: ProjectedEdges3D | null = null;
let dim = 4;

/**
 * Vertices and edges of the 1-skeleton.
 *
 * `vertexCount` is the length of the position array, which for a builder that
 * compiles through a tetrahedralization also holds the centroid vertices that
 * fan decomposition introduces — 420 rather than 100 for the grand antiprism.
 * Those centroids belong to no edge, so counting the vertices the 1-cells
 * actually reference reports the polytope.
 */
const skeleton = (complex: CellComplex): { vertices: number; edges: number } => {
  const groups = complex.cellsOfDim(1);
  const referenced = new Set<number>();
  let edges = 0;
  for (const group of groups) {
    for (const index of group.indices) referenced.add(index);
    edges += group.indices.length / group.verticesPerCell;
  }
  return { vertices: referenced.size, edges };
};

function rebuild(): void {
  if (product) {
    scene.remove(product.object);
    product.object.geometry.dispose();
  }

  const complex = spec.build(values);
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
  const { vertices, edges } = skeleton(complex);
  line(vertices, 'vertices');
  line(edges, 'edges');
  line(dim, 'ambient dimensions');
}

const host = document.getElementById('controls')!;

for (const p of spec.params) {
  const row = document.createElement('div');
  row.className = 'row';

  const label = document.createElement('label');
  label.textContent = p.label;
  row.append(label);

  if (p.kind === 'toggle') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = p.value;
    input.addEventListener('change', () => {
      state[p.name] = input.checked;
      rebuild();
    });
    row.append(input);
  } else if (p.kind === 'choice') {
    const select = document.createElement('select');
    for (const option of p.options) {
      const item = document.createElement('option');
      item.value = option;
      item.textContent = option;
      select.append(item);
    }
    select.value = p.value;
    select.addEventListener('change', () => {
      state[p.name] = select.value;
      rebuild();
    });
    row.append(select);
  } else {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(p.min);
    input.max = String(p.max);
    input.step = String(p.step);
    input.value = String(p.value);

    const out = document.createElement('output');
    out.textContent = String(p.value);

    input.addEventListener('input', () => {
      state[p.name] = Number(input.value);
      out.textContent = input.value;
      rebuild();
    });
    row.append(input, out);
  }

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
