import {
  gjkDistance,
  type GjkOptions,
  type GjkResult,
  type GjkWarmStartN
} from './gjk.js';
import {
  gjkMarginDistance,
  type GjkMarginResult
} from './gjk-margin.js';
import {
  epaPenetration4,
  type EpaOptions4,
  type EpaPenetrationResult4
} from './epa4.js';
import {
  polytopeContactPatch4,
  type PolytopeContactOptions4,
  type PolytopeContactResult4
} from './polytope-contact4.js';
import {
  polytopeHyperplaneContact4,
  type PolytopeHyperplaneContactOptions4,
  type PolytopeHyperplaneContactResult4
} from './polytope-plane-contact4.js';
import {
  hyperboxContactPatch4,
  type HyperboxContactOptions4,
  type HyperboxContactResult4
} from './hyperbox-contact4.js';
import { HyperplaneColliderN } from './hyperplane-collider.js';
import { HyperboxSupportShape4 } from './hyperbox4.js';
import {
  glomeHyperboxContact4,
  hyperboxHyperplaneContact4,
  type GlomeHyperboxContactResult4,
  type HyperboxHyperplaneContactResult4,
  type MixedAnalyticContactOptions4
} from './mixed-contact4.js';
import {
  GlomeSupportShapeN,
  type SupportShapeN
} from './support-shape.js';
import {
  glomeGlomeContactN,
  glomeHyperplaneContactN,
  type GlomeGlomeContactResultN,
  type GlomeHyperplaneContactResultN,
  type SmoothContactOptionsN
} from './smooth-contact.js';

export type NarrowphaseCapabilityN =
  | 'distance'
  | 'shallow-contact'
  | 'penetration'
  | 'deep-manifold';

export type NarrowphaseRequestModeN = 'best' | NarrowphaseCapabilityN;

export type NarrowphaseCacheStatusN =
  | 'hit'
  | 'miss'
  | 'disabled'
  | 'unused';

export type NarrowphaseShapeN = SupportShapeN | HyperplaneColliderN;

export interface NarrowphaseDispatchRequestN {
  /** Stable identity of this ordered shape pair. */
  readonly pairId: string;
  readonly shapeA: NarrowphaseShapeN;
  readonly shapeB: NarrowphaseShapeN;
  /** Default best. */
  readonly mode?: NarrowphaseRequestModeN;
  /** Spherical shell around A's convex core. Default 0. */
  readonly marginA?: number;
  /** Spherical shell around B's convex core. Default 0. */
  readonly marginB?: number;
  /** GJK policy; warmStart is owned by the dispatcher cache. */
  readonly gjkOptions?: Omit<GjkOptions, 'warmStart'>;
  /** Classification policy for analytic smooth contact. */
  readonly smoothContactOptions?: SmoothContactOptionsN;
  readonly hyperboxOptions?: HyperboxContactOptions4;
  /** Classification policy shared by analytic mixed-family contact. */
  readonly mixedContactOptions?: MixedAnalyticContactOptions4;
  /** R4 EPA policy; GJK policy and warm start remain dispatcher-owned. */
  readonly epaOptions?: Omit<EpaOptions4, 'gjkOptions'>;
  /** R4 vertex-polytope facet and contact-section policy. */
  readonly polytopeOptions?: Omit<PolytopeContactOptions4, 'epaOptions'>;
  /** R4 vertex-polytope/infinite-plane support-face policy. */
  readonly polytopeHyperplaneOptions?: Omit<
    PolytopeHyperplaneContactOptions4,
    'polytopeMargin'
  >;
  /** Use/update the stable-pair GJK cache. Default true. */
  readonly useCache?: boolean;
}

interface NarrowphaseResultBaseN {
  readonly pairId: string;
  readonly dim: number;
  readonly requestedMode: NarrowphaseRequestModeN;
  readonly availableCapabilities: readonly NarrowphaseCapabilityN[];
  readonly cacheStatus: NarrowphaseCacheStatusN;
}

export interface NarrowphaseDistanceResultN extends NarrowphaseResultBaseN {
  readonly kind: 'distance';
  readonly capability: 'distance';
  readonly query: GjkResult;
}

export interface NarrowphaseShallowContactResultN extends NarrowphaseResultBaseN {
  readonly kind: 'shallow-contact';
  readonly capability: 'shallow-contact';
  readonly marginA: number;
  readonly marginB: number;
  readonly query: GjkMarginResult;
}

