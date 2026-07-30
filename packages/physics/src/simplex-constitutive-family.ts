import {
  CellComplex,
  MatN,
  VecN,
  createSourceCellIdN,
  createSourceCellReferenceN,
  inspectSourceCellReferenceN,
  resolveSourceCellIdN,
  type CellGroup,
  type SourceCellIdN,
  type SourceCellReferenceN
} from '@holotope/core';
import type { SimplexConstitutiveEvaluationN } from './simplex-constitutive.js';
import type { SimplexConstitutiveHessianVectorEvaluationN } from './simplex-constitutive-curvature.js';
import { evaluateSimplexSquaredMeasureN } from './xpbd-simplex-measure.js';
import type {
  XpbdConservativeHessianBlockN,
  XpbdConservativeHessianVectorEvaluationN,
  XpbdParticleDirectionQueryN
} from './xpbd-incremental-potential-analytic-curvature.js';
import {
  XpbdParticleN,
  XpbdWorldN,
  type XpbdConservativeForceProviderN,
  type XpbdForceProviderEvaluationN,
  type XpbdParticlePositionQueryN
} from './xpbd-world.js';

/** Pure dimension-independent constitutive evaluator used by family assembly. */
export interface SimplexConstitutiveLawN<
  TMaterial,
  TEvaluation extends SimplexConstitutiveEvaluationN<TMaterial>
> {
  readonly id: string;
  evaluate(
    restPositions: readonly VecN[],
    currentPositions: readonly VecN[],
    material: TMaterial
  ): TEvaluation;
  /**
   * Optional exact matrix-free curvature capability for this law.
   *
   * Its products use the mathematical potential sign
   * `Hessian(U) * direction`.
   */
  evaluateHessianVector?(
    restPositions: readonly VecN[],
    currentPositions: readonly VecN[],
    directions: readonly VecN[],
    material: TMaterial
  ): SimplexConstitutiveHessianVectorEvaluationN<TEvaluation>;
}

/** Source-side identity of one compiled element, before any material is chosen. */
export interface SimplexConstitutiveFamilyElementContextN {
  /** Ordinal of the source cell this element was compiled from. */
  readonly sourceCellIndex: number;
  /** Source vertex ordinals of the element, in the cell's own order. */
  readonly sourceVertexIndices: readonly number[];
  /** Structural source-cell identity, stable across regeneration. */
  readonly sourceId: SourceCellIdN;
  /** Intrinsic simplex dimension `k`, one less than its vertex count. */
  readonly simplexDimension: number;
  /** Undeformed k-measure, the reference the energy density is scaled by. */
  readonly restMeasure: number;
}

export type SimplexConstitutiveFamilyMaterialN<TMaterial> =
  | TMaterial
  | ((element: SimplexConstitutiveFamilyElementContextN) => TMaterial);

export interface CompileSimplexConstitutiveFamilyNOptions<
  TMaterial,
  TEvaluation extends SimplexConstitutiveEvaluationN<TMaterial>
> {
  readonly id: string;
  readonly source: CellComplex;
  readonly simplexGroup: CellGroup;
  /** One live particle per source vertex, in source-vertex order. */
  readonly particles: readonly XpbdParticleN[];
  readonly law: SimplexConstitutiveLawN<TMaterial, TEvaluation>;
  readonly material: SimplexConstitutiveFamilyMaterialN<TMaterial>;
}

/** One compiled element: its source identity together with its material. */
export interface SimplexConstitutiveFamilyElementN<TMaterial>
  extends SimplexConstitutiveFamilyElementContextN {
  /** Provenance record tying this element back to the cell it came from. */
  readonly sourceReference: SourceCellReferenceN;
  /** Material resolved for this element, uniform or per-element. */
  readonly material: TMaterial;
}

/** One element paired with what its law reported at the current state. */
export interface SimplexConstitutiveFamilyElementEvaluationN<
  TMaterial,
  TEvaluation extends SimplexConstitutiveEvaluationN<TMaterial>
> {
  /** The compiled element the evaluation belongs to. */
  readonly element: SimplexConstitutiveFamilyElementN<TMaterial>;
  /** Complete law evaluation at this element's current positions. */
  readonly evaluation: TEvaluation;
}

