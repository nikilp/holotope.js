/**
 * The headless conformance checks, run inside the isolated consumer.
 *
 * Each one composes published packages the way an outside caller would, and
 * throws on the first violated claim. The verifier runs this file with `node`
 * after a strict typecheck; a thrown error is the failure signal.
 */
import { LineBasicMaterial, PerspectiveCamera, Raycaster, Vector2, Vector3, type Intersection } from 'three';
import {
  BivectorN,
  CellComplex,
  HyperplaneSliceN,
  PerspectiveProjection,
  Rotor4,
  TransformN,
  VecN,
  cellComplexBoundsAlongAxisN,
  createSourceCellReferenceN,
  createSourceSimplexReferenceN,
  createHypercube,
  createHyperrectangle,
  cuboidCellFacetN,
  describeRepresentationHitN,
  rotorIdentityResidual,
  sectionSimplexGroupN,
  tetrahedralizeCuboidCells,
  type CellGroup,
  type SectionSimplexGroupNResultN,
  type SourceAffineLineageN
} from '@holotope/core';
import {
  ProjectedEdges3D,
  SectionChart3D,
  representationHitFromProjectedSurface,
  representationHitFromSectionChart,
  representationHitFromSlicedComplex,
  type SectionChart3DOptions
} from '@holotope/three';
import {
  ConvexHullSupportShapeN,
  PhysicsWorld4,
  RigidBody4,
  XpbdParticleN,
  XpbdParticleSourceSimplexBarrierN,
  XpbdParticleSourceSimplexBarrierStepFilterN,
  XpbdPotentialDomainErrorN,
  XpbdSourceSimplexAabbHierarchyN,
  XpbdWorldN,
  compileXpbdIncrementalPotentialProblemN,
  compileXpbdParticleBindingN,
  compileXpbdParticleSourceSimplexBarrierFamilyN,
  compileXpbdSourceSimplexAabbHierarchyN,
  compileXpbdSourceSimplexCosineBendingFamilyN,
  evaluateSimplexHingeCosineN,
  recoverXpbdIncrementalPotentialFeasibleBaseN,
  stepXpbdIncrementalPotentialWorldN,
  type XpbdConservativeForceProviderN,
  type XpbdIncrementalPotentialDiagnosisN,
  type XpbdIncrementalPotentialWorldSelectionN,
  type XpbdIncrementalPotentialWorldStepN,
  type XpbdSourceSimplexAabbQueryDiagnosticsN,
  type XpbdSourceSimplexBendingHingeN,
  type XpbdSourceSimplexCosineBendingFamilyEvaluationN,
  type XpbdSourceSimplexCosineBendingFamilyTermsN,
  type XpbdSourceSimplexAabbQueryN,
  type XpbdVelocityResponseN,
  type XpbdParticleSourceSimplexBarrierDomainReasonN,
  type XpbdParticleSourceSimplexBarrierEvaluationN,
  type XpbdParticleSourceSimplexBarrierNOptions,
  type XpbdParticleSourceSimplexBarrierStepFilterEvaluationN,
  type XpbdParticleSourceSimplexBarrierStepFilterEvidenceN,
  type XpbdParticleSourceSimplexBarrierStepFilterNOptions,
  type XpbdParticleSourceSimplexBarrierStepFilterRefusalReasonN,
  type XpbdParticleSourceSimplexBarrierFamilyEvaluationN,
  type XpbdParticleSourceSimplexBarrierFamilyStepFilterEvaluationN,
  compileXpbdParticleSourceConvexHullBarrierFamilyN,
  gjkDistance,
  massPropertiesFromCellComplex4,
  type CompileXpbdParticleSourceConvexHullBarrierFamilyNOptions,
  type GjkResult,
  type XpbdParticleSourceConvexHullActiveBarrierN,
  type XpbdParticleSourceConvexHullBarrierDomainReasonN,
  type XpbdParticleSourceConvexHullBarrierFamilyStepFilterEvaluationN,
  type XpbdParticleSourceConvexHullBarrierFamilyStepFilterRefusalReasonN,
  type XpbdParticleSourceConvexHullBarrierFamilyTermsN,
  type XpbdParticleSourceConvexHullQueryDiagnosticsN,
  type XpbdParticleSourceConvexHullSegmentCertificationN,
  type XpbdSourceConvexHullWitnessN
} from '@holotope/physics';
import {
  compileExperimentDocumentV0,
  coreExperimentCompilerV0,
  prepareExperimentDocumentV0,
  type ExperimentDocumentV0,
  type ExperimentProbeSourceCellStatusV0
} from '@holotope/experiment';
import {
  physicsExperimentCompilerV0,
  type ExperimentRigidModel4RuntimeV0
} from '@holotope/experiment-physics';
import { buildScenario, buildSection, buildSurface, cellCountOf, requireGroup } from './scenario.js';

/** An assertion function, so a checked `result.ok` narrows the union after it. */
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`packed consumer: ${message}`);
}

/** The eight oriented facets of a hypercube, in emission order. */
const EXPECTED_FACETS = '3:- 3:+ 2:- 2:+ 1:- 1:+ 0:- 0:+';

function facetNames(complex: CellComplex): string {
  const cuboids = requireGroup(
    complex.cellsOfDim(3).find((group) => group.kind === 'cuboid'),
    'cuboid 3-cells'
  );
  const names: string[] = [];
  for (let cell = 0; cell < cellCountOf(cuboids); cell += 1) {
    const facet = cuboidCellFacetN(complex, cuboids, cell);
    if (facet === null) throw new Error(`packed consumer: cell ${cell} lies on no facet`);
    names.push(`${facet.axis}:${facet.sign > 0 ? '+' : '-'}`);
  }
  return names.join(' ');
}

/**
 * 0. Certified convex distance through the packed artifact.
 *
 * The pinned near-tie family: a flat box probed from a point whose two middle
 * coordinates differ by a quarter-million-th. Before the certified-termination
 * repair this configuration cycled to the iteration limit with the distance
 * already numerically right; the packed artifact must decide it with the
 * support-gap certificate, at the analytic distance, under the default budget.
 */
