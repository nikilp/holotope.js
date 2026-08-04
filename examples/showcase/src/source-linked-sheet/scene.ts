import { CellComplex, type CellGroup } from '@holotope/core';
import {
  XpbdWorldN,
  compileSimplexConstitutiveFamilyN,
  compileXpbdParticleBindingN,
  compileXpbdParticleSourceSimplexBarrierFamilyN,
  compileXpbdSourceSimplexAabbHierarchyN,
  compileXpbdSourceSimplexCosineBendingFamilyN,
  simplexStVenantKirchhoffLawN,
  stepXpbdIncrementalPotentialWorldN
} from '@holotope/physics';

/**
 * One R4 triangular sheet, its finite static obstacle, and the mechanics that
 * evolve them.
 *
 * This module owns the physics and the source geometry, and nothing else. It
 * imports no renderer, so the same construction the page draws is the one a
 * headless test advances — a page cannot drift from the system it claims to be
 * showing if there is only one of them.
 *
 * The sheet carries two independent stiffnesses. Intrinsic stretch resists
 * deforming each triangle and is supplied by a shipped RN constitutive family.
 * Extrinsic **discrete cosine-fold bending** resists folding *between* adjacent
 * triangles, which an intrinsic metric cannot see: a sheet creased along an
 * edge has every triangle undeformed.
 *
 * That bending term is a discrete stiffness, **not a shell model**. Its
 * coordinate is the unsigned cosine of the fold from flat, so a quadratic
 * energy in that coordinate is quartic in the fold angle — it does not converge
 * to a continuum bending energy under mesh refinement, and the stiffness below
 * belongs to this mesh rather than to a material.
 */

/** How the contact search is organized. It never changes the physical answer. */
export type CandidateSearch = 'exhaustive' | 'static-hierarchy';

/** Construction parameters for one sheet scene. */
export interface SheetSceneOptions {
  /** Vertices per side of the triangulated sheet. */
  readonly resolution: number;
  /** Static obstacle tetrahedra, laid out on a square lattice. */
  readonly tiles: number;
  /**
   * Broadphase organization. `'static-hierarchy'` compiles an AABB tree over
   * the unmoving obstacle; both settings retain the same ordered candidates and
   * produce the same trajectory.
   */
  readonly search: CandidateSearch;
  /** Distinguishes identifiers when more than one scene exists at once. */
  readonly id: string;
}

/** A compiled scene: one source, one world, and the families acting on it. */
export interface SheetScene {
  readonly options: SheetSceneOptions;
  readonly world: XpbdWorldN;
  readonly binding: ReturnType<typeof compileXpbdParticleBindingN>;
  readonly material: ReturnType<typeof compileSimplexConstitutiveFamilyN>;
  readonly bending: ReturnType<typeof compileXpbdSourceSimplexCosineBendingFamilyN>;
  readonly contact: ReturnType<typeof compileXpbdParticleSourceSimplexBarrierFamilyN>;
  /** The authoritative R4 sheet. Both views are derived from this. */
  readonly sheet: CellComplex;
  readonly sheetGroup: CellGroup;
  /** The separate static R4 obstacle. */
  readonly obstacle: CellComplex;
  /** The obstacle's 3-cell group, which contact indexes. */
  readonly obstacleGroup: CellGroup;
  /** Source vertices held fixed, so the sheet deforms instead of translating. */
  readonly fixedVertices: readonly number[];
}

/** What one advance reveals, curated for display. */
export interface SheetStepReport {
  /** `'applied'` when the step advanced the sheet; otherwise a typed refusal. */
  readonly status: string;
  /** Classified condition behind that status. */
  readonly condition: string;
  /** Refusal reason, or `null` when the step applied. */
  readonly refusalReason: string | null;
  /** Accepted minimizer iterations for this step. */
  readonly acceptedIterations: number;
  /** Energy resisting deformation within triangles. */
  readonly intrinsicEnergy: number;
  /** Energy resisting the fold between adjacent triangles. */
  readonly bendingEnergy: number;
  /** Energy of the exactly active contact barriers. */
  readonly contactEnergy: number;
  readonly totalPotential: number;
  /** Every sheet-vertex/obstacle-cell pair that exists. */
  readonly possiblePairs: number;
  /** Pairs the broadphase kept for exact evaluation. Not contacts. */
  readonly retainedPairs: number;
  /** Pairs whose exact distance is inside the activation distance. */
  readonly activeBarriers: number;
  /** Individual obstacle bounds the tree tested, or `null` when exhaustive. */
  readonly hierarchyBoundTests: number | null;
  readonly hingeCount: number;
  readonly elementCount: number;
  /** Smallest fold height seen; small means an ill-conditioned hinge. */
  readonly minimumConormalHeight: number;
  /** Range of the hidden coordinate across the sheet. */
  readonly wRange: readonly [number, number];
}