export interface SimplexConstitutiveFamilyEvaluationN<
  TMaterial,
  TEvaluation extends SimplexConstitutiveEvaluationN<TMaterial>
> extends XpbdForceProviderEvaluationN {
  readonly lawId: string;
  readonly potentialEnergy: number;
  /** One entry per source simplex, in source-cell order. */
  readonly elements: readonly SimplexConstitutiveFamilyElementEvaluationN<
    TMaterial,
    TEvaluation
  >[];
  readonly maximumStrainFrobeniusNorm: number;
  readonly minimumMeasureRatio: number;
  readonly invertedElementCount: number;
  readonly collapsedElementCount: number;
  /** Norm of the summed internal forces. */
  readonly netForceResidual: number;
}

/** One simplex's exact contribution to a family Hessian-vector product. */
export interface SimplexConstitutiveFamilyElementHessianVectorEvaluationN<
  TMaterial,
  TEvaluation extends SimplexConstitutiveEvaluationN<TMaterial>
> {
  /** Source-identified simplex whose local product was evaluated. */
  readonly element: SimplexConstitutiveFamilyElementN<TMaterial>;
  /** Exact law-level directional tensors and vertex products for the simplex. */
  readonly evaluation: SimplexConstitutiveHessianVectorEvaluationN<TEvaluation>;
}

/** One source-simplex block in an exact constitutive Hessian decomposition. */
export interface SimplexConstitutiveFamilyHessianBlockN<TMaterial>
  extends XpbdConservativeHessianBlockN {
  /** Compiled source element whose law contributes this block. */
  readonly element: SimplexConstitutiveFamilyElementN<TMaterial>;
}

/** Exact assembled potential curvature for one constitutive family. */
export interface SimplexConstitutiveFamilyHessianVectorEvaluationN<
  TMaterial,
  TEvaluation extends SimplexConstitutiveEvaluationN<TMaterial>
> extends XpbdConservativeHessianVectorEvaluationN {
  /** Stable constitutive-law identity shared with first-order evaluation. */
  readonly lawId: string;
  /** One exact contribution per source simplex, in source-cell order. */
  readonly elements: readonly SimplexConstitutiveFamilyElementHessianVectorEvaluationN<
    TMaterial,
    TEvaluation
  >[];
  /** Norm of the summed products; internal translation invariance makes it zero. */
  readonly netProductResidual: number;
}

/** Source-identified constitutive elements assembled over shared RN particles. */
export class SimplexConstitutiveFamilyN<
  TMaterial,
  TEvaluation extends SimplexConstitutiveEvaluationN<TMaterial>