export function certifiedConvexQuery(): void {
  const corners: number[] = [];
  for (let corner = 0; corner < 8; corner += 1) {
    corners.push(
      (corner >> 0) & 1 ? 1 : 0,
      (corner >> 1) & 1 ? 1 : 0,
      (corner >> 2) & 1 ? 1 : 0,
      0
    );
  }
  const hull = new ConvexHullSupportShapeN(4, Float64Array.from(corners));
  const base = 0.618483421044642045;
  const probe = new ConvexHullSupportShapeN(4, Float64Array.from([
    0.468806433725538929, base, base + 2.5e-7, 1.52075262807995881
  ]));
  const result: GjkResult = gjkDistance(probe, hull);
  assert(result.status === 'separated', `near-tie query did not decide: ${result.status}`);
  assert(
    Math.abs(result.distance - 1.52075262807995881) < 1e-11,
    `near-tie distance off: ${result.distance}`
  );
  assert(
    result.termination.supportGap <= result.termination.threshold,
    'separation reported without a support-gap certificate'
  );
  // An insufficient budget is an explicit refusal, never a fabricated answer.
  const refused = gjkDistance(probe, hull, { maxIterations: 2 });
  assert(refused.status === 'iteration-limit', 'forced budget did not refuse');
  assert(refused.intersects === null, 'a refusal claimed an intersection answer');
}

/**
 * 0b. Source-retained convex-hull contact through the packed artifact.
 *
 * One dynamic probe against the convex hull of a flat two-cell support:
 * construction from packed types, a decided closest-point query with its
 * source witness, a forced indeterminate refusal under a starved query
 * budget, the paired filter's certified prefix, and rollback on refusal.
 */
export function convexHullContact(): void {
  const obstacle = new CellComplex(3, Float64Array.from([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0
  ]), [{
    key: 'support', dim: 2, verticesPerCell: 3, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 2, 1, 3, 2])
  }]);
  const body = new CellComplex(3, Float64Array.from([0.4, 0.6, 0.5]), [{
    key: 'probe', dim: 0, verticesPerCell: 1, kind: 'simplex',
    indices: Uint32Array.from([0])
  }]);
  const binding = compileXpbdParticleBindingN({
    source: body, id: 'packed-hull-probe', mass: 1
  });
  const compileOptions: CompileXpbdParticleSourceConvexHullBarrierFamilyNOptions = {
    id: 'packed-hull',
    binding,
    obstacle,
    sourceGroup: requireGroup(obstacle.groups[0], 'hull source group'),
    minimumDistance: 0.05,
    activationDistance: 0.8,
    stiffness: 2
  };
  const family = compileXpbdParticleSourceConvexHullBarrierFamilyN(compileOptions);

  // The provider/filter pair travels together into a solve.
  const terms: XpbdParticleSourceConvexHullBarrierFamilyTermsN =
    family.incrementalPotentialTerms();
  assert(terms.providers.length === 1 && terms.stepFilters.length === 1,
    'terms must carry the provider with its paired filter');

  // A decided query with a source-retained witness.
  const evaluation = family.evaluate();
  const diagnostics: XpbdParticleSourceConvexHullQueryDiagnosticsN =
    evaluation.diagnostics;
  assert(diagnostics.setQueries === 1, 'expected one set query per particle');
  assert(diagnostics.hullVertexCount === 4, 'expected four hull vertices');
  assert(evaluation.activeBarriers.length === 1, 'expected one active barrier');
  const record: XpbdParticleSourceConvexHullActiveBarrierN =
    evaluation.activeBarriers[0]!;
  assert(Math.abs(record.distance - 0.5) < 1e-11, `hull distance off: ${record.distance}`);
  const witness: XpbdSourceConvexHullWitnessN = record.witness;
  assert(witness.sourceVertices.length > 0, 'witness names no source vertices');
  assert(witness.query.status === 'separated', 'query did not decide');
  const force = evaluation.forces[0]!;
  assert(force.data[2]! > 0, 'barrier does not push along the support normal');
  assert(
    Math.hypot(force.data[0]!, force.data[1]!) <= 1e-12 * Math.abs(force.data[2]!),
    'a flat-interior push acquired a lateral component'
  );

  // The paired filter certifies a strict prefix of a crossing segment.
  const filter: XpbdParticleSourceConvexHullBarrierFamilyStepFilterEvaluationN =
    family.stepFilter.evaluate({
      dimension: 3,
      requestedStepLength: 1,
      positionBefore: () => new VecN(Float64Array.from([0.4, 0.6, 0.5])),
      positionAfter: () => new VecN(Float64Array.from([0.4, 0.6, -0.5]))
    });
  assert(filter.status === 'limited', `expected a limited prefix, got ${filter.status}`);
  assert(
    filter.status === 'limited' && filter.maximumStepLength > 0 &&
    filter.maximumStepLength < 1,
    'certified prefix must be a strict positive fraction'
  );
  const certification: XpbdParticleSourceConvexHullSegmentCertificationN | undefined =
    filter.certifications[0];
  assert(certification !== undefined &&
    certification.certification === 'global-lipschitz',
    'the crossing segment must be certified by the Lipschitz proof');

  // The filter's own refusal vocabulary is a closed union, composed here so
  // the packed types keep their meaning outside the workspace.
  const initialRefusal: XpbdParticleSourceConvexHullBarrierFamilyStepFilterRefusalReasonN =
    'initial-domain-violation';
  assert(initialRefusal !== ('' as never), 'refusal vocabulary present');

  // A starved query budget is a typed refusal that mutates nothing.
  const starved = compileXpbdParticleSourceConvexHullBarrierFamilyN({
    id: 'packed-hull-starved',
    binding,
    obstacle,
    sourceGroup: requireGroup(obstacle.groups[0], 'hull source group'),
    minimumDistance: 0.05,
    activationDistance: 0.8,
    stiffness: 2,
    maximumQueryIterations: 1
  });
  const before = Array.from(binding.particles[0]!.position.data);
  let refused = false;
  try {
    starved.evaluate();
  } catch (error) {
    const reason: XpbdParticleSourceConvexHullBarrierDomainReasonN =
      'closest-point-indeterminate';
    refused = error instanceof XpbdPotentialDomainErrorN &&
      error.reason === reason;
  }
  assert(refused, 'a starved query budget must refuse as closest-point-indeterminate');
  assert(
    JSON.stringify(Array.from(binding.particles[0]!.position.data)) ===
      JSON.stringify(before),
    'a refusal mutated particle state'
  );
}

/**
 * 1. Package and geometry composition.
 *
 * A sentinel for the installed artifact as much as for the geometry:
 * `cuboidCellFacetN` landed after v0.0.8, so resolving an older published
 * package fails here rather than passing quietly.
 */
/**
 * The dimension-generic affine chart and simplicial section, chained.
 *
 * An outside caller's first question about a section is whether it can trust the
 * ancestry after cutting twice, so this drives the R5 → R4 → R3 chain rather
 * than one cut: every final vertex must still name original R5 vertices, and
 * those weights must rebuild the emitted point.
 */
