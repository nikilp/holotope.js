import { CellComplex, type CellGroup } from '@holotope/core';
import {
  XpbdWorldN,
  compileSimplexConstitutiveFamilyN,
  compileXpbdParticleBindingN,
  compileXpbdParticleSourceConvexHullBarrierFamilyN,
  compileXpbdSourceSimplexCosineBendingFamilyN,
  simplexStVenantKirchhoffLawN,
  stepXpbdIncrementalPotentialWorldN,
  type XpbdIncrementalPotentialStepAppliedN,
  type XpbdIncrementalPotentialStepRefusedN,
  type XpbdParticleSourceConvexHullBarrierFamilyEvaluationN,
  type XpbdSourceSimplexCosineBendingFamilyEvaluationN
} from '@holotope/physics';

/**
 * One R4 triangular sheet, its finite static convex support, and the mechanics
 * that evolve them.
 *
 * This module owns the physics and the source geometry, and nothing else. It
 * imports no renderer, so the same construction the page draws is the one a
 * headless test advances — a page cannot drift from the system it claims to be
 * showing if there is only one of them.
 *
 * Contact is **one closest-point query against one static convex hull** per
 * sheet vertex: the support is the convex hull of the slab's eight authored
 * corner vertices, so a vertex over the flat interior is pushed exactly along
 * the support normal, regardless of how the slab happens to be cut into cells
 * for rendering. The predecessor of this page summed one barrier per
 * decomposition tetrahedron, which manufactured a decomposition-dependent
 * lateral force; that model is preserved as a dated measurement in Kitchen,
 * not as a mode here.
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

/** Construction parameters for one sheet scene. */
export interface SheetSceneOptions {
  /** Vertices per side of the triangulated sheet. */
  readonly resolution: number;
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
  readonly contact: ReturnType<typeof compileXpbdParticleSourceConvexHullBarrierFamilyN>;
  /** The authoritative R4 sheet. Every view is derived from this. */
  readonly sheet: CellComplex;
  readonly sheetGroup: CellGroup;
  /** The separate static R4 support. */
  readonly obstacle: CellComplex;
  /** The 3-cell group whose vertices span the contact hull. */
  readonly obstacleGroup: CellGroup;
  /** Source vertices held fixed, so the sheet deforms instead of translating. */
  readonly fixedVertices: readonly number[];
}

/**
 * One active barrier's evidence, curated for display.
 *
 * Everything here was produced by the accepted step's own contact evaluation —
 * nothing is re-solved to show it. `interiorFeature` classifies the closest
 * point against the slab's flat interior: an interior closest feature must be
 * pushed exactly along the support normal, while a closest point on the slab's
 * boundary legitimately carries a lateral component and is reported as its own
 * class rather than hidden inside a global count.
 */
export interface SheetContactWitness {
  /** Dynamic sheet vertex this barrier acts on. */
  readonly sourceVertexIndex: number;
  /** Unsigned distance to the hull. */
  readonly distance: number;
  /** Authoritative obstacle vertices supporting the closest feature. */
  readonly sourceVertices: readonly number[];
  /** Closest point on the hull, packed `[x, y, z, w]`. */
  readonly closestPoint: readonly number[];
  /** Unit vector from the hull toward the sheet vertex. */
  readonly separationNormal: readonly number[];
  /** The query's support-gap certificate residual. */
  readonly supportGap: number;
  /** Whether the closest feature lies in the support's flat interior. */
  readonly interiorFeature: boolean;
  /** Lateral share of the barrier force at this vertex, in `[0, 1]`. */
  readonly lateralShare: number;
}

/**
 * The typed evidence behind a refused step, read from the solver's structured
 * results rather than parsed from any message.
 *
 * A pre-trial refusal names the exact step filter that declined to certify the
 * search segment and its typed reason — for example a bending hinge whose
 * triangle has degenerated past the authored measure floor. `trialsEvaluated`
 * is `0` in that case: the refusal happened before any Armijo trial ran, which
 * is the difference between "the solver failed to converge" and "the state is
 * outside a term's admissible domain".
 */
