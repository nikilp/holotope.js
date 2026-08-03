/**
 * Headless comparison of the two source-simplex candidate strategies.
 *
 * This stays unrouted: the interesting claim is that an accelerated search
 * retains exactly what the exhaustive scan retains, and an identical animation
 * is not evidence of that. The evidence is the candidate identities, and they
 * are text.
 *
 * Both families here index the same obstacle geometry with the same activation
 * distance. The only difference is that one was given a compiled hierarchy.
 */
import { CellComplex } from '@holotope/core';
import {
  XpbdWorldN,
  compileXpbdParticleBindingN,
  compileXpbdParticleSourceSimplexBarrierFamilyN,
  compileXpbdSourceSimplexAabbHierarchyN,
  stepXpbdIncrementalPotentialWorldN,
  type XpbdParticleSourceSimplexBarrierFamilyN,
  type CompileXpbdSourceSimplexAabbHierarchyNOptions,
  type XpbdParticleSourceSimplexCandidateQueryN,
  type XpbdSourceSimplexAabbQueryDiagnosticsN,
  type XpbdSourceSimplexAabbQueryN
} from '@holotope/physics';

/** A widely separated lattice of R4 tetrahedra, so pruning has something to do. */
function obstacleLattice(perAxis: number, spacing: number): {
  complex: CellComplex;
  group: { key: string; dim: number; verticesPerCell: number; kind: 'simplex'; indices: Uint32Array };
} {
  const origins: number[][] = [];
  const walk = (prefix: number[]): void => {
    if (prefix.length === 4) { origins.push(prefix.slice()); return; }
    for (let step = 0; step < perAxis; step++) walk([...prefix, step * spacing]);
  };
  walk([]);

  const positions: number[] = [];
  const indices: number[] = [];
  origins.forEach((origin, cell) => {
    for (let vertex = 0; vertex < 4; vertex++) {
      const point = origin.slice();
      if (vertex > 0) point[vertex - 1]! += 0.7;
      positions.push(...point);
      indices.push(cell * 4 + vertex);
    }
  });
  const group = {
    key: 'obstacle-simplices',
    dim: 3,
    verticesPerCell: 4,
    kind: 'simplex' as const,
    indices: Uint32Array.from(indices)
  };
  return {
    complex: new CellComplex(4, Float64Array.from(positions), [group]),
    group
  };
}

/** The hierarchy options, named so the option type has a consumer. */
function hierarchyFor(
  obstacle: CellComplex,
  simplexGroup: CompileXpbdSourceSimplexAabbHierarchyNOptions['simplexGroup']
) {
  const options: CompileXpbdSourceSimplexAabbHierarchyNOptions = {
    obstacle, simplexGroup, leafSize: 4
  };
  return compileXpbdSourceSimplexAabbHierarchyN(options);
}

/** One scene; `accelerated` selects the hierarchy without changing anything else. */
function build(id: string, accelerated: boolean): {
  world: XpbdWorldN;
  family: XpbdParticleSourceSimplexBarrierFamilyN;
} {
  const { complex, group } = obstacleLattice(4, 6);
  const source = new CellComplex(
    4,
    Float64Array.from([0.2, 0.2, 0.2, 0.3, 6.2, 0.2, 0.2, 0.3]),
    []
  );
  const binding = compileXpbdParticleBindingN({ id: `${id}-dynamic`, source });
  for (const particle of binding.particles) particle.velocity.data[3] = -4;

  const family = compileXpbdParticleSourceSimplexBarrierFamilyN({
    id: `${id}-contact`,
    binding,
    obstacle: complex,
    simplexGroup: group,
    minimumDistance: 0.05,
    activationDistance: 0.8,
    stiffness: 1.7,
    ...(accelerated ? { candidateHierarchy: hierarchyFor(complex, group) } : {})
  });

  const world = new XpbdWorldN({ dimension: 4, gravity: [0, 0, 0, -9.81] });
  binding.addToWorld(world);
  family.addToWorld(world);
  return { world, family };
}

/** Candidate identities with the scene prefix removed, so the two are comparable. */
function identities(
  query: XpbdParticleSourceSimplexCandidateQueryN,
  id: string
): string[] {
  return query.candidates.map((candidate) => candidate.id.replace(id, 'scene'));
}

/**
 * Runs both strategies over identical geometry and reports what agrees.
 *
 * The exhaustive scan is the oracle. Any difference in the returned strings is
 * a defect in the hierarchy, not a tuning question.
 */