> implements XpbdConservativeForceProviderN {
  readonly id: string;
  readonly dimension: number;
  readonly source: CellComplex;
  readonly sourceSimplexGroup: CellGroup;
  readonly particles: readonly XpbdParticleN[];
  readonly law: SimplexConstitutiveLawN<TMaterial, TEvaluation>;
  readonly elements: readonly SimplexConstitutiveFamilyElementN<TMaterial>[];
  /**
   * Exact provider curvature when the selected law supplies it.
   *
   * The property is absent for custom first-order-only laws so the global
   * incremental-potential preflight can refuse incomplete provider mixtures.
   */
  readonly evaluatePotentialHessianVectorAt:
    | ((
      positionOf: XpbdParticlePositionQueryN,
      directionOf: XpbdParticleDirectionQueryN
    ) => SimplexConstitutiveFamilyHessianVectorEvaluationN<
      TMaterial,
      TEvaluation
    >)
    | undefined;
  /**
   * One exact additive Hessian block per source simplex when curvature exists.
   */
  readonly potentialHessianBlocks:
    readonly SimplexConstitutiveFamilyHessianBlockN<TMaterial>[] | undefined;
  /** Exact source-simplex block evaluation, absent for first-order-only laws. */
  readonly evaluatePotentialHessianBlockVectorAt:
    | ((
      block: XpbdConservativeHessianBlockN,
      positionOf: XpbdParticlePositionQueryN,
      directionOf: XpbdParticleDirectionQueryN
    ) => SimplexConstitutiveHessianVectorEvaluationN<TEvaluation>)
    | undefined;
  private readonly restPositions: readonly (readonly VecN[])[];
  private attachedWorld: XpbdWorldN | null = null;

  private constructor(
    options: CompileSimplexConstitutiveFamilyNOptions<TMaterial, TEvaluation>,
    elements: readonly SimplexConstitutiveFamilyElementN<TMaterial>[],
    restPositions: readonly (readonly VecN[])[]
  ) {
    this.id = options.id;
    this.dimension = options.source.ambientDim;
    this.source = options.source;
    this.sourceSimplexGroup = options.simplexGroup;
    this.particles = Object.freeze([...options.particles]);
    this.law = options.law;
    this.elements = Object.freeze([...elements]);
    this.restPositions = Object.freeze([...restPositions]);
    if (options.law.evaluateHessianVector === undefined) {
      this.evaluatePotentialHessianVectorAt = undefined;
      this.potentialHessianBlocks = undefined;
      this.evaluatePotentialHessianBlockVectorAt = undefined;
    } else {
      this.evaluatePotentialHessianVectorAt = (positionOf, directionOf) =>
        this.evaluateHessianVectorAt(positionOf, directionOf);
      this.potentialHessianBlocks = Object.freeze(
        this.elements.map((element) => Object.freeze({
          id: `element/${element.sourceCellIndex}`,
          particles: Object.freeze(
            element.sourceVertexIndices.map(
              (vertex) => this.particles[vertex]!
            )
          ),
          element
        }))
      );
      this.evaluatePotentialHessianBlockVectorAt = (
        block,
        positionOf,
        directionOf
      ) => this.evaluateHessianBlockVectorAt(
        block,
        positionOf,
        directionOf
      );
    }
  }

  static compile<
    TMaterial,
    TEvaluation extends SimplexConstitutiveEvaluationN<TMaterial>
  >(
    options: CompileSimplexConstitutiveFamilyNOptions<TMaterial, TEvaluation>
  ): SimplexConstitutiveFamilyN<TMaterial, TEvaluation> {
    validateCompilerInput(options);
    const compiled = compileElements(options);
    return new SimplexConstitutiveFamilyN(
      options,
      compiled.elements,
      compiled.restPositions
    );
  }

  evaluate(): SimplexConstitutiveFamilyEvaluationN<TMaterial, TEvaluation> {
    return this.evaluateAt((particle) => particle.position);
  }

  /** Evaluates energy and force at a pure candidate position query. */
  evaluateAt(
    positionOf: XpbdParticlePositionQueryN
  ): SimplexConstitutiveFamilyEvaluationN<TMaterial, TEvaluation> {
    if (typeof positionOf !== 'function') {
      throw new Error(
        'SimplexConstitutiveFamilyN.evaluateAt: positionOf must be a function'
      );
    }
    this.assertCurrentLineage('evaluateAt');
    const candidatePositions = this.particles.map((particle, index) => {
      const position = positionOf(particle);
      if (!(position instanceof VecN) || position.dim !== this.dimension) {
        throw new Error(
          `SimplexConstitutiveFamilyN.evaluateAt: particle ${index} position must be R${this.dimension}`
        );
      }
      for (const coordinate of position.data) {
        if (!Number.isFinite(coordinate)) {
          throw new Error(
            `SimplexConstitutiveFamilyN.evaluateAt: particle ${index} position must be finite`
          );
        }
      }
      return position;
    });
    const forces = this.particles.map(() => new VecN(this.dimension));
    const elementEvaluations: Array<
      SimplexConstitutiveFamilyElementEvaluationN<TMaterial, TEvaluation>
    > = [];
    let potentialEnergy = 0;
    let maximumStrainFrobeniusNorm = 0;
    let minimumMeasureRatio = Number.POSITIVE_INFINITY;
    let invertedElementCount = 0;
    let collapsedElementCount = 0;

    for (let elementIndex = 0; elementIndex < this.elements.length; elementIndex++) {
      const element = this.elements[elementIndex]!;
      const currentPositions = element.sourceVertexIndices.map(
        (vertex) => candidatePositions[vertex]!
      );
      const evaluation = this.law.evaluate(
        this.restPositions[elementIndex]!,
        currentPositions,
        element.material
      );
      validateEvaluation(
        evaluation,
        this.dimension,
        element.simplexDimension,
        `SimplexConstitutiveFamilyN.evaluateAt: law "${this.law.id}" element ${elementIndex}`
      );
      potentialEnergy += evaluation.energy;
      if (!Number.isFinite(potentialEnergy)) {
        throw new Error(
          'SimplexConstitutiveFamilyN.evaluateAt: potential energy is outside the Float64 range'
        );
      }
      maximumStrainFrobeniusNorm = Math.max(
        maximumStrainFrobeniusNorm,
        evaluation.deformation.strainFrobeniusNorm
      );
      minimumMeasureRatio = Math.min(
        minimumMeasureRatio,
        evaluation.deformation.measureRatio
      );
      if (evaluation.deformation.orientationChange.kind === 'full-dimensional') {
        if (evaluation.deformation.orientationChange.state === 'inverted') {
          invertedElementCount++;
        } else if (evaluation.deformation.orientationChange.state === 'collapsed') {
          collapsedElementCount++;
        }
      }
      for (let local = 0; local < element.sourceVertexIndices.length; local++) {
        const assembled = forces[element.sourceVertexIndices[local]!]!;
        const gradient = evaluation.currentGradients[local]!;
        for (let axis = 0; axis < this.dimension; axis++) {
          assembled.data[axis] = assembled.data[axis]! - gradient.data[axis]!;
          if (!Number.isFinite(assembled.data[axis])) {
            throw new Error(
              'SimplexConstitutiveFamilyN.evaluateAt: assembled force is outside the Float64 range'
            );
          }
        }
      }
      elementEvaluations.push(Object.freeze({ element, evaluation }));
    }

    let netForceResidual = 0;
    for (let axis = 0; axis < this.dimension; axis++) {
      let sum = 0;
      for (const force of forces) sum += force.data[axis]!;
      netForceResidual = Math.hypot(netForceResidual, sum);
    }
    return Object.freeze({
      forces: Object.freeze(forces),
      lawId: this.law.id,
      potentialEnergy,
      elements: Object.freeze(elementEvaluations),
      maximumStrainFrobeniusNorm,
      minimumMeasureRatio,
      invertedElementCount,
      collapsedElementCount,
      netForceResidual
    });
  }

  private evaluateHessianVectorAt(
    positionOf: XpbdParticlePositionQueryN,
    directionOf: XpbdParticleDirectionQueryN
  ): SimplexConstitutiveFamilyHessianVectorEvaluationN<
    TMaterial,
    TEvaluation
  > {
    const caller =
      'SimplexConstitutiveFamilyN.evaluatePotentialHessianVectorAt';
    if (typeof positionOf !== 'function') {
      throw new Error(`${caller}: positionOf must be a function`);
    }
    if (typeof directionOf !== 'function') {
      throw new Error(`${caller}: directionOf must be a function`);
    }
    const lawEvaluator = this.law.evaluateHessianVector;
    if (lawEvaluator === undefined) {
      throw new Error(`${caller}: law "${this.law.id}" has no exact curvature`);
    }
    this.assertCurrentLineage('evaluatePotentialHessianVectorAt');
    const candidatePositions = this.particles.map((particle, index) =>
      finiteParticleVector(
        positionOf(particle),
        this.dimension,
        `${caller}: particle ${index} position`
      )
    );
    const candidateDirections = this.particles.map((particle, index) =>
      finiteParticleVector(
        directionOf(particle),
        this.dimension,
        `${caller}: particle ${index} direction`
      )
    );
    const products = this.particles.map(() => new VecN(this.dimension));
    const elementEvaluations: Array<
      SimplexConstitutiveFamilyElementHessianVectorEvaluationN<
        TMaterial,
        TEvaluation
      >
    > = [];

    for (let elementIndex = 0; elementIndex < this.elements.length; elementIndex++) {
      const element = this.elements[elementIndex]!;
      const currentPositions = element.sourceVertexIndices.map(
        (vertex) => candidatePositions[vertex]!
      );
      const directions = element.sourceVertexIndices.map(
        (vertex) => candidateDirections[vertex]!
      );
      const evaluation = lawEvaluator(
        this.restPositions[elementIndex]!,
        currentPositions,
        directions,
        element.material
      );
      validateHessianVectorEvaluation(
        evaluation,
        this.dimension,
        element.simplexDimension,
        `${caller}: law "${this.law.id}" element ${elementIndex}`
      );
      for (let local = 0; local < element.sourceVertexIndices.length; local++) {
        products[element.sourceVertexIndices[local]!]!
          .add(evaluation.products[local]!);
      }
      elementEvaluations.push(Object.freeze({ element, evaluation }));
    }

    let netProductResidual = 0;
    for (let axis = 0; axis < this.dimension; axis++) {
      let sum = 0;
      for (const product of products) sum += product.data[axis]!;
      netProductResidual = Math.hypot(netProductResidual, sum);
    }
    if (!Number.isFinite(netProductResidual)) {
      throw new Error(`${caller}: net product residual is outside Float64`);
    }
    return Object.freeze({
      products: Object.freeze(products),
      lawId: this.law.id,
      elements: Object.freeze(elementEvaluations),
      netProductResidual
    });
  }

  private evaluateHessianBlockVectorAt(
    block: XpbdConservativeHessianBlockN,
    positionOf: XpbdParticlePositionQueryN,
    directionOf: XpbdParticleDirectionQueryN
  ): SimplexConstitutiveHessianVectorEvaluationN<TEvaluation> {
    const caller =
      'SimplexConstitutiveFamilyN.evaluatePotentialHessianBlockVectorAt';
    if (typeof positionOf !== 'function') {
      throw new Error(`${caller}: positionOf must be a function`);
    }
    if (typeof directionOf !== 'function') {
      throw new Error(`${caller}: directionOf must be a function`);
    }
    const lawEvaluator = this.law.evaluateHessianVector;
    const blocks = this.potentialHessianBlocks;
    if (lawEvaluator === undefined || blocks === undefined) {
      throw new Error(`${caller}: law "${this.law.id}" has no exact curvature`);
    }
    const elementIndex = blocks.indexOf(
      block as SimplexConstitutiveFamilyHessianBlockN<TMaterial>
    );
    if (elementIndex < 0) {
      throw new Error(`${caller}: block does not belong to this family`);
    }
    this.assertCurrentLineage('evaluatePotentialHessianBlockVectorAt');
    const selected = blocks[elementIndex]!;
    const currentPositions = selected.particles.map((particle, local) =>
      finiteParticleVector(
        positionOf(particle),
        this.dimension,
        `${caller}: particle ${local} position`
      )
    );
    const directions = selected.particles.map((particle, local) =>
      finiteParticleVector(
        directionOf(particle),
        this.dimension,
        `${caller}: particle ${local} direction`
      )
    );
    const evaluation = lawEvaluator(
      this.restPositions[elementIndex]!,
      currentPositions,
      directions,
      selected.element.material
    );
    validateHessianVectorEvaluation(
      evaluation,
      this.dimension,
      selected.element.simplexDimension,
      `${caller}: law "${this.law.id}" element ${elementIndex}`
    );
    return evaluation;
  }

  /** Defensive copy of the compiled material rest simplex in source-cell order. */
  restPositionsOfElement(elementIndex: number): readonly VecN[] {
    if (!Number.isSafeInteger(elementIndex) ||
      elementIndex < 0 || elementIndex >= this.restPositions.length) {
      throw new Error(
        `SimplexConstitutiveFamilyN.restPositionsOfElement: elementIndex ${elementIndex} is out of range`
      );
    }
    return Object.freeze(
      this.restPositions[elementIndex]!.map((position) => position.clone())
    );
  }

  /** Refuses if any retained source cell has been retired or replaced. */
  assertCurrentLineage(
    operation:
      | 'evaluate'
      | 'evaluateAt'
      | 'evaluatePotentialHessianVectorAt'
      | 'evaluatePotentialHessianBlockVectorAt'
      | 'addToWorld'
  ): void {
    validateCurrentLineage(this.elements, operation);
  }

  /** Registers this family as a force provider; particles must already belong to the world. */
  addToWorld(world: XpbdWorldN): XpbdWorldN {
    if (!(world instanceof XpbdWorldN)) {
      throw new Error('SimplexConstitutiveFamilyN.addToWorld: expected an XpbdWorldN');
    }
    if (world.dimension !== this.dimension) {
      throw new Error(
        `SimplexConstitutiveFamilyN.addToWorld: family is R${this.dimension}, world is R${world.dimension}`
      );
    }
    if (this.attachedWorld !== null && this.attachedWorld !== world) {
      throw new Error(
        'SimplexConstitutiveFamilyN.addToWorld: family is already attached to another world'
      );
    }
    this.assertCurrentLineage('addToWorld');
    world.addForceProvider(this);
    this.attachedWorld = world;
    return world;
  }
}