export interface SheetRefusalEvidence {
  /** Minimization outcome, e.g. `line-search-refused`. */
  readonly minimizationStatus: string;
  /** Authored id of the filter that blocked, or `null` when none did. */
  readonly blockingFilterId: string | null;
  /** The blocking filter's typed reason, or `null`. */
  readonly filterReason: string | null;
  /** Blocking source cell or vertex ordinal, or `null`. */
  readonly blockingIndex: number | null;
  /** Armijo trials evaluated before the refusal. */
  readonly trialsEvaluated: number;
}

/** What one advance reveals, curated for display. */
export interface SheetStepReport {
  /** `'applied'` when the step advanced the sheet; otherwise a typed refusal. */
  readonly status: string;
  /** Classified condition behind that status. */
  readonly condition: string;
  /** Refusal reason, or `null` when the step applied. */
  readonly refusalReason: string | null;
  /** Structured refusal evidence, or `null` when the step applied. */
  readonly refusalEvidence: SheetRefusalEvidence | null;
  /** Accepted minimizer iterations for this step. */
  readonly acceptedIterations: number;
  /** Energy resisting deformation within triangles. */
  readonly intrinsicEnergy: number;
  /** Energy resisting the fold between adjacent triangles. */
  readonly bendingEnergy: number;
  /** Energy of the active contact barriers. */
  readonly contactEnergy: number;
  readonly totalPotential: number;
  /** Authored obstacle vertices spanning the contact hull. */
  readonly hullVertexCount: number;
  /** Closest-point set queries this evaluation performed: one per vertex. */
  readonly setQueries: number;
  /** Distance-query iterations, summed over the set queries. */
  readonly queryIterations: number;
  /** Sheet vertices whose exact distance is inside the activation band. */
  readonly activeBarriers: number;
  /** Active barriers whose closest feature is in the flat interior. */
  readonly interiorBarriers: number;
  /** Active barriers whose closest feature lies on the support boundary. */
  readonly edgeBarriers: number;
  /** Largest lateral force share over interior-feature barriers. */
  readonly peakInteriorLateralShare: number;
  readonly hingeCount: number;
  readonly elementCount: number;
  /** Smallest fold height seen; small means an ill-conditioned hinge. */
  readonly minimumConormalHeight: number;
  /** Range of the hidden coordinate across the sheet. */
  readonly wRange: readonly [number, number];
  /**
   * Accumulated barrier force per bound source vertex, in source order.
   *
   * The contact model constrains vertices, not the surface between them, and
   * these are the only forces it produces. With one-set contact an interior
   * vertex's force points along the support normal; the overlay draws these
   * directly, so what it shows is a correctness witness rather than a mood.
   */
  readonly contactForces: readonly SheetContactForce[];
  /** Per-active-barrier witnesses, in source order. */
  readonly contactWitnesses: readonly SheetContactWitness[];
  /**
   * Which state these energies and populations describe.
   *
   * `'applied-iterate'` reuses the evaluations the solver already made at the
   * state it applied. `'unchanged-live-state'` means the step was refused, so
   * nothing was applied and this is the live state the page is still sitting
   * on — not a state anything moved to.
   */
  readonly diagnosticsSource: 'applied-iterate' | 'unchanged-live-state';
}

/** A per-vertex barrier force, as the physics package returns it. */
export interface SheetContactForce {
  readonly data: Float64Array;
}

const CREASE = 0.35;
const START_W = 0.9;
const START_VELOCITY_W = -1.6;
/**
 * The sheet's extent, which does not depend on its resolution.
 *
 * Raising the resolution is mesh *refinement*: more elements over the same
 * patch of R4. Deriving the spacing from a fixed span rather than fixing the
 * spacing is what makes that true — the alternative grows the sheet, so a
 * refined run would be a differently sized scene wandering out of frame and off
 * an obstacle that had not moved.
 */
const SHEET_WIDTH = 2.4;
const SHEET_DEPTH = 1.8;
/**
 * The one authoritative simulated timestep for this page.
 *
 * The physics advances by exactly this much per applied step and the inspector
 * reports simulated time from it. Declaring it twice is how a panel ends up
 * quietly describing a different simulation than the one running.
 */
export const SHEET_TIME_STEP = 1 / 240;

