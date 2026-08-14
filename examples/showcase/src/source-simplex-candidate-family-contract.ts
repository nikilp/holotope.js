/**
 * Headless composition example for a source-indexed finite-obstacle family.
 *
 * This stays unrouted: it demonstrates candidate and solver evidence without
 * choosing a camera, material, layout, or application interaction policy.
 */
import { CellComplex, VecN } from '@holotope/core';
import {
  compileXpbdParticleBindingN,
  compileXpbdParticleSourceSimplexBarrierFamilyN,
  type CompileXpbdParticleSourceSimplexBarrierFamilyNOptions,
  type XpbdParticleSourceSimplexActiveCandidateN,
  type XpbdParticleSourceSimplexBarrierFamilyEvaluationN,
  type XpbdParticleSourceSimplexBarrierFamilyStepFilterEvaluationN,
  type XpbdParticleSourceSimplexBarrierFamilyStepFilterRefusalReasonN,
  type XpbdParticleSourceSimplexBarrierFamilyTermsN,
  type XpbdParticleSourceSimplexCandidateDiagnosticsN,
  type XpbdParticleSourceSimplexCandidateN,
  type XpbdParticleSourceSimplexCandidateQueryN,
  type XpbdParticleSourceSimplexSegmentCandidateN
} from '@holotope/physics';

/** Runs one dynamic R4 point against one static source tetrahedron. */
export function sourceSimplexCandidateFamilyContractExample(): string {
  const dynamic = new CellComplex(
    4,
    new Float64Array([0.2, 0.2, 0.2, 0.5]),
    []
  );
  const binding = compileXpbdParticleBindingN({ id: 'dynamic', source: dynamic });
  const simplexGroup = {
    key: 'obstacle-tetrahedra',
    dim: 3,
    verticesPerCell: 4,
    kind: 'simplex' as const,
    indices: new Uint32Array([0, 1, 2, 3])
  };
  const obstacle = new CellComplex(4, new Float64Array([
    0, 0, 0, 0,
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0
  ]), [simplexGroup]);
  const familyOptions:
    CompileXpbdParticleSourceSimplexBarrierFamilyNOptions = {
    id: 'finite-obstacle',
    binding,
    obstacle,
    simplexGroup,
    minimumDistance: 0.05,
    activationDistance: 0.8,
    stiffness: 1,
    maximumDirectionError: 2 ** -12
  };
  const family = compileXpbdParticleSourceSimplexBarrierFamilyN(familyOptions);

  const evaluated: XpbdParticleSourceSimplexBarrierFamilyEvaluationN =
    family.evaluate();
  const query: XpbdParticleSourceSimplexCandidateQueryN =
    evaluated.candidateQuery;
  const diagnostics: XpbdParticleSourceSimplexCandidateDiagnosticsN =
    query.diagnostics;
  const active: readonly XpbdParticleSourceSimplexActiveCandidateN[] =
    evaluated.activeCandidates;
  const candidate: XpbdParticleSourceSimplexCandidateN | undefined =
    query.candidates[0];
  const terms: XpbdParticleSourceSimplexBarrierFamilyTermsN =
    family.incrementalPotentialTerms();
  const filtered:
    XpbdParticleSourceSimplexBarrierFamilyStepFilterEvaluationN =
      family.stepFilter.evaluate({
        dimension: 4,
        requestedStepLength: 1,
        positionBefore: () => new VecN([0.2, 0.2, 0.2, 0.5]),
        positionAfter: () => new VecN([0.2, 0.2, 0.2, -0.5])
      });
  const segmentCandidate: XpbdParticleSourceSimplexSegmentCandidateN | undefined =
    filtered.candidates[0];
  const refusalReason:
    XpbdParticleSourceSimplexBarrierFamilyStepFilterRefusalReasonN | null =
      filtered.status === 'indeterminate' ? filtered.reason : null;

  return JSON.stringify({
    possiblePairs: diagnostics.possiblePairs,
    broadphaseCandidates: diagnostics.candidatePairs,
    activeCandidates: active.map(
      ({ candidate }) => candidate.id
    ),
    firstCandidate: candidate?.id ?? null,
    providerCount: terms.providers.length,
    stepStatus: filtered.status,
    blockingCandidateId: filtered.blockingCandidateId,
    firstSegmentCandidate: segmentCandidate?.candidate.id ?? null,
    refusalReason
  });
}