export function compileSimplexConstitutiveFamilyN<
  TMaterial,
  TEvaluation extends SimplexConstitutiveEvaluationN<TMaterial>
>(
  options: CompileSimplexConstitutiveFamilyNOptions<TMaterial, TEvaluation>
): SimplexConstitutiveFamilyN<TMaterial, TEvaluation> {
  return SimplexConstitutiveFamilyN.compile(options);
}

function validateCompilerInput<
  TMaterial,
  TEvaluation extends SimplexConstitutiveEvaluationN<TMaterial>
>(options: CompileSimplexConstitutiveFamilyNOptions<TMaterial, TEvaluation>): void {
  const caller = 'compileSimplexConstitutiveFamilyN';
  if (typeof options.id !== 'string' || options.id.trim().length === 0) {
    throw new Error(`${caller}: id must be a non-empty string`);
  }
  if (!(options.source instanceof CellComplex)) {
    throw new Error(`${caller}: source must be a CellComplex`);
  }
  const group = options.simplexGroup;
  if (!options.source.groups.includes(group)) {
    throw new Error(`${caller}: simplexGroup must belong to source`);
  }
  if (!Number.isSafeInteger(group.dim) || group.dim < 1) {
    throw new Error(`${caller}: simplexGroup dimension must be positive`);
  }
  if (group.dim > options.source.ambientDim) {
    throw new Error(`${caller}: simplexGroup dimension exceeds ambient dimension`);
  }
  if (group.kind !== 'simplex' || group.verticesPerCell !== group.dim + 1) {
    throw new Error(`${caller}: simplexGroup must contain dim + 1 vertex simplices`);
  }
  if (group.indices.length === 0 || group.indices.length % group.verticesPerCell !== 0) {
    throw new Error(`${caller}: simplexGroup indices must contain complete cells`);
  }
  if (
    group.key !== undefined &&
    options.source.groups.filter((candidate) => candidate.key === group.key).length !== 1
  ) {
    throw new Error(`${caller}: source group key "${group.key}" is ambiguous`);
  }
  if (options.particles.length !== options.source.vertexCount) {
    throw new Error(`${caller}: particles must match the source vertex count`);
  }
  if (new Set(options.particles).size !== options.particles.length) {
    throw new Error(`${caller}: particle identities must be unique`);
  }
  const particleIds = new Set<string>();
  for (let index = 0; index < options.particles.length; index++) {
    const particle = options.particles[index];
    if (!(particle instanceof XpbdParticleN)) {
      throw new Error(`${caller}: particle ${index} must be an XpbdParticleN`);
    }
    if (particle.dimension !== options.source.ambientDim) {
      throw new Error(`${caller}: particle ${index} dimension mismatch`);
    }
    if (particleIds.has(particle.id)) {
      throw new Error(`${caller}: duplicate particle id "${particle.id}"`);
    }
    particleIds.add(particle.id);
    for (const coordinate of particle.position.data) {
      if (!Number.isFinite(coordinate)) {
        throw new Error(`${caller}: particle ${index} position must be finite`);
      }
    }
  }
  for (const vertex of group.indices) {
    if (vertex >= options.source.vertexCount) {
      throw new Error(`${caller}: source cell vertex ${vertex} is out of range`);
    }
  }
  if (typeof options.law !== 'object' || options.law === null) {
    throw new Error(`${caller}: law must be an object`);
  }
  if (typeof options.law.id !== 'string' || options.law.id.trim().length === 0) {
    throw new Error(`${caller}: law id must be a non-empty string`);
  }
  if (typeof options.law.evaluate !== 'function') {
    throw new Error(`${caller}: law must define evaluate()`);
  }
  if (
    typeof options.material !== 'function' &&
    (typeof options.material !== 'object' || options.material === null)
  ) {
    throw new Error(`${caller}: material must be a record or callback`);
  }
}

