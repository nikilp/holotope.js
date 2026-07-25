# Joints, constraints, and motors

Scalar Jacobian rows and coupled blocks, distance and orientation coordinates, and the stabilizer-classified rotation policies.

## Bilateral R4 point joints

`PointJointSolver4` constrains two world-space anchors to have one shared
velocity. Unlike contact, this is a bilateral constraint: its impulse may point
anywhere in R4. The four coordinates are solved as one block because an
off-centre impulse along one coordinate can change anchor velocity along the
others through the full six-plane inertia operator.

For relative anchor velocity `v = vA - vB`, the solver constructs the symmetric
positive-definite response

\[
K_{ij} = e_i^T(W_A + W_B)e_j,
\]

where `W` includes inverse linear mass and the angular response of
`r ∧ e_j`. One Cholesky solve produces the unconstrained update

\[
\Delta\lambda = K^{-1}(v_{target} - v).
\]

There is no component-wise projection: all four coordinates remain coupled.
`PointJointResult4` exposes `K`, its inverse effective-mass matrix, initial
anchor error and velocity, bounded bias target, warm and accumulated world
impulses, and the final residual.

`PointJoint4` is the persistent pose binding. It stores body-local anchors and
resolves a fresh `PointJointConstraint4` at the current poses; a fixed-world
joint stores its second anchor directly in world R4.

```ts
import { PointJoint4, PointJointSolver4 } from '@holotope/physics';

const pin = new PointJoint4({
  id: 'pin/body-a',
  bodyA,
  localAnchorA: [0, 0.5, 0, 0.25],
  worldAnchorB: [0, 2, 0, 0]
});
const jointSolver = new PointJointSolver4({ iterations: 8 });

world.step(fixedDt, 1, (substepDt) => {
  jointSolver.solve([pin.constraint()], substepDt);
});
```

The low-level constraint also accepts a prescribed `RigidMotion4` or `null` at
either side when the caller supplies current world anchors. At least one side
must be dynamic. Persistent IDs warm-start the full R4 impulse and retire
immediately when absent or when participant identity changes.

Equal and opposite impulses at a coincident anchor conserve total linear and
angular momentum. If numerical drift separates the two anchors, Baumgarte bias
deliberately trades exact angular-momentum conservation for bounded positional
repair, just as separated penetration witnesses do in contact. Set
`baumgarte: 0` when a momentum-only velocity solve is required.

## Scalar rigid-Jacobian rows with force bounds

`ConstraintRow4` is the reusable scalar primitive beneath distance equalities,
unilateral distance bounds, and distance motors. A row stores one R4 rigid
Jacobian per participant: four coefficients act on linear velocity and six
bivector coefficients act on angular velocity. Its generalized coordinate
speed is

\[
v_c = J_A v_A + J_B v_B,
\qquad
k = J M^{-1}J^T,
\qquad
m_{eff}=k^{-1}.
\]

`ConstraintRowSolver4` performs projected Gauss--Seidel updates. Authored
`minForce` and `maxForce` are generalized-force bounds, so a step of duration
`Δt` converts them to impulse bounds before projection:

\[
\lambda_{min}=f_{min}\Delta t,
\qquad
\lambda_{max}=f_{max}\Delta t,
\]

\[
\lambda' =
\Pi_{[\lambda_{min},\lambda_{max}]}
\left(\lambda + m_{eff}(v_{target}-v_c)\right),
\qquad
\Delta\lambda=\lambda'-\lambda.
\]

Omitting the bounds gives the unrestricted equality row. Setting one bound to
zero produces a unilateral row; finite bounds produce force-limited behavior
that remains consistent when the fixed timestep changes. A signed
`positionError` contributes bounded Baumgarte bias to the authored
`velocityTarget`. Its sign follows the Jacobian orientation: positive error is
reduced by negative coordinate speed.

The solver exposes both `residualSpeed` and `projectedResidualSpeed`. The raw
equality residual may correctly remain nonzero when a force bound is active.
The projected residual instead tests the bounded-row optimality condition:

