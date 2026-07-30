import {
  VecN,
  createAffineSectionCellChart4N,
  resolveRepresentationChartPointToSourceCellN,
  sliceTetrahedra
} from '@holotope/core';
import {
  decodeFloat64BufferV0,
  encodeFloat64BufferV0
} from './binary.js';
import {
  validateExperimentJsonAgainstSchemaV0
} from './schema-instance.js';
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
  ExperimentActionDeclarationV0,
  ExperimentActionOperationV0,
  ExperimentId,
  ExperimentJsonValue,
  ExperimentModelDescriptorV0,
  ExperimentObservationDeclarationV0,
  ExperimentObservationSourceV0,
  ExperimentParameterDeclarationV0,
  ExperimentParameterTargetV0,
  ExperimentParameterValueDeclarationV0,
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
  /**
   * Applies one authored model field, returning what it replaced.
   *
   * Optional: a model kind that exposes no writable field simply omits it,
   * and a parameter aimed at one refuses rather than silently doing nothing.
   */
  applyModelField?(
    field: string,
    value: ExperimentJsonValue
  ): ExperimentResult<{ readonly previous: ExperimentJsonValue }>;
  /**
   * Reads one live model field without changing model or compilation state.
   *
   * Optional for model kinds that expose no parameter-readable fields.
   */
  readModelField?(
    field: string
  ): ExperimentResult<ExperimentJsonValue>;
  /**
   * Evaluates one model quantity as a JSON-compatible value.
   *
   * Optional for the same reason: an unobservable model refuses by absence
   * rather than by returning something invented.
   */
  observeModel?(quantity: string): ExperimentResult<ExperimentJsonValue>;
  /**
   * Captures everything needed to reproduce this model bitwise.
   *
   * Optional like the other seams: a model kind that cannot capture its own
   * state makes `snapshot()` refuse by name rather than silently producing an
   * incomplete capture that would replay wrongly.
   */
  captureModelState?(): ExperimentResult<ExperimentModelStateV0>;
  /**
   * Writes a captured state back exactly.
   *
   * Values are restored as captured — a rotor pair is not renormalized on the
   * way in, because a bitwise round trip is the contract and a correction
   * would silently break it.
   */
  restoreModelState?(
    state: ExperimentModelStateV0
  ): ExperimentResult<{ readonly modelStep: number }>;
}

/**
 * How faithfully a snapshot can be reproduced.
 *
 * Ordered `exact-cpu > numeric-equivalent > presentation-only`. This slice
 * emits only `exact-cpu`; the weaker levels are the contract future backend
 * and provider-state slices will produce, and are not yet reachable.
 */
export type ExperimentReplayLevelV0 =
  | 'exact-cpu'
  | 'numeric-equivalent'
  | 'presentation-only';

/** One field of a captured state: its name and how many values it occupies. */
export interface ExperimentStateFieldV0 {
  /** Field name, so a layout change is visible rather than silent. */
  readonly field: string;
  /** Number of consecutive values the field occupies. */
  readonly length: number;
}

/** One capability-captured model state, self-describing enough to restore. */
export interface ExperimentModelStateV0 {
  /** Construction kind that produced the model, checked on restore. */
  readonly kind: ExperimentDescriptorKind;
  /** The model's own step count at capture. */
  readonly modelStep: number;
  /** Field names and lengths, in value order. */
  readonly layout: readonly ExperimentStateFieldV0[];
  /** Flat finite Float64 values matching the layout. */
  readonly values: ArrayLike<number>;
}

/** One captured registry entry and the buffer holding its values. */
export interface ExperimentSnapshotEntryV0 {
  /** Registry id the state belongs to. */
  readonly id: ExperimentId;
  /** Which registry category was captured. */
  readonly category: 'model' | 'representation';
  /** Construction kind, checked on restore. */
  readonly kind: ExperimentDescriptorKind;
  /** Present for models only: the model's own step count. */
  readonly modelStep?: number;
  /** Field names and lengths, in value order. */
  readonly layout: readonly ExperimentStateFieldV0[];
  /** Index into the snapshot's buffers. */
  readonly buffer: number;
}

/**
 * A complete capture of layer-2 state at one step boundary.
 *
 * Numeric state never passes through JSON numbers: buffers are little-endian
 * Float64 in base64, referenced by index, so `-0`, denormals, and exact bit
 * patterns survive a round trip that JSON text could not promise.
 *
 * @example
 * A snapshot is plain JSON, so it can be written to a file or sent over a
 * wire and restored later — the numeric fidelity travels in the buffers
 * rather than in JSON numbers:
 * ```ts
 * const prepared = await prepareExperimentDocumentV0({
 *   schema: 'holotope.experiment/0',
 *   title: 'Section control',
 *   ambientDim: 4,
 *   sources: { tesseract: { kind: 'core.source.hypercube', dim: 4, size: 2 } },
 *   representations: {
 *     section: {
 *       kind: 'core.representation.section4',
 *       source: 'tesseract',
 *       normal: [0, 0, 0, 1],
 *       offset: 0.12,
 *       frame: 'canonical'
 *     }
 *   },
 *   parameters: [{
 *     id: 'sliceOffset',
 *     label: 'Slice offset',
 *     value: { type: 'number', default: 0.12, min: -1, max: 1 },
 *     dimension: 'length',
 *     frame: { space: 'ambient', dim: 4 },
 *     unit: 'm',
 *     target: { kind: 'representation-field', ref: 'section', field: 'offset' }
 *   }]
 * });
 * if (!prepared.ok) return;
 * const compiled = compileExperimentDocumentV0(prepared.value, {
 *   compilers: [coreExperimentCompilerV0()]
 * });
 * if (!compiled.ok) return;
 * const compilation = compiled.value;
 *
 * const taken = compilation.snapshot();
 * if (taken.ok) {
 *   taken.value.schema; // 'holotope.snapshot/0'
 *   taken.value.level; // 'exact-cpu'
 *   JSON.parse(JSON.stringify(taken.value)); // survives a text round trip
 * }
 * ```
 */
export interface ExperimentSnapshotV0 {
  /** Snapshot schema identity. */
  readonly schema: 'holotope.snapshot/0';
  /** Identity of the document this state belongs to; the only restore key. */
  readonly documentHash: `sha256:${string}`;
  /** Document clock step at capture; restore sets the clock from it. */
  readonly step: number;
  /** Revision at capture, retained as evidence and never restored. */
  readonly revision: number;
  /** Fidelity this capture can be reproduced at. */
  readonly level: ExperimentReplayLevelV0;
  /** Captured entries in registry order. */
  readonly entries: readonly ExperimentSnapshotEntryV0[];
  /** Base64 little-endian Float64 payloads, one per referenced index. */
  readonly buffers: readonly string[];
}

/** One recorded accepted mutation. */
export interface ExperimentTraceEventV0 {
  /** Monotone position in the recording. */
  readonly ordinal: number;
  /** Document clock step after the mutation was accepted. */
  readonly step: number;
  /**
   * Which public mutation path produced it.
   *
   * `restore` is recorded because a restore moves state as decisively as any
   * other mutation: a trace that omitted it would replay a different run
   * while claiming to reproduce this one.
   */
  readonly kind: 'set-parameter' | 'advance' | 'restore';
  /** Parameter id; absent for an advance or a restore. */
  readonly id?: ExperimentId;
  /**
   * The applied value, the step count for an advance, or the complete
   * snapshot for a restore — snapshots being JSON-compatible by
   * construction, which is what keeps a trace self-contained.
   */
  readonly value: ExperimentJsonValue;
}

/**
 * An initial snapshot and every accepted mutation since.
 *
 * Replay re-executes the events through the ordinary public paths rather than
 * writing state directly, so a trace can only reproduce what the runtime
 * would have done anyway.
 */
export interface ExperimentTraceV0 {
  /** Trace schema identity. */
  readonly schema: 'holotope.trace/0';
  /** Identity of the document the trace belongs to. */
  readonly documentHash: `sha256:${string}`;
  /** State the recording began from. */
  readonly initial: ExperimentSnapshotV0;
  /** Accepted mutations in ordinal order. */
  readonly events: readonly ExperimentTraceEventV0[];
}

