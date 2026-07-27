# Experiment documents

An experiment document is an inert, versioned recipe for assembling a
Holotope experience. It gives tools—and eventually agents—a discoverable way
to say which authoritative geometry exists, which simulation owns its pose,
which lower-dimensional representations should be produced, and which
parameters, actions, and observations are available.

The current `holotope.experiment/0` pipeline covers the document boundary and
the first headless compilation stage:

```text
untrusted JSON
  → bounded parse with duplicate-key evidence
  → structural and semantic validation
  → canonical JSON + SHA-256 identity + stable dependency order
  → immutable prepared document
  → explicit caller-supplied compiler capabilities
  → registry-owned experiment ids over live core objects
  → derived RepresentationLineageN evidence

  [models, actions, observations, and replay come next]
```

It does not create a scene, a physics world, DOM controls, or a Three.js
renderer. That separation lets the authored contract be reviewed and tested
without hiding construction choices in a convenient demo wrapper.

## Three identities that must not be conflated

| Identity | Owned by | Meaning |
| --- | --- | --- |
| Experiment id | The compilation registry | The authored name of a source, model, representation, or pane |
| Runtime object identity | Core, physics, or adapter package | The actual compiled object and its lifetime |
| `RepresentationLineageN` | A constructed representation | Evidence describing how a visible result was derived from its source |

A descriptor is a construction recipe, not provenance. Lineage only exists
after construction and must describe what actually happened. Experiment ids
therefore do not become fields on `ObjectN`; the compilation registry owns
the association externally, and compiled core objects stay anonymous
mathematical values.

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

The core capability constructs `core.source.hypercube` (optionally
tetrahedralized) and the three closed representation kinds —
`core.representation.coordinate`, `core.representation.perspective`, and
`core.representation.section4` — plus literal transforms. Compilation is
all-or-nothing: every descriptor in the dependency order is planned against
the supplied capabilities first, and an unclaimed kind, a kind-version
mismatch, a physics model, a pane, or a model-owned transform refuses the
whole compilation with typed evidence before any object exists. Nothing is
partially or optimistically compiled.

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

The document can be validated, identified, and — for its core source and
representation path — compiled today. Model stepping, bounded action
execution, observation reads, and replay evidence are subsequent runtime
slices, so a document that declares a `physics.model.rigid4` or presentation
panes is refused by a core-only compilation with `capability-unavailable`
evidence instead of being partially constructed. A `continuous` section frame
is already accepted with a `replay-limited` warning because its transported
display frame depends on history; a canonical section frame is the
deterministic default.

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
  capabilities: [coreExperimentCompilerV0(), physicsExperimentCompilerV0()]
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
compilation.listObservations(); // declared readouts
```

These are frozen views of the document's own declarations, not new
information. They exist so a tool — or an agent — can discover a document's
surface without being told it out of band.

### Parameter state is read-through

There is no shadow parameter store. The compiled object's field *is* the
state, so `previous` is read from the live object at application time and is
exactly what a read would have returned:

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
because no selection surface exists yet. Each names the seam it is waiting on
rather than failing vaguely or, worse, silently doing nothing.

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
  simulation state; a headless compilation constructs no panes.
- Validation does not promise that every accepted descriptor can be
  compiled; capability coverage is judged per compilation, and refusal
  evidence names the exact kind and location.

These boundaries are what make the format suitable for local tools, paper
companions, and agent-guided construction without turning a declarative file
into an ambient code-execution mechanism.
