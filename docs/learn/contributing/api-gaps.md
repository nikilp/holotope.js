# Documentation gaps

The reference on this site is generated from source. Where it is thin, the
source is thin — this page records exactly where, so the gaps are a work queue
rather than a surprise.

Measured against the generated model at the commit this page was written.

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

125 interfaces of four or more properties have **no** property documentation at
all. In this API the options interface *is* the thing a caller has to fill in,
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

Result types matter as much as input types here: a caller who receives a
`ConvexRigidCastResult4` with 18 undocumented fields cannot tell which are
meaningful when the cast misses.

## Priority 3 — types that are public but unnameable

These appear in public signatures but are not exported, so a caller cannot write
the type down:

| Type | Package | Referenced by |
| --- | --- | --- |
| `ExactPair` | core | `penroseUnitPentagon` |
| `Point4` | core | `AffineSectionMapRecipe4.normal` |
| `Point3` | core | `SampledIsosurfaceMapRecipe3.max` |
| `SliceAxis3` | three | `FieldRelief3DOptions.planeAxes` |
| `ContactColliderPolicy4` | physics | `GlomeCollider4` |
| `DistanceCoordinate4BaseOptions` | physics | `DistanceCoordinate4Options` |
| `ContactPatchKind4` | physics | `HyperboxContactPatchKind4` |

Each is a one-line export fix, and each currently forces a caller into
`ReturnType<>` gymnastics or `any`.

## Priority 4 — two modules with no subpath export

`@holotope/core` exports ten subpaths (`./math`, `./geometry`, `./polytope`,
`./coxeter`, `./projection`, `./lattice`, `./field`, `./coupling`, `./spectral`,
`./representation`). But `scene` and `animation` are reachable only through the
root barrel, despite being peers of the other ten in `src/index.ts`.

Either add `./scene` and `./animation` to the exports map, or document why they
are root-only. The reference currently generates them as modules alongside the
other ten, which quietly implies a subpath that does not exist.

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