function compileElements<
  TMaterial,
  TEvaluation extends SimplexConstitutiveEvaluationN<TMaterial>
>(options: CompileSimplexConstitutiveFamilyNOptions<TMaterial, TEvaluation>): {
  elements: Array<SimplexConstitutiveFamilyElementN<TMaterial>>;
  restPositions: Array<readonly VecN[]>;
} {
  const caller = 'compileSimplexConstitutiveFamilyN';
  const group = options.simplexGroup;
  const cellCount = group.indices.length / group.verticesPerCell;
  const elements: Array<SimplexConstitutiveFamilyElementN<TMaterial>> = [];
  const restPositions: Array<readonly VecN[]> = [];
  for (let sourceCellIndex = 0; sourceCellIndex < cellCount; sourceCellIndex++) {
    const start = sourceCellIndex * group.verticesPerCell;
    const sourceVertexIndices = Object.freeze(Array.from(
      group.indices.subarray(start, start + group.verticesPerCell)
    ));
    if (new Set(sourceVertexIndices).size !== sourceVertexIndices.length) {
      throw new Error(`${caller}: source cell ${sourceCellIndex} repeats a vertex`);
    }
    const copiedRestPositions = Object.freeze(
      sourceVertexIndices.map((vertex) => sourcePosition(options.source, vertex))
    );
    const restMeasure = evaluateSimplexSquaredMeasureN(copiedRestPositions).measure;
    if (!(restMeasure > 0)) {
      throw new Error(`${caller}: source cell ${sourceCellIndex} is degenerate`);
    }
    const sourceReference = createSourceCellReferenceN(
      options.source,
      group,
      sourceCellIndex
    );
    const sourceId = frozenSourceId(createSourceCellIdN(sourceReference));
    const context: SimplexConstitutiveFamilyElementContextN = Object.freeze({
      sourceCellIndex,
      sourceVertexIndices,
      sourceId,
      simplexDimension: group.dim,
      restMeasure
    });
    const candidateMaterial = typeof options.material === 'function'
      ? (options.material as (
          element: SimplexConstitutiveFamilyElementContextN
        ) => TMaterial)(context)
      : options.material;
    const validated = options.law.evaluate(
      copiedRestPositions,
      copiedRestPositions,
      candidateMaterial
    );
    validateEvaluation(
      validated,
      options.source.ambientDim,
      group.dim,
      `${caller}: law "${options.law.id}" element ${sourceCellIndex}`
    );
    elements.push(Object.freeze({
      ...context,
      sourceReference,
      material: validated.material
    }));
    restPositions.push(copiedRestPositions);
  }
  return { elements, restPositions };
}

