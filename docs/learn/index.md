# Learn

This is the guide. For per-symbol signatures see the generated reference for
[core](/api/core/), [experiment](/api/experiment/), [three](/api/three/), and
[physics](/api/physics/); for running demos see the
[showcase](https://nikilp.github.io/holotope.js/).

## Start here

Read these in order. Between them they cover the model the rest of the
documentation assumes.

| Page | What it answers |
| --- | --- |
| [The mental model](./mental-model) | How source, representation, interaction, and simulation relate — and why a projected mesh is never the source object |
| [Architecture](./architecture) | The decisions that shape the library, with their reasoning |
| [Experiment documents](./experiment-documents) | How authored experiences are validated and identified before runtime compilation |
| [Build a dimension bridge](./source-retained-dimension-bridge) | The complete typed pipeline: one authoritative R4 body, a rigid model, three views, and an honest pick |
| [Cookbook](./cookbook) | Verified recipes for concrete tasks |
| [Playground](./playground) | Run and edit the reference's examples in the browser |

## Source and representation

The library's distinguishing claim is that a 3D view carries its origin with it.
A projection is many-to-one, so 3D coordinates cannot define an inverse —
traceability comes from a second map retained during construction.

- [Representation provenance](./representation-provenance) — what a pick can and cannot recover
- [Provenance-driven decorations](./couplings) — assigning parameters from retained source identity

## Mechanics

`@holotope/physics` is headless: it never renders, and it never treats a visible
slice as a simulation boundary. It is also two separate simulation layers —
`RigidBody4` for R4 rigid motion and `XpbdParticleN` for dimension-generic
compliant point dynamics — which do not share semantics.

[Start with the mechanics overview →](./physics/)

## Exact constructions

Where a construction has an exact description, the library computes it exactly
and converts to Float64 once, at the end.

- [E8 through the H4 folding](./theory/e8-folding)
- [Cut-and-project model sets](./theory/model-sets)
- [Implicit fields in R4](./theory/implicit-fields)
- [Spectral analysis on cell complexes](./theory/spectral-analysis)

## Optimization-based mechanics

- [Incremental potential objectives](./theory/incremental-potentials)
- [Candidate-state conservative potentials](./theory/candidate-potentials)

## Contributing

- [Documentation gaps](./contributing/api-gaps) — where the reference is thin, and why
