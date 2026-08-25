import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DRAW_ORDER } from './draw-order.js';
import {
  SCENES, sceneFromHash, chartToAmbient, edgeGeometry, sectionBoundaryFaces,
  type SceneId
} from './scenes.js';
import {
  ambientSeparation, buildProjectionPair, projectedEdges as pairEdges,
  projectedVertices
} from './projection.js';
import {
  W_REACH, buildTesseractSource, projectedPoints, rotateHiddenPlanes,
  sectionAtW, sectionSpan, sourceEdges
} from './tesseract.js';
import {
  DIAGONAL_REACH,
  SIDE_CHANGE_OFFSET,
  buildFlatlandSource,
  outlineProvenance,
  sectionOutline,
  type FlatlandOutline
} from './section.js';

/**
 * "Flatland, honestly" — scene 3 of the guided ladder.
 *
 * A cube is pushed through a plane and only the plane's view is shown first.
 * The visitor infers the solid from three cuts, then gets it revealed and can
 * push it themselves.
 *
 * The lesson is one sentence — *a section is local; it forgets everything
 * off-plane* — and the page is built so that sentence is demonstrated rather
 * than asserted. Every flat shape comes from the library's own
 * `sectionSimplexGroupN` over the cube's tetrahedralization, and every corner
 * of every flat shape can name the cube edge it was cut from, because the
 * section records that itself.
 *
 * The flat view is SVG, not WebGL. A section outline is exactly the case where
 * a one-pixel hairline is the whole image, and `linewidth` is refused by the
 * line material's validator; SVG draws a real stroke width at any zoom without
 * anyone weakening a validator to allow it.
 *
 * Text is assembled with DOM nodes rather than markup strings throughout. None
 * of it is visitor-supplied, but a page that builds sentences by concatenation
 * is one edit away from being.
 */

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const source = buildFlatlandSource();

/** Three offsets that read as a story: small, widest, small again. */
const SPECIMENS = [-1.15, 0, 1.15] as const;

const CHOICES = [
  { id: 'cube', label: 'A cube', correct: true },
  { id: 'sphere', label: 'A sphere', correct: false },
  { id: 'tetra', label: 'A tetrahedron', correct: false },
  { id: 'cylinder', label: 'A cylinder', correct: false }
] as const;

/** Builds a paragraph from plain and emphasised runs, without markup strings. */
function sentence(
  target: HTMLElement,
  runs: readonly (string | { text: string; as: 'strong' | 'lesson' | 'code' })[]
): void {
  target.textContent = '';
  for (const run of runs) {
    if (typeof run === 'string') { target.append(run); continue; }
    const element = document.createElement(run.as === 'strong' ? 'strong' : 'span');
    if (run.as === 'lesson') element.className = 'lesson';
    if (run.as === 'code') element.className = 'code';
    element.textContent = run.text;
    target.append(element);
  }
}

// ---------------------------------------------------------------- flat view

const SVG_NS = 'http://www.w3.org/2000/svg';
const flatHost = document.querySelector<HTMLDivElement>('#flat')!;
const shapeName = document.querySelector<HTMLSpanElement>('#shapeName')!;
const shapeSides = document.querySelector<HTMLSpanElement>('#shapeSides')!;
const provenanceLine = document.querySelector<HTMLParagraphElement>('#provenance')!;

/** Widest half-extent any cut reaches, so every cut is drawn to one scale. */
const CHART_EXTENT = Math.SQRT2 * 1.02;

function makeSvg(size = 260): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute(
    'viewBox',
    `${-CHART_EXTENT} ${-CHART_EXTENT} ${CHART_EXTENT * 2} ${CHART_EXTENT * 2}`
  );
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('role', 'img');
  return svg;
}

/** True where the ring genuinely turns, false at a subdivision point. */
function turnsAt(outline: FlatlandOutline, index: number): boolean {
  const ring = outline.ring;
  const before = ring[(index - 1 + ring.length) % ring.length]!;
  const at = ring[index]!;
  const after = ring[(index + 1) % ring.length]!;
  const inbound = [at[0] - before[0], at[1] - before[1]] as const;
  const outbound = [after[0] - at[0], after[1] - at[1]] as const;
  const cross = inbound[0] * outbound[1] - inbound[1] * outbound[0];
  const scale = Math.hypot(...inbound) * Math.hypot(...outbound);
  return scale > 1e-12 && Math.abs(cross / scale) > 1e-7;
}

