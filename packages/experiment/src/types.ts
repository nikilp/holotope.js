/** JSON primitive admitted by an experiment document. */
export type ExperimentJsonPrimitive = string | number | boolean | null;

/** Deep JSON value admitted by an experiment document. */
export type ExperimentJsonValue =
  | ExperimentJsonPrimitive
  | readonly ExperimentJsonValue[]
  | { readonly [key: string]: ExperimentJsonValue };

/** Author-assigned document-global identifier. */
export type ExperimentId = string;

/** Namespaced construction kind such as `core.source.hypercube`. */
export type ExperimentDescriptorKind = string;

/** Schema identifier for the first experiment document contract. */
export type ExperimentSchemaIdV0 = 'holotope.experiment/0';

/** Stable typed reason for refusing intake, validation, or compilation. */
export type ExperimentFailureCode =
  | 'malformed-json'
  | 'duplicate-key'
  | 'resource-limit'
  | 'schema-version-unsupported'
  | 'missing-field'
  | 'unknown-field'
  | 'invalid-id'
  | 'invalid-type'
  | 'invalid-value'
  | 'unsafe-key'
  | 'non-finite-number'
  | 'unknown-kind'
  | 'kind-version-mismatch'
  | 'capability-unavailable'
  | 'missing-reference'
  | 'dependency-cycle'
  | 'dimension-mismatch'
  | 'frame-mismatch'
  | 'unit-mismatch'
  | 'out-of-range'
  | 'replay-limited'
  | 'canonicalization-failed'
  | 'crypto-unavailable'
  | 'disposed';

/** JSON-compatible evidence for one refused document operation. */
export interface ExperimentFailure {
  /** Stable machine-facing reason. */
  readonly code: ExperimentFailureCode;
  /** Concise human-facing explanation. */
  readonly message: string;
  /** RFC 6901 JSON Pointer locating the cause when available. */
  readonly pointer?: string;
  /** Additional scalar evidence; never a live object. */
  readonly detail?: Readonly<
    Record<string, string | number | boolean>
  >;
}

/** Explicit success or typed refusal. */
export type ExperimentResult<Value> =
  | {
      readonly ok: true;
      readonly value: Value;
    }
  | {
      readonly ok: false;
      readonly failures: readonly ExperimentFailure[];
    };

/** Common version field for every construction descriptor. */
export interface ExperimentDescriptorBaseV0 {
  /** Namespaced construction kind. */
  readonly kind: ExperimentDescriptorKind;
  /** Kind-local schema version. Version zero is the only v0 value. */
  readonly kindVersion?: 0;
}

/** Constructs an axis-aligned N-dimensional hypercube. */
export interface ExperimentHypercubeSourceV0
  extends ExperimentDescriptorBaseV0 {
  readonly kind: 'core.source.hypercube';
  /** Ambient and intrinsic dimension of the constructed cube. */
  readonly dim: number;
  /** Full edge length in source units. */
  readonly size: number;
  /** Whether to construct the simplex interior needed by section consumers. */
  readonly tetrahedralize?: boolean;
}

/** Constructs an N-dimensional regular simplex. */
export interface ExperimentSimplexSourceV0
  extends ExperimentDescriptorBaseV0 {
  readonly kind: 'core.source.simplex';
  /** Ambient and intrinsic dimension of the regular simplex. */
  readonly dim: number;
  /** Authored construction scale in source units. */
  readonly size: number;
}

/** Named regular four-dimensional polytope construction. */
export interface ExperimentPolychoronSourceV0
  extends ExperimentDescriptorBaseV0 {
  readonly kind: 'core.source.polychoron';
  /** Regular-polychoron family selected for the R4 source. */
  readonly symbol:
    | '5-cell'
    | '8-cell'
    | '16-cell'
    | '24-cell'
    | '120-cell'
    | '600-cell';
}

/** Closed source vocabulary admitted by experiment schema v0. */
export type ExperimentSourceDescriptorV0 =
  | ExperimentHypercubeSourceV0
  | ExperimentSimplexSourceV0
  | ExperimentPolychoronSourceV0;

/** Literal rigid transform; scaling is intentionally unavailable. */
export interface ExperimentLiteralTransformV0 {
  /** Source-space translation, with one component per ambient axis. */
  readonly translation?: readonly number[];
  /**
   * Spin(4) pair `[lx, ly, lz, lw, rx, ry, rz, rw]`.
   *
   * Available only when the surrounding descriptor consumes R4.
   */
  readonly rotor4?: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number
  ];
}

