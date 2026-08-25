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
  OrthographicCamera,
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
  projectedVertices, projectionExtent
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

/** Sets a square viewBox of the given half-extent, centred on the origin. */
function setViewBox(svg: SVGSVGElement, extent: number): void {
  svg.setAttribute('viewBox', `${-extent} ${-extent} ${extent * 2} ${extent * 2}`);
}

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
      dot.setAttribute('data-corner', String(index));
      dot.setAttribute('aria-label', `corner cut from ${where?.summary ?? 'the solid'}`);
      dot.style.cursor = 'pointer';
      const show = (event?: Event): void => {
        event?.stopPropagation();
        if (where === undefined) return;
        // Stamped with the cut this corner belongs to, so a later scrub can tell
        // that the sentence on screen is describing a shape that is gone.
        provenanceLine.dataset.forOffset = String(outline.offset);
        provenanceLine.textContent = '';
        provenanceLine.append('this corner is ');
        const strong = document.createElement('b');
        strong.textContent = where.summary;
        provenanceLine.append(strong, ' of the cube — the cut recorded where it came from');
      };
      dot.addEventListener('pointerenter', show);
      dot.addEventListener('pointerdown', show);
      dot.addEventListener('focus', show);
      dot.addEventListener('click', show);
      dot.addEventListener('keydown', (event) => {
        const key = (event as KeyboardEvent).key;
        if (key === 'Enter' || key === ' ') { event.preventDefault(); show(event); }
      });
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
  if (moved === true || moved === undefined) renderLeft();
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
  fitOnAxis(width, height);
  renderLeft();
}
new ResizeObserver(resize).observe(viewHost);

/**
 * A second 3D view, for the right-hand pane.
 *
 * Scenes 4 and 6 compare two things that are both three-dimensional, and an
 * earlier draft overlaid them in one view. That was wrong for scene 6 in
 * particular: a perspective PROJECTION of a tesseract and an INTRINSIC section
 * of it live in different frames at different scales, so drawing one inside the
 * other invites "the section is inside the projection", which means nothing.
 * They get a pane each, each labelled, each with its own camera.
 */
const flatPane = document.querySelector<HTMLElement>('#flatPane')!;
const rightHost = document.createElement('div');
rightHost.id = 'rightView';
const rightRenderer = new WebGLRenderer({ antialias: true, alpha: true });
rightRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
rightHost.append(rightRenderer.domElement);

const rightScene = new Scene();
const rightCamera = new PerspectiveCamera(38, 1, 0.1, 100);
rightCamera.position.set(3.6, 2.6, 4.4);
rightCamera.lookAt(0, 0, 0);
rightScene.add(new AmbientLight(0x4a5570, 1.15));
const rightKey = new DirectionalLight(0xfff2e0, 2.0);
rightKey.position.set(4, 6, 3);
rightScene.add(rightKey);
const rightRim = new DirectionalLight(0x7fd4ff, 0.8);
rightRim.position.set(-5, -1, -4);
rightScene.add(rightRim);

const rightControls = new OrbitControls(rightCamera, rightRenderer.domElement);
rightControls.enableDamping = true;
rightControls.dampingFactor = 0.08;
rightControls.enablePan = false;
rightControls.minDistance = 2.4;
rightControls.maxDistance = 14;

let rightSpinning = false;
rightControls.addEventListener('start', () => {
  rightSpinning = true;
  requestAnimationFrame(rightSpin);
});
rightControls.addEventListener('end', () => { rightSpinning = false; });
function rightSpin(): void {
  const moved = rightControls.update();
  if (moved === true || moved === undefined) rightRenderer.render(rightScene, rightCamera);
  if (rightSpinning || moved === true) requestAnimationFrame(rightSpin);
}

function resizeRight(): void {
  const width = rightHost.clientWidth;
  const height = rightHost.clientHeight;
  if (width === 0 || height === 0) return;
  rightRenderer.setSize(width, height, false);
  rightCamera.aspect = width / height;
  rightCamera.updateProjectionMatrix();
  rightRenderer.render(rightScene, rightCamera);
}
new ResizeObserver(resizeRight).observe(rightHost);

/**
 * Scene 4's two solids and the numbers derived from them.
 *
 * Hoisted above the cameras because the on-axis view must be framed to the same
 * extent the shadow is drawn at — that congruence is the scene's whole claim.
 */
