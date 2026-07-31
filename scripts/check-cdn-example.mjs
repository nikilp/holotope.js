/**
 * Keeps the CDN example honest.
 *
 *   node scripts/check-cdn-example.mjs            static checks only
 *   node scripts/check-cdn-example.mjs --online   also verify against jsDelivr
 *
 * `examples/showcase/public/cdn.html` loads the published packages from
 * jsDelivr with no build step. It checks itself in the browser, which is the
 * real proof; what it cannot check is whether the versions it pins are still
 * the right ones. That drifts silently — a release bumps the packages and the
 * demo keeps advertising the previous one — so it is checked here.
 *
 * ## The invariant that prevents two copies of Three.js
 *
 * jsDelivr rewrites `@holotope/three`'s peer dependency to one exact version.
 * If the page pins a different one, the browser loads Three.js twice: both
 * copies render, but `instanceof` across them fails, so a `Raycaster` from the
 * page cannot pick geometry the adapter built. The page asserts that at
 * runtime. This asserts the pins agree in the first place, which is the
 * condition that makes the runtime assertion pass.
 *
 * The static half needs no network and runs in `pnpm verify`. The half that
 * asks jsDelivr what it actually resolves is opt-in, because a CDN outage is
 * not a reason to fail a local build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_PACKAGES } from './lib/packed-packages.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PAGE = path.join(REPO, 'examples/showcase/public/cdn.html');
const ONLINE = process.argv.includes('--online');

const violations = [];
const page = fs.readFileSync(PAGE, 'utf8');
const relative = path.relative(REPO, PAGE);

/** Every `cdn.jsdelivr.net/npm/<name>@<version>` the page names. */
function pinnedVersions(text) {
  const pins = new Map();
  for (const [, name, version] of text.matchAll(
    /cdn\.jsdelivr\.net\/npm\/((?:@[^/@]+\/)?[^/@]+)@([^/]+)\//g
  )) {
    if (!pins.has(name)) pins.set(name, new Set());
    pins.get(name).add(version);
  }
  return pins;
}

const pins = pinnedVersions(page);
for (const [name, versions] of pins) {
  if (versions.size > 1) {
    violations.push(
      `${relative}: pins ${name} at more than one version (${[...versions].join(', ')}), which loads it twice`
    );
  }
}

const release = JSON.parse(
  fs.readFileSync(path.join(REPO, 'packages/core/package.json'), 'utf8')
).version;

for (const directory of PUBLIC_PACKAGES) {
  const name = `@holotope/${directory}`;
  const pinned = pins.get(name);
  if (pinned === undefined) continue; // The page need not exercise every package.
  const [version] = [...pinned];
  if (version !== release) {
    violations.push(
      `${relative}: pins ${name}@${version}, but this repository releases ${release}`
    );
  }
}

// The page must pin the Three.js the adapter is built and tested against.
const peer = JSON.parse(
  fs.readFileSync(path.join(REPO, 'packages/three/package.json'), 'utf8')
).devDependencies?.three;
const pinnedThree = pins.get('three') === undefined ? undefined : [...pins.get('three')][0];
if (pinnedThree === undefined) {
  violations.push(`${relative}: names no three version, so nothing pins the shared copy`);
} else if (peer !== undefined && pinnedThree !== peer) {
  violations.push(
    `${relative}: pins three@${pinnedThree}, but @holotope/three develops against ${peer}`
  );
}

// The page's own claim about what it proves must not outlive the checks in it.
if (!page.includes('Three.js is loaded exactly once')) {
  violations.push(`${relative}: no longer asserts a single Three.js instance`);
}

if (ONLINE && pinnedThree !== undefined) {
  const adapter = `https://cdn.jsdelivr.net/npm/@holotope/three@${release}/+esm`;
  const response = await fetch(adapter);
  if (!response.ok) {
    violations.push(`${adapter}: HTTP ${response.status}`);
  } else {
    const body = await response.text();
    const resolved = [...body.matchAll(/\/npm\/three@([0-9][^/]*)\/\+esm/g)].map((m) => m[1]);
    const distinct = [...new Set(resolved)];
    if (distinct.length !== 1) {
      violations.push(
        `${adapter}: resolves three to ${distinct.length} versions (${distinct.join(', ')})`
      );
    } else if (distinct[0] !== pinnedThree) {
      violations.push(
        `two Three.js copies would load: the page pins three@${pinnedThree}, ` +
          `but jsDelivr resolves the adapter against three@${distinct[0]}`
      );
    }
    // A bundled-in copy would be worse than a second URL: nothing could dedupe it.
    if (/class\s+Vector3\b/.test(body)) {
      violations.push(`${adapter}: inlines a copy of Three.js rather than importing it`);
    }
  }
}

if (violations.length > 0) {
  console.error('\ncheck-cdn-example: the CDN example has drifted.\n');
  for (const violation of violations) console.error(`  ${violation}`);
  console.error('');
  process.exit(1);
}

console.log(
  `check-cdn-example: ${relative} pins @holotope/*@${release} and three@${pinnedThree}` +
    (ONLINE ? ', and jsDelivr resolves the adapter against the same three.' : '.')
);