/** Reads a transform from one compiled model rather than duplicating pose. */
export interface ExperimentModelTransformReferenceV0 {
  /** Id of the model whose authoritative pose supplies this transform. */
  readonly fromModel: ExperimentId;
}

/** Authored literal transform or reference to model-authoritative pose. */
export type ExperimentTransformDescriptorV0 =
  | ExperimentLiteralTransformV0
  | ExperimentModelTransformReferenceV0;

/** Perspective R^N-to-R3 representation descriptor. */
export interface ExperimentPerspectiveRepresentationV0
  extends ExperimentDescriptorBaseV0 {
  readonly kind: 'core.representation.perspective';
  /** Id of the authoritative source geometry to represent. */
  readonly source: ExperimentId;
  /** Source dimension consumed by the perspective chain. */
  readonly fromDim: number;
  /** Viewpoint distance used at each perspective reduction. */
  readonly viewDistance: number;
  /** Optional denominator guard for singular projective branches. */
  readonly epsilon?: number;
  /** Optional authored or model-owned source pose. */
  readonly transform?: ExperimentTransformDescriptorV0;
  /** Requested renderer-neutral topology products. */
  readonly product: 'surface' | 'edges' | 'both';
}

/** Exact coordinate-subspace R^N-to-R3 representation descriptor. */
export interface ExperimentCoordinateRepresentationV0
  extends ExperimentDescriptorBaseV0 {
  readonly kind: 'core.representation.coordinate';
  /** Id of the authoritative source geometry to represent. */
  readonly source: ExperimentId;
  /** Dimension of the source coordinate space. */
  readonly fromDim: number;
  /** Ordered source axes retained as the output x, y, and z axes. */
  readonly retainedAxes: readonly [number, number, number];
  /** Optional authored or model-owned source pose. */
  readonly transform?: ExperimentTransformDescriptorV0;
  /** Requested renderer-neutral topology products. */
  readonly product: 'surface' | 'edges' | 'both';
}

/** Exact affine hyperplane section of an R4 source. */
export interface ExperimentSectionRepresentation4V0
  extends ExperimentDescriptorBaseV0 {
  readonly kind: 'core.representation.section4';
  /** Id of the authoritative R4 source geometry to section. */
  readonly source: ExperimentId;
  /** Ambient R4 hyperplane normal; validation requires nonzero length. */
  readonly normal: readonly [number, number, number, number];
  /** Signed hyperplane offset in source units. */
  readonly offset: number;
  /** Canonical frame for replay or transported frame for visual continuity. */
  readonly frame: 'canonical' | 'continuous';
  /** Optional authored or model-owned source pose. */
  readonly transform?: ExperimentTransformDescriptorV0;
}

/** Closed representation vocabulary admitted by schema v0. */
export type ExperimentRepresentationDescriptorV0 =
  | ExperimentPerspectiveRepresentationV0
  | ExperimentCoordinateRepresentationV0
  | ExperimentSectionRepresentation4V0;

/** Renderer-independent R4 rigid-model descriptor. */
export interface ExperimentRigidModel4V0
  extends ExperimentDescriptorBaseV0 {
  readonly kind: 'physics.model.rigid4';
  /** Id of the R4 source geometry supplying mass shape. */
  readonly source: ExperimentId;
  /** Constant ambient acceleration vector. */
  readonly gravity?: readonly [number, number, number, number];
  /** Initial Spin(4) orientation as a left/right quaternion pair. */
  readonly initialRotor4?: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number
  ];
  /** Initial world angular momentum in `[xy,xz,xw,yz,yw,zw]` order. */
  readonly initialAngularMomentum?: readonly [
    number,
    number,
    number,
    number,
    number,
    number
  ];
  /** Deterministic simulation step duration in seconds. */
  readonly fixedStep: number;
  /** Whole-number solver subdivisions within each fixed step. */
  readonly substeps?: number;
}

/** Closed model vocabulary admitted by schema v0. */
export type ExperimentModelDescriptorV0 = ExperimentRigidModel4V0;

