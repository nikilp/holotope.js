# Spectral analysis on cell complexes

`@holotope/core` can treat the 1-skeleton of any `CellComplex` as a simple,
undirected graph and construct its unweighted combinatorial Laplacian

\[
L = D - A,
\]

where `D` is the diagonal degree matrix and `A` is adjacency. The construction
depends only on incidence, not on the positions or ambient dimension of the
vertices. The same graph embedded in R2, R4, or Rn therefore has the same
operator and spectrum.

```ts
import {
  eigenspaceProjector,
  graphLaplacian,
  graphLaplacianModes
} from '@holotope/core';

const operator = graphLaplacian(complex);
const applied = operator.apply(vertexValues); // Lx, sparse O(V + E)
const denseReference = operator.toDense();    // auditable Float64 D - A

const modes = graphLaplacianModes(complex);
const repeatedSpace = eigenspaceProjector(
  modes.eigensystem,
  modes.clusters[1]!
);
```

## Graph contract

All cell groups with intrinsic dimension 1 must contain two indices per cell.
Each pair is canonicalized to `(min, max)`, sorted, and deduplicated. Repeated
or reversed pairs are counted in `operator.diagnostics`; they do not change the
operator. Self-loops and other 1-cell arities are rejected rather than assigned
an implicit meaning.

`GraphLaplacianOperator` retains canonical edges, vertex degrees, and exact
connected-component labels. Its primary `apply()` path stores no dense matrix.
`toDense()` is the small-to-medium reference path used by the complete modal
solve. Its entries are integers represented exactly in Float64 for practical
graph sizes.

Two identities provide direct audits:

\[
L\mathbf{1}=0,
\qquad
x^T L x = \sum_{(i,j)\in E}(x_i-x_j)^2.
\]

The multiplicity of eigenvalue zero equals the number of connected components,
including isolated vertices.

## Symmetric eigensolver

`symmetricEigenDecomposition(matrix)` is the dimension-generic dense reference
solver shared by graph modes and 4D mass properties. It validates finite,
symmetric input and uses deterministic cyclic Jacobi sweeps in Float64. Results
include ascending eigenvalues, column eigenvectors, per-pair residual norms,
orthogonality error, and iteration diagnostics. Failure to converge within the
requested sweep limit is an error; no partial eigensystem is returned.

The matrix entries defining a graph Laplacian are exact, but a general
eigendecomposition is numerical. The returned residuals make that numerical
boundary inspectable.

## Repeated eigenvalues

For a non-repeated eigenvalue, an eigenvector is unique up to sign; the solver
fixes that sign deterministically. For a repeated eigenvalue, no individual
basis vector is canonical: any orthonormal rotation within the same eigenspace
is equally correct. `graphLaplacianModes()` therefore clusters nearby numerical
eigenvalues, and `eigenspaceProjector()` returns

\[
P = \sum_k v_k v_k^T,
\]

which is invariant under a change of basis inside the cluster. Comparisons,
cache keys, and symmetry tests for degenerate modes should use the projector or
another whole-subspace quantity, not column-by-column eigenvector equality.

## Scope

These are combinatorial modes of an unweighted graph. They are useful as a
topological basis, but they are not automatically mechanical, acoustic, or
electromagnetic resonances. A physical model additionally needs explicit mass,
stiffness, metric weights, material laws, and boundary conditions. Weighted and
normalized Laplacians, sparse partial eigensolvers, and time-evolution systems
can be added later without changing the sparse operator boundary established
here.
