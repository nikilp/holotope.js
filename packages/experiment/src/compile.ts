import type {
  CellComplex,
  HyperplaneSlice4,
  Projection,
  RepresentationLineageN,
  RepresentationMapCapabilitiesN,
  TransformN
} from '@holotope/core';
import {
  validateExperimentDocumentV0
} from './validation.js';
import type {
  ExperimentDescriptorKind,
  ExperimentDocumentV0,
  ExperimentFailure,
  ExperimentId,
  ExperimentModelDescriptorV0,
  ExperimentRepresentationDescriptorV0,
  ExperimentResult,
  ExperimentSourceDescriptorV0,
  PreparedExperimentDocumentV0
} from './types.js';

const DOCUMENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const KNOWN_NAMESPACES = new Set(['core', 'physics', 'three']);

/** Registry category of one compiled experiment entry. */
export type ExperimentCompiledCategoryV0 = 'source' | 'model' | 'representation';

/** Live authoritative geometry compiled from one source descriptor. */
export interface ExperimentCompiledSourceV0 {
  /** Registry discriminator for a compiled source. */
  readonly category: 'source';
  /** Document key that owns this compiled object. */
  readonly id: ExperimentId;
  /** Construction kind that produced the object. */
  readonly kind: ExperimentDescriptorKind;
  /** Ambient dimension of the constructed geometry. */
  readonly dim: number;
  /** The constructed authoritative source complex. */
  readonly complex: CellComplex;
}

/** Live lower-dimensional map object compiled from a representation descriptor. */
export type ExperimentCompiledRepresentationMapV0 =
  | {
      /** Discriminator for a projection-backed representation. */
      readonly kind: 'projection';
      /** The constructed projection; lineage is derived from this object. */
      readonly projection: Projection;
    }
  | {
      /** Discriminator for an exact R4 hyperplane section. */
      readonly kind: 'slice4';
      /** The constructed slice; lineage is derived from this object. */
      readonly slice: HyperplaneSlice4;
      /** Declared frame policy retained for future normal updates. */
      readonly frame: 'canonical' | 'continuous';
    };

/**
 * Where a compiled representation reads its source pose from.
 *
 * A literal transform is compiled once and never changes. A model binding is
 * resolved through the registry at read time, because the model owns its pose
 * and a copy taken at compile time would be stale the moment it advanced.
 */
export type ExperimentCompiledPoseV0 =
  | {
      /** Discriminator for a pose fixed at compilation. */
      readonly kind: 'static';
      /** Compiled literal source pose, or null when the descriptor has none. */
      readonly transform: TransformN | null;
    }
  | {
      /** Discriminator for a pose owned by a compiled model. */
      readonly kind: 'model';
      /** Registry id of the model whose pose this representation follows. */
      readonly model: ExperimentId;
    };

/** Compiled representation: the live map plus its derived lineage evidence. */
export interface ExperimentCompiledRepresentationV0 {
  /** Registry discriminator for a compiled representation. */
  readonly category: 'representation';
  /** Document key that owns this compiled object. */
  readonly id: ExperimentId;
  /** Construction kind that produced the object. */
  readonly kind: ExperimentDescriptorKind;
  /** Registry id of the source this representation reads. */
  readonly source: ExperimentId;
  /** The live projection or slice actually constructed. */
  readonly map: ExperimentCompiledRepresentationMapV0;
  /** Where this representation's source pose comes from. */
  readonly pose: ExperimentCompiledPoseV0;
  /** Lineage derived from the constructed map, never from the descriptor. */
  readonly lineage: RepresentationLineageN;
  /** Capability composition of the derived lineage. */
  readonly capabilities: RepresentationMapCapabilitiesN;
}

/**
 * A compiled model: authoritative pose plus a bounded advance seam.
 *
 * The contract is expressible in core types alone, so the registry can hold
 * and drive a model whose mathematics it has no dependency on. Whatever the
 * supplying capability actually built is reached through `runtime`, narrowed
 * by that capability's own types.
 */