/**
 * Draws one outline into an svg element.
 *
 * Corners are drawn only where the shape actually turns, so the subdivision
 * points the tetrahedralization introduces stay invisible — they are an
 * artifact of how the cut is computed, not features of the shape.
 */
function drawOutline(
  svg: SVGSVGElement,
  outline: FlatlandOutline,
  options: { interactive?: boolean; bead?: number | null } = {}
): void {
  svg.textContent = '';
  svg.setAttribute('aria-label', `${outline.shape} section`);
  if (outline.ring.length === 0) {
    const empty = document.createElementNS(SVG_NS, 'text');
    empty.setAttribute('x', '0');
    empty.setAttribute('y', '0');
    empty.setAttribute('text-anchor', 'middle');
    empty.setAttribute('fill', '#6b7488');
    empty.setAttribute('font-size', '0.22');
    empty.setAttribute('font-family', 'ui-monospace, Menlo, monospace');
    empty.textContent = 'the plane misses the solid';
    svg.append(empty);
    return;
  }

  const fill = document.createElementNS(SVG_NS, 'polygon');
  fill.setAttribute('points', outline.ring.map(([x, y]) => `${x},${y}`).join(' '));
  fill.setAttribute('fill', 'rgba(224,163,78,0.15)');
  fill.setAttribute('stroke', '#e0a34e');
  fill.setAttribute('stroke-width', '0.026');
  fill.setAttribute('stroke-linejoin', 'round');
  svg.append(fill);

  outline.ring.forEach((point, index) => {
    if (!turnsAt(outline, index)) return;
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', String(point[0]));
    dot.setAttribute('cy', String(point[1]));
    dot.setAttribute('r', '0.045');
    dot.setAttribute('fill', '#e0a34e');
    if (options.interactive === true) {
      const where = outlineProvenance(outline, index);
      dot.setAttribute('tabindex', '0');
      dot.setAttribute('role', 'button');
      dot.setAttribute('aria-label', `corner cut from ${where?.summary ?? 'the solid'}`);
      dot.style.cursor = 'pointer';
      const show = (): void => {
        if (where === undefined) return;
        provenanceLine.textContent = '';
        provenanceLine.append('this corner is ');
        const strong = document.createElement('b');
        strong.textContent = where.summary;
        provenanceLine.append(strong, ' of the cube — the cut recorded where it came from');
      };
      dot.addEventListener('pointerenter', show);
      dot.addEventListener('focus', show);
      dot.addEventListener('click', show);
    }
    svg.append(dot);
  });

  if (typeof options.bead === 'number') {
    const mark = document.createElementNS(SVG_NS, 'circle');
    mark.setAttribute('cx', '0');
    mark.setAttribute('cy', '0');
    mark.setAttribute('r', String(0.05 + 0.05 * options.bead));
    mark.setAttribute('fill', '#7fd6a8');
    svg.append(mark);
  }
}

const liveSvg = makeSvg();
liveSvg.setAttribute('width', '100%');
liveSvg.setAttribute('height', '100%');

// ---------------------------------------------------------------- solid view

const viewHost = document.querySelector<HTMLDivElement>('#view')!;
const renderer = new WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
viewHost.append(renderer.domElement);

const scene = new Scene();
const camera = new PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(3.4, 2.5, 4.2);
camera.lookAt(0, 0, 0);

scene.add(new AmbientLight(0x4a5570, 1.1));
const key = new DirectionalLight(0xfff2e0, 2.1);
key.position.set(4, 6, 3);
scene.add(key);
const rim = new DirectionalLight(0x7fd4ff, 0.9);
rim.position.set(-5, -1, -4);
scene.add(rim);

function cubeGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  const positions: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]): void => {
    positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  for (const s of [-1, 1]) {
    quad([-1, -1, s], [1, -1, s], [1, 1, s], [-1, 1, s]);
    quad([-1, s, -1], [1, s, -1], [1, s, 1], [-1, s, 1]);
    quad([s, -1, -1], [s, 1, -1], [s, 1, 1], [s, -1, 1]);
  }
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

function cubeEdges(): BufferGeometry {
  const geometry = new BufferGeometry();
  const positions: number[] = [];
  const corner = (index: number): number[] =>
    [0, 1, 2].map((axis) => ((index >> axis) & 1 ? 1 : -1));
  for (let a = 0; a < 8; a++) {
    for (let bit = 0; bit < 3; bit++) {
      const b = a | (1 << bit);
      if (b !== a) positions.push(...corner(a), ...corner(b));
    }
  }
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3));
  return geometry;
}


/** Unit main diagonal: the cutting plane's normal, and the axis it slides on. */
const normal = new Vector3(...source.normal);

const solid = new Group();
solid.visible = false;
scene.add(solid);
/**
 * Which side of the plane a fragment is on, decided per fragment.
 *
 * Shading the two halves differently is worth keeping — it is what shows the
 * plane bisecting the solid rather than floating in it. The rule is that the
 * DIVIDING SURFACE may be crisp, because it is a real boundary in space, while
 * the OFFSET must enter continuously, because moving the plane is not an event.
 * A fragment's side is `dot(worldPosition, normal) - offset`, so sweeping the
 * plane slides the boundary smoothly across the cube and passing zero is the
 * unremarkable moment the halves happen to be equal.
 *
 * The previous version got this backwards: it read the side from a whole-object
 * sort, which is constant across the object and flips all at once.
 */
const sideUniforms = {
  uPlaneNormal: { value: normal.clone() },
  uPlaneOffset: { value: 0 },
  uFarTint: { value: new Color('#3f6f80') },
  uNearTint: { value: new Color('#8fc6d8') }
};

const cubeMaterial = new MeshStandardMaterial({
  color: new Color('#5f93a6'),
  roughness: 0.42,
  metalness: 0.05,
  transparent: true,
  opacity: 0.42,
  side: DoubleSide,
  depthWrite: false
});
cubeMaterial.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, sideUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vFlatlandWorld;')
    .replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\n\tvFlatlandWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;'
    );
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
varying vec3 vFlatlandWorld;
uniform vec3 uPlaneNormal;
uniform float uPlaneOffset;
uniform vec3 uFarTint;
uniform vec3 uNearTint;`)
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
	{
		float side = dot(vFlatlandWorld, uPlaneNormal) - uPlaneOffset;
		// A narrow smoothstep keeps the boundary crisp without aliasing it.
		float mixAmount = smoothstep(-0.035, 0.035, side);
		diffuseColor.rgb *= mix(uFarTint, uNearTint, mixAmount);
	}`
    );
};

const cubeFaces = new Mesh(cubeGeometry(), cubeMaterial);
cubeFaces.renderOrder = DRAW_ORDER.cubeFaces;
solid.add(cubeFaces);
const cubeWire = new LineSegments(cubeEdges(), new LineBasicMaterial({ color: 0x9fd3e2 }));
cubeWire.renderOrder = DRAW_ORDER.cubeEdges;
solid.add(cubeWire);

/** The bead: a feature inside the solid that the flat view cannot see. */
const BEAD_AT = new Vector3(0.42, 0.42, 0.42);
const bead = new Mesh(
  new SphereGeometry(0.085, 24, 16),
  new MeshStandardMaterial({
    color: new Color('#7fd6a8'), roughness: 0.3, emissive: new Color('#1d5c40')
  })
);
bead.position.copy(BEAD_AT);
solid.add(bead);



/** Two orthonormal in-plane directions, for the frame and its grid. */
function planeBasis(n: Vector3): [Vector3, Vector3] {
  const seed = Math.abs(n.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  const u = seed.clone().sub(n.clone().multiplyScalar(seed.dot(n))).normalize();
  return [u, new Vector3().crossVectors(n, u).normalize()];
}

/** The cutting plane as a diagram: one square outline plus a sparse grid. */
function planeFrameGeometry(): BufferGeometry {
  const [u, v] = planeBasis(normal);
  const half = 1.35;
  const points: number[] = [];
  const at = (a: number, b: number): number[] => [
    u.x * a + v.x * b, u.y * a + v.y * b, u.z * a + v.z * b
  ];
  const corners = [at(-half, -half), at(half, -half), at(half, half), at(-half, half)];
  for (let i = 0; i < 4; i++) points.push(...corners[i]!, ...corners[(i + 1) % 4]!);
  for (let k = -2; k <= 2; k++) {
    const t = (k / 3) * half * 1.5;
    points.push(...at(t, -half), ...at(t, half));
    points.push(...at(-half, t), ...at(half, t));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(points), 3));
  return geometry;
}