const pair = buildProjectionPair();
const pairSeparation = ambientSeparation(pair);
/** Half-extent containing the whole projection, derived from its own points. */
const PROJECTION_EXTENT = projectionExtent(pair);

/**
 * An orthographic camera looking exactly along the projection direction.
 *
 * Scene 4's whole claim is that two solids coincide under the projection the
 * scene defines — an orthographic drop of the normal component. A perspective
 * camera is a DIFFERENT map, so under it the two never coincide at any
 * distance, and an earlier draft told the visitor they would. Rather than
 * narrowing the sentence to something weaker, the scene now offers the actual
 * projection: this camera IS the map the mathematics describes, so on-axis the
 * two solids genuinely superimpose.
 */
const onAxisCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
let onAxis = false;

/**
 * Half-extent of world the on-axis view must show, matched to the shadow.
 *
 * The button's claim is that on-axis you are looking at the amber shadow, so
 * the two pictures have to be congruent — same content, same scale, same shape.
 */
const ON_AXIS_EXTENT = PROJECTION_EXTENT;

/**
 * Fits the orthographic frustum to the pane without distorting it.
 *
 * The first version left the frustum square at ±2.4 and only ever updated the
 * PERSPECTIVE camera's aspect in `resize`, so the on-axis image was stretched by
 * exactly the pane's width over its height — 4:1 on a wide pane, 1.71:1 on an
 * ordinary two-column desktop. That defeats the button: a stretched hexagon is
 * visibly not the shadow it claims to be. Widening the frustum on the long axis
 * keeps world units square in both directions and letterboxes instead.
 */
function fitOnAxis(width: number, height: number): void {
  if (width === 0 || height === 0) return;
  const aspect = width / height;
  const half = ON_AXIS_EXTENT;
  onAxisCamera.left = aspect >= 1 ? -half * aspect : -half;
  onAxisCamera.right = aspect >= 1 ? half * aspect : half;
  onAxisCamera.top = aspect >= 1 ? half : half / aspect;
  onAxisCamera.bottom = aspect >= 1 ? -half : -half / aspect;
  onAxisCamera.updateProjectionMatrix();
}

function positionOnAxis(): void {
  onAxisCamera.position.copy(normal).multiplyScalar(6);
  onAxisCamera.up.set(0, 1, 0);
  onAxisCamera.lookAt(0, 0, 0);
  fitOnAxis(viewHost.clientWidth, viewHost.clientHeight);
}

