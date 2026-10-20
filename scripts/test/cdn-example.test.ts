import { describe, expect, it } from 'vitest';
import {
  checkAdvertisedPublished,
  checkDevelopmentPins,
  checkPagePins,
  checkPublishedConsumer,
  checkRecordAgainstSource,
  checkSingleInstanceAssertion,
  judgeOnline,
  parseRange,
  pinnedVersions,
  satisfies
  // @ts-expect-error -- a plain .mjs module with no declarations; the rules it
  // holds are the subject, and typing it would duplicate them.
} from '../lib/cdn-example.mjs';

/**
 * Negative controls for the CDN example's two contracts.
 *
 * The page consumes the adapter as published, so it must share the Three.js
 * that the published artifact resolves against, which can differ from the
 * release this repository develops against. The defect these cases exist for:
 * the page was pinned to the development reference, the offline check agreed
 * because it compared the page with the repository, and the deployed page
 * loaded two copies of Three.js.
 *
 * The staging cases exist for a second defect: the offline check and the
 * release preflight both demanded that the page pin the source version, while
 * the page is deployed from `main` before a tag publishes that version, so
 * satisfying them would have put an unloadable page live.
 */

const FILE = 'examples/showcase/public/cdn.html';
const NAMES = ['@holotope/core', '@holotope/three', '@holotope/physics', '@holotope/experiment', '@holotope/experiment-physics'];
const RECORD = {
  adapter: '@holotope/three',
  version: '0.0.22',
  peerThree: '>=0.184.0 <0.186.0',
  resolvedThree: '0.185.1'
};

const SINGLE_INSTANCE = `
  check('Three.js is loaded exactly once', () => {
    assert(section.object instanceof THREE.Object3D, 'different copy');
    assert(section.geometry instanceof THREE.BufferGeometry, 'different copy');
    return 'shared';
  });
  check('a Raycaster from this page picks adapter geometry', () => {});`;

/** A page in the shape of cdn.html: a displayed snippet and the executable imports. */
function page({ three = '0.185.1', shownThree = three, release = '0.0.22', body = SINGLE_INSTANCE } = {}) {
  return `
    <pre><code>import * as THREE from 'https://cdn.jsdelivr.net/npm/three@${shownThree}/+esm';
import { createHypercube } from 'https://cdn.jsdelivr.net/npm/@holotope/core@${release}/+esm';
import { SlicedComplex3D } from 'https://cdn.jsdelivr.net/npm/@holotope/three@${release}/+esm';</code></pre>
    <script type="module">
      import * as THREE from 'https://cdn.jsdelivr.net/npm/three@${three}/+esm';
      import { createHypercube } from 'https://cdn.jsdelivr.net/npm/@holotope/core@${release}/+esm';
      import { SlicedComplex3D } from 'https://cdn.jsdelivr.net/npm/@holotope/three@${release}/+esm';
      ${body}
    </script>`;
}

const offline = (text: string, record: { version?: string } = RECORD, release = '0.0.22') => {
  const pins = pinnedVersions(text);
  return [
    ...checkPagePins(FILE, pins, record.version, NAMES),
    ...checkRecordAgainstSource(record, release),
    ...checkPublishedConsumer(FILE, pins, record),
    ...checkSingleInstanceAssertion(FILE, text)
  ];
};

const ADAPTER_URL = 'https://cdn.jsdelivr.net/npm/@holotope/three@0.0.22/+esm';
const REGISTRY_URL = 'https://registry.npmjs.org/@holotope%2Fthree/0.0.22';
const esm = (...threes: string[]) =>
  `import*as e from"/npm/@holotope/core@0.0.22/+esm";` + threes.map((t) => `import*as t from"/npm/three@${t}/+esm";`).join('');
const adapterOk = (body = esm('0.185.1')) => ({ url: ADAPTER_URL, status: 200, body });
const registryOk = (peer = '>=0.184.0 <0.186.0') => ({
  url: REGISTRY_URL,
  status: 200,
  body: JSON.stringify({ name: '@holotope/three', version: '0.0.22', peerDependencies: { three: peer } })
});

