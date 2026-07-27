/**
 * Runnable code beside its result, selected by URL fragment:
 *
 *   playground.html#ProjectedEdges3D
 *
 * The starting code is the symbol's own `@example` block, read from the same
 * JSDoc the reference page renders. A snippet improved on the page is
 * therefore improved here, and the two cannot drift.
 *
 * Examples are written as they appear in documentation — no imports, and a
 * `scene` assumed to exist — so this supplies that context rather than asking
 * the examples to be rewritten for it: every library export is in scope, along
 * with a scene, a camera, and an `onFrame` hook for code that animates.
 *
 * On evaluation: the fragment selects a **key into a local catalogue**, and
 * never carries code itself. Nothing from the URL is executed, so a crafted
 * link cannot make this page run something a reader did not type. What is
 * evaluated is the contents of the editor — the reader's own code, in their
 * own page — which is what a playground is for.
 */
import {
  AmbientLight,
  Color,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as holotopeCore from '@holotope/core';
import * as holotopeThree from '@holotope/three';
import * as holotopePhysics from '@holotope/physics';
import examples from './generated-examples.json';
import './viewer-chrome.css';
import './playground.css';

interface ExampleEntry {
  readonly code: string;
  readonly alternatives: readonly string[];
}

const catalogue = examples as Record<string, ExampleEntry>;

const selected = decodeURIComponent(location.hash.slice(1)) || 'ProjectedEdges3D';
window.addEventListener('hashchange', () => location.reload());

const editor = document.getElementById('code') as HTMLTextAreaElement;
const output = document.getElementById('output')!;
const container = document.getElementById('app')!;

document.getElementById('title')!.textContent = selected;

const FALLBACK = [
  `// No example is recorded for ${selected}.`,
  '// Everything the library exports is already in scope.',
  '',
  'const product = new ProjectedEdges3D(',
  '  createHypercube({ dim: 4 }),',
  '  new PerspectiveProjection({ fromDim: 4, viewDistance: 4 })',
  ');',
  'scene.add(product.object);',
  '',
  'onFrame((t) =>',
  '  product.update(new TransformN(4, rotationFromPlanes(4, [{ i: 0, j: 3, angle: t }])))',
  ');'
].join('\n');

// A symbol documented with several `@example` blocks has each of them
// compiled, so all are known to work — reaching only the first would leave the
// rest visible on the reference page but unreachable here. They are usually
// complementary rather than redundant: one draws the figure, another states a
// count or a relation, so the choice belongs to the reader.
const entry = catalogue[selected];
const variants = entry ? [entry.code, ...entry.alternatives] : [FALLBACK];

editor.value = variants[0]!;

if (variants.length > 1) {
  const strip = document.getElementById('variants')!;
  strip.hidden = false;
  const buttons = variants.map((code, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `example ${index + 1}`;
    button.addEventListener('click', () => {
      editor.value = code;
      for (const other of buttons) other.classList.toggle('on', other === button);
      run();
    });
    strip.appendChild(button);
    return button;
  });
  buttons[0]!.classList.add('on');
}

// --- the scene the examples are written against ------------------------------
const scene = new Scene();
scene.background = new Color(0x0a0a12);
const ambient = new AmbientLight(0xffffff, 0.55);
const sun = new DirectionalLight(0xffffff, 2.0);
sun.position.set(3, 5, 4);
scene.add(ambient, sun);

const camera = new PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 0, 4.6);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;

// --- running -----------------------------------------------------------------
// Every library export, by name, for injection into the evaluated snippet.
// A Map keyed by name means a symbol re-exported by two packages is bound
// once; earlier entries win, matching the order the compile check declares
// them in, so a snippet resolves the same name in both places.
const scope = new Map<string, unknown>();
for (const module of [holotopeCore, holotopeThree, holotopePhysics]) {
  for (const [name, value] of Object.entries(module)) {
    if (!scope.has(name)) scope.set(name, value);
  }
}

let frameCallbacks: ((t: number) => void)[] = [];
let elapsed = 0;

function report(message: string, kind: 'error' | 'note'): void {
  output.textContent = message;
  output.dataset.kind = kind;
}

/**
 * A readable line for whatever the snippet evaluated to. Library objects carry
 * their own shape rather than serialising usefully, so the interesting ones are
 * summarised by what a reader would want to know about them.
 */