/**
 * Evidence from exactly one action invocation.
 *
 * @example
 * A budget is checked before anything runs, so an over-budget request costs
 * nothing rather than being stopped part-way:
 * ```ts
 * const prepared = await prepareExperimentDocumentV0({
 *   schema: 'holotope.experiment/0',
 *   title: 'Section control',
 *   ambientDim: 4,
 *   sources: { tesseract: { kind: 'core.source.hypercube', dim: 4, size: 2 } },
 *   representations: {
 *     section: {
 *       kind: 'core.representation.section4',
 *       source: 'tesseract',
 *       normal: [0, 0, 0, 1],
 *       offset: 0.12,
 *       frame: 'canonical'
 *     }
 *   },
 *   parameters: [{
 *     id: 'sliceOffset',
 *     label: 'Slice offset',
 *     value: { type: 'number', default: 0.12, min: -1, max: 1 },
 *     dimension: 'length',
 *     frame: { space: 'ambient', dim: 4 },
 *     unit: 'm',
 *     target: { kind: 'representation-field', ref: 'section', field: 'offset' }
 *   }]
 * });
 * if (!prepared.ok) return;
 * const compiled = compileExperimentDocumentV0(prepared.value, {
 *   compilers: [coreExperimentCompilerV0()]
 * });
 * if (!compiled.ok) return;
 * const compilation = compiled.value;
 *
 * const refused = compilation.invoke('step', { steps: 10_000 });
 * refused.outcome; // 'refused'
 * refused.failure?.code; // 'budget-exceeded'
 * refused.step; // unchanged
 * ```
 *
 * @example
 * A preview runs the operation for real and puts everything back, so it is
 * exactly as accurate as a commit while leaving nothing behind:
 * ```ts
 * const prepared = await prepareExperimentDocumentV0({
 *   schema: 'holotope.experiment/0',
 *   title: 'Section control',
 *   ambientDim: 4,
 *   sources: { tesseract: { kind: 'core.source.hypercube', dim: 4, size: 2 } },
 *   representations: {
 *     section: {
 *       kind: 'core.representation.section4',
 *       source: 'tesseract',
 *       normal: [0, 0, 0, 1],
 *       offset: 0.12,
 *       frame: 'canonical'
 *     }
 *   },
 *   parameters: [{
 *     id: 'sliceOffset',
 *     label: 'Slice offset',
 *     value: { type: 'number', default: 0.12, min: -1, max: 1 },
 *     dimension: 'length',
 *     frame: { space: 'ambient', dim: 4 },
 *     unit: 'm',
 *     target: { kind: 'representation-field', ref: 'section', field: 'offset' }
 *   }]
 * });
 * if (!prepared.ok) return;
 * const compiled = compileExperimentDocumentV0(prepared.value, {
 *   compilers: [coreExperimentCompilerV0()]
 * });
 * if (!compiled.ok) return;
 * const compilation = compiled.value;
 *
 * const previewed = compilation.invoke('step', { steps: 40 }, { mode: 'preview' });
 * previewed.outcome; // 'previewed'
 * previewed.revision === compilation.revision; // true — nothing moved
 * ```
 */
export interface ExperimentActionResultV0 {
  /** Document key of the invoked action. */
  readonly action: ExperimentId;
  /**
   * What the invocation did.
   *
   * There is no rolled-back outcome: every operation is exactly one atomic
   * primitive, so there is no partial state for a rollback to undo. It
   * becomes reachable only if composite actions ever exist.
   */
  readonly outcome: 'applied' | 'previewed' | 'refused';
  /** Result value conforming to the declared output schema. */
  readonly output?: ExperimentJsonValue;
  /** Compilation revision after the call; unchanged on preview and refusal. */
  readonly revision: number;
  /** Document clock step after the call. */
  readonly step: number;
  /** Typed reason the invocation was refused. */
  readonly failure?: ExperimentFailure;
}

/** What a restore or replay established. */
export interface ExperimentReplayOutcomeV0 {
  /** Fidelity actually achieved. */
  readonly level: ExperimentReplayLevelV0;
  /** Document clock step afterwards. */
  readonly step: number;
  /** Compilation revision afterwards. */
  readonly revision: number;
}

/**
 * Evidence from exactly one parameter application attempt.
 *
 * @example
 * State is read through to the compiled object, so `previous` is what a read
 * would have returned rather than a remembered copy — and a refusal leaves
 * the target and the revision exactly as they were:
 * ```ts
 * const prepared = await prepareExperimentDocumentV0({
 *   schema: 'holotope.experiment/0',
 *   title: 'Section control',
 *   ambientDim: 4,
 *   sources: { tesseract: { kind: 'core.source.hypercube', dim: 4, size: 2 } },
 *   representations: {
 *     section: {
 *       kind: 'core.representation.section4',
 *       source: 'tesseract',
 *       normal: [0, 0, 0, 1],
 *       offset: 0.12,
 *       frame: 'canonical'
 *     }
 *   },
 *   parameters: [{
 *     id: 'sliceOffset',
 *     label: 'Slice offset',
 *     value: { type: 'number', default: 0.12, min: -1, max: 1 },
 *     dimension: 'length',
 *     frame: { space: 'ambient', dim: 4 },
 *     unit: 'm',
 *     target: { kind: 'representation-field', ref: 'section', field: 'offset' }
 *   }]
 * });
 * if (!prepared.ok) return;
 * const compiled = compileExperimentDocumentV0(prepared.value, {
 *   compilers: [coreExperimentCompilerV0()]
 * });
 * if (!compiled.ok) return;
 * const compilation = compiled.value;
 *
 * const applied = compilation.setParameter('sliceOffset', 0.62);
 * applied.outcome; // 'applied'
 * applied.previous; // 0.12
 * applied.revision; // 2
 *
 * const refused = compilation.setParameter('sliceOffset', 1.4);
 * refused.outcome; // 'refused'
 * refused.failure?.code; // 'out-of-range'
 * refused.previous; // undefined — nothing was read because nothing was written
 * compilation.revision; // still 2
 * ```
 */
export interface ExperimentParameterApplicationV0 {
  /** Document key of the parameter that was applied. */
  readonly parameter: ExperimentId;
  /** Whether the live target actually changed. */
  readonly outcome: 'applied' | 'refused';
  /**
   * Live target value read immediately before application.
   *
   * Absent on refusal. State is read through to the compiled object, so this
   * is exactly what a read would have returned, not a remembered copy.
   */
  readonly previous?: ExperimentJsonValue;
  /** Compilation revision after the call; unchanged on refusal. */
  readonly revision: number;
  /** Typed reason the application was refused. */
  readonly failure?: ExperimentFailure;
}

/** One live parameter value read without changing experiment state. */
export interface ExperimentParameterRecordV0 {
  /** Document key of the parameter that was read. */
  readonly id: ExperimentId;
  /** Current value read through to the compiled target. */
  readonly value: ExperimentJsonValue;
  /** Compilation revision at which the value was read. */
  readonly revision: number;
}

/**
 * One freshly computed observation value with the state it was computed at.
 *
 * Values are never memoized in this slice, so a record is always current at
 * the moment it was taken. Staleness is the caller's comparison to make:
 * `record.revision < compilation.revision` means something has changed since.
 *
 * @example
 * A record is stamped with the state it was computed at, so staleness is a
 * comparison rather than a flag to trust:
 * ```ts
 * const prepared = await prepareExperimentDocumentV0({
 *   schema: 'holotope.experiment/0',
 *   title: 'Section control',
 *   ambientDim: 4,
 *   sources: { tesseract: { kind: 'core.source.hypercube', dim: 4, size: 2 } },
 *   representations: {
 *     section: {
 *       kind: 'core.representation.section4',
 *       source: 'tesseract',
 *       normal: [0, 0, 0, 1],
 *       offset: 0.12,
 *       frame: 'canonical'
 *     }
 *   },
 *   parameters: [{
 *     id: 'sliceOffset',
 *     label: 'Slice offset',
 *     value: { type: 'number', default: 0.12, min: -1, max: 1 },
 *     dimension: 'length',
 *     frame: { space: 'ambient', dim: 4 },
 *     unit: 'm',
 *     target: { kind: 'representation-field', ref: 'section', field: 'offset' }
 *   }]
 * });
 * if (!prepared.ok) return;
 * const compiled = compileExperimentDocumentV0(prepared.value, {
 *   compilers: [coreExperimentCompilerV0()]
 * });
 * if (!compiled.ok) return;
 * const compilation = compiled.value;
 *
 * const record = compilation.observe('sectionTriangles');
 * if (record.ok) {
 *   record.value.revision; // the revision it was computed at
 *   record.value.step; // the clock step it was computed at
 *   // Staleness is this comparison, not a flag the record carries.
 *   record.value.revision < compilation.revision;
 * }
 * ```
 */