\[
r_p = \frac{
\lambda-\Pi_{[\lambda_{min},\lambda_{max}]}
(\lambda+m_{eff}(v_{target}-v_c))
}{m_{eff}}.
\]

This sign matches `residualSpeed = v_c - v_target`; `r_p = 0` means the row is
solved even at saturation. `impulseState` reports whether the impulse is
unbounded, within bounds, at either bound, or fixed. Warm starts retain scalar
impulse, timestep, participant identities, and the previous Jacobian. The old
generalized impulse is timestep-scaled, projected onto the current row, and
clamped before application, so coherent direction changes and exact row-sign
reversal remain safe.

Low-level row values inherit the coordinate scale chosen by `J`. In
particular, generalized force, impulse, position error, and coordinate speed
need not share units across unlike rows. The solve aggregates
`sumAbsoluteCoordinateImpulse`, `maxResidualSpeed`,
`maxProjectedResidualSpeed`, and `maxAbsoluteCoordinateError` are convergence
and debugging diagnostics; they are not physical totals that may be summed or
compared without a shared coordinate convention.

`pointConstraintRow4()` constructs the exact linear and lever-arm bivector
coefficients for a world-space point direction. Purely angular coordinates may
instead provide their six-plane Jacobian directly.

## Distance coordinates in N dimensions and R4

The geometric part of a distance constraint is dimension-independent. For
anchors `a` and `b` and positive rest length `ℓ`,

\[
C = \|a-b\|-\ell,
\qquad
n = \frac{a-b}{\|a-b\|},
\qquad
\dot C = n\cdot(v_A-v_B).
\]

`evaluateDistanceCoordinateN()` returns `a-b`, `n`, and the current distance
for any `VecN` dimension. `evaluateDistanceConstraintN()` additionally returns
the signed equality error. Coincident anchors have no unique distance gradient,
so that case requires an explicit nonzero `directionHint`; the API never
substitutes an arbitrary coordinate axis.

`DistanceCoordinate4` binds that geometry to two body-local anchors, or to one
body-local anchor and a fixed world point. It retains the most recent coherent
direction for subsequent coincident evaluations. Equality, interval, and motor
policies share this binding instead of independently redefining R4 lever arms.

### Rigid distance equality

`DistanceJoint4` binds that geometry to R4 rigid bodies. It stores local
anchors, captures the construction distance when `restLength` is omitted, and
returns a `DistanceJointConstraint4` consumable by the general row solver:

```ts
import {
  ConstraintRowSolver4,
  DistanceJoint4
} from '@holotope/physics';

const rod = new DistanceJoint4({
  id: 'rod/a-b',
  bodyA,
  localAnchorA: [0.4, 0, 0, 0.2],
  bodyB,
  localAnchorB: [-0.3, 0.1, 0, 0],
  restLength: 1.5
});
const rows = new ConstraintRowSolver4({ iterations: 8 });

world.step(fixedDt, 1, (substepDt) => {
  rows.solve([rod.constraint()], substepDt);
});
```

The point impulses are `λn` and `-λn`. Because `n` is parallel to the anchor
separation, their net torque is `(a-b)∧(λn)=0`; a body-to-body distance solve
therefore conserves total linear momentum and all six components of total
angular momentum even when its anchors are separated. Baumgarte stabilization
changes kinetic energy but not that internal-force momentum identity. A zero
rest length instead belongs to `PointJoint4`, whose four-coordinate gradient
remains defined at coincidence.

### Distance interval

`DistanceIntervalJoint4` constrains the same scalar coordinate to a closed
interval

\[
\ell_{min} \le \|a-b\| \le \ell_{max},
\qquad 0\le\ell_{min}<\ell_{max}.
\]

`constraints(dt)` always returns two unilateral guardian rows with stable
`:minimum` and `:maximum` ID suffixes. At the minimum, `minForce: 0` permits
only a positive radial impulse, so the row may push the anchors apart but
cannot pull them together. At the maximum, `maxForce: 0` permits only a
negative radial impulse, so the row may pull inward but cannot push outward.

