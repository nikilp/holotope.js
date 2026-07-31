/**
 * The flagship's scenario, declared once and compiled from public packages.
 *
 * This module is DOM-free on purpose. Everything the dimension bridge is —
 * which body is authoritative, how it moves, and what three maps observe it —
 * is a typed `ExperimentDocumentV0` here, so it can be tested headlessly and
 * read without opening the page.
 *
 * The page used to build the same scenario privately: a size-2 cube whose
 * positions were multiplied by four scale factors, mass derived by hand, the
 * geometry rebased, a body and world constructed directly, and the three maps
 * rebuilt beside them. Every one of those steps is now a line of the document,
 * which is the point — the example should consume the architecture it explains.
 */
import {
  compileExperimentDocumentV0,
  coreExperimentCompilerV0,
  prepareExperimentDocumentV0,
  type ExperimentCompilationV0,
  type ExperimentCompiledModelV0,
  type ExperimentCompiledRepresentationV0,
  type ExperimentCompiledSourceV0,
  type ExperimentDocumentV0,
  type ExperimentSnapshotV0
} from '@holotope/experiment';
import {
  physicsExperimentCompilerV0,
  type ExperimentRigidModel4RuntimeV0
} from '@holotope/experiment-physics';

/**
 * The authored body.
 *
 * These are the full edge lengths the page produced before: a size-2 cube
 * scaled by `[1.35, 0.92, 0.66, 0.43]`. Declaring them directly makes the
 * shape an exact source rather than a cube plus an undisclosed deformation,
 * and the four distinct lengths give the rigid body non-isotropic inertia so
 * hidden-axis motion is visually distinguishable.
 */
export const BRIDGE_EDGE_LENGTHS = [2.7, 1.84, 1.32, 0.86] as const;

/** Registry ids, exported so the page and its tests agree on them. */
export const BRIDGE_IDS = Object.freeze({
  source: 'body',
  model: 'tumble',
  perspective: 'perspective',
  coordinate: 'coordinate',
  section: 'section',
  sliceOffset: 'sliceOffset'
});

export const DIMENSION_BRIDGE_DOCUMENT = {
  schema: 'holotope.experiment/0',
  title: 'Dimension bridge',
  ambientDim: 4,
  sources: {
    body: {
      kind: 'core.source.hyperrectangle',
      dim: 4,
      edgeLengths: [...BRIDGE_EDGE_LENGTHS],
      // Sections cut tetrahedra, and R4 mass integration needs the same
      // simplex boundary.
      tetrahedralize: true
    }
  },
  models: {
    tumble: {
      kind: 'physics.model.rigid4',
      source: 'body',
      // Several planes at once, so the motion is a genuine R4 tumble rather
      // than a rotation that happens to be visible in three of the axes.
      initialAngularMomentum: [0.42, 0.16, 0, 0.88, -0.31, 0],
      fixedStep: 1 / 120,
      substeps: 2
    }
  },
  representations: {
    perspective: {
      kind: 'core.representation.perspective',
      source: 'body',
      fromDim: 4,
      viewDistance: 5.4,
      transform: { fromModel: 'tumble' },
      product: 'both'
    },
    coordinate: {
      kind: 'core.representation.coordinate',
      source: 'body',
      fromDim: 4,
      retainedAxes: [0, 1, 3],
      transform: { fromModel: 'tumble' },
      product: 'both'
    },
    section: {
      kind: 'core.representation.section4',
      source: 'body',
      normal: [0, 0, 0, 1],
      offset: 0.12,
      frame: 'canonical',
      transform: { fromModel: 'tumble' }
    }
  },
  parameters: [
    {
      id: 'sliceOffset',
      label: 'Slice offset',
      value: { type: 'number', default: 0.12, min: -1.6, max: 1.6, step: 0.01 },
      dimension: 'length',
      frame: { space: 'ambient', dim: 4 },
      unit: 'm',
      // The slider writes through this rather than touching the slice object,
      // so the document clock and revision stay coherent with the change.
      target: { kind: 'representation-field', ref: 'section', field: 'offset' }
    }
  ]
} satisfies ExperimentDocumentV0;