export interface ExperimentObservationRecordV0 {
  /** Document key of the observation. */
  readonly id: ExperimentId;
  /** Frozen JSON-compatible value, shaped by the declaration. */
  readonly value: ExperimentJsonValue;
  /** Revision the value was computed at. */
  readonly revision: number;
  /** Document clock step the value was computed at. */
  readonly step: number;
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
  /**
   * Monotone counter over accepted mutations, starting at 1 on compilation.
   *
   * Every accepted `setParameter` and `advance` bumps it exactly once. A
   * refusal never does, and never partially applies.
   */
  readonly revision: number;
  /** Frozen view of the document's parameter declarations, for discovery. */
  listParameters(): readonly ExperimentParameterDeclarationV0[];
  /** Frozen view of the document's action declarations, for discovery. */
  listActions(): readonly ExperimentActionDeclarationV0[];
  /** Frozen view of the document's observation declarations, for discovery. */
  listObservations(): readonly ExperimentObservationDeclarationV0[];
  /** Reads one current parameter value without mutation or a revision bump. */
  readParameter(
    id: ExperimentId
  ): ExperimentResult<ExperimentParameterRecordV0>;
  /** Validates a value against its declared domain and applies it. */
  setParameter(
    id: ExperimentId,
    value: ExperimentJsonValue
  ): ExperimentParameterApplicationV0;
  /** Computes one observation freshly, stamped with revision and step. */
  observe(id: ExperimentId): ExperimentResult<ExperimentObservationRecordV0>;
  /** Captures complete layer-2 state at the current step boundary. */
  snapshot(): ExperimentResult<ExperimentSnapshotV0>;
  /**
   * Restores a snapshot of this same document, transactionally.
   *
   * `step` is simulated time, so it is set from the snapshot along with every
   * model's own step. `revision` is this process's mutation counter rather
   * than state, so it bumps once like any accepted mutation. Restoring the
   * initial snapshot is how a compilation is reset; there is no separate
   * reset, because one would be the same operation under another name.
   */
  restore(
    snapshot: ExperimentSnapshotV0,
    options?: { readonly require?: ExperimentReplayLevelV0 }
  ): ExperimentResult<ExperimentReplayOutcomeV0>;
  /** The initial snapshot and every accepted mutation since compilation. */
  trace(): ExperimentResult<ExperimentTraceV0>;
  /**
   * Restores a trace's initial state and re-executes its events.
   *
   * Events run through the ordinary `setParameter` and `advance` paths, so a
   * replay can only reproduce what the runtime would have done anyway. A
   * refused event aborts and names its ordinal; state stays where the last
   * accepted event left it, replay being a sequence of ordinary mutations
   * rather than one transaction.
   */
  replay(
    trace: ExperimentTraceV0,
    options?: { readonly require?: ExperimentReplayLevelV0 }
  ): ExperimentResult<ExperimentReplayOutcomeV0>;
  /**
   * Validates and runs one declared action.
   *
   * `preview` evaluates the operation and puts everything back, so a preview
   * is unobservable: state, revision, and trace are what they were. It
   * requires the declaration to say `supportsPreview`, since only the author
   * knows whether evaluating is meaningful without committing.
   */
  invoke(
    id: ExperimentId,
    args?: ExperimentJsonValue,
    options?: { readonly mode?: 'preview' | 'commit' }
  ): ExperimentActionResultV0;
  /** Deterministic registry lookup with typed refusal evidence. */
  get(id: ExperimentId): ExperimentResult<ExperimentCompiledEntryV0>;
  /** Releases every compiled entry exactly once; repeat calls are refused. */
  dispose(): ExperimentResult<ExperimentCompilationDisposalV0>;
}

/** Options for one explicit-capability compilation. */
export interface CompileExperimentDocumentV0Options {
  /** Capabilities in caller precedence order; the first claim of a kind wins. */
  readonly compilers: readonly ExperimentDescriptorCompilerV0[];
  /**
   * Recorded-event ceiling; default 1,000,000.
   *
   * Recording stops at the bound and the runtime keeps mutating normally, but
   * `trace()` then refuses: returning a truncated trace would offer a replay
   * that reproduces a different run.
   */
  readonly maxTraceEvents?: number;
}

