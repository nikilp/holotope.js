# Experiment documents

An experiment document is an inert, versioned recipe for assembling a
Holotope experience. It gives tools—and eventually agents—a discoverable way
to say which authoritative geometry exists, which simulation owns its pose,
which lower-dimensional representations should be produced, and which
parameters, actions, and observations are available.

The current `holotope.experiment/0` slice is intentionally only the document
boundary:

```text
untrusted JSON
  → bounded parse with duplicate-key evidence
  → structural and semantic validation
  → canonical JSON + SHA-256 identity + stable dependency order
  → immutable prepared document

  [runtime compilation comes next]
```

It does not create a scene, a physics world, DOM controls, or a Three.js
renderer. That separation lets the authored contract be reviewed and tested
without hiding construction choices in a convenient demo wrapper.

## Three identities that must not be conflated

| Identity | Owned by | Meaning |
| --- | --- | --- |
| Experiment id | Future runtime registry | The authored name of a source, model, representation, or pane |
| Runtime object identity | Core, physics, or adapter package | The actual compiled object and its lifetime |
| `RepresentationLineageN` | A constructed representation | Evidence describing how a visible result was derived from its source |

A descriptor is a construction recipe, not provenance. Lineage only exists
after construction and must describe what actually happened. Experiment ids
therefore do not become fields on `ObjectN`; the future runtime registry will
own the association externally.

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

The document can be validated and identified today. Live compilation, bounded
action execution, observation reads, and replay evidence are subsequent
runtime slices. A `continuous` section frame is already accepted with a
`replay-limited` warning because its transported display frame depends on
history; a canonical section frame is the deterministic default.

## Deliberate boundaries

- There is no global kind registry. Future compilation receives an explicit
  caller-supplied capability set.
- There is no dynamic import or arbitrary constructor name in the document.
- The JSON Schema subset has no remote `$ref`, pattern engine, or executable
  default.
- A prepared hash identifies the authored document, not hidden runtime state.
- Presentation metadata cannot make a renderer authoritative over source or
  simulation state.
- Validation does not promise that every accepted descriptor has been
  compiled; compilation capabilities and refusal evidence remain a separate
  contract.

These boundaries are what make the format suitable for local tools, paper
companions, and agent-guided construction without turning a declarative file
into an ambient code-execution mechanism.
