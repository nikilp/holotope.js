# Documentation gaps

The reference on this site is generated from source. Where it is thin, the
source is thin — this page records exactly where, so the gaps are a work queue
rather than a surprise.

Measured against the generated model at the commit this page was written.

::: tip The gaps below cannot grow
CI runs a coverage gate that fails when a **newly exported** symbol carries no
description. The 3,579 symbols undocumented when the gate was introduced are
grandfathered in `docs/doc-baseline.json`, so the rule is *coverage may not
regress* — new work carries documentation without anyone having to drain the
backlog first. The baseline is the measure of progress: it has fallen from
3,579 to 3,480. See [Keeping it from growing back](#keeping-it-from-growing-back).
:::

## The shape of the gap

Coverage is not uniformly low. It splits cleanly by layer:

| Layer | core | three | physics | Overall |
| --- | --- | --- | --- | --- |
| Classes | 22/23 | 19/19 | 65/65 | **~100%** |
| Functions | 141/166 | 10/12 | 97/108 | ~87% |
| Methods | 67/137 | 34/64 | 72/215 | ~41% |
| Properties | 234/829 | 69/277 | 573/2379 | ~25% |
| Interfaces | 41/163 | 7/33 | 63/315 | ~22% |
| Accessors | 0/3 | 0/9 | 5/31 | ~12% |
| **Constructors** | **0/22** | **0/19** | **0/53** | **0%** |

Every one of the 107 classes carries a real doc comment, several of them
excellent. Not one of the 94 constructors carries any. There are seven `@param`
tags and one `@returns` in the entire monorepo.

The consequence is visible on any generated page: a class opens with a genuine
explanation of what it is and why it works the way it does, then renders a
parameters table with headers and no rows.

So the existing JSDoc answers **"what is this and why"** very well, and
**"how do I call it"** almost not at all.

## Priority 1 — constructors on the entry points

94 undocumented constructors, but they are not equally important. These are the
ones a reader meets first, ordered by parameter count:

| Params | Package | Class |
| --- | --- | --- |
| 4 | core | `ModelSet` |
| 4 | three | `SettledSupersampling3D` |
| 3 | core | `CameraN` |
| 3 | core | `CellComplex` |
| 3 | core | `ConvexWindow` |
| 3 | core | `Rotor4Track` |
| 3 | core | `TransformN` |
| 3 | three | `FieldRelief3D` |
| 3 | three | `ProjectedEdges3D` |
| 3 | three | `ProjectedSurface3D` |
| 3 | three | `SampledSlicedField3D` |
| 3 | three | `SlicedComplex3D` |

The four render products plus `TransformN`, `CellComplex`, and `CameraN` are the
first API surface almost every user touches. Documenting those twelve
constructors is the single highest-value documentation change available.

## Priority 2 — options interfaces

121 interfaces of four or more properties have **no** property documentation at
all, down from 125. In this API the options interface *is* the thing a caller has to fill in,
so an undocumented one is a dead end. The largest:

| Props | Package | Interface |
| --- | --- | --- |
| 18 | physics | `ConvexRigidCastResult4` |
| 17 | core | `AvailableSourceSimplexObservationFitN` |
| 16 | physics | `HyperplaneRigidCastResult4` |
| 14 | physics | `HyperboxHyperplaneContactPatch4` |
| 12 | physics | `HyperplaneLinearCastResultN` |
| 12 | physics | `PolytopeContactPatchDiagnostics4` |
| 12 | physics | `PolytopeHyperplaneContactResult4` |
| 11 | physics | `HyperboxHyperplaneContactResult4` |
| 11 | physics | `XpbdOrientedCuboidFamilyCellN` |

Result types matter as much as input types here, and the cast results are now
done: `ConvexRigidCastResult4`, `HyperplaneRigidCastResult4`, and
`HyperplaneLinearCastResultN` each state which fields carry an answer for each
status, and that `safeTime` is the one always worth reading.

The distinction that documentation had been hiding: an `indeterminate` status
is a refusal, not a miss. Conservative advancement stopped without deciding,
and treating it as a miss is how a tunnelling bug gets written.

`AvailableSourceSimplexObservationFitN` is also done, being the largest type in
`representation`: it now says to read `consistency` and `determination` before
trusting the recovered coordinate, because a compromise and a recovered point
are indistinguishable from the coordinate alone.

## Resolved — types that were public but unnameable

Seven types appeared in public signatures without being exported, so a caller
could not write the type down. All are now exported and documented:
`ExactPair`, `Point4`, `SliceAxis3`, `ContactColliderPolicy4`,
`DistanceCoordinate4BaseOptions`, `ContactPatchKind4`.

`representation/map.ts` had redeclared `Point3` rather than importing the one
`field/sample.ts` already exported; the duplicate is gone, so the name means
one thing across the package.

Typedoc emits no warnings.

## Resolved — subpath exports for `scene` and `animation`

Both sat beside the other ten modules in `src/index.ts` while being reachable
only through the root barrel. `@holotope/core/scene` and
`@holotope/core/animation` now resolve, and the exports map is ordered as the
modules are declared.

## Conventions when filling these in

The existing JSDoc is prose-first and that is worth preserving — `Rotor4`'s class
comment explaining the so(4) ≅ so(3) ⊕ so(3) split is better documentation than
any tag list. The gap is not that the prose is wrong; it is that the call-site
layer is missing under it.

So: add `@param` and `@returns` **in addition to** the prose, not instead of it.

```ts
/**
 * Render product: the projected 1-skeleton of a complex, as LineSegments.
 *
 * [existing prose about why this product exists stays exactly as it is]
 *
 * @param complex - Source complex; its 1-cells become line segments.
 * @param projection - N→3 map applied per update. Must match `complex.dim`.
 * @param options - Material and color overrides; see {@link ProjectedEdges3DOptions}.
 */
```

Two rules that matter more than completeness:

1. **Document what the parameter means, not what its type already says.**
   `@param n - The dimension` is noise; `@param n - Ambient dimension; must
   match the complex, which is not checked until update()` is documentation.
2. **On result interfaces, say when a field is meaningful.** Most of the cast
   and contact result types have fields that are only defined on a hit.

## Keeping it from growing back

A one-off documentation pass decays. The gate exists so it does not have to be
repeated.

```sh
pnpm --filter @holotope/docs coverage          # check; fails on regression
pnpm --filter @holotope/docs coverage:update   # accept the current state
```

It reads the same TypeDoc model the reference is rendered from, so it cannot
disagree with what the published pages show. A symbol counts as documented when
it — or one of its signatures — carries a description.

**Scope.** Only the public surface is checked: what the package barrels actually
export. A helper that is not re-exported is invisible to the gate, as it is to
users. Re-export aliases are skipped, since the target carries the documentation.

**When the gate fails**, it names each new symbol grouped by kind. Add a
description; do not reach for `coverage:update` first. Updating the baseline is
for the rare symbol that genuinely does not warrant prose — and it is a visible
diff, so the choice is reviewable.

**Draining the backlog** is the reverse: document a few grandfathered symbols,
then run `coverage:update` to remove them from the baseline. They can never
silently regress afterwards. The baseline shrinking is the measure of progress,
and the priorities above are the order worth doing it in.

**One thing the gate does not check**: whether a description is *useful*.
`@param n - The dimension` satisfies it and teaches nothing. The conventions
above are not enforceable by a script.
