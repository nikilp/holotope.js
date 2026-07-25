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

editor.value = catalogue[selected]?.code ?? FALLBACK;

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
/** Every library export, by name, for injection into the evaluated snippet. */
const scope = new Map<string, unknown>();
for (const module of [holotopeCore, holotopeThree]) {
  for (const [name, value] of Object.entries(module)) scope.set(name, value);
}

let frameCallbacks: ((t: number) => void)[] = [];
let elapsed = 0;

function report(message: string, kind: 'error' | 'note'): void {
  output.textContent = message;
  output.dataset.kind = kind;
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

  try {
    // The snippet runs inside a block so its own declarations shadow the
    // injected names rather than colliding with them. Every library export is
    // a parameter here, and several are ordinary words — `spin`, `camera` —
    // that a reader will reasonably want as locals.
    const compiled = new Function(...names, `"use strict";\n{\n${editor.value}\n}`);
    compiled(...values);
    if (!lines.length) report('ran without error', 'note');
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
toggle.addEventListener('click', () => {
  const showing = document.body.classList.toggle('code-open');
  toggle.textContent = showing ? 'hide code' : 'show code';
  resize();
  if (showing) editor.focus();
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
