import {
  validationLimitsV0
} from './json.js';
import type {
  ExperimentActionDeclarationV0,
  ExperimentBackendRequirementV0,
  ExperimentDocumentV0,
  ExperimentFailure,
  ExperimentFrameV0,
  ExperimentJsonSchemaV0,
  ExperimentModelDescriptorV0,
  ExperimentObservationDeclarationV0,
  ExperimentPaneDescriptorV0,
  ExperimentParameterDeclarationV0,
  ExperimentRepresentationDescriptorV0,
  ExperimentSourceDescriptorV0,
  ExperimentTransformDescriptorV0,
  ExperimentValidationLimitsV0,
  ExperimentValidationReportV0
} from './types.js';

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** Options for bounded non-mutating document validation. */
export interface ValidateExperimentDocumentV0Options {
  /** Overrides conservative resource limits. */
  readonly limits?: Partial<ExperimentValidationLimitsV0>;
}

/**
 * Validates one retained JSON-compatible experiment value without mutation.
 *
 * This function operates after parsing and therefore cannot detect duplicate
 * keys that a host parser already discarded. Use `parseExperimentJsonV0()`
 * when duplicate-key evidence matters.
 */
export function validateExperimentDocumentV0(
  value: unknown,
  options: ValidateExperimentDocumentV0Options = {}
): ExperimentValidationReportV0 {
  const validator = new ExperimentDocumentValidator(
    validationLimitsV0(options.limits)
  );
  return validator.validate(value);
}

class ExperimentDocumentValidator {
  private readonly failures: ExperimentFailure[] = [];
  private readonly warnings: ExperimentFailure[] = [];
  private entries = 0;
  private readonly globalIds = new Map<string, string>();
  private readonly sourceDimensions = new Map<string, number>();
  private readonly modelDescriptors =
    new Map<string, ExperimentModelDescriptorV0>();
  private readonly representationDescriptors =
    new Map<string, ExperimentRepresentationDescriptorV0>();
  private readonly dependencies = new Map<string, Set<string>>();
  private resourceExhausted = false;
  private accessorEncountered = false;

  constructor(
    private readonly limits: ExperimentValidationLimitsV0
  ) {}

  validate(value: unknown): ExperimentValidationReportV0 {
    this.inspectJsonValue(value, '', 0, new Set<object>());
    if (this.resourceExhausted || this.accessorEncountered) {
      return Object.freeze({
        valid: false,
        failures: Object.freeze([...this.failures]),
        warnings: Object.freeze([...this.warnings]),
        compileOrder: Object.freeze([])
      });
    }
    const root = this.object(
      value,
      '',
      [
        'schema',
        'title',
        'ambientDim',
        'sources',
        'representations',
        'models',
        'parameters',
        'actions',
        'observations',
        'presentation',
        'backends'
      ],
      ['schema', 'title', 'ambientDim', 'sources', 'representations']
    );
    if (root !== null) this.validateDocument(root);
    const candidateOrder = this.topologicalOrder();
    const compileOrder = this.failures.length === 0
      ? candidateOrder
      : [];
    return Object.freeze({
      valid: this.failures.length === 0,
      failures: Object.freeze([...this.failures]),
      warnings: Object.freeze([...this.warnings]),
      compileOrder: Object.freeze(compileOrder)
    });
  }

  private validateDocument(root: Record<string, unknown>): void {
    const schema = this.string(root.schema, '/schema');
    if (schema !== null && schema !== 'holotope.experiment/0') {
      this.add(
        'schema-version-unsupported',
        `unsupported experiment schema ${JSON.stringify(schema)}`,
        '/schema',
        { received: schema, supported: 'holotope.experiment/0' }
      );
    }
    this.nonEmptyString(root.title, '/title');
    const ambientDim = this.positiveInteger(root.ambientDim, '/ambientDim');
    const sources = this.record(root.sources, '/sources');
    const representations = this.record(
      root.representations,
      '/representations'
    );
    const models = root.models === undefined
      ? {}
      : this.record(root.models, '/models');

    if (sources !== null) {
      if (Object.keys(sources).length === 0) {
        this.add(
          'invalid-value',
          'an experiment must declare at least one source',
          '/sources'
        );
      }
      for (const id of Object.keys(sources).sort()) {
        const pointer = `/sources/${escapePointer(id)}`;
        this.registerId(id, pointer);
        const failureCount = this.failures.length;
        const descriptor = this.validateSourceDescriptor(
          sources[id],
          pointer,
          ambientDim
        );
        if (descriptor !== null && this.failures.length === failureCount) {
          this.sourceDimensions.set(
            id,
            sourceDimension(descriptor)
          );
          this.dependencies.set(id, new Set());
        }
      }
    }

    if (models !== null) {
      for (const id of Object.keys(models).sort()) {
        const pointer = `/models/${escapePointer(id)}`;
        this.registerId(id, pointer);
        const failureCount = this.failures.length;
        const descriptor = this.validateModelDescriptor(
          models[id],
          pointer
        );
        if (descriptor !== null && this.failures.length === failureCount) {
          this.modelDescriptors.set(id, descriptor);
          this.dependencies.set(id, new Set([descriptor.source]));
        }
      }
    }

    if (representations !== null) {
      if (Object.keys(representations).length === 0) {
        this.add(
          'invalid-value',
          'an experiment must declare at least one representation',
          '/representations'
        );
      }
      for (const id of Object.keys(representations).sort()) {
        const pointer = `/representations/${escapePointer(id)}`;
        this.registerId(id, pointer);
        const failureCount = this.failures.length;
        const descriptor = this.validateRepresentationDescriptor(
          representations[id],
          pointer
        );
        if (descriptor !== null && this.failures.length === failureCount) {
          this.representationDescriptors.set(id, descriptor);
          const dependencies = new Set<string>([descriptor.source]);
          const model = modelReference(descriptor.transform);
          if (model !== null) dependencies.add(model);
          this.dependencies.set(id, dependencies);
        }
      }
    }

    this.validateModelReferences();
    this.validateRepresentationReferences();

    this.validatePresentation(root.presentation, '/presentation');
    this.validateDeclarationArray(
      root.parameters,
      '/parameters',
      (entry, pointer) => this.validateParameter(entry, pointer)
    );
    this.validateDeclarationArray(
      root.actions,
      '/actions',
      (entry, pointer) => this.validateAction(entry, pointer)
    );
    this.validateDeclarationArray(
      root.observations,
      '/observations',
      (entry, pointer) => this.validateObservation(entry, pointer)
    );
    this.validateBackends(root.backends, '/backends');
  }