export interface NarrowphasePenetrationResult4 extends NarrowphaseResultBaseN {
  readonly kind: 'penetration';
  readonly capability: 'penetration';
  readonly algorithm: 'epa4';
  readonly query: EpaPenetrationResult4;
}

export interface NarrowphaseHyperboxDeepManifoldResultN extends NarrowphaseResultBaseN {
  readonly kind: 'deep-manifold';
  readonly capability: 'deep-manifold';
  readonly algorithm: 'hyperbox4';
  readonly query: HyperboxContactResult4;
}

export interface NarrowphasePolytopeDeepManifoldResult4
extends NarrowphaseResultBaseN {
  readonly kind: 'deep-manifold';
  readonly capability: 'deep-manifold';
  readonly algorithm: 'polytope4';
  readonly query: PolytopeContactResult4;
}

export interface NarrowphaseGlomeDeepManifoldResultN extends NarrowphaseResultBaseN {
  readonly kind: 'deep-manifold';
  readonly capability: 'deep-manifold';
  readonly algorithm: 'glome-glome';
  readonly query: GlomeGlomeContactResultN;
}

export interface NarrowphaseGlomeHyperplaneDeepManifoldResultN
extends NarrowphaseResultBaseN {
  readonly kind: 'deep-manifold';
  readonly capability: 'deep-manifold';
  readonly algorithm: 'glome-hyperplane';
  readonly query: GlomeHyperplaneContactResultN;
}

export interface NarrowphaseGlomeHyperboxDeepManifoldResult4
extends NarrowphaseResultBaseN {
  readonly kind: 'deep-manifold';
  readonly capability: 'deep-manifold';
  readonly algorithm: 'glome-hyperbox4';
  readonly query: GlomeHyperboxContactResult4;
}

export interface NarrowphaseHyperboxHyperplaneDeepManifoldResult4
extends NarrowphaseResultBaseN {
  readonly kind: 'deep-manifold';
  readonly capability: 'deep-manifold';
  readonly algorithm: 'hyperbox-hyperplane4';
  readonly query: HyperboxHyperplaneContactResult4;
}

export interface NarrowphasePolytopeHyperplaneDeepManifoldResult4
extends NarrowphaseResultBaseN {
  readonly kind: 'deep-manifold';
  readonly capability: 'deep-manifold';
  readonly algorithm: 'polytope-hyperplane4';
  readonly query: PolytopeHyperplaneContactResult4;
}

export type NarrowphaseDeepManifoldResultN =
  | NarrowphaseHyperboxDeepManifoldResultN
  | NarrowphasePolytopeDeepManifoldResult4
  | NarrowphaseGlomeDeepManifoldResultN
  | NarrowphaseGlomeHyperplaneDeepManifoldResultN
  | NarrowphaseGlomeHyperboxDeepManifoldResult4
  | NarrowphaseHyperboxHyperplaneDeepManifoldResult4
  | NarrowphasePolytopeHyperplaneDeepManifoldResult4;

export type NarrowphaseUnsupportedReasonN =
  | 'no-common-narrowphase-capability'
  | 'distance-requires-compact-support-pair'
  | 'shallow-contact-requires-compact-support-pair'
  | 'penetration-requires-zero-margin-r4-compact-support-pair'
  | 'deep-manifold-not-implemented-for-shape-pair'
  | 'deep-manifold-does-not-support-margins';

export interface NarrowphaseUnsupportedResultN extends NarrowphaseResultBaseN {
  readonly kind: 'unsupported';
  readonly capability: null;
  readonly reason: NarrowphaseUnsupportedReasonN;
}

export type NarrowphaseDispatchResultN =
  | NarrowphaseDistanceResultN
  | NarrowphaseShallowContactResultN
  | NarrowphasePenetrationResult4
  | NarrowphaseDeepManifoldResultN
  | NarrowphaseUnsupportedResultN;

export interface NarrowphaseDispatchBatchResultN {
  readonly results: readonly NarrowphaseDispatchResultN[];
  /** GJK pair caches absent or no longer applicable in this batch. */
  readonly retiredPairIds: readonly string[];
  readonly cacheSize: number;
}

interface CachedNarrowphasePairN {
  shapeA: SupportShapeN;
  shapeB: SupportShapeN;
  warmStart: GjkWarmStartN;
}