While the coordinate lies inside the interval, their targets are

\[
v_{min}=\frac{\ell_{min}-\ell}{\Delta t},
\qquad
v_{max}=\frac{\ell_{max}-\ell}{\Delta t}.
\]

Together they enforce the first-order safe-speed corridor

\[
v_{min}\le\dot\ell\le v_{max},
\]

so constant substep velocity cannot cross either boundary. Outside the
interval, the violated row instead carries signed position error and zero
authored speed; the solver's bounded Baumgarte term supplies recovery bias.
The opposite guardian remains present.

Keeping both rows in every solve is stronger than selecting a row from the
velocity observed before solving. A motor, contact, or another joint may create
unsafe radial speed during projected Gauss--Seidel iteration. A guardian row
that is already in the row set sees that updated velocity and projects it back
into the corridor. When row order is authored directly, place producers such
as the distance motor before the two guardians so the final guardians observe
their update.

`interval(dt)` is diagnostic only. It reports the current or first-order
destination bound as `minimum` or `maximum`, and otherwise reports `inactive`,
including correct destination selection for full-span crossings. It does not
return a solver row and must not be used to select the row set;
`constraints(dt)` is the sole solver input.

At exact coincidence, `\|a-b\|` has no single scalar gradient. Guardian rows
therefore require an authored `directionHint` and accept only the chosen
positive branch: relative motion must be longitudinal and non-negative along
that direction. Transverse or negative-branch motion is refused rather than
being assigned an incorrect scalar derivative. The diagnostic `interval(dt)`
can still use `\|v_A-v_B\|` to report one-sided distance growth, but that
observation does not manufacture a valid solve branch. A positive minimum also
requires the hint at construction so recovery has an explicit direction.

### Force-limited distance motor

`DistanceMotor4` prescribes radial coordinate speed with symmetric generalized
force bounds. Positive `targetSpeed` lengthens the anchor distance, negative
speed shortens it, and `maxForce` produces

\[
-f_{max}\le f\le f_{max}.
\]

Both policy values are mutable between solves. Because the motor and interval
are independent rows on the same coordinate, the motor composes with both
guardian rows in the same solver:

```ts
import {
  ConstraintRowSolver4,
  DistanceIntervalJoint4,
  DistanceMotor4
} from '@holotope/physics';

const interval = new DistanceIntervalJoint4({
  id: 'link/a-b',
  bodyA,
  localAnchorA: [0.4, 0, 0, 0.2],
  bodyB,
  localAnchorB: [-0.3, 0.1, 0, 0],
  minLength: 1,
  maxLength: 2
});
const motor = new DistanceMotor4({
  id: 'drive/a-b',
  bodyA,
  localAnchorA: [0.4, 0, 0, 0.2],
  bodyB,
  localAnchorB: [-0.3, 0.1, 0, 0],
  targetSpeed: 0.5,
  maxForce: 20
});
const rows = new ConstraintRowSolver4({ iterations: 8 });

world.step(fixedDt, 1, (substepDt) => {
  const guardians = interval.constraints(substepDt);
  rows.solve(
    [motor.constraint(), ...guardians],
    substepDt
  );
});
```

The motor is deliberately ordered before the guardians: each guardian then
sees any radial speed the motor introduced, including when the pre-solve
diagnostic state was inactive.

A motor at coincidence also requires `directionHint`, because “positive
lengthening” otherwise has no unique world direction. A body-to-body motor may
inject or remove kinetic energy, but its equal and opposite radial impulses
retain the same total linear- and angular-momentum identity as a distance
equality. A fixed-world endpoint is an external constraint and does not carry
that closed-system guarantee.

## SO(4) orientation coordinates