const CREASE = 0.35;
const START_W = 0.9;
const START_VELOCITY_W = -1.6;
const COLUMN_SPACING = 0.6;
const ROW_SPACING = 0.45;
const DELTA_TIME = 1 / 240;

/**
 * A triangulated 2-manifold sheet in R4, creased along one interior row.
 *
 * The spacing is deliberately unequal on the two axes. An anisotropic sheet
 * cannot be satisfied by a frozen path or a uniform rescale, so a differential
 * comparing two runs is comparing something.
 */
function sheetPatch(resolution: number): {
  complex: CellComplex;
  group: CellGroup;
} {
  const positions: number[] = [];
  const creaseRow = Math.floor(resolution / 2);
  for (let row = 0; row < resolution; row++) {
    for (let column = 0; column < resolution; column++) {
      positions.push(
        column * COLUMN_SPACING,
        row * ROW_SPACING,
        row === creaseRow ? CREASE : 0,
        START_W
      );
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < resolution - 1; row++) {
    for (let column = 0; column < resolution - 1; column++) {
      const at = row * resolution + column;
      // One fixed diagonal per quad, so the triangulation is deterministic.
      indices.push(at, at + 1, at + resolution);
      indices.push(at + 1, at + resolution + 1, at + resolution);
    }
  }
  const complex = new CellComplex(4, Float64Array.from(positions), [{
    key: 'sheet', dim: 2, verticesPerCell: 3, kind: 'simplex',
    indices: Uint32Array.from(indices)
  }]);
  const [group] = complex.cellsOfDim(2);
  if (group === undefined) throw new Error('sheetPatch: no 2-cells');
  return { complex, group };
}

/** A finite static tetrahedral obstacle lying in the `w = 0` hyperplane. */
function obstaclePatch(tiles: number): {
  complex: CellComplex;
  group: CellGroup;
} {
  const perSide = Math.max(1, Math.ceil(Math.sqrt(tiles)));
  const spacing = 1.1;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let tile = 0; tile < tiles; tile++) {
    const originX = (tile % perSide) * spacing;
    const originY = Math.floor(tile / perSide) * spacing;
    positions.push(
      originX, originY, 0, 0,
      originX + 0.9, originY, 0, 0,
      originX, originY + 0.9, 0, 0,
      originX, originY, 0.9, 0
    );
    for (let vertex = 0; vertex < 4; vertex++) indices.push(tile * 4 + vertex);
  }
  // The boundary triangles of every tetrahedron, as a second group. Contact
  // indexes the 3-cell group by object identity and never sees this one; it
  // exists so a surface render product has real faces to draw rather than
  // having faces invented for it.
  const faces: number[] = [];
  for (let tile = 0; tile < tiles; tile++) {
    const base = tile * 4;
    for (const [a, b, c] of [
      [0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]
    ] as const) {
      faces.push(base + a, base + b, base + c);
    }
  }
  const complex = new CellComplex(4, Float64Array.from(positions), [
    {
      key: 'obstacle', dim: 3, verticesPerCell: 4, kind: 'simplex',
      indices: Uint32Array.from(indices)
    },
    {
      key: 'obstacle-faces', dim: 2, verticesPerCell: 3, kind: 'simplex',
      indices: Uint32Array.from(faces)
    }
  ]);
  const [group] = complex.cellsOfDim(3);
  if (group === undefined) throw new Error('obstaclePatch: no 3-cells');
  return { complex, group };
}

/**
 * Compiles one complete sheet scene.
 *
 * Every rest-state provider is compiled *before* the initial velocity is
 * imposed, so each family's rest shape is the authored geometry rather than
 * whatever the first step happened to produce.
 *
 * @param options - Sheet resolution, obstacle size, broadphase organization,
 * and an identifier prefix.
 * @returns The world, its families, and the source complexes the views read.
 *
 * @example
 * ```ts
 * const scene = buildSheetScene({
 *   resolution: 5, tiles: 9, search: 'exhaustive', id: 'sheet'
 * });
 * const report = stepSheetScene(scene);
 * log(report.status, report.activeBarriers);
 * ```
 */