const planeOutline = new LineSegments(
  planeFrameGeometry(),
  new LineBasicMaterial({ color: 0x8a6a3c })
);
planeOutline.renderOrder = DRAW_ORDER.planeFrame;
planeOutline.visible = false;
scene.add(planeOutline);

/**
 * The cut itself, as the section's own triangles, drawn the way the flat pane
 * draws it: a muted fill carrying a bright boundary.
 *
 * Opaque, so it is never sorted against anything. The fill is deliberately dark
 * — a bright one is geometrically honest but reads as a solid amber mass filling
 * the cube, because a mid-cut really does cover most of the silhouette from a
 * general angle. The boundary line is what should carry the shape, and it is the
 * same amber the flat pane strokes with, so the two views read as one object.
 */
const sectionMesh = new Mesh(
  new BufferGeometry(),
  new MeshBasicMaterial({
    color: new Color('#6d5029'),
    side: DoubleSide,
    // The boundary line is exactly coplanar with this fill, so without a nudge
    // the two z-fight and the line disappears in patches.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1
  })
);
sectionMesh.renderOrder = DRAW_ORDER.section;
sectionMesh.visible = false;
scene.add(sectionMesh);

const sectionEdge = new LineSegments(
  new BufferGeometry(),
  new LineBasicMaterial({ color: 0xe0a34e })
);
sectionEdge.renderOrder = DRAW_ORDER.section;
sectionEdge.visible = false;
scene.add(sectionEdge);

/** Rebuilds the 3D cut from the section the flat pane is already showing. */
function drawSectionSolid(outline: ReturnType<typeof sectionOutline>): void {
  const result = outline.result;
  if (result.cellCount === 0) {
    sectionMesh.visible = false;
    sectionEdge.visible = false;
    return;
  }
  const points = new Float32Array(result.cellCount * 9);
  for (let cell = 0; cell < result.cellCount; cell++) {
    for (let corner = 0; corner < 3; corner++) {
      const vertex = result.cells[cell * 3 + corner]!;
      for (let axis = 0; axis < 3; axis++) {
        points[cell * 9 + corner * 3 + axis] = result.ambientPositions[vertex * 3 + axis]!;
      }
    }
  }
  sectionMesh.geometry.dispose();
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(points, 3));
  sectionMesh.geometry = geometry;
  sectionMesh.visible = true;

  // The boundary ring the flat pane already walked, drawn in place.
  const ring = outline.ringVertices;
  const edge = new Float32Array(ring.length * 6);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    for (let axis = 0; axis < 3; axis++) {
      edge[i * 6 + axis] = result.ambientPositions[a * 3 + axis]!;
      edge[i * 6 + 3 + axis] = result.ambientPositions[b * 3 + axis]!;
    }
  }
  sectionEdge.geometry.dispose();
  const edgeGeometry = new BufferGeometry();
  edgeGeometry.setAttribute('position', new BufferAttribute(edge, 3));
  sectionEdge.geometry = edgeGeometry;
  sectionEdge.visible = true;
}

/**
 * Orbiting the solid, so the cut can be inspected edge-on and face-on.
 *
 * Worth having because the section's shape is easiest to believe when you can
 * look along the plane and see it is genuinely flat. The camera is the only
 * thing this moves: the side shading is decided in world space from the plane
 * itself, so orbiting never changes which half of the cube reads as near.
 *
 * Rendering stays on demand. `update()` reports whether the camera actually
 * moved, so an idle page draws nothing.
 */
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 2.6;
controls.maxDistance = 12;
controls.rotateSpeed = 0.85;

let orbiting = false;
controls.addEventListener('start', () => {
  orbiting = true;
  requestAnimationFrame(spin);
});
controls.addEventListener('end', () => { orbiting = false; });

function spin(): void {
  const moved = controls.update();
  if (moved === true || moved === undefined) renderer.render(scene, camera);
  // Keep turning while the user drags, and afterwards until damping settles.
  if (orbiting || moved === true) requestAnimationFrame(spin);
}