  private validateSourceDescriptor(
    value: unknown,
    pointer: string,
    ambientDim: number | null
  ): ExperimentSourceDescriptorV0 | null {
    const kind = descriptorKind(value);
    if (kind === 'core.source.hypercube') {
      const object = this.object(
        value,
        pointer,
        ['kind', 'kindVersion', 'dim', 'size', 'tetrahedralize'],
        ['kind', 'dim', 'size']
      );
      if (object === null) return null;
      this.kindVersion(object.kindVersion, `${pointer}/kindVersion`);
      const dim = this.positiveInteger(object.dim, `${pointer}/dim`);
      this.positiveNumber(object.size, `${pointer}/size`);
      if (object.tetrahedralize !== undefined) {
        this.boolean(object.tetrahedralize, `${pointer}/tetrahedralize`);
      }
      if (dim !== null && ambientDim !== null && dim !== ambientDim) {
        this.dimensionMismatch(
          `${pointer}/dim`,
          dim,
          ambientDim,
          'source dimension must equal document ambientDim'
        );
      }
      return object as unknown as ExperimentSourceDescriptorV0;
    }
    if (kind === 'core.source.hyperrectangle') {
      const object = this.object(
        value,
        pointer,
        ['kind', 'kindVersion', 'dim', 'edgeLengths', 'tetrahedralize'],
        ['kind', 'dim', 'edgeLengths']
      );
      if (object === null) return null;
      this.kindVersion(object.kindVersion, `${pointer}/kindVersion`);
      const dim = this.positiveInteger(object.dim, `${pointer}/dim`);
      this.edgeLengths(object.edgeLengths, `${pointer}/edgeLengths`, dim);
      if (object.tetrahedralize !== undefined) {
        this.boolean(object.tetrahedralize, `${pointer}/tetrahedralize`);
      }
      if (dim !== null && ambientDim !== null && dim !== ambientDim) {
        this.dimensionMismatch(
          `${pointer}/dim`,
          dim,
          ambientDim,
          'source dimension must equal document ambientDim'
        );
      }
      return object as unknown as ExperimentSourceDescriptorV0;
    }
    if (kind === 'core.source.simplex') {
      const object = this.object(
        value,
        pointer,
        ['kind', 'kindVersion', 'dim', 'size'],
        ['kind', 'dim', 'size']
      );
      if (object === null) return null;
      this.kindVersion(object.kindVersion, `${pointer}/kindVersion`);
      const dim = this.positiveInteger(object.dim, `${pointer}/dim`);
      this.positiveNumber(object.size, `${pointer}/size`);
      if (dim !== null && ambientDim !== null && dim !== ambientDim) {
        this.dimensionMismatch(
          `${pointer}/dim`,
          dim,
          ambientDim,
          'source dimension must equal document ambientDim'
        );
      }
      return object as unknown as ExperimentSourceDescriptorV0;
    }
    if (kind === 'core.source.polychoron') {
      const object = this.object(
        value,
        pointer,
        ['kind', 'kindVersion', 'symbol'],
        ['kind', 'symbol']
      );
      if (object === null) return null;
      this.kindVersion(object.kindVersion, `${pointer}/kindVersion`);
      this.enumeration(
        object.symbol,
        `${pointer}/symbol`,
        ['5-cell', '8-cell', '16-cell', '24-cell', '120-cell', '600-cell']
      );
      if (ambientDim !== null && ambientDim !== 4) {
        this.dimensionMismatch(
          pointer,
          4,
          ambientDim,
          'polychoron sources require document ambientDim 4'
        );
      }
      return object as unknown as ExperimentSourceDescriptorV0;
    }
    this.unknownKind(kind, pointer, 'source');
    return null;
  }

  private validateModelDescriptor(
    value: unknown,
    pointer: string
  ): ExperimentModelDescriptorV0 | null {
    const kind = descriptorKind(value);
    if (kind !== 'physics.model.rigid4') {
      this.unknownKind(kind, pointer, 'model');
      return null;
    }
    const object = this.object(
      value,
      pointer,
      [
        'kind',
        'kindVersion',
        'source',
        'gravity',
        'initialRotor4',
        'initialAngularMomentum',
        'fixedStep',
        'substeps'
      ],
      ['kind', 'source', 'fixedStep']
    );
    if (object === null) return null;
    this.kindVersion(object.kindVersion, `${pointer}/kindVersion`);
    this.id(object.source, `${pointer}/source`);
    if (object.gravity !== undefined) {
      this.numberTuple(object.gravity, `${pointer}/gravity`, 4);
    }
    if (object.initialRotor4 !== undefined) {
      this.numberTuple(object.initialRotor4, `${pointer}/initialRotor4`, 8);
    }
    if (object.initialAngularMomentum !== undefined) {
      this.numberTuple(
        object.initialAngularMomentum,
        `${pointer}/initialAngularMomentum`,
        6
      );
    }
    this.positiveNumber(object.fixedStep, `${pointer}/fixedStep`);
    if (object.substeps !== undefined) {
      this.positiveInteger(object.substeps, `${pointer}/substeps`);
    }
    return object as unknown as ExperimentModelDescriptorV0;
  }

  private validateRepresentationDescriptor(
    value: unknown,
    pointer: string
  ): ExperimentRepresentationDescriptorV0 | null {
    const kind = descriptorKind(value);
    if (kind === 'core.representation.perspective') {
      const object = this.object(
        value,
        pointer,
        [
          'kind',
          'kindVersion',
          'source',
          'fromDim',
          'viewDistance',
          'epsilon',
          'transform',
          'product'
        ],
        ['kind', 'source', 'fromDim', 'viewDistance', 'product']
      );
      if (object === null) return null;
      this.kindVersion(object.kindVersion, `${pointer}/kindVersion`);
      this.id(object.source, `${pointer}/source`);
      const fromDim = this.positiveInteger(
        object.fromDim,
        `${pointer}/fromDim`
      );
      if (fromDim !== null && fromDim < 3) {
        this.add(
          'out-of-range',
          'perspective fromDim must be at least 3',
          `${pointer}/fromDim`,
          { received: fromDim, minimum: 3 }
        );
      }
      const viewDistance = this.positiveNumber(
        object.viewDistance,
        `${pointer}/viewDistance`
      );
      const epsilon = object.epsilon === undefined
        ? null
        : this.positiveNumber(object.epsilon, `${pointer}/epsilon`);
      if (viewDistance !== null &&
        epsilon !== null &&
        epsilon >= viewDistance) {
        this.add(
          'out-of-range',
          'perspective epsilon must be smaller than viewDistance',
          `${pointer}/epsilon`,
          { epsilon, viewDistance }
        );
      }
      this.enumeration(
        object.product,
        `${pointer}/product`,
        ['surface', 'edges', 'both']
      );
      this.validateTransform(object.transform, `${pointer}/transform`, fromDim);
      return object as unknown as ExperimentRepresentationDescriptorV0;
    }
    if (kind === 'core.representation.coordinate') {
      const object = this.object(
        value,
        pointer,
        [
          'kind',
          'kindVersion',
          'source',
          'fromDim',
          'retainedAxes',
          'transform',
          'product'
        ],
        ['kind', 'source', 'fromDim', 'retainedAxes', 'product']
      );
      if (object === null) return null;
      this.kindVersion(object.kindVersion, `${pointer}/kindVersion`);
      this.id(object.source, `${pointer}/source`);
      const fromDim = this.positiveInteger(
        object.fromDim,
        `${pointer}/fromDim`
      );
      if (fromDim !== null && fromDim < 3) {
        this.add(
          'out-of-range',
          'coordinate fromDim must be at least 3',
          `${pointer}/fromDim`,
          { received: fromDim, minimum: 3 }
        );
      }
      const axes = this.integerTuple(
        object.retainedAxes,
        `${pointer}/retainedAxes`,
        3
      );
      if (axes !== null) {
        if (new Set(axes).size !== axes.length) {
          this.add(
            'invalid-value',
            'retainedAxes must be distinct',
            `${pointer}/retainedAxes`
          );
        }
        if (fromDim !== null) {
          axes.forEach((axis, index) => {
            if (axis < 0 || axis >= fromDim) {
              this.add(
                'out-of-range',
                `retained axis ${axis} is outside R${fromDim}`,
                `${pointer}/retainedAxes/${index}`,
                { received: axis, minimum: 0, maximum: fromDim - 1 }
              );
            }
          });
        }
      }
      this.enumeration(
        object.product,
        `${pointer}/product`,
        ['surface', 'edges', 'both']
      );
      this.validateTransform(object.transform, `${pointer}/transform`, fromDim);
      return object as unknown as ExperimentRepresentationDescriptorV0;
    }
    if (kind === 'core.representation.section4') {
      const object = this.object(
        value,
        pointer,
        [
          'kind',
          'kindVersion',
          'source',
          'normal',
          'offset',
          'frame',
          'transform'
        ],
        ['kind', 'source', 'normal', 'offset', 'frame']
      );
      if (object === null) return null;
      this.kindVersion(object.kindVersion, `${pointer}/kindVersion`);
      this.id(object.source, `${pointer}/source`);
      const normal = this.numberTuple(
        object.normal,
        `${pointer}/normal`,
        4
      );
      if (normal !== null && Math.hypot(...normal) === 0) {
        this.add(
          'invalid-value',
          'section normal must be nonzero',
          `${pointer}/normal`
        );
      }
      this.finiteNumber(object.offset, `${pointer}/offset`);
      const frame = this.enumeration(
        object.frame,
        `${pointer}/frame`,
        ['canonical', 'continuous']
      );
      if (frame === 'continuous') {
        this.warnings.push(Object.freeze({
          code: 'replay-limited',
          message:
            'continuous slice framing requires trace history for exact replay',
          pointer: `${pointer}/frame`
        }));
      }
      this.validateTransform(object.transform, `${pointer}/transform`, 4);
      return object as unknown as ExperimentRepresentationDescriptorV0;
    }
    this.unknownKind(kind, pointer, 'representation');
    return null;
  }

