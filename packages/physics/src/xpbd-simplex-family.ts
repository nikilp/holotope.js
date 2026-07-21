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
  XpbdSimplexSquaredMeasureConstraintN,
  evaluateSimplexSquaredMeasureN
} from './xpbd-simplex-measure.js';
import { XpbdParticleN, XpbdWorldN } from './xpbd-world.js';

export interface XpbdSimplexMeasureFamilyCellContextN {
  readonly sourceCellIndex: number;
  readonly sourceVertexIndices: readonly number[];
  readonly sourceId: SourceCellIdN;
  readonly simplexDimension: number;
  readonly sourceSquaredMeasure: number;
}

export type XpbdSimplexMeasureFamilyComplianceN =
  | number
  | ((cell: XpbdSimplexMeasureFamilyCellContextN) => number);

export type XpbdSimplexMeasureFamilyRestN =
  | number
  | ((cell: XpbdSimplexMeasureFamilyCellContextN) => number);

export interface CompileXpbdSimplexMeasureFamilyNOptions {
  readonly id: string;
  readonly source: CellComplex;
  readonly simplexGroup: CellGroup;
  /** One live particle per source vertex, in source-vertex order. */
  readonly particles: readonly XpbdParticleN[];
  /** Default: squared measure of the source cell at compile time. */
  readonly restSquaredMeasure?: XpbdSimplexMeasureFamilyRestN;
  readonly compliance?: XpbdSimplexMeasureFamilyComplianceN;
}

export interface XpbdSimplexMeasureFamilyCellN
  extends XpbdSimplexMeasureFamilyCellContextN {
  readonly sourceReference: SourceCellReferenceN;
  readonly restSquaredMeasure: number;
  readonly constraint: XpbdSimplexSquaredMeasureConstraintN;
}

/** Source-identified simplex constraints over an existing RN particle binding. */
export class XpbdSimplexMeasureFamilyN {
  readonly id: string;
  readonly dimension: number;
  readonly source: CellComplex;
  readonly sourceSimplexGroup: CellGroup;
  readonly particles: readonly XpbdParticleN[];
  readonly cells: readonly XpbdSimplexMeasureFamilyCellN[];
  readonly constraints: readonly XpbdSimplexSquaredMeasureConstraintN[];
  private attachedWorld: XpbdWorldN | null = null;

  private constructor(
    id: string,
    source: CellComplex,
    simplexGroup: CellGroup,
    particles: readonly XpbdParticleN[],
    cells: XpbdSimplexMeasureFamilyCellN[]
  ) {
    this.id = id;
    this.dimension = source.ambientDim;
    this.source = source;
    this.sourceSimplexGroup = simplexGroup;
    this.particles = Object.freeze([...particles]);
    this.cells = Object.freeze(cells);
    this.constraints = Object.freeze(cells.map((cell) => cell.constraint));
  }

  static compile(
    options: CompileXpbdSimplexMeasureFamilyNOptions
  ): XpbdSimplexMeasureFamilyN {
    validateCompilerInput(options);
    const cells = compileCells(options);
    return new XpbdSimplexMeasureFamilyN(
      options.id,
      options.source,
      options.simplexGroup,
      options.particles,
      cells
    );
  }

  /** Adds only this family's constraints; particles must already belong to the world. */
  addToWorld(world: XpbdWorldN): XpbdWorldN {
    if (!(world instanceof XpbdWorldN)) {
      throw new Error('XpbdSimplexMeasureFamilyN.addToWorld: expected an XpbdWorldN');
    }
    if (world.dimension !== this.dimension) {
      throw new Error(
        `XpbdSimplexMeasureFamilyN.addToWorld: family is R${this.dimension}, world is R${world.dimension}`
      );
    }
    if (this.attachedWorld !== null && this.attachedWorld !== world) {
      throw new Error(
        'XpbdSimplexMeasureFamilyN.addToWorld: family is already attached to another world'
      );
    }
    validateCurrentLineage(this.cells);
    preflightWorldIdentity(world, this.particles, this.constraints);
    for (const constraint of this.constraints) world.addConstraint(constraint);
    this.attachedWorld = world;
    return world;
  }
}

/** Compiles one explicitly selected simplex family over existing particles. */
export function compileXpbdSimplexMeasureFamilyN(
  options: CompileXpbdSimplexMeasureFamilyNOptions
): XpbdSimplexMeasureFamilyN {
  return XpbdSimplexMeasureFamilyN.compile(options);
}

