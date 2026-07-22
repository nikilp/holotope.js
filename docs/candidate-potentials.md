# Candidate-state conservative potentials

Optimization-based mechanics evaluates many configurations that never become
the live simulation state. Holotope represents one such trial configuration as
an ordered set of `XpbdParticleN` identities paired with finite RN positions.
A conservative provider evaluates that state without writing the particles:

```ts
type XpbdParticlePositionQueryN = (particle: XpbdParticleN) => VecN;

interface XpbdConservativeForceProviderN extends XpbdForceProviderN {
  evaluateAt(positionOf: XpbdParticlePositionQueryN): {
    readonly potentialEnergy: number;
    readonly forces: readonly VecN[];
  };
}
```

The force convention is

\[
f_i(q)=-\nabla_{q_i}U(q).
\]

`evaluateXpbdPotentialStateN()` composes any number of such providers and
returns the mathematical gradients `∇U`, not forces:

```ts
import { evaluateXpbdPotentialStateN } from '@holotope/physics';

const trial = evaluateXpbdPotentialStateN({
  dimension: 4,
  particles: binding.particles,
  positions: candidatePositions,
  providers: [elasticFamily, measureBarrierFamily]
});

console.log(trial.potentialEnergy);
console.log(trial.gradients);
console.log(trial.gradientNorm);
```

Assembly follows particle object identity. Providers may observe overlapping
particle subsets and may keep different particle orders; their gradients still
accumulate into the caller's authored order. Candidate positions are returned
to providers as defensive copies, so one provider cannot modify the trial
state seen by another. Fixed-particle gradients are retained because the
potential is defined independently of a later choice of free degrees of
freedom.

`SimplexConstitutiveFamilyN` and its named StVK and compressible Neo-Hookean
wrappers are conservative providers. A lower-measure barrier compiled through
the same generic family is another provider over the exact same source cells
and particle identities. Each provider retains its own energy and element
evidence in the assembled result.

This interface is a pure Float64 objective boundary. It does not add inertial
energy, construct a Hessian, select free degrees of freedom, perform a line
search, or advance time. Those are solver policies that can consume this
candidate-state evaluation without changing its energy and gradient contract.
