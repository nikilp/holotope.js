# Experiment documents

An experiment document is an inert, versioned recipe for assembling a
Holotope experience. It gives tools—and eventually agents—a discoverable way
to say which authoritative geometry exists, which simulation owns its pose,
which lower-dimensional representations should be produced, and which
parameters, actions, and observations are available.

The current `holotope.experiment/0` pipeline covers the document boundary and
a complete headless source–model–representation runtime:

```text
untrusted JSON
  → bounded parse with duplicate-key evidence
  → structural and semantic validation
  → canonical JSON + SHA-256 identity + stable dependency order
  → immutable prepared document
  → explicit caller-supplied compiler capabilities
  → registry-owned experiment ids over live core and model objects
  → derived RepresentationLineageN evidence
  → live parameters + bounded actions + stamped observations
  → exact CPU snapshots + traces + replay
```

The base package does not create a scene, DOM controls, a playback driver, or
a Three.js renderer. A caller-supplied physics capability may construct a
headless model, while presentation panes remain validated document metadata.
That separation lets the authored contract be reviewed and tested without
hiding construction choices in a convenient demo wrapper.

## Three identities that must not be conflated

| Identity | Owned by | Meaning |
| --- | --- | --- |
| Experiment id | The prepared document; the registry for runtime entries | The authored name of a source, model, representation, or pane |
| Runtime object identity | Core, physics, or adapter package | The actual compiled object and its lifetime |
| `RepresentationLineageN` | A constructed representation | Evidence describing how a visible result was derived from its source |

A descriptor is a construction recipe, not provenance. Lineage only exists
after construction and must describe what actually happened. Runtime
experiment ids therefore do not become fields on `ObjectN`; the compilation
registry owns those associations externally, and compiled core objects stay
anonymous mathematical values. Pane ids remain document-level presentation
ids and intentionally do not enter that headless registry.

## Safe intake

For text from a file, network, or agent, parse before validating:

```ts
import {
  parseExperimentJsonV0,
  prepareExperimentDocumentV0,
  validateExperimentDocumentV0
} from '@holotope/experiment';

const parsed = parseExperimentJsonV0(text, {
  maxInputBytes: 1_000_000,
  maxDepth: 48,
  maxEntries: 20_000
});
if (!parsed.ok) {
  console.error(parsed.failures);
  return;
}

const report = validateExperimentDocumentV0(parsed.value);
if (!report.valid) {
  console.error(report.failures);
  return;
}

const prepared = await prepareExperimentDocumentV0(parsed.value);
if (!prepared.ok) {
  console.error(prepared.failures);
  return;
}

console.log(prepared.value.documentHash);
console.log(prepared.value.compileOrder);
```

`parseExperimentJsonV0()` scans before calling native `JSON.parse()`. This is
the only point at which duplicate keys— including escape-equivalent keys such
as `"a"` and `"\u0061"`—can still be reported. It also rejects
prototype-sensitive keys and applies byte, depth, entry, and string budgets.

`validateExperimentDocumentV0()` accepts an existing value, never mutates it,
never executes accessors, and returns typed failures with JSON Pointers. It
checks closed descriptor vocabularies, document-global id uniqueness,
references, dependency cycles, dimensions, coordinate frames, unit semantics,
parameter targets, the supported JSON Schema subset, and backend declarations.

`prepareExperimentDocumentV0()` repeats validation, canonicalizes the document,
hashes that canonical form with Web Crypto SHA-256, copies it, and deeply
freezes the copy. Equal documents with different object-key insertion order
therefore receive the same identity. The operation is asynchronous because
the standard browser crypto API is asynchronous.

## Compiling with explicit capabilities

`compileExperimentDocumentV0()` turns a prepared document into live core
objects. The caller states what the environment can construct by passing
capability values; the document itself can never name, request, or load one:

```ts
import {
  compileExperimentDocumentV0,
  coreExperimentCompilerV0
} from '@holotope/experiment';

const compiled = compileExperimentDocumentV0(prepared.value, {
  compilers: [coreExperimentCompilerV0()]
});
if (!compiled.ok) {
  console.error(compiled.failures); // typed, pointer-addressed, collected
  return;
}

console.log(compiled.value.ids);    // registry ids in construction order
const section = compiled.value.get('section');
if (section.ok && section.value.category === 'representation') {
  section.value.lineage;            // derived from the live slice
  section.value.capabilities;       // exact lift, no inverse fibre, …
}

compiled.value.dispose();           // releases the registry exactly once
```

