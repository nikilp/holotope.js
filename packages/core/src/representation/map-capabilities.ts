import type {
  RepresentationLineageN,
  RepresentationMapRecipeN
} from './map.js';

/** Independent quality of one map operation encoded by a recipe. */
export type RepresentationCapabilityLevel =
  | 'exact'
  | 'conditional'
  | 'approximate'
  | 'record-dependent'
  | 'unavailable';

/** Whether source identity passes through directly or through retained records. */
export type RepresentationSourceIdentityCapability =
  | 'preserved'
  | 'recorded'
  | 'unavailable';

/**
 * Capability facts for one discriminated representation recipe.
 *
 * These fields remain independent deliberately: an orthographic projection
 * has an exact inverse fibre but no unique point lift, while an affine slice
 * chart has an exact point lift and no non-trivial inverse fibre.
 */
export interface RepresentationMapCapabilitiesN {
  readonly pointForward: RepresentationCapabilityLevel;
  readonly pointLift: RepresentationCapabilityLevel;
  readonly inverseFibre: RepresentationCapabilityLevel;
  readonly attributeTransport: RepresentationCapabilityLevel;
  readonly sourceIdentity: RepresentationSourceIdentityCapability;
}

/** Capability record pinned to one landed recipe kind. */
export function representationMapCapabilitiesN(
  recipe: RepresentationMapRecipeN
): RepresentationMapCapabilitiesN {
  switch (recipe.kind) {
    case 'affine-section':
    case 'affine-slice-chart':
      return capabilities('conditional', 'exact', 'unavailable', 'exact', 'preserved');
    case 'orthographic-projection':
    case 'coordinate-subspace-projection':
      return capabilities('exact', 'unavailable', 'exact', 'exact', 'preserved');
    case 'iterated-perspective-projection':
      return capabilities('conditional', 'conditional', 'exact', 'conditional', 'preserved');
    case 'custom-projection':
      return capabilities('unavailable', 'unavailable', 'unavailable', 'unavailable', 'preserved');
    case 'field-restriction':
      return capabilities('record-dependent', 'exact', 'unavailable', 'record-dependent', 'recorded');
    case 'sampled-isosurface':
      return capabilities('approximate', 'approximate', 'unavailable', 'approximate', 'recorded');
    case 'ray-realization':
      return capabilities('approximate', 'approximate', 'unavailable', 'record-dependent', 'recorded');
  }
}

/** Compose quality monotonically across an ordered lineage. */
export function representationLineageCapabilitiesN(
  lineage: RepresentationLineageN
): RepresentationMapCapabilitiesN {
  if (lineage.steps.length === 0) {
    return capabilities('exact', 'exact', 'unavailable', 'exact', 'preserved');
  }
  let result = representationMapCapabilitiesN(lineage.steps[0]!);
  for (let step = 1; step < lineage.steps.length; step++) {
    const recipe = lineage.steps[step]!;
    const next = representationMapCapabilitiesN(recipe);
    result = capabilities(
      worseLevel(result.pointForward, next.pointForward),
      worseLevel(result.pointLift, next.pointLift),
      worseLevel(result.inverseFibre, next.inverseFibre),
      worseLevel(result.attributeTransport, next.attributeTransport),
      worseIdentity(result.sourceIdentity, next.sourceIdentity)
    );
  }
  return result;
}

function capabilities(
  pointForward: RepresentationCapabilityLevel,
  pointLift: RepresentationCapabilityLevel,
  inverseFibre: RepresentationCapabilityLevel,
  attributeTransport: RepresentationCapabilityLevel,
  sourceIdentity: RepresentationSourceIdentityCapability
): RepresentationMapCapabilitiesN {
  return Object.freeze({
    pointForward,
    pointLift,
    inverseFibre,
    attributeTransport,
    sourceIdentity
  });
}

const LEVEL_ORDER: Readonly<Record<RepresentationCapabilityLevel, number>> = {
  exact: 0,
  conditional: 1,
  approximate: 2,
  'record-dependent': 3,
  unavailable: 4
};

function worseLevel(
  left: RepresentationCapabilityLevel,
  right: RepresentationCapabilityLevel
): RepresentationCapabilityLevel {
  return LEVEL_ORDER[left] >= LEVEL_ORDER[right] ? left : right;
}

const IDENTITY_ORDER: Readonly<Record<RepresentationSourceIdentityCapability, number>> = {
  preserved: 0,
  recorded: 1,
  unavailable: 2
};

function worseIdentity(
  left: RepresentationSourceIdentityCapability,
  right: RepresentationSourceIdentityCapability
): RepresentationSourceIdentityCapability {
  return IDENTITY_ORDER[left] >= IDENTITY_ORDER[right] ? left : right;
}
