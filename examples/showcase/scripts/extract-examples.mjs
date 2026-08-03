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
import vm from 'node:vm';

const SHOWCASE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(path.dirname(SHOWCASE));
const OUT = path.join(SHOWCASE, 'src/generated-examples.json');
const CHECK = path.join(SHOWCASE, 'src/generated-example-check.ts');

const sources = [];
const compileOnlyFiles = new Set();
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.ts')) sources.push(full);
  }
};
/**
 * Packages whose examples are read, and whether the playground can run them.
 *
 * The experiment packages are compile-checked but not offered in the
 * playground: their examples prepare a document, which is asynchronous, and
 * the runner evaluates a snippet for its completion value rather than awaiting
 * one. Listing them would advertise entries that cannot run.
 */
const PACKAGES = [
  { name: 'core', playground: true },
  { name: 'three', playground: true },
  { name: 'physics', playground: true },
  { name: 'experiment', playground: false },
  { name: 'experiment-physics', playground: false }
];

/** Symbols whose examples are compiled but withheld from the playground. */
const compileOnly = new Set();

for (const pkg of PACKAGES) {
  const dir = path.join(REPO, 'packages', pkg.name, 'src');
  if (!fs.existsSync(dir)) continue;
  const before = sources.length;
  walk(dir);
  if (!pkg.playground) {
    for (const file of sources.slice(before)) compileOnlyFiles.add(file);
  }
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
    if (compileOnlyFiles.has(file)) compileOnly.add(symbol);
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const playable = Object.fromEntries(
  Object.entries(examples).filter(([symbol]) => !compileOnly.has(symbol))
);

// --- the playground runs JavaScript ------------------------------------------
/**
 * A playable snippet must parse as JavaScript, because that is how it runs.
 *
 * These blocks have two consumers with different requirements, and for a long
 * time only one of them was enforced. `generated-example-check.ts` below is
 * compiled as TypeScript, which catches a wrong method name or a bad arity.
 * The playground instead `eval`s the same text verbatim, so a non-null `!`, an
 * `as` cast, or a type annotation is a SyntaxError the reader meets and no
 * gate ever saw.
 *
 * The two requirements actively pull apart. `noUncheckedIndexedAccess` is on,
 * so `group.indices[0]` is `number | undefined` and the compile gate *demands*
 * a `!` that the runtime then rejects. Authors were being pushed toward
 * breakage by the only check that existed. Hence this one: parse each playable
 * snippet the way the browser will, and fail the build rather than ship a dead
 * example.
 *
 * `new vm.Script` parses and throws `SyntaxError`; it never runs the snippet,
 * and nothing here is callable afterwards. Free names — `log`, `scene`, the
 * library exports — are injected by the playground at call time and are not
 * resolved, so this cannot disagree with the compile gate about meaning. It
 * only asks whether the text is JavaScript at all.
 */
const notJavaScript = [];
for (const [symbol, entry] of Object.entries(playable)) {
  for (const [index, code] of [entry.code, ...entry.alternatives].entries()) {
    try {
      new vm.Script(code, { filename: `${symbol}.example.js` });
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      notJavaScript.push({ symbol, index, message: error.message });
    }
  }
}
if (notJavaScript.length > 0) {
  console.error(
    `\nextract-examples: ${notJavaScript.length} playable @example block(s) ` +
      'are not valid JavaScript.\n'
  );
  for (const { symbol, index, message } of notJavaScript) {
    console.error(`  ${symbol}${index ? ` (alternative ${index})` : ''}`);
    console.error(`    ${message}`);
  }
  console.error(
    '\nThe playground evaluates these verbatim, so TypeScript-only syntax —' +
      '\nnon-null `!`, `as` casts, type annotations, `satisfies` — throws for' +
      '\nthe reader. Rewrite the block so it is valid in both, for instance by' +
      '\nnarrowing with a runtime check instead of asserting.\n' +
      '\nAn example that genuinely cannot be plain JavaScript belongs to a' +
      '\npackage marked `playground: false` above, where it is compiled but' +
      '\nnot offered for running.\n'
  );
  process.exit(1);
}

fs.writeFileSync(OUT, JSON.stringify(playable, null, 2) + '\n');
console.log(
  `extract-examples: ${Object.keys(examples).length} symbols with examples ` +
    `(${Object.keys(playable).length} playable, all valid JavaScript) -> ` +
    path.relative(SHOWCASE, OUT)
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
    // A barrel may also declare directly rather than re-export, which the
    // adapter packages do; those names are exported just the same.
    for (const m of text.matchAll(
      /export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g
    )) {
      names.add(m[1]);
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
// Examples are read from the physics package too, so its names have to be in
// scope here or a physics example fails to compile for want of its own symbols
// rather than for anything wrong with it.
const physicsNames = exportedNames(path.join(REPO, 'packages/physics/src/index.ts'));
const experimentNames = exportedNames(path.join(REPO, 'packages/experiment/src/index.ts'));
const experimentPhysicsNames = exportedNames(
  path.join(REPO, 'packages/experiment-physics/src/index.ts')
);

// A name exported by more than one package would be declared twice in the same
// block. Later packages yield to earlier ones, which is also the order the
// playground injects them in, so a snippet resolves the same name either way.
const seen = new Set(coreNames);
const uniqueThree = threeNames.filter((n) => !seen.has(n) && seen.add(n));
const uniquePhysics = physicsNames.filter((n) => !seen.has(n) && seen.add(n));
const uniqueExperiment = experimentNames.filter((n) => !seen.has(n) && seen.add(n));
const uniqueExperimentPhysics = experimentPhysicsNames
  .filter((n) => !seen.has(n) && seen.add(n));
const allNames = [
  ...coreNames, ...uniqueThree, ...uniquePhysics,
  ...uniqueExperiment, ...uniqueExperimentPhysics
];

const safe = (symbol) => symbol.replace(/[^\w]/g, '_');
const bodies = Object.entries(examples).flatMap(([symbol, entry]) =>
  [entry.code, ...entry.alternatives].map((code, index) => {
    const name = `example_${safe(symbol)}${index ? `_${index}` : ''}`;
    // The snippet sits in a block so its own declarations shadow the names
    // brought into scope rather than colliding with them.
    return [
      `/** Compiles the \`${symbol}\` example exactly as the reference renders it. */`,
      `export async function ${name}(): Promise<void> {`,
      `  const { ${coreNames.join(', ')} } = core;`,
      `  const { ${uniqueThree.join(', ')} } = three;`,
      `  const { ${uniquePhysics.join(', ')} } = physics;`,
      `  const { ${uniqueExperiment.join(', ')} } = experiment;`,
      `  const { ${uniqueExperimentPhysics.join(', ')} } = experimentPhysics;`,
      `  void [${allNames.join(', ')}];`,
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
  "import * as physics from '@holotope/physics';",
  "import * as experiment from '@holotope/experiment';",
  "import * as experimentPhysics from '@holotope/experiment-physics';",
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