function resize(): void {
  const width = viewHost.clientWidth;
  const height = viewHost.clientHeight;
  if (width === 0 || height === 0) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}
new ResizeObserver(resize).observe(viewHost);

// ---------------------------------------------------------------- state

const offsetInput = document.querySelector<HTMLInputElement>('#offset')!;
const offsetValue = document.querySelector<HTMLSpanElement>('#offsetValue')!;
const prompt = document.querySelector<HTMLParagraphElement>('#prompt')!;
const choicesHost = document.querySelector<HTMLDivElement>('#choices')!;
const scrubRow = document.querySelector<HTMLDivElement>('#scrubRow')!;
const solidState = document.querySelector<HTMLSpanElement>('#solidState')!;

let recutMs = 0;

function setOffset(offset: number): void {
  const started = performance.now();
  const outline = sectionOutline(source, offset);
  recutMs = performance.now() - started;

  const beadDistance = Math.abs(BEAD_AT.dot(normal) - offset);
  const beadShown = beadDistance < 0.09 ? 1 - beadDistance / 0.09 : null;
  drawOutline(liveSvg, outline, { interactive: true, bead: beadShown });

  shapeName.textContent = outline.shape;
  shapeSides.textContent = outline.sides > 0 ? `· ${outline.sides} sides` : '';
  offsetValue.textContent = offset.toFixed(3).replace('-', '−');
  planeOutline.position.copy(normal).multiplyScalar(offset);
  sideUniforms.uPlaneOffset.value = offset;
  drawSectionSolid(outline);
  renderer.render(scene, camera);
}

offsetInput.addEventListener('input', () => {
  const value = Number(offsetInput.value);
  if (current === 'tesseract') {
    drawTesseract(value);
    renderer.render(scene, camera);
    return;
  }
  setOffset(value);
});

// Drag anywhere on the flat pane to scrub, so touch has a direct path.
let dragging = false;
const scrubFromPointer = (event: PointerEvent): void => {
  const box = flatHost.getBoundingClientRect();
  const t = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
  const offset = -DIAGONAL_REACH + t * 2 * DIAGONAL_REACH;
  offsetInput.value = String(offset);
  setOffset(offset);
};
flatHost.addEventListener('pointerdown', (event) => {
  if (scrubRow.classList.contains('hidden')) return;
  dragging = true;
  flatHost.setPointerCapture(event.pointerId);
  scrubFromPointer(event);
});
flatHost.addEventListener('pointermove', (event) => { if (dragging) scrubFromPointer(event); });
flatHost.addEventListener('pointerup', () => { dragging = false; });
flatHost.addEventListener('pointercancel', () => { dragging = false; });

// ---------------------------------------------------------------- acts

function actTwoReveal(): void {
  choicesHost.textContent = '';
  flatHost.textContent = '';
  flatHost.append(liveSvg);
  solid.visible = true;
  planeOutline.visible = true;
  document.querySelector<HTMLDivElement>('#panes')?.classList.remove('guessing');
  resize();
  document.querySelector<HTMLDivElement>('.shape-name')?.classList.remove('hidden');
  solidState.textContent = '— a cube, all along';
  scrubRow.classList.remove('hidden');
  sentence(prompt, [
    { text: 'Push it through.', as: 'strong' },
    ' Only the plane moves. ',
    { text: 'A section is local: it forgets everything off-plane.', as: 'lesson' },
    ' The green bead inside the cube leaves no trace in the flat view until the plane'
    + ' reaches it. Drag the solid to look along the cut and see that it is flat.'
  ]);
  provenanceLine.textContent =
    'Drag the flat view or use the slider. Hover a corner to see where it was cut from.';
  const onward = document.createElement('button');
  onward.textContent = 'Next: projection →';
  onward.className = 'primary';
  onward.addEventListener('click', () => showScene('projection'));
  choicesHost.append(onward);

  const from = -DIAGONAL_REACH;
  const to = 0;
  if (reducedMotion) {
    offsetInput.value = String(to);
    setOffset(to);
    return;
  }
  const startedAt = performance.now();
  const sweep = (): void => {
    const t = Math.min(1, (performance.now() - startedAt) / 1400);
    const eased = t * t * (3 - 2 * t);
    const offset = from + (to - from) * eased;
    offsetInput.value = String(offset);
    setOffset(offset);
    if (t < 1) requestAnimationFrame(sweep);
  };
  requestAnimationFrame(sweep);
}

