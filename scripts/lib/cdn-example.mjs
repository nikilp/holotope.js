/**
 * Rules the no-build CDN example must satisfy, separated from the script that
 * reads the page and asks jsDelivr.
 *
 * Everything here is pure: it takes page text, manifests, the published
 * consumer record and fetched responses, and returns findings. The checker
 * supplies those inputs; the judgements live here so they can be tested
 * against synthetic pages and responses without the network.
 *
 * ## Two contracts, two Three.js pins
 *
 * The repository develops `@holotope/three` against one exact Three.js release
 * (its `devDependencies`), and `check:three-compat` drives the declared peer
 * range from freshly packed artifacts. That is the **development** contract.
 *
 * `examples/showcase/public/cdn.html` is a different consumer. It builds
 * nothing: it imports the adapter **as published** from jsDelivr, and jsDelivr
 * rewrites the published adapter's `three` peer to one exact version inside
 * the peer range that was published, which can be older than the repository's
 * development range. The page must import that same version, or the browser
 * loads two copies of Three.js: both render, but `instanceof` across them
 * fails, and a page `Raycaster` cannot pick geometry the adapter built. That
 * is the **published-consumer** contract, and its pin can legitimately differ
 * from the development pin.
 *
 * The published-consumer facts live in `scripts/cdn-published-consumer.json`,
 * an explicit record of what the registry and jsDelivr were observed to say:
 * the adapter version the page pins, the peer range that version was published
 * with, and the Three.js release jsDelivr resolves it against.
 *
 * - **Offline** (in `pnpm verify`): the page must import the recorded release,
 *   the record must describe the adapter version the page pins, and the
 *   recorded release must satisfy the recorded peer range. Offline checks
 *   cannot establish that the record is still true of the registry or the CDN.
 * - **Online** (`pnpm check:cdn:online`, an explicit publication check): the
 *   registry's published peer range and jsDelivr's actual resolution must both
 *   match the record and the page. Unreachable or malformed evidence is an
 *   *error*, never a pass: a CDN outage proves nothing about compatibility.
 *
 * When a release moves the page's `@holotope/*` pins, update the record in the
 * same change (the version, the peer range being published, and the Three.js
 * release that range resolves to on jsDelivr), then confirm it with the online
 * check once the release is on the registry.
 */

/** Every `cdn.jsdelivr.net/npm/<name>@<version>/` the page names, by package. */
export function pinnedVersions(text) {
  const pins = new Map();
  for (const [, name, version] of text.matchAll(
    /cdn\.jsdelivr\.net\/npm\/((?:@[^/@]+\/)?[^/@]+)@([^/]+)\//g
  )) {
    if (!pins.has(name)) pins.set(name, new Set());
    pins.get(name).add(version);
  }
  return pins;
}

/** The single pinned version of a package, or `undefined` if it is not pinned exactly once. */
export function singlePin(pins, name) {
  const versions = pins.get(name);
  return versions !== undefined && versions.size === 1 ? [...versions][0] : undefined;
}

/** `MAJOR.MINOR.PATCH` as a sortable number, or `undefined` for anything else. */
function order(version) {
  const parts = String(version).split('.');
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) return undefined;
  const [major, minor, patch] = parts.map(Number);
  return major * 1e8 + minor * 1e4 + patch;
}

/**
 * A `>=A.B.C <X.Y.Z` range as its two bounds, or `undefined` for any other
 * form. The published adapter has only ever used this form; anything else is
 * reported rather than guessed at.
 */
export function parseRange(range) {
  const match = /^\s*>=\s*(\d+\.\d+\.\d+)\s*<\s*(\d+\.\d+\.\d+)\s*$/.exec(String(range));
  return match === null ? undefined : { lower: match[1], upper: match[2] };
}

/** Whether `version` lies in a `>=lower <upper` range; `undefined` if either cannot be read. */
export function satisfies(version, range) {
  const bounds = parseRange(range);
  const at = order(version);
  if (bounds === undefined || at === undefined) return undefined;
  return at >= order(bounds.lower) && at < order(bounds.upper);
}

/** Range text compared as text, with whitespace normalized. */
const normalizeRange = (range) => String(range).replace(/\s+/g, ' ').trim().replace(/\s*<\s*/, ' <');

/**
 * Each package at one version, and every `@holotope/*` pin at the version this
 * repository releases.
 */
export function checkPagePins(file, pins, release, packageNames) {
  const violations = [];
  for (const [name, versions] of pins) {
    if (versions.size > 1) {
      violations.push(
        `${file}: pins ${name} at more than one version (${[...versions].join(', ')}), which loads it twice`
      );
    }
  }
  for (const name of packageNames) {
    const pinned = pins.get(name);
    if (pinned === undefined) continue; // The page need not exercise every package.
    for (const version of pinned) {
      if (version !== release) {
        violations.push(`${file}: pins ${name}@${version}, but this repository releases ${release}`);
      }
    }
  }
  return violations;
}

/**
 * The development contract's own consistency: the adapter's runtime and
 * declarations are the same release. A caret on the types against an exact
 * runtime silently drifts: the lockfile once froze @types/three at 0.185.0
 * while three was 0.185.1, so the adapter compiled against declarations for a
 * version nobody ran.
 */
export function checkDevelopmentPins(adapterManifest) {
  const three = adapterManifest.devDependencies?.three;
  const types = adapterManifest.devDependencies?.['@types/three'];
  if (three !== undefined && types !== undefined && types !== three) {
    return [
      `packages/three: three is ${three} but @types/three is ${types}; ` +
        'pin both to the same release so the declarations describe what runs'
    ];
  }
  return [];
}