describe('ranges', () => {
  it('reads the published two-bound form, with or without a space', () => {
    expect(parseRange('>=0.184.0 <0.186.0')).toEqual({ lower: '0.184.0', upper: '0.186.0' });
    expect(parseRange('>=0.184.0<0.186.0')).toEqual({ lower: '0.184.0', upper: '0.186.0' });
  });

  it('refuses forms it cannot judge rather than guessing', () => {
    expect(parseRange('^0.185.0')).toBeUndefined();
    expect(satisfies('0.185.1', '^0.185.0')).toBeUndefined();
  });

  it('places versions against both bounds, upper exclusive', () => {
    expect(satisfies('0.185.1', '>=0.184.0 <0.186.0')).toBe(true);
    expect(satisfies('0.184.0', '>=0.184.0 <0.186.0')).toBe(true);
    expect(satisfies('0.186.0', '>=0.184.0 <0.186.0')).toBe(false);
    expect(satisfies('0.183.2', '>=0.184.0 <0.186.0')).toBe(false);
  });
});

describe('the published-consumer contract, offline', () => {
  it('accepts a page on the published adapter\'s Three.js while the repository develops against a later one', () => {
    expect(offline(page())).toEqual([]);
    // The development pins are a separate contract, and the later reference is consistent on its own.
    expect(checkDevelopmentPins({ devDependencies: { three: '0.186.0', '@types/three': '0.186.0' } })).toEqual([]);
  });

  it('rejects the development reference on the CDN page: the original two-copy defect', () => {
    const violations = offline(page({ three: '0.186.0' }));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/pins three@0\.186\.0, but the published @holotope\/three@0\.0\.22 resolves three@0\.185\.1; two Three\.js copies/);
  });

  it('rejects a displayed snippet that disagrees with the executable import', () => {
    expect(offline(page({ three: '0.185.1', shownThree: '0.186.0' }))).toEqual([
      `${FILE}: pins three at more than one version (0.186.0, 0.185.1), which loads it twice`
    ]);
  });

  it('accepts the same pin shown and imported, which is one version', () => {
    expect(pinnedVersions(page()).get('three')).toEqual(new Set(['0.185.1']));
  });

  it('rejects a page that names no Three.js', () => {
    const text = page().replace(/import \* as THREE from '[^']+';/g, '');
    expect(offline(text)).toContain(`${FILE}: names no three version, so nothing pins the shared copy`);
  });

  it('accepts a staged release: the source leads, the page stays on the published record', () => {
    expect(offline(page(), RECORD, '0.0.23')).toEqual([]);
  });

  it('rejects a release that moves the page without re-verifying the record', () => {
    const violations = offline(page({ release: '0.0.23' }), RECORD, '0.0.23');
    expect(violations).toContain(
      `${FILE}: pins @holotope/core@0.0.23, but the published-consumer record describes 0.0.22; every @holotope pin follows the one verified published release`
    );
    expect(violations.some((v: string) => /pins @holotope\/three@0\.0\.23, but the published-consumer record describes 0\.0\.22/.test(v))).toBe(true);
  });

  it('rejects moving one package ahead of the record while the adapter stays', () => {
    const text = page().replaceAll('@holotope/core@0.0.22', '@holotope/core@0.0.23');
    expect(offline(text, RECORD, '0.0.23')).toEqual([
      `${FILE}: pins @holotope/core@0.0.23, but the published-consumer record describes 0.0.22; every @holotope pin follows the one verified published release`
    ]);
  });

  it('rejects a record that leads the source version', () => {
    expect(checkRecordAgainstSource({ ...RECORD, version: '0.0.23' }, '0.0.22')).toEqual([
      'the published-consumer record describes 0.0.23, newer than this source\'s 0.0.22'
    ]);
    expect(checkRecordAgainstSource({ ...RECORD, version: 'next' }, '0.0.22')).toEqual([
      'the published-consumer record\'s version next or the source version 0.0.22 cannot be read'
    ]);
  });

  it('accepts the post-release refresh: page and record moved together to the published release', () => {
    const refreshed = { ...RECORD, version: '0.0.23', peerThree: '>=0.184.0 <0.187.0', resolvedThree: '0.186.0' };
    expect(offline(page({ release: '0.0.23', three: '0.186.0' }), refreshed, '0.0.23')).toEqual([]);
  });

  it('rejects a record whose resolved Three.js lies outside its own published range', () => {
    const record = { ...RECORD, resolvedThree: '0.186.0' };
    const violations = offline(page({ three: '0.186.0' }), record);
    expect(violations).toContain(
      'the published-consumer record says jsDelivr resolves three@0.186.0, which lies outside the published peer range ">=0.184.0 <0.186.0"'
    );
  });

  it('rejects an incomplete or unreadable record instead of passing it', () => {
    expect(offline(page(), { ...RECORD, resolvedThree: undefined })).toContain(
      'the published-consumer record lacks resolvedThree'
    );
    expect(offline(page(), { ...RECORD, peerThree: '^0.185.0' }).some((v: string) => /cannot be read/.test(v))).toBe(true);
  });
});

