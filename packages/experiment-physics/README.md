# @holotope/experiment-physics

Physics model capability for Holotope experiment documents.

This adapter compiles `physics.model.rigid4` descriptors into live R4 rigid
bodies. It contains no mathematics of its own: construction and stepping
belong to `@holotope/physics`, and this only maps a descriptor onto them.

```ts
import { coreExperimentCompilerV0, compileExperimentDocumentV0 } from '@holotope/experiment';
import { physicsExperimentCompilerV0 } from '@holotope/experiment-physics';

const compilation = compileExperimentDocumentV0(prepared, {
  compilers: [coreExperimentCompilerV0(), physicsExperimentCompilerV0()]
});
if (compilation.ok) {
  compilation.value.advance(120);        // 120 fixed steps, then the clock
  compilation.value.step;                // 120
}
```

It is a separate package rather than a `@holotope/physics` subpath so that
`@holotope/experiment` stays core-only and no physics consumer inherits an
experiment dependency. Both facts are gate-tested.

The pose a representation reads is **motion relative to where the geometry was
authored**, not the body's principal frame: `modelPose(t) = bodyPose(t) ∘
referencePose⁻¹`, which is exactly identity at rest. The source complex is
never rebased or copied.

See the [experiment document guide](../../docs/learn/experiment-documents.md)
for the model capability, the pose binding, and the clock.
