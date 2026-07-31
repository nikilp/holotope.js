# @holotope/experiment

Versioned, inert experiment documents for Holotope, plus a headless,
explicit-capability runtime.

The package defines and validates authored descriptions of sources, models,
representations, parameters, actions, observations, panes, and backend
requirements; produces a canonical JSON form and SHA-256 identity; and can
compile the prepared document's sources, models, and
coordinate/perspective/section representations into live objects behind a
registry. Parameters, bounded actions, observations, exact CPU snapshots, and
trace replay are runtime contracts rather than demo-specific state.

```ts
import {
  compileExperimentDocumentV0,
  coreExperimentCompilerV0,
  parseExperimentJsonV0,
  prepareExperimentDocumentV0,
  validateExperimentDocumentV0
} from '@holotope/experiment';

const parsed = parseExperimentJsonV0(sourceText);
if (!parsed.ok) throw new Error(parsed.failures[0]?.message);

const report = validateExperimentDocumentV0(parsed.value);
if (!report.valid) {
  console.error(report.failures);
} else {
  const prepared = await prepareExperimentDocumentV0(parsed.value);
  if (prepared.ok) {
    const compiled = compileExperimentDocumentV0(prepared.value, {
      compilers: [coreExperimentCompilerV0()]
    });
    if (compiled.ok) {
      console.log(compiled.value.ids);
      const section = compiled.value.get('section');
      if (section.ok && section.value.category === 'representation') {
        console.log(section.value.lineage.steps);
      }
    } else {
      console.error(compiled.failures);
    }
  }
}
```

Use raw intake when the input crosses a trust boundary: a JavaScript object
cannot reveal duplicate JSON keys that `JSON.parse()` already discarded.
Validation is synchronous and non-mutating. Preparation is asynchronous
because it uses the standard Web Crypto SHA-256 API, and returns a copied,
deeply frozen document.

Compilation is synchronous, all-or-nothing, and driven by explicit
caller-supplied capabilities — there is no global kind registry and a
document can never name or load code. A kind without a supplied capability,
a version mismatch, or an unsupported construction is a typed refusal that
constructs nothing. Presentation panes are validated and retained on the
document but deliberately omitted from the headless registry: a renderer
adapter consumes them later. The registry alone owns experiment ids; compiled
objects stay anonymous mathematical values, and `RepresentationLineageN` is
derived from the projection or slice actually constructed, never from the
descriptor. Because the compiled vocabulary is closed, a compiled
representation never reports a `custom-projection` lineage step.

See the [experiment document guide](../../docs/learn/experiment-documents.md)
for the contract and its current boundary.

## Snapshots and replay

A compilation captures its complete layer-2 state at a step boundary, restores
it transactionally, and replays a recorded trace bitwise:

```ts
const taken = compilation.snapshot();
compilation.restore(taken.value);              // hash-bound, level-negotiated
compilation.replay(compilation.trace().value); // through the public paths
```

Numeric state travels as little-endian Float64 in base64 rather than JSON
numbers, so `-0` and denormals survive. Restore sets `step` from the snapshot
and bumps `revision`; restoring the initial snapshot is how a compilation is
reset. This slice emits only the `exact-cpu` level.

## Actions and the probe

An action declaration gains an optional `operation` naming what it does, from
a closed vocabulary — documents name effects, never code:

```ts
compilation.invoke('step', { steps: 120 });                    // applied
compilation.invoke('step', { steps: 999 });                    // budget-exceeded
compilation.invoke('step', { steps: 40 }, { mode: 'preview' }); // unobservable
```

Budgets are checked before anything runs. A preview runs the operation for
real and puts everything back, so state, revision, and trace are byte-identical
afterwards. The probe reports exact evidence for a section and refuses to
invent a point for a projection, which is many-to-one without a ray.

## Runtime discovery

Tools can discover the authored surface and read live parameter state without
maintaining a shadow store:

```ts
compilation.listParameters();
compilation.listActions();
compilation.listObservations();

const offset = compilation.readParameter('sliceOffset');
// { id: 'sliceOffset', value: 0.12, revision: 1 }
```

`readParameter()` reads through to the compiled target. Restore and replay are
therefore reflected immediately. A headless-unowned target such as playback
state or presentation metadata returns a typed `capability-unavailable`
refusal rather than a descriptor default mistaken for live state.

For the complete pipeline — source, model, three views, render products,
and an honest pick — see
[Build a dimension bridge](../../docs/learn/source-retained-dimension-bridge.md).