  private validateTransform(
    value: unknown,
    pointer: string,
    dimension: number | null
  ): void {
    if (value === undefined) return;
    const object = this.object(
      value,
      pointer,
      ['translation', 'rotor4', 'fromModel'],
      []
    );
    if (object === null) return;
    const hasModel = object.fromModel !== undefined;
    const hasLiteral =
      object.translation !== undefined || object.rotor4 !== undefined;
    if (hasModel === hasLiteral) {
      this.add(
        'invalid-value',
        'transform must contain either fromModel or literal components',
        pointer
      );
    }
    if (hasModel) this.id(object.fromModel, `${pointer}/fromModel`);
    if (object.translation !== undefined && dimension !== null) {
      this.numberTuple(
        object.translation,
        `${pointer}/translation`,
        dimension
      );
    }
    if (object.rotor4 !== undefined) {
      this.numberTuple(object.rotor4, `${pointer}/rotor4`, 8);
      if (dimension !== null && dimension !== 4) {
        this.dimensionMismatch(
          `${pointer}/rotor4`,
          4,
          dimension,
          'rotor4 is available only for an R4 representation'
        );
      }
    }
  }

  private validateModelReferences(): void {
    for (const [id, descriptor] of this.modelDescriptors) {
      const pointer = `/models/${escapePointer(id)}/source`;
      const sourceDim = this.sourceDimensions.get(descriptor.source);
      if (sourceDim === undefined) {
        this.missingReference(pointer, descriptor.source, 'source');
      } else if (sourceDim !== 4) {
        this.dimensionMismatch(
          pointer,
          sourceDim,
          4,
          'rigid4 model source must live in R4'
        );
      }
    }
  }

  private validateRepresentationReferences(): void {
    for (const [id, descriptor] of this.representationDescriptors) {
      const base = `/representations/${escapePointer(id)}`;
      const sourceDim = this.sourceDimensions.get(descriptor.source);
      if (sourceDim === undefined) {
        this.missingReference(
          `${base}/source`,
          descriptor.source,
          'source'
        );
      } else if (descriptor.kind === 'core.representation.section4') {
        if (sourceDim !== 4) {
          this.dimensionMismatch(
            `${base}/source`,
            sourceDim,
            4,
            'section4 source must live in R4'
          );
        }
      } else if (descriptor.fromDim !== sourceDim) {
        this.dimensionMismatch(
          `${base}/fromDim`,
          descriptor.fromDim,
          sourceDim,
          'representation fromDim must equal source dimension'
        );
      }
      const model = modelReference(descriptor.transform);
      if (model !== null && !this.modelDescriptors.has(model)) {
        this.missingReference(`${base}/transform/fromModel`, model, 'model');
      }
    }
  }

  private validateDeclarationArray(
    value: unknown,
    pointer: string,
    visit: (entry: unknown, pointer: string) => void
  ): void {
    if (value === undefined) return;
    const array = this.array(value, pointer);
    if (array === null) return;
    array.forEach((entry, index) => visit(entry, `${pointer}/${index}`));
  }

  private validateParameter(value: unknown, pointer: string): void {
    const object = this.object(
      value,
      pointer,
      ['id', 'label', 'value', 'dimension', 'frame', 'unit', 'target'],
      ['id', 'label', 'value', 'dimension', 'frame', 'unit', 'target']
    );
    if (object === null) return;
    const id = this.id(object.id, `${pointer}/id`);
    if (id !== null) this.registerId(id, `${pointer}/id`);
    this.nonEmptyString(object.label, `${pointer}/label`);
    const parameterValue = this.validateParameterValue(
      object.value,
      `${pointer}/value`
    );
    const quantity = this.quantityDimension(
      object.dimension,
      `${pointer}/dimension`
    );
    const frame = this.validateFrame(object.frame, `${pointer}/frame`);
    this.nonEmptyString(object.unit, `${pointer}/unit`);
    const target = this.validateParameterTarget(
      object.target,
      `${pointer}/target`
    );
    if (target !== null) {
      this.validateParameterTargetSemantics(
        parameterValue,
        quantity,
        frame,
        target,
        `${pointer}/target`
      );
    }
  }

  private validateParameterValue(
    value: unknown,
    pointer: string
  ): Record<string, unknown> | null {
    const type = discriminator(value, 'type');
    if (type === 'number') {
      const object = this.object(
        value,
        pointer,
        ['type', 'default', 'min', 'max', 'step'],
        ['type', 'default', 'min', 'max']
      );
      if (object === null) return null;
      const defaultValue = this.finiteNumber(
        object.default,
        `${pointer}/default`
      );
      const min = this.finiteNumber(object.min, `${pointer}/min`);
      const max = this.finiteNumber(object.max, `${pointer}/max`);
      if (min !== null && max !== null && min > max) {
        this.add(
          'out-of-range',
          'number parameter min must not exceed max',
          pointer,
          { min, max }
        );
      }
      if (defaultValue !== null &&
        min !== null &&
        max !== null &&
        (defaultValue < min || defaultValue > max)) {
        this.add(
          'out-of-range',
          'number parameter default is outside its range',
          `${pointer}/default`,
          { received: defaultValue, minimum: min, maximum: max }
        );
      }
      if (object.step !== undefined) {
        this.positiveNumber(object.step, `${pointer}/step`);
      }
      return object;
    }
    if (type === 'boolean') {
      const object = this.object(
        value,
        pointer,
        ['type', 'default'],
        ['type', 'default']
      );
      if (object !== null) {
        this.boolean(object.default, `${pointer}/default`);
      }
      return object;
    }
    if (type === 'choice') {
      const object = this.object(
        value,
        pointer,
        ['type', 'default', 'options'],
        ['type', 'default', 'options']
      );
      if (object === null) return null;
      const defaultValue = this.string(
        object.default,
        `${pointer}/default`
      );
      const options = this.stringArray(
        object.options,
        `${pointer}/options`
      );
      if (options !== null) {
        if (options.length === 0 || new Set(options).size !== options.length) {
          this.add(
            'invalid-value',
            'choice options must be nonempty and unique',
            `${pointer}/options`
          );
        }
        if (defaultValue !== null && !options.includes(defaultValue)) {
          this.add(
            'invalid-value',
            'choice default must be one of its options',
            `${pointer}/default`
          );
        }
      }
      return object;
    }
    if (type === 'vector') {
      const object = this.object(
        value,
        pointer,
        ['type', 'default', 'length', 'min', 'max'],
        ['type', 'default', 'length']
      );
      if (object === null) return null;
      const length = this.positiveInteger(
        object.length,
        `${pointer}/length`
      );
      const defaultValue = length === null
        ? null
        : this.numberTuple(object.default, `${pointer}/default`, length);
      const min = object.min === undefined
        ? null
        : this.finiteNumber(object.min, `${pointer}/min`);
      const max = object.max === undefined
        ? null
        : this.finiteNumber(object.max, `${pointer}/max`);
      if (min !== null && max !== null && min > max) {
        this.add(
          'out-of-range',
          'vector parameter min must not exceed max',
          pointer,
          { min, max }
        );
      }
      if (defaultValue !== null) {
        defaultValue.forEach((component, index) => {
          if ((min !== null && component < min) ||
            (max !== null && component > max)) {
            this.add(
              'out-of-range',
              'vector parameter component is outside its range',
              `${pointer}/default/${index}`,
              {
                received: component,
                ...(min !== null ? { minimum: min } : {}),
                ...(max !== null ? { maximum: max } : {})
              }
            );
          }
        });
      }
      return object;
    }
    this.add(
      'invalid-value',
      `unknown parameter value type ${JSON.stringify(type)}`,
      `${pointer}/type`
    );
    return null;
  }