export function dimensionGenericSection(): void {
  // A 4-simplex in R5 straddling both hyperplanes.
  const positions = Float64Array.from([
    0, 0, 0, -1, -1,
    4, 0, 0, 1, 1,
    0, 4, 0, 1, -1,
    0, 0, 4, -1, 1,
    1, 1, 1, 1, 1
  ]);
  const group: CellGroup = {
    dim: 4, verticesPerCell: 5, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 2, 3, 4])
  };
  const complex = new CellComplex(5, positions, [group]);

  const outer = HyperplaneSliceN.axisAligned(5, 4, 0);
  assert(outer.ambientDim === 5 && outer.chartDim === 4, 'chart dimensions');
  const first: SectionSimplexGroupNResultN = sectionSimplexGroupN({
    complex, group, slice: outer
  });
  assert(first.cellCount > 0, 'the first section emitted no cell');
  assert(first.cellDim === 3, 'a 4-simplex cut by a hyperplane is a 3-cell');
  assert(first.diagnostics.sectionedCells === 1, 'the source cell was not sectioned');

  const intermediateGroup: CellGroup = {
    dim: first.cellDim, verticesPerCell: first.verticesPerCell,
    kind: 'simplex', indices: first.cells
  };
  const inner = HyperplaneSliceN.axisAligned(5, 3, 0);
  const lineage: SourceAffineLineageN = first.lineage;
  const second = sectionSimplexGroupN({
    complex: new CellComplex(5, first.ambientPositions, [intermediateGroup]),
    group: intermediateGroup,
    slice: inner,
    lineage
  });
  assert(second.cellCount > 0, 'the chained section emitted no cell');
  assert(second.cellDim === 2, 'the chained section should be a surface');

  for (let vertex = 0; vertex < second.vertexCount; vertex++) {
    const from = second.lineage.offsets[vertex] ?? 0;
    const to = second.lineage.offsets[vertex + 1] ?? 0;
    assert(to > from, 'a section vertex with no ancestry');
    let sum = 0;
    const rebuilt = [0, 0, 0, 0, 0];
    for (let at = from; at < to; at++) {
      const ancestor = second.lineage.sourceVertices[at] ?? 0;
      const weight = second.lineage.weights[at] ?? 0;
      // Original R5 vertices, never the intermediate complex's.
      assert(ancestor < 5, 'ancestry escaped to the intermediate complex');
      sum += weight;
      for (let c = 0; c < 5; c++) {
        rebuilt[c] = (rebuilt[c] ?? 0) + weight * (positions[ancestor * 5 + c] ?? 0);
      }
    }
    assert(Math.abs(sum - 1) < 1e-11, `weights sum to ${sum}`);
    for (let c = 0; c < 5; c++) {
      const emitted = second.ambientPositions[vertex * 5 + c] ?? 0;
      assert(Math.abs((rebuilt[c] ?? 0) - emitted) < 1e-11, 'weights do not rebuild the point');
    }
    // Both hyperplanes hold, which is what makes this codimension two.
    const point: number[] = [];
    for (let c = 0; c < 5; c++) point.push(second.ambientPositions[vertex * 5 + c] ?? 0);
    assert(Math.abs(outer.signedDistance(point)) < 1e-11, 'off the outer hyperplane');
    assert(Math.abs(inner.signedDistance(point)) < 1e-11, 'off the inner hyperplane');
  }

  // Non-simplicial input is refused, with the remedy named.
  let refused = '';
  try {
    sectionSimplexGroupN({
      complex,
      group: { dim: 4, verticesPerCell: 5, kind: 'cuboid', indices: group.indices },
      slice: outer
    });
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  assert(refused.includes('Simplexize'), 'a cuboid group was not refused');
}

/**
 * The RN section render adapter, from the same tarballs its section came from.
 *
 * Drives the seam an outside caller needs first: construct over a simplicial
 * group, render, move the source, and resolve a pick back to the parent cell
 * with the ambient point qualified as approximate rather than upgraded.
 */
export function sectionChartRender(): void {
  const positions = Float64Array.from([
    0, 0, 0, -1,
    2, 0, 0, 1,
    0, 2, 0, 1,
    0, 0, 2, 1
  ]);
  const complex = new CellComplex(4, positions, [
    { dim: 3, verticesPerCell: 4, kind: 'simplex', indices: Uint32Array.from([0, 1, 2, 3]) }
  ]);
  const group = complex.groups[0];
  assert(group !== undefined, 'expected the tetrahedron group');

  const options: SectionChart3DOptions = {
    material: new LineBasicMaterial()
  };
  // A caller-owned material on a triangle section would be wrong for shading,
  // but ownership is the thing under test: the product must not dispose it.
  const chart = new SectionChart3D(
    complex, group, HyperplaneSliceN.axisAligned(4, 3, 0), options
  );
  assert(chart.cellCount === 1, `expected one section triangle, got ${chart.cellCount}`);
  assert(chart.section.diagnostics.sectionedCells === 1, 'the cell did not section');
  assert(chart.section.diagnostics.collapsedSectionCells === 0, 'nothing should collapse');

  // Streaming: move the authoritative source, update, and the drawn buffer
  // follows while the caller complex is only read.
  for (let vertex = 0; vertex < complex.vertexCount; vertex++) {
    const at = vertex * 4;
    complex.positions[at] = (complex.positions[at] ?? 0) + 3;
  }
  chart.update();
  const attribute = chart.geometry.getAttribute('position');
  assert(attribute.getX(0) >= 2, 'the drawn section did not follow the source');

  const hit = representationHitFromSectionChart(chart, {
    point: new Vector3(3.5, 0.5, 0),
    faceIndex: 0
  });
  assert(hit.representation === 'section-chart', 'wrong representation kind');
  assert(hit.source.kind === 'cell' && hit.source.cellIndex === 0, 'wrong parent cell');
  assert(hit.ambientPointStatus === 'approximate', 'a Float32 pick is approximate');
  assert(hit.ambiguity === 'none', 'a section pick is not ambiguous');

  let refused = '';
  try {
    void new SectionChart3D(
      complex, group, HyperplaneSliceN.axisAligned(4, 3, 0),
      { magic: 1 } as never
    );
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  assert(refused.includes('unknown option'), 'unknown options must refuse by name');

  chart.dispose();
  const material = options.material;
  assert(material !== undefined, 'the option was provided');
  // Disposing after the product proves the product left it alive.
  material.dispose();
}

export function geometryComposition(): void {
  const complex = createHypercube({ dim: 4, size: 3, maxCellDimension: 3 });
  assert(facetNames(complex) === EXPECTED_FACETS, `size-3 facets were ${facetNames(complex)}`);
  const bounds = cellComplexBoundsAlongAxisN(complex, 3);
  assert(bounds.min === -1.5 && bounds.max === 1.5, `w bounds were [${bounds.min}, ${bounds.max}]`);

  const relative = Rotor4.fromPlane(0, 3, 0.7);
  const [major, minor] = Rotor4.principalAnglesBetween(Rotor4.identity(), relative);
  assert(Math.abs(major - 0.7) < 1e-12 && minor < 1e-12, `principal angles were [${major}, ${minor}]`);

  // Translated clear of the origin, every coordinate shares one sign, so a
  // recipe reading `Math.sign` would name the same facet eight times.
  const moved = new CellComplex(
    complex.ambientDim,
    complex.positions.map((value) => value + 10),
    [...complex.groups]
  );
  assert(facetNames(moved) === EXPECTED_FACETS, `translated facets were ${facetNames(moved)}`);
}

interface PositionAttribute {
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
}

/** Casts a deterministic ray at the centroid of the first emitted triangle. */
function rayAtFirstTriangle(geometry: {
  getAttribute(name: string): PositionAttribute;
}): Raycaster {
  const position = geometry.getAttribute('position');
  const x = (position.getX(0) + position.getX(1) + position.getX(2)) / 3;
  const y = (position.getY(0) + position.getY(1) + position.getY(2)) / 3;
  const z = (position.getZ(0) + position.getZ(1) + position.getZ(2)) / 3;
  const camera = new PerspectiveCamera(60, 1, 0.01, 1000);
  camera.position.set(x, y, z + 20);
  camera.lookAt(x, y, z);
  camera.updateMatrixWorld(true);
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2(0, 0), camera);
  return raycaster;
}

