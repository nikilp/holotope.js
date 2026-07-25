/**
 * Collect the `@example` blocks out of the packages' JSDoc so the playground
 * can start from them.
 *
 * The examples are documentation first: they are what a reader sees on the
 * reference page. Reading them from the same comments rather than restating
 * them here keeps one source of truth, so a snippet cannot be improved on the
 * page and left stale in the playground.
 *
 *   node scripts/extract-examples.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOWCASE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(path.dirname(SHOWCASE));
const OUT = path.join(SHOWCASE, 'src/generated-examples.json');
const CHECK = path.join(SHOWCASE, 'src/generated-example-check.ts');

const sources = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.ts')) sources.push(full);
  }
};
for (const pkg of ['core', 'three', 'physics']) {
  const dir = path.join(REPO, 'packages', pkg, 'src');
  if (fs.existsSync(dir)) walk(dir);
}

/** The declaration a doc comment sits above, which is the symbol it documents. */
const declaredName = (after) =>
  after.match(
    /^\s*(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:class|function|interface|const|type)\s+([A-Za-z0-9_]+)/
  )?.[1] ?? null;

const examples = {};

for (const file of sources) {
  const text = fs.readFileSync(file, 'utf8');
  // Every doc comment, with whatever follows it.
  for (const match of text.matchAll(/\/\*\*([\s\S]*?)\*\/\s*([^\n]*)/g)) {
    const [, comment, following] = match;
    if (!comment.includes('@example')) continue;

    let symbol = declaredName(following);
    if (!symbol && /^\s*constructor\s*\(/.test(following)) {
      // Walk back to the enclosing class declaration.
      const before = text.slice(0, match.index);
      symbol = [...before.matchAll(/export\s+(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/g)].pop()?.[1] ?? null;
    }
    if (!symbol) continue;

    const body = comment.replace(/^[ \t]*\*[ \t]?/gm, '');
    const blocks = [...body.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1].trimEnd());
    if (!blocks.length) continue;

    // Several @example blocks on one symbol are alternatives; the first is the
    // one a reader meets, so it seeds the playground.
    examples[symbol] = { code: blocks[0], alternatives: blocks.slice(1) };
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(examples, null, 2) + '\n');
console.log(
  `extract-examples: ${Object.keys(examples).length} symbols with examples -> ${path.relative(SHOWCASE, OUT)}`
);

// --- a file the compiler can check ------------------------------------------
/**
 * The examples are also written out as TypeScript, one function each, so the
 * package's own typecheck compiles them.
 *
 * Running them in a browser catches an example that throws. Compiling them
 * catches the quieter kind: a method that does not exist, a call with the
 * wrong number of arguments, an overload satisfied by neither form. Those read
 * correctly and are invisible to review — every one of them reached the
 * published site before this file existed.
 *
 * Names are read from the package barrels rather than a maintained list, so a
 * snippet using a newly exported symbol needs no change here.
 */
const exportedNames = (barrel) => {
  const names = new Set();
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file) || !fs.existsSync(file)) return;
    seen.add(file);
    const text = fs.readFileSync(file, 'utf8');
    // `export * from './x.js'` — follow it.
    for (const m of text.matchAll(/export\s+\*\s+from\s+'([^']+)'/g)) {
      visit(path.join(path.dirname(file), m[1].replace(/\.js$/, '.ts')));
    }
    // `export { a, type B } from './x.js'` — take the value names only, since
    // a type cannot be destructured at runtime.
    for (const m of text.matchAll(/export\s*\{([^}]*)\}\s*from/g)) {
      for (const raw of m[1].split(',')) {
        const name = raw.trim();
        if (!name || name.startsWith('type ')) continue;
        names.add(name.split(/\s+as\s+/).pop().trim());
      }
    }
  };
  visit(barrel);
  return [...names].filter((n) => /^[A-Za-z_$][\w$]*$/.test(n)).sort();
};

const coreNames = exportedNames(path.join(REPO, 'packages/core/src/index.ts'));
const threeNames = exportedNames(path.join(REPO, 'packages/three/src/index.ts'));

const safe = (symbol) => symbol.replace(/[^\w]/g, '_');
const bodies = Object.entries(examples).flatMap(([symbol, entry]) =>
  [entry.code, ...entry.alternatives].map((code, index) => {
    const name = `example_${safe(symbol)}${index ? `_${index}` : ''}`;
    // The snippet sits in a block so its own declarations shadow the names
    // brought into scope rather than colliding with them.
    return [
      `/** Compiles the \`${symbol}\` example exactly as the reference renders it. */`,
      `export function ${name}(): void {`,
      `  const { ${coreNames.join(', ')} } = core;`,
      `  const { ${threeNames.join(', ')} } = three;`,
      `  void [${[...coreNames, ...threeNames].join(', ')}];`,
      '  {',
      code.split('\n').map((line) => `    ${line}`).join('\n'),
      '  }',
      '}'
    ].join('\n');
  })
);

const header = [
  '// Generated by scripts/extract-examples.mjs — do not edit.',
  '//',
  '// Each function is one @example block from the packages\' JSDoc, compiled',
  '// against the real types so a wrong method name, a wrong argument count, or',
  '// an unsatisfiable overload fails the build instead of the reader.',
  '',
  "import * as core from '@holotope/core';",
  "import * as three from '@holotope/three';",
  "import type { Scene, PerspectiveCamera, WebGLRenderer } from 'three';",
  '',
  '// The context the examples are written against, and which the playground',
  '// supplies at run time.',
  'declare const scene: Scene;',
  'declare const camera: PerspectiveCamera;',
  'declare const renderer: WebGLRenderer;',
  'declare function onFrame(callback: (t: number) => void): void;',
  'declare function log(...values: unknown[]): void;',
  'void [scene, camera, renderer, onFrame, log];',
  ''
].join('\n');

fs.writeFileSync(CHECK, header + '\n' + bodies.join('\n\n') + '\n');
console.log(
  `extract-examples: ${bodies.length} example(s) written for compilation -> ${path.relative(SHOWCASE, CHECK)}`
);