/**
 * Capability-aware dispatcher for compact convex support-shape pairs and
 * explicitly supported analytic infinite-boundary pairs.
 *
 * General pairs provide distance. Zero-margin compact R4 pairs additionally
 * provide a single EPA penetration witness. Spherical core margins provide
 * honest shallow contact while the cores remain separated. Vertex-enumerable
 * R4 polytopes provide clipped persistent manifolds and complete support-face
 * contact against infinite planes. R4 hyperboxes, pairs of
 * N-balls, N-ball/hyperplane pairs, and every R4 mixed pairing among glomes,
 * hyperboxes, and hyperplanes provide specialized exact deep contact results.
 * A requested capability is never silently replaced by a weaker one.
 */
export class NarrowphaseDispatcherN {
  private readonly warmStarts = new Map<string, CachedNarrowphasePairN>();

  get cacheSize(): number {
    return this.warmStarts.size;
  }

  dispatch(request: NarrowphaseDispatchRequestN): NarrowphaseDispatchResultN {
    const resolved = resolveRequest(request);
    const availableCapabilities = capabilitiesFor(
      request.shapeA,
      request.shapeB,
      resolved.marginA,
      resolved.marginB
    );
    const capability = selectedCapability(
      resolved.mode,
      availableCapabilities,
      resolved.marginA,
      resolved.marginB
    );
    const base = {
      pairId: request.pairId,
      dim: request.shapeA.dim,
      requestedMode: resolved.mode,
      availableCapabilities
    } as const;

    if (capability === null) {
      this.warmStarts.delete(request.pairId);
      return {
        ...base,
        kind: 'unsupported',
        capability: null,
        cacheStatus: 'unused',
        reason: unsupportedReason(request, resolved.mode)
      };
    }

    if (capability === 'deep-manifold') {
      if (
        request.shapeA instanceof HyperboxSupportShape4 &&
        request.shapeB instanceof HyperboxSupportShape4
      ) {
        this.warmStarts.delete(request.pairId);
        return {
          ...base,
          kind: 'deep-manifold',
          capability,
          algorithm: 'hyperbox4',
          cacheStatus: 'unused',
          query: hyperboxContactPatch4(
            request.shapeA,
            request.shapeB,
            request.hyperboxOptions
          )
        };
      }
      if (
        request.shapeA instanceof GlomeSupportShapeN &&
        request.shapeB instanceof GlomeSupportShapeN
      ) {
        this.warmStarts.delete(request.pairId);
        return {
          ...base,
          kind: 'deep-manifold',
          capability,
          algorithm: 'glome-glome',
          cacheStatus: 'unused',
          query: glomeGlomeContactN(request.shapeA, request.shapeB, {
            ...request.smoothContactOptions,
            marginA: resolved.marginA,
            marginB: resolved.marginB
          })
        };
      }
      if (
        (request.shapeA instanceof GlomeSupportShapeN &&
          request.shapeB instanceof HyperplaneColliderN) ||
        (request.shapeA instanceof HyperplaneColliderN &&
          request.shapeB instanceof GlomeSupportShapeN)
      ) {
        this.warmStarts.delete(request.pairId);
        return {
          ...base,
          kind: 'deep-manifold',
          capability,
          algorithm: 'glome-hyperplane',
          cacheStatus: 'unused',
          query: glomeHyperplaneContactN(request.shapeA, request.shapeB, {
            ...request.smoothContactOptions,
            glomeMargin:
              request.shapeA instanceof GlomeSupportShapeN
                ? resolved.marginA
                : resolved.marginB
          })
        };
      }
      if (
        (request.shapeA instanceof GlomeSupportShapeN &&
          request.shapeB instanceof HyperboxSupportShape4) ||
        (request.shapeA instanceof HyperboxSupportShape4 &&
          request.shapeB instanceof GlomeSupportShapeN)
      ) {
        this.warmStarts.delete(request.pairId);
        return {
          ...base,
          kind: 'deep-manifold',
          capability,
          algorithm: 'glome-hyperbox4',
          cacheStatus: 'unused',
          query: glomeHyperboxContact4(request.shapeA, request.shapeB, {
            ...request.mixedContactOptions,
            glomeMargin:
              request.shapeA instanceof GlomeSupportShapeN
                ? resolved.marginA
                : resolved.marginB,
            hyperboxMargin:
              request.shapeA instanceof HyperboxSupportShape4
                ? resolved.marginA
                : resolved.marginB
          })
        };
      }
      if (
        (request.shapeA instanceof HyperboxSupportShape4 &&
          request.shapeB instanceof HyperplaneColliderN) ||
        (request.shapeA instanceof HyperplaneColliderN &&
          request.shapeB instanceof HyperboxSupportShape4)
      ) {
        this.warmStarts.delete(request.pairId);
        return {
          ...base,
          kind: 'deep-manifold',
          capability,
          algorithm: 'hyperbox-hyperplane4',
          cacheStatus: 'unused',
          query: hyperboxHyperplaneContact4(request.shapeA, request.shapeB, {
            ...request.mixedContactOptions,
            hyperboxMargin:
              request.shapeA instanceof HyperboxSupportShape4
                ? resolved.marginA
                : resolved.marginB
          })
        };
      }
      if (
        (request.shapeA instanceof HyperplaneColliderN &&
          isSupportShape(request.shapeB) &&
          hasVertexEnumeration(request.shapeB)) ||
        (request.shapeB instanceof HyperplaneColliderN &&
          isSupportShape(request.shapeA) &&
          hasVertexEnumeration(request.shapeA))
      ) {
        this.warmStarts.delete(request.pairId);
        return {
          ...base,
          kind: 'deep-manifold',
          capability,
          algorithm: 'polytope-hyperplane4',
          cacheStatus: 'unused',
          query: polytopeHyperplaneContact4(request.shapeA, request.shapeB, {
            ...request.polytopeHyperplaneOptions,
            polytopeMargin:
              request.shapeA instanceof HyperplaneColliderN
                ? resolved.marginB
                : resolved.marginA
          })
        };
      }
      if (
        !isSupportShape(request.shapeA) ||
        !isSupportShape(request.shapeB) ||
        !hasVertexEnumeration(request.shapeA) ||
        !hasVertexEnumeration(request.shapeB)
      ) {
        throw new Error(
          'NarrowphaseDispatcherN: deep capability has no matching algorithm'
        );
      }
    }

    if (!isSupportShape(request.shapeA) || !isSupportShape(request.shapeB)) {
      throw new Error('NarrowphaseDispatcherN: compact capability selected for a hyperplane');
    }

    const cachedEntry = resolved.useCache
      ? this.warmStarts.get(request.pairId)
      : undefined;
    const cached =
      cachedEntry?.shapeA === request.shapeA &&
      cachedEntry.shapeB === request.shapeB
        ? cachedEntry.warmStart
        : undefined;
    if (resolved.useCache && cachedEntry && !cached) {
      this.warmStarts.delete(request.pairId);
    }
    const gjkOptions: GjkOptions = {
      ...request.gjkOptions,
      ...(cached ? { warmStart: cached } : {})
    };
    const cacheStatus: NarrowphaseCacheStatusN = resolved.useCache
      ? cached ? 'hit' : 'miss'
      : 'disabled';

    if (capability === 'deep-manifold') {
      const query = polytopeContactPatch4(request.shapeA, request.shapeB, {
        ...request.polytopeOptions,
        epaOptions: {
          ...request.epaOptions,
          gjkOptions
        }
      });
      if (resolved.useCache && query.epa) {
        this.warmStarts.set(request.pairId, {
          shapeA: request.shapeA,
          shapeB: request.shapeB,
          warmStart: query.epa.gjk.warmStart
        });
      }
      return {
        ...base,
        kind: 'deep-manifold',
        capability,
        algorithm: 'polytope4',
        cacheStatus,
        query
      };
    }

    if (capability === 'penetration') {
      const query = epaPenetration4(request.shapeA, request.shapeB, {
        ...request.epaOptions,
        gjkOptions
      });
      if (resolved.useCache) {
        this.warmStarts.set(request.pairId, {
          shapeA: request.shapeA,
          shapeB: request.shapeB,
          warmStart: query.gjk.warmStart
        });
      }
      return {
        ...base,
        kind: 'penetration',
        capability,
        algorithm: 'epa4',
        cacheStatus,
        query
      };
    }

    if (capability === 'distance') {
      const query = gjkDistance(request.shapeA, request.shapeB, gjkOptions);
      if (resolved.useCache) {
        this.warmStarts.set(request.pairId, {
          shapeA: request.shapeA,
          shapeB: request.shapeB,
          warmStart: query.warmStart
        });
      }
      return { ...base, kind: 'distance', capability, cacheStatus, query };
    }

    const query = gjkMarginDistance(request.shapeA, request.shapeB, {
      ...gjkOptions,
      marginA: resolved.marginA,
      marginB: resolved.marginB
    });
    if (resolved.useCache) {
      this.warmStarts.set(request.pairId, {
        shapeA: request.shapeA,
        shapeB: request.shapeB,
        warmStart: query.coreResult.warmStart
      });
    }
    return {
      ...base,
      kind: 'shallow-contact',
      capability,
      cacheStatus,
      marginA: resolved.marginA,
      marginB: resolved.marginB,
      query
    };
  }