function actOneGuess(): void {
  document.querySelector<HTMLDivElement>('.shape-name')?.classList.add('hidden');
  document.querySelector<HTMLDivElement>('#panes')?.classList.add('guessing');

  const strip = document.createElement('div');
  strip.className = 'specimens';
  SPECIMENS.forEach((offset, index) => {
    const figure = document.createElement('figure');
    const svg = makeSvg(220);
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    drawOutline(svg, sectionOutline(source, offset));
    const caption = document.createElement('figcaption');
    caption.textContent = `cut ${index + 1}`;
    figure.append(svg, caption);
    strip.append(figure);
  });
  flatHost.append(strip);

  for (const choice of CHOICES) {
    const button = document.createElement('button');
    button.textContent = choice.label;
    button.addEventListener('click', () => {
      button.classList.add(choice.correct ? 'right' : 'wrong');
      for (const other of Array.from(choicesHost.querySelectorAll('button'))) {
        other.disabled = true;
        if (!other.classList.contains('right') && !other.classList.contains('wrong')) {
          other.style.opacity = '0.4';
        }
      }
      sentence(prompt, choice.correct
        ? [
            { text: 'A cube.', as: 'strong' },
            ' Three cuts were enough — but only because you already knew which solids'
            + ' were on offer. The flat shapes never mentioned the corners off the plane.'
          ]
        : [
            { text: 'It was a cube.', as: 'strong' },
            ` ${choice.label.replace('A ', '')} is a fair guess: nothing in three flat`
            + ' shapes rules it out. That is the point — each cut only ever reported the'
            + ' plane it was on.'
          ]);
      const go = document.createElement('button');
      go.textContent = 'Show me the solid →';
      go.className = 'primary';
      go.addEventListener('click', actTwoReveal);
      choicesHost.append(go);
      go.focus();
    });
    choicesHost.append(button);
  }
}

// ---------------------------------------------------------------- scene 4

/**
 * Scene 4 — two solids, one shadow.
 *
 * The cube from scene 3 and a twin displaced along the projection direction
 * alone. Their shadows agree to about 1e-16 while they stand about 1 apart, so
 * from the projection direction the view cannot separate them and one orbit
 * away it obviously can. The flat pane draws the single shared shadow.
 */
const projectionGroup = new Group();
projectionGroup.visible = false;
scene.add(projectionGroup);

const pair = buildProjectionPair();
const pairSeparation = ambientSeparation(pair);
{
  const readPoints = (complex: typeof pair.original): number[][] => {
    const out: number[][] = [];
    for (let v = 0; v < complex.vertexCount; v++) {
      out.push([
        complex.positions[v * 3]!, complex.positions[v * 3 + 1]!, complex.positions[v * 3 + 2]!
      ]);
    }
    return out;
  };
  const edges = pairEdges(pair.original);
  const cube = new LineSegments(
    edgeGeometry(readPoints(pair.original), edges),
    new LineBasicMaterial({ color: 0x9fd3e2 })
  );
  const twin = new LineSegments(
    edgeGeometry(readPoints(pair.twin), edges),
    new LineBasicMaterial({ color: 0xc98be0 })
  );
  projectionGroup.add(cube, twin);

  // The shadow itself, drawn in the plane so the coincidence is visible in 3D
  // too rather than only in the flat pane.
  const [u, v] = pair.slice.basis;
  const shadow = new LineSegments(
    edgeGeometry(
      chartToAmbient(projectedVertices(pair, pair.original), Array.from(u!), Array.from(v!)),
      edges
    ),
    new LineBasicMaterial({ color: 0xe0a34e })
  );
  projectionGroup.add(shadow);
}

// ---------------------------------------------------------------- scene 6

/**
 * Scene 6 — the same two maps, one dimension up.
 *
 * A tesseract is the source. The view shows a 3D perspective PROJECTION of it
 * and an exact 3D SECTION through it. Neither is the tesseract; both are
 * representations of one authoritative 4D source.
 */