  private validateParameterTarget(
    value: unknown,
    pointer: string
  ): Record<string, unknown> | null {
    const kind = descriptorKind(value);
    if (kind === 'representation-field') {
      const object = this.object(
        value,
        pointer,
        ['kind', 'ref', 'field'],
        ['kind', 'ref', 'field']
      );
      if (object !== null) {
        this.id(object.ref, `${pointer}/ref`);
        this.enumeration(
          object.field,
          `${pointer}/field`,
          ['offset', 'normal', 'viewDistance']
        );
      }
      return object;
    }
    if (kind === 'model-field') {
      const object = this.object(
        value,
        pointer,
        ['kind', 'ref', 'field'],
        ['kind', 'ref', 'field']
      );
      if (object !== null) {
        this.id(object.ref, `${pointer}/ref`);
        this.enumeration(
          object.field,
          `${pointer}/field`,
          ['gravity', 'substeps']
        );
      }
      return object;
    }
    if (kind === 'clock') {
      const object = this.object(
        value,
        pointer,
        ['kind', 'field'],
        ['kind', 'field']
      );
      if (object !== null) {
        this.enumeration(
          object.field,
          `${pointer}/field`,
          ['rate', 'running']
        );
      }
      return object;
    }
    if (kind === 'presentation') {
      const object = this.object(
        value,
        pointer,
        ['kind', 'ref', 'field'],
        ['kind', 'ref', 'field']
      );
      if (object !== null) {
        this.id(object.ref, `${pointer}/ref`);
        this.nonEmptyString(object.field, `${pointer}/field`);
      }
      return object;
    }
    this.unknownKind(kind, pointer, 'parameter target');
    return null;
  }

  private validateParameterTargetSemantics(
    value: Record<string, unknown> | null,
    quantity: string | null,
    frame: ExperimentFrameV0 | null,
    target: Record<string, unknown>,
    pointer: string
  ): void {
    const declarationPointer = pointer.endsWith('/target')
      ? pointer.slice(0, -'/target'.length)
      : pointer;
    const kind = target.kind;
    const field = target.field;
    if (kind === 'representation-field') {
      const ref = typeof target.ref === 'string' ? target.ref : '';
      const representation = this.representationDescriptors.get(ref);
      if (representation === undefined) {
        this.missingReference(`${pointer}/ref`, ref, 'representation');
        return;
      }
      const allowed =
        representation.kind === 'core.representation.section4'
          ? ['offset', 'normal']
          : representation.kind === 'core.representation.perspective'
            ? ['viewDistance']
            : [];
      if (typeof field === 'string' && !allowed.includes(field)) {
        this.add(
          'invalid-value',
          `${field} is not mutable on ${representation.kind}`,
          `${pointer}/field`
        );
      }
      const dim = representationDimension(representation);
      this.requireFrame(
        frame,
        dim,
        `${declarationPointer}/frame`,
        'ambient'
      );
      const expectedQuantity = field === 'normal'
        ? 'dimensionless'
        : 'length';
      this.requireQuantity(
        quantity,
        expectedQuantity,
        `${declarationPointer}/dimension`
      );
      this.requireParameterShape(
        value,
        field === 'normal' ? 'vector' : 'number',
        field === 'normal' ? dim : null,
        `${declarationPointer}/value`
      );
      return;
    }
    if (kind === 'model-field') {
      const ref = typeof target.ref === 'string' ? target.ref : '';
      if (!this.modelDescriptors.has(ref)) {
        this.missingReference(`${pointer}/ref`, ref, 'model');
        return;
      }
      this.requireFrame(
        frame,
        4,
        `${declarationPointer}/frame`,
        'ambient'
      );
      if (field === 'gravity') {
        this.requireQuantity(
          quantity,
          'acceleration',
          `${declarationPointer}/dimension`
        );
        this.requireParameterShape(
          value,
          'vector',
          4,
          `${declarationPointer}/value`
        );
      } else {
        this.requireQuantity(
          quantity,
          'dimensionless',
          `${declarationPointer}/dimension`
        );
        this.requireParameterShape(
          value,
          'number',
          null,
          `${declarationPointer}/value`
        );
        if (value?.type === 'number') {
          for (const key of ['default', 'min', 'max', 'step']) {
            const component = value[key];
            if (component !== undefined && !Number.isSafeInteger(component)) {
              this.add(
                'invalid-value',
                'substeps parameter values must be safe integers',
                `${declarationPointer}/value/${key}`
              );
            }
          }
        }
      }
      return;
    }
    if (kind === 'clock') {
      this.requireFrame(
        frame,
        1,
        `${declarationPointer}/frame`,
        'internal'
      );
      if (field === 'running') {
        this.requireQuantity(
          quantity,
          'dimensionless',
          `${declarationPointer}/dimension`
        );
        this.requireParameterShape(
          value,
          'boolean',
          null,
          `${declarationPointer}/value`
        );
      } else {
        this.requireQuantity(
          quantity,
          'frequency',
          `${declarationPointer}/dimension`
        );
        this.requireParameterShape(
          value,
          'number',
          null,
          `${declarationPointer}/value`
        );
      }
      return;
    }
    if (kind === 'presentation') {
      const ref = typeof target.ref === 'string' ? target.ref : '';
      if (!this.dependencies.has(ref)) {
        this.missingReference(`${pointer}/ref`, ref, 'presentation pane');
      }
    }
  }

