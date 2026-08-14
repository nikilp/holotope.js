/**
 * Headless composition example for the finite source-simplex contact pair.
 *
 * This is deliberately not a routed showcase. It demonstrates how a consumer
 * can turn the public evidence into diagnostics without introducing camera,
 * material, HUD, or game-state policy into the library.
 */
import { VecN, type SourceSimplexReferenceN } from '@holotope/core';
import {
  XpbdParticleN,
  XpbdParticleSourceSimplexBarrierN,
  XpbdParticleSourceSimplexBarrierStepFilterN,
  type XpbdParticleSourceSimplexBarrierDomainReasonN,
  type XpbdParticleSourceSimplexBarrierEvaluationN,
  type XpbdParticleSourceSimplexBarrierNOptions,
  type XpbdParticleSourceSimplexBarrierPublicationReasonN,
  type XpbdParticleSourceSimplexBarrierStepFilterCertificationN,
  type XpbdParticleSourceSimplexBarrierStepFilterEvaluationN,
  type XpbdParticleSourceSimplexBarrierStepFilterEvidenceN,
  type XpbdParticleSourceSimplexBarrierStepFilterNOptions,
  type XpbdParticleSourceSimplexBarrierStepFilterRefusalReasonN,
  type XpbdParticleSourceSimplexBarrierStepFilterStartEvidenceN
} from '@holotope/physics';

/** Drives the complete public barrier/filter evidence from one authored pair. */
export function sourceSimplexContactContractExample(options: {
  readonly simplex: SourceSimplexReferenceN;
  readonly before: VecN;
  readonly after: VecN;
}): string {
  const particle = new XpbdParticleN({ id: 'example/point', position: options.before });
  const barrierOptions: XpbdParticleSourceSimplexBarrierNOptions = {
    id: 'example/simplex-barrier',
    particle,
    simplex: options.simplex,
    minimumDistance: 0.01,
    activationDistance: 0.1,
    stiffness: 1,
    maximumDirectionError: 2 ** -12
  };
  const barrier = new XpbdParticleSourceSimplexBarrierN(barrierOptions);
  const evaluated: XpbdParticleSourceSimplexBarrierEvaluationN =
    barrier.evaluate();
  const filterOptions: XpbdParticleSourceSimplexBarrierStepFilterNOptions = {
    id: 'example/simplex-filter', barrier
  };
  const filter = new XpbdParticleSourceSimplexBarrierStepFilterN(filterOptions);
  const filtered: XpbdParticleSourceSimplexBarrierStepFilterEvaluationN =
    filter.evaluate({
      dimension: particle.dimension,
      requestedStepLength: 1,
      positionBefore: () => options.before.clone(),
      positionAfter: () => options.after.clone()
    });
  const evidence: XpbdParticleSourceSimplexBarrierStepFilterEvidenceN = filtered;

  return JSON.stringify({
    distance: evaluated.distance,
    barrierCoordinate: evaluated.barrierCoordinate,
    barrierActivation: evaluated.barrierActivation,
    normal: evaluated.separationNormal.toArray(),
    sourceWeights: evaluated.projection.coordinate.weights,
    stepStatus: filtered.status,
    certifiedFraction: evidence.certifiedFraction,
    // `certification` names the PROOF used, so it exists only on a result that
    // has one. A refusal reports its `reason` instead — the two are different
    // claims and the type keeps them apart.
    ...(filtered.status === 'indeterminate'
      ? { reason: filtered.reason }
      : { certification: filtered.certification }),
    ...describeStartEvidence(filtered)
  });
}

/**
 * Start-state evidence exists only when the start's exact decision published,
 * so a consumer reads it through a narrowed view rather than a nullable field.
 * The one refusal that DOES carry it is `initial-domain-violation`: a violation
 * has to be established from a measured distance before it can be claimed.
 */
function describeStartEvidence(
  filtered: XpbdParticleSourceSimplexBarrierStepFilterEvaluationN
): { readonly startDistance?: number, readonly startMargin?: number } {
  if (filtered.status === 'indeterminate' &&
    filtered.reason !== 'initial-domain-violation') {
    return {};
  }
  const started: XpbdParticleSourceSimplexBarrierStepFilterStartEvidenceN =
    filtered;
  return {
    startDistance: started.startDistance, startMargin: started.startMargin
  };
}

/**
 * Names one label from each released vocabulary, without conflating them.
 *
 * The potential and filter vocabularies are distinct where their claims differ
 * and SHARED where they do not: a publication reason means the same thing in
 * both places — the exact decision could not be represented — so one caller
 * recovery table serves both, and the third entry here is deliberately a
 * member of all three types.
 */
export function sourceSimplexContactRefusalLabels():
readonly [string, string, string] {
  const potential: XpbdParticleSourceSimplexBarrierDomainReasonN =
    'at-or-below-minimum-distance';
  const filter: XpbdParticleSourceSimplexBarrierStepFilterRefusalReasonN =
    'initial-domain-violation';
  const shared: XpbdParticleSourceSimplexBarrierPublicationReasonN =
    'point-simplex-weight-underflow';
  const asDomain: XpbdParticleSourceSimplexBarrierDomainReasonN = shared;
  const asFilter: XpbdParticleSourceSimplexBarrierStepFilterRefusalReasonN =
    shared;
  void asDomain;
  void asFilter;
  return [potential, filter, shared];
}

/** The three proofs a certified prefix can rest on, in strength order. */
export function sourceSimplexContactCertifications():
readonly XpbdParticleSourceSimplexBarrierStepFilterCertificationN[] {
  return ['stationary', 'convex-nondecreasing', 'global-lipschitz'];
}
