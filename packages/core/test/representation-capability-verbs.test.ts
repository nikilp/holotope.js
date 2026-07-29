import * as core from '@holotope/core';
import {
  representationMapCapabilitiesN,
  representationMapCapabilityVerbsN,
  type RepresentationMapCapabilitiesN,
  type RepresentationMapRecipeN
} from '@holotope/core';
import { describe, expect, it } from 'vitest';

/**
 * A capability table that names no verb is a promise with no address.
 *
 * The first outside caller to drive `representation/` read `pointLift: 'exact'`,
 * searched the package for `lift`, `inverse`, and `fibre`, found nothing that
 * inverts a slice chart, and wrote up the verb as missing. It ships: it is
 * `HyperplaneSlice4.embedPoint`, in another module, under a name sharing no
 * vocabulary with the capability. The report was corrected only because an
 * unrelated instruction sent that caller through `compile.ts`.
 *
 * So the pointer from capability to verb is now data rather than prose, and
 * these tests are what stop it from rotting: a renamed or unexported verb fails
 * here rather than silently becoming a wrong direction in a doc comment.
 */

const KINDS = [
  'affine-section',
  'affine-slice-chart',
  'orthographic-projection',
  'coordinate-subspace-projection',
  'iterated-perspective-projection',
  'custom-projection',
  'field-restriction',
  'sampled-isosurface',
  'ray-realization'
] as const;

/** Only `kind` is read by either table, so a tag stands in for a whole recipe. */
const recipeOf = (kind: string) => ({ kind }) as unknown as RepresentationMapRecipeN;

/** Resolves `name` or `Class.method` against the package's public surface. */
function resolveOnPublicSurface(symbol: string): unknown {
  const surface = core as unknown as Record<string, unknown>;
  if (!symbol.includes('.')) return surface[symbol];
  const [holder, member] = symbol.split('.');
  const owner = surface[holder!] as { prototype?: Record<string, unknown> } | undefined;
  return owner?.prototype?.[member!];
}

const CAPABILITIES = [
  'pointForward',
  'pointLift',
  'inverseFibre',
  'attributeTransport',
  'sourceIdentity'
] as const satisfies readonly (keyof RepresentationMapCapabilitiesN)[];

describe('capability verbs', () => {
  it('names a symbol that is exported and callable, for every verb declared', () => {
    let checked = 0;
    for (const kind of KINDS) {
      const verbs = representationMapCapabilityVerbsN(recipeOf(kind));
      for (const capability of CAPABILITIES) {
        const verb = verbs[capability];
        if (verb === undefined) continue;
        const resolved = resolveOnPublicSurface(verb.symbol);
        expect(resolved, `${kind}.${capability} → ${verb.symbol}`).toBeTypeOf('function');
        expect(verb.module).toBe('@holotope/core');
        checked++;
      }
    }
    // liveness: the loop resolves 23 real symbols; an empty table would satisfy
    // every assertion above by never entering the body.
    expect(checked).toBe(23);
  });

  it('never names a verb for a capability the recipe does not have', () => {
    for (const kind of KINDS) {
      const levels = representationMapCapabilitiesN(recipeOf(kind));
      const verbs = representationMapCapabilityVerbsN(recipeOf(kind));
      for (const capability of CAPABILITIES) {
        if (levels[capability] !== 'unavailable') continue;
        // Claiming a performer for something declared impossible would be worse
        // than naming nothing: it invites the caller to try it.
        expect(verbs[capability], `${kind}.${capability}`).toBeUndefined();
      }
    }
  });

  it('records which declared capabilities still have no named verb', () => {
    const unnamed: string[] = [];
    for (const kind of KINDS) {
      const levels = representationMapCapabilitiesN(recipeOf(kind));
      const verbs = representationMapCapabilityVerbsN(recipeOf(kind));
      for (const capability of CAPABILITIES) {
        if (levels[capability] === 'unavailable') continue;
        if (verbs[capability] === undefined) unnamed.push(`${kind}.${capability}`);
      }
    }

    // Attribute transport is no longer advertised for geometric recipes that
    // have no performing verb. The remaining gaps are explicitly
    // record-dependent or approximate operations.
    expect(unnamed).toEqual([
      'field-restriction.pointLift',
      'field-restriction.attributeTransport',
      'sampled-isosurface.pointLift',
      'sampled-isosurface.attributeTransport',
      'ray-realization.pointLift',
      'ray-realization.attributeTransport'
    ]);
  });

  it('routes the lift the first outside caller could not find', () => {
    // The specific regression: the capability said `exact`, the verb was
    // unnameable from here, and a competent reader concluded it did not ship.
    const verbs = representationMapCapabilityVerbsN(recipeOf('affine-slice-chart'));
    expect(verbs.pointLift?.symbol).toBe('HyperplaneSlice4.embedPoint');
    expect(representationMapCapabilitiesN(recipeOf('affine-slice-chart')).pointLift)
      .toBe('exact');
    // And it really is the function, not a stale name.
    const slice = core.HyperplaneSlice4.axisAligned();
    expect(slice.embedPoint([0, 0, 0])).toHaveLength(4);
  });
});
