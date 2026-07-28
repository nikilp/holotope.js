# @holotope/experiment

Versioned, inert experiment documents for Holotope, plus the first headless
compilation stage.

The package defines and validates authored descriptions of sources, models,
representations, parameters, actions, observations, panes, and backend
requirements; produces a canonical JSON form and SHA-256 identity; and can
compile the prepared document's core hypercube sources and
coordinate/perspective/section representations into live `@holotope/core`
objects behind a registry.

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
a version mismatch, or a category this slice cannot construct (physics
models, panes, and model-owned transforms) is a typed refusal that constructs
nothing. The registry alone owns experiment ids; compiled core objects stay
anonymous mathematical values, and `RepresentationLineageN` is derived from
the projection or slice actually constructed, never from the descriptor.
Because the compiled vocabulary is closed, a compiled representation never
reports a `custom-projection` lineage step.

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