/** Everything the page needs, each narrowed to its public type. */
export interface CompiledDimensionBridge {
  readonly compilation: ExperimentCompilationV0;
  readonly source: ExperimentCompiledSourceV0;
  readonly model: ExperimentCompiledModelV0;
  readonly runtime: ExperimentRigidModel4RuntimeV0;
  readonly perspective: ExperimentCompiledRepresentationV0;
  readonly coordinate: ExperimentCompiledRepresentationV0;
  readonly section: ExperimentCompiledRepresentationV0;
  /** Captured immediately after compilation, so reset is a restore. */
  readonly initialSnapshot: ExperimentSnapshotV0;
}

/** Fetches a registry entry and proves its category before returning it. */
function sourceEntry(
  compilation: ExperimentCompilationV0,
  id: string
): ExperimentCompiledSourceV0 {
  const entry = compilation.get(id);
  if (!entry.ok || entry.value.category !== 'source') {
    throw new Error(`dimension bridge: ${id} is not a compiled source`);
  }
  return entry.value;
}

function modelEntry(
  compilation: ExperimentCompilationV0,
  id: string
): ExperimentCompiledModelV0 {
  const entry = compilation.get(id);
  if (!entry.ok || entry.value.category !== 'model') {
    throw new Error(`dimension bridge: ${id} is not a compiled model`);
  }
  return entry.value;
}

function representationEntry(
  compilation: ExperimentCompilationV0,
  id: string
): ExperimentCompiledRepresentationV0 {
  const entry = compilation.get(id);
  if (!entry.ok || entry.value.category !== 'representation') {
    throw new Error(`dimension bridge: ${id} is not a compiled representation`);
  }
  return entry.value;
}

/**
 * Prepares and compiles the document with exactly the two public capabilities.
 *
 * Refusals are thrown rather than returned: this is a demonstration scenario
 * whose document is a compile-time constant, so a failure here is a defect in
 * the example and not a condition a caller could handle.
 */
export async function compileDimensionBridgeDocument(): Promise<CompiledDimensionBridge> {
  const prepared = await prepareExperimentDocumentV0(DIMENSION_BRIDGE_DOCUMENT);
  if (!prepared.ok) {
    throw new Error(`dimension bridge document: ${JSON.stringify(prepared.failures)}`);
  }
  const compiled = compileExperimentDocumentV0(prepared.value, {
    compilers: [coreExperimentCompilerV0(), physicsExperimentCompilerV0()]
  });
  if (!compiled.ok) {
    throw new Error(`dimension bridge compile: ${JSON.stringify(compiled.failures)}`);
  }
  const compilation = compiled.value;

  const model = modelEntry(compilation, BRIDGE_IDS.model);
  const snapshot = compilation.snapshot();
  if (!snapshot.ok) {
    throw new Error(`dimension bridge snapshot: ${JSON.stringify(snapshot.failures)}`);
  }

  return {
    compilation,
    source: sourceEntry(compilation, BRIDGE_IDS.source),
    model,
    runtime: model.runtime as ExperimentRigidModel4RuntimeV0,
    perspective: representationEntry(compilation, BRIDGE_IDS.perspective),
    coordinate: representationEntry(compilation, BRIDGE_IDS.coordinate),
    section: representationEntry(compilation, BRIDGE_IDS.section),
    initialSnapshot: snapshot.value
  };
}

/**
 * The transform a representation's source is currently posed by.
 *
 * A representation either carries a static transform or borrows a model's
 * pose. These few lines are the whole of it, and they stay in the example
 * rather than becoming a public helper: one consumer is not evidence for an
 * API.
 */
export function poseForRepresentation(
  compilation: ExperimentCompilationV0,
  representation: ExperimentCompiledRepresentationV0
): ReturnType<ExperimentCompiledModelV0['pose']> | undefined {
  if (representation.pose.kind === 'static') {
    return representation.pose.transform ?? undefined;
  }
  const entry = compilation.get(representation.pose.model);
  return entry.ok && entry.value.category === 'model' ? entry.value.pose() : undefined;
}