The core capability constructs supported source geometry and the three closed
representation kinds —
`core.representation.coordinate`, `core.representation.perspective`, and
`core.representation.section4` — plus literal transforms. Compilation is
all-or-nothing: every descriptor in the dependency order is planned against
the supplied capabilities first, and an unclaimed kind, a kind-version
mismatch, or a model without a supplied capability refuses the whole
compilation with typed evidence before any object exists. Nothing is partially
or optimistically compiled. Valid presentation panes are retained on
`compilation.document` and skipped by the headless registry; their ids are not
runtime-object ids.

Lineage is where the one-way arrow becomes visible. The compiler derives each
representation's `RepresentationLineageN` from the projection or slice it
actually constructed — a section authored with a non-unit normal is witnessed
with the unit normal and chart basis the live object carries. Because the
compiled vocabulary is closed, a compiled representation can never report a
`custom-projection` step, so experiment lineage is always fully
parameterized.

The R3 specialization stays clean: an `ambientDim: 3` document compiles a
cube and an exact XYZ coordinate view without manufacturing any fourth
coordinate.

## The first vertical document

Schema v0 can describe one source-first R4 bridge:

- a tesseract or another supported regular polychoron;
- an optional headless `physics.model.rigid4` pose owner;
- perspective and exact-section representations sharing that source and pose;
- parameters such as section offset or view distance;
- declared actions and observations with a deliberately small JSON Schema
  subset;
- presentation panes that reference representations rather than duplicate
  geometry;
- a mandatory CPU reference backend when backend requirements are declared.

The complete bridge can be validated, identified, and compiled today when the
caller supplies both the core and physics capabilities. Model stepping,
bounded action execution, fresh observation reads, live parameter reads and
writes, snapshots, trace recording, and exact CPU replay are implemented.
Presentation panes validate and survive preparation but stay outside the
headless object registry. A `continuous` section frame is accepted with a
`replay-limited` warning because reconstructing its transported display frame
from the document alone depends on history; snapshots capture that live frame
exactly.

## Models, and the clock they run on

A document becomes more than a static assembly once something owns a pose
that changes. `physics.model.rigid4` compiles to a live R4 rigid body, and
`@holotope/experiment-physics` is the capability that builds it.

It is a separate package on purpose. `@holotope/experiment` depends on
`@holotope/core` and nothing else — a fact the test suite enforces rather
than merely intends — and a `@holotope/physics` subpath would hand every
physics consumer an experiment dependency it never asked for.

```ts
const compilation = compileExperimentDocumentV0(prepared, {
  compilers: [coreExperimentCompilerV0(), physicsExperimentCompilerV0()]
});
```

### The pose a representation sees is motion, not position

Rigid dynamics run in the principal frame: the body starts at its centre of
mass under its principal rotor. Source geometry, though, is authored in world
coordinates — that is what sections and projections already read. Handing a
representation the body pose would displace geometry that was never displaced.

So the model publishes motion *relative to where the geometry was authored*:

```text
referencePose = TransformN(4, principalRotor, centerOfMass)   (frozen at compile)
modelPose(t)  = bodyPose(t) ∘ referencePose⁻¹
```

At rest `modelPose(0)` is exactly identity, and the source complex is never
rebased or copied — it stays the single authoritative object.

### Representations bind, they do not copy

A representation with `transform: { fromModel: 'tumble' }` compiles to a
binding, not a transform:

```ts
representation.pose; // { kind: 'model', model: 'tumble' }
```

Consumers resolve it through the registry at read time. A pose copied at
compile time would be stale the moment the model advanced, and nothing in the
type would say so. A literal transform compiles to `{ kind: 'static', … }`
instead, which cannot go stale because nothing updates it.

### The clock counts steps, not seconds

```ts
compilation.advance(120); // every model by 120 fixed steps, then the clock
compilation.step;         // 120
```

Each `advance(k)` calls `world.step(fixedStep, substeps)` exactly `k` times
per model, so the clock counts *fixed steps of each model's own duration*.
Models advance before the clock moves, so a refusing model leaves the clock
where it was and the document is never ahead of its models. Step boundaries
are the only points at which model state is meaningful.

A document with no models advances only its clock. That is honest rather than
an error — the clock belongs to the document, not to any model.

Non-positive, fractional, and unsafe step counts are typed `invalid-value`
refusals; advancing after `dispose()` is `disposed`.

## Controlling and observing a compiled experiment

A compiled document exposes what it can be told and what it can be asked:

```ts
compilation.listParameters();   // declared controls
compilation.listActions();      // declared bounded operations
compilation.listObservations(); // declared readouts
```