function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') return String(value);

  const complex = value as { ambientDim?: number; vertexCount?: number; cellsOfDim?: unknown };
  if (typeof complex.cellsOfDim === 'function' && typeof complex.vertexCount === 'number') {
    return `CellComplex — ${complex.vertexCount} stored vertices in R${complex.ambientDim}`;
  }
  // An array's contents are the answer; its indices never are. Falling through
  // to the generic branch would report `Array { 0, 1, 2, 3 }`, which describes
  // every four-element array ever produced.
  if (Array.isArray(value)) {
    const shown = value.slice(0, 6).map((entry) =>
      typeof entry === 'string' ? `'${entry}'` : describeValue(entry)
    );
    const rest = value.length > shown.length ? `, … ${value.length} in all` : '';
    return `[${shown.join(', ')}${rest}]`;
  }
  // A DataView is also a view but has no length, so read the one all of them
  // carry rather than narrowing by constructor.
  if (ArrayBuffer.isView(value)) {
    return `${value.constructor.name}(${value.byteLength} bytes)`;
  }
  const name = value.constructor?.name ?? 'object';
  const own = Object.keys(value).slice(0, 4).join(', ');
  return own ? `${name} { ${own}${Object.keys(value).length > 4 ? ', …' : ''} }` : name;
}

function run(): void {
  // A snippet is re-run from scratch rather than layered onto its leftovers.
  frameCallbacks = [];
  elapsed = 0;
  for (const child of [...scene.children]) {
    if (child !== ambient && child !== sun) scene.remove(child);
  }
  output.textContent = '';
  delete output.dataset.kind;

  const lines: string[] = [];
  const log = (...values: unknown[]): void => {
    lines.push(values.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' '));
    report(lines.join('\n'), 'note');
  };
  const onFrame = (callback: (t: number) => void): void => {
    frameCallbacks.push(callback);
  };

  const names = [...scope.keys(), 'scene', 'camera', 'renderer', 'onFrame', 'log'];
  const values = [...scope.values(), scene, camera, renderer, onFrame, log];
  const before = scene.children.length;

  try {
    // A direct `eval` inside the wrapper reads the injected names while
    // keeping the snippet's own declarations to itself, so a reader may
    // declare `spin` or `camera` even though the library exports both. It
    // also yields the value of the final expression, which is the whole
    // result for an example that computes rather than draws.
    const compiled = new Function(...names, '__source', '"use strict"; return eval(__source);');
    const result = compiled(...values, editor.value);

    const added = scene.children.length !== before;
    // A viewport is only worth showing when something was drawn into it. An
    // example that computes returns a value instead, and a black rectangle
    // beside it explains nothing — so the frame becomes code and result.
    //
    // The code is then the content rather than an alternative to it, so it is
    // opened: hiding it would leave a result and an empty frame, which is the
    // same confusion in a smaller rectangle.
    document.body.classList.toggle('no-visual', !added);
    if (!added) showCode(true);
    resize();

    if (lines.length) return;
    // `scene.add(…)` returns the scene, which is the last expression of any
    // example that ends by showing something. Reporting it back says nothing.
    const meaningful = result !== undefined && result !== scene;

    if (meaningful) {
      report(describeValue(result), 'note');
    } else if (added) {
      report('ran without error', 'note');
    } else {
      report('ran without error — this example returns no value and draws nothing', 'note');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A reader pasting TypeScript gets a syntax error that does not say why.
    const hint = /unexpected token|invalid or unexpected/i.test(message)
      ? '\n\nThe playground runs JavaScript — type annotations and `as` casts have to go.'
      : '';
    report(message + hint, 'error');
  }
}

document.getElementById('run')!.addEventListener('click', run);
editor.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    run();
  }
});

// Narrow frames show the result and keep the code behind a toggle: a split
// pane leaves too little of either to be worth having.
const toggle = document.getElementById('toggle')!;

function showCode(open: boolean): void {
  document.body.classList.toggle('code-open', open);
  toggle.textContent = open ? 'hide code' : 'show code';
}

toggle.addEventListener('click', () => {
  showCode(!document.body.classList.contains('code-open'));
  resize();
  if (document.body.classList.contains('code-open')) editor.focus();
});

// --- loop --------------------------------------------------------------------
function resize(): void {
  const width = container.clientWidth || 1;
  const height = container.clientHeight || 1;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let previous = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  elapsed += (now - previous) / 1000;
  previous = now;
  orbit.update();
  for (const callback of frameCallbacks) {
    try {
      callback(elapsed);
    } catch (error) {
      // One throwing frame would otherwise throw every frame.
      frameCallbacks = [];
      report(error instanceof Error ? error.message : String(error), 'error');
    }
  }
  renderer.render(scene, camera);
});

run();
