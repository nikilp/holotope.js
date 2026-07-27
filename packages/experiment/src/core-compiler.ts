import {
  CoordinateProjection,
  HyperplaneSlice4,
  MatN,
  PerspectiveProjection,
  Rotor4,
  TransformN,
  VecN,
  affineSectionMapRecipe4,
  affineSliceChartMapRecipe4,
  createHypercube,
  createRepresentationLineageN,
  projectionMapRecipeN,
  representationLineageCapabilitiesN,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import type {
  ExperimentCompileContextV0,
  ExperimentCompiledPoseV0,
  ExperimentCompiledRepresentationMapV0,
  ExperimentCompiledRepresentationV0,
  ExperimentCompiledSourceV0,
  ExperimentDescriptorCompilerV0
} from './compile.js';
import type {
  ExperimentFailure,
  ExperimentRepresentationDescriptorV0,
  ExperimentResult,
  ExperimentSourceDescriptorV0,
  ExperimentTransformDescriptorV0
} from './types.js';

const ROTOR_UNIT_TOLERANCE = 1e-9;
const MAX_HYPERCUBE_DIM = 30;

/**
 * The headless core capability: the first complete descriptor-to-object
 * vertical.
 *
 * It constructs `core.source.hypercube` and the three closed representation
 * kinds, derives every representation's `RepresentationLineageN` from the
 * object actually built, and refuses everything else with typed evidence.
 * Because this vocabulary constructs only the closed core projection and
 * slice classes, a compiled representation can never carry a
 * `custom-projection` lineage step.
 */
export function coreExperimentCompilerV0(): ExperimentDescriptorCompilerV0 {
  return Object.freeze({
    namespace: 'core',
    kinds: Object.freeze({
      'core.source.hypercube': 0,
      'core.representation.coordinate': 0,
      'core.representation.perspective': 0,
      'core.representation.section4': 0
    }),
    compileSource,
    compileRepresentation
  });
}

function compileSource(
  descriptor: ExperimentSourceDescriptorV0,
  context: ExperimentCompileContextV0
): ExperimentResult<ExperimentCompiledSourceV0> {
  if (descriptor.kind !== 'core.source.hypercube') {
    return refused(failure(
      'capability-unavailable',
      `the core capability does not construct ${JSON.stringify(descriptor.kind)}`,
      `${context.pointer}/kind`,
      { kind: descriptor.kind }
    ));
  }
  if (descriptor.dim > MAX_HYPERCUBE_DIM) {
    return refused(failure(
      'out-of-range',
      `hypercube dim ${descriptor.dim} exceeds the supported maximum ` +
        `${MAX_HYPERCUBE_DIM}`,
      `${context.pointer}/dim`,
      { received: descriptor.dim, maximum: MAX_HYPERCUBE_DIM }
    ));
  }
  if (descriptor.tetrahedralize === true && descriptor.dim < 3) {
    return refused(failure(
      'invalid-value',
      `tetrahedralize requires cuboid 3-cells, which a ${descriptor.dim}-cube ` +
        'does not have',
      `${context.pointer}/tetrahedralize`,
      { dim: descriptor.dim }
    ));
  }
  const complex = createHypercube({
    dim: descriptor.dim,
    size: descriptor.size
  });
  if (descriptor.tetrahedralize === true) {
    tetrahedralizeCuboidCells(complex);
  }
  return {
    ok: true,
    value: Object.freeze({
      category: 'source' as const,
      id: context.id,
      kind: descriptor.kind,
      dim: descriptor.dim,
      complex
    })
  };
}

function compileRepresentation(
  descriptor: ExperimentRepresentationDescriptorV0,
  context: ExperimentCompileContextV0
): ExperimentResult<ExperimentCompiledRepresentationV0> {
  const source = context.resolveSource(descriptor.source);
  if (source === undefined) {
    return refused(failure(
      'missing-reference',
      `source ${JSON.stringify(descriptor.source)} is not a compiled source`,
      `${context.pointer}/source`,
      { id: descriptor.source }
    ));
  }
  const transform = compileTransform(
    descriptor.transform,
    source.dim,
    `${context.pointer}/transform`,
    context
  );
  if (!transform.ok) return transform;

  let map: ExperimentCompiledRepresentationMapV0;
  if (descriptor.kind === 'core.representation.perspective') {
    map = Object.freeze({
      kind: 'projection' as const,
      projection: new PerspectiveProjection({
        fromDim: descriptor.fromDim,
        viewDistance: descriptor.viewDistance,
        ...(descriptor.epsilon !== undefined
          ? { epsilon: descriptor.epsilon }
          : {})
      })
    });
  } else if (descriptor.kind === 'core.representation.coordinate') {
    map = Object.freeze({
      kind: 'projection' as const,
      projection: new CoordinateProjection({
        fromDim: descriptor.fromDim,
        axes: descriptor.retainedAxes
      })
    });
  } else if (descriptor.kind === 'core.representation.section4') {
    map = Object.freeze({
      kind: 'slice4' as const,
      slice: new HyperplaneSlice4({
        normal: descriptor.normal,
        offset: descriptor.offset
      }),
      frame: descriptor.frame
    });
  } else {
    return refused(failure(
      'capability-unavailable',
      `the core capability does not construct ` +
        `${JSON.stringify((descriptor as { kind: string }).kind)}`,
      `${context.pointer}/kind`,
      { kind: (descriptor as { kind: string }).kind }
    ));
  }

  const lineage = map.kind === 'projection'
    ? createRepresentationLineageN(source.dim, [
      projectionMapRecipeN(map.projection)
    ])
    : createRepresentationLineageN(source.dim, [
      affineSectionMapRecipe4(map.slice),
      affineSliceChartMapRecipe4(map.slice)
    ]);

  return {
    ok: true,
    value: Object.freeze({
      category: 'representation' as const,
      id: context.id,
      kind: descriptor.kind,
      source: descriptor.source,
      map,
      pose: transform.value,
      lineage,
      capabilities: representationLineageCapabilitiesN(lineage)
    })
  };
}

function compileTransform(
  descriptor: ExperimentTransformDescriptorV0 | undefined,
  dim: number,
  pointer: string,
  context: ExperimentCompileContextV0
): ExperimentResult<ExperimentCompiledPoseV0> {
  if (descriptor === undefined) {
    return { ok: true, value: { kind: 'static', transform: null } };
  }
  if ('fromModel' in descriptor) {
    // A binding, never a copy: the model owns its pose, and a transform read
    // at compile time would be stale as soon as the model advanced.
    const model = context.resolveModel(descriptor.fromModel);
    if (model === undefined) {
      return refused(failure(
        'missing-reference',
        `model ${JSON.stringify(descriptor.fromModel)} is not a compiled ` +
          'model of this document',
        `${pointer}/fromModel`,
        { fromModel: descriptor.fromModel }
      ));
    }
    return { ok: true, value: { kind: 'model', model: descriptor.fromModel } };
  }
  let rotation: Rotor4 | undefined;
  if (descriptor.rotor4 !== undefined) {
    const rotor = experimentRotor4FromPairV0(descriptor.rotor4, `${pointer}/rotor4`);
    if (!rotor.ok) return rotor;
    rotation = rotor.value;
  }
  const position = descriptor.translation !== undefined
    ? new VecN(descriptor.translation)
    : undefined;
  return {
    ok: true,
    value: { kind: 'static', transform: new TransformN(dim, rotation, position) }
  };
}

/**
 * Reconstructs a Spin(4) rotor from its authored left/right quaternion pair.
 *
 * Components use the core `[x, y, z, w]` scalar-last convention. Each factor
 * must be unit within an absolute tolerance and is then exactly normalized;
 * the sandwich map `p -> l p r` gives the SO(4) matrix, whose
 * `Rotor4.fromMatrix` factorization re-checks orthonormality, determinant,
 * and residual, guarding the convention itself.
 */
export function experimentRotor4FromPairV0(
  pair: readonly number[],
  pointer: string
): ExperimentResult<Rotor4> {
  const left = pair.slice(0, 4);
  const right = pair.slice(4, 8);
  const leftNorm = Math.hypot(...left);
  const rightNorm = Math.hypot(...right);
  if (Math.abs(leftNorm - 1) > ROTOR_UNIT_TOLERANCE ||
    Math.abs(rightNorm - 1) > ROTOR_UNIT_TOLERANCE) {
    return refused(failure(
      'out-of-range',
      'rotor4 factors must be unit quaternions',
      pointer,
      { leftNorm, rightNorm, tolerance: ROTOR_UNIT_TOLERANCE }
    ));
  }
  for (let component = 0; component < 4; component++) {
    left[component]! /= leftNorm;
    right[component]! /= rightNorm;
  }
  const matrix = new MatN(4);
  for (let axis = 0; axis < 4; axis++) {
    const basis = [0, 0, 0, 0];
    basis[axis] = 1;
    const image = quaternionMultiply(quaternionMultiply(left, basis), right);
    for (let row = 0; row < 4; row++) {
      matrix.set(row, axis, image[row]!);
    }
  }
  return { ok: true, value: Rotor4.fromMatrix(matrix) };
}

/** Hamilton product in the core scalar-last `[x, y, z, w]` layout. */
function quaternionMultiply(
  a: readonly number[],
  b: readonly number[]
): readonly number[] {
  const [a0, a1, a2, a3] = a as readonly [number, number, number, number];
  const [b0, b1, b2, b3] = b as readonly [number, number, number, number];
  return [
    a3 * b0 + a0 * b3 + a1 * b2 - a2 * b1,
    a3 * b1 + a1 * b3 + a2 * b0 - a0 * b2,
    a3 * b2 + a2 * b3 + a0 * b1 - a1 * b0,
    a3 * b3 - a0 * b0 - a1 * b1 - a2 * b2
  ];
}

function failure(
  code: ExperimentFailure['code'],
  message: string,
  pointer?: string,
  detail?: ExperimentFailure['detail']
): ExperimentFailure {
  return Object.freeze({
    code,
    message,
    ...(pointer !== undefined ? { pointer } : {}),
    ...(detail !== undefined ? { detail: Object.freeze({ ...detail }) } : {})
  });
}

function refused(...failures: ExperimentFailure[]): ExperimentResult<never> {
  return { ok: false, failures: Object.freeze(failures) };
}