  private validateAction(value: unknown, pointer: string): void {
    const object = this.object(
      value,
      pointer,
      [
        'id',
        'title',
        'description',
        'inputSchema',
        'outputSchema',
        'readOnly',
        'destructive',
        'idempotent',
        'deterministic',
        'supportsPreview',
        'budget',
        'requiresBackend',
        'operation'
      ],
      [
        'id',
        'title',
        'description',
        'inputSchema',
        'outputSchema',
        'readOnly',
        'destructive',
        'idempotent',
        'deterministic',
        'supportsPreview',
        'budget'
      ]
    );
    if (object === null) return;
    const id = this.id(object.id, `${pointer}/id`);
    if (id !== null) this.registerId(id, `${pointer}/id`);
    this.nonEmptyString(object.title, `${pointer}/title`);
    this.nonEmptyString(object.description, `${pointer}/description`);
    this.validateJsonSchema(object.inputSchema, `${pointer}/inputSchema`);
    this.validateJsonSchema(object.outputSchema, `${pointer}/outputSchema`);
    for (const key of [
      'readOnly',
      'destructive',
      'idempotent',
      'deterministic',
      'supportsPreview'
    ]) {
      this.boolean(object[key], `${pointer}/${key}`);
    }
    const budget = this.object(
      object.budget,
      `${pointer}/budget`,
      ['maxSteps', 'maxMillis'],
      []
    );
    if (budget !== null) {
      if (budget.maxSteps === undefined && budget.maxMillis === undefined) {
        this.add(
          'missing-field',
          'action budget must declare maxSteps or maxMillis',
          `${pointer}/budget`
        );
      }
      if (budget.maxSteps !== undefined) {
        this.positiveInteger(
          budget.maxSteps,
          `${pointer}/budget/maxSteps`
        );
      }
      if (budget.maxMillis !== undefined) {
        this.positiveNumber(
          budget.maxMillis,
          `${pointer}/budget/maxMillis`
        );
      }
    }
    if (object.requiresBackend !== undefined) {
      this.validateBackend(
        object.requiresBackend,
        `${pointer}/requiresBackend`
      );
    }
    if (object.operation !== undefined) {
      this.validateActionOperation(object.operation, `${pointer}/operation`);
    }
  }

  /**
   * Checks the closed operation vocabulary.
   *
   * The field is optional, so a document written against an earlier validator
   * stays valid; what is not optional is the vocabulary, because an operation
   * naming something the runtime cannot do would fail at invocation rather
   * than at authoring.
   */
  private validateActionOperation(value: unknown, pointer: string): void {
    const object = this.object(value, pointer, ['kind', 'parameter'], ['kind']);
    if (object === null) return;
    const kind = object.kind;
    if (kind !== 'advance-clock' && kind !== 'set-parameter' &&
      kind !== 'probe' && kind !== 'reset') {
      this.add(
        'unknown-kind',
        'action operation kind is outside the closed vocabulary',
        `${pointer}/kind`,
        { kind: typeof kind === 'string' ? kind : String(kind) }
      );
      return;
    }
    if (kind === 'set-parameter') {
      if (typeof object.parameter !== 'string') {
        this.add(
          'missing-field',
          'a set-parameter operation must name a parameter',
          `${pointer}/parameter`
        );
        return;
      }
      // Cross-referenced now rather than at invocation, so a document naming a
      // parameter that does not exist is refused where it was authored.
      // Parameters are validated before actions, so their ids are registered.
      const declared = this.globalIds.get(object.parameter);
      if (declared === undefined || !declared.startsWith('/parameters/')) {
        this.missingReference(
          `${pointer}/parameter`, object.parameter, 'parameter'
        );
      }
    } else if (object.parameter !== undefined) {
      this.add(
        'unknown-field',
        `a ${kind} operation takes no parameter`,
        `${pointer}/parameter`
      );
    }
  }

  private validateObservation(value: unknown, pointer: string): void {
    const object = this.object(
      value,
      pointer,
      [
        'id',
        'title',
        'outputSchema',
        'dimension',
        'frame',
        'unit',
        'replayTolerance',
        'source'
      ],
      [
        'id',
        'title',
        'outputSchema',
        'dimension',
        'frame',
        'unit',
        'replayTolerance',
        'source'
      ]
    );
    if (object === null) return;
    const id = this.id(object.id, `${pointer}/id`);
    if (id !== null) this.registerId(id, `${pointer}/id`);
    this.nonEmptyString(object.title, `${pointer}/title`);
    this.validateJsonSchema(object.outputSchema, `${pointer}/outputSchema`);
    this.quantityDimension(object.dimension, `${pointer}/dimension`);
    this.validateFrame(object.frame, `${pointer}/frame`);
    this.nonEmptyString(object.unit, `${pointer}/unit`);
    const tolerance = this.finiteNumber(
      object.replayTolerance,
      `${pointer}/replayTolerance`
    );
    if (tolerance !== null && tolerance < 0) {
      this.add(
        'out-of-range',
        'replayTolerance must be non-negative',
        `${pointer}/replayTolerance`,
        { received: tolerance, minimum: 0 }
      );
    }
    this.validateObservationSource(object.source, `${pointer}/source`);
  }

  private validateObservationSource(value: unknown, pointer: string): void {
    const kind = descriptorKind(value);
    if (kind === 'model-invariant') {
      const object = this.object(
        value,
        pointer,
        ['kind', 'ref', 'quantity'],
        ['kind', 'ref', 'quantity']
      );
      if (object === null) return;
      const ref = this.id(object.ref, `${pointer}/ref`);
      this.enumeration(
        object.quantity,
        `${pointer}/quantity`,
        [
          'angular-momentum',
          'kinetic-energy',
          'rotor-orthonormality',
          'position'
        ]
      );
      if (ref !== null && !this.modelDescriptors.has(ref)) {
        this.missingReference(`${pointer}/ref`, ref, 'model');
      }
      return;
    }
    if (kind === 'representation-count') {
      const object = this.object(
        value,
        pointer,
        ['kind', 'ref', 'quantity'],
        ['kind', 'ref', 'quantity']
      );
      if (object === null) return;
      const ref = this.id(object.ref, `${pointer}/ref`);
      this.enumeration(
        object.quantity,
        `${pointer}/quantity`,
        ['triangles', 'vertices', 'edges']
      );
      if (ref !== null && !this.representationDescriptors.has(ref)) {
        this.missingReference(`${pointer}/ref`, ref, 'representation');
      }
      return;
    }
    if (kind === 'lineage') {
      const object = this.object(
        value,
        pointer,
        ['kind', 'ref'],
        ['kind', 'ref']
      );
      if (object === null) return;
      const ref = this.id(object.ref, `${pointer}/ref`);
      if (ref !== null && !this.representationDescriptors.has(ref)) {
        this.missingReference(`${pointer}/ref`, ref, 'representation');
      }
      return;
    }
    if (kind === 'selection') {
      this.object(value, pointer, ['kind'], ['kind']);
      return;
    }
    this.unknownKind(kind, pointer, 'observation source');
  }