/**
 * The support slab's authored extents, shared by physics and classification.
 *
 * Every lateral face sits at least one activation band beyond the sheet's
 * authored extent (sheet x in [0, 2.4], y in [0, 1.8], z in [0, 0.35]). The
 * previous slab's z face was flush with the sheet's flat rows, so any -z
 * excursion from bending dynamics met an edge whose separation normal deflects
 * further outward; the margins move that first edge encounter from step ~73 to
 * step ~545 of the measured run. They are a measured delay, not a fix: the
 * support is frictionless and the sheet carries no dissipation, so material
 * eventually drapes past the finite boundary — which the page reports rather
 * than hides.
 */
const SLAB_LOW = [-0.5, -0.5, -0.6] as const;
const SLAB_HIGH = [2.9, 2.3, 0.9] as const;

/**
 * Contact parameters, with the activation range justified rather than large.
 *
 * The sheet starts at `W = 0.9` above the support, so `activationDistance =
 * 0.6` means the scene begins with *zero* active barriers and contact turns on
 * during the approach — the reset state is a fall, not a preload. The band is
 * two orders wider than one step's travel at the authored velocity, so the
 * paired filter certifies approach segments with room to spare. The old value
 * (1.2) was wider than the slab's own 0.9 thickness and pre-activated every
 * pair at reset, which made the first frame's contact population meaningless.
 */