/**
 * The published-consumer contract, offline: the page imports the Three.js the
 * recorded published adapter resolves against, and the record describes the
 * adapter the page actually pins.
 */
export function checkPublishedConsumer(file, pins, record) {
  const violations = [];
  const fields = ['adapter', 'version', 'peerThree', 'resolvedThree'];
  const missing = fields.filter((field) => typeof record?.[field] !== 'string' || record[field] === '');
  if (missing.length > 0) {
    return [`the published-consumer record lacks ${missing.join(', ')}`];
  }
  const adapterPin = singlePin(pins, record.adapter);
  if (adapterPin === undefined) {
    violations.push(`${file}: does not pin ${record.adapter} exactly once, so no published adapter is named`);
  } else if (adapterPin !== record.version) {
    violations.push(
      `${file}: pins ${record.adapter}@${adapterPin}, but the published-consumer record describes ` +
        `${record.version}; re-verify the published peer range and jsDelivr's resolution for the new version`
    );
  }
  const inRange = satisfies(record.resolvedThree, record.peerThree);
  if (inRange === undefined) {
    violations.push(
      `the published-consumer record's three@${record.resolvedThree} or peer range "${record.peerThree}" cannot be read`
    );
  } else if (!inRange) {
    violations.push(
      `the published-consumer record says jsDelivr resolves three@${record.resolvedThree}, ` +
        `which lies outside the published peer range "${record.peerThree}"`
    );
  }
  const three = singlePin(pins, 'three');
  if (pins.get('three') === undefined) {
    violations.push(`${file}: names no three version, so nothing pins the shared copy`);
  } else if (three !== undefined && three !== record.resolvedThree) {
    violations.push(
      `${file}: pins three@${three}, but the published ${record.adapter}@${record.version} ` +
        `resolves three@${record.resolvedThree}; two Three.js copies would load`
    );
  }
  return violations;
}

/**
 * The page's runtime single-instance assertion must still exist and still test
 * identity: a check named for it, comparing an adapter-built object and
 * geometry against the page's own Three.js classes with `instanceof`.
 */
export function checkSingleInstanceAssertion(file, page) {
  const name = 'Three.js is loaded exactly once';
  const start = page.indexOf(`check('${name}'`);
  if (start === -1) return [`${file}: no longer asserts a single Three.js instance`];
  const next = page.indexOf('check(', start + 1);
  const body = page.slice(start, next === -1 ? undefined : next);
  const required = ['instanceof THREE.Object3D', 'instanceof THREE.BufferGeometry'];
  const absent = required.filter((expression) => !body.includes(expression));
  return absent.length === 0
    ? []
    : [`${file}: the single-instance check no longer tests ${absent.join(' and ')}`];
}

/**
 * The published-consumer contract, online. `adapter` is jsDelivr's `+esm`
 * response for the pinned adapter and `registry` the registry's manifest for
 * that version, each `{ url, status, body }` or `{ url, error }`.
 *
 * Returns `violations` (the evidence contradicts the page or the record) and
 * `errors` (the evidence could not be read, so nothing is established).
 */
export function judgeOnline({ record, pinnedThree, adapter, registry }) {
  const violations = [];
  const errors = [];

  if (adapter.error !== undefined || adapter.status !== 200) {
    errors.push(`${adapter.url}: ${adapter.error ?? `HTTP ${adapter.status}`}; jsDelivr's resolution is unknown`);
  } else {
    const resolved = [...new Set([...adapter.body.matchAll(/\/npm\/three@([0-9][^/]*)\/\+esm/g)].map((m) => m[1]))];
    if (resolved.length === 0) {
      errors.push(`${adapter.url}: names no three import, so jsDelivr's resolution cannot be read from it`);
    } else if (resolved.length > 1) {
      violations.push(`${adapter.url}: resolves three to ${resolved.length} versions (${resolved.join(', ')})`);
    } else {
      if (resolved[0] !== pinnedThree) {
        violations.push(
          `two Three.js copies would load: the page pins three@${pinnedThree}, ` +
            `but jsDelivr resolves the adapter against three@${resolved[0]}`
        );
      }
      if (resolved[0] !== record.resolvedThree) {
        violations.push(
          `the published-consumer record says three@${record.resolvedThree}, ` +
            `but jsDelivr resolves the adapter against three@${resolved[0]}`
        );
      }
    }
    // A bundled-in copy would be worse than a second URL: nothing could dedupe it.
    if (/class\s+Vector3\b/.test(adapter.body)) {
      violations.push(`${adapter.url}: inlines a copy of Three.js rather than importing it`);
    }
  }

  if (registry.error !== undefined || registry.status !== 200) {
    errors.push(`${registry.url}: ${registry.error ?? `HTTP ${registry.status}`}; the published peer range is unknown`);
  } else {
    let published;
    try {
      published = JSON.parse(registry.body)?.peerDependencies?.three;
    } catch {
      published = undefined;
    }
    if (typeof published !== 'string') {
      errors.push(`${registry.url}: no readable peerDependencies.three`);
    } else if (normalizeRange(published) !== normalizeRange(record.peerThree)) {
      violations.push(
        `the registry publishes ${record.adapter}@${record.version} with three "${published}", ` +
          `but the published-consumer record says "${record.peerThree}"`
      );
    }
  }

  return { violations, errors };
}
