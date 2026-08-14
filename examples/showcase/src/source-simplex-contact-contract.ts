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
  type XpbdParticleSourceSimplexBarrierStepFilterEvaluationN,
  type XpbdParticleSourceSimplexBarrierStepFilterEvidenceN,
  type XpbdParticleSourceSimplexBarrierStepFilterNOptions,
  type XpbdParticleSourceSimplexBarrierStepFilterRefusalReasonN
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
    certification: evidence.certification
  });
}

/** Makes the two refusal vocabularies explicit without conflating them. */
export function sourceSimplexContactRefusalLabels(): readonly [string, string] {
  const potential: XpbdParticleSourceSimplexBarrierDomainReasonN =
    'at-or-below-minimum-distance';
  const filter: XpbdParticleSourceSimplexBarrierStepFilterRefusalReasonN =
    'initial-domain-violation';
  return [potential, filter];
}
