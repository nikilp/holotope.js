/**
 * Refuse exported functions whose first parameter destructures an object.
 *
 * TypeDoc has no source identifier for that parameter and publishes the
 * placeholder `__namedParameters`. Naming the options object and destructuring
 * inside the body preserves runtime behavior while producing stable reference
 * signatures and an attachment point for `@param options`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGES = path.join(ROOT, 'packages');
const violations = [];

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'node_modules') continue;
      visit(target);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const source = fs.readFileSync(target, 'utf8');
    const pattern = /export\s+function\s+([A-Za-z0-9_$]+)\s*\(\s*\{/g;
    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index).split('\n').length;
      violations.push({
        file: path.relative(ROOT, target),
        line,
        symbol: match[1]
      });
    }
  }
}

visit(PACKAGES);

if (violations.length === 0) {
  console.log('check-exported-parameter-names: no anonymous exported options parameters.');
  process.exit(0);
}

console.error(
  `check-exported-parameter-names: ${violations.length} exported function(s) ` +
    'would publish __namedParameters:'
);
for (const violation of violations) {
  console.error(`  ${violation.file}:${violation.line}  ${violation.symbol}`);
}
console.error(
  '\nName the parameter `options` and destructure it inside the function body.'
);
process.exit(1);