export function buildSheetScene(options: SheetSceneOptions): SheetScene {
  const sheet = sheetPatch(options.resolution);
  const obstacle = obstaclePatch(options.tiles);

  // The two far corners of the first row: the smallest set that stops the sheet
  // translating away instead of deforming against the obstacle.
  const fixedVertices = [0, options.resolution - 1];
  const binding = compileXpbdParticleBindingN({
    id: `${options.id}-points`,
    source: sheet.complex,
    fixed: ({ sourceVertexIndex }) => fixedVertices.includes(sourceVertexIndex)
  });

  const material = compileSimplexConstitutiveFamilyN({
    id: `${options.id}-stretch`,
    source: sheet.complex,
    simplexGroup: sheet.group,
    particles: binding.particles,
    law: simplexStVenantKirchhoffLawN,
    material: { firstLameParameter: 1.5, shearModulus: 2 }
  });

  const bending = compileXpbdSourceSimplexCosineBendingFamilyN({
    id: `${options.id}-bend`,
    binding,
    simplexGroup: sheet.group,
    // Discretization-dependent, not a material constant.
    stiffness: 8,
    restCoordinate: 1,
    minimumMeasureRatio: 0.05
  });

  const contact = compileXpbdParticleSourceSimplexBarrierFamilyN({
    id: `${options.id}-contact`,
    binding,
    obstacle: obstacle.complex,
    simplexGroup: obstacle.group,
    minimumDistance: 0.04,
    activationDistance: 1.2,
    stiffness: 3,
    ...(options.search === 'static-hierarchy'
      ? {
        candidateHierarchy: compileXpbdSourceSimplexAabbHierarchyN({
          obstacle: obstacle.complex, simplexGroup: obstacle.group, leafSize: 2
        })
      }
      : {})
  });

  // Only now, after every rest state has been captured.
  for (const particle of binding.particles) {
    particle.velocity.data[3] = START_VELOCITY_W;
  }

  const world = new XpbdWorldN({ dimension: 4, gravity: [0, 0, 0, -9.81] });
  binding.addToWorld(world);
  material.addToWorld(world);
  bending.addToWorld(world);
  contact.addToWorld(world);

  return {
    options,
    world,
    binding,
    material,
    bending,
    contact,
    sheet: sheet.complex,
    sheetGroup: sheet.group,
    obstacle: obstacle.complex,
    obstacleGroup: obstacle.group,
    fixedVertices
  };
}

/**
 * Advances one scene by a single fixed step and reads what it reveals.
 *
 * Both step filters travel with their providers: the fold filter certifies that
 * no triangle collapses mid-search, and the contact filter certifies the
 * admissible prefix of the search segment. Passing either provider without its
 * filter would leave the segment uncertified.
 *
 * After an applied step the particle positions are written back to the sheet
 * source, so both views redraw from the same authoritative R4 state.
 *
 * @param scene - The scene to advance.
 * @returns The curated report for this step.
 */
export function stepSheetScene(scene: SheetScene): SheetStepReport {
  const advance = stepXpbdIncrementalPotentialWorldN({
    world: scene.world,
    deltaTime: DELTA_TIME,
    stepFilters: [scene.bending.stepFilter, scene.contact.stepFilter],
    warmStart: 'feasible-inertial-prediction',
    minimization: { directionPolicy: 'steepest-descent' }
  });
  scene.binding.writeSourcePositions();

  const material = scene.material.evaluate();
  const bending = scene.bending.evaluate();
  const contact = scene.contact.evaluate();
  const diagnostics = contact.candidateQuery.diagnostics;

  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const particle of scene.binding.particles) {
    const w = particle.position.data[3] ?? 0;
    low = Math.min(low, w);
    high = Math.max(high, w);
  }

  return {
    status: advance.step.status,
    condition: advance.diagnosis.condition,
    refusalReason: advance.step.status === 'refused' ? advance.step.reason : null,
    acceptedIterations: advance.step.progress.acceptedIterations,
    intrinsicEnergy: material.potentialEnergy,
    bendingEnergy: bending.potentialEnergy,
    contactEnergy: contact.potentialEnergy,
    totalPotential: material.potentialEnergy + bending.potentialEnergy +
      contact.potentialEnergy,
    possiblePairs: diagnostics.possiblePairs,
    retainedPairs: diagnostics.candidatePairs,
    activeBarriers: contact.activeCandidates.length,
    hierarchyBoundTests: diagnostics.hierarchy?.testedSimplexBounds ?? null,
    hingeCount: bending.hingeCount,
    elementCount: scene.material.elements.length,
    minimumConormalHeight: bending.minimumConormalHeight,
    wRange: [low, high]
  };
}

/** Ordered contact-candidate identities, for comparing two search settings. */
export function candidateIdentities(scene: SheetScene): readonly string[] {
  const prefix = `${scene.options.id}-contact/`;
  return scene.contact
    .evaluate()
    .candidateQuery.candidates.map((candidate) => candidate.id.slice(prefix.length));
}

/** The sheet's source coordinates, for comparing two runs exactly. */
export function sourceDigest(scene: SheetScene): string {
  return Array.from(scene.sheet.positions)
    .map((value) => value.toExponential(17))
    .join(',');
}