  /** Canonical pair order plus immediate retirement of absent GJK caches. */
  dispatchBatch(
    requests: readonly NarrowphaseDispatchRequestN[]
  ): NarrowphaseDispatchBatchResultN {
    const ordered = [...requests].sort((left, right) => compareIds(left.pairId, right.pairId));
    const seen = new Set<string>();
    for (const { pairId } of ordered) {
      if (seen.has(pairId)) {
        throw new Error(`NarrowphaseDispatcherN.dispatchBatch: duplicate pair ID ${pairId}`);
      }
      seen.add(pairId);
    }
    const before = new Set(this.warmStarts.keys());
    const results = ordered.map((request) => this.dispatch(request));
    for (const pairId of Array.from(this.warmStarts.keys())) {
      if (!seen.has(pairId)) this.warmStarts.delete(pairId);
    }
    const retiredPairIds = Array.from(before)
      .filter((pairId) => !this.warmStarts.has(pairId))
      .sort(compareIds);
    return { results, retiredPairIds, cacheSize: this.warmStarts.size };
  }

  delete(pairId: string): boolean {
    return this.warmStarts.delete(pairId);
  }

  reset(): void {
    this.warmStarts.clear();
  }
}

interface ResolvedRequest {
  mode: NarrowphaseRequestModeN;
  marginA: number;
  marginB: number;
  useCache: boolean;
}