/**
 * 2. Section and projection claims, through a real Three.js `Raycaster`.
 *
 * The intersection is produced by Three and handed to the adapter unchanged.
 * Manufacturing an intersection literal would test the adapter's tolerance for
 * a shape this consumer invented rather than the one Three actually returns.
 */
export function representationClaims(): void {
  const scenario = buildScenario(2);

  const edges = new ProjectedEdges3D(
    scenario.complex,
    new PerspectiveProjection({ fromDim: 4, viewDistance: 4 }),
    { color: 0x1e293b }
  );
  assert(
    (edges.object.material as LineBasicMaterial).color.getHex() === 0x1e293b,
    'ProjectedEdges3D ignored its explicit color'
  );
  let rejectedUnknownOption = false;
  try {
    new ProjectedEdges3D(
      scenario.complex,
      new PerspectiveProjection({ fromDim: 4, viewDistance: 4 }),
      { linewidth: 2 } as never
    );
  } catch (error) {
    rejectedUnknownOption = error instanceof Error && /linewidth/.test(error.message);
  }
  assert(rejectedUnknownOption, 'ProjectedEdges3D accepted an unknown linewidth option');

  const section = buildSection(scenario);
  section.object.updateMatrixWorld(true);
  const sectionHits: Intersection[] = rayAtFirstTriangle(section.geometry).intersectObject(
    section.object,
    false
  );
  assert(sectionHits.length > 0, 'the section ray met no triangle');
  const sectionReport = describeRepresentationHitN(
    representationHitFromSlicedComplex(section, sectionHits[0]!)
  );
  assert(
    sectionReport.ambient.claim === 'unique',
    `section claim was ${sectionReport.ambient.claim}`
  );
  assert(
    sectionReport.source.kind === 'cell',
    `section source kind was ${sectionReport.source.kind}`
  );
  const firstTet = section.sourceTetOfFace(0);
  assert(
    section.facesOfSourceTet(firstTet).includes(0),
    'the source-tetrahedron inverse did not return its rendered face'
  );
  const chartPoint: [number, number, number] = [0.1, -0.2, 0.3];
  const roundTrip = section.slice.projectPointToChart(
    section.slice.embedPoint(chartPoint)
  );
  assert(
    Math.abs(roundTrip.signedDistance) < 1e-12 &&
      roundTrip.coordinates.every((value, axis) =>
        Math.abs(value - chartPoint[axis]!) < 1e-12
      ),
    'the slice chart round trip did not preserve its point and residual'
  );

  const surface = buildSurface(scenario);
  surface.object.updateMatrixWorld(true);
  const surfaceHits: Intersection[] = rayAtFirstTriangle(surface.geometry).intersectObject(
    surface.object,
    false
  );
  assert(surfaceHits.length > 0, 'the projection ray met no triangle');
  const surfaceReport = describeRepresentationHitN(
    representationHitFromProjectedSurface(surface, surfaceHits[0]!)
  );
  const projected = surfaceReport.ambient;
  assert(
    projected.claim === 'on-selected-primitive',
    `projection claim was ${projected.claim}`
  );
  assert(
    projected.ambiguity === 'projection-overlap',
    `the projection claim reported ambiguity ${projected.ambiguity}`
  );

  section.dispose();
  surface.dispose();
  edges.dispose();
}

/** Euclidean norm over a bivector's plane coefficients. */
const bivectorNorm = (bivector: BivectorN): number =>
  Math.hypot(...Array.from(bivector.coeffs));

/**
 * 4. Physics package composition.
 *
 * An installation smoke test over an existing golden path: mass properties
 * from the same source, a nonzero angular state, and a deterministic interval.
 */