`Rotor4` represents an SO(4) orientation by two unit quaternions with the
shared double-cover identification `(qL, qR) ~ (-qL, -qR)`. A relative
orientation therefore cannot choose the sign of each factor independently.
`relativeOrientationCoordinates4()` compares the two valid pair lifts, returns
the selected pair sign as a branch token, and accepts that token on the next
coherent evaluation. The scalar guard `|qL.w + qR.w|` vanishes on the complete
pair-geodesic cut locus. At that locus the function returns
`status: 'cut-locus'` and no bivector error.

```ts
import {
  orientationDlog4,
  relativeOrientationCoordinates4
} from '@holotope/physics';

const coordinate = relativeOrientationCoordinates4(current, target, {
  trivialization: 'world-left',
  previousBranch
});

if (coordinate.status === 'regular') {
  const jacobian = orientationDlog4(coordinate.error, 'world-left');
  previousBranch = coordinate.branch;
  // A joint policy may now map authored coordinates through `jacobian`.
} else {
  // Retain a prior chart or choose an authored branch.
}
```

The lexicographic bivector chart `(01,02,03,12,13,23)` is related to the two
quaternion-log vectors by `splitBivectorPair4()` and
`combineBivectorPair4()`. In this convention the factor Lie bracket is twice
the ordinary cross product. `orientationDexp4()` and `orientationDlog4()` use
that scale exactly; world-left and body-right trivializations exchange the
factor signs because `Rotor4` composes its right quaternion in reverse order.
`angularVelocityOperatorNorm4()` returns the tight norm of the dense 4x4 skew
map, `|u| + |v|`, without constructing that matrix.

These functions deliberately stop at local geometry. They do not decide what
an authored rotational joint preserves, how limits cross a branch, or how a
motor should spend force. Those remain explicit policies over this common
coordinate and the existing rigid-Jacobian solver.

## Coupled equality and one-bounded blocks

`ConstraintBlockSolver4` couples one to six `ConstraintRow4` values through
the exact small dense response

\[
K_{ij}=J_i M^{-1}J_j^T.
\]

The auditable Float64 path uses the shared deterministic symmetric eigensolver.
Its relative threshold is measured against `trace(K) / k`; the default
`rankPolicy: 'reject'` refuses a lost coordinate, while the explicitly authored
`minimum-norm` policy uses the spectral pseudoinverse and reports the effective
rank. Bias slop and speed bounds apply to the norm of the complete coordinate
vector, not to its components. Warm starts project the preceding generalized
impulse into the current row basis through the cross-response, so an orthogonal
basis change does not change the world impulse.

The default `projection` is `equality` and continues to refuse finite force
bounds. The additive `one-bounded` projection requires exactly one bounded row
and a full-rank response. If `E` denotes the equality rows and `b` the bounded
row, the solver forms the scalar Schur response

\[
S=K_{bb}-K_{bE}K_{EE}^{-1}K_{Eb}.
\]

It solves and clamps the accumulated `b` impulse, then re-solves

\[
\Delta\lambda_E=K_{EE}^{-1}
  (r_E-K_{Eb}\Delta\lambda_b).
\]

This is the complete active-set solution for one bounded coordinate, not a
componentwise approximation. Equality residuals therefore remain zero even
at torque saturation. The block result reports both the raw speed residual
and the reduced projected KKT residual; only the latter is expected to vanish
when a bound is active. Warm transport applies the same projection and
equality re-solve after timestep scaling.

The four-coordinate `PointJointSolver4` now delegates to this kernel without
changing its public result. This migration is differential evidence that the
block abstraction is shared behavior rather than a speculative solver layer.

## Direction preservation and its SO(3) stabilizer

`DirectionJoint4` preserves one oriented material direction. In R4 the
rotations fixing a vector form SO(3), so this policy constrains exactly three
rotational coordinates and leaves three free. It is not named a hinge: its
free subgroup is non-abelian and does not admit one global joint angle.

For current unit world directions `a` and `b`, the regular reference direction
is their normalized bisector `m = (a+b)/|a+b|`. The difference `a-b` lies in
the three-dimensional tangent space `m^perp`. A transported orthonormal basis
`t_i` gives the residual and angular rows