function validateEvaluation<TMaterial>(
  evaluation: SimplexConstitutiveEvaluationN<TMaterial>,
  ambientDimension: number,
  simplexDimension: number,
  caller: string
): void {
  if (typeof evaluation !== 'object' || evaluation === null) {
    throw new Error(`${caller}: law returned no evaluation`);
  }
  if (
    evaluation.deformation?.ambientDimension !== ambientDimension ||
    evaluation.deformation.simplexDimension !== simplexDimension
  ) {
    throw new Error(`${caller}: deformation dimension mismatch`);
  }
  for (const [label, value] of [
    ['restMeasure', evaluation.restMeasure],
    ['energyDensity', evaluation.energyDensity],
    ['energy', evaluation.energy],
    ['netGradientResidual', evaluation.netGradientResidual]
  ] as const) {
    if (!Number.isFinite(value)) {
      throw new Error(`${caller}: ${label} must be finite`);
    }
  }
  if (evaluation.currentGradients.length !== simplexDimension + 1) {
    throw new Error(`${caller}: current gradient count mismatch`);
  }
  if (!(evaluation.secondPiolaStress instanceof MatN) ||
    evaluation.secondPiolaStress.n !== simplexDimension) {
    throw new Error(`${caller}: second Piola stress dimension mismatch`);
  }
  for (const value of evaluation.secondPiolaStress.data) {
    if (!Number.isFinite(value)) {
      throw new Error(`${caller}: second Piola stress must be finite`);
    }
  }
  for (const gradient of evaluation.currentGradients) {
    if (!(gradient instanceof VecN) || gradient.dim !== ambientDimension) {
      throw new Error(`${caller}: current gradient dimension mismatch`);
    }
    for (const value of gradient.data) {
      if (!Number.isFinite(value)) {
        throw new Error(`${caller}: current gradients must be finite`);
      }
    }
  }
}

