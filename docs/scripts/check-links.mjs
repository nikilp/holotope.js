/**
 * Link gate for the hand-written guide.
 *
 * VitePress validates links between markdown routes, but silently ignores a
 * relative link whose target is not markdown — so a link into repository
 * source (`../examples/showcase/src/tesseract.ts`) builds clean and 404s on
 * the deployed site. This closes that hole.
 *
 * Checked, for every markdown file under docs/learn plus docs/index.md:
 *
 *   1. relative links resolve to a file that exists;
 *   2. no link escapes the docs root — repository source must be linked by
 *      absolute GitHub URL, since the site does not serve the repository;
 *   3. anchors point at a heading that exists in the target page.
 *
 * Generated reference pages are not checked; they are typedoc's output.
 *
 *   node scripts/check-links.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOTS = [path.join(DOCS, 'learn'), path.join(DOCS, 'index.md')];

const MD_LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const FENCE = /^```/;

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

/** GitHub-flavored heading slug, matching VitePress's anchor generation. */
const slug = (heading) =>
  heading
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

const anchorsOf = (file) => {
  const out = new Set();
  let inFence = false;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (FENCE.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^#{1,6}\s+(.*)$/);
    if (m) out.add(slug(m[1]));
  }
  return out;
};

const problems = [];

for (const file of files) {
  const rel = path.relative(DOCS, file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let inFence = false;

  lines.forEach((line, i) => {
    if (FENCE.test(line)) { inFence = !inFence; return; }
    if (inFence) return;

    for (const match of line.matchAll(MD_LINK)) {
      const href = match[1];
      // External, anchors-only, and mail links are out of scope.
      if (/^(https?:|mailto:|#)/.test(href)) continue;

      const [target, anchor] = href.split('#');
      const at = `${rel}:${i + 1}`;

      if (!target) continue;

      // Root-absolute site paths (/api/..., /learn/...) resolve against docs/.
      const base = target.startsWith('/')
        ? path.join(DOCS, target.slice(1))
        : path.resolve(path.dirname(file), target);

      if (!base.startsWith(DOCS)) {
        problems.push(
          `${at}\n    escapes the docs root: ${href}\n` +
            '    the site does not serve the repository — use an absolute GitHub URL'
        );
        continue;
      }

      // A link may omit .md, or point at a directory index.
      const candidates = [base, `${base}.md`, path.join(base, 'index.md')];
      const resolved = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());

      if (!resolved) {
        problems.push(`${at}\n    unresolved link: ${href}`);
        continue;
      }

      if (anchor && resolved.endsWith('.md')) {
        const anchors = anchorsOf(resolved);
        if (!anchors.has(anchor)) {
          problems.push(
            `${at}\n    missing anchor "#${anchor}" in ${path.relative(DOCS, resolved)}`
          );
        }
      }
    }
  });
}

console.log(`check-links: ${files.length} guide pages scanned.`);

if (!problems.length) {
  console.log('All guide links resolve.');
  process.exit(0);
}

console.error(`\n${problems.length} broken link(s):\n`);
for (const p of problems) console.error(`  ${p}\n`);
process.exit(1);