\[
C_i=t_i\cdot(a-b),\qquad
J_{A,i}=a\wedge t_i,\qquad
J_{B,i}=-(b\wedge t_i).
\]

At `a=-b`, the bisector and correction direction are not unique.
`constraint()` therefore returns `status: 'antipodal'` and no solver block.
This is a quotient-space singularity distinct from the full SO(4) logarithm
cut locus: a free SO(3) twist may reach the latter while both material
directions still agree perfectly. The joint consequently uses its defining
direction geometry rather than falsely constraining the free twist through a
full-frame logarithm.

```ts
import {
  ConstraintBlockSolver4,
  DirectionJoint4
} from '@holotope/physics';

const direction = new DirectionJoint4({
  id: 'body/up',
  bodyA,
  localDirectionA: [0, 1, 0, 0],
  worldDirectionB: [0, 1, 0, 0]
});
const blocks = new ConstraintBlockSolver4({ iterations: 8 });

world.step(fixedDt, 1, (dt) => {
  const evaluation = direction.constraint();
  if (evaluation.status === 'regular') {
    blocks.solve([evaluation.block], dt);
  }
});
```

## Fixed-relative-frame orientation

`OrientationJoint4` preserves a complete oriented material frame. Its
stabilizer is the identity, so it contributes all six rotational equality
rows. It is intentionally not called a universal weld: composing it with the
four translational rows of `PointJoint4` gives the complete R4 weld.

For current material frames `A` and `B`, the coordinate is expressed in frame
B:

\[
E=B^{-1}A,\qquad e=\log(E).
\]

If `omega_A` and `omega_B` are world-left angular velocities and
`Ad_(B^-1)` rotates a world bivector into frame B, its exact rate is

\[
\dot e=D\log_{\mathrm{left}}(e)\,
       \operatorname{Ad}_{B^{-1}}(\omega_A-\omega_B).
\]

The two participant Jacobians are therefore exact negatives. The coordinate
does not change under a common world-left rotation, and every internal row
impulse adds equal-and-opposite world bivector momentum. At the full SO(4) cut
locus the logarithm is non-unique, so `constraint()` returns `cut-locus`
without a block. Its pair-level branch token otherwise persists from one
evaluation to the next and can be deliberately cleared with `resetBranch()`.

```ts
const orientation = new OrientationJoint4({
  id: 'body/frame',
  bodyA,
  localFrameA,
  bodyB,
  localFrameB
});
const blocks = new ConstraintBlockSolver4({ iterations: 8 });

world.step(fixedDt, 1, (dt) => {
  const evaluation = orientation.constraint();
  if (evaluation.status === 'regular') {
    blocks.solve([evaluation.block], dt);
  }
});
```

## Planar rotation and its SO(2) stabilizer

`PlanarRotationJoint4` preserves an ordered orthonormal two-frame. The
stabilizer of that datum in SO(4) is rotation in the complementary two-plane,
so exactly one rotational degree of freedom remains and five are constrained.
This is the closest analogue of a revolute joint, but the API names its actual
geometry rather than calling several inequivalent R4 mechanisms “hinges.”

Let `(a0,a1)` and `(b0,b1)` be the current world frames. The first normalized
bisector `m0` supplies three direction rows in `m0^perp`. Projecting `a1+b1`
into that space and normalizing gives `m1`; two transported vectors spanning
`span(m0,m1)^perp` supply the remaining rows. On the constraint manifold their
bivector span contains every plane except the complementary generator
`p0 wedge p1`, which is exactly the free SO(2).

The two-frame input is validated and never silently orthonormalized. A first
axis antipode returns `status: 'first-antipodal'`; a vanished projected second
bisector returns `status: 'second-degenerate'`. Neither chart failure invents
a correction plane. The coordinate frames are transported across calls, and
the equality-block solver re-expresses warm impulses when those bases move.