export function physicsComposition(): void {
  const boundary = tetrahedralizeCuboidCells(
    createHypercube({ dim: 4, size: 1, maxCellDimension: 3 })
  );
  const properties = massPropertiesFromCellComplex4(boundary);
  const body = RigidBody4.fromMassProperties(properties);
  const spin = BivectorN.fromPlanes(4, [
    { i: 0, j: 3, angle: 0.7 },
    { i: 1, j: 2, angle: -0.2 }
  ]);
  body.setAngularVelocityWorld(spin);

  // Torque-free and gravity-free, so the angular state is conserved.
  const world = new PhysicsWorld4({ gravity: [0, 0, 0, 0] });
  world.addBody(body);
  const before = body.rotation.clone();
  for (let step = 0; step < 120; step += 1) world.step(1 / 120);

  assert(
    rotorIdentityResidual(before) !== rotorIdentityResidual(body.rotation),
    'the orientation did not change over 120 steps'
  );
  const pose = new TransformN(4, body.rotation, body.position);
  assert(
    Array.from(pose.position.data).every((value) => Number.isFinite(value)),
    'reported position is not finite'
  );
  // Spin(4): the rotor's matrix stays orthogonal, so its round trip through
  // SO(4) and back is identity to numerical tolerance.
  const matrix = body.rotation.toMatrix().data;
  assert(
    Array.from(matrix).every((value) => Number.isFinite(value)),
    'the orientation matrix is not finite'
  );
  assert(
    Math.abs(bivectorNorm(body.angularVelocityWorld()) - bivectorNorm(spin)) < 1e-6,
    'angular velocity magnitude drifted under a torque-free interval'
  );

  // Compose the open-domain initialization query through packed public
  // artifacts. The target is refused, the anchor is feasible, and the first
  // feasible geometric sample is alpha = 0.5.
  const particle = new XpbdParticleN({
    id: 'packed-open-domain',
    position: [0.2],
    inverseMass: 1
  });
  const provider: XpbdConservativeForceProviderN = {
    id: 'packed-positive-gap',
    dimension: 1,
    particles: [particle],
    evaluate: () => ({ potentialEnergy: 0, forces: [new VecN([0])] }),
    evaluateAt: (positionOf) => {
      if (!(positionOf(particle).data[0]! > 0.1)) {
        throw new XpbdPotentialDomainErrorN(
          'packed-positive-gap',
          'outside-open-domain',
          'the packed coordinate must exceed 0.1'
        );
      }
      return { potentialEnergy: 0, forces: [new VecN([0])] };
    }
  };
  const problem = compileXpbdIncrementalPotentialProblemN({
    dimension: 1,
    particles: [particle],
    predictedPositions: [new VecN([0.05])],
    deltaTime: 0.1,
    providers: [provider]
  });
  const recovery = recoverXpbdIncrementalPotentialFeasibleBaseN({
    problem,
    anchorCoordinates: [0.2],
    targetCoordinates: [0.05]
  });
  assert(
    recovery.status === 'recovered' && recovery.fraction === 0.5,
    `feasible-base recovery returned ${recovery.status}`
  );

  // The finite R4 source feature remains authoritative through the physics
  // package: the closest point reports barycentric source coordinates, while
  // its paired filter certifies a prefix rather than inventing an impact time.
  const simplexGroup = {
    dim: 3,
    verticesPerCell: 4,
    kind: 'simplex' as const,
    indices: new Uint32Array([0, 1, 2, 3])
  };
  const simplexSource = new CellComplex(4, new Float64Array([
    0, 0, 0, 0,
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0
  ]), [simplexGroup]);
  const simplexReference = createSourceSimplexReferenceN(
    createSourceCellReferenceN(simplexSource, simplexGroup, 0)
  );
  const simplexParticle = new XpbdParticleN({
    id: 'packed-simplex-point', position: [0.2, 0.2, 0.2, 0.5]
  });
  const simplexBarrierOptions: XpbdParticleSourceSimplexBarrierNOptions = {
    id: 'packed-simplex-barrier',
    particle: simplexParticle,
    simplex: simplexReference,
    minimumDistance: 0.05,
    activationDistance: 0.8,
    stiffness: 1
  };
  const simplexBarrier = new XpbdParticleSourceSimplexBarrierN(
    simplexBarrierOptions
  );
  const simplexEvaluation: XpbdParticleSourceSimplexBarrierEvaluationN =
    simplexBarrier.evaluate();
  assert(
    Math.abs(simplexEvaluation.barrierCoordinate - 0.45) < 1e-12 &&
      Math.abs(simplexEvaluation.barrierActivation - 0.75) < 1e-12 &&
      Math.abs(simplexEvaluation.separationNormal.data[3]! - 1) < 1e-12,
    'the finite source-simplex barrier lost its distance differential'
  );
  assert(
    simplexEvaluation.projection.coordinate.reference === simplexReference,
    'the finite source-simplex barrier lost source identity'
  );

  const simplexFilterOptions:
    XpbdParticleSourceSimplexBarrierStepFilterNOptions = {
      id: 'packed-simplex-filter', barrier: simplexBarrier
    };
  const simplexFilter = new XpbdParticleSourceSimplexBarrierStepFilterN(
    simplexFilterOptions
  );
  const simplexFilterEvaluation:
    XpbdParticleSourceSimplexBarrierStepFilterEvaluationN =
      simplexFilter.evaluate({
        dimension: 4,
        requestedStepLength: 1,
        positionBefore: () => new VecN([0.2, 0.2, 0.2, 0.5]),
        positionAfter: () => new VecN([0.2, 0.2, 0.2, -0.5])
      });
  const simplexFilterEvidence:
    XpbdParticleSourceSimplexBarrierStepFilterEvidenceN =
      simplexFilterEvaluation;
  assert(
    simplexFilterEvaluation.status === 'limited' &&
      simplexFilterEvidence.certification === 'global-lipschitz' &&
      simplexFilterEvidence.certifiedFraction > 0 &&
      simplexFilterEvidence.certifiedFraction < 0.5,
    'the finite source-simplex segment was not conservatively limited'
  );
  const domainReason: XpbdParticleSourceSimplexBarrierDomainReasonN =
    'at-or-below-minimum-distance';
  const filterReason:
    XpbdParticleSourceSimplexBarrierStepFilterRefusalReasonN =
      'initial-domain-violation';
  assert(
    String(domainReason) !== String(filterReason),
    'potential and step-filter refusal vocabularies collapsed together'
  );

  // The packed graph must also compose the source-indexed candidate layer.
  // A far dynamic source point is culled while the near point retains the
  // same obstacle reference and the crossing segment names its blocker.
  const candidateSource = new CellComplex(4, new Float64Array([
    0.2, 0.2, 0.2, 0.5,
    5, 5, 5, 5
  ]), []);
  const candidateBinding = compileXpbdParticleBindingN({
    id: 'packed-candidates', source: candidateSource
  });
  const candidateFamily = compileXpbdParticleSourceSimplexBarrierFamilyN({
    id: 'packed-finite-obstacle',
    binding: candidateBinding,
    obstacle: simplexSource,
    simplexGroup,
    minimumDistance: 0.05,
    activationDistance: 0.8,
    stiffness: 1
  });
  const candidateEvaluation:
    XpbdParticleSourceSimplexBarrierFamilyEvaluationN =
      candidateFamily.evaluate();
  assert(
    candidateEvaluation.candidateQuery.diagnostics.possiblePairs === 2 &&
      candidateEvaluation.candidateQuery.diagnostics.candidatePairs === 1 &&
      candidateEvaluation.activeCandidates.length === 1,
    'the packed finite-obstacle family lost candidate reduction'
  );
  assert(
    candidateEvaluation.activeCandidates[0]!.candidate.simplex ===
      candidateFamily.simplices[0],
    'the packed finite-obstacle family lost source identity'
  );
  const candidateStep:
    XpbdParticleSourceSimplexBarrierFamilyStepFilterEvaluationN =
      candidateFamily.stepFilter.evaluate({
        dimension: 4,
        requestedStepLength: 1,
        positionBefore: (candidate) => candidate.position.clone(),
        positionAfter: (candidate) => candidate === candidateBinding.particles[0]
          ? new VecN([0.2, 0.2, 0.2, -0.5])
          : candidate.position.clone()
      });
  assert(
    candidateStep.status === 'limited' &&
      candidateStep.blockingCandidateId ===
        'packed-finite-obstacle/source-vertex/0/obstacle-cell/0',
    'the packed finite-obstacle family lost its segment blocker'
  );

  // The world-scoped nonlinear advance must be reachable from the packed
  // graph by package name alone, with the world supplying dimension, particle
  // order, gravity, and providers. Registered projected-XPBD features are not
  // representable by this path and must be named rather than skipped.
  const worldSource = new CellComplex(
    4, new Float64Array([0.25, 0.25, 0.25, 0.06]), []
  );
  const worldBinding = compileXpbdParticleBindingN({
    id: 'packed-world-dynamic', source: worldSource
  });
  for (const bound of worldBinding.particles) bound.velocity.data[3] = -6;
  const worldFamily = compileXpbdParticleSourceSimplexBarrierFamilyN({
    id: 'packed-world-contact',
    binding: worldBinding,
    obstacle: simplexSource,
    simplexGroup,
    minimumDistance: 0.05,
    activationDistance: 0.8,
    stiffness: 1.7
  });
  const optimizationWorld = new XpbdWorldN({
    dimension: 4, gravity: [0, 0, 0, -9.81]
  });
  worldBinding.addToWorld(optimizationWorld);
  worldFamily.addToWorld(optimizationWorld);

  const advance: XpbdIncrementalPotentialWorldStepN =
    stepXpbdIncrementalPotentialWorldN({
      world: optimizationWorld,
      deltaTime: 1 / 120,
      stepFilters: [worldFamily.stepFilter],
      warmStart: 'feasible-inertial-prediction',
      minimization: { directionPolicy: 'steepest-descent' }
    });
  const selection: XpbdIncrementalPotentialWorldSelectionN = advance.selection;
  assert(
    selection.dimension === 4 &&
      selection.particleIds.length === 1 &&
      selection.providerIds.join() === 'packed-world-contact' &&
      selection.stepFilterIds.join() === worldFamily.stepFilter.id,
    'the packed world-scoped step lost its registration evidence'
  );
  const worldDiagnosis: XpbdIncrementalPotentialDiagnosisN = advance.diagnosis;
  assert(
    advance.step.status === 'applied' && worldDiagnosis.condition === 'progressed',
    `the packed world-scoped step reported ${advance.step.status}`
  );
  const worldRecovery = advance.step.feasibleBaseRecovery;
  assert(
    worldRecovery !== undefined &&
      worldRecovery.status === 'recovered' &&
      worldRecovery.fraction === 0.125,
    'the packed world-scoped step lost its feasible-base evidence'
  );

  // The same world with a projected velocity response registered is refused
  // by name, and nothing is advanced.
  const beforeRefusal = optimizationWorld.particles[0]!.position.toArray();
  const response: XpbdVelocityResponseN = {
    id: 'packed-damping',
    dimension: 4,
    particles: optimizationWorld.particles,
    apply: () => ({})
  };
  optimizationWorld.addVelocityResponse(response);
  let refusal = '';
  try {
    stepXpbdIncrementalPotentialWorldN({
      world: optimizationWorld,
      deltaTime: 1 / 120,
      stepFilters: [worldFamily.stepFilter]
    });
  } catch (error) {
    refusal = error instanceof Error ? error.message : String(error);
  }
  assert(
    refusal.includes('velocity response ("packed-damping")'),
    `an unsupported registry was not named: ${refusal || '(no error thrown)'}`
  );
  assert(
    optimizationWorld.particles[0]!.position.toArray().join() ===
      beforeRefusal.join(),
    'a refused world-scoped configuration still advanced the scene'
  );

  // The static candidate hierarchy must compile and run from the packed graph,
  // must agree with the exhaustive oracle on identity and order, and must
  // refuse a moved obstacle rather than answering from stale bounds.
  const hierarchy: XpbdSourceSimplexAabbHierarchyN =
    compileXpbdSourceSimplexAabbHierarchyN({
      obstacle: simplexSource, simplexGroup, leafSize: 1
    });
  const hierarchyQuery: XpbdSourceSimplexAabbQueryN = hierarchy.query({
    min: [-0.5, -0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5, 0.5]
  });
  const hierarchyDiagnostics: XpbdSourceSimplexAabbQueryDiagnosticsN =
    hierarchyQuery.diagnostics;
  assert(
    hierarchyQuery.cellIndices.join() === '0' &&
      hierarchyDiagnostics.totalSimplices === 1 &&
      hierarchyQuery.simplices[0] === hierarchy.simplices[0],
    'the packed hierarchy lost source identity or cell order'
  );

  const acceleratedBinding = compileXpbdParticleBindingN({
    id: 'packed-accelerated', source: candidateSource
  });
  const acceleratedFamily = compileXpbdParticleSourceSimplexBarrierFamilyN({
    id: 'packed-finite-obstacle',
    binding: acceleratedBinding,
    obstacle: simplexSource,
    simplexGroup,
    minimumDistance: 0.05,
    activationDistance: 0.8,
    stiffness: 1,
    candidateHierarchy: compileXpbdSourceSimplexAabbHierarchyN({
      obstacle: simplexSource, simplexGroup, leafSize: 1
    })
  });
  const exhaustiveIds = candidateFamily
    .queryAt((particle) => particle.position.clone())
    .candidates.map((candidate) => candidate.id);
  const acceleratedQuery = acceleratedFamily
    .queryAt((particle) => particle.position.clone());
  assert(
    exhaustiveIds.length > 0,
    'the packed differential compared two empty candidate sets'
  );
  assert(
    acceleratedQuery.candidates.map((candidate) => candidate.id).join('|') ===
      exhaustiveIds.join('|'),
    'the packed hierarchy changed candidate identity or order'
  );
  assert(
    acceleratedQuery.diagnostics.strategy === 'static-aabb-hierarchy' &&
      candidateEvaluation.candidateQuery.diagnostics.strategy === 'exhaustive',
    'the packed strategy evidence was not inspectable'
  );

  // A moved static obstacle is a loud refusal, not a silent rebuild.
  const originalCoordinate = simplexSource.positions[0]!;
  simplexSource.positions[0] = originalCoordinate + 1;
  let staleRefusal = '';
  try {
    acceleratedFamily.queryAt((particle) => particle.position.clone());
  } catch (error) {
    staleRefusal = error instanceof Error ? error.message : String(error);
  }
  simplexSource.positions[0] = originalCoordinate;
  assert(
    staleRefusal.includes('indexed obstacle moved'),
    `a moved packed obstacle was not refused: ${staleRefusal || '(no error)'}`
  );
  assert(
    acceleratedFamily
      .queryAt((particle) => particle.position.clone())
      .candidates.length === exhaustiveIds.length,
    'restoring the packed obstacle did not restore the candidate set'
  );

  // Source-retained cosine-fold bending must compile and evaluate from the
  // packed graph, with its filter travelling alongside the provider.
  const bendPositions: number[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      bendPositions.push(column, row, row === 1 ? 0.45 : 0, 0);
    }
  }
  const bendIndices: number[] = [];
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      const at = row * 3 + column;
      bendIndices.push(at, at + 1, at + 3, at + 1, at + 4, at + 3);
    }
  }
  const bendGroup = {
    key: 'packed-membrane', dim: 2, verticesPerCell: 3, kind: 'simplex' as const,
    indices: new Uint32Array(bendIndices)
  };
  const membrane = new CellComplex(
    4, new Float64Array(bendPositions), [bendGroup]
  );
  const membraneBinding = compileXpbdParticleBindingN({
    id: 'packed-membrane-points', source: membrane
  });
  const bending = compileXpbdSourceSimplexCosineBendingFamilyN({
    id: 'packed-membrane-bending',
    binding: membraneBinding,
    simplexGroup: bendGroup,
    stiffness: 25,
    restCoordinate: 1,
    minimumMeasureRatio: 0.05
  });
  const bendingEvaluation: XpbdSourceSimplexCosineBendingFamilyEvaluationN =
    bending.evaluate();
  const firstBendHinge: XpbdSourceSimplexBendingHingeN | undefined =
    bending.hinges[0];
  assert(
    bendingEvaluation.hingeCount === 8 &&
      bendingEvaluation.boundaryFaceCount === 8 &&
      firstBendHinge !== undefined,
    'the packed bending family lost its interior/boundary accounting'
  );
  assert(
    bendingEvaluation.potentialEnergy > 0,
    'the packed creased membrane reported no bending energy'
  );
  assert(
    bendingEvaluation.netForceResidual < 1e-12 &&
      bendingEvaluation.rotationalFirstMomentResidual < 1e-12,
    'the packed bending gradient lost its rigid null modes'
  );
  assert(
    bendingEvaluation.weighting === 'unit-discrete' &&
      bendingEvaluation.weight === 1,
    'the packed bending family hid its weighting policy'
  );

  // The pure evaluator reproduces any hinge exactly.
  const reproduced = evaluateSimplexHingeCosineN({
    sharedFace: firstBendHinge!.sharedVertices.map(
      (vertex) => membraneBinding.particles[vertex]!.position.clone()
    ),
    oppositeA:
      membraneBinding.particles[firstBendHinge!.oppositeVertexA]!.position.clone(),
    oppositeB:
      membraneBinding.particles[firstBendHinge!.oppositeVertexB]!.position.clone()
  });
  assert(
    reproduced.status === 'evaluated' &&
      reproduced.coordinate === bendingEvaluation.hinges[0]!.geometry.coordinate,
    'the packed pure evaluator disagreed with the family'
  );

  const bendingTerms: XpbdSourceSimplexCosineBendingFamilyTermsN =
    bending.incrementalPotentialTerms();
  assert(
    bendingTerms.providers.length === 1 && bendingTerms.stepFilters.length === 1 &&
      bendingTerms.stepFilters[0] === bending.stepFilter,
    'the packed bending provider arrived without its paired filter'
  );

  const bendingWorld = new XpbdWorldN({ dimension: 4 });
  membraneBinding.addToWorld(bendingWorld);
  bending.addToWorld(bendingWorld);
  const membraneBefore = membraneBinding.particles.map(
    (particle) => particle.position.toArray().join()
  );
  const membraneStep = stepXpbdIncrementalPotentialWorldN({
    world: bendingWorld,
    deltaTime: 1 / 120,
    stepFilters: [bending.stepFilter],
    warmStart: 'feasible-inertial-prediction',
    minimization: { directionPolicy: 'steepest-descent' }
  });
  const membraneAfter = membraneBinding.particles.map(
    (particle) => particle.position.toArray().join()
  );
  assert(
    membraneStep.step.status === 'applied',
    `the packed membrane step reported ${membraneStep.step.status}`
  );
  assert(
    membraneBefore.join('|') !== membraneAfter.join('|'),
    'the packed membrane step advanced nothing'
  );
}