/** JSON-Schema-compatible subset used by action manifests. */
export interface ExperimentJsonSchemaV0 {
  /** Admitted JSON value category. */
  readonly type:
    | 'object'
    | 'array'
    | 'string'
    | 'number'
    | 'integer'
    | 'boolean';
  /** Optional short name for a generated control or result. */
  readonly title?: string;
  /** Optional task-facing explanation of the admitted value. */
  readonly description?: string;
  /** Closed child schemas for an object value. */
  readonly properties?: Readonly<
    Record<string, ExperimentJsonSchemaV0>
  >;
  /** Object property names that must be present. */
  readonly required?: readonly string[];
  /** Exact primitive values admitted by the schema. */
  readonly enum?: readonly ExperimentJsonPrimitive[];
  /** Inclusive numeric lower bound. */
  readonly minimum?: number;
  /** Inclusive numeric upper bound. */
  readonly maximum?: number;
  /** Schema applied to every array element. */
  readonly items?: ExperimentJsonSchemaV0;
  /** Inclusive minimum array length. */
  readonly minItems?: number;
  /** Inclusive maximum array length. */
  readonly maxItems?: number;
  /** Explicit refusal of undeclared object properties. */
  readonly additionalProperties?: false;
}

/** Physical interpretation carried by a parameter or observation. */
export type ExperimentQuantityDimensionV0 =
  | 'length'
  | 'angle'
  | 'time'
  | 'mass'
  | 'velocity'
  | 'acceleration'
  | 'frequency'
  | 'energy'
  | 'angular-momentum'
  | 'dimensionless';

/** Coordinate frame metadata for one parameter or observation. */
export interface ExperimentFrameV0 {
  /** Semantic coordinate space in which the value is expressed. */
  readonly space:
    | 'ambient'
    | 'source'
    | 'representation'
    | 'internal';
  /** Number of coordinates in that space. */
  readonly dim: number;
}

/** Numeric parameter value declaration. */
export interface ExperimentNumberParameterValueV0 {
  /** Discriminator for a bounded scalar control. */
  readonly type: 'number';
  /** Initial scalar value. */
  readonly default: number;
  /** Inclusive lower value exposed to the authoring surface. */
  readonly min: number;
  /** Inclusive upper value exposed to the authoring surface. */
  readonly max: number;
  /** Optional suggested control increment. */
  readonly step?: number;
}

/** Boolean parameter value declaration. */
export interface ExperimentBooleanParameterValueV0 {
  /** Discriminator for a two-state control. */
  readonly type: 'boolean';
  /** Initial Boolean value. */
  readonly default: boolean;
}

/** Enumerated string parameter value declaration. */
export interface ExperimentChoiceParameterValueV0 {
  /** Discriminator for a closed string choice. */
  readonly type: 'choice';
  /** Initial option, which must occur in `options`. */
  readonly default: string;
  /** Ordered, unique string values presented to the caller. */
  readonly options: readonly string[];
}

/** Fixed-length vector parameter value declaration. */
export interface ExperimentVectorParameterValueV0 {
  /** Discriminator for a fixed-length numeric-vector control. */
  readonly type: 'vector';
  /** Initial vector components. */
  readonly default: readonly number[];
  /** Required component count. */
  readonly length: number;
  /** Optional inclusive lower bound applied to every component. */
  readonly min?: number;
  /** Optional inclusive upper bound applied to every component. */
  readonly max?: number;
}

/** Closed parameter-value vocabulary. */
export type ExperimentParameterValueDeclarationV0 =
  | ExperimentNumberParameterValueV0
  | ExperimentBooleanParameterValueV0
  | ExperimentChoiceParameterValueV0
  | ExperimentVectorParameterValueV0;

/** One declared target whose mutation is compiled in a later runtime slice. */
export type ExperimentParameterTargetV0 =
  | {
      readonly kind: 'representation-field';
      readonly ref: ExperimentId;
      readonly field: 'offset' | 'normal' | 'viewDistance';
    }
  | {
      readonly kind: 'model-field';
      readonly ref: ExperimentId;
      readonly field: 'gravity' | 'substeps';
    }
  | {
      readonly kind: 'clock';
      readonly field: 'rate' | 'running';
    }
  | {
      readonly kind: 'presentation';
      readonly ref: ExperimentId;
      readonly field: string;
    };