export interface ExperimentCompiledModelV0 {
  /** Registry discriminator for a compiled model. */
  readonly category: 'model';
  /** Document key that owns this compiled model. */
  readonly id: ExperimentId;
  /** Construction kind that produced the model. */
  readonly kind: ExperimentDescriptorKind;
  /** Registry id of the source supplying the model's mass shape. */
  readonly source: ExperimentId;
  /** Fresh defensive copy of the current authoritative source-frame pose. */
  pose(): TransformN;
  /**
   * Advances this model by whole fixed steps.
   *
   * Driven by the compilation clock. Calling it directly desynchronizes that
   * clock from the model, which is the caller forfeiting determinism rather
   * than something the model prevents.
   */
  advanceModel(steps: number): ExperimentResult<{ readonly modelStep: number }>;
  /** Model-owned live objects, narrowed by the supplying capability. */
  readonly runtime: unknown;
}

/** One registry-owned compiled entry. */
export type ExperimentCompiledEntryV0 =
  | ExperimentCompiledSourceV0
  | ExperimentCompiledModelV0
  | ExperimentCompiledRepresentationV0;

/** Per-descriptor construction context handed to a capability. */
export interface ExperimentCompileContextV0 {
  /** Validated document ambient dimension. */
  readonly ambientDim: number;
  /** Document key being compiled. */
  readonly id: ExperimentId;
  /** RFC 6901 pointer to the descriptor for typed refusal evidence. */
  readonly pointer: string;
  /** Resolves an already compiled source dependency; never throws. */
  resolveSource(id: ExperimentId): ExperimentCompiledSourceV0 | undefined;
  /** Resolves an already compiled model dependency; never throws. */
  resolveModel(id: ExperimentId): ExperimentCompiledModelV0 | undefined;
}

/**
 * One explicit caller-supplied compiler capability.
 *
 * A capability is a plain value passed to `compileExperimentDocumentV0()`.
 * Documents can never name, request, or load one, and no global registry
 * exists. Category constructors are optional so a later capability may serve
 * only the categories it honestly implements; a claimed kind whose category
 * constructor is absent is refused during planning.
 */
export interface ExperimentDescriptorCompilerV0 {
  /** Kind namespace this capability serves, such as `core`. */
  readonly namespace: string;
  /** Exact kinds served, each mapped to its supported kind version. */
  readonly kinds: Readonly<Record<ExperimentDescriptorKind, number>>;
  /** Constructs one claimed source descriptor. */
  compileSource?(
    descriptor: ExperimentSourceDescriptorV0,
    context: ExperimentCompileContextV0
  ): ExperimentResult<ExperimentCompiledSourceV0>;
  /** Constructs one claimed model descriptor. */
  compileModel?(
    descriptor: ExperimentModelDescriptorV0,
    context: ExperimentCompileContextV0
  ): ExperimentResult<ExperimentCompiledModelV0>;
  /** Constructs one claimed representation descriptor. */
  compileRepresentation?(
    descriptor: ExperimentRepresentationDescriptorV0,
    context: ExperimentCompileContextV0
  ): ExperimentResult<ExperimentCompiledRepresentationV0>;
}

/** Evidence returned by exactly one successful disposal. */
export interface ExperimentCompilationDisposalV0 {
  /** Number of registry entries released. */
  readonly released: number;
}

/**
 * Registry-owned compilation of one prepared experiment document.
 *
 * The registry is the only owner of experiment ids: compiled core objects
 * remain anonymous mathematical values and are reached exclusively through
 * `get()`. Mathematical core types are never modified to carry experiment
 * identity.
 */
export interface ExperimentCompilationV0 {
  /** The deeply frozen prepared document this compilation was built from. */
  readonly document: ExperimentDocumentV0;
  /** Identity established at preparation; compilation does not re-hash. */
  readonly documentHash: `sha256:${string}`;
  /** Compiled ids in deterministic construction order. */
  readonly ids: readonly ExperimentId[];
  /** Whether `dispose()` has released the registry. */
  readonly disposed: boolean;
  /**
   * Document-level integer clock, counting accepted fixed steps from zero.
   *
   * It counts steps and not seconds: models declaring different `fixedStep`
   * durations advance the same number of steps of their own duration. Step
   * boundaries are the only points at which model state is meaningful.
   */
  readonly step: number;
  /**
   * Advances every compiled model by whole fixed steps, then the clock.
   *
   * A document with no models advances only the clock, which is honest rather
   * than an error: the clock is the document's, not any model's.
   */
  advance(steps: number): ExperimentResult<{ readonly step: number }>;
  /** Deterministic registry lookup with typed refusal evidence. */
  get(id: ExperimentId): ExperimentResult<ExperimentCompiledEntryV0>;
  /** Releases every compiled entry exactly once; repeat calls are refused. */
  dispose(): ExperimentResult<ExperimentCompilationDisposalV0>;
}

