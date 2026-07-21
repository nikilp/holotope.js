import {
  CellComplex,
  VecN,
  createSourceCellIdN,
  createSourceCellReferenceN,
  inspectSourceCellReferenceN,
  resolveSourceCellIdN,
  type CellGroup,
  type SourceCellIdN,
  type SourceCellReferenceN
} from '@holotope/core';
import {
  evaluateSimplexStVenantKirchhoffN,
  type SimplexStVenantKirchhoffEvaluationN,
  type SimplexStVenantKirchhoffMaterialN
} from './simplex-stvk-material.js';
import { evaluateSimplexSquaredMeasureN } from './xpbd-simplex-measure.js';
import {
  XpbdParticleN,
  XpbdWorldN,
  type XpbdForceProviderEvaluationN,
  type XpbdForceProviderN
} from './xpbd-world.js';

export interface SimplexStVenantKirchhoffFamilyElementContextN {
  readonly sourceCellIndex: number;
  readonly sourceVertexIndices: readonly number[];
  readonly sourceId: SourceCellIdN;
  readonly simplexDimension: number;
  readonly restMeasure: number;
}

export type SimplexStVenantKirchhoffFamilyMaterialN =
  | SimplexStVenantKirchhoffMaterialN
  | ((
      element: SimplexStVenantKirchhoffFamilyElementContextN
    ) => SimplexStVenantKirchhoffMaterialN);

export interface CompileSimplexStVenantKirchhoffFamilyNOptions {
  readonly id: string;
  readonly source: CellComplex;
  readonly simplexGroup: CellGroup;
  /** One live particle per source vertex, in source-vertex order. */
  readonly particles: readonly XpbdParticleN[];
  readonly material: SimplexStVenantKirchhoffFamilyMaterialN;
}

export interface SimplexStVenantKirchhoffFamilyElementN
  extends SimplexStVenantKirchhoffFamilyElementContextN {
  readonly sourceReference: SourceCellReferenceN;
  readonly material: SimplexStVenantKirchhoffMaterialN;
}

export interface SimplexStVenantKirchhoffFamilyElementEvaluationN {
  readonly element: SimplexStVenantKirchhoffFamilyElementN;
  readonly evaluation: SimplexStVenantKirchhoffEvaluationN;
}

export interface SimplexStVenantKirchhoffFamilyEvaluationN
  extends XpbdForceProviderEvaluationN {
  readonly potentialEnergy: number;
  /** One entry per source simplex, in source-cell order. */
  readonly elements: readonly SimplexStVenantKirchhoffFamilyElementEvaluationN[];
  readonly maximumStrainFrobeniusNorm: number;
  readonly invertedElementCount: number;
  readonly collapsedElementCount: number;
  /** Norm of the summed internal forces. */
  readonly netForceResidual: number;
}

/** Source-identified StVK elements assembled over shared RN particles. */
export class SimplexStVenantKirchhoffFamilyN implements XpbdForceProviderN {
  readonly id: string;
  readonly dimension: number;
  readonly source: CellComplex;
  readonly sourceSimplexGroup: CellGroup;
  readonly particles: readonly XpbdParticleN[];
  readonly elements: readonly SimplexStVenantKirchhoffFamilyElementN[];
  private readonly restPositions: readonly (readonly VecN[])[];
  private attachedWorld: XpbdWorldN | null = null;

  private constructor(
    id: string,
    source: CellComplex,
    simplexGroup: CellGroup,
    particles: readonly XpbdParticleN[],
    elements: SimplexStVenantKirchhoffFamilyElementN[],
    restPositions: Array<readonly VecN[]>
  ) {
    this.id = id;
    this.dimension = source.ambientDim;
    this.source = source;
    this.sourceSimplexGroup = simplexGroup;
    this.particles = Object.freeze([...particles]);
    this.elements = Object.freeze(elements);
    this.restPositions = Object.freeze(restPositions);
  }

  static compile(
    options: CompileSimplexStVenantKirchhoffFamilyNOptions
  ): SimplexStVenantKirchhoffFamilyN {
    validateCompilerInput(options);
    const compiled = compileElements(options);
    return new SimplexStVenantKirchhoffFamilyN(
      options.id,
      options.source,
      options.simplexGroup,
      options.particles,
      compiled.elements,
      compiled.restPositions
    );
  }

