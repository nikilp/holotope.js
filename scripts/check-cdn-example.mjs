/**
 * Keeps the CDN example honest.
 *
 *   node scripts/check-cdn-example.mjs            static checks only
 *   node scripts/check-cdn-example.mjs --online   also verify against the registry and jsDelivr
 *
 * `examples/showcase/public/cdn.html` loads the published packages from
 * jsDelivr with no build step. It checks itself in the browser, which is the
 * real proof; what it cannot check is whether the versions it pins are still
 * the right ones. That drifts silently — a release bumps the packages and the
 * demo keeps advertising the previous one — so it is checked here.
 *
 * The page consumes the adapter **as published**, so the Three.js it must
 * share is the one the published adapter resolves against on jsDelivr, not the
 * one this repository develops against. The two contracts and the record that
 * connects them are described in `scripts/lib/cdn-example.mjs`.
 *
 * The static half needs no network and runs in `pnpm verify`. The online half
 * is an explicit publication check, because a CDN outage is not a reason to
 * fail a local build — and equally not evidence of compatibility.
 *
 * Exit status: 0 consistent; 1 a pin, the record or the CDN contradicts the
 * contract; 2 (online only) the registry or jsDelivr could not be read, so
 * compatibility is not established.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_PACKAGE_NAMES } from './lib/packed-packages.mjs';
import {
  checkDevelopmentPins,
  checkPagePins,
  checkPublishedConsumer,
  checkSingleInstanceAssertion,
  judgeOnline,
  pinnedVersions,
  singlePin
} from './lib/cdn-example.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PAGE = path.join(REPO, 'examples/showcase/public/cdn.html');
const RECORD = path.join(REPO, 'scripts/cdn-published-consumer.json');
const ONLINE = process.argv.includes('--online');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const page = fs.readFileSync(PAGE, 'utf8');
const relative = path.relative(REPO, PAGE);
const record = readJson(RECORD);
const release = readJson(path.join(REPO, 'packages/core/package.json')).version;
const pins = pinnedVersions(page);

const violations = [
  ...checkPagePins(relative, pins, release, PUBLIC_PACKAGE_NAMES),
  ...checkDevelopmentPins(readJson(path.join(REPO, 'packages/three/package.json'))),
  ...checkPublishedConsumer(relative, pins, record),
  ...checkSingleInstanceAssertion(relative, page)
];
const errors = [];

const pinnedThree = singlePin(pins, 'three');
const adapterPin = singlePin(pins, record.adapter);

/** One GET, reduced to what the judgement needs; a failure to fetch is data, not a crash. */
async function read(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    return { url, status: response.status, body: await response.text() };
  } catch (error) {
    return { url, error: String(error?.message ?? error) };
  }
}

if (ONLINE) {
  if (pinnedThree === undefined || adapterPin === undefined) {
    errors.push('the page does not pin three and the adapter exactly once, so there is nothing to ask jsDelivr about');
  } else {
    const [adapter, registry] = await Promise.all([
      read(`https://cdn.jsdelivr.net/npm/${record.adapter}@${adapterPin}/+esm`),
      read(`https://registry.npmjs.org/${record.adapter.replace('/', '%2F')}/${adapterPin}`)
    ]);
    const online = judgeOnline({ record, pinnedThree, adapter, registry });
    violations.push(...online.violations);
    errors.push(...online.errors);
  }
}

if (violations.length > 0) {
  console.error('\ncheck-cdn-example: the CDN example has drifted.\n');
  for (const violation of violations) console.error(`  ${violation}`);
  for (const error of errors) console.error(`  (also unreadable) ${error}`);
  console.error('');
  process.exit(1);
}
if (errors.length > 0) {
  console.error('\ncheck-cdn-example: the online evidence could not be read, so compatibility is NOT established.\n');
  for (const error of errors) console.error(`  ${error}`);
  console.error('');
  process.exit(2);
}

console.log(
  `check-cdn-example: ${relative} pins @holotope/*@${release} and three@${pinnedThree}, ` +
    `the release the published ${record.adapter}@${record.version} resolves against` +
    (ONLINE
      ? `; the registry publishes it with three "${record.peerThree}", and jsDelivr resolves it against the same three.`
      : ' (as recorded; run --online to confirm against the registry and jsDelivr).')
);