function validateCompilerInput(options: CompileXpbdSimplexMeasureFamilyNOptions): void {
  if (typeof options.id !== 'string' || options.id.trim().length === 0) {
    throw new Error('compileXpbdSimplexMeasureFamilyN: id must be a non-empty string');
  }
  if (!(options.source instanceof CellComplex)) {
    throw new Error('compileXpbdSimplexMeasureFamilyN: source must be a CellComplex');
  }
  const group = options.simplexGroup;
  if (!options.source.groups.includes(group)) {
    throw new Error('compileXpbdSimplexMeasureFamilyN: simplexGroup must belong to source');
  }
  if (!Number.isSafeInteger(group.dim) || group.dim < 1) {
    throw new Error(
      'compileXpbdSimplexMeasureFamilyN: simplexGroup dimension must be a positive integer'
    );
  }
  if (group.dim > options.source.ambientDim) {
    throw new Error(
      'compileXpbdSimplexMeasureFamilyN: simplexGroup dimension exceeds ambient dimension'
    );
  }
  if (group.kind !== 'simplex' || group.verticesPerCell !== group.dim + 1) {
    throw new Error(
      'compileXpbdSimplexMeasureFamilyN: simplexGroup must contain dim + 1 vertex simplices'
    );
  }
  if (group.indices.length === 0 || group.indices.length % group.verticesPerCell !== 0) {
    throw new Error(
      'compileXpbdSimplexMeasureFamilyN: simplexGroup indices must contain complete cells'
    );
  }
  if (
    group.key !== undefined &&
    options.source.groups.filter((candidate) => candidate.key === group.key).length !== 1
  ) {
    throw new Error(
      `compileXpbdSimplexMeasureFamilyN: source group key "${group.key}" is ambiguous`
    );
  }
  if (options.particles.length !== options.source.vertexCount) {
    throw new Error(
      'compileXpbdSimplexMeasureFamilyN: particles must match the source vertex count'
    );
  }
  if (new Set(options.particles).size !== options.particles.length) {
    throw new Error(
      'compileXpbdSimplexMeasureFamilyN: particle identities must be unique'
    );
  }
  const particleIds = new Set<string>();
  for (let index = 0; index < options.particles.length; index++) {
    const particle = options.particles[index];
    if (!(particle instanceof XpbdParticleN)) {
      throw new Error(
        `compileXpbdSimplexMeasureFamilyN: particle ${index} must be an XpbdParticleN`
      );
    }
    if (particle.dimension !== options.source.ambientDim) {
      throw new Error(
        `compileXpbdSimplexMeasureFamilyN: particle ${index} dimension mismatch`
      );
    }
    if (particleIds.has(particle.id)) {
      throw new Error(
        `compileXpbdSimplexMeasureFamilyN: duplicate particle id "${particle.id}"`
      );
    }
    particleIds.add(particle.id);
    assertFiniteParticle(particle, index);
  }
  for (const vertex of group.indices) {
    if (vertex >= options.source.vertexCount) {
      throw new Error(
        `compileXpbdSimplexMeasureFamilyN: source cell vertex ${vertex} is out of range`
      );
    }
  }
}

function compileCells(
  options: CompileXpbdSimplexMeasureFamilyNOptions
): XpbdSimplexMeasureFamilyCellN[] {
  const group = options.simplexGroup;
  const cellCount = group.indices.length / group.verticesPerCell;
  const cells: XpbdSimplexMeasureFamilyCellN[] = [];
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
    const start = cellIndex * group.verticesPerCell;
    const sourceVertexIndices = Object.freeze(
      Array.from(group.indices.subarray(start, start + group.verticesPerCell))
    );
    if (new Set(sourceVertexIndices).size !== sourceVertexIndices.length) {
      throw new Error(
        `compileXpbdSimplexMeasureFamilyN: source cell ${cellIndex} repeats a vertex`
      );
    }
    const sourceReference = createSourceCellReferenceN(
      options.source,
      group,
      cellIndex
    );
    const sourceId = frozenSourceId(createSourceCellIdN(sourceReference));
    const sourceEvaluation = evaluateSimplexSquaredMeasureN(
      sourceVertexIndices.map((vertex) => sourcePosition(options.source, vertex))
    );
    if (!(sourceEvaluation.squaredMeasure > 0)) {
      throw new Error(
        `compileXpbdSimplexMeasureFamilyN: source cell ${cellIndex} is degenerate`
      );
    }
    const context: XpbdSimplexMeasureFamilyCellContextN = Object.freeze({
      sourceCellIndex: cellIndex,
      sourceVertexIndices,
      sourceId,
      simplexDimension: group.dim,
      sourceSquaredMeasure: sourceEvaluation.squaredMeasure
    });
    const restSquaredMeasure = cellScalar(
      options.restSquaredMeasure,
      context,
      sourceEvaluation.squaredMeasure,
      'restSquaredMeasure'
    );
    if (restSquaredMeasure < 0) {
      throw new Error(
        'compileXpbdSimplexMeasureFamilyN: restSquaredMeasure must be non-negative'
      );
    }
    const compliance = cellScalar(options.compliance, context, 0, 'compliance');
    if (compliance < 0) {
      throw new Error(
        'compileXpbdSimplexMeasureFamilyN: compliance must be non-negative'
      );
    }
    const constraint = new XpbdSimplexSquaredMeasureConstraintN({
      id: `${options.id}/simplex/${sourceId.groupKeyKind}/${encodeURIComponent(sourceId.groupKey)}/${cellIndex}`,
      points: sourceVertexIndices.map((vertex) => options.particles[vertex]!),
      restSquaredMeasure,
      compliance
    });
    cells.push(Object.freeze({
      ...context,
      sourceReference,
      restSquaredMeasure,
      constraint
    }));
  }
  return cells;
}

