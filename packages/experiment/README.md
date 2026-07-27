# @holotope/experiment

Versioned, inert experiment documents for Holotope.

This first slice defines and validates authored descriptions of sources,
models, representations, parameters, actions, observations, panes, and backend
requirements. It also produces a canonical JSON form and SHA-256 identity.
It deliberately does **not** compile descriptors into live core, physics, or
Three.js objects yet.

```ts
import {
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
    console.log(prepared.value.documentHash);
    console.log(prepared.value.compileOrder);
  }
}
```

Use raw intake when the input crosses a trust boundary: a JavaScript object
cannot reveal duplicate JSON keys that `JSON.parse()` already discarded.
Validation is synchronous and non-mutating. Preparation is asynchronous
because it uses the standard Web Crypto SHA-256 API, and returns a copied,
deeply frozen document.

Construction descriptors are authored recipes. They are not runtime objects
and they are not `RepresentationLineageN`: lineage is evidence derived when a
representation is actually constructed. A later package slice will add a
caller-capability compiler and runtime registry without putting experiment ids
on `ObjectN`.

See the [experiment document guide](../../docs/learn/experiment-documents.md)
for the contract and its current boundary.