/** Renders the left pane with whichever camera the current scene wants. */
function renderLeft(): void {
  renderer.render(scene, onAxis ? onAxisCamera : camera);
}

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

  // The sentence is present tense, so it may not survive the shape it names.
  if (provenanceLine.dataset.forOffset !== undefined
    && provenanceLine.dataset.forOffset !== String(offset)) {
    delete provenanceLine.dataset.forOffset;
    provenanceLine.textContent =
      'Click or tab to a corner of this cut to see where it was cut from.';
  }
  shapeName.textContent = outline.shape;
  shapeSides.textContent = outline.sides > 0 ? `· ${outline.sides} sides` : '';
  offsetValue.textContent = offset.toFixed(3).replace('-', '−');
  planeOutline.position.copy(normal).multiplyScalar(offset);
  sideUniforms.uPlaneOffset.value = offset;
  drawSectionSolid(outline);
  renderLeft();
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
  // A corner is an inspection target, not a scrub surface. Sharing the gesture
  // meant that reading a corner's provenance moved the plane and destroyed the
  // very cut the sentence then described.
  if ((event.target as Element | null)?.closest('[data-corner]') !== null) return;
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
            + ' were on offer, and the offer was short. The flat shapes themselves never'
            + ' mentioned a single corner off the plane.'
          ]
        : [
            { text: 'It was a cube.', as: 'strong' },
            ` These three cuts do rule out ${choice.label.replace('A ', '')} — a hexagon`
            + ' is beyond it. But notice what did the ruling out: your knowledge of'
            + ' which solids exist, not the cuts. Nothing on screen showed you a single'
            + ' corner off the plane.'
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
tesseractGroup.add(tesseractWire);
// The section is an INTRINSIC object in its own 3D chart, so it lives in the
// second scene rather than inside the projection's frame.
rightScene.add(tesseractSection);

/**
 * Hidden-plane angles, in radians.
 *
 * The sliders that drive these must be able to express exactly zero, which is
 * an arithmetic property of their range and step rather than of their value
 * attribute: a range of ±1.5708 stepping by 0.01 puts the grid at
 * `-1.5708 + k·0.01`, and no `k` lands on zero — the nearest is `-0.0008`. A
 * visitor who touched a slider could therefore never return to the neutral
 * orientation, so the caption claimed a rotation forever and an exactly cubic
 * section was labelled a box beside dimensions reading 2.00 × 2.00 × 2.00. The
 * range is ±1.57 so that zero is on the grid; the 0.0008 rad of travel given up
 * at each end is not a quarter turn anyone can see.
 */
let hiddenXw = 0;
let hiddenYw = 0;

/**
 * Redraws both of scene 6's products from the current source.
 *
 * The projection goes to the left pane and the section to the right, each with
 * its own camera. They are NOT overlaid: a perspective projection and an
 * intrinsic section are different kinds of picture at different scales, and
 * nesting one in the other would invite "the section is inside the projection",
 * which is not a statement about anything.
 *
 * The caption is measured every time. An earlier draft printed a fixed sentence
 * saying the w = 0 section is a cube, which the hidden-plane sliders — the very
 * control the copy recommends — make false. Now the readout says what the
 * current geometry is, and the cube claim is qualified as the neutral
 * orientation because that is the only orientation in which it holds.
 */
function drawTesseract(offset: number): void {
  rotateHiddenPlanes(tesseract, hiddenXw, hiddenYw);
  tesseractWire.geometry.dispose();
  tesseractWire.geometry = edgeGeometry(projectedPoints(tesseract), sourceEdges(tesseract));

  const cut = sectionAtW(tesseract, offset);
  tesseractSection.geometry.dispose();
  tesseractSection.geometry = sectionBoundaryFaces(cut);
  tesseractSection.visible = cut.cellCount > 0;

  const span = sectionSpan(cut);
  const turned = hiddenXw !== 0 || hiddenYw !== 0;
  const cubic = span.every((axis) => Math.abs(axis - span[0]!) < 1e-9);
  shapeName.textContent = cut.cellCount === 0 ? 'empty' : cubic ? 'cube' : 'box';
  shapeSides.textContent = cut.cellCount === 0 ? ''
    : `· ${span.map((axis) => axis.toFixed(2)).join(' × ')}`;
  offsetValue.textContent = offset.toFixed(3).replace('-', '−');

  provenanceLine.textContent = cut.cellCount === 0
    ? 'The slicing space has left the source: there is nothing to cut.'
    : turned
      // No causal 'so': at a quarter turn the spans come back equal and the cut
      // is a cube again, which a 'so this is a box' would contradict. The
      // measured dimensions and the cube/box label stay authoritative.
      ? `Turned through a hidden plane. This cut measures`
        + ` ${span.map((axis) => axis.toFixed(2)).join(' × ')}.`
        + ' The cube-at-w-0 rule holds only in the neutral orientation.'
      : 'In the neutral orientation the section is a cube at w = 0, and empty past ±1.';
  rightRenderer.render(rightScene, rightCamera);
}

// ---------------------------------------------------------------- the lesson

/** What each pane is, named on the pane rather than left to the copy. */
const SCENE_PANES = {
  section: { left: 'The solid — a cube', right: 'The section · 2D' },
  projection: { left: 'Two solids', right: 'Their shared shadow · orthographic · 2D' },
  tesseract: {
    left: 'Perspective projection · 4D → 3D',
    right: 'Exact section · 3D, in its own frame'
  }
} as const;

/**
 * A faint window standing for the slicing space itself.
 *
 * The section is the intersection with an INFINITE slicing space, and drawing
 * only the intersection quietly suggests that space stops where the solid does.
 * The window is finite because a screen is, and faint because it is scenery:
 * what is being asserted is the cut, not the box.
 */
const sliceWindow = new LineSegments(
  new BufferGeometry(),
  new LineBasicMaterial({ color: 0x3c4657 })
);
{
  const half = 1.9;
  const points: number[] = [];
  const box = [
    [-half, -half, -half], [half, -half, -half], [half, half, -half], [-half, half, -half],
    [-half, -half, half], [half, -half, half], [half, half, half], [-half, half, half]
  ];
  const edges: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7]
  ];
  for (const [a, b] of edges) points.push(...box[a]!, ...box[b]!);
  sliceWindow.geometry.setAttribute(
    'position', new BufferAttribute(Float32Array.from(points), 3)
  );
}
sliceWindow.visible = false;
rightScene.add(sliceWindow);