function sourcePosition(source: CellComplex, vertex: number): VecN {
  return new VecN(source.positions.subarray(
    vertex * source.ambientDim,
    (vertex + 1) * source.ambientDim
  ));
}

function cellScalar(
  policy: number | ((cell: XpbdSimplexMeasureFamilyCellContextN) => number) | undefined,
  context: XpbdSimplexMeasureFamilyCellContextN,
  fallback: number,
  label: string
): number {
  const value = typeof policy === 'function' ? policy(context) : (policy ?? fallback);
  if (!Number.isFinite(value)) {
    throw new Error(`compileXpbdSimplexMeasureFamilyN: ${label} must be finite`);
  }
  return value;
}

function assertFiniteParticle(particle: XpbdParticleN, index: number): void {
  if (!Number.isFinite(particle.inverseMass) || particle.inverseMass < 0) {
    throw new Error(
      `compileXpbdSimplexMeasureFamilyN: particle ${index} inverseMass is invalid`
    );
  }
  for (const coordinate of particle.position.data) {
    if (!Number.isFinite(coordinate)) {
      throw new Error(
        `compileXpbdSimplexMeasureFamilyN: particle ${index} position is non-finite`
      );
    }
  }
}

function frozenSourceId(id: SourceCellIdN): SourceCellIdN {
  return Object.freeze({
    ...id,
    vertexIndices: Object.freeze([...id.vertexIndices])
  });
}

function validateCurrentLineage(cells: readonly XpbdSimplexMeasureFamilyCellN[]): void {
  for (const cell of cells) {
    const referenceStatus = inspectSourceCellReferenceN(cell.sourceReference);
    if (referenceStatus.kind !== 'current') {
      throw new Error(
        `XpbdSimplexMeasureFamilyN.addToWorld: source cell ${cell.sourceCellIndex} retired (${referenceStatus.reason})`
      );
    }
    const idStatus = resolveSourceCellIdN(cell.sourceReference.complex, cell.sourceId);
    if (idStatus.kind !== 'resolved') {
      throw new Error(
        `XpbdSimplexMeasureFamilyN.addToWorld: source cell ${cell.sourceCellIndex} id unavailable (${idStatus.reason})`
      );
    }
  }
}

function preflightWorldIdentity(
  world: XpbdWorldN,
  particles: readonly XpbdParticleN[],
  constraints: readonly XpbdSimplexSquaredMeasureConstraintN[]
): void {
  for (const particle of particles) {
    const existing = world.particles.find((candidate) => candidate.id === particle.id);
    if (existing === undefined) {
      throw new Error(
        `XpbdSimplexMeasureFamilyN.addToWorld: particle "${particle.id}" is not registered`
      );
    }
    if (existing !== particle) {
      throw new Error(
        `XpbdSimplexMeasureFamilyN.addToWorld: particle id "${particle.id}" is owned by another object`
      );
    }
  }
  for (const constraint of constraints) {
    const existing = world.constraints.find((candidate) => candidate.id === constraint.id);
    if (existing !== undefined && existing !== constraint) {
      throw new Error(
        `XpbdSimplexMeasureFamilyN.addToWorld: constraint id "${constraint.id}" is already owned`
      );
    }
  }
}