  private validateJsonSchema(
    value: unknown,
    pointer: string
  ): ExperimentJsonSchemaV0 | null {
    const object = this.object(
      value,
      pointer,
      [
        'type',
        'title',
        'description',
        'properties',
        'required',
        'enum',
        'minimum',
        'maximum',
        'items',
        'minItems',
        'maxItems',
        'additionalProperties'
      ],
      ['type']
    );
    if (object === null) return null;
    const type = this.enumeration(
      object.type,
      `${pointer}/type`,
      ['object', 'array', 'string', 'number', 'integer', 'boolean']
    );
    if (object.title !== undefined) {
      this.nonEmptyString(object.title, `${pointer}/title`);
    }
    if (object.description !== undefined) {
      this.nonEmptyString(object.description, `${pointer}/description`);
    }
    if (object.properties !== undefined) {
      if (type !== null && type !== 'object') {
        this.add(
          'invalid-value',
          'properties is available only on object schemas',
          `${pointer}/properties`
        );
      }
      const properties = this.record(
        object.properties,
        `${pointer}/properties`
      );
      if (properties !== null) {
        for (const key of Object.keys(properties).sort()) {
          this.validateJsonSchema(
            properties[key],
            `${pointer}/properties/${escapePointer(key)}`
          );
        }
      }
    }
    if (object.required !== undefined) {
      const required = this.stringArray(
        object.required,
        `${pointer}/required`
      );
      if (type !== null && type !== 'object') {
        this.add(
          'invalid-value',
          'required is available only on object schemas',
          `${pointer}/required`
        );
      }
      if (required !== null && new Set(required).size !== required.length) {
        this.add(
          'invalid-value',
          'required keys must be unique',
          `${pointer}/required`
        );
      }
    }
    if (object.enum !== undefined) {
      const values = this.array(object.enum, `${pointer}/enum`);
      if (values !== null) {
        if (values.length === 0) {
          this.add(
            'invalid-value',
            'enum must be nonempty',
            `${pointer}/enum`
          );
        }
        values.forEach((entry, index) => {
          if (entry !== null &&
            typeof entry !== 'string' &&
            typeof entry !== 'number' &&
            typeof entry !== 'boolean') {
            this.add(
              'invalid-type',
              'enum values must be JSON primitives',
              `${pointer}/enum/${index}`
            );
          }
        });
      }
    }
    const minimum = object.minimum === undefined
      ? null
      : this.finiteNumber(object.minimum, `${pointer}/minimum`);
    const maximum = object.maximum === undefined
      ? null
      : this.finiteNumber(object.maximum, `${pointer}/maximum`);
    if (minimum !== null && maximum !== null && minimum > maximum) {
      this.add(
        'out-of-range',
        'schema minimum must not exceed maximum',
        pointer,
        { minimum, maximum }
      );
    }
    if (object.items !== undefined) {
      if (type !== null && type !== 'array') {
        this.add(
          'invalid-value',
          'items is available only on array schemas',
          `${pointer}/items`
        );
      }
      this.validateJsonSchema(object.items, `${pointer}/items`);
    }
    const minItems = object.minItems === undefined
      ? null
      : this.nonNegativeInteger(object.minItems, `${pointer}/minItems`);
    const maxItems = object.maxItems === undefined
      ? null
      : this.nonNegativeInteger(object.maxItems, `${pointer}/maxItems`);
    if ((minItems !== null || maxItems !== null) &&
      type !== null &&
      type !== 'array') {
      this.add(
        'invalid-value',
        'item bounds are available only on array schemas',
        pointer
      );
    }
    if (minItems !== null && maxItems !== null && minItems > maxItems) {
      this.add(
        'out-of-range',
        'schema minItems must not exceed maxItems',
        pointer,
        { minimum: minItems, maximum: maxItems }
      );
    }
    if (object.additionalProperties !== undefined &&
      object.additionalProperties !== false) {
      this.add(
        'invalid-value',
        'additionalProperties may only be false in the v0 schema subset',
        `${pointer}/additionalProperties`
      );
    }
    return object as unknown as ExperimentJsonSchemaV0;
  }

  private validateFrame(
    value: unknown,
    pointer: string
  ): ExperimentFrameV0 | null {
    const object = this.object(
      value,
      pointer,
      ['space', 'dim'],
      ['space', 'dim']
    );
    if (object === null) return null;
    this.enumeration(
      object.space,
      `${pointer}/space`,
      ['ambient', 'source', 'representation', 'internal']
    );
    this.positiveInteger(object.dim, `${pointer}/dim`);
    return object as unknown as ExperimentFrameV0;
  }

  private validatePresentation(value: unknown, pointer: string): void {
    if (value === undefined) return;
    const object = this.object(value, pointer, ['panes'], ['panes']);
    if (object === null) return;
    const panes = this.array(object.panes, `${pointer}/panes`);
    if (panes === null) return;
    panes.forEach((pane, index) =>
      this.validatePane(pane, `${pointer}/panes/${index}`)
    );
  }

  private validatePane(value: unknown, pointer: string): void {
    const object = this.object(
      value,
      pointer,
      [
        'kind',
        'kindVersion',
        'id',
        'representation',
        'title',
        'column',
        'palette'
      ],
      ['kind', 'id', 'representation', 'title', 'column']
    );
    if (object === null) return;
    const kind = this.enumeration(
      object.kind,
      `${pointer}/kind`,
      ['three.pane.representation']
    );
    this.kindVersion(object.kindVersion, `${pointer}/kindVersion`);
    const id = this.id(object.id, `${pointer}/id`);
    if (id !== null) {
      this.registerId(id, `${pointer}/id`);
      if (kind !== null) {
        this.dependencies.set(
          id,
          new Set(
            typeof object.representation === 'string'
              ? [object.representation]
              : []
          )
        );
      }
    }
    const representation = this.id(
      object.representation,
      `${pointer}/representation`
    );
    if (representation !== null &&
      !this.representationDescriptors.has(representation)) {
      this.missingReference(
        `${pointer}/representation`,
        representation,
        'representation'
      );
    }
    this.nonEmptyString(object.title, `${pointer}/title`);
    this.nonNegativeInteger(object.column, `${pointer}/column`);
    if (object.palette !== undefined) {
      this.enumeration(
        object.palette,
        `${pointer}/palette`,
        ['source-cell', 'depth', 'uniform']
      );
    }
  }

  private validateBackends(value: unknown, pointer: string): void {
    if (value === undefined) return;
    const array = this.array(value, pointer);
    if (array === null) return;
    const backends = new Set<string>();
    array.forEach((entry, index) => {
      const backend = this.validateBackend(entry, `${pointer}/${index}`);
      if (backend !== null) {
        if (backends.has(backend.backend)) {
          this.add(
            'invalid-value',
            `duplicate backend declaration ${backend.backend}`,
            `${pointer}/${index}/backend`
          );
        }
        backends.add(backend.backend);
      }
    });
    if (!backends.has('cpu')) {
      this.add(
        'missing-field',
        'backends must declare the CPU reference path',
        pointer
      );
    }
  }

  private validateBackend(
    value: unknown,
    pointer: string
  ): ExperimentBackendRequirementV0 | null {
    const object = this.object(
      value,
      pointer,
      ['backend', 'required'],
      ['backend', 'required']
    );
    if (object === null) return null;
    this.enumeration(
      object.backend,
      `${pointer}/backend`,
      ['cpu', 'webgpu', 'webgl']
    );
    this.boolean(object.required, `${pointer}/required`);
    return object as unknown as ExperimentBackendRequirementV0;
  }

