import {
  CellComplex,
  VecN,
  createSourceCellIdN,
  createSourceCellReferenceN,
  type CellGroup,
  type SourceCellIdN,
  type SourceCellReferenceN
} from '@holotope/core';
import { evaluateSimplexSquaredMeasureN } from './xpbd-simplex-measure.js';

export interface SimplexMassElementContextN {
  readonly sourceCellIndex: number;
  readonly sourceVertexIndices: readonly number[];
  readonly sourceId: SourceCellIdN;
  readonly simplexDimension: number;
  readonly restMeasure: number;
}

export type SimplexMassDensityN =
  | number
  | ((element: SimplexMassElementContextN) => number);

export interface LumpSimplexMassesNOptions {
  readonly source: CellComplex;
  readonly simplexGroup: CellGroup;
  readonly density: SimplexMassDensityN;
}

export interface SimplexLumpedMassElementN extends SimplexMassElementContextN {
  readonly sourceReference: SourceCellReferenceN;
  readonly density: number;
  readonly mass: number;
  readonly vertexMassShare: number;
}

export interface SimplexLumpedMassesN {
  readonly dimension: number;
  readonly simplexDimension: number;
  readonly source: CellComplex;
  readonly sourceSimplexGroup: CellGroup;
  readonly elements: readonly SimplexLumpedMassElementN[];
  readonly vertexMasses: Float64Array;
  readonly totalElementMass: number;
  readonly totalVertexMass: number;
  readonly massResidual: number;
  readonly unusedVertexCount: number;
}

/** Equal-vertex lumping of density times intrinsic simplex rest measure. */
export function lumpSimplexMassesN(
  options: LumpSimplexMassesNOptions
): SimplexLumpedMassesN {
  validateOptions(options);
  const group = options.simplexGroup;
  const vertexMasses = new Float64Array(options.source.vertexCount);
  const elements: SimplexLumpedMassElementN[] = [];
  let totalElementMass = 0;
  const cellCount = group.indices.length / group.verticesPerCell;

  for (let sourceCellIndex = 0; sourceCellIndex < cellCount; sourceCellIndex++) {
    const start = sourceCellIndex * group.verticesPerCell;
    const sourceVertexIndices = Object.freeze(Array.from(
      group.indices.subarray(start, start + group.verticesPerCell)
    ));
    if (new Set(sourceVertexIndices).size !== sourceVertexIndices.length) {
      throw new Error(
        `lumpSimplexMassesN: source cell ${sourceCellIndex} repeats a vertex`
      );
    }
    const restPositions = sourceVertexIndices.map(
      (vertex) => sourcePosition(options.source, vertex)
    );
    const restMeasure = evaluateSimplexSquaredMeasureN(restPositions).measure;
    if (!(restMeasure > 0)) {
      throw new Error(
        `lumpSimplexMassesN: source cell ${sourceCellIndex} is degenerate`
      );
    }
    const sourceReference = createSourceCellReferenceN(
      options.source,
      group,
      sourceCellIndex
    );
    const sourceId = frozenSourceId(createSourceCellIdN(sourceReference));
    const context: SimplexMassElementContextN = Object.freeze({
      sourceCellIndex,
      sourceVertexIndices,
      sourceId,
      simplexDimension: group.dim,
      restMeasure
    });
    const density = typeof options.density === 'function'
      ? options.density(context)
      : options.density;
    if (!(density > 0) || !Number.isFinite(density)) {
      throw new Error('lumpSimplexMassesN: density must be finite and positive');
    }
    const mass = density * restMeasure;
    const vertexMassShare = mass / group.verticesPerCell;
    if (!Number.isFinite(mass) || !Number.isFinite(vertexMassShare)) {
      throw new Error('lumpSimplexMassesN: mass is outside the Float64 range');
    }
    totalElementMass += mass;
    if (!Number.isFinite(totalElementMass)) {
      throw new Error('lumpSimplexMassesN: total mass is outside the Float64 range');
    }
    for (const vertex of sourceVertexIndices) {
      vertexMasses[vertex]! += vertexMassShare;
      if (!Number.isFinite(vertexMasses[vertex])) {
        throw new Error(
          'lumpSimplexMassesN: vertex mass is outside the Float64 range'
        );
      }
    }
    elements.push(Object.freeze({
      ...context,
      sourceReference,
      density,
      mass,
      vertexMassShare
    }));
  }

  let totalVertexMass = 0;
  let unusedVertexCount = 0;
  for (const mass of vertexMasses) {
    totalVertexMass += mass;
    if (mass === 0) unusedVertexCount++;
  }
  if (!Number.isFinite(totalVertexMass)) {
    throw new Error('lumpSimplexMassesN: total vertex mass is outside the Float64 range');
  }
  return Object.freeze({
    dimension: options.source.ambientDim,
    simplexDimension: group.dim,
    source: options.source,
    sourceSimplexGroup: group,
    elements: Object.freeze(elements),
    vertexMasses,
    totalElementMass,
    totalVertexMass,
    massResidual: totalVertexMass - totalElementMass,
    unusedVertexCount
  });
}

function validateOptions(options: LumpSimplexMassesNOptions): void {
  if (!(options.source instanceof CellComplex)) {
    throw new Error('lumpSimplexMassesN: source must be a CellComplex');
  }
  const group = options.simplexGroup;
  if (!options.source.groups.includes(group)) {
    throw new Error('lumpSimplexMassesN: simplexGroup must belong to source');
  }
  if (!Number.isSafeInteger(group.dim) || group.dim < 1) {
    throw new Error('lumpSimplexMassesN: simplex dimension must be positive');
  }
  if (group.dim > options.source.ambientDim) {
    throw new Error('lumpSimplexMassesN: simplex dimension exceeds ambient dimension');
  }
  if (group.kind !== 'simplex' || group.verticesPerCell !== group.dim + 1) {
    throw new Error(
      'lumpSimplexMassesN: simplexGroup must contain dim + 1 vertex simplices'
    );
  }
  if (group.indices.length === 0 || group.indices.length % group.verticesPerCell !== 0) {
    throw new Error('lumpSimplexMassesN: indices must contain complete simplex cells');
  }
  if (
    group.key !== undefined &&
    options.source.groups.filter((candidate) => candidate.key === group.key).length !== 1
  ) {
    throw new Error(`lumpSimplexMassesN: source group key "${group.key}" is ambiguous`);
  }
  for (const vertex of group.indices) {
    if (vertex >= options.source.vertexCount) {
      throw new Error(`lumpSimplexMassesN: source cell vertex ${vertex} is out of range`);
    }
  }
  if (
    typeof options.density !== 'function' &&
    (!(options.density > 0) || !Number.isFinite(options.density))
  ) {
    throw new Error('lumpSimplexMassesN: density must be finite and positive');
  }
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