/** Centroid of the first triangle the equivalent section product emits. */
function firstEmittedSectionPoint(): readonly [number, number, number] {
  const section = buildSection(buildScenario(2));
  const position = section.geometry.getAttribute('position') as unknown as PositionAttribute;
  const point: [number, number, number] = [
    (position.getX(0) + position.getX(1) + position.getX(2)) / 3,
    (position.getY(0) + position.getY(1) + position.getY(2)) / 3,
    (position.getZ(0) + position.getZ(1) + position.getZ(2)) / 3
  ];
  section.dispose();
  return point;
}

/**
 * 5. The orthotope source, end to end from packed artifacts.
 *
 * Composes all four non-adapter packages: core constructs it, physics
 * integrates its mass, and the two experiment packages compile a document that
 * advances it. Its analytic mass is closed-form, so the assertion is against
 * arithmetic rather than against another call.
 */
export async function hyperrectangleComposition(): Promise<void> {
  const edges = [2, 3, 5, 7];
  const body = tetrahedralizeCuboidCells(
    createHyperrectangle({ dim: 4, edgeLengths: edges, maxCellDimension: 3 })
  );

  const properties = massPropertiesFromCellComplex4(body);
  const volume = edges.reduce((product, edge) => product * edge, 1);
  assert(
    Math.abs(properties.volume - volume) < 1e-6,
    `volume was ${properties.volume}, expected ${volume}`
  );
  // I_ij = m(a_i^2 + a_j^2)/12, so the six plane inertias are all different.
  const inertia = Array.from(properties.inertiaDiagonal);
  assert(inertia.length === 6, `expected six plane inertias, got ${inertia.length}`);
  assert(
    Math.max(...inertia) - Math.min(...inertia) > 1,
    'the packed body is isotropic, so it is not the orthotope'
  );

  const document = {
    schema: 'holotope.experiment/0',
    title: 'Packed orthotope',
    ambientDim: 4,
    sources: {
      body: {
        kind: 'core.source.hyperrectangle',
        dim: 4,
        edgeLengths: edges,
        tetrahedralize: true
      }
    },
    models: {
      tumble: {
        kind: 'physics.model.rigid4',
        source: 'body',
        initialAngularMomentum: [0.4, 0.15, 0, 0.9, -0.3, 0],
        fixedStep: 1 / 120,
        substeps: 2
      }
    },
    representations: {
      shadow: {
        kind: 'core.representation.perspective',
        source: 'body',
        fromDim: 4,
        viewDistance: 14,
        transform: { fromModel: 'tumble' },
        product: 'both'
      }
    }
  } satisfies ExperimentDocumentV0;
  const prepared = await prepareExperimentDocumentV0(document);
  assert(prepared.ok, `orthotope document did not prepare: ${describeFailures(prepared)}`);

  const compiled = compileExperimentDocumentV0(prepared.value, {
    compilers: [coreExperimentCompilerV0(), physicsExperimentCompilerV0()]
  });
  assert(compiled.ok, `orthotope document did not compile: ${describeFailures(compiled)}`);
  const compilation = compiled.value;

  const model = compilation.get('tumble');
  assert(model.ok && model.value.category === 'model', 'the rigid model did not compile');
  const runtime = model.value.runtime as ExperimentRigidModel4RuntimeV0;
  const before = Array.from(runtime.body.rotation.left);

  const advanced = compilation.advance(240);
  assert(advanced.ok, 'the orthotope model did not advance');
  assert(advanced.value.step === 240, `advanced ${advanced.value.step} steps`);

  const after = Array.from(runtime.body.rotation.left);
  assert(
    after.some((value, index) => value !== before[index]),
    'the orientation did not change over 240 steps'
  );
  assert(after.every((value) => Number.isFinite(value)), 'orientation is not finite');

  compilation.dispose();
}