function resolveRequest(request: NarrowphaseDispatchRequestN): ResolvedRequest {
  if (request.pairId.length === 0) {
    throw new Error('NarrowphaseDispatcherN: pairId must not be empty');
  }
  if (request.shapeA.dim !== request.shapeB.dim || request.shapeA.dim < 1) {
    throw new Error(
      `NarrowphaseDispatcherN: shape dimensions differ (${request.shapeA.dim} vs ${request.shapeB.dim})`
    );
  }
  if (request.gjkOptions && 'warmStart' in request.gjkOptions) {
    throw new Error('NarrowphaseDispatcherN: warmStart is owned by the dispatcher');
  }
  const mode = request.mode ?? 'best';
  if (
    mode !== 'best' &&
    mode !== 'distance' &&
    mode !== 'shallow-contact' &&
    mode !== 'penetration' &&
    mode !== 'deep-manifold'
  ) {
    throw new Error(`NarrowphaseDispatcherN: unknown mode ${String(mode)}`);
  }
  const marginA = request.marginA ?? 0;
  const marginB = request.marginB ?? 0;
  assertMargin(marginA, 'marginA');
  assertMargin(marginB, 'marginB');
  return { mode, marginA, marginB, useCache: request.useCache ?? true };
}

function capabilitiesFor(
  shapeA: NarrowphaseShapeN,
  shapeB: NarrowphaseShapeN,
  marginA: number,
  marginB: number
): NarrowphaseCapabilityN[] {
  const capabilities: NarrowphaseCapabilityN[] = [];
  if (isSupportShape(shapeA) && isSupportShape(shapeB)) {
    capabilities.push('distance', 'shallow-contact');
  }
  if (
    marginA === 0 &&
    marginB === 0 &&
    shapeA.dim === 4 &&
    isSupportShape(shapeA) &&
    isSupportShape(shapeB)
  ) {
    capabilities.push('penetration');
  }
  if (
    marginA === 0 &&
    marginB === 0 &&
    shapeA instanceof HyperboxSupportShape4 &&
    shapeB instanceof HyperboxSupportShape4
  ) {
    capabilities.push('deep-manifold');
  }
  if (
    shapeA instanceof GlomeSupportShapeN &&
    shapeB instanceof GlomeSupportShapeN
  ) {
    capabilities.push('deep-manifold');
  }
  if (
    shapeA instanceof GlomeSupportShapeN &&
    shapeB instanceof HyperplaneColliderN &&
    marginB === 0
  ) {
    capabilities.push('deep-manifold');
  }
  if (
    shapeA instanceof HyperplaneColliderN &&
    shapeB instanceof GlomeSupportShapeN &&
    marginA === 0
  ) {
    capabilities.push('deep-manifold');
  }
  if (
    ((shapeA instanceof HyperplaneColliderN &&
      isSupportShape(shapeB) &&
      shapeA.dim === 4 &&
      hasVertexEnumeration(shapeB) &&
      marginA === 0) ||
    (shapeB instanceof HyperplaneColliderN &&
      isSupportShape(shapeA) &&
      shapeB.dim === 4 &&
      hasVertexEnumeration(shapeA) &&
      marginB === 0)) &&
    !capabilities.includes('deep-manifold')
  ) {
    capabilities.push('deep-manifold');
  }
  if (
    (shapeA instanceof GlomeSupportShapeN &&
      shapeB instanceof HyperboxSupportShape4) ||
    (shapeA instanceof HyperboxSupportShape4 &&
      shapeB instanceof GlomeSupportShapeN)
  ) {
    capabilities.push('deep-manifold');
  }
  if (
    shapeA instanceof HyperboxSupportShape4 &&
    shapeB instanceof HyperplaneColliderN &&
    marginB === 0 &&
    !capabilities.includes('deep-manifold')
  ) {
    capabilities.push('deep-manifold');
  }
  if (
    shapeA instanceof HyperplaneColliderN &&
    shapeB instanceof HyperboxSupportShape4 &&
    marginA === 0 &&
    !capabilities.includes('deep-manifold')
  ) {
    capabilities.push('deep-manifold');
  }
  if (
    marginA === 0 &&
    marginB === 0 &&
    shapeA.dim === 4 &&
    isSupportShape(shapeA) &&
    isSupportShape(shapeB) &&
    hasVertexEnumeration(shapeA) &&
    hasVertexEnumeration(shapeB) &&
    !capabilities.includes('deep-manifold')
  ) {
    capabilities.push('deep-manifold');
  }
  return capabilities;
}

