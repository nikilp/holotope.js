# Provenance-driven decorations

A decoration assigns data to geometry from the geometry's retained source identity:

```
c : source provenance -> parameter
```

This is distinct from coloring by projected position or screen coordinates. A camera may move and
the renderer may change without changing the parameter assigned to a source point.

`Decoration<Source, Parameter>` is the small renderer-independent contract. `applyDecoration`
evaluates it over a finite source collection while retaining each source beside its parameter.

```ts
import {
  applyDecoration,
  elserSloanePerpendicularParameterDecoration,
  elserSloaneNormPatch
} from '@holotope/core';

const patch = elserSloaneNormPatch({ maxE8Norm: 8 });
const decorated = applyDecoration(
  elserSloanePerpendicularParameterDecoration,
  patch.points
);

decorated[0].parameter.exact;       // four exact Z[phi] numerators
decorated[0].parameter.denominator; // their common scale
decorated[0].parameter.value;       // one Float64 view for a field evaluator
```

## The canonical Elser–Sloane parameter

An accepted E8 lattice point `x` has two complementary coordinates:

```
v = pi_parallel(x)
c = pi_perpendicular(x).
```

The physical coordinate `v` places a vertex in the Elser–Sloane model set. The internal coordinate
`c` is the canonical parameter attached to that vertex: it is the part of the same exact lattice
identity that a physical-space renderer would otherwise discard. The implementation retains both
the ring-valued coordinate and its common denominator; conversion to Float64 happens only when a
field evaluator needs it.

The internal window is consequently also the natural parameter domain. A finite model-set patch
samples that domain in a structured way rather than assigning unrelated random parameters to its
vertices.

## Equivariance as a finite certificate

For the H4 action, physical and internal spaces carry Galois-conjugate representations. If `g`
acts on physical provenance and `g~` is its internal action, the parameter map obeys

```
c(g x) = g~ c(x).
```

`checkDecorationEquivariance` verifies this law on a finite orbit. It requires exact source keys,
so it separately reports a source action that leaves the supplied orbit and a parameter action that
fails to intertwine. The Elser–Sloane helpers expose four exact simple reflections with Coxeter links
`5-3-3` and their Galois-twisted parameter actions.

```ts
import {
  checkDecorationEquivariance,
  doubledIcosianKey,
  elserSloaneDecorationGenerators,
  elserSloaneGerm,
  elserSloaneGermParameterDecoration,
  exactParameter4Equals
} from '@holotope/core/coupling';

const sources = elserSloaneGerm().points.map((point) => point.icosian);
const report = checkDecorationEquivariance({
  sources,
  decoration: elserSloaneGermParameterDecoration,
  generators: elserSloaneDecorationGenerators(),
  sourceKey: doubledIcosianKey,
  parameterEquals: exactParameter4Equals
});

report.equivariant; // true
report.checked;     // 4 generators x 240 source points
```

## Parameters do not prescribe presentation

The canonical map determines which parameter belongs to a vertex. It deliberately does not dictate
how that parameter becomes color, material, a sampled field, or geometry. These are presentation
maps layered after `Decoration` and may expose their own approximation budgets.

## Skew-product rotor flows

A dynamic coupling adds a compact rotation fiber to a base dynamical system:

```
(x, R) -> (f(x), exp(epsilon B(x)) R).
```

`SkewProductFlow<Base>` stores the base map, a state-dependent four-dimensional bivector cocycle,
and the scalar coupling `epsilon`. Each step converts the bivector to `Rotor4`, composes it on the
left of the existing fiber, and normalizes the two quaternion factors. The transported geometry is
therefore acted on only by SO(4) isometries.

```ts
import { BivectorN, SkewProductFlow } from '@holotope/core';

type ComplexPoint = readonly [imaginary: number, real: number];

const flow = new SkewProductFlow<ComplexPoint>({
  baseMap: ([y, x]) => [2 * x * y, x * x - y * y], // z -> z^2
  cocycle: ([y]) => new BivectorN(4)
    .set(0, 1, 0.2 * y)
    .set(2, 3, -0.2 * y),
  coupling: 0.5
});

const next = flow.step(flow.initial([Math.sqrt(3) / 2, -0.5]));
next.fiber; // an SO(4) rotation, not a matrix drift approximation
```

## Periodic-orbit holonomy

For a period-`p` base orbit, the ordered product

```
H = exp(epsilon B(f^(p-1)x)) ... exp(epsilon B(fx)) exp(epsilon B(x))
```

is its fiber holonomy. `periodicOrbitHolonomy` reports the sampled orbit, numerical base-closure
error, the resulting rotor, and a cover-independent Frobenius residual between its SO(4) matrix and
identity.

The report calls the result an `essentialWitness` only when both conditions hold:

- the claimed base orbit closes within the declared tolerance;
- its holonomy differs from identity beyond the declared tolerance.

A nonidentity periodic holonomy is a finite obstruction to the cocycle being a coboundary. Turning
that obstruction into the full Livšic conclusion still assumes the usual regularity and hyperbolic
base hypotheses; the API certifies the finite computation rather than silently asserting those
global hypotheses.

The null cocycle is the required negative control. Every increment and its holonomy are exactly
identity, so any remaining visible motion must come from a camera or another explicitly separate
transform.