const CONTACT = {
  minimumDistance: 0.04,
  activationDistance: 0.6,
  stiffness: 3
} as const;

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
  // Spacing follows from the span, so every resolution covers the same patch.
  const columnSpacing = SHEET_WIDTH / (resolution - 1);
  const rowSpacing = SHEET_DEPTH / (resolution - 1);
  for (let row = 0; row < resolution; row++) {
    for (let column = 0; column < resolution; column++) {
      positions.push(
        column * columnSpacing,
        row * rowSpacing,
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

/** Kuhn decomposition of one axis-aligned box into six tetrahedra. */
const KUHN: readonly (readonly [number, number, number, number])[] = [
  [0, 1, 3, 7], [0, 1, 5, 7], [0, 4, 5, 7],
  [0, 2, 3, 7], [0, 2, 6, 7], [0, 4, 6, 7]
];

/** Faces of one tetrahedron, as vertex-index triples into its own four. */
const TET_FACES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]
];

/**
 * The finite static support the sheet settles against, in the `w = 0`
 * hyperplane.
 *
 * The eight corner vertices are the authoritative source of the contact hull:
 * the 3-cell group's tetrahedra **select** those vertices, and the compiled
 * family represents their convex hull — one set, one closest point. The Kuhn
 * cells and the boundary-face 2-group exist for rendering and provenance; how
 * the box is cut into cells has no influence on the contact answer, and that
 * decomposition-independence is one of the page's teachable claims.
 */
function obstaclePatch(): {
  complex: CellComplex;
  group: CellGroup;
} {
  const positions: number[] = [];
  for (let corner = 0; corner < 8; corner++) {
    positions.push(
      (corner >> 0) & 1 ? SLAB_HIGH[0] : SLAB_LOW[0],
      (corner >> 1) & 1 ? SLAB_HIGH[1] : SLAB_LOW[1],
      (corner >> 2) & 1 ? SLAB_HIGH[2] : SLAB_LOW[2],
      0
    );
  }
  const cells = KUHN.map((tet) => [...tet]);

  // Faces: only those bounding the solid. An interior face is shared by two
  // tetrahedra and is not part of the object's surface.
  const faces: number[] = [];
  const incidence = new Map<string, number[][]>();
  for (const cell of cells) {
    for (const face of TET_FACES) {
      const vertices = face.map((slot) => cell[slot]!);
      const key = [...vertices].sort((a, b) => a - b).join(',');
      const existing = incidence.get(key);
      if (existing === undefined) incidence.set(key, [vertices]);
      else existing.push(vertices);
    }
  }
  for (const [, owners] of incidence) {
    if (owners.length !== 1) continue;
    faces.push(...owners[0]!);
  }

  const complex = new CellComplex(4, Float64Array.from(positions), [
    {
      key: 'obstacle', dim: 3, verticesPerCell: 4, kind: 'simplex',
      indices: Uint32Array.from(cells.flat())
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
 * @param options - Sheet resolution and an identifier prefix.
 * @returns The world, its families, and the source complexes the views read.
 *
 * @example
 * ```ts
 * const scene = buildSheetScene({ resolution: 5, id: 'sheet' });
 * const report = stepSheetScene(scene);
 * log(report.status, report.activeBarriers);
 * ```
 */
export function buildSheetScene(options: SheetSceneOptions): SheetScene {
  const sheet = sheetPatch(options.resolution);
  const obstacle = obstaclePatch();

  // The two far corners of the first row: the smallest set that stops the sheet
  // translating away instead of deforming against the support.
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

  const contact = compileXpbdParticleSourceConvexHullBarrierFamilyN({
    id: `${options.id}-contact`,
    binding,
    obstacle: obstacle.complex,
    sourceGroup: obstacle.group,
    ...CONTACT
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

/** Whether an xyz point lies strictly inside the slab's flat interior. */
function interiorOfSupport(x: number, y: number, z: number): boolean {
  const epsilon = 1e-9;
  return x > SLAB_LOW[0] + epsilon && x < SLAB_HIGH[0] - epsilon &&
    y > SLAB_LOW[1] + epsilon && y < SLAB_HIGH[1] - epsilon &&
    z > SLAB_LOW[2] + epsilon && z < SLAB_HIGH[2] - epsilon;
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
 * source, so every view redraws from the same authoritative R4 state.
 *
 * @param scene - The scene to advance.
 * @returns The curated report for this step.
 */
export function stepSheetScene(scene: SheetScene): SheetStepReport {
  const advance = stepXpbdIncrementalPotentialWorldN({
    world: scene.world,
    deltaTime: SHEET_TIME_STEP,
    stepFilters: [scene.bending.stepFilter, scene.contact.stepFilter],
    warmStart: 'feasible-inertial-prediction',
    minimization: { directionPolicy: 'steepest-descent' }
  });
  scene.binding.writeSourcePositions();

  // An applied step already evaluated every provider at the iterate it
  // applied, and those evaluations are retained on the result. Calling
  // `evaluate()` again here would repeat the most expensive work in the step
  // to learn something the solver just computed.
  //
  // A refused step applied nothing, so its final iterate is a state the sheet
  // never reached. Reporting it would describe motion that did not happen, so
  // the live — unchanged — state is evaluated instead and labelled as such.
  const step = advance.step;
  const reused = step.status === 'applied'
    ? readAppliedProviderEvaluations(scene, step)
    : null;
  const material = reused?.material ?? scene.material.evaluate();
  const bending = reused?.bending ?? scene.bending.evaluate();
  const contact = reused?.contact ?? scene.contact.evaluate();

  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const particle of scene.binding.particles) {
    const w = particle.position.data[3] ?? 0;
    low = Math.min(low, w);
    high = Math.max(high, w);
  }

  // Witness curation: classification and lateral share are computed from the
  // step's own evaluation, never from a second solve.
  const witnesses: SheetContactWitness[] = [];
  let interiorBarriers = 0;
  let edgeBarriers = 0;
  let peakInteriorLateralShare = 0;
  for (const record of contact.activeBarriers) {
    const closest = record.witness.closestPoint.data;
    const interiorFeature = interiorOfSupport(closest[0]!, closest[1]!, closest[2]!);
    const force = contact.forces[record.sourceVertexIndex]!.data;
    const lateral = Math.hypot(force[0]!, force[1]!, force[2]!);
    const magnitude = Math.hypot(lateral, force[3]!);
    const lateralShare = magnitude > 0 ? lateral / magnitude : 0;
    if (interiorFeature) {
      interiorBarriers++;
      peakInteriorLateralShare = Math.max(peakInteriorLateralShare, lateralShare);
    } else {
      edgeBarriers++;
    }
    witnesses.push({
      sourceVertexIndex: record.sourceVertexIndex,
      distance: record.distance,
      sourceVertices: record.witness.sourceVertices,
      closestPoint: Array.from(closest),
      separationNormal: Array.from(record.witness.separationNormal.data),
      supportGap: record.witness.query.termination.supportGap,
      interiorFeature,
      lateralShare
    });
  }

  return {
    status: advance.step.status,
    condition: advance.diagnosis.condition,
    refusalReason: advance.step.status === 'refused' ? advance.step.reason : null,
    refusalEvidence: advance.step.status === 'refused'
      ? readRefusalEvidence(advance.step)
      : null,
    acceptedIterations: advance.step.progress.acceptedIterations,
    intrinsicEnergy: material.potentialEnergy,
    bendingEnergy: bending.potentialEnergy,
    contactEnergy: contact.potentialEnergy,
    totalPotential: material.potentialEnergy + bending.potentialEnergy +
      contact.potentialEnergy,
    hullVertexCount: contact.diagnostics.hullVertexCount,
    setQueries: contact.diagnostics.setQueries,
    queryIterations: contact.diagnostics.queryIterations,
    activeBarriers: contact.diagnostics.activeParticles,
    interiorBarriers,
    edgeBarriers,
    peakInteriorLateralShare,
    hingeCount: bending.hingeCount,
    elementCount: scene.material.elements.length,
    minimumConormalHeight: bending.minimumConormalHeight,
    wRange: [low, high],
    contactForces: contact.forces,
    contactWitnesses: Object.freeze(witnesses),
    diagnosticsSource: reused === null ? 'unchanged-live-state' : 'applied-iterate'
  };
}

/**
 * The structured evidence behind a refused step.
 *
 * Read from the solver's typed results — never parsed out of an error message.
 * A pre-trial filter refusal carries the blocking filter's own evaluation, so
 * the page can say *which* term declined and *why* instead of reducing every
 * stop to "not converged".
 */
function readRefusalEvidence(
  step: XpbdIncrementalPotentialStepRefusedN
): SheetRefusalEvidence {
  const refused = step as unknown as {
    minimization?: {
      status?: string;
      search?: {
        status?: string;
        trials?: readonly unknown[];
        blockingFilter?: {
          filterId?: string;
          evaluation?: {
            reason?: string;
            blockingCellIndex?: number | null;
            blockingSourceVertexIndex?: number | null;
          };
        };
      };
    };
  };
  const minimization = refused.minimization;
  const search = minimization?.search;
  const blocking = search?.blockingFilter;
  return {
    minimizationStatus: minimization?.status ?? 'unknown',
    blockingFilterId: blocking?.filterId ?? null,
    filterReason: blocking?.evaluation?.reason ?? null,
    blockingIndex: blocking?.evaluation?.blockingCellIndex ??
      blocking?.evaluation?.blockingSourceVertexIndex ?? null,
    trialsEvaluated: search?.trials?.length ?? 0
  };
}

/**
 * The provider evaluations the applied step already made, by identity.
 *
 * Returns `null` rather than guessing if the retained set does not contain all
 * three: a diagnostic that silently describes two providers out of three would
 * be worse than paying for a fresh evaluation.
 */
function readAppliedProviderEvaluations(
  scene: SheetScene,
  step: XpbdIncrementalPotentialStepAppliedN
): {
  material: { readonly potentialEnergy: number };
  bending: XpbdSourceSimplexCosineBendingFamilyEvaluationN;
  contact: XpbdParticleSourceConvexHullBarrierFamilyEvaluationN;
} | null {
  const results = step.minimization.final.evaluation.potential.providers;
  const find = (provider: unknown): unknown => results
    .find((entry: { provider: unknown; evaluation: unknown }) =>
      entry.provider === provider)?.evaluation;
  const material = find(scene.material);
  const bending = find(scene.bending);
  const contact = find(scene.contact);
  if (material === undefined || bending === undefined || contact === undefined) {
    return null;
  }
  // Each family's `evaluateAt` returns its own rich evaluation, which is what
  // the solver retained; the provider seam only narrows it to the common
  // energy-and-forces shape.
  return {
    material: material as { readonly potentialEnergy: number },
    bending: bending as XpbdSourceSimplexCosineBendingFamilyEvaluationN,
    contact: contact as XpbdParticleSourceConvexHullBarrierFamilyEvaluationN
  };
}

/**
 * Whether a report is a typed refusal rather than an applied step.
 *
 * A refusal leaves the state exactly as it was, so the next step re-solves the
 * same configuration and refuses again for the same reason. Re-attempting it is
 * therefore not retrying — nothing has changed for a retry to act on. The page
 * pauses on this rather than spinning. Exported as a predicate so the rule is
 * testable without a browser.
 */
export function isRefusedReport(report: SheetStepReport): boolean {
  return report.status !== 'applied';
}

/** The sheet's source coordinates, for comparing two runs exactly. */
export function sourceDigest(scene: SheetScene): string {
  return Array.from(scene.sheet.positions)
    .map((value) => value.toExponential(17))
    .join(',');
}