  evaluate(): SimplexStVenantKirchhoffFamilyEvaluationN {
    validateCurrentLineage(this.elements, 'evaluate');
    const forces = this.particles.map(() => new VecN(this.dimension));
    const elementEvaluations: SimplexStVenantKirchhoffFamilyElementEvaluationN[] = [];
    let potentialEnergy = 0;
    let maximumStrainFrobeniusNorm = 0;
    let invertedElementCount = 0;
    let collapsedElementCount = 0;

    for (let elementIndex = 0; elementIndex < this.elements.length; elementIndex++) {
      const element = this.elements[elementIndex]!;
      const currentPositions = element.sourceVertexIndices.map(
        (vertex) => this.particles[vertex]!.position
      );
      const evaluation = evaluateSimplexStVenantKirchhoffN(
        this.restPositions[elementIndex]!,
        currentPositions,
        element.material
      );
      potentialEnergy += evaluation.energy;
      if (!Number.isFinite(potentialEnergy)) {
        throw new Error(
          'SimplexStVenantKirchhoffFamilyN.evaluate: potential energy is outside the Float64 range'
        );
      }
      maximumStrainFrobeniusNorm = Math.max(
        maximumStrainFrobeniusNorm,
        evaluation.deformation.strainFrobeniusNorm
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
              'SimplexStVenantKirchhoffFamilyN.evaluate: assembled force is outside the Float64 range'
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
      potentialEnergy,
      elements: Object.freeze(elementEvaluations),
      maximumStrainFrobeniusNorm,
      invertedElementCount,
      collapsedElementCount,
      netForceResidual
    });
  }

  /** Registers this family as a force provider; particles must already belong to the world. */
  addToWorld(world: XpbdWorldN): XpbdWorldN {
    if (!(world instanceof XpbdWorldN)) {
      throw new Error(
        'SimplexStVenantKirchhoffFamilyN.addToWorld: expected an XpbdWorldN'
      );
    }
    if (world.dimension !== this.dimension) {
      throw new Error(
        `SimplexStVenantKirchhoffFamilyN.addToWorld: family is R${this.dimension}, world is R${world.dimension}`
      );
    }
    if (this.attachedWorld !== null && this.attachedWorld !== world) {
      throw new Error(
        'SimplexStVenantKirchhoffFamilyN.addToWorld: family is already attached to another world'
      );
    }
    validateCurrentLineage(this.elements, 'addToWorld');
    world.addForceProvider(this);
    this.attachedWorld = world;
    return world;
  }
}

/** Compiles one explicitly selected source simplex family into StVK elements. */
export function compileSimplexStVenantKirchhoffFamilyN(
  options: CompileSimplexStVenantKirchhoffFamilyNOptions
): SimplexStVenantKirchhoffFamilyN {
  return SimplexStVenantKirchhoffFamilyN.compile(options);
}

function validateCompilerInput(
  options: CompileSimplexStVenantKirchhoffFamilyNOptions
): void {
  if (typeof options.id !== 'string' || options.id.trim().length === 0) {
    throw new Error(
      'compileSimplexStVenantKirchhoffFamilyN: id must be a non-empty string'
    );
  }
  if (!(options.source instanceof CellComplex)) {
    throw new Error(
      'compileSimplexStVenantKirchhoffFamilyN: source must be a CellComplex'
    );
  }
  const group = options.simplexGroup;
  if (!options.source.groups.includes(group)) {
    throw new Error(
      'compileSimplexStVenantKirchhoffFamilyN: simplexGroup must belong to source'
    );
  }
  if (!Number.isSafeInteger(group.dim) || group.dim < 1) {
    throw new Error(
      'compileSimplexStVenantKirchhoffFamilyN: simplexGroup dimension must be positive'
    );
  }
  if (group.dim > options.source.ambientDim) {
    throw new Error(
      'compileSimplexStVenantKirchhoffFamilyN: simplexGroup dimension exceeds ambient dimension'
    );
  }
  if (group.kind !== 'simplex' || group.verticesPerCell !== group.dim + 1) {
    throw new Error(
      'compileSimplexStVenantKirchhoffFamilyN: simplexGroup must contain dim + 1 vertex simplices'
    );
  }
  if (group.indices.length === 0 || group.indices.length % group.verticesPerCell !== 0) {
    throw new Error(
      'compileSimplexStVenantKirchhoffFamilyN: simplexGroup indices must contain complete cells'
    );
  }
  if (
    group.key !== undefined &&
    options.source.groups.filter((candidate) => candidate.key === group.key).length !== 1
  ) {
    throw new Error(
      `compileSimplexStVenantKirchhoffFamilyN: source group key "${group.key}" is ambiguous`
    );
  }
  if (options.particles.length !== options.source.vertexCount) {
    throw new Error(
      'compileSimplexStVenantKirchhoffFamilyN: particles must match the source vertex count'
    );
  }
  if (new Set(options.particles).size !== options.particles.length) {
    throw new Error(
      'compileSimplexStVenantKirchhoffFamilyN: particle identities must be unique'
    );
  }
  const particleIds = new Set<string>();
  for (let index = 0; index < options.particles.length; index++) {
    const particle = options.particles[index];
    if (!(particle instanceof XpbdParticleN)) {
      throw new Error(
        `compileSimplexStVenantKirchhoffFamilyN: particle ${index} must be an XpbdParticleN`
      );
    }
    if (particle.dimension !== options.source.ambientDim) {
      throw new Error(
        `compileSimplexStVenantKirchhoffFamilyN: particle ${index} dimension mismatch`
      );
    }
    if (particleIds.has(particle.id)) {
      throw new Error(
        `compileSimplexStVenantKirchhoffFamilyN: duplicate particle id "${particle.id}"`
      );
    }
    particleIds.add(particle.id);
    for (const coordinate of particle.position.data) {
      if (!Number.isFinite(coordinate)) {
        throw new Error(
          `compileSimplexStVenantKirchhoffFamilyN: particle ${index} position must be finite`
        );
      }
    }
  }
  for (const vertex of group.indices) {
    if (vertex >= options.source.vertexCount) {
      throw new Error(
        `compileSimplexStVenantKirchhoffFamilyN: source cell vertex ${vertex} is out of range`
      );
    }
  }
  if (
    typeof options.material !== 'function' &&
    (typeof options.material !== 'object' || options.material === null)
  ) {
    throw new Error(
      'compileSimplexStVenantKirchhoffFamilyN: material must be a record or callback'
    );
  }
}