const tesseractGroup = new Group();
tesseractGroup.visible = false;
scene.add(tesseractGroup);

const tesseract = buildTesseractSource();
const tesseractWire = new LineSegments(
  new BufferGeometry(),
  new LineBasicMaterial({ color: 0x9fd3e2 })
);
const tesseractSection = new Mesh(new BufferGeometry(), new MeshStandardMaterial({
  color: new Color('#6d5029'),
  roughness: 0.5,
  side: DoubleSide,
  transparent: false
}));
tesseractSection.renderOrder = DRAW_ORDER.section;
tesseractGroup.add(tesseractWire, tesseractSection);

let hiddenXw = 0;
let hiddenYw = 0;

function drawTesseract(offset: number): void {
  rotateHiddenPlanes(tesseract, hiddenXw, hiddenYw);
  tesseractWire.geometry.dispose();
  tesseractWire.geometry = edgeGeometry(projectedPoints(tesseract), sourceEdges(tesseract));
  const cut = sectionAtW(tesseract, offset);
  tesseractSection.geometry.dispose();
  tesseractSection.geometry = sectionBoundaryFaces(cut);
  tesseractSection.visible = cut.cellCount > 0;

  const span = sectionSpan(cut);
  shapeName.textContent = cut.cellCount === 0 ? 'empty'
    : span.every((axis) => Math.abs(axis - span[0]!) < 1e-9) ? 'cube' : 'box';
  shapeSides.textContent = cut.cellCount === 0 ? ''
    : `· ${span.map((axis) => axis.toFixed(2)).join(' × ')}`;
  offsetValue.textContent = offset.toFixed(3).replace('-', '−');
}

// ---------------------------------------------------------------- the lesson

/**
 * One lesson in three scenes, not three pages.
 *
 * Section forgets → projection overlaps → the distinction transfers one
 * dimension upward. The chrome, the two panes, the amber-cut vocabulary and the
 * orbit are shared throughout; only the source and the map into the flat view
 * change. Scene 3 remains the page's landing scene so its route and tests are
 * unaffected, and `#projection` / `#tesseract` address the others directly.
 */
let current: SceneId = 'section';

const sceneNav = document.querySelector<HTMLDivElement>('#sceneNav')!;
const hiddenRow = document.querySelector<HTMLDivElement>('#hiddenRow')!;
const xwInput = document.querySelector<HTMLInputElement>('#xw')!;
const ywInput = document.querySelector<HTMLInputElement>('#yw')!;

function showScene(id: SceneId, fromHash = false): void {
  current = id;
  if (!fromHash) history.replaceState(null, '', `#${id}`);
  for (const button of Array.from(sceneNav.querySelectorAll('button'))) {
    const active = button.dataset.scene === id;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'step' : 'false');
  }
  solid.visible = id === 'section';
  planeOutline.visible = id === 'section';
  sectionMesh.visible = false;
  sectionEdge.visible = false;
  projectionGroup.visible = id === 'projection';
  tesseractGroup.visible = id === 'tesseract';
  hiddenRow.classList.toggle('hidden', id !== 'tesseract');
  const panes = document.querySelector<HTMLDivElement>('#panes');
  panes?.classList.toggle('solo', id === 'tesseract');
  if (id !== 'tesseract') resize();
  choicesHost.textContent = '';
  provenanceLine.textContent = '';

  if (id === 'section') {
    document.querySelector<HTMLDivElement>('#panes')?.classList.remove('guessing');
    scrubRow.classList.remove('hidden');
    offsetInput.min = String(-DIAGONAL_REACH);
    offsetInput.max = String(DIAGONAL_REACH);
    solidState.textContent = '— a cube';
    sentence(prompt, [
      { text: 'Push it through.', as: 'strong' },
      ' Only the plane moves. ',
      { text: 'A section is local: it forgets everything off-plane.', as: 'lesson' },
      ' The green bead leaves no trace until the plane reaches it. Drag the solid'
      + ' to look along the cut and see that it is flat.'
    ]);
    provenanceLine.textContent =
      'Drag the flat view or use the slider. Hover a corner to see where it was cut from.';
    setOffset(Number(offsetInput.value));
    return;
  }

  if (id === 'projection') {
    scrubRow.classList.add('hidden');
    solidState.textContent = '— two solids';
    sentence(prompt, [
      { text: 'Now cast a shadow instead of cutting.', as: 'strong' },
      ' Two different solids are here, the cube and a warped twin. ',
      { text: 'A projection is many-to-one: it stacks what it cannot separate.', as: 'lesson' },
      ` Their shadows agree to about 1e-16 while the solids stand ${pairSeparation.toFixed(2)}`
      + ' apart. Orbit the view: from the shadow direction they are one object, and'
      + ' from anywhere else they never were.'
    ]);
    provenanceLine.textContent =
      'Amber is the shared shadow. Blue is the cube; violet is the twin.';
    drawProjectionShadow();
    renderer.render(scene, camera);
    return;
  }

  // tesseract
  scrubRow.classList.remove('hidden');
  offsetInput.min = String(-(W_REACH + 0.2));
  offsetInput.max = String(W_REACH + 0.2);
  offsetInput.value = '0';
  solidState.textContent = '— a 3D projection and an exact 3D section of one 4D source';
  sentence(prompt, [
    { text: 'One rung up.', as: 'strong' },
    ' The source is a tesseract, and neither thing on screen is it: the wireframe'
    + ' is a 3D perspective projection, the solid is an exact 3D section. ',
    { text: 'The same two losses, one dimension higher.', as: 'lesson' },
    ' Slide w to move the cutting space; turn the hidden planes to rotate the'
    + ' source through directions the camera cannot reach.'
  ]);
  provenanceLine.textContent =
    'At w = 0 the section is a cube. Past ±1 there is nothing left to cut.';
  drawTesseract(0);
  resize();
  renderer.render(scene, camera);
}