  private inspectJsonValue(
    value: unknown,
    pointer: string,
    depth: number,
    ancestors: Set<object>
  ): void {
    if (this.resourceExhausted) return;
    if (depth > this.limits.maxDepth) {
      this.add(
        'resource-limit',
        `object depth exceeds ${this.limits.maxDepth}`,
        pointer,
        { limit: this.limits.maxDepth }
      );
      return;
    }
    if (value === null ||
      typeof value === 'boolean') {
      return;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        this.add(
          'non-finite-number',
          'experiment numbers must be finite',
          pointer
        );
      }
      return;
    }
    if (typeof value === 'string') {
      if (value.length > this.limits.maxStringLength) {
        this.add(
          'resource-limit',
          `string length exceeds ${this.limits.maxStringLength}`,
          pointer,
          { received: value.length, limit: this.limits.maxStringLength }
        );
      }
      return;
    }
    if (typeof value !== 'object') {
      this.add(
        'invalid-type',
        `experiment value is not JSON-compatible (${typeof value})`,
        pointer
      );
      return;
    }
    if (ancestors.has(value)) {
      this.add(
        'invalid-value',
        'experiment value contains an object cycle',
        pointer
      );
      return;
    }
    ancestors.add(value);
    if (Array.isArray(value)) {
      if (Object.getOwnPropertySymbols(value).length > 0) {
        this.add(
          'invalid-type',
          'experiment arrays may not contain symbol keys',
          pointer
        );
      }
      for (const key of Object.keys(value)) {
        if (!isCanonicalArrayIndex(key, value.length)) {
          this.add(
            'invalid-type',
            'experiment arrays may contain only indexed elements',
            `${pointer}/${escapePointer(key)}`
          );
        }
      }
      for (let index = 0; index < value.length; index++) {
        this.countEntry(`${pointer}/${index}`);
        if (this.resourceExhausted) break;
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index)
        );
        if (descriptor === undefined) {
          this.add(
            'invalid-value',
            'sparse arrays are not JSON-compatible',
            `${pointer}/${index}`
          );
          continue;
        }
        if (descriptor.get !== undefined || descriptor.set !== undefined) {
          this.accessorEncountered = true;
          this.add(
            'invalid-type',
            'experiment arrays may contain only data properties',
            `${pointer}/${index}`
          );
          continue;
        }
        this.inspectJsonValue(
          descriptor.value,
          `${pointer}/${index}`,
          depth + 1,
          ancestors
        );
      }
      ancestors.delete(value);
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      this.add(
        'invalid-type',
        'experiment objects must have a plain or null prototype',
        pointer
      );
      ancestors.delete(value);
      return;
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      this.add(
        'invalid-type',
        'experiment objects may not contain symbol keys',
        pointer
      );
    }
    for (const key of Object.keys(value)) {
      const child = `${pointer}/${escapePointer(key)}`;
      this.countEntry(child);
      if (this.resourceExhausted) break;
      if (UNSAFE_KEYS.has(key)) {
        this.add(
          'unsafe-key',
          `prototype-sensitive key ${JSON.stringify(key)} is not admitted`,
          child
        );
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined) {
        this.accessorEncountered = true;
        this.add(
          'invalid-type',
          'experiment objects may contain only data properties',
          child
        );
        continue;
      }
      this.inspectJsonValue(
        descriptor.value,
        child,
        depth + 1,
        ancestors
      );
    }
    ancestors.delete(value);
  }

  private countEntry(pointer: string): void {
    this.entries++;
    if (this.entries === this.limits.maxEntries + 1) {
      this.resourceExhausted = true;
      this.add(
        'resource-limit',
        `document entries exceed ${this.limits.maxEntries}`,
        pointer,
        { limit: this.limits.maxEntries }
      );
    }
  }

  private object(
    value: unknown,
    pointer: string,
    allowed: readonly string[],
    required: readonly string[]
  ): Record<string, unknown> | null {
    if (!isPlainObject(value)) {
      this.add(
        'invalid-type',
        'expected an object',
        pointer
      );
      return null;
    }
    const keys = Object.keys(value);
    for (const key of keys) {
      if (!allowed.includes(key)) {
        this.add(
          'unknown-field',
          `unknown field ${JSON.stringify(key)}`,
          `${pointer}/${escapePointer(key)}`
        );
      }
    }
    for (const key of required) {
      if (!Object.hasOwn(value, key)) {
        this.add(
          'missing-field',
          `missing required field ${JSON.stringify(key)}`,
          `${pointer}/${escapePointer(key)}`
        );
      }
    }
    return value;
  }

  private record(
    value: unknown,
    pointer: string
  ): Record<string, unknown> | null {
    if (!isPlainObject(value)) {
      this.add('invalid-type', 'expected an object record', pointer);
      return null;
    }
    return value;
  }

  private array(value: unknown, pointer: string): readonly unknown[] | null {
    if (!Array.isArray(value)) {
      this.add('invalid-type', 'expected an array', pointer);
      return null;
    }
    return value;
  }

  private id(value: unknown, pointer: string): string | null {
    const id = this.string(value, pointer);
    if (id !== null && !ID_PATTERN.test(id)) {
      this.add(
        'invalid-id',
        'experiment id must match /^[A-Za-z][A-Za-z0-9_-]{0,63}$/',
        pointer,
        { received: id }
      );
      return null;
    }
    return id;
  }

  private registerId(id: string, pointer: string): void {
    if (!ID_PATTERN.test(id)) {
      this.add(
        'invalid-id',
        'experiment id must match /^[A-Za-z][A-Za-z0-9_-]{0,63}$/',
        pointer,
        { received: id }
      );
      return;
    }
    const previous = this.globalIds.get(id);
    if (previous !== undefined) {
      this.add(
        'invalid-id',
        `experiment id ${JSON.stringify(id)} is already used`,
        pointer,
        { previous }
      );
      return;
    }
    this.globalIds.set(id, pointer);
  }

  private string(value: unknown, pointer: string): string | null {
    if (typeof value !== 'string') {
      this.add('invalid-type', 'expected a string', pointer);
      return null;
    }
    return value;
  }

  private nonEmptyString(value: unknown, pointer: string): string | null {
    const result = this.string(value, pointer);
    if (result !== null && result.trim().length === 0) {
      this.add('invalid-value', 'string must be nonempty', pointer);
      return null;
    }
    return result;
  }

  private stringArray(
    value: unknown,
    pointer: string
  ): string[] | null {
    const array = this.array(value, pointer);
    if (array === null) return null;
    const result: string[] = [];
    array.forEach((entry, index) => {
      const component = this.string(entry, `${pointer}/${index}`);
      if (component !== null) result.push(component);
    });
    return result.length === array.length ? result : null;
  }

  private boolean(value: unknown, pointer: string): boolean | null {
    if (typeof value !== 'boolean') {
      this.add('invalid-type', 'expected a boolean', pointer);
      return null;
    }
    return value;
  }

  private finiteNumber(value: unknown, pointer: string): number | null {
    if (typeof value !== 'number') {
      this.add('invalid-type', 'expected a number', pointer);
      return null;
    }
    if (!Number.isFinite(value)) {
      this.add(
        'non-finite-number',
        'expected a finite number',
        pointer
      );
      return null;
    }
    return value;
  }

  private positiveNumber(value: unknown, pointer: string): number | null {
    const result = this.finiteNumber(value, pointer);
    if (result !== null && !(result > 0)) {
      this.add(
        'out-of-range',
        'expected a positive number',
        pointer,
        { received: result, minimumExclusive: 0 }
      );
      return null;
    }
    return result;
  }

  /**
   * One positive finite length per ambient axis, reported per component.
   *
   * The pointer names the offending index rather than the array, because an
   * author fixing `/sources/body/edgeLengths/2` does not have to count entries
   * to find which one this is about.
   */
  private edgeLengths(value: unknown, pointer: string, dim: number | null): void {
    if (!Array.isArray(value)) {
      this.add('invalid-type', 'expected an array of edge lengths', pointer, {
        received: typeof value
      });
      return;
    }
    if (dim !== null && value.length !== dim) {
      this.add(
        'invalid-value',
        'expected one edge length per ambient axis',
        pointer,
        { received: value.length, expected: dim }
      );
      return;
    }
    for (let axis = 0; axis < value.length; axis += 1) {
      // Rejects NaN and the infinities too: valid JSON cannot encode them, but
      // a document assembled programmatically can.
      this.positiveNumber(value[axis], `${pointer}/${axis}`);
    }
  }

  private positiveInteger(value: unknown, pointer: string): number | null {
    const result = this.nonNegativeInteger(value, pointer);
    if (result !== null && result < 1) {
      this.add(
        'out-of-range',
        'expected a positive integer',
        pointer,
        { received: result, minimum: 1 }
      );
      return null;
    }
    return result;
  }

  private nonNegativeInteger(
    value: unknown,
    pointer: string
  ): number | null {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      this.add(
        'invalid-value',
        'expected a non-negative safe integer',
        pointer
      );
      return null;
    }
    return value as number;
  }

  private numberTuple(
    value: unknown,
    pointer: string,
    length: number
  ): number[] | null {
    const array = this.array(value, pointer);
    if (array === null) return null;
    if (array.length !== length) {
      this.add(
        'dimension-mismatch',
        `expected ${length} components, received ${array.length}`,
        pointer,
        { expected: length, received: array.length }
      );
      return null;
    }
    const result: number[] = [];
    array.forEach((entry, index) => {
      const component = this.finiteNumber(entry, `${pointer}/${index}`);
      if (component !== null) result.push(component);
    });
    return result.length === length ? result : null;
  }

  private integerTuple(
    value: unknown,
    pointer: string,
    length: number
  ): number[] | null {
    const array = this.array(value, pointer);
    if (array === null) return null;
    if (array.length !== length) {
      this.add(
        'dimension-mismatch',
        `expected ${length} components, received ${array.length}`,
        pointer,
        { expected: length, received: array.length }
      );
      return null;
    }
    const result: number[] = [];
    array.forEach((entry, index) => {
      const component = this.nonNegativeInteger(
        entry,
        `${pointer}/${index}`
      );
      if (component !== null) result.push(component);
    });
    return result.length === length ? result : null;
  }

  private enumeration<const Value extends string>(
    value: unknown,
    pointer: string,
    values: readonly Value[]
  ): Value | null {
    const text = this.string(value, pointer);
    if (text !== null && !values.includes(text as Value)) {
      this.add(
        'invalid-value',
        `expected one of ${values.join(', ')}`,
        pointer,
        { received: text }
      );
      return null;
    }
    return text as Value | null;
  }

  private kindVersion(value: unknown, pointer: string): void {
    if (value === undefined) return;
    if (value !== 0) {
      this.add(
        'kind-version-mismatch',
        'schema v0 supports descriptor kindVersion 0 only',
        pointer,
        {
          received: typeof value === 'number' ? value : String(value),
          supported: 0
        }
      );
    }
  }

  private quantityDimension(
    value: unknown,
    pointer: string
  ): string | null {
    return this.enumeration(
      value,
      pointer,
      [
        'length',
        'angle',
        'time',
        'mass',
        'velocity',
        'acceleration',
        'frequency',
        'energy',
        'angular-momentum',
        'dimensionless'
      ]
    );
  }

  private requireFrame(
    frame: ExperimentFrameV0 | null,
    dimension: number,
    pointer: string,
    space?: ExperimentFrameV0['space']
  ): void {
    if (frame === null) return;
    if (frame.dim !== dimension ||
      (space !== undefined && frame.space !== space)) {
      this.add(
        'frame-mismatch',
        `parameter frame must be ${space ?? frame.space} R${dimension}`,
        pointer,
        {
          expectedDim: dimension,
          receivedDim: frame.dim,
          ...(space !== undefined
            ? { expectedSpace: space, receivedSpace: frame.space }
            : {})
        }
      );
    }
  }

  private requireQuantity(
    received: string | null,
    expected: string,
    pointer: string
  ): void {
    if (received !== null && received !== expected) {
      this.add(
        'unit-mismatch',
        `target requires quantity dimension ${expected}`,
        pointer,
        { expected, received }
      );
    }
  }

  private requireParameterShape(
    value: Record<string, unknown> | null,
    expected: string,
    length: number | null,
    pointer: string
  ): void {
    if (value === null) return;
    if (value.type !== expected) {
      this.add(
        'invalid-value',
        `target requires a ${expected} parameter`,
        pointer,
        { expected, received: String(value.type) }
      );
      return;
    }
    if (expected === 'vector' &&
      length !== null &&
      value.length !== length) {
      this.dimensionMismatch(
        `${pointer}/length`,
        typeof value.length === 'number' ? value.length : -1,
        length,
        'parameter vector length must match its target'
      );
    }
  }

  private dimensionMismatch(
    pointer: string,
    received: number,
    expected: number,
    message: string
  ): void {
    this.add(
      'dimension-mismatch',
      message,
      pointer,
      { expected, received }
    );
  }

  private missingReference(
    pointer: string,
    reference: string,
    category: string
  ): void {
    this.add(
      'missing-reference',
      `unknown ${category} reference ${JSON.stringify(reference)}`,
      pointer,
      { reference, category }
    );
  }

  private unknownKind(
    kind: string | null,
    pointer: string,
    category: string
  ): void {
    this.add(
      'unknown-kind',
      `unknown ${category} kind ${JSON.stringify(kind)}`,
      `${pointer}/kind`,
      { received: kind ?? 'missing' }
    );
  }

  private topologicalOrder(): string[] {
    const remaining = new Map<string, Set<string>>();
    for (const [id, dependencies] of this.dependencies) {
      remaining.set(id, new Set(dependencies));
    }
    const result: string[] = [];
    while (remaining.size > 0) {
      const ready = [...remaining]
        .filter(([, dependencies]) =>
          [...dependencies].every((dependency) =>
            !remaining.has(dependency)
          )
        )
        .map(([id]) => id)
        .sort();
      if (ready.length === 0) {
        const cyclic = dependencyCycleNodes(remaining);
        this.add(
          'dependency-cycle',
          'experiment descriptor dependencies contain a cycle',
          '',
          { nodes: cyclic.join(',') }
        );
        return [];
      }
      for (const id of ready) {
        remaining.delete(id);
        result.push(id);
      }
    }
    return result;
  }

  private add(
    code: ExperimentFailure['code'],
    message: string,
    pointer?: string,
    detail?: ExperimentFailure['detail']
  ): void {
    this.failures.push(Object.freeze({
      code,
      message,
      ...(pointer !== undefined ? { pointer } : {}),
      ...(detail !== undefined ? { detail: Object.freeze({ ...detail }) } : {})
    }));
  }
}