/**
 * Compiles a prepared document into a registry of live core objects.
 *
 * Compilation is synchronous, all-or-nothing, and non-mutating: the document
 * is revalidated defensively, every descriptor in the derived dependency
 * order is planned against the supplied capabilities first, and any typed
 * failure — unknown kind, unclaimed kind, version mismatch, or an unsupported
 * runtime category — refuses the whole compilation before any object exists.
 * Valid presentation panes are retained on `document` and deliberately
 * deferred to a renderer adapter; they are not registry entries. Capabilities
 * are copied, so caller mutation after the call cannot reach an existing
 * compilation, and separate compilations share no state.
 *
 * The prepared `documentHash` is carried as the identity established by
 * `prepareExperimentDocumentV0()`; compilation verifies its shape but does
 * not re-hash, because hashing is preparation's asynchronous contract.
  *
 * @example
 * The caller states what the environment can build; the document can never
 * name, request, or load a capability:
 * ```ts
 * const prepared = await prepareExperimentDocumentV0({
 *   schema: 'holotope.experiment/0',
 *   title: 'Bridge',
 *   ambientDim: 4,
 *   sources: { tesseract: { kind: 'core.source.hypercube', dim: 4, size: 2 } },
 *   representations: {
 *     view: {
 *       kind: 'core.representation.perspective',
 *       source: 'tesseract',
 *       fromDim: 4,
 *       viewDistance: 5.4,
 *       product: 'both'
 *     }
 *   }
 * });
 * if (!prepared.ok) return;
 *
 * const compiled = compileExperimentDocumentV0(prepared.value, {
 *   compilers: [coreExperimentCompilerV0()]
 * });
 *
 * if (compiled.ok) {
 *   compiled.value.ids; // registry ids in dependency order
 *   compiled.value.dispose(); // releases the registry exactly once
 * }
 * ```
 *
 * @example
 * Compilation is all-or-nothing. A kind no supplied capability claims refuses
 * the whole document with pointer-addressed evidence, before any object
 * exists — so there is never a half-built registry to reason about:
 * ```ts
 * const prepared = await prepareExperimentDocumentV0({
 *   schema: 'holotope.experiment/0',
 *   title: 'Bridge',
 *   ambientDim: 4,
 *   sources: { tesseract: { kind: 'core.source.hypercube', dim: 4, size: 2 } },
 *   representations: {
 *     view: {
 *       kind: 'core.representation.perspective',
 *       source: 'tesseract',
 *       fromDim: 4,
 *       viewDistance: 5.4,
 *       product: 'both'
 *     }
 *   }
 * });
 * if (!prepared.ok) return;
 *
 * const refused = compileExperimentDocumentV0(prepared.value, { compilers: [] });
 *
 * refused.ok; // false
 * if (!refused.ok) {
 *   refused.failures[0]?.code; // 'capability-unavailable'
 * }
 * ```
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
    // Presentation belongs to a renderer/workbench layer. The complete
    // descriptor stays on `compilation.document`, while the headless registry
    // owns only source, model, and representation objects.
    if (located.category === 'pane') continue;
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
      registry,
      options.maxTraceEvents ?? 1_000_000
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
  private revisionCounter = 1;
  private readonly events: ExperimentTraceEventV0[] = [];
  private readonly maxTraceEvents: number;
  /** Eager capture, so a trace always has a state to replay from. */
  private readonly initialSnapshot: ExperimentSnapshotV0 | null;
  /** Why the eager capture failed, retained so `trace()` can say. */
  private readonly initialFailure: ExperimentFailure | null;
  private recordingComplete = true;
  /**
   * Whether a restore should be recorded.
   *
   * Cleared while replay restores the trace's own initial snapshot, and while
   * a preview restores its capture: neither is a mutation the caller made, and
   * recording them would grow the trace on every replay.
   */
  private recordRestores = true;
  private readonly registry: Map<ExperimentId, ExperimentCompiledEntryV0>;

  constructor(
    document: ExperimentDocumentV0,
    documentHash: `sha256:${string}`,
    registry: Map<ExperimentId, ExperimentCompiledEntryV0>,
    maxTraceEvents: number
  ) {
    this.document = document;
    this.documentHash = documentHash;
    this.registry = registry;
    this.ids = Object.freeze([...registry.keys()]);
    this.maxTraceEvents = maxTraceEvents;
    // Taken now rather than on demand: a trace recorded from the first
    // mutation needs the state that preceded it, which is gone by then.
    const captured = this.capture();
    this.initialSnapshot = captured.ok ? captured.value : null;
    this.initialFailure = captured.ok ? null : captured.failures[0]!;
  }

  get disposed(): boolean {
    return this.released;
  }

  get step(): number {
    return this.clock;
  }

  get revision(): number {
    return this.revisionCounter;
  }

  listParameters(): readonly ExperimentParameterDeclarationV0[] {
    return Object.freeze([...(this.document.parameters ?? [])]);
  }

  listActions(): readonly ExperimentActionDeclarationV0[] {
    return Object.freeze([...(this.document.actions ?? [])]);
  }

  listObservations(): readonly ExperimentObservationDeclarationV0[] {
    return Object.freeze([...(this.document.observations ?? [])]);
  }

  readParameter(
    id: ExperimentId
  ): ExperimentResult<ExperimentParameterRecordV0> {
    if (this.released) {
      return refused(failure(
        'disposed',
        'this experiment compilation has been disposed',
        '',
        { id }
      ));
    }
    const declarations = this.document.parameters ?? [];
    const index = declarations.findIndex((candidate) => candidate.id === id);
    const declaration = declarations[index];
    if (declaration === undefined) {
      return refused(failure(
        'missing-reference',
        `parameter ${JSON.stringify(id)} is not declared by this document`,
        '',
        { id }
      ));
    }
    const read = readParameterTarget(
      declaration.target,
      this.registry,
      `/parameters/${index}`
    );
    if (!read.ok) return read;
    return {
      ok: true,
      value: Object.freeze({
        id,
        value: read.value,
        revision: this.revisionCounter
      })
    };
  }

  setParameter(
    id: ExperimentId,
    value: ExperimentJsonValue
  ): ExperimentParameterApplicationV0 {
    const refuse = (failed: ExperimentFailure): ExperimentParameterApplicationV0 =>
      Object.freeze({
        parameter: id,
        outcome: 'refused' as const,
        revision: this.revisionCounter,
        failure: failed
      });

    if (this.released) {
      return refuse(failure('disposed', 'this experiment compilation has been disposed', '', { id }));
    }
    const declarations = this.document.parameters ?? [];
    const index = declarations.findIndex((candidate) => candidate.id === id);
    const declaration = declarations[index];
    if (declaration === undefined) {
      return refuse(failure(
        'missing-reference',
        `parameter ${JSON.stringify(id)} is not declared by this document`,
        '',
        { id }
      ));
    }
    const pointer = `/parameters/${index}`;
    const domain = validateParameterValue(declaration.value, value, `${pointer}/value`);
    if (!domain.ok) return refuse(domain.failures[0]!);

    const applied = applyParameterTarget(
      declaration.target,
      domain.value,
      this.registry,
      pointer
    );
    if (!applied.ok) return refuse(applied.failures[0]!);

    // Only an accepted application moves the revision, so a caller comparing
    // a record against it cannot be told something changed when nothing did.
    this.revisionCounter += 1;
    this.record({ kind: 'set-parameter', id, value: domain.value });
    return Object.freeze({
      parameter: id,
      outcome: 'applied' as const,
      previous: applied.value.previous,
      revision: this.revisionCounter
    });
  }

  observe(id: ExperimentId): ExperimentResult<ExperimentObservationRecordV0> {
    if (this.released) {
      return refused(failure(
        'disposed',
        'this experiment compilation has been disposed',
        '',
        { id }
      ));
    }
    const declarations = this.document.observations ?? [];
    const index = declarations.findIndex((candidate) => candidate.id === id);
    const declaration = declarations[index];
    if (declaration === undefined) {
      return refused(failure(
        'missing-reference',
        `observation ${JSON.stringify(id)} is not declared by this document`,
        '',
        { id }
      ));
    }
    const evaluated = evaluateObservation(
      declaration.source,
      this.registry,
      `/observations/${index}/source`
    );
    if (!evaluated.ok) return evaluated;
    return {
      ok: true,
      value: Object.freeze({
        id,
        value: evaluated.value,
        revision: this.revisionCounter,
        step: this.clock
      })
    };
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
    this.revisionCounter += 1;
    this.record({ kind: 'advance', value: steps });
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


  private record(
    event: {
      kind: ExperimentTraceEventV0['kind'];
      id?: ExperimentId;
      value: ExperimentJsonValue;
    }
  ): void {
    if (!this.recordingComplete) return;
    if (this.events.length >= this.maxTraceEvents) {
      // Stop recording but keep mutating: the run is still valid, only its
      // trace is no longer complete, and `trace()` refuses rather than
      // handing back a prefix that would replay a different run.
      this.recordingComplete = false;
      return;
    }
    this.events.push(Object.freeze({
      ordinal: this.events.length,
      step: this.clock,
      kind: event.kind,
      ...(event.id === undefined ? {} : { id: event.id }),
      value: event.value
    }));
  }

  /** Captures current state without touching the clock or revision. */
  private capture(): ExperimentResult<ExperimentSnapshotV0> {
    const entries: ExperimentSnapshotEntryV0[] = [];
    const buffers: string[] = [];

    for (const [id, entry] of this.registry) {
      if (entry.category === 'model') {
        if (entry.captureModelState === undefined) {
          return refused(failure(
            'capability-unavailable',
            `the capability compiling ${JSON.stringify(entry.kind)} cannot ` +
              `capture model state, so ${JSON.stringify(id)} has none to snapshot`,
            '',
            { id, kind: entry.kind }
          ));
        }
        const state = entry.captureModelState();
        if (!state.ok) return state;
        entries.push(Object.freeze({
          id,
          category: 'model' as const,
          kind: entry.kind,
          modelStep: state.value.modelStep,
          layout: Object.freeze(
            state.value.layout.map((field) => Object.freeze({ ...field }))
          ),
          buffer: buffers.length
        }));
        buffers.push(encodeFloat64BufferV0(state.value.values));
        continue;
      }
      if (entry.category !== 'representation') continue;

      const captured = captureRepresentationState(entry);
      entries.push(Object.freeze({
        id,
        category: 'representation' as const,
        kind: entry.kind,
        layout: Object.freeze(
          captured.layout.map((field) => Object.freeze({ ...field }))
        ),
        buffer: buffers.length
      }));
      buffers.push(encodeFloat64BufferV0(captured.values));
    }

    return {
      ok: true,
      value: Object.freeze({
        schema: 'holotope.snapshot/0' as const,
        documentHash: this.documentHash,
        step: this.clock,
        revision: this.revisionCounter,
        // Every capture in this slice is a complete CPU Float64 capture.
        level: 'exact-cpu' as const,
        entries: Object.freeze(entries),
        buffers: Object.freeze(buffers)
      })
    };
  }

  snapshot(): ExperimentResult<ExperimentSnapshotV0> {
    if (this.released) {
      return refused(failure('disposed', 'this experiment compilation has been disposed'));
    }
    return this.capture();
  }

  restore(
    snapshot: ExperimentSnapshotV0,
    options: { readonly require?: ExperimentReplayLevelV0 } = {}
  ): ExperimentResult<ExperimentReplayOutcomeV0> {
    if (this.released) {
      return refused(failure('disposed', 'this experiment compilation has been disposed'));
    }
    const checked = this.validateSnapshot(snapshot, options.require);
    if (!checked.ok) return checked;

    // A defensive capture first, so a failure part-way through can put back
    // exactly what was there. Partial restoration is unreachable, not merely
    // unlikely.
    const rollback = this.capture();
    if (!rollback.ok) return rollback;

    const applied = this.applySnapshot(snapshot);
    if (!applied.ok) {
      const undone = this.applySnapshot(rollback.value);
      if (!undone.ok) {
        throw new Error(
          'ExperimentCompilation.restore: rollback failed after a refused restore'
        );
      }
      this.clock = rollback.value.step;
      return applied;
    }

    this.clock = snapshot.step;
    this.revisionCounter += 1;
    if (this.recordRestores) {
      this.record({
        kind: 'restore',
        value: snapshot as unknown as ExperimentJsonValue
      });
    }
    return {
      ok: true,
      value: { level: snapshot.level, step: this.clock, revision: this.revisionCounter }
    };
  }

  trace(): ExperimentResult<ExperimentTraceV0> {
    if (this.released) {
      return refused(failure('disposed', 'this experiment compilation has been disposed'));
    }
    if (this.initialSnapshot === null) {
      return refused(this.initialFailure ?? failure(
        'capability-unavailable', 'no initial snapshot was captured'
      ));
    }
    if (!this.recordingComplete) {
      return refused(failure(
        'resource-limit',
        `recording stopped at ${this.maxTraceEvents} events, so no complete ` +
          'trace exists for this run',
        '',
        { maxTraceEvents: this.maxTraceEvents }
      ));
    }
    return {
      ok: true,
      value: Object.freeze({
        schema: 'holotope.trace/0' as const,
        documentHash: this.documentHash,
        initial: this.initialSnapshot,
        events: Object.freeze([...this.events])
      })
    };
  }

  replay(
    trace: ExperimentTraceV0,
    options: { readonly require?: ExperimentReplayLevelV0 } = {}
  ): ExperimentResult<ExperimentReplayOutcomeV0> {
    if (this.released) {
      return refused(failure('disposed', 'this experiment compilation has been disposed'));
    }
    if (typeof trace !== 'object' || trace === null ||
      trace.schema !== 'holotope.trace/0') {
      return refused(failure(
        'schema-version-unsupported',
        'expected a holotope.trace/0 trace', '/schema'
      ));
    }
    if (trace.documentHash !== this.documentHash) {
      return refused(failure(
        'snapshot-incompatible',
        'the trace belongs to a different document',
        '/documentHash',
        { expected: this.documentHash, received: String(trace.documentHash) }
      ));
    }
    this.recordRestores = false;
    const restored = this.restore(trace.initial, options);
    this.recordRestores = true;
    if (!restored.ok) return restored;

    for (const event of trace.events) {
      if (event.kind === 'advance') {
        const advanced = this.advance(event.value as number);
        if (!advanced.ok) {
          return refused(failure(
            'invalid-value',
            `trace event ${event.ordinal} was refused during replay`,
            `/events/${event.ordinal}`,
            { ordinal: event.ordinal, reason: advanced.failures[0]!.code }
          ));
        }
        continue;
      }
      if (event.kind === 'restore') {
        const back = this.restore(event.value as unknown as ExperimentSnapshotV0);
        if (!back.ok) {
          return refused(failure(
            'invalid-value',
            `trace event ${event.ordinal} was refused during replay`,
            `/events/${event.ordinal}`,
            { ordinal: event.ordinal, reason: back.failures[0]!.code }
          ));
        }
        continue;
      }
      const applied = this.setParameter(event.id!, event.value);
      if (applied.outcome === 'refused') {
        return refused(failure(
          'invalid-value',
          `trace event ${event.ordinal} was refused during replay`,
          `/events/${event.ordinal}`,
          { ordinal: event.ordinal, reason: applied.failure?.code ?? 'unknown' }
        ));
      }
    }
    return {
      ok: true,
      value: {
        level: trace.initial.level,
        step: this.clock,
        revision: this.revisionCounter
      }
    };
  }

  /** Schema, document identity, level, and per-entry shape. */
  private validateSnapshot(
    snapshot: ExperimentSnapshotV0,
    require: ExperimentReplayLevelV0 | undefined
  ): ExperimentResult<true> {
    if (typeof snapshot !== 'object' || snapshot === null ||
      snapshot.schema !== 'holotope.snapshot/0') {
      return refused(failure(
        'schema-version-unsupported',
        'expected a holotope.snapshot/0 snapshot', '/schema'
      ));
    }
    if (snapshot.documentHash !== this.documentHash) {
      return refused(failure(
        'snapshot-incompatible',
        'the snapshot belongs to a different document',
        '/documentHash',
        { expected: this.documentHash, received: String(snapshot.documentHash) }
      ));
    }
    if (require !== undefined && LEVEL_ORDER[snapshot.level] < LEVEL_ORDER[require]) {
      return refused(failure(
        'replay-level-unmet',
        `snapshot level ${snapshot.level} is weaker than the required ${require}`,
        '/level',
        { required: require, available: snapshot.level }
      ));
    }
    if (!Number.isSafeInteger(snapshot.step) || snapshot.step < 0) {
      return refused(failure('invalid-value', 'step must be a non-negative integer', '/step'));
    }
    for (let index = 0; index < snapshot.entries.length; index++) {
      const entry = snapshot.entries[index]!;
      const compiled = this.registry.get(entry.id);
      if (compiled === undefined || compiled.category !== entry.category ||
        compiled.kind !== entry.kind) {
        return refused(failure(
          'invalid-value',
          `snapshot entry ${JSON.stringify(entry.id)} does not match this compilation`,
          `/entries/${index}`,
          { id: entry.id }
        ));
      }
      const encoded = snapshot.buffers[entry.buffer];
      if (typeof encoded !== 'string') {
        return refused(failure(
          'invalid-value', 'entry references a missing buffer',
          `/entries/${index}/buffer`, { buffer: entry.buffer }
        ));
      }
      let values: Float64Array;
      try {
        values = decodeFloat64BufferV0(encoded);
      } catch (error) {
        return refused(failure(
          'invalid-value',
          error instanceof Error ? error.message : String(error),
          `/buffers/${entry.buffer}`
        ));
      }
      const expected = entry.layout.reduce((sum, field) => sum + field.length, 0);
      if (values.length !== expected) {
        return refused(failure(
          'invalid-value',
          `entry declares ${expected} values but its buffer holds ${values.length}`,
          `/entries/${index}/layout`
        ));
      }
      for (let position = 0; position < values.length; position++) {
        if (!Number.isFinite(values[position]!)) {
          return refused(failure(
            'invalid-value', `value ${position} is not finite`,
            `/buffers/${entry.buffer}`, { index: position }
          ));
        }
      }
    }
    return { ok: true, value: true };
  }

  /** Writes a validated snapshot into the live objects. */
  private applySnapshot(
    snapshot: ExperimentSnapshotV0
  ): ExperimentResult<true> {
    for (const entry of snapshot.entries) {
      const compiled = this.registry.get(entry.id);
      if (compiled === undefined) continue;
      const values = decodeFloat64BufferV0(snapshot.buffers[entry.buffer]!);

      if (entry.category === 'model') {
        if (compiled.category !== 'model' || compiled.restoreModelState === undefined) {
          return refused(failure(
            'capability-unavailable',
            `the capability compiling ${JSON.stringify(entry.kind)} cannot restore state`,
            '', { id: entry.id, kind: entry.kind }
          ));
        }
        const written = compiled.restoreModelState({
          kind: entry.kind,
          modelStep: entry.modelStep ?? 0,
          layout: entry.layout,
          values
        });
        if (!written.ok) return written;
        continue;
      }
      if (compiled.category !== 'representation') continue;
      const written = restoreRepresentationState(compiled, entry.layout, values);
      if (!written.ok) return written;
    }
    return { ok: true, value: true };
  }


  invoke(
    id: ExperimentId,
    args: ExperimentJsonValue = {},
    options: { readonly mode?: 'preview' | 'commit' } = {}
  ): ExperimentActionResultV0 {
    const refuse = (failed: ExperimentFailure): ExperimentActionResultV0 =>
      Object.freeze({
        action: id,
        outcome: 'refused' as const,
        revision: this.revisionCounter,
        step: this.clock,
        failure: failed
      });

    if (this.released) {
      return refuse(failure('disposed', 'this experiment compilation has been disposed'));
    }
    const declarations = this.document.actions ?? [];
    const index = declarations.findIndex((candidate) => candidate.id === id);
    const declaration = declarations[index];
    if (declaration === undefined) {
      return refuse(failure(
        'missing-reference',
        `action ${JSON.stringify(id)} is not declared by this document`,
        '', { id }
      ));
    }
    const pointer = `/actions/${index}`;
    const operation = declaration.operation;
    if (operation === undefined) {
      return refuse(failure(
        'capability-unavailable',
        `action ${JSON.stringify(id)} declares no operation, so it is ` +
          'discoverable metadata rather than something that can run',
        `${pointer}/operation`, { id }
      ));
    }

    const validated = validateExperimentJsonAgainstSchemaV0(
      args, declaration.inputSchema, '/arguments'
    );
    if (!validated.ok) return refuse(validated.failures[0]!);

    const mode = options.mode ?? 'commit';
    if (mode === 'preview' && !declaration.supportsPreview) {
      return refuse(failure(
        'capability-unavailable',
        `action ${JSON.stringify(id)} does not support preview`,
        `${pointer}/supportsPreview`, { id }
      ));
    }

    // Budget is checked before anything executes, so an over-budget request
    // costs nothing rather than being stopped part-way.
    if (operation.kind === 'advance-clock') {
      const steps = readSteps(args);
      if (steps === null) {
        return refuse(failure(
          'invalid-value', 'advance-clock requires a positive integer steps argument',
          '/arguments/steps'
        ));
      }
      const limit = declaration.budget.maxSteps;
      if (limit !== undefined && steps > limit) {
        return refuse(failure(
          'budget-exceeded',
          `requested ${steps} steps against a declared maximum of ${limit}`,
          '/arguments/steps', { requested: steps, maxSteps: limit }
        ));
      }
    }

    if (mode === 'preview') {
      const capture = this.capture();
      if (!capture.ok) return refuse(capture.failures[0]!);
      const before = this.revisionCounter;
      const recorded = this.events.length;
      // The operation runs for real and is then put back, so a preview is
      // exactly as accurate as a commit and leaves nothing behind.
      const executed = this.execute(declaration, operation, args, pointer);
      this.recordRestores = false;
      const undone = this.restore(capture.value);
      this.recordRestores = true;
      if (!undone.ok) {
        throw new Error('ExperimentCompilation.invoke: preview could not be undone');
      }
      this.revisionCounter = before;
      this.events.length = recorded;
      if (!executed.ok) return refuse(executed.failures[0]!);
      return Object.freeze({
        action: id,
        outcome: 'previewed' as const,
        ...(executed.value === undefined ? {} : { output: executed.value }),
        revision: this.revisionCounter,
        step: this.clock
      });
    }

    const executed = this.execute(declaration, operation, args, pointer);
    if (!executed.ok) return refuse(executed.failures[0]!);
    return Object.freeze({
      action: id,
      outcome: 'applied' as const,
      ...(executed.value === undefined ? {} : { output: executed.value }),
      revision: this.revisionCounter,
      step: this.clock
    });
  }

  /** Runs one operation as its single underlying primitive. */
  private execute(
    declaration: ExperimentActionDeclarationV0,
    operation: ExperimentActionOperationV0,
    args: ExperimentJsonValue,
    pointer: string
  ): ExperimentResult<ExperimentJsonValue | undefined> {
    switch (operation.kind) {
      case 'advance-clock': {
        const advanced = this.advance(readSteps(args)!);
        if (!advanced.ok) return advanced;
        return { ok: true, value: { step: this.clock } };
      }
      case 'set-parameter': {
        const value = isRecord(args) ? args['value'] : undefined;
        const applied = this.setParameter(operation.parameter, value as ExperimentJsonValue);
        if (applied.outcome === 'refused') {
          return refused(applied.failure ?? failure(
            'invalid-value', 'the parameter application was refused', pointer
          ));
        }
        return {
          ok: true,
          value: applied.previous === undefined ? {} : { previous: applied.previous }
        };
      }
      case 'reset': {
        if (this.initialSnapshot === null) {
          return refused(this.initialFailure ?? failure(
            'capability-unavailable', 'no initial snapshot was captured', pointer
          ));
        }
        const back = this.restore(this.initialSnapshot);
        if (!back.ok) return back;
        return { ok: true, value: { step: this.clock } };
      }
      case 'probe':
        return this.probe(args, pointer);
    }
  }

  /**
   * Headless evidence for a point in a representation's own chart.
   *
   * Pure: it reads live objects and stores nothing. A probe deliberately does
   * not establish a selection, because hidden state changing without a
   * revision bump would break the staleness contract observations rely on.
   */
  private probe(
    args: ExperimentJsonValue,
    pointer: string
  ): ExperimentResult<ExperimentJsonValue> {
    const record = isRecord(args) ? args : {};
    const target = record['representation'];
    const point = record['point'];
    if (typeof target !== 'string') {
      return refused(failure(
        'invalid-value', 'probe requires a representation id',
        '/arguments/representation'
      ));
    }
    if (!Array.isArray(point) || point.length !== 3 ||
      point.some((c) => typeof c !== 'number' || !Number.isFinite(c))) {
      return refused(failure(
        'invalid-value', 'probe requires a finite 3-point in the chart',
        '/arguments/point'
      ));
    }
    const entry = this.registry.get(target);
    if (entry === undefined || entry.category !== 'representation') {
      return refused(failure(
        'missing-reference',
        `representation ${JSON.stringify(target)} is not compiled`,
        '/arguments/representation', { id: target }
      ));
    }
    const lineageKind = String(
      (entry.lineage as unknown as { steps?: readonly { kind?: string }[] })
        .steps?.[0]?.kind ?? 'unknown'
    );

    if (entry.map.kind !== 'slice4') {
      // A projection is many-to-one, and headlessly there is no ray and no hit
      // record to disambiguate it. Reporting a point here would upgrade a
      // capability the lineage does not certify.
      return {
        ok: true,
        value: { ambientPointStatus: 'unavailable', lineageKind }
      };
    }

    const chart = point as readonly number[];
    const ambient = entry.map.slice.embedPoint(
      [chart[0]!, chart[1]!, chart[2]!]
    );
    const sourceEntry = this.registry.get(entry.source);
    const pose = resolvePose(entry.pose, this.registry);
    const located = sourceEntry !== undefined && sourceEntry.category === 'source'
      ? resolveRepresentationChartPointToSourceCellN(
          createAffineSectionCellChart4N(
            sourceEntry.complex,
            entry.map.slice,
            pose === null ? {} : { transform: pose }
          ),
          chart
        )
      : null;
    return {
      ok: true,
      value: {
        ambientPointStatus: 'exact',
        ambientPoint: [ambient[0], ambient[1], ambient[2], ambient[3]],
        ...(
          located !== null && located.kind === 'resolved'
            ? {
                sourceCell: {
                  groupKey:
                    located.reference.group.key ??
                    `dim3/${located.reference.group.kind}`,
                  ordinal: located.reference.cellIndex
                }
              }
            : {}
        ),
        lineageKind
      }
    };
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

/** Checks one value against its declared domain, returning it normalized. */
function validateParameterValue(
  declaration: ExperimentParameterValueDeclarationV0,
  value: ExperimentJsonValue,
  pointer: string
): ExperimentResult<ExperimentJsonValue> {
  switch (declaration.type) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return refused(failure(
          'invalid-type', 'expected a finite number', pointer, { value: describe(value) }
        ));
      }
      // `step` is advisory: it suggests a control increment, and refusing
      // values between increments would make the domain narrower than declared.
      if (value < declaration.min || value > declaration.max) {
        return refused(failure(
          'out-of-range',
          `value ${value} is outside [${declaration.min}, ${declaration.max}]`,
          pointer,
          { value, min: declaration.min, max: declaration.max }
        ));
      }
      return { ok: true, value: value as ExperimentJsonValue };
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        return refused(failure('invalid-type', 'expected a boolean', pointer, { value: describe(value) }));
      }
      return { ok: true, value: value as ExperimentJsonValue };
    }
    case 'choice': {
      if (typeof value !== 'string') {
        return refused(failure('invalid-type', 'expected a string option', pointer, { value: describe(value) }));
      }
      if (!declaration.options.includes(value)) {
        return refused(failure(
          'invalid-value',
          `option ${JSON.stringify(value)} is not one of the declared options`,
          pointer,
          { value, options: declaration.options.join(', ') }
        ));
      }
      return { ok: true, value: value as ExperimentJsonValue };
    }
    case 'vector': {
      if (!Array.isArray(value)) {
        return refused(failure('invalid-type', 'expected a numeric vector', pointer, { value: describe(value) }));
      }
      if (value.length !== declaration.length) {
        return refused(failure(
          'invalid-value',
          `expected ${declaration.length} components, received ${value.length}`,
          pointer,
          { length: value.length, expected: declaration.length }
        ));
      }
      const components: number[] = [];
      for (let index = 0; index < value.length; index++) {
        const component = value[index];
        if (typeof component !== 'number' || !Number.isFinite(component)) {
          return refused(failure(
            'invalid-type', `component ${index} must be a finite number`,
            `${pointer}/${index}`, { value: describe(component) }
          ));
        }
        if ((declaration.min !== undefined && component < declaration.min) ||
          (declaration.max !== undefined && component > declaration.max)) {
          return refused(failure(
            'out-of-range',
            `component ${index} is outside the declared bounds`,
            `${pointer}/${index}`,
            {
              value: component,
              ...(declaration.min === undefined ? {} : { min: declaration.min }),
              ...(declaration.max === undefined ? {} : { max: declaration.max })
            }
          ));
        }
        components.push(component);
      }
      return { ok: true, value: Object.freeze(components) };
    }
  }
}

