/**
 * Physics model capability for experiment documents.
 *
 * A thin adapter, deliberately its own package: `@holotope/experiment` stays
 * core-only, and a `@holotope/physics` subpath would give every physics
 * consumer an experiment dependency it never asked for. Nothing here is
 * mathematics — construction and stepping belong to `@holotope/physics`, and
 * this only maps a descriptor onto them.
 */
import { BivectorN, TransformN, VecN, type Rotor4 } from '@holotope/core';
import {
  PhysicsWorld4,
  RigidBody4,
  massPropertiesFromCellComplex4,
  type MassProperties4
} from '@holotope/physics';
import { experimentRotor4FromPairV0 } from '@holotope/experiment';
import type {
  ExperimentCompileContextV0,
  ExperimentCompiledModelV0,
  ExperimentDescriptorCompilerV0,
  ExperimentFailure,
  ExperimentModelDescriptorV0,
  ExperimentResult
} from '@holotope/experiment';

/** Live objects a compiled `physics.model.rigid4` owns. */
export interface ExperimentRigidModel4RuntimeV0 {
  /** One world per model; v0 declares no cross-model contact. */
  readonly world: PhysicsWorld4;
  /** The single rigid body this model advances. */
  readonly body: RigidBody4;
  /** Mass, principal inertia, and centre of mass derived from the source. */
  readonly massProperties: MassProperties4;
  /**
   * The body pose at compile time, frozen.
   *
   * Dynamics run in the principal frame, so the body starts at the centre of
   * mass under the principal rotor. Source geometry, however, is authored in
   * world coordinates, which is what sections and projections already read.
   * Dividing the body pose by this reference is what makes the model pose
   * identity at step zero rather than the body's own frame.
   */
  readonly referencePose: TransformN;
  /** Deterministic simulation step duration in seconds. */
  readonly fixedStep: number;
  /** Whole-number solver subdivisions within each fixed step. */
  readonly substeps: number;
}

/**
 * Builds the capability that compiles `physics.model.rigid4` descriptors.
 *
 * Supply it beside `coreExperimentCompilerV0()` to compile a document whose
 * representations follow a model pose. It claims exactly one kind and
 * supplies only a model constructor, so it can never be mistaken for serving
 * a category it does not implement.
 *
 * @returns A capability value; documents can never name or load one.
 *
 * @example
 * ```ts
 * const compiled = compileExperimentDocumentV0({
 *   prepared,
 *   capabilities: [coreExperimentCompilerV0(), physicsExperimentCompilerV0()]
 * });
 * ```
 */
export function physicsExperimentCompilerV0(): ExperimentDescriptorCompilerV0 {
  return Object.freeze({
    namespace: 'physics',
    kinds: Object.freeze({ 'physics.model.rigid4': 0 }),
    compileModel
  });
}

function compileModel(
  descriptor: ExperimentModelDescriptorV0,
  context: ExperimentCompileContextV0
): ExperimentResult<ExperimentCompiledModelV0> {
  const source = context.resolveSource(descriptor.source);
  if (source === undefined) {
    return refused(failure(
      'missing-reference',
      `source ${JSON.stringify(descriptor.source)} is not a compiled source ` +
        'of this document',
      `${context.pointer}/source`,
      { id: descriptor.source }
    ));
  }
  if (source.dim !== 4) {
    return refused(failure(
      'invalid-value',
      `physics.model.rigid4 requires an R4 source, ${JSON.stringify(descriptor.source)} is R${source.dim}`,
      `${context.pointer}/source`,
      { id: descriptor.source, dim: source.dim }
    ));
  }

  let massProperties: MassProperties4;
  try {
    massProperties = massPropertiesFromCellComplex4(source.complex);
  } catch (error) {
    // Mass shape is integrated over simplex 3-cells, so a source compiled
    // without tetrahedralization has nothing to integrate. That is an
    // authoring mistake in the document, not a defect, so it is a typed
    // refusal naming the requirement rather than a thrown error.
    return refused(failure(
      'invalid-value',
      `physics.model.rigid4 requires a source with simplex 3-cells; compile ` +
        `${JSON.stringify(descriptor.source)} with tetrahedralize: true ` +
        `(${error instanceof Error ? error.message : String(error)})`,
      `${context.pointer}/source`,
      { id: descriptor.source }
    ));
  }

  let initialRotor: Rotor4 | undefined;
  if (descriptor.initialRotor4 !== undefined) {
    const rotor = experimentRotor4FromPairV0(
      descriptor.initialRotor4,
      `${context.pointer}/initialRotor4`
    );
    if (!rotor.ok) return rotor;
    initialRotor = rotor.value;
  }

  const fixedStep = descriptor.fixedStep;
  const substeps = descriptor.substeps ?? 1;
  const world = new PhysicsWorld4({
    gravity: new VecN(descriptor.gravity ?? [0, 0, 0, 0])
  });

  // The reference pose is the body's own starting frame. An authored rotor
  // turns the whole configuration about the origin, which leaves the model
  // pose at step zero equal to that rotor exactly.
  const referencePose = new TransformN(
    4,
    massProperties.principalRotor,
    massProperties.centerOfMass
  );
  const body = RigidBody4.fromMassProperties(massProperties, {
    ...(initialRotor === undefined
      ? {}
      : {
        rotation: initialRotor.multiply(massProperties.principalRotor),
        position: initialRotor.applyToPoint(massProperties.centerOfMass)
      }),
    ...(descriptor.initialAngularMomentum === undefined
      ? {}
      : { angularMomentumWorld: new BivectorN(4, descriptor.initialAngularMomentum) })
  });
  world.addBody(body);

  const runtime: ExperimentRigidModel4RuntimeV0 = Object.freeze({
    world,
    body,
    massProperties,
    referencePose,
    fixedStep,
    substeps
  });

  let modelStep = 0;
  const inverseReference = referencePose.inverse();

  return {
    ok: true,
    value: Object.freeze({
      category: 'model' as const,
      id: context.id,
      kind: descriptor.kind,
      source: descriptor.source,
      runtime,
      pose(): TransformN {
        // Motion relative to where the geometry was authored, not the body's
        // principal frame — a fresh copy each time, so a caller mutating one
        // cannot reach the model.
        return new TransformN(4, body.rotation, body.position)
          .compose(inverseReference);
      },
      advanceModel(steps: number): ExperimentResult<{ readonly modelStep: number }> {
        if (typeof steps !== 'number' || !Number.isSafeInteger(steps) || steps <= 0) {
          return refused(failure(
            'invalid-value',
            'advanceModel requires a positive safe integer number of steps',
            '',
            { steps }
          ));
        }
        for (let index = 0; index < steps; index++) {
          world.step(fixedStep, substeps);
        }
        modelStep += steps;
        return { ok: true, value: { modelStep } };
      }
    })
  };
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
