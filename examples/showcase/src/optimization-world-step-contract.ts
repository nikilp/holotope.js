/**
 * Headless composition example for one world-scoped nonlinear advance.
 *
 * This stays unrouted: it demonstrates what an authored world contributes to
 * the incremental-potential transaction and what evidence survives the call,
 * without choosing a camera, material, layout, or interaction policy.
 *
 * The point of comparison is what a caller writes. Advancing this scene
 * through `stepXpbdIncrementalPotentialN()` directly means naming the
 * dimension, the particle list, the gravity vector, and the provider registry
 * at the call site — four pieces of state the world already holds, and four
 * chances for the solved scene to diverge from the rendered one. Here only the
 * ordered filter and the interval are named, because the world does not own
 * filters and cannot know the interval.
 */
import { CellComplex } from '@holotope/core';
import {
  XpbdWorldN,
  compileXpbdParticleBindingN,
  compileXpbdParticleSourceSimplexBarrierFamilyN,
  stepXpbdIncrementalPotentialWorldN,
  type StepXpbdIncrementalPotentialWorldNOptions,
  type XpbdIncrementalPotentialDiagnosisN,
  type XpbdIncrementalPotentialFeasibleBaseResultN,
  type XpbdIncrementalPotentialWorldSelectionN,
  type XpbdIncrementalPotentialWorldStepN,
  type XpbdParticleSourceSimplexBarrierFamilyEvaluationN
} from '@holotope/physics';

/**
 * Drops one anisotropic R4 source point onto a finite static tetrahedron.
 *
 * The point starts admissible at `w = 0.06`, just outside the barrier's
 * `minimumDistance`, and moves fast enough that its inertial prediction lands
 * inside the forbidden region. That is the case
 * `feasible-inertial-prediction` exists for, so one step exercises chord
 * recovery, the paired candidate filter, and the application boundary
 * together.
 */
export function optimizationWorldStepContractExample(): string {
  const dynamic = new CellComplex(
    4,
    new Float64Array([0.25, 0.25, 0.25, 0.06]),
    []
  );
  const binding = compileXpbdParticleBindingN({ id: 'dynamic', source: dynamic });
  for (const particle of binding.particles) particle.velocity.data[3] = -6;

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
  const contact = compileXpbdParticleSourceSimplexBarrierFamilyN({
    id: 'finite-obstacle',
    binding,
    obstacle,
    simplexGroup,
    minimumDistance: 0.05,
    activationDistance: 0.8,
    stiffness: 1.7
  });

  // The world is the single source of truth for dimension, particle order,
  // gravity, and providers. Registering the family here is what puts its
  // conservative provider into the step.
  const world = new XpbdWorldN({ dimension: 4, gravity: [0, 0, 0, -9.81] });
  binding.addToWorld(world);
  contact.addToWorld(world);

  // Only the interval, the ordered filters, and the policies. The world
  // supplies the rest, which is the whole point of this entry point.
  const stepOptions: StepXpbdIncrementalPotentialWorldNOptions = {
    world,
    deltaTime: 1 / 120,
    stepFilters: [contact.stepFilter],
    warmStart: 'feasible-inertial-prediction',
    minimization: { directionPolicy: 'steepest-descent' }
  };
  const advance: XpbdIncrementalPotentialWorldStepN =
    stepXpbdIncrementalPotentialWorldN(stepOptions);

  const selection: XpbdIncrementalPotentialWorldSelectionN = advance.selection;
  const diagnosis: XpbdIncrementalPotentialDiagnosisN = advance.diagnosis;
  const step = advance.step;

  // Chord recovery retains every sampled fraction, not only the accepted one.
  const recovery: XpbdIncrementalPotentialFeasibleBaseResultN | undefined =
    step.feasibleBaseRecovery;

  // Candidate identity survives the wrapper: the family is still queryable for
  // its own source-indexed evidence after the step it participated in.
  const contactEvidence: XpbdParticleSourceSimplexBarrierFamilyEvaluationN =
    contact.evaluate();

  return JSON.stringify({
    // What the world contributed, in authored order.
    dimension: selection.dimension,
    particleIds: selection.particleIds,
    providerIds: selection.providerIds,
    stepFilterIds: selection.stepFilterIds,
    // Feasible-base initialization.
    recoveryStatus: recovery?.status ?? null,
    // `anchor-refused` carries no fraction — there was no feasible base to
    // report one for — so the union is narrowed rather than optional-chained.
    recoveryFraction:
      recovery === undefined || recovery.status === 'anchor-refused'
        ? null
        : recovery.fraction,
    recoveryTrials: recovery?.trials.length ?? 0,
    // Candidate and filter records, kept as records rather than flattened.
    possiblePairs: contactEvidence.candidateQuery.diagnostics.possiblePairs,
    activeCandidateIds: contactEvidence.activeCandidates.map(
      ({ candidate }) => candidate.id
    ),
    compiledFilterIds: step.problem.stepFilters.map((filter) => filter.id),
    // Minimization and application.
    minimizationStatus: step.minimization.status,
    acceptedIterations: step.progress.acceptedIterations,
    objectiveDecrease: step.progress.objectiveDecrease,
    status: step.status,
    refusalStage: step.status === 'refused' ? step.stage : null,
    // Why, without parsing a message.
    condition: diagnosis.condition,
    levers: diagnosis.levers,
    // Where the point ended up.
    positions: world.particles.map((particle) => particle.position.toArray())
  });
}