describe('the single-instance assertion', () => {
  it('accepts the identity check as written', () => {
    expect(checkSingleInstanceAssertion(FILE, page())).toEqual([]);
  });

  it('rejects removing the check', () => {
    expect(checkSingleInstanceAssertion(FILE, page({ body: '' }))).toEqual([
      `${FILE}: no longer asserts a single Three.js instance`
    ]);
  });

  it('rejects keeping the name while dropping the identity test', () => {
    const weakened = SINGLE_INSTANCE.replace(/instanceof THREE\.(Object3D|BufferGeometry)/g, '!== null');
    expect(checkSingleInstanceAssertion(FILE, page({ body: weakened }))).toEqual([
      `${FILE}: the single-instance check no longer tests instanceof THREE.Object3D and instanceof THREE.BufferGeometry`
    ]);
  });
});

describe('the development contract', () => {
  it('rejects runtime and declarations at different releases', () => {
    expect(checkDevelopmentPins({ devDependencies: { three: '0.186.0', '@types/three': '0.185.1' } })).toEqual([
      'packages/three: three is 0.186.0 but @types/three is 0.185.1; pin both to the same release so the declarations describe what runs'
    ]);
  });
});

describe('the published-consumer contract, online', () => {
  const judge = (adapter: object, registry: object, pinnedThree = '0.185.1') =>
    judgeOnline({ record: RECORD, pinnedThree, adapter, registry });

  it('accepts matching registry and CDN evidence', () => {
    expect(judge(adapterOk(), registryOk())).toEqual({ violations: [], errors: [] });
  });

  it('accepts a registry range written without a space', () => {
    expect(judge(adapterOk(), registryOk('>=0.184.0<0.186.0'))).toEqual({ violations: [], errors: [] });
  });

  it('rejects the old r186 page pin against the real resolution', () => {
    const { violations, errors } = judge(adapterOk(), registryOk(), '0.186.0');
    expect(errors).toEqual([]);
    expect(violations).toEqual([
      'two Three.js copies would load: the page pins three@0.186.0, but jsDelivr resolves the adapter against three@0.185.1'
    ]);
  });

  it('rejects a CDN that now resolves differently from the record', () => {
    const { violations } = judge(adapterOk(esm('0.185.2')), registryOk());
    expect(violations).toContain(
      'the published-consumer record says three@0.185.1, but jsDelivr resolves the adapter against three@0.185.2'
    );
  });

  it('rejects an adapter importing two Three.js versions', () => {
    const { violations } = judge(adapterOk(esm('0.185.1', '0.186.0')), registryOk());
    expect(violations).toEqual([`${ADAPTER_URL}: resolves three to 2 versions (0.185.1, 0.186.0)`]);
  });

  it('rejects an adapter that bundles its own Three.js', () => {
    const { violations } = judge(adapterOk(esm('0.185.1') + 'class Vector3{}'), registryOk());
    expect(violations).toEqual([`${ADAPTER_URL}: inlines a copy of Three.js rather than importing it`]);
  });

  it('rejects a registry range that no longer matches the record', () => {
    const { violations } = judge(adapterOk(), registryOk('>=0.184.0 <0.187.0'));
    expect(violations).toEqual([
      'the registry publishes @holotope/three@0.0.22 with three ">=0.184.0 <0.187.0", but the published-consumer record says ">=0.184.0 <0.186.0"'
    ]);
  });

  it('reports an unreachable CDN as an error, never as compatibility', () => {
    const { violations, errors } = judge({ url: ADAPTER_URL, error: 'fetch failed' }, registryOk());
    expect(violations).toEqual([]);
    expect(errors).toEqual([`${ADAPTER_URL}: fetch failed; jsDelivr's resolution is unknown`]);
  });

  it('reports an HTTP failure as an error', () => {
    const { errors } = judge({ url: ADAPTER_URL, status: 503, body: '' }, { url: REGISTRY_URL, status: 404, body: '' });
    expect(errors).toEqual([
      `${ADAPTER_URL}: HTTP 503; jsDelivr's resolution is unknown`,
      `${REGISTRY_URL}: HTTP 404; the published peer range is unknown`
    ]);
  });

  it('reports a malformed adapter body as an error, not a match', () => {
    const { violations, errors } = judge(adapterOk('export const nothing = 1;'), registryOk());
    expect(violations).toEqual([]);
    expect(errors).toEqual([`${ADAPTER_URL}: names no three import, so jsDelivr's resolution cannot be read from it`]);
  });

  it('reports a malformed registry manifest as an error', () => {
    const { errors } = judge(adapterOk(), { url: REGISTRY_URL, status: 200, body: '<html>rate limited</html>' });
    expect(errors).toEqual([`${REGISTRY_URL}: no readable peerDependencies.three`]);
  });
});