These are frozen views of the document's own declarations, not new
information. They exist so a tool — or an agent — can discover a document's
surface without being told it out of band.

### Parameter state is read-through

There is no shadow parameter store. The compiled object's field *is* the
state. `readParameter()` reads through to that live target without mutation,
and `previous` is read from the same object at application time:

```ts
const current = compilation.readParameter('sliceOffset');
// { id: 'sliceOffset', value: 0.12, revision: 1 }
```

The returned value is current after direct mutation, restore, or replay; it is
never the declaration default remembered separately.

```ts
const applied = compilation.setParameter('sliceOffset', 0.62);
applied.outcome;  // 'applied'
applied.previous; // 0.12
applied.revision; // 2
```

A refusal changes nothing — not the target, not the revision, and never
partially:

```ts
const refused = compilation.setParameter('sliceOffset', 1.4);
refused.outcome;       // 'refused'
refused.failure?.code; // 'out-of-range'
compilation.revision;  // still 2
```

A `normal` parameter is stored normalized, so a later read reports the unit
vector rather than what was written — and `previous` reports the normalized
value for the same reason.

### Counts are what the product emits

An observation of `triangles` on a section reports **48** for a tesseract, not
the 12 faces its cross-section has. The section is produced by marching
tetrahedra, and 48 is what that algorithm emits. Reporting 12 would describe a
product nothing produced.

The same rule holds everywhere: count observations are measured algorithm
outputs, never ideal-shape counts. An `edges` count on a section is a typed
refusal, because a triangle soup retains no edge product to count.

### Records are stamped, not flagged

```ts
const record = compilation.observe('angularMomentum');
// { value, revision, step }
```

Every value is computed fresh — nothing is memoized in this slice, so there is
no `stale` flag to trust or mistrust. Staleness is a comparison the caller
makes:

```ts
record.value.revision < compilation.revision // something changed since
```

The revision starts at 1 and bumps once per accepted mutation: an applied
`setParameter`, an accepted `advance`. That is deliberately the only thing it
counts, so a caller comparing against it is never told something changed when
nothing did.

### What refuses, and why

`clock` parameters (`rate`, `running`) refuse with `capability-unavailable`:
the headless runtime has no playback driver. `presentation` parameters refuse
because panes are not compiled headlessly. `selection` observations refuse
because a probe deliberately establishes no selection — see below. Each names the seam it is waiting on
rather than failing vaguely or, worse, silently doing nothing.

## Snapshots, traces, and honest replay

A compiled experiment can be captured, restored, and replayed bitwise.

```ts
const taken = compilation.snapshot();   // complete layer-2 state
compilation.restore(taken.value);       // transactional, hash-bound
compilation.replay(compilation.trace().value); // re-execute the recording
```

### Numbers do not go through JSON numbers

A snapshot exists to reproduce a run exactly, and JSON text cannot carry that
promise: `JSON.stringify(-0)` is `"0"`, and denormals lose their exact bit
pattern. Buffers are therefore little-endian Float64 encoded to base64 and
referenced by index — the same split glTF uses for vertex data, for the same
reason.

### Step is state; revision is not

Restore **sets** `step` from the snapshot, along with every model's own step
count, because simulated time is part of what was captured. It **bumps**
`revision`, because that counter records how many mutations this process has
accepted — restoring is one more of them, not a return to an earlier count.
The snapshot keeps the revision it was taken at as evidence only.

There is no separate reset. Restoring the trace's initial snapshot is a reset,
and a second method would be the same operation under another name.

### A continuous frame restores exactly

A `continuous` section transports its display basis, so the basis depends on
the *history* of the normal rather than its current value. Reconstructing such
a section from the document alone cannot recover that history — which is why
the document validator still warns `replay-limited`.

A snapshot does not reconstruct it. It serializes the live basis, so a
continuous-frame section restores **bitwise** onto a compilation that never
saw the history. The warning remains correct about documents; it does not
apply to snapshots.

### Traces replay through the public paths

Recording is always on. Every accepted `setParameter` and `advance` is
appended, and `replay` restores the initial snapshot and re-executes them
through those same public methods — never by writing state directly. A replay
can therefore only reproduce what the runtime would have done anyway.

A refused event aborts the replay naming its ordinal. State stays where the
last accepted event left it: a replay is a sequence of ordinary mutations, not
one transaction. Restore a snapshot if you need a clean state.

If recording hits `maxTraceEvents` (default 1,000,000) it stops, the runtime
keeps mutating normally, and `trace()` then **refuses**. Returning the prefix
would offer a replay that reproduces a different run.