function compileElements(
  options: CompileSimplexStVenantKirchhoffFamilyNOptions
): {
  elements: SimplexStVenantKirchhoffFamilyElementN[];
  restPositions: Array<readonly VecN[]>;
} {
  const group = options.simplexGroup;
  const cellCount = group.indices.length / group.verticesPerCell;
  const elements: SimplexStVenantKirchhoffFamilyElementN[] = [];
  const restPositions: Array<readonly VecN[]> = [];
  for (let sourceCellIndex = 0; sourceCellIndex < cellCount; sourceCellIndex++) {
    const start = sourceCellIndex * group.verticesPerCell;
    const sourceVertexIndices = Object.freeze(Array.from(
      group.indices.subarray(start, start + group.verticesPerCell)
    ));
    if (new Set(sourceVertexIndices).size !== sourceVertexIndices.length) {
      throw new Error(
        `compileSimplexStVenantKirchhoffFamilyN: source cell ${sourceCellIndex} repeats a vertex`
      );
    }
    const copiedRestPositions = Object.freeze(
      sourceVertexIndices.map((vertex) => sourcePosition(options.source, vertex))
    );
    const restMeasure = evaluateSimplexSquaredMeasureN(copiedRestPositions).measure;
    if (!(restMeasure > 0)) {
      throw new Error(
        `compileSimplexStVenantKirchhoffFamilyN: source cell ${sourceCellIndex} is degenerate`
      );
    }
    const sourceReference = createSourceCellReferenceN(
      options.source,
      group,
      sourceCellIndex
    );
    const sourceId = frozenSourceId(createSourceCellIdN(sourceReference));
    const context: SimplexStVenantKirchhoffFamilyElementContextN = Object.freeze({
      sourceCellIndex,
      sourceVertexIndices,
      sourceId,
      simplexDimension: group.dim,
      restMeasure
    });
    const candidateMaterial = typeof options.material === 'function'
      ? options.material(context)
      : options.material;
    const validated = evaluateSimplexStVenantKirchhoffN(
      copiedRestPositions,
      copiedRestPositions,
      candidateMaterial
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

function validateCurrentLineage(
  elements: readonly SimplexStVenantKirchhoffFamilyElementN[],
  operation: 'evaluate' | 'addToWorld'
): void {
  for (const element of elements) {
    const referenceStatus = inspectSourceCellReferenceN(element.sourceReference);
    if (referenceStatus.kind !== 'current') {
      throw new Error(
        `SimplexStVenantKirchhoffFamilyN.${operation}: source cell ${element.sourceCellIndex} retired (${referenceStatus.reason})`
      );
    }
    const idStatus = resolveSourceCellIdN(
      element.sourceReference.complex,
      element.sourceId
    );
    if (idStatus.kind !== 'resolved') {
      throw new Error(
        `SimplexStVenantKirchhoffFamilyN.${operation}: source cell ${element.sourceCellIndex} id unavailable (${idStatus.reason})`
      );
    }
  }
}