describe('advertised pins against the registry\'s latest release', () => {
  const pin = (name: string, version: string) => ({ file: FILE, name, version });
  const latestUrl = (name: string) => `https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`;
  const latestOk = (name: string, version: string) => ({
    url: latestUrl(name),
    status: 200,
    body: JSON.stringify({ name, version })
  });
  const PINS = [pin('@holotope/core', '0.0.22'), pin('@holotope/three', '0.0.22')];
  const registry = (core: object, three: object) =>
    new Map<string, object>([['@holotope/core', core], ['@holotope/three', three]]);

  it('accepts a staged release: the page pins what the registry calls latest', () => {
    const latest = registry(latestOk('@holotope/core', '0.0.22'), latestOk('@holotope/three', '0.0.22'));
    expect(checkAdvertisedPublished(PINS, latest)).toEqual({ violations: [], errors: [] });
  });

  it('rejects a page moved to the candidate before it is published', () => {
    const early = [pin('@holotope/core', '0.0.23'), pin('@holotope/three', '0.0.23')];
    const latest = registry(latestOk('@holotope/core', '0.0.22'), latestOk('@holotope/three', '0.0.22'));
    const { violations, errors } = checkAdvertisedPublished(early, latest);
    expect(errors).toEqual([]);
    expect(violations).toEqual([
      `${FILE} advertises @holotope/core@0.0.23, but the registry's latest is 0.0.22; a page deployed with it fails to load until that release is published`,
      `${FILE} advertises @holotope/three@0.0.23, but the registry's latest is 0.0.22; a page deployed with it fails to load until that release is published`
    ]);
  });

  it('reports the refresh still owed after publication, package by package', () => {
    // A partial publication: core reached the registry, the adapter did not.
    const latest = registry(latestOk('@holotope/core', '0.0.23'), latestOk('@holotope/three', '0.0.22'));
    expect(checkAdvertisedPublished(PINS, latest)).toEqual({
      violations: [
        `${FILE} advertises @holotope/core@0.0.22, but the registry's latest is 0.0.23; move the pins and the published-consumer record to it, and confirm with check:cdn:online`
      ],
      errors: []
    });
  });

  it('never reads a missing or unreadable registry answer as published', () => {
    const latest = registry(
      { url: latestUrl('@holotope/core'), status: 404, body: '{"error":"Not found"}' },
      { url: latestUrl('@holotope/three'), error: 'fetch failed' }
    );
    expect(checkAdvertisedPublished(PINS, latest)).toEqual({
      violations: [],
      errors: [
        `${latestUrl('@holotope/core')}: HTTP 404; whether @holotope/core@0.0.22 is published is unknown`,
        `${latestUrl('@holotope/three')}: fetch failed; whether @holotope/three@0.0.22 is published is unknown`
      ]
    });
  });

  it('never reads a malformed or absent answer as published', () => {
    const latest = new Map<string, object>([
      ['@holotope/core', { url: latestUrl('@holotope/core'), status: 200, body: '<html>rate limited</html>' }]
    ]);
    expect(checkAdvertisedPublished(PINS, latest).errors).toEqual([
      `${latestUrl('@holotope/core')}: no readable version`,
      "@holotope/three: the registry's latest release was not read"
    ]);
  });
});
