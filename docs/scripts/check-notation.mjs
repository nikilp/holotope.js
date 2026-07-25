/**
 * Notation gate for the hand-written guide.
 *
 * Two constructs typeset as literal source rather than as mathematics, and
 * neither affects whether the build succeeds:
 *
 *   1. MathJax's own `\[ … \]` delimiters. VitePress recognises `$ … $` and
 *      `$$ … $$`; any other delimiter is emitted verbatim.
 *   2. Notation in YAML frontmatter. The theme consumes frontmatter directly,
 *      so no markdown renderer — and therefore no math renderer — is applied
 *      to it. Notation there must be spelled out or written in Unicode.
 *
 * Caret superscripts inside fenced blocks, display-math bodies, and inline
 * code are source in their own right and are left alone.
 *
 *   node scripts/check-notation.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOTS = [path.join(DOCS, 'learn'), path.join(DOCS, 'index.md')];

const SUPERSCRIPT = /\b[A-Za-z]\^[0-9A-Za-z]/;
const MATHJAX_DELIM = /^\s*\\[[\]]\s*$/;

const files = [];
const collect = (target) => {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (target.endsWith('.md')) files.push(target);
    return;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    collect(path.join(target, entry.name));
  }
};
for (const root of ROOTS) if (fs.existsSync(root)) collect(root);

const problems = [];

for (const file of files) {
  const rel = path.relative(DOCS, file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');

  let inFence = false;
  let inMath = false;
  let inFrontmatter = lines[0]?.trim() === '---';

  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;

    if (inFrontmatter) {
      if (i > 0 && line.trim() === '---') { inFrontmatter = false; return; }
      // Frontmatter is YAML consumed by the theme; no renderer ever sees it,
      // so notation here must be spelled out or use Unicode.
      if (SUPERSCRIPT.test(line)) {
        problems.push(
          `${at}\n    caret superscript in frontmatter: ${line.trim().slice(0, 72)}\n` +
            '    frontmatter is never markdown-rendered — reword it or use Unicode'
        );
      }
      return;
    }

    if (/^```/.test(line)) { inFence = !inFence; return; }
    if (/^\$\$/.test(line)) { inMath = !inMath; return; }

    // Fenced code and display-math bodies are source, and correct as written.
    if (inFence || inMath) return;

    if (MATHJAX_DELIM.test(line)) {
      problems.push(
        `${at}\n    MathJax delimiter "${line.trim()}" — VitePress renders these literally\n` +
          '    use $$ … $$ for display math'
      );
      return;
    }

    // Strip inline code and inline math; notation inside either is deliberate.
    const bare = line.replace(/`[^`]*`/g, '').replace(/\$[^$]*\$/g, '');
    if (SUPERSCRIPT.test(bare)) {
      const shown = bare.match(new RegExp(SUPERSCRIPT.source + '[0-9A-Za-z]*'))?.[0] ?? '';
      problems.push(
        `${at}\n    caret superscript in prose: ${shown}\n` +
          '    wrap it as inline math, e.g. $\\mathbb{R}^N$, or use backticks if it is code'
      );
    }
  });
}

console.log(`check-notation: ${files.length} guide pages scanned.`);

if (!problems.length) {
  console.log('No raw notation.');
  process.exit(0);
}

console.error(`\n${problems.length} notation problem(s):\n`);
for (const p of problems) console.error(`  ${p}\n`);
process.exit(1);