export function sourceSimplexHierarchyContractExample(): string {
  const plain = build('exhaustive', false);
  const fast = build('hierarchy', true);

  const plainQuery = plain.family.queryAt((particle) => particle.position.clone());
  const fastQuery = fast.family.queryAt((particle) => particle.position.clone());
  const plainIds = identities(plainQuery, 'exhaustive');
  const fastIds = identities(fastQuery, 'hierarchy');

  const plainEvaluation = plain.family.evaluate();
  const fastEvaluation = fast.family.evaluate();

  // The paired filter still decides the admissible prefix. A hierarchy narrows
  // which pairs are asked; it never answers for them.
  const segment = (family: XpbdParticleSourceSimplexBarrierFamilyN) =>
    family.stepFilter.evaluate({
      dimension: 4,
      requestedStepLength: 1,
      positionBefore: (particle) => particle.position.clone(),
      positionAfter: (particle) => {
        const next = particle.position.clone();
        next.data[3]! -= 0.6;
        return next;
      }
    });
  const plainFilter = segment(plain.family);
  const fastFilter = segment(fast.family);

  const options = {
    deltaTime: 1 / 120,
    warmStart: 'feasible-inertial-prediction' as const,
    minimization: { directionPolicy: 'steepest-descent' as const }
  };
  const plainStep = stepXpbdIncrementalPotentialWorldN({
    world: plain.world, stepFilters: [plain.family.stepFilter], ...options
  });
  const fastStep = stepXpbdIncrementalPotentialWorldN({
    world: fast.world, stepFilters: [fast.family.stepFilter], ...options
  });

  const hierarchy: XpbdSourceSimplexAabbQueryDiagnosticsN | undefined =
    fastQuery.diagnostics.hierarchy;

  // The tree is also directly queryable, and answers with source references
  // rather than tree ordinals.
  const direct: XpbdSourceSimplexAabbQueryN | null =
    fast.family.candidateHierarchy === null
      ? null
      : fast.family.candidateHierarchy.query({
        min: [-0.5, -0.5, -0.5, -0.5], max: [1.5, 1.5, 1.5, 1.5]
      });

  return JSON.stringify({
    // The claim this example exists to support.
    candidateIdsAgree: JSON.stringify(fastIds) === JSON.stringify(plainIds),
    candidateIds: plainIds,
    // Search work, in operations. Never milliseconds.
    strategies: [plainQuery.diagnostics.strategy, fastQuery.diagnostics.strategy],
    possiblePairs: plainQuery.diagnostics.possiblePairs,
    exhaustiveAxisTests: plainQuery.diagnostics.axisTests,
    hierarchyTestedSimplexBounds: hierarchy?.testedSimplexBounds ?? null,
    hierarchyVisitedNodes: hierarchy?.visitedNodes ?? null,
    hierarchyVisitedLeaves: hierarchy?.visitedLeaves ?? null,
    totalSimplices: hierarchy?.totalSimplices ?? null,
    // Exact contact is still the P44 barrier's answer, not the tree's.
    activeIdsAgree:
      JSON.stringify(fastEvaluation.activeCandidates.map(
        (active) => active.candidate.id.replace('hierarchy', 'scene')
      )) ===
      JSON.stringify(plainEvaluation.activeCandidates.map(
        (active) => active.candidate.id.replace('exhaustive', 'scene')
      )),
    potentialEnergyAgrees:
      fastEvaluation.potentialEnergy === plainEvaluation.potentialEnergy,
    // The paired filter is not optional because a hierarchy exists.
    filterStatusAgrees: fastFilter.status === plainFilter.status,
    blockerAgrees:
      (fastFilter.blockingCandidateId ?? '').replace('hierarchy', 'scene') ===
      (plainFilter.blockingCandidateId ?? '').replace('exhaustive', 'scene'),
    // And the world-scoped transaction reaches the same terminal.
    worldStepAgrees:
      fastStep.step.status === plainStep.step.status &&
      fastStep.diagnosis.condition === plainStep.diagnosis.condition,
    worldStepStatus: plainStep.step.status,
    worldStepCondition: plainStep.diagnosis.condition,
    // Direct hierarchy query: persistent cell identity, not tree ordinals.
    directQueryCellIndices: direct === null ? null : [...direct.cellIndices],
    directQueryRetained: direct?.diagnostics.retainedSimplices ?? null
  });
}