/** Reads one validated target through to its live compiled object. */
function readParameterTarget(
  target: ExperimentParameterTargetV0,
  registry: Map<ExperimentId, ExperimentCompiledEntryV0>,
  pointer: string
): ExperimentResult<ExperimentJsonValue> {
  if (target.kind === 'clock') {
    return refused(failure(
      'capability-unavailable',
      'the headless runtime has no playback driver; clock parameters await ' +
        'the workbench layer',
      `${pointer}/target`,
      { field: target.field }
    ));
  }
  if (target.kind === 'presentation') {
    return refused(failure(
      'capability-unavailable',
      'presentation parameters belong to the workbench layer and have no ' +
        'headless target',
      `${pointer}/target`,
      { ref: target.ref, field: target.field }
    ));
  }

  const entry = registry.get(target.ref);
  if (entry === undefined) {
    return refused(failure(
      'missing-reference',
      `target ${JSON.stringify(target.ref)} is not a compiled entry`,
      `${pointer}/target/ref`,
      { ref: target.ref }
    ));
  }

  if (target.kind === 'model-field') {
    if (entry.category !== 'model') {
      return refused(failure(
        'invalid-value',
        `target ${JSON.stringify(target.ref)} is not a model`,
        `${pointer}/target/ref`,
        { ref: target.ref, category: entry.category }
      ));
    }
    if (entry.readModelField === undefined) {
      return refused(failure(
        'capability-unavailable',
        `the capability compiling ${JSON.stringify(entry.kind)} exposes no ` +
          'readable model fields',
        `${pointer}/target`,
        { ref: target.ref, kind: entry.kind, field: target.field }
      ));
    }
    return entry.readModelField(target.field);
  }

  if (entry.category !== 'representation') {
    return refused(failure(
      'invalid-value',
      `target ${JSON.stringify(target.ref)} is not a representation`,
      `${pointer}/target/ref`,
      { ref: target.ref, category: entry.category }
    ));
  }
  const map = entry.map;
  if (target.field === 'viewDistance') {
    if (map.kind !== 'projection') {
      return refused(failure(
        'invalid-value', 'viewDistance applies to a projection only',
        `${pointer}/target/field`, { ref: entry.id, kind: map.kind }
      ));
    }
    const viewDistance = (
      map.projection as { readonly viewDistance?: number }
    ).viewDistance;
    if (typeof viewDistance !== 'number' || !Number.isFinite(viewDistance)) {
      return refused(failure(
        'capability-unavailable',
        'this projection exposes no finite view distance',
        `${pointer}/target/field`,
        { ref: entry.id }
      ));
    }
    return { ok: true, value: viewDistance };
  }

  if (map.kind !== 'slice4') {
    return refused(failure(
      'invalid-value', `${target.field} applies to a section only`,
      `${pointer}/target/field`, { ref: entry.id, kind: map.kind }
    ));
  }
  if (target.field === 'offset') {
    return { ok: true, value: map.slice.offset };
  }
  return {
    ok: true,
    value: Object.freeze([...map.slice.normal.data])
  };
}

