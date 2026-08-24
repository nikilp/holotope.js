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
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer
} from 'three';
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

const solid = new Group();
solid.visible = false;
scene.add(solid);
solid.add(new Mesh(cubeGeometry(), new MeshStandardMaterial({
  color: new Color('#5f93a6'),
  roughness: 0.42,
  metalness: 0.05,
  transparent: true,
  opacity: 0.5,
  side: DoubleSide
})));
solid.add(new LineSegments(cubeEdges(), new LineBasicMaterial({ color: 0x9fd3e2 })));

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

const normal = new Vector3(...source.normal);
const planeMesh = new Mesh(new PlaneGeometry(2.9, 2.9), new MeshStandardMaterial({
  color: new Color('#e0a34e'),
  transparent: true,
  opacity: 0.22,
  side: DoubleSide,
  roughness: 0.9
}));
planeMesh.lookAt(normal);
planeMesh.visible = false;
scene.add(planeMesh);

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
  planeMesh.position.copy(normal).multiplyScalar(offset);
  renderer.render(scene, camera);
}

offsetInput.addEventListener('input', () => setOffset(Number(offsetInput.value)));

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
  planeMesh.visible = true;
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
    + ' reaches it.'
  ]);
  provenanceLine.textContent =
    'Drag the flat view or use the slider. Hover a corner to see where it was cut from.';

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

// ---------------------------------------------------------------- boot

resize();
setOffset(-DIAGONAL_REACH);
actOneGuess();

/** Exposed for the page's own tests and for measurement, never for control. */
Object.assign(globalThis, {
  __flatland: {
    outlineAt: (offset: number) => sectionOutline(source, offset),
    lastRecutMs: () => recutMs,
    sideChangeOffset: SIDE_CHANGE_OFFSET
  }
});