function descriptorKind(value: unknown): string | null {
  return discriminator(value, 'kind');
}

function discriminator(value: unknown, field: string): string | null {
  if (!isPlainObject(value)) return null;
  const component = value[field];
  return typeof component === 'string' ? component : null;
}

function sourceDimension(descriptor: ExperimentSourceDescriptorV0): number {
  return descriptor.kind === 'core.source.polychoron'
    ? 4
    : descriptor.dim;
}

function representationDimension(
  descriptor: ExperimentRepresentationDescriptorV0
): number {
  return descriptor.kind === 'core.representation.section4'
    ? 4
    : descriptor.fromDim;
}

function modelReference(
  transform: ExperimentTransformDescriptorV0 | undefined
): string | null {
  return transform !== undefined &&
    'fromModel' in transform &&
    typeof transform.fromModel === 'string'
    ? transform.fromModel
    : null;
}

function dependencyCycleNodes(
  graph: ReadonlyMap<string, ReadonlySet<string>>
): string[] {
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cyclic = new Set<string>();

  const visit = (node: string): void => {
    indices.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex++;
    stack.push(node);
    onStack.add(node);

    for (const dependency of [...(graph.get(node) ?? [])].sort()) {
      if (!graph.has(dependency)) continue;
      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node)!, lowLinks.get(dependency)!)
        );
      } else if (onStack.has(dependency)) {
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node)!, indices.get(dependency)!)
        );
      }
    }

    if (lowLinks.get(node) !== indices.get(node)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
      if (member === node) break;
    }
    const selfCycle = component.length === 1 &&
      graph.get(component[0]!)?.has(component[0]!) === true;
    if (component.length > 1 || selfCycle) {
      for (const member of component) cyclic.add(member);
    }
  };

  for (const node of [...graph.keys()].sort()) {
    if (!indices.has(node)) visit(node);
  }
  return [...cyclic].sort();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isCanonicalArrayIndex(key: string, length: number): boolean {
  if (!/^(0|[1-9][0-9]*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}