function selectedCapability(
  mode: NarrowphaseRequestModeN,
  available: readonly NarrowphaseCapabilityN[],
  marginA: number,
  marginB: number
): NarrowphaseCapabilityN | null {
  if (mode !== 'best') return available.includes(mode) ? mode : null;
  if (available.includes('deep-manifold')) return 'deep-manifold';
  if ((marginA > 0 || marginB > 0) && available.includes('shallow-contact')) {
    return 'shallow-contact';
  }
  if (available.includes('penetration')) return 'penetration';
  if (available.includes('distance')) return 'distance';
  if (available.includes('shallow-contact')) return 'shallow-contact';
  return null;
}

function unsupportedReason(
  request: NarrowphaseDispatchRequestN,
  mode: NarrowphaseRequestModeN
): NarrowphaseUnsupportedReasonN {
  if (mode === 'distance') return 'distance-requires-compact-support-pair';
  if (mode === 'shallow-contact') {
    return 'shallow-contact-requires-compact-support-pair';
  }
  if (mode === 'penetration') {
    return 'penetration-requires-zero-margin-r4-compact-support-pair';
  }
  if (mode === 'deep-manifold') {
    if (
      (request.shapeA instanceof HyperplaneColliderN && request.marginA !== undefined && request.marginA > 0) ||
      (request.shapeB instanceof HyperplaneColliderN && request.marginB !== undefined && request.marginB > 0)
    ) {
      return 'deep-manifold-does-not-support-margins';
    }
    if (
      (request.shapeA instanceof HyperboxSupportShape4 &&
        request.shapeB instanceof HyperboxSupportShape4) ||
      (request.shapeA instanceof GlomeSupportShapeN &&
        request.shapeB instanceof HyperplaneColliderN) ||
      (request.shapeA instanceof HyperplaneColliderN &&
        request.shapeB instanceof GlomeSupportShapeN) ||
      (request.shapeA instanceof HyperboxSupportShape4 &&
        request.shapeB instanceof HyperplaneColliderN) ||
      (request.shapeA instanceof HyperplaneColliderN &&
        request.shapeB instanceof HyperboxSupportShape4)
    ) {
      return 'deep-manifold-does-not-support-margins';
    }
    return 'deep-manifold-not-implemented-for-shape-pair';
  }
  return 'no-common-narrowphase-capability';
}

function isSupportShape(shape: NarrowphaseShapeN): shape is SupportShapeN {
  return !(shape instanceof HyperplaneColliderN);
}

function hasVertexEnumeration(shape: SupportShapeN): boolean {
  return shape.polytopeTopology !== undefined || shape.enumerateVertices?.() !== undefined;
}

function assertMargin(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`NarrowphaseDispatcherN: ${name} must be finite and non-negative`);
  }
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
