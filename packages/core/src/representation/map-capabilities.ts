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
    case 'affine-section-n':
    case 'affine-slice-chart-n':
      return capabilities('conditional', 'exact', 'unavailable', 'unavailable', 'preserved');
    case 'orthographic-projection':
    case 'coordinate-subspace-projection':
      return capabilities('exact', 'unavailable', 'exact', 'unavailable', 'preserved');
    case 'iterated-perspective-projection':
      return capabilities('conditional', 'conditional', 'exact', 'unavailable', 'preserved');
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

/**
 * The exported symbol that performs a capability, and where it is exported from.
 *
 * `symbol` is a bare function name, or `Class.method` for a method verb.
 */
export interface RepresentationCapabilityVerbN {
  /** Exported name, or `Class.method` where the verb is a method. */
  readonly symbol: string;
  /** Package the symbol is exported from, as an import specifier. */
  readonly module: string;
}

/**
 * Which symbol performs each capability, or `undefined` where none is named.
 *
 * A capability level says an operation is possible; it does not say what
 * performs it, and the two are not the same fact. `pointLift: 'exact'` on an
 * affine slice chart is satisfied by `HyperplaneSlice4.embedPoint`, which lives
 * in another module under a name sharing no vocabulary with the capability — so
 * a caller who reads this module end to end learns that the lift exists and not
 * that it ships. Naming the verb here closes the distance, and a test asserts
 * every name below still resolves on the public surface, so the pointer cannot
 * rot into a lie the way a comment would.
 *
 * `undefined` means either that the capability is `unavailable` for the recipe,
 * or that no single exported symbol has been identified as performing it. The
 * second case is deliberately not hidden: `attributeTransport` is declared at
 * `exact` for several recipes and no verb anywhere in the package is named for
 * it, which is a real gap rather than an omission in this table.
 */
export interface RepresentationMapCapabilityVerbsN {
  /** Takes a source point to its representation. */
  readonly pointForward: RepresentationCapabilityVerbN | undefined;
  /** Takes a representation point back to a source point. */
  readonly pointLift: RepresentationCapabilityVerbN | undefined;
  /** Enumerates the source set collapsing onto one representation point. */
  readonly inverseFibre: RepresentationCapabilityVerbN | undefined;
  /** Carries per-vertex attributes across the map. No verb ships for this. */
  readonly attributeTransport: RepresentationCapabilityVerbN | undefined;
  /** Names the source cell a representation element came from. */
  readonly sourceIdentity: RepresentationCapabilityVerbN | undefined;
}

const CORE = '@holotope/core';
const FORWARD: RepresentationCapabilityVerbN = {
  symbol: 'evaluateRepresentationLineagePointN', module: CORE
};
const SLICE_LIFT: RepresentationCapabilityVerbN = {
  symbol: 'HyperplaneSlice4.embedPoint', module: CORE
};
const PERSPECTIVE_LIFT: RepresentationCapabilityVerbN = {
  symbol: 'liftHomogeneousSimplexPointN', module: CORE
};
const FIBRE: RepresentationCapabilityVerbN = {
  symbol: 'evaluateProjectionFibre', module: CORE
};
const SOURCE_REFERENCE: RepresentationCapabilityVerbN = {
  symbol: 'createSourceCellReferenceN', module: CORE
};

/** The symbol performing each capability of one recipe kind. */
export function representationMapCapabilityVerbsN(
  recipe: RepresentationMapRecipeN
): RepresentationMapCapabilityVerbsN {
  switch (recipe.kind) {
    case 'affine-section':
    case 'affine-slice-chart':
    case 'affine-section-n':
    case 'affine-slice-chart-n':
      return verbs(FORWARD, SLICE_LIFT, undefined, undefined, SOURCE_REFERENCE);
    case 'orthographic-projection':
    case 'coordinate-subspace-projection':
      return verbs(FORWARD, undefined, FIBRE, undefined, SOURCE_REFERENCE);
    case 'iterated-perspective-projection':
      return verbs(FORWARD, PERSPECTIVE_LIFT, FIBRE, undefined, SOURCE_REFERENCE);
    case 'custom-projection':
      return verbs(undefined, undefined, undefined, undefined, SOURCE_REFERENCE);
    case 'field-restriction':
    case 'sampled-isosurface':
    case 'ray-realization':
      return verbs(FORWARD, undefined, undefined, undefined, SOURCE_REFERENCE);
  }
}

function verbs(
  pointForward: RepresentationCapabilityVerbN | undefined,
  pointLift: RepresentationCapabilityVerbN | undefined,
  inverseFibre: RepresentationCapabilityVerbN | undefined,
  attributeTransport: RepresentationCapabilityVerbN | undefined,
  sourceIdentity: RepresentationCapabilityVerbN | undefined
): RepresentationMapCapabilityVerbsN {
  return Object.freeze({
    pointForward,
    pointLift,
    inverseFibre,
    attributeTransport,
    sourceIdentity
  });
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