/** Writes one validated value into the live compiled object it targets. */
function applyParameterTarget(
  target: ExperimentParameterTargetV0,
  value: ExperimentJsonValue,
  registry: Map<ExperimentId, ExperimentCompiledEntryV0>,
  pointer: string
): ExperimentResult<{ readonly previous: ExperimentJsonValue }> {
  if (target.kind === 'clock') {
    return refused(failure(
      'capability-unavailable',
      'the headless runtime has no playback driver; clock parameters await ' +
        'the workbench slice',
      `${pointer}/target`,
      { field: target.field }
    ));
  }
  if (target.kind === 'presentation') {
    return refused(failure(
      'capability-unavailable',
      'panes are not compiled headlessly, so presentation parameters have no ' +
        'target',
      `${pointer}/target`,
      { ref: target.ref, field: target.field }
    ));
  }

  const entry = registry.get(target.ref);
  if (entry === undefined) {
    return refused(failure(
      'missing-reference',
      `target ${JSON.stringify(target.ref)} is not a compiled entry`,
      `${pointer}/target/ref`,
      { ref: target.ref }
    ));
  }

  if (target.kind === 'model-field') {
    if (entry.category !== 'model') {
      return refused(failure(
        'invalid-value',
        `target ${JSON.stringify(target.ref)} is not a model`,
        `${pointer}/target/ref`,
        { ref: target.ref, category: entry.category }
      ));
    }
    if (entry.applyModelField === undefined) {
      return refused(failure(
        'capability-unavailable',
        `the capability compiling ${JSON.stringify(entry.kind)} exposes no ` +
          'writable model fields',
        `${pointer}/target`,
        { ref: target.ref, kind: entry.kind, field: target.field }
      ));
    }
    return entry.applyModelField(target.field, value);
  }

  if (entry.category !== 'representation') {
    return refused(failure(
      'invalid-value',
      `target ${JSON.stringify(target.ref)} is not a representation`,
      `${pointer}/target/ref`,
      { ref: target.ref, category: entry.category }
    ));
  }
  return applyRepresentationField(entry, target.field, value, pointer);
}