interface ProbeOutput {
  readonly sourceCellStatus: ExperimentProbeSourceCellStatusV0;
  readonly sourceCell?: unknown;
  readonly sourceCellPrecision?: unknown;
  readonly ambientPoint?: unknown;
}

/**
 * Reads a probe result, checking rather than asserting its shape.
 *
 * `invoke` returns JSON, so a cast would let a probe that reported nothing
 * pass as one that reported a status. Validating here means the absence of
 * `sourceCellStatus` is itself a conformance failure.
 */
function readProbeOutput(output: unknown, label: string): ProbeOutput {
  assert(
    typeof output === 'object' && output !== null,
    `the ${label} probe returned ${typeof output}, not an object`
  );
  const record = output as Record<string, unknown>;
  assert(
    typeof record['sourceCellStatus'] === 'string',
    `the ${label} probe reported no sourceCellStatus`
  );
  return record as unknown as ProbeOutput;
}

/**
 * 3. Headless experiment probe.
 *
 * Prepares and compiles a v0 document with both public compilers, then probes
 * the section and the projection. The probe reports its reasoning as a status
 * whether or not it found a cell, so an absent `sourceCell` is never read as
 * the answer.
 */
export async function experimentProbe(): Promise<void> {
  const probeAction = {
    id: 'probe',
    title: 'Probe',
    description: 'Reports headless evidence for a chart point.',
    inputSchema: {
      type: 'object',
      properties: {
        representation: { type: 'string' },
        point: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }
      },
      required: ['representation', 'point'],
      additionalProperties: false
    },
    outputSchema: { type: 'object' },
    readOnly: true,
    destructive: false,
    idempotent: true,
    deterministic: true,
    supportsPreview: false,
    budget: { maxMillis: 50 },
    operation: { kind: 'probe' }
  } as const;

  const prepared = await prepareExperimentDocumentV0({
    schema: 'holotope.experiment/0',
    title: 'Packed consumer',
    ambientDim: 4,
    sources: {
      tesseract: {
        kind: 'core.source.hypercube',
        dim: 4,
        size: 2,
        tetrahedralize: true
      }
    },
    representations: {
      section: {
        kind: 'core.representation.section4',
        source: 'tesseract',
        normal: [0, 0, 0, 1],
        offset: 0,
        frame: 'canonical'
      },
      shadow: {
        kind: 'core.representation.perspective',
        source: 'tesseract',
        fromDim: 4,
        viewDistance: 4,
        product: 'both'
      }
    },
    actions: [probeAction]
  });
  assert(prepared.ok, `document did not prepare: ${describeFailures(prepared)}`);

  const compiled = compileExperimentDocumentV0(prepared.value, {
    compilers: [coreExperimentCompilerV0(), physicsExperimentCompilerV0()]
  });
  assert(compiled.ok, `document did not compile: ${describeFailures(compiled)}`);
  const compilation = compiled.value;

  // A point the section actually emitted, rather than a guessed coordinate:
  // the w = 0 cut of a solid tesseract is a solid cube, and its triangles are
  // that cube's boundary, so an interior point is on no emitted cell.
  const probePoint = firstEmittedSectionPoint();
  const inSection = compilation.invoke('probe', {
    representation: 'section',
    point: probePoint
  });
  const section = readProbeOutput(inSection.output, 'section');
  assert(
    section.sourceCellStatus === 'resolved',
    `section sourceCellStatus was ${section.sourceCellStatus}`
  );
  assert(section.sourceCell !== undefined, 'a resolved section probe named no source cell');
  assert(
    section.sourceCellPrecision === 'exact' || section.sourceCellPrecision === 'renderer',
    `section sourceCellPrecision was ${String(section.sourceCellPrecision)}`
  );

  const inProjection = compilation.invoke('probe', {
    representation: 'shadow',
    point: probePoint
  });
  const shadow = readProbeOutput(inProjection.output, 'projection');
  // A perspective projection is many-to-one, so it may not name one source
  // cell and a globally unique ambient point from a chart coordinate alone.
  assert(
    shadow.sourceCellStatus !== 'resolved' || shadow.ambientPoint === undefined,
    'a perspective probe manufactured a globally unique R4 point'
  );

  compilation.dispose();
}

const describeFailures = (result: { readonly ok: boolean }): string =>
  JSON.stringify('failures' in result ? result.failures : null);