function validateHessianVectorEvaluation<
  TMaterial,
  TEvaluation extends SimplexConstitutiveEvaluationN<TMaterial>
>(
  evaluation: SimplexConstitutiveHessianVectorEvaluationN<TEvaluation>,
  ambientDimension: number,
  simplexDimension: number,
  caller: string
): void {
  if (typeof evaluation !== 'object' || evaluation === null) {
    throw new Error(`${caller}: law returned no curvature evaluation`);
  }
  validateEvaluation(
    evaluation.base,
    ambientDimension,
    simplexDimension,
    `${caller}: base`
  );
  if (evaluation.products.length !== simplexDimension + 1) {
    throw new Error(`${caller}: product count mismatch`);
  }
  if (!(evaluation.directionalRightCauchyGreen instanceof MatN) ||
    evaluation.directionalRightCauchyGreen.n !== simplexDimension) {
    throw new Error(`${caller}: directional metric dimension mismatch`);
  }
  if (!(evaluation.directionalSecondPiolaStress instanceof MatN) ||
    evaluation.directionalSecondPiolaStress.n !== simplexDimension) {
    throw new Error(`${caller}: directional stress dimension mismatch`);
  }
  for (const matrix of [
    evaluation.directionalRightCauchyGreen,
    evaluation.directionalSecondPiolaStress
  ]) {
    for (const value of matrix.data) {
      if (!Number.isFinite(value)) {
        throw new Error(`${caller}: directional matrix must be finite`);
      }
    }
  }
  for (const product of evaluation.products) {
    finiteParticleVector(product, ambientDimension, `${caller}: product`);
  }
  if (!Number.isFinite(evaluation.netProductResidual)) {
    throw new Error(`${caller}: net product residual must be finite`);
  }
}