/** Machine-readable declaration of one authored parameter. */
export interface ExperimentParameterDeclarationV0 {
  /** Document-global parameter id. */
  readonly id: ExperimentId;
  /** Human-facing control label. */
  readonly label: string;
  /** Closed value-domain declaration and initial value. */
  readonly value: ExperimentParameterValueDeclarationV0;
  /** Physical quantity category used for semantic checks. */
  readonly dimension: ExperimentQuantityDimensionV0;
  /** Coordinate space and dimension in which the value is interpreted. */
  readonly frame: ExperimentFrameV0;
  /** Authored unit label; v0 does not claim an interoperable unit system. */
  readonly unit: string;
  /** Explicit field that a future runtime may update. */
  readonly target: ExperimentParameterTargetV0;
}

/** Optional renderer/backend requirement. */
export interface ExperimentBackendRequirementV0 {
  /** Backend capability named by the document. */
  readonly backend: 'cpu' | 'webgpu' | 'webgl';
  /** Whether refusal is required when the backend is unavailable. */
  readonly required: boolean;
}

/** Machine-readable declaration of one action. */
export interface ExperimentActionDeclarationV0 {
  /** Document-global action id. */
  readonly id: ExperimentId;
  /** Short human-facing action name. */
  readonly title: string;
  /** Behavior and intended effect exposed to tools and people. */
  readonly description: string;
  /** Admitted JSON argument shape. */
  readonly inputSchema: ExperimentJsonSchemaV0;
  /** Declared JSON result shape. */
  readonly outputSchema: ExperimentJsonSchemaV0;
  /** Whether executing the action leaves experiment state unchanged. */
  readonly readOnly: boolean;
  /** Whether the action may irreversibly discard authored/runtime state. */
  readonly destructive: boolean;
  /** Whether repeated identical requests have the same state effect. */
  readonly idempotent: boolean;
  /** Whether the CPU reference promises repeatable output for fixed state. */
  readonly deterministic: boolean;
  /** Whether a runtime may evaluate the action without committing its effect. */
  readonly supportsPreview: boolean;
  /** Caller-enforced work limits declared for one invocation. */
  readonly budget: {
    readonly maxSteps?: number;
    readonly maxMillis?: number;
  };
  /** Optional execution capability needed by the action. */
  readonly requiresBackend?: ExperimentBackendRequirementV0;
}

/** Model-derived observation source. */
export interface ExperimentModelObservationSourceV0 {
  /** Discriminator for a model-derived invariant or state quantity. */
  readonly kind: 'model-invariant';
  /** Id of the model to observe. */
  readonly ref: ExperimentId;
  /** Model quantity requested from the future runtime. */
  readonly quantity:
    | 'angular-momentum'
    | 'kinetic-energy'
    | 'rotor-orthonormality'
    | 'position';
}

/** Representation cardinality observation source. */
export interface ExperimentRepresentationCountSourceV0 {
  /** Discriminator for a representation topology count. */
  readonly kind: 'representation-count';
  /** Id of the representation whose retained product is counted. */
  readonly ref: ExperimentId;
  /** Topology element category to count. */
  readonly quantity: 'triangles' | 'vertices' | 'edges';
}

/** Representation-lineage observation source. */
export interface ExperimentLineageObservationSourceV0 {
  /** Discriminator for derived representation-lineage evidence. */
  readonly kind: 'lineage';
  /** Id of the representation whose actual lineage is requested. */
  readonly ref: ExperimentId;
}

/** Selection observation authored without binding to a DOM event. */
export interface ExperimentSelectionObservationSourceV0 {
  /** Discriminator for the runtime's current explicit selection evidence. */
  readonly kind: 'selection';
}

/** Closed observation-source vocabulary. */
export type ExperimentObservationSourceV0 =
  | ExperimentModelObservationSourceV0
  | ExperimentRepresentationCountSourceV0
  | ExperimentLineageObservationSourceV0
  | ExperimentSelectionObservationSourceV0;