### What the levels mean today

```ts
type ExperimentReplayLevelV0 = 'exact-cpu' | 'numeric-equivalent' | 'presentation-only';
```

This slice emits **only `exact-cpu`**. The weaker levels are the contract that
future backend and provider-state slices will produce; nothing produces them
yet. Passing `require` a level stronger than a snapshot carries refuses with
`replay-level-unmet`, and a snapshot from another document refuses with
`snapshot-incompatible` — `documentHash` equality is the only identity a
restore accepts.

## Actions and the probe

An action declaration says what it *is*; an `operation` says what it **does**:

```ts
operation: { kind: 'advance-clock' }
operation: { kind: 'set-parameter', parameter: 'sliceOffset' }
operation: { kind: 'probe' }
operation: { kind: 'reset' }
```

A closed vocabulary, exactly like an observation's `source`. Documents name an
effect, never code to run. The field is **optional**, so a document written
against an earlier validator stays valid — vocabulary grows here by optional
additive fields, and anything required would force a new schema version. An
action without one is discoverable metadata that cannot run, and `invoke`
says so rather than doing nothing quietly.

```ts
const result = compilation.invoke('step', { steps: 120 });
result.outcome;  // 'applied' | 'previewed' | 'refused'
```

There is no `rolled-back` outcome. Every operation is exactly one atomic
primitive, so there is no partial state for a rollback to undo. It becomes
reachable only if composite actions ever exist.

### Budgets are checked before anything runs

```ts
compilation.invoke('step', { steps: 241 });
// refused, budget-exceeded, { requested: 241, maxSteps: 240 }
```

Nothing executed: step, revision, and trace are untouched. `maxMillis` stays
declared-advisory — there is no wall-clock enforcement and no cancellation
here, because both trade determinism for a capability nothing headless needs
yet.

### Preview is unobservable by construction

`mode: 'preview'` captures state, runs the operation *for real*, collects the
output, and puts everything back. So a preview is exactly as accurate as a
commit, and afterwards state, revision, and `trace()` are byte-identical to
before. That is proven by test rather than asserted.

It requires `supportsPreview` on the declaration, since only the author knows
whether evaluating without committing is meaningful.

### What the probe can and cannot claim

For a **section**, the chart lift is exact. `embedPoint` returns the ambient
point on the cutting hyperplane whether or not geometry passes through it, so
`ambientPointStatus` is `'exact'` and the point satisfies the plane equation.
If the point lands on an emitted triangle, `sourceCell` names the **cut
tetrahedron** by structural identity.

Two things worth knowing there. A marched section is the cross-section's
*surface*, so a point "in the cut" means on a triangle, not at the solid's
centre. And the identity is the tetrahedron rather than the parent cube: the
compatibility tetrahedralization discards Kuhn parent provenance, so the
tetrahedron is the honest headless answer. Parent-cell enrichment is a named
seam if the tetrahedralizer ever retains that record.

For a **perspective or coordinate** representation, `ambientPointStatus` is
`'unavailable'` and there is no source cell. A projection is many-to-one, and
headlessly there is no ray and no hit record to disambiguate it — reporting a
point would upgrade a capability the lineage does not certify. Renderer-ray
hits belong to the workbench, through the existing `@holotope/three` machinery.

A probe returns evidence and **stores nothing**. It establishes no selection,
because hidden state changing without a revision bump would break the
staleness contract observations depend on.

### A restore is recorded

`restore()` appends a `restore` trace event carrying the complete snapshot —
snapshots being JSON-compatible by construction, which is what keeps a trace
self-contained. Without it, a manual restore silently made every later
`trace()` unfaithful: a replay would have reproduced a different run while
claiming to reproduce this one.

## Deliberate boundaries

- There is no global kind registry. Compilation receives an explicit
  caller-supplied capability set and copies it, so separate compilations
  share no state.
- There is no dynamic import or arbitrary constructor name in the document.
- The JSON Schema subset has no remote `$ref`, pattern engine, or executable
  default.
- A prepared hash identifies the authored document, not hidden runtime state.
  Compilation carries that identity; it does not re-hash or certify it.
- Presentation metadata cannot make a renderer authoritative over source or
  simulation state. Pane descriptors stay on the document for a renderer
  adapter, while a headless compilation constructs no pane objects.
- Validation does not promise that every accepted descriptor can be
  compiled; capability coverage is judged per compilation, and refusal
  evidence names the exact kind and location.

These boundaries are what make the format suitable for local tools, paper
companions, and agent-guided construction without turning a declarative file
into an ambient code-execution mechanism.