function finiteParticleVector(
  vector: VecN,
  dimension: number,
  label: string
): VecN {
  if (!(vector instanceof VecN) || vector.dim !== dimension) {
    throw new Error(`${label} must be R${dimension}`);
  }
  for (const coordinate of vector.data) {
    if (!Number.isFinite(coordinate)) {
      throw new Error(`${label} must be finite`);
    }
  }
  return vector.clone();
}

function sourcePosition(source: CellComplex, vertex: number): VecN {
  return new VecN(source.positions.subarray(
    vertex * source.ambientDim,
    (vertex + 1) * source.ambientDim
  ));
}

function frozenSourceId(id: SourceCellIdN): SourceCellIdN {
  return Object.freeze({
    ...id,
    vertexIndices: Object.freeze([...id.vertexIndices])
  });
}

function validateCurrentLineage<TMaterial>(
  elements: readonly SimplexConstitutiveFamilyElementN<TMaterial>[],
  operation:
    | 'evaluate'
    | 'evaluateAt'
    | 'evaluatePotentialHessianVectorAt'
    | 'evaluatePotentialHessianBlockVectorAt'
    | 'addToWorld'
): void {
  for (const element of elements) {
    const referenceStatus = inspectSourceCellReferenceN(element.sourceReference);
    if (referenceStatus.kind !== 'current') {
      throw new Error(
        `SimplexConstitutiveFamilyN.${operation}: source cell ${element.sourceCellIndex} retired (${referenceStatus.reason})`
      );
    }
    const idStatus = resolveSourceCellIdN(
      element.sourceReference.complex,
      element.sourceId
    );
    if (idStatus.kind !== 'resolved') {
      throw new Error(
        `SimplexConstitutiveFamilyN.${operation}: source cell ${element.sourceCellIndex} id unavailable (${idStatus.reason})`
      );
    }
  }
}
