/**
 * Headless composition example for source-retained cosine-fold bending.
 *
 * This stays unrouted. The claim worth showing is that a creased R4 membrane
 * carries a real bending energy, that its gradient has the null modes a rigid
 * invariant must have, and that the provider travels with its filter — none of
 * which an animation would demonstrate.
 *
 * **A discrete cosine-fold stiffness, not a shell model.** The energy is
 * quadratic in the cosine coordinate, which makes it quartic in the fold
 * angle, so it does not converge to a continuum bending energy under
 * refinement and the stiffness below is tied to this mesh.
 */
import { CellComplex } from '@holotope/core';
import {
  XpbdWorldN,
  compileXpbdParticleBindingN,
  compileXpbdSourceSimplexCosineBendingFamilyN,
  evaluateSimplexHingeCosineN,
  stepXpbdIncrementalPotentialWorldN,
  type CompileXpbdSourceSimplexCosineBendingFamilyNOptions,
  type SimplexHingeCosineNOptions,
  type SimplexHingeCosineRefusalN,
  type SimplexHingeCosineResultN,
  type XpbdSourceSimplexBendingCellAnalysisN,
  type XpbdSourceSimplexBendingHingeEvaluationN,
  type XpbdSourceSimplexBendingHingeN,
  type XpbdSourceSimplexCosineBendingFilterRefusalReasonN,
  type XpbdSourceSimplexCosineBendingFamilyEvaluationN,
  type XpbdSourceSimplexCosineBendingFamilyStepFilterEvaluationN,
  type XpbdSourceSimplexCosineBendingFamilyTermsN
} from '@holotope/physics';

/** A triangulated R4 sheet, creased along its middle row. */
function creasedSheet(rows: number, columns: number, crease: number): {
  complex: CellComplex;
  group: { key: string; dim: number; verticesPerCell: number; kind: 'simplex'; indices: Uint32Array };
} {
  const positions: number[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      positions.push(column, row, row === 1 ? crease : 0, 0);
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < rows - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const at = row * columns + column;
      indices.push(at, at + 1, at + columns);
      indices.push(at + 1, at + columns + 1, at + columns);
    }
  }
  const group = {
    key: 'membrane',
    dim: 2,
    verticesPerCell: 3,
    kind: 'simplex' as const,
    indices: Uint32Array.from(indices)
  };
  return {
    complex: new CellComplex(4, Float64Array.from(positions), [group]),
    group
  };
}

/**
 * Compiles a flat-rest membrane, reports its bending evidence, and steps it.
 *
 * The rest coordinate is pinned to `1` rather than captured from the source,
 * so the crease is a deformation the family resists rather than the shape it
 * considers relaxed.
 */