/** Options for one explicit-capability compilation. */
export interface CompileExperimentDocumentV0Options {
  /** Capabilities in caller precedence order; the first claim of a kind wins. */
  readonly compilers: readonly ExperimentDescriptorCompilerV0[];
}

/**
 * Compiles a prepared document into a registry of live core objects.
 *
 * Compilation is synchronous, all-or-nothing, and non-mutating: the document
 * is revalidated defensively, every descriptor in the derived dependency
 * order is planned against the supplied capabilities first, and any typed
 * failure — unknown kind, unclaimed kind, version mismatch, or a category
 * this slice cannot construct — refuses the whole compilation before any
 * object exists. Capabilities are copied, so caller mutation after the call
 * cannot reach an existing compilation, and separate compilations share no
 * state.
 *
 * The prepared `documentHash` is carried as the identity established by
 * `prepareExperimentDocumentV0()`; compilation verifies its shape but does
 * not re-hash, because hashing is preparation's asynchronous contract.
 */
export function compileExperimentDocumentV0(
  prepared: PreparedExperimentDocumentV0,
  options: CompileExperimentDocumentV0Options
): ExperimentResult<ExperimentCompilationV0> {
  const compilers = copyCompilers(options);
  if (typeof prepared !== 'object' || prepared === null) {
    return refused(failure(
      'invalid-type',
      'compileExperimentDocumentV0: prepared document must be an object',
      ''
    ));
  }
  if (typeof prepared.documentHash !== 'string' ||
    !DOCUMENT_HASH_PATTERN.test(prepared.documentHash)) {
    return refused(failure(
      'invalid-value',
      'compileExperimentDocumentV0: prepared documentHash is not a sha256 identity',
      '/documentHash'
    ));
  }

  const report = validateExperimentDocumentV0(prepared.document);
  if (!report.valid) {
    return { ok: false, failures: report.failures };
  }
  const document = prepared.document;

  const planned: PlannedDescriptor[] = [];
  const planningFailures: ExperimentFailure[] = [];
  for (const id of report.compileOrder) {
    const located = locateDescriptor(document, id);
    if (located === null) continue;
    const plan = planDescriptor(located, compilers);
    if (plan.ok) {
      planned.push(plan.value);
    } else {
      planningFailures.push(...plan.failures);
    }
  }
  if (planningFailures.length > 0) {
    return { ok: false, failures: Object.freeze(planningFailures) };
  }

  const registry = new Map<ExperimentId, ExperimentCompiledEntryV0>();
  for (const plan of planned) {
    const context: ExperimentCompileContextV0 = {
      ambientDim: document.ambientDim,
      id: plan.id,
      pointer: plan.pointer,
      resolveModel: (id) => {
        const entry = registry.get(id);
        return entry !== undefined && entry.category === 'model'
          ? entry
          : undefined;
      },
      resolveSource: (id) => {
        const entry = registry.get(id);
        return entry !== undefined && entry.category === 'source'
          ? entry
          : undefined;
      }
    };
    const compiled = plan.category === 'model'
      ? plan.compiler.compileModel!(
        plan.descriptor as ExperimentModelDescriptorV0,
        context
      )
      : plan.category === 'source'
      ? plan.compiler.compileSource!(
        plan.descriptor as ExperimentSourceDescriptorV0,
        context
      )
      : plan.compiler.compileRepresentation!(
        plan.descriptor as ExperimentRepresentationDescriptorV0,
        context
      );
    if (!compiled.ok) {
      return compiled;
    }
    const entry = compiled.value;
    if (entry.id !== plan.id || entry.category !== plan.category) {
      return refused(failure(
        'invalid-value',
        `capability for ${plan.descriptor.kind} returned a mismatched ` +
          `${entry.category} entry ${JSON.stringify(entry.id)}`,
        plan.pointer,
        { expectedId: plan.id, expectedCategory: plan.category }
      ));
    }
    registry.set(plan.id, entry);
  }

  return {
    ok: true,
    value: new ExperimentCompilation(
      document,
      prepared.documentHash,
      registry
    )
  };
}