```ts
import {
  ConstraintBlockSolver4,
  PlanarRotationJoint4
} from '@holotope/physics';

const rotation = new PlanarRotationJoint4({
  id: 'body/planar-rotation',
  bodyA,
  // This ordered frame is fixed; its orthogonal plane is free to rotate.
  localFixedFrameA: [[1, 0, 0, 0], [0, 1, 0, 0]],
  worldFixedFrameB: [[1, 0, 0, 0], [0, 1, 0, 0]]
});
const blocks = new ConstraintBlockSolver4({ iterations: 8 });

world.step(fixedDt, 1, (dt) => {
  const evaluation = rotation.constraint();
  if (evaluation.status === 'regular') {
    blocks.solve([evaluation.block], dt);
  }
});
```

The free phase is abelian and therefore can support a globally unwrapped
scalar coordinate. `PlanarRotationCoordinate4` supplies that coordinate by
attaching one unit phase-reference direction to each side. The ordered fixed
frame orients its complement through the canonical orientation of R4:

\[
\det[m_0\ m_1\ p_0\ p_1] > 0,
\qquad F=p_0\wedge p_1.
\]

After projecting both phase references into the common complementary plane,
their signed relative angle is evaluated with `atan2`. Its instantaneous rate
is

\[
\dot\theta=F\cdot\omega_A-F\cdot\omega_B.
\]

The returned branch token retains wrapped and unwrapped angles. Successive
samples choose the unique increment in `(-pi,pi)`. An exact half-turn has two
equally short lifts, so it returns `status: 'unwrap-ambiguous'` until the caller
provides `halfTurnDirection: 1 | -1`. As with every sampled unwrap, advances of
one or more unobserved turns cannot be reconstructed; the phase change between
observations must stay below `pi`.

```ts
import { PlanarRotationCoordinate4 } from '@holotope/physics';

const phase = new PlanarRotationCoordinate4({
  joint: rotation,
  localPhaseDirectionA: [0, 0, 1, 0],
  worldPhaseDirectionB: [0, 0, 1, 0]
});

const sample = phase.evaluation();
if (sample.status === 'regular') {
  console.log(sample.angle, sample.angularSpeed);
}
```

`PlanarRotationMotor4` and `PlanarRotationIntervalJoint4` are the first policy
consumers of that bounded block. A motor combines the five frame equalities
with the phase row and symmetric torque bounds. An interval retains two stable
guardian blocks over the continuous angle: its minimum row admits only
non-negative torque and its maximum row only non-positive torque. Inside the
interval their targets encode the first-order safe-speed corridor

\[
\frac{\theta_{min}-\theta}{\Delta t}
\leq \dot\theta \leq
\frac{\theta_{max}-\theta}{\Delta t}.
\]

Outside it, signed position error supplies bounded Baumgarte repair. When a
motor and interval are composed, solve the motor block before both guardians;
the guardians then observe speed introduced during the same projected pass.

```ts
import {
  ConstraintBlockSolver4,
  PlanarRotationCoordinate4,
  PlanarRotationIntervalJoint4,
  PlanarRotationMotor4
} from '@holotope/physics';

const phase = new PlanarRotationCoordinate4({
  joint: rotation,
  localPhaseDirectionA: [0, 0, 1, 0],
  worldPhaseDirectionB: [0, 0, 1, 0]
});
const motor = new PlanarRotationMotor4({
  coordinate: phase,
  targetSpeed: 1.2,
  maxTorque: 8
});
const interval = new PlanarRotationIntervalJoint4({
  coordinate: phase,
  minAngle: -Math.PI / 3,
  maxAngle: Math.PI / 3
});

world.step(fixedDt, 1, (dt) => {
  const drive = motor.constraint();
  const limits = interval.constraints(dt);
  if (drive.status === 'regular' && limits.status === 'regular') {
    blocks.solve([
      drive.block,
      ...limits.constraints.map((entry) => entry.block)
    ], dt);
  }
});
```