export function sourceSimplexBendingContractExample(): string {
  const { complex, group } = creasedSheet(3, 3, 0.45);
  const binding = compileXpbdParticleBindingN({
    id: 'membrane-points', source: complex
  });

  const options: CompileXpbdSourceSimplexCosineBendingFamilyNOptions = {
    id: 'membrane-bending',
    binding,
    simplexGroup: group,
    stiffness: 25,
    restCoordinate: 1,
    minimumMeasureRatio: 0.05
  };
  const bending = compileXpbdSourceSimplexCosineBendingFamilyN(options);

  const evaluation: XpbdSourceSimplexCosineBendingFamilyEvaluationN =
    bending.evaluate();
  const firstHinge: XpbdSourceSimplexBendingHingeN | undefined = bending.hinges[0];

  // The family's per-hinge geometry is the pure evaluator's, so a caller can
  // reproduce any hinge independently.
  const hingeOptions: SimplexHingeCosineNOptions | null =
    firstHinge === undefined ? null : {
      sharedFace: firstHinge.sharedVertices.map((vertex) =>
        binding.particles[vertex]!.position.clone()),
      oppositeA: binding.particles[firstHinge.oppositeVertexA]!.position.clone(),
      oppositeB: binding.particles[firstHinge.oppositeVertexB]!.position.clone()
    };
  const reproduced: SimplexHingeCosineResultN | null =
    hingeOptions === null ? null : evaluateSimplexHingeCosineN(hingeOptions);

  // The refusal branch carries its own evidence. Collapsing an apex onto the
  // shared face is the degeneracy the coordinate cannot survive.
  const collapsed = hingeOptions === null ? null : evaluateSimplexHingeCosineN({
    ...hingeOptions,
    oppositeB: hingeOptions.sharedFace[0]!.clone()
  });
  const refusal: SimplexHingeCosineRefusalN | null =
    collapsed !== null && collapsed.status === 'refused' ? collapsed : null;

  // Per-hinge records, not flattened counts.
  const firstRecord: XpbdSourceSimplexBendingHingeEvaluationN | undefined =
    evaluation.hinges[0];

  // The provider and its filter travel together. Passing the provider to a
  // solve without the filter would leave the segment uncertified.
  const terms: XpbdSourceSimplexCosineBendingFamilyTermsN =
    bending.incrementalPotentialTerms();

  const stationary: XpbdSourceSimplexCosineBendingFamilyStepFilterEvaluationN =
    bending.stepFilter.evaluateSegment({
      dimension: 4,
      requestedStepLength: 1,
      positionBefore: (particle) => particle.position.clone(),
      positionAfter: (particle) => particle.position.clone()
    });

  const world = new XpbdWorldN({ dimension: 4 });
  binding.addToWorld(world);
  bending.addToWorld(world);
  const before = binding.particles.map((particle) => particle.position.toArray());
  const advance = stepXpbdIncrementalPotentialWorldN({
    world,
    deltaTime: 1 / 120,
    stepFilters: [bending.stepFilter],
    warmStart: 'feasible-inertial-prediction',
    minimization: { directionPolicy: 'steepest-descent' }
  });
  let displacement = 0;
  binding.particles.forEach((particle, index) => {
    particle.position.toArray().forEach((value, axis) => {
      displacement = Math.max(displacement, Math.abs(value - before[index]![axis]!));
    });
  });

  return JSON.stringify({
    // Topology, from the source rather than from a count the caller supplied.
    hingeCount: evaluation.hingeCount,
    boundaryFaceCount: evaluation.boundaryFaceCount,
    firstHingeId: firstHinge?.id ?? null,
    firstHingeSharedVertices: firstHinge === undefined
      ? null
      : [...firstHinge.sharedVertices],
    // The energy is real, and the weighting is stated rather than implied.
    potentialEnergy: evaluation.potentialEnergy,
    maximumCoordinateError: evaluation.maximumCoordinateError,
    weighting: evaluation.weighting,
    weight: evaluation.weight,
    // A rigid invariant's gradient must have these null modes.
    netForceResidual: evaluation.netForceResidual,
    rotationalFirstMomentResidual: evaluation.rotationalFirstMomentResidual,
    // The family and the pure evaluator agree exactly.
    perHingeAgrees: reproduced !== null && reproduced.status === 'evaluated' &&
      reproduced.coordinate === firstRecord?.geometry.coordinate,
    // The conormals the coordinate is built from, and how well-posed it is.
    firstConormalA: reproduced !== null && reproduced.status === 'evaluated'
      ? reproduced.conormalA.toArray() : null,
    firstConormalB: reproduced !== null && reproduced.status === 'evaluated'
      ? reproduced.conormalB.toArray() : null,
    minimumConditioning: evaluation.minimumConditioning,
    minimumConormalHeight: evaluation.minimumConormalHeight,
    firstHingeEnergy: firstRecord?.energy ?? null,
    // A collapsed apex refuses with its measured height, not a NaN.
    refusalReason: refusal?.reason ?? null,
    refusalHeightB: refusal?.heightB ?? null,
    // Provider and filter arrive together.
    termProviderIds: terms.providers.map((provider) => provider.id),
    termFilterIds: terms.stepFilters.map((filter) => filter.id),
    stationarySegmentStatus: stationary.status,
    cellsInspected: stationary.cells.length,
    // null on a certified segment; the limiting source cell otherwise.
    blockingCellIndex: stationary.blockingCellIndex,
    firstCellAnalysis: ((): { cellIndex: number; status: string } | null => {
      const cell: XpbdSourceSimplexBendingCellAnalysisN | undefined =
        stationary.cells[0];
      return cell === undefined
        ? null
        : { cellIndex: cell.cellIndex, status: cell.analysis.status };
    })(),
    filterRefusalReason: ((): XpbdSourceSimplexCosineBendingFilterRefusalReasonN
      | null => (stationary.status === 'indeterminate'
      ? stationary.reason
      : null))(),
    // And the membrane actually advances.
    worldStepStatus: advance.step.status,
    worldStepCondition: advance.diagnosis.condition,
    maximumDisplacement: displacement
  });
}
