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
import {
  type NumericParam,
  type Param,
  type Values,
  bindControls,
  reportCounts,
  reportFailure,
  selectedEntry,
  setTitle
} from './viewer-ui';

interface PolytopeSpec {
  readonly params: readonly Param[];
  /**
   * A single complex, or a family. Some constructions carry their meaning
   * only in a family: one Hopf fibre is a circle, and what distinguishes the
   * fibration is that distinct fibres link.
   */
  readonly build: (v: Values) => CellComplex | readonly CellComplex[];
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
    // Every fibre is a circle, so one of them shows nothing that
    // distinguishes the fibration. What does is the relation between fibres:
    // any two are linked, and the fibres over a circle of latitude on the
    // base 2-sphere sweep a torus. The controls therefore choose a latitude
    // and how many base points to take around it — one fibre each.
    params: [
      { name: 'latitude', label: 'latitude', min: 5, max: 175, step: 1, value: 60 },
      { name: 'fibers', label: 'fibres', min: 1, max: 24, step: 1, value: 10 }
    ],
    build: (v) => {
      const theta = (v.number('latitude') * Math.PI) / 180;
      const count = v.number('fibers');
      const family: CellComplex[] = [];
      for (let k = 0; k < count; k++) {
        const phi = (k / count) * 2 * Math.PI;
        family.push(
          createHopfFiber({
            base: [
              Math.sin(theta) * Math.cos(phi),
              Math.sin(theta) * Math.sin(phi),
              Math.cos(theta)
            ],
            segments: 192
          })
        );
      }
      return family;
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

const selected = selectedEntry('createHypercube');
const registered = SPECS[selected];

if (!registered) {
  reportFailure(`No viewer is registered for "${selected}".`);
  throw new Error(`polytope-browser: unknown builder ${selected}`);
}
const spec: PolytopeSpec = registered;
setTitle(selected);

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

const materials: LineBasicMaterial[] = [];

/** One material per family member; a single complex keeps the base colour. */
const materialFor = (index: number, total: number): LineBasicMaterial => {
  if (!materials[index]) {
    const color = new Color();
    if (total === 1) color.setHex(0x8fb6ff);
    else color.setHSL((index / total) * 0.8, 0.62, 0.66);
    materials[index] = new LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
  }
  return materials[index]!;
};

// --- parameters -------------------------------------------------------------
const values: Values = bindControls(spec.params, () => rebuild());

let products: ProjectedEdges3D[] = [];
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
  for (const previous of products) {
    scene.remove(previous.object);
    previous.object.geometry.dispose();
  }
  products = [];

  const built = spec.build(values);
  const family = Array.isArray(built) ? (built as readonly CellComplex[]) : [built as CellComplex];
  dim = family[0]!.ambientDim;

  // A projection is defined from one ambient dimension, so it is rebuilt with
  // the complex rather than reused when `dim` is among the parameters.
  const projection = new PerspectiveProjection({ fromDim: dim, viewDistance: 3.2 });
  let vertices = 0;
  let edges = 0;
  family.forEach((complex, index) => {
    const product = new ProjectedEdges3D(complex, projection, {
      material: materialFor(index, family.length)
    });
    scene.add(product.object);
    products.push(product);
    const counts = skeleton(complex);
    vertices += counts.vertices;
    edges += counts.edges;
  });

  reportCounts([
    ...(family.length > 1 ? ([[family.length, 'components']] as const) : []),
    [vertices, 'vertices'],
    [edges, 'edges'],
    [dim, 'ambient dimensions']
  ]);
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

  if (products.length) {
    // One rotation in the plane of the first and last axes, and a slower one
    // among the retained axes so the solid also turns in view.
    const planes = [{ i: 0, j: dim - 1, angle }];
    if (dim >= 4) planes.push({ i: 1, j: 2, angle: angle * 0.55 });
    const transform = new TransformN(dim, rotationFromPlanes(dim, planes));
    for (const product of products) product.update(transform);
  }

  renderer.render(scene, camera);
});