interface PlannedDescriptor {
  readonly id: ExperimentId;
  readonly pointer: string;
  readonly category: ExperimentCompiledCategoryV0;
  readonly descriptor:
    | ExperimentSourceDescriptorV0
    | ExperimentModelDescriptorV0
    | ExperimentRepresentationDescriptorV0;
  readonly compiler: ExperimentDescriptorCompilerV0;
}

interface LocatedDescriptor {
  readonly id: ExperimentId;
  readonly pointer: string;
  readonly category: 'source' | 'model' | 'representation' | 'pane';
  readonly kind: ExperimentDescriptorKind;
  readonly kindVersion: number;
  readonly descriptor:
    | ExperimentSourceDescriptorV0
    | ExperimentModelDescriptorV0
    | ExperimentRepresentationDescriptorV0
    | null;
}

class ExperimentCompilation implements ExperimentCompilationV0 {
  readonly document: ExperimentDocumentV0;
  readonly documentHash: `sha256:${string}`;
  readonly ids: readonly ExperimentId[];
  private released = false;
  private clock = 0;
  private readonly registry: Map<ExperimentId, ExperimentCompiledEntryV0>;

  constructor(
    document: ExperimentDocumentV0,
    documentHash: `sha256:${string}`,
    registry: Map<ExperimentId, ExperimentCompiledEntryV0>
  ) {
    this.document = document;
    this.documentHash = documentHash;
    this.registry = registry;
    this.ids = Object.freeze([...registry.keys()]);
  }

  get disposed(): boolean {
    return this.released;
  }

  get step(): number {
    return this.clock;
  }

  advance(steps: number): ExperimentResult<{ readonly step: number }> {
    if (this.released) {
      return refused(failure(
        'disposed',
        'this experiment compilation has been disposed',
        '',
        { steps }
      ));
    }
    if (typeof steps !== 'number' || !Number.isSafeInteger(steps) || steps <= 0) {
      return refused(failure(
        'invalid-value',
        'advance requires a positive safe integer number of fixed steps',
        '',
        { steps }
      ));
    }
    // Every model advances before the clock moves, so a refusing model leaves
    // the clock where it was and the document is never ahead of its models.
    for (const entry of this.registry.values()) {
      if (entry.category !== 'model') continue;
      const advanced = entry.advanceModel(steps);
      if (!advanced.ok) return advanced;
    }
    this.clock += steps;
    return { ok: true, value: { step: this.clock } };
  }

  get(id: ExperimentId): ExperimentResult<ExperimentCompiledEntryV0> {
    if (this.released) {
      return refused(failure(
        'disposed',
        'this experiment compilation has been disposed',
        '',
        { id }
      ));
    }
    const entry = this.registry.get(id);
    if (entry === undefined) {
      return refused(failure(
        'missing-reference',
        `id ${JSON.stringify(id)} is not a compiled entry of this document`,
        '',
        { id }
      ));
    }
    return { ok: true, value: entry };
  }

  dispose(): ExperimentResult<ExperimentCompilationDisposalV0> {
    if (this.released) {
      return refused(failure(
        'disposed',
        'this experiment compilation has already been disposed',
        ''
      ));
    }
    const released = this.registry.size;
    this.registry.clear();
    this.released = true;
    return { ok: true, value: Object.freeze({ released }) };
  }
}

function copyCompilers(
  options: CompileExperimentDocumentV0Options
): readonly ExperimentDescriptorCompilerV0[] {
  if (typeof options !== 'object' || options === null ||
    !Array.isArray(options.compilers)) {
    throw new TypeError(
      'compileExperimentDocumentV0: options.compilers must be an array'
    );
  }
  for (const compiler of options.compilers) {
    if (typeof compiler !== 'object' || compiler === null ||
      typeof compiler.namespace !== 'string' ||
      typeof compiler.kinds !== 'object' || compiler.kinds === null ||
      (compiler.compileSource !== undefined &&
        typeof compiler.compileSource !== 'function') ||
      (compiler.compileModel !== undefined &&
        typeof compiler.compileModel !== 'function') ||
      (compiler.compileRepresentation !== undefined &&
        typeof compiler.compileRepresentation !== 'function')) {
      throw new TypeError(
        'compileExperimentDocumentV0: every compiler must declare a string ' +
          'namespace, a kinds record, and function category constructors'
      );
    }
  }
  return Object.freeze([...options.compilers]);
}