/** Writes an offset, normal, or view distance into a live map object. */
function applyRepresentationField(
  entry: ExperimentCompiledRepresentationV0,
  field: 'offset' | 'normal' | 'viewDistance',
  value: ExperimentJsonValue,
  pointer: string
): ExperimentResult<{ readonly previous: ExperimentJsonValue }> {
  const map = entry.map;
  if (field === 'viewDistance') {
    if (map.kind !== 'projection') {
      return refused(failure(
        'invalid-value', 'viewDistance applies to a projection only',
        `${pointer}/target/field`, { ref: entry.id, kind: map.kind }
      ));
    }
    const projection = map.projection as { viewDistance?: number };
    if (typeof projection.viewDistance !== 'number') {
      return refused(failure(
        'capability-unavailable',
        'this projection exposes no view distance',
        `${pointer}/target/field`, { ref: entry.id }
      ));
    }
    const previous = projection.viewDistance;
    try {
      projection.viewDistance = value as number;
    } catch (error) {
      // The projection guards its own epsilon; surfacing its refusal keeps one
      // definition of the admissible range rather than duplicating it here.
      return refused(failure(
        'out-of-range',
        error instanceof Error ? error.message : String(error),
        `${pointer}/value`, { value: describe(value) }
      ));
    }
    return { ok: true, value: { previous } };
  }

  if (map.kind !== 'slice4') {
    return refused(failure(
      'invalid-value', `${field} applies to a section only`,
      `${pointer}/target/field`, { ref: entry.id, kind: map.kind }
    ));
  }
  if (field === 'offset') {
    const previous = map.slice.offset;
    map.slice.offset = value as number;
    return { ok: true, value: { previous } };
  }

  // The stored normal is the normalized one, so `previous` reports what a read
  // would have returned rather than whatever was last written.
  const previous = Object.freeze([...map.slice.normal.data]);
  const components = value as readonly number[];
  if (components.every((component) => component === 0)) {
    return refused(failure(
      'invalid-value', 'a section normal must be a nonzero vector',
      `${pointer}/value`, { value: describe([...components]) }
    ));
  }
  try {
    map.slice.setNormal(new VecN([...components]), { frame: map.frame });
  } catch (error) {
    return refused(failure(
      'invalid-value',
      error instanceof Error ? error.message : String(error),
      `${pointer}/value`, { value: describe([...components]) }
    ));
  }
  return { ok: true, value: { previous } };
}