/** The shared shadow, drawn into the flat pane. */
function drawProjectionShadow(): void {
  const points = projectedVertices(pair, pair.original);
  const edges = pairEdges(pair.original);
  liveSvg.textContent = '';
  liveSvg.setAttribute('aria-label', 'the shadow both solids cast');
  for (const [a, b] of edges) {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(points[a]![0]));
    line.setAttribute('y1', String(points[a]![1]));
    line.setAttribute('x2', String(points[b]![0]));
    line.setAttribute('y2', String(points[b]![1]));
    line.setAttribute('stroke', '#e0a34e');
    line.setAttribute('stroke-width', '0.026');
    svgAppend(line);
  }
  shapeName.textContent = 'one shadow';
  shapeSides.textContent = '· two solids';
}

const svgAppend = (node: SVGElement): void => { liveSvg.append(node); };

for (const scene of SCENES) {
  const button = document.createElement('button');
  button.textContent = scene.label;
  button.dataset.scene = scene.id;
  button.addEventListener('click', () => showScene(scene.id));
  sceneNav.append(button);
}
addEventListener('hashchange', () => showScene(sceneFromHash(location.hash), true));

const readHidden = (): void => {
  hiddenXw = Number(xwInput.value);
  hiddenYw = Number(ywInput.value);
  drawTesseract(Number(offsetInput.value));
  renderer.render(scene, camera);
};
xwInput.addEventListener('input', readHidden);
ywInput.addEventListener('input', readHidden);

// ---------------------------------------------------------------- boot

resize();
setOffset(-DIAGONAL_REACH);
if (location.hash === '' || sceneFromHash(location.hash) === 'section') {
  actOneGuess();
} else {
  flatHost.textContent = '';
  flatHost.append(liveSvg);
  showScene(sceneFromHash(location.hash), true);
}

/** Exposed for the page's own tests and for measurement, never for control. */
Object.assign(globalThis, {
  __flatland: {
    outlineAt: (offset: number) => sectionOutline(source, offset),
    setOffset: (offset: number) => { offsetInput.value = String(offset); setOffset(offset); },
    reveal: () => actTwoReveal(),
    scene: () => scene,
    camera: () => camera,
    sampleFrame: (): { mean: number[]; canvas: number[] } => {
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const pixels = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        r += pixels[i]!; g += pixels[i + 1]!; b += pixels[i + 2]!; n++;
      }
      return { mean: [r / n, g / n, b / n], canvas: [w, h] };
    },
    lastRecutMs: () => recutMs,
    sideChangeOffset: SIDE_CHANGE_OFFSET
  }
});
