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
  ExperimentJsonValue,
  ExperimentModelDescriptorV0,
  ExperimentModelStateV0,
  ExperimentResult
} from '@holotope/experiment';

/** Captured field order for a rigid4 model; a change here is a layout change. */
const LAYOUT: readonly { readonly field: string; readonly length: number }[] =
  Object.freeze([
    Object.freeze({ field: 'position', length: 4 }),
    Object.freeze({ field: 'rotationLeft', length: 4 }),
    Object.freeze({ field: 'rotationRight', length: 4 }),
    Object.freeze({ field: 'linearVelocity', length: 4 }),
    Object.freeze({ field: 'angularMomentumWorld', length: 6 }),
    Object.freeze({ field: 'force', length: 4 }),
    Object.freeze({ field: 'torque', length: 6 }),
    Object.freeze({ field: 'gravityScale', length: 1 }),
    Object.freeze({ field: 'worldGravity', length: 4 }),
    Object.freeze({ field: 'substeps', length: 1 })
  ]);

const LAYOUT_SHAPE = LAYOUT.map((field) => `${field.field}:${field.length}`).join(',');

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
 * const prepared = await prepareExperimentDocumentV0(document);
 * if (!prepared.ok) return;
 *
 * const compiled = compileExperimentDocumentV0(prepared.value, {
 *   compilers: [coreExperimentCompilerV0(), physicsExperimentCompilerV0()]
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
  let substeps = descriptor.substeps ?? 1;
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

  // `substeps` is the current value advanceModel consumes, so it is a getter
  // rather than a frozen copy: a parameter changing it must be visible here.
  const runtime: ExperimentRigidModel4RuntimeV0 = Object.freeze({
    world,
    body,
    massProperties,
    referencePose,
    fixedStep,
    get substeps(): number {
      return substeps;
    }
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
      applyModelField(
        field: string,
        value: ExperimentJsonValue
      ): ExperimentResult<{ readonly previous: ExperimentJsonValue }> {
        if (field === 'gravity') {
          const components = value as readonly number[];
          const previous = Object.freeze([...world.gravity.data]);
          for (let axis = 0; axis < 4; axis++) {
            world.gravity.data[axis] = components[axis]!;
          }
          return { ok: true, value: { previous } };
        }
        if (field === 'substeps') {
          const requested = value as number;
          if (!Number.isSafeInteger(requested) || requested < 1) {
            return refused(failure(
              'out-of-range',
              'substeps must be a positive safe integer',
              '',
              { value: requested }
            ));
          }
          const previous = substeps;
          substeps = requested;
          return { ok: true, value: { previous } };
        }
        return refused(failure(
          'capability-unavailable',
          `physics.model.rigid4 exposes no writable field ${JSON.stringify(field)}`,
          '',
          { field }
        ));
      },
      observeModel(quantity: string): ExperimentResult<ExperimentJsonValue> {
        switch (quantity) {
          case 'angular-momentum':
            return { ok: true, value: Object.freeze([...body.angularMomentumWorld.coeffs]) };
          case 'kinetic-energy':
            return { ok: true, value: body.kineticEnergy() };
          case 'rotor-orthonormality': {
            const left = Math.hypot(...body.rotation.left);
            const right = Math.hypot(...body.rotation.right);
            return {
              ok: true,
              value: Math.max(Math.abs(left - 1), Math.abs(right - 1))
            };
          }
          case 'position':
            // The model pose translation, not the raw body position: the two
            // coincide only when the source is already centred and principal.
            return {
              ok: true,
              value: Object.freeze([
                ...new TransformN(4, body.rotation, body.position)
                  .compose(inverseReference).position.data
              ])
            };
          default:
            return refused(failure(
              'capability-unavailable',
              `physics.model.rigid4 does not observe ${JSON.stringify(quantity)}`,
              '',
              { quantity }
            ));
        }
      },
      captureModelState(): ExperimentResult<ExperimentModelStateV0> {
        const values = Float64Array.from([
          ...body.position.data,
          ...body.rotation.left,
          ...body.rotation.right,
          ...body.linearVelocity.data,
          ...body.angularMomentumWorld.coeffs,
          ...body.force.data,
          ...body.torque.coeffs,
          body.gravityScale,
          ...world.gravity.data,
          substeps
        ]);
        return {
          ok: true,
          value: {
            kind: descriptor.kind,
            modelStep,
            layout: LAYOUT,
            values
          }
        };
      },
      restoreModelState(
        state: ExperimentModelStateV0
      ): ExperimentResult<{ readonly modelStep: number }> {
        if (state.kind !== descriptor.kind) {
          return refused(failure(
            'invalid-value',
            `state was captured from ${JSON.stringify(state.kind)}`,
            '', { expected: descriptor.kind, received: String(state.kind) }
          ));
        }
        const shape = state.layout.map((field) => `${field.field}:${field.length}`).join(',');
        if (shape !== LAYOUT_SHAPE) {
          return refused(failure(
            'invalid-value',
            'state layout does not match physics.model.rigid4',
            '', { expected: LAYOUT_SHAPE, received: shape }
          ));
        }
        // Written exactly as captured. The rotor pair is not renormalized:
        // a bitwise round trip is the contract, and a silent correction here
        // would be indistinguishable from the snapshot having been wrong.
        let at = 0;
        const take = (into: { [index: number]: number }, count: number): void => {
          for (let index = 0; index < count; index++) into[index] = state.values[at++]!;
        };
        take(body.position.data, 4);
        take(body.rotation.left, 4);
        take(body.rotation.right, 4);
        take(body.linearVelocity.data, 4);
        take(body.angularMomentumWorld.coeffs, 6);
        take(body.force.data, 4);
        take(body.torque.coeffs, 6);
        body.gravityScale = state.values[at++]!;
        take(world.gravity.data, 4);
        substeps = state.values[at++]!;
        modelStep = state.modelStep;
        return { ok: true, value: { modelStep } };
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