/** Computes one observation from the live compiled objects, never from state. */
function evaluateObservation(
  source: ExperimentObservationSourceV0,
  registry: Map<ExperimentId, ExperimentCompiledEntryV0>,
  pointer: string
): ExperimentResult<ExperimentJsonValue> {
  if (source.kind === 'selection') {
    return refused(failure(
      'capability-unavailable',
      'no selection surface exists until the probe slice',
      pointer
    ));
  }

  const entry = registry.get(source.ref);
  if (entry === undefined) {
    return refused(failure(
      'missing-reference',
      `observation target ${JSON.stringify(source.ref)} is not compiled`,
      `${pointer}/ref`,
      { ref: source.ref }
    ));
  }

  if (source.kind === 'model-invariant') {
    if (entry.category !== 'model') {
      return refused(failure(
        'invalid-value',
        `target ${JSON.stringify(source.ref)} is not a model`,
        `${pointer}/ref`, { ref: source.ref, category: entry.category }
      ));
    }
    if (entry.observeModel === undefined) {
      return refused(failure(
        'capability-unavailable',
        `the capability compiling ${JSON.stringify(entry.kind)} exposes no ` +
          'observable quantities',
        pointer,
        { ref: source.ref, kind: entry.kind, quantity: source.quantity }
      ));
    }
    return entry.observeModel(source.quantity);
  }

  if (entry.category !== 'representation') {
    return refused(failure(
      'invalid-value',
      `target ${JSON.stringify(source.ref)} is not a representation`,
      `${pointer}/ref`, { ref: source.ref, category: entry.category }
    ));
  }

  if (source.kind === 'lineage') {
    // Already frozen JSON-compatible evidence derived from the constructed
    // map, so it is returned rather than rebuilt.
    return { ok: true, value: entry.lineage as unknown as ExperimentJsonValue };
  }
  return countRepresentation(entry, source.quantity, registry, pointer);
}

/** A failure detail carries primitives, so anything else is described. */
function describe(value: unknown): string | number | boolean {
  if (typeof value === 'string' || typeof value === 'number' ||
    typeof value === 'boolean') {
    return value;
  }
  return JSON.stringify(value) ?? String(value);
}

/**
 * Counts what a representation's product actually emits.
 *
 * These are measured algorithm outputs, not ideal-shape counts. A tesseract
 * section marches tetrahedra and emits 48 triangles where the solid's
 * cross-section has 12 faces; reporting 12 would describe a product nothing
 * produced.
 */
function countRepresentation(
  entry: ExperimentCompiledRepresentationV0,
  quantity: 'triangles' | 'vertices' | 'edges',
  registry: Map<ExperimentId, ExperimentCompiledEntryV0>,
  pointer: string
): ExperimentResult<ExperimentJsonValue> {
  const sourceEntry = registry.get(entry.source);
  if (sourceEntry === undefined || sourceEntry.category !== 'source') {
    return refused(failure(
      'missing-reference',
      `source ${JSON.stringify(entry.source)} is not compiled`,
      `${pointer}/ref`, { ref: entry.source }
    ));
  }
  const complex = sourceEntry.complex;

  if (entry.map.kind === 'projection') {
    if (quantity === 'vertices') return { ok: true, value: complex.vertexCount };
    if (quantity === 'edges') return { ok: true, value: complex.cellCount(1) };
    let triangles = 0;
    for (const group of complex.cellsOfDim(2)) {
      const cells = group.indices.length / group.verticesPerCell;
      // A quad emits two triangles, a simplex face one.
      triangles += group.kind === 'cuboid' ? cells * 2 : cells;
    }
    return { ok: true, value: triangles };
  }

  if (quantity === 'edges') {
    return refused(failure(
      'invalid-value',
      'a marched section is a triangle soup and retains no edge product',
      pointer, { ref: entry.id, quantity }
    ));
  }

  const tetGroups = complex.cellsOfDim(3)
    .filter((group) => group.kind === 'simplex' && group.verticesPerCell === 4);
  let indexLength = 0;
  for (const group of tetGroups) indexLength += group.indices.length;
  if (indexLength === 0) {
    return refused(failure(
      'invalid-value',
      `source ${JSON.stringify(entry.source)} has no simplex 3-cells to march`,
      `${pointer}/ref`, { ref: entry.source }
    ));
  }
  const tets = new Uint32Array(indexLength);
  let offset = 0;
  for (const group of tetGroups) {
    tets.set(group.indices, offset);
    offset += group.indices.length;
  }

  // The pose is resolved now rather than remembered: a model binding must be
  // read at observation time or the count describes a stale configuration.
  const world = new Float64Array(complex.positions.length);
  const pose = resolvePose(entry.pose, registry);
  if (pose === null) world.set(complex.positions);
  else pose.applyToPositions(complex.positions, world, complex.vertexCount);

  const out = new Float32Array((tets.length / 4) * 18);
  const emitted = sliceTetrahedra(world, tets, entry.map.slice, out);
  return {
    ok: true,
    value: quantity === 'vertices' ? emitted : emitted / 3
  };
}

/** The transform a representation is currently posed by, or null for none. */
function resolvePose(
  pose: ExperimentCompiledPoseV0,
  registry: Map<ExperimentId, ExperimentCompiledEntryV0>
): TransformN | null {
  if (pose.kind === 'static') return pose.transform;
  const model = registry.get(pose.model);
  return model !== undefined && model.category === 'model' ? model.pose() : null;
}

/** Level comparison; a higher number reproduces more faithfully. */
const LEVEL_ORDER: Readonly<Record<ExperimentReplayLevelV0, number>> = Object.freeze({
  'presentation-only': 0,
  'numeric-equivalent': 1,
  'exact-cpu': 2
});

/**
 * The mutable state of one compiled representation.
 *
 * A slice carries its display basis, which for a `continuous` frame is a
 * function of the normal's history rather than of its current value. Capturing
 * the basis itself is what lets such a section restore bitwise instead of
 * being reconstructed approximately from the document.
 */
function captureRepresentationState(
  entry: ExperimentCompiledRepresentationV0
): { layout: ExperimentStateFieldV0[]; values: Float64Array } {
  if (entry.map.kind === 'slice4') {
    const slice = entry.map.slice;
    const values = new Float64Array(1 + 4 + 12);
    values[0] = slice.offset;
    values.set(slice.normal.data, 1);
    for (let row = 0; row < 3; row++) values.set(slice.basis[row]!, 5 + row * 4);
    return {
      layout: [
        { field: 'offset', length: 1 },
        { field: 'normal', length: 4 },
        { field: 'basis', length: 12 }
      ],
      values
    };
  }
  const projection = entry.map.projection as {
    viewDistance?: number;
    epsilon?: number;
  };
  if (typeof projection.viewDistance !== 'number') {
    // A coordinate projection selects axes and has nothing that changes.
    return { layout: [], values: new Float64Array(0) };
  }
  return {
    layout: [
      { field: 'viewDistance', length: 1 },
      { field: 'epsilon', length: 1 }
    ],
    values: Float64Array.from([
      projection.viewDistance,
      typeof projection.epsilon === 'number' ? projection.epsilon : 0
    ])
  };
}

/** Writes captured representation state back exactly, without renormalizing. */
function restoreRepresentationState(
  entry: ExperimentCompiledRepresentationV0,
  layout: readonly ExperimentStateFieldV0[],
  values: Float64Array
): ExperimentResult<true> {
  const fields = layout.map((field) => field.field).join(',');
  if (entry.map.kind === 'slice4') {
    if (fields !== 'offset,normal,basis') {
      return refused(failure(
        'invalid-value',
        `section ${JSON.stringify(entry.id)} expects offset,normal,basis`,
        '', { layout: fields }
      ));
    }
    const slice = entry.map.slice;
    slice.offset = values[0]!;
    // Written in place rather than through setNormal: the captured basis is
    // the transported one, and recomputing it would discard the history the
    // snapshot exists to preserve.
    for (let axis = 0; axis < 4; axis++) slice.normal.data[axis] = values[1 + axis]!;
    for (let row = 0; row < 3; row++) {
      for (let axis = 0; axis < 4; axis++) {
        slice.basis[row]![axis] = values[5 + row * 4 + axis]!;
      }
    }
    return { ok: true, value: true };
  }
  if (fields === '') return { ok: true, value: true };
  if (fields !== 'viewDistance,epsilon') {
    return refused(failure(
      'invalid-value',
      `projection ${JSON.stringify(entry.id)} expects viewDistance,epsilon`,
      '', { layout: fields }
    ));
  }
  const projection = entry.map.projection as { viewDistance?: number };
  try {
    projection.viewDistance = values[0]!;
  } catch (error) {
    return refused(failure(
      'invalid-value',
      error instanceof Error ? error.message : String(error), ''
    ));
  }
  return { ok: true, value: true };
}

/** A record value, or nothing when the argument is not an object. */
const isRecord = (
  value: ExperimentJsonValue
): value is { readonly [key: string]: ExperimentJsonValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The positive integer step count an advance argument carries, or null. */
function readSteps(args: ExperimentJsonValue): number | null {
  if (!isRecord(args)) return null;
  const steps = args['steps'];
  return typeof steps === 'number' && Number.isSafeInteger(steps) && steps > 0
    ? steps
    : null;
}