/** Machine-readable declaration of one headless observation. */
export interface ExperimentObservationDeclarationV0 {
  /** Document-global observation id. */
  readonly id: ExperimentId;
  /** Human-facing observation name. */
  readonly title: string;
  /** Declared JSON shape of every sampled value. */
  readonly outputSchema: ExperimentJsonSchemaV0;
  /** Physical quantity category used for semantic checks. */
  readonly dimension: ExperimentQuantityDimensionV0;
  /** Coordinate space and dimension of the observation. */
  readonly frame: ExperimentFrameV0;
  /** Authored unit label retained with the observation. */
  readonly unit: string;
  /** Absolute comparison tolerance admitted during replay verification. */
  readonly replayTolerance: number;
  /** Explicit runtime quantity from which the value is derived. */
  readonly source: ExperimentObservationSourceV0;
}

/** Presentation-only reference to one future Three.js workbench pane. */
export interface ExperimentPaneDescriptorV0
  extends ExperimentDescriptorBaseV0 {
  readonly kind: 'three.pane.representation';
  /** Document-global pane id. */
  readonly id: ExperimentId;
  /** Representation id shown by the pane. */
  readonly representation: ExperimentId;
  /** Human-facing pane heading. */
  readonly title: string;
  /** Zero-based presentation column. */
  readonly column: number;
  /** Optional declarative coloring policy. */
  readonly palette?: 'source-cell' | 'depth' | 'uniform';
}

/** Versioned inert experiment document. */
export interface ExperimentDocumentV0 {
  /** Exact document schema identifier. */
  readonly schema: ExperimentSchemaIdV0;
  /** Human-facing experiment title. */
  readonly title: string;
  /** Authoritative source-space dimension shared by v0 constructions. */
  readonly ambientDim: number;
  /** Authored geometry constructors keyed by document-global id. */
  readonly sources: Readonly<
    Record<ExperimentId, ExperimentSourceDescriptorV0>
  >;
  /** Lower-dimensional construction recipes keyed by document-global id. */
  readonly representations: Readonly<
    Record<ExperimentId, ExperimentRepresentationDescriptorV0>
  >;
  /** Optional headless simulation models keyed by document-global id. */
  readonly models?: Readonly<
    Record<ExperimentId, ExperimentModelDescriptorV0>
  >;
  /** Discoverable controls with explicit semantic targets. */
  readonly parameters?: readonly ExperimentParameterDeclarationV0[];
  /** Discoverable bounded operations; declaration alone grants no execution. */
  readonly actions?: readonly ExperimentActionDeclarationV0[];
  /** Discoverable typed quantities exposed by a future runtime. */
  readonly observations?: readonly ExperimentObservationDeclarationV0[];
  /** Optional renderer-facing layout that never owns source state. */
  readonly presentation?: {
    readonly panes: readonly ExperimentPaneDescriptorV0[];
  };
  /** Required or preferred runtime capability declarations. */
  readonly backends?: readonly ExperimentBackendRequirementV0[];
  /** Reserved for a later separate evidence-map contract. */
  readonly evidence?: never;
}

/** Resource budgets applied to raw intake and object validation. */
export interface ExperimentValidationLimitsV0 {
  /** Maximum UTF-8 bytes accepted by raw JSON intake. */
  readonly maxInputBytes: number;
  /** Maximum nested arrays/objects. */
  readonly maxDepth: number;
  /** Maximum total object members plus array elements. */
  readonly maxEntries: number;
  /** Maximum decoded UTF-16 code units in one string. */
  readonly maxStringLength: number;
}

/** Complete non-mutating validation evidence. */
export interface ExperimentValidationReportV0 {
  /** Whether no validation refusal was recorded. */
  readonly valid: boolean;
  /** Stable typed reasons the document was refused. */
  readonly failures: readonly ExperimentFailure[];
  /** Accepted limitations that remain relevant to runtime/replay. */
  readonly warnings: readonly ExperimentFailure[];
  /** Stable topological order over sources, models, representations, panes. */
  readonly compileOrder: readonly ExperimentId[];
}

/** Canonical, hashed, deeply frozen descriptor product. */
export interface PreparedExperimentDocumentV0 {
  /** Independent deeply frozen copy reconstructed from canonical JSON. */
  readonly document: ExperimentDocumentV0;
  /** Deterministic canonical serialization used for identity. */
  readonly canonicalJson: string;
  /** SHA-256 digest of `canonicalJson`. */
  readonly documentHash: `sha256:${string}`;
  /** Stable dependency-respecting order for future compilation. */
  readonly compileOrder: readonly ExperimentId[];
  /** Validation limitations retained with the prepared product. */
  readonly warnings: readonly ExperimentFailure[];
}