/**
 * The grammar the three scenes share, stated once where it can be read.
 *
 * A section of an N-dimensional solid by an (N−1)-dimensional slicing space is
 * (N−1)-dimensional — and its BOUNDARY is one lower again. Scene 3's cut is a
 * 2D region whose boundary is the 1D polygon the eye follows; scene 6's cut is a
 * 3D solid whose boundary is the 2D surface being drawn.
 */
const GRAMMAR: Record<SceneId, string> = {
  section: '1D/0D→0D · 2D/1D→1D · 3D/2D→2D · 4D/3D→3D    here: 3D solid / 2D plane → 2D section, bounded by a 1D polygon',
  projection: 'projection drops an axis instead of intersecting one: 3D → 2D, many-to-one',
  tesseract: '1D/0D→0D · 2D/1D→1D · 3D/2D→2D · 4D/3D→3D    here: 4D solid / 3D space → 3D section, bounded by a 2D surface'
};


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
const paneTitle = document.querySelector<HTMLSpanElement>('#solidState')!;
const rightTitle = document.querySelector<HTMLSpanElement>('#rightTitle')!;
const grammarLine = document.querySelector<HTMLParagraphElement>('#grammar')!;
const hiddenRow = document.querySelector<HTMLDivElement>('#hiddenRow')!;
const xwInput = document.querySelector<HTMLInputElement>('#xw')!;
const ywInput = document.querySelector<HTMLInputElement>('#yw')!;

/**
 * The one place the stage changes, and the only place it may.
 *
 * An earlier draft let `actTwoReveal` do the cleanup for scene 3 while
 * `showScene` did a partial job for the others, so clicking a scene pill from
 * the opening quiz left the quiz's layout in place: scene 4 rendered with its
 * solid pane hidden and scene 6 rendered nothing at all. Every transition now
 * goes through here, and every transition begins by putting the stage back to a
 * known-empty state rather than by assuming where it came from.
 *
 * `resetStage` is deliberately exhaustive rather than minimal. It is cheap, it
 * runs once per transition, and a reset that lists everything cannot be wrong
 * about which scene it is leaving.
 */
function resetStage(): void {
  const panes = document.querySelector<HTMLDivElement>('#panes');
  panes?.classList.remove('guessing', 'solo');

  solid.visible = false;
  planeOutline.visible = false;
  sectionMesh.visible = false;
  sectionEdge.visible = false;
  projectionGroup.visible = false;
  tesseractGroup.visible = false;
  sliceWindow.visible = false;
  onAxis = false;

  choicesHost.textContent = '';
  provenanceLine.textContent = '';
  shapeName.textContent = '—';
  shapeSides.textContent = '';
  scrubRow.classList.add('hidden');
  hiddenRow.classList.add('hidden');
  document.querySelector<HTMLDivElement>('.shape-name')?.classList.remove('hidden');

  // The right pane hosts either the SVG or the second 3D view, never both and
  // never a leftover from the scene before.
  flatHost.textContent = '';
  rightHost.remove();
  for (const group of rightScene.children) group.visible = false;
}