function locateDescriptor(
  document: ExperimentDocumentV0,
  id: ExperimentId
): LocatedDescriptor | null {
  const source = document.sources[id];
  if (source !== undefined) {
    return {
      id,
      pointer: `/sources/${escapePointer(id)}`,
      category: 'source',
      kind: source.kind,
      kindVersion: source.kindVersion ?? 0,
      descriptor: source
    };
  }
  const model = document.models?.[id];
  if (model !== undefined) {
    return {
      id,
      pointer: `/models/${escapePointer(id)}`,
      category: 'model',
      kind: model.kind,
      kindVersion: model.kindVersion ?? 0,
      descriptor: model
    };
  }
  const representation = document.representations[id];
  if (representation !== undefined) {
    return {
      id,
      pointer: `/representations/${escapePointer(id)}`,
      category: 'representation',
      kind: representation.kind,
      kindVersion: representation.kindVersion ?? 0,
      descriptor: representation
    };
  }
  const panes = document.presentation?.panes ?? [];
  for (let index = 0; index < panes.length; index++) {
    const pane = panes[index]!;
    if (pane.id === id) {
      return {
        id,
        pointer: `/presentation/panes/${index}`,
        category: 'pane',
        kind: pane.kind,
        kindVersion: pane.kindVersion ?? 0,
        descriptor: null
      };
    }
  }
  return null;
}

function planDescriptor(
  located: LocatedDescriptor,
  compilers: readonly ExperimentDescriptorCompilerV0[]
): ExperimentResult<PlannedDescriptor> {
  const namespace = located.kind.split('.')[0] ?? '';
  if (!KNOWN_NAMESPACES.has(namespace)) {
    return refused(failure(
      'unknown-kind',
      `descriptor kind ${JSON.stringify(located.kind)} has no known namespace`,
      `${located.pointer}/kind`,
      { kind: located.kind, namespace }
    ));
  }
  const compiler = compilers.find((candidate) =>
    Object.prototype.hasOwnProperty.call(candidate.kinds, located.kind)
  );
  if (compiler === undefined) {
    return refused(failure(
      'capability-unavailable',
      `no supplied capability compiles ${JSON.stringify(located.kind)}`,
      `${located.pointer}/kind`,
      { kind: located.kind, namespace, category: located.category }
    ));
  }
  const supported = compiler.kinds[located.kind]!;
  if (supported !== located.kindVersion) {
    return refused(failure(
      'kind-version-mismatch',
      `capability ${compiler.namespace} supports ` +
        `${JSON.stringify(located.kind)} version ${supported}, ` +
        `document declares ${located.kindVersion}`,
      `${located.pointer}/kind`,
      { kind: located.kind, declared: located.kindVersion, supported }
    ));
  }
  if (located.category === 'pane') {
    return refused(failure(
      'capability-unavailable',
      `this compilation slice constructs sources, models, and representations ` +
        `only; pane ${JSON.stringify(located.id)} has no constructor seam yet`,
      `${located.pointer}/kind`,
      { kind: located.kind, category: located.category }
    ));
  }
  const constructor = located.category === 'source'
    ? compiler.compileSource
    : located.category === 'model'
      ? compiler.compileModel
      : compiler.compileRepresentation;
  if (constructor === undefined) {
    return refused(failure(
      'capability-unavailable',
      `capability ${compiler.namespace} claims ` +
        `${JSON.stringify(located.kind)} but supplies no ` +
        `${located.category} constructor`,
      `${located.pointer}/kind`,
      { kind: located.kind, category: located.category }
    ));
  }
  return {
    ok: true,
    value: {
      id: located.id,
      pointer: located.pointer,
      category: located.category,
      descriptor: located.descriptor!,
      compiler
    }
  };
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
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