function showScene(id: SceneId, fromHash = false): void {
  resetStage();
  current = id;
  if (!fromHash) history.replaceState(null, '', `#${id}`);
  for (const button of Array.from(sceneNav.querySelectorAll('button'))) {
    const active = button.dataset.scene === id;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'step' : 'false');
  }
  paneTitle.textContent = SCENE_PANES[id].left;
  rightTitle.textContent = SCENE_PANES[id].right;
  grammarLine.textContent = GRAMMAR[id];

  if (id === 'section') {
    setViewBox(liveSvg, CHART_EXTENT);
    flatHost.append(liveSvg);
    solid.visible = true;
    planeOutline.visible = true;
    scrubRow.classList.remove('hidden');
    offsetInput.min = String(-DIAGONAL_REACH);
    offsetInput.max = String(DIAGONAL_REACH);
    sentence(prompt, [
      { text: 'Push it through.', as: 'strong' },
      ' Only the plane moves. ',
      { text: 'A section is local: it forgets everything off-plane.', as: 'lesson' },
      ' The green bead leaves no trace until the plane reaches it. Drag the solid'
      + ' to look along the cut and see that it is flat.'
    ]);
    provenanceLine.textContent =
      'Drag the slider to move the plane. Click or tab to a corner to see where it was cut from.';
    setOffset(Number(offsetInput.value));
    resize();
    return;
  }

  if (id === 'projection') {
    flatHost.append(liveSvg);
    projectionGroup.visible = true;
    sentence(prompt, [
      { text: 'Now cast a shadow instead of cutting.', as: 'strong' },
      ' Two different solids are here, the cube and a warped twin, standing '
      + `${pairSeparation.toFixed(2)} apart. `,
      { text: 'A projection is many-to-one: it stacks what it cannot separate.', as: 'lesson' },
      ' The right pane is that projection — an orthographic drop along the'
      + ' diagonal — and both solids land on it identically.'
    ]);
    drawProjectionShadow();
    installOnAxisToggle();
    resize();
    return;
  }

  // tesseract: two three-dimensional products, side by side, each in its frame.
  flatPane.append(rightHost);
  tesseractGroup.visible = true;
  sliceWindow.visible = true;
  for (const group of rightScene.children) group.visible = true;
  scrubRow.classList.remove('hidden');
  hiddenRow.classList.remove('hidden');
  offsetInput.min = String(-(W_REACH + 0.2));
  offsetInput.max = String(W_REACH + 0.2);
  offsetInput.value = '0';
  sentence(prompt, [
    { text: 'One rung up.', as: 'strong' },
    ' The source is a tesseract, and neither pane is it. Left is a 3D perspective'
    + ' projection; right is the exact 3D section, drawn in its own frame inside a'
    + ' faint window standing for the infinite 3D slicing space. ',
    { text: 'The same two losses, one dimension higher.', as: 'lesson' },
    ' Slide w to move the slicing space; turn the hidden planes to rotate the'
    + ' source through directions the camera cannot reach.'
  ]);
  drawTesseract(0);
  resize();
  resizeRight();
}

/**
 * The control that makes scene 4's claim true rather than narrower.
 *
 * Pressing it swaps the left camera for one that IS the scene's projection —
 * orthographic, looking exactly along the diagonal — so the two solids
 * genuinely superimpose. Releasing it returns to the perspective view where
 * they are obviously two.
 */
function installOnAxisToggle(): void {
  const button = document.createElement('button');
  const label = (): void => {
    button.textContent = onAxis
      ? 'Turn away from the shadow direction'
      : 'Look along the shadow direction';
    button.setAttribute('aria-pressed', String(onAxis));
  };
  button.className = 'primary';
  button.addEventListener('click', () => {
    onAxis = !onAxis;
    if (onAxis) positionOnAxis();
    label();
    provenanceLine.textContent = onAxis
      ? 'On-axis, under the scene\u2019s own orthographic projection, the two solids coincide exactly.'
      : 'Off-axis, in perspective, the two solids are plainly different objects.';
    renderLeft();
  });
  label();
  choicesHost.append(button);
  provenanceLine.textContent =
    'Amber is the shared shadow. Blue is the cube; violet is the twin.';
}

/** The shared shadow, drawn into the flat pane at its own scale. */
function drawProjectionShadow(): void {
  const points = projectedVertices(pair, pair.original);
  const edges = pairEdges(pair.original);
  // The shadow reaches further than a section does, so it carries its own
  // extent rather than borrowing the section's.
  setViewBox(liveSvg, PROJECTION_EXTENT);
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
  renderLeft();
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
    /** The on-axis frustum the page computed, for the frame regression check. */
    onAxisFrustum: () => ({
      left: onAxisCamera.left, right: onAxisCamera.right,
      top: onAxisCamera.top, bottom: onAxisCamera.bottom,
      pane: [viewHost.clientWidth, viewHost.clientHeight] as [number, number]
    }),
    viewBoxOf: (): string => liveSvg.getAttribute('viewBox') ?? '',
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
