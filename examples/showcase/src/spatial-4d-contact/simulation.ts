import { BivectorN, TransformN, VecN, wedgeVectors } from '@holotope/core';
import {
  ContactPipeline4,
  GlomeCollider4,
  HyperboxCollider4,
  PhysicsWorld4,
  RigidBody4,
  glomeHyperboxContact4,
  massPropertiesOfGlome4,
  massPropertiesOfHyperbox4,
  type ContactPipelinePair4,
  type ContactPipelineResult4,
  type ContactSolver4Options
} from '@holotope/physics';

/**
 * Two dynamic bodies in spatial R4, exchanging momentum through the released
 * rigid-body pipeline, and nothing else.
 *
 * ## Who computes what
 *
 * Bodies, mass and inertia: `RigidBody4.fromMassProperties` over
 * `massPropertiesOfHyperbox4` / `massPropertiesOfGlome4`. Integration and
 * Spin(4) orientation: `PhysicsWorld4.step` (Lie-midpoint pose plans).
 * Contact: `ContactPipeline4` dispatching the exact glome–hyperbox query and
 * feeding its point patch to `ContactSolver4`, whose sequential impulses carry
 * restitution. This module builds the scene, steps it, and reads results back.
 * It contains no collision test, no impulse formula, no effective mass and no
 * rotational integrator; the independent versions of those live in the tests.
 *
 * ## What moves and why
 *
 * Every preset is one launch: the ball's initial velocity, set once at reset.
 * After that, motion comes from integration and contact only — no animation
 * path, no velocity reassignment, no fixed body. The box is as dynamic as the
 * ball; in the central preset it takes two thirds of the ball's speed along w.
 *
 * ## The world
 *
 * Weightless (`gravity: [0, 0, 0, 0]`), frictionless (both materials at 0),
 * restitution 1 on both colliders so the independent predictions are the
 * elastic fractions. The solver runs with position correction OFF
 * (`baumgarte: 0`), restitution never suppressed (`restitutionThreshold: 0`)
 * and no warm start, so one contact solves exactly and each substep stands
 * alone. Settings are recorded on the instance and can be tightened by tests.
 */

export const BOX = {
  id: 'box',
  name: 'Box',
  colour: '#4c7ff0',
  /** Half-extents along x, y, z, w — deliberately all different. */
  halfExtents: [1.2, 0.9, 0.7, 1.0] as const,
  mass: 2
} as const;

export const BALL = {
  id: 'ball',
  name: 'Ball',
  colour: '#e0883a',
  radius: 0.5,
  mass: 1
} as const;

export const RESTITUTION = 1;
export const FRICTION = 0;

export type PresetId = 'central' | 'off-centre';

export interface Preset {
  readonly id: PresetId;
  readonly name: string;
  readonly summary: string;
  /** The ball at launch; the box always starts at the origin, at rest, unrotated. */
  readonly ballStart: readonly [number, number, number, number];
  readonly ballVelocity: readonly [number, number, number, number];
}

/**
 * A. The ball comes straight down the w axis onto the centre of the box's +w
 * face. Contact normal along w, lever through the box's centre: no spin, and
 * the one-dimensional elastic fractions apply — with masses 1 and 2 the ball
 * returns at a third of its speed and the box leaves at two thirds.
 *
 * B. The same approach displaced 0.8 in x. The impulse still acts along w, but
 * now 0.8 off the box's centre in x, so the box takes angular momentum in the
 * x–w plane — a plane containing the hidden direction — and its cut changes
 * shape as it turns. Nothing scripted: the same pipeline, a different lever.
 */
export const PRESETS: readonly Preset[] = [
  {
    id: 'central',
    name: 'A. Central impact along w',
    summary: 'The ball drops along w onto the middle of the box’s +w face. Masses 1 and 2, restitution 1.',
    ballStart: [0, 0, 0, 2.7],
    ballVelocity: [0, 0, 0, -2]
  },
  {
    id: 'off-centre',
    name: 'B. Off-centre impact',
    summary: 'The same drop, 0.8 to the side in x. The blow lands off the box’s centre and sets it turning in the x–w plane.',
    ballStart: [0.8, 0, 0, 2.7],
    ballVelocity: [0, 0, 0, -2]
  }
];

export interface SimulationSettings {
  /** Fixed step, seconds. */
  readonly dt: number;
  readonly substeps: number;
  readonly solver: ContactSolver4Options;
}

export const DEFAULT_SETTINGS: SimulationSettings = {
  dt: 1 / 120,
  substeps: 2,
  solver: { iterations: 16, restitutionThreshold: 0, baumgarte: 0, warmStart: false }
};

export type ContactState =
  | 'none'
  | 'separated'
  | 'touching'
  | 'overlapping'
  | 'ambiguous-interior'
  | 'unsupported';

/** What the pipeline said about the pair at the end of a step, and what the solver did during it. */
export interface ContactReport {
  readonly state: ContactState;
  /** Signed distance ball surface to box surface; positive when apart. Null when the pipeline gave none. */
  readonly gap: number | null;
  /** Unit normal from the box toward the ball, when the query produced one. */
  readonly normal: readonly number[] | null;
  /** The contact point on the ball and on the box, world coordinates, when in contact. */
  readonly pointOnBall: readonly number[] | null;
  readonly pointOnBox: readonly number[] | null;
  readonly penetrationDepth: number;
  /** Whether the solver applied an impulse in any substep of the step. */
  readonly responded: boolean;
  /** Total normal impulse applied during the step (sum over substeps). */
  readonly impulse: number;
  /** Relative normal speeds the solver saw at the first responding substep. */
  readonly initialNormalSpeed: number | null;
  readonly finalNormalSpeed: number | null;
}

export interface BodyState {
  readonly id: string;
  readonly position: readonly number[];
  readonly velocity: readonly number[];
  /** World angular momentum, bivector coefficients [xy, xz, xw, yz, yw, zw]. */
  readonly angularMomentum: readonly number[];
  readonly angularVelocity: readonly number[];
  readonly kineticEnergy: number;
}

export interface StepRecord {
  readonly step: number;
  readonly time: number;
  readonly contact: ContactReport;
}

const NONE: ContactReport = {
  state: 'none', gap: null, normal: null, pointOnBall: null, pointOnBox: null,
  penetrationDepth: 0, responded: false, impulse: 0, initialNormalSpeed: null, finalNormalSpeed: null
};

/**
 * The first step (counted from 1) in which the solver applies an impulse,
 * found by stepping a fresh simulation — a replay, not a prediction. Null if
 * none within `maxSteps`. The page's "first touch" landmark is this minus one.
 */
export function impactStepOf(preset: Preset, settings: SimulationSettings = DEFAULT_SETTINGS, maxSteps = 1200): number | null {
  const sim = new ContactSimulation(preset, settings);
  for (let k = 1; k <= maxSteps; k++) {
    if (sim.step().contact.responded) return k;
  }
  return null;
}

/** Mass properties at a stated mass: the library's uniform-solid geometry, scaled to the authored mass. */
function boxProperties() {
  const unit = massPropertiesOfHyperbox4(BOX.halfExtents);
  return massPropertiesOfHyperbox4(BOX.halfExtents, { density: BOX.mass / unit.volume });
}
function ballProperties() {
  const unit = massPropertiesOfGlome4(BALL.radius);
  return massPropertiesOfGlome4(BALL.radius, { density: BALL.mass / unit.volume });
}

export class ContactSimulation {
  readonly preset: Preset;
  readonly settings: SimulationSettings;
  readonly world: PhysicsWorld4;
  readonly pipeline: ContactPipeline4;
  readonly box: RigidBody4;
  readonly ball: RigidBody4;
  readonly boxCollider: HyperboxCollider4;
  readonly ballCollider: GlomeCollider4;
  private stepCount = 0;
  private clock = 0;
  private last: ContactReport = NONE;
  private impactSteps = 0;
  /** The most recent step report in which the solver applied an impulse; null before the first. */
  lastImpact: ContactReport | null = null;

  constructor(preset: Preset, settings: SimulationSettings = DEFAULT_SETTINGS) {
    this.preset = preset;
    this.settings = settings;
    const box = boxProperties();
    this.box = RigidBody4.fromMassProperties(box, { position: [0, 0, 0, 0] });
    this.ball = RigidBody4.fromMassProperties(ballProperties(), {
      position: [...preset.ballStart],
      linearVelocity: [...preset.ballVelocity]
    });
    this.world = new PhysicsWorld4({ gravity: [0, 0, 0, 0] }).addBody(this.box).addBody(this.ball);
    const material = { friction: FRICTION, restitution: RESTITUTION };
    // The body's frame is its PRINCIPAL frame — the library orders a box's
    // principal axes by ascending second moment, so for this box the body axes
    // are a permutation of x, y, z, w — and `fromMassProperties` adopts that
    // rotor as the body's rotation. A collider hung on the body with the
    // identity local pose would therefore be a permuted box in world (found
    // while gating: axis 0 landed on world z). The authored box is recovered by
    // giving the collider the inverse principal rotor as its local pose, so its
    // world pose is the body's dynamic rotation alone; `axisAlignedAtLaunch()`
    // is what the tests hold.
    this.boxCollider = new HyperboxCollider4({
      id: BOX.id,
      halfExtents: [...BOX.halfExtents],
      participant: this.box,
      localTransform: new TransformN(4, box.principalRotor.conjugate(), VecN.zero(4)),
      material
    });
    this.ballCollider = new GlomeCollider4({
      id: BALL.id, radius: BALL.radius, participant: this.ball, material
    });
    this.pipeline = new ContactPipeline4({ solverOptions: { ...settings.solver } })
      .addCollider(this.boxCollider)
      .addCollider(this.ballCollider);
  }

  get time(): number { return this.clock; }
  get steps(): number { return this.stepCount; }
  get contact(): ContactReport { return this.last; }
  /** Steps in which the solver applied an impulse. */
  get impacts(): number { return this.impactSteps; }

  /** One fixed step: integration and contact through the released pipeline; nothing else. */
  step(): StepRecord {
    const { dt, substeps } = this.settings;
    const result = this.pipeline.stepWorld(this.world, dt, substeps);
    this.stepCount++;
    this.clock += dt;
    this.last = reportFromSubsteps(result.substeps, result.final);
    if (this.last.responded) {
      this.impactSteps++;
      this.lastImpact = this.last;
    }
    return { step: this.stepCount, time: this.clock, contact: this.last };
  }

  /**
   * Deterministic replay: a fresh simulation of the preset stepped `steps`
   * times from launch. This is how the page jumps in time and steps backwards
   * — never by posing a body or reassigning a velocity.
   */
  static atStep(preset: Preset, steps: number, settings: SimulationSettings = DEFAULT_SETTINGS): ContactSimulation {
    if (!Number.isSafeInteger(steps) || steps < 0) {
      throw new Error(`ContactSimulation.atStep: steps must be a non-negative integer, got ${steps}`);
    }
    const sim = new ContactSimulation(preset, settings);
    for (let k = 0; k < steps; k++) sim.step();
    return sim;
  }

  /**
   * The pair's geometric relation at the current poses, from the library's
   * exact query and nothing else: status, signed gap, normal and witness
   * points. A query, not a step — no impulse, no motion. It answers at any
   * distance, where the pipeline's broadphase would already have dropped the
   * pair, which is what the page needs to say "apart by 0.2 along w".
   */
  query(): ContactReport {
    this.pipeline.sync();
    const q = glomeHyperboxContact4(this.ballCollider.shape, this.boxCollider.shape);
    // Ordered A = ball here, so the query's normal already points box → ball.
    return {
      state: q.status,
      gap: q.signedDistance,
      normal: q.normal ? Array.from(q.normal.data) : null,
      pointOnBall: q.pointA ? Array.from(q.pointA.data) : null,
      pointOnBox: q.pointB ? Array.from(q.pointB.data) : null,
      penetrationDepth: q.penetrationDepth,
      responded: false,
      impulse: 0,
      initialNormalSpeed: null,
      finalNormalSpeed: null
    };
  }

  /** World pose of the authored box geometry — the collider's synced transform, one source for every view. */
  boxPose(): TransformN {
    this.boxCollider.sync();
    return this.boxCollider.shape.transform;
  }

  /** True when the box collider's world axes are the coordinate axes, as authored, at launch. */
  axisAlignedAtLaunch(tolerance = 1e-12): boolean {
    return this.boxCollider.shape.worldAxes().every((axis, i) =>
      Array.from(axis.data).every((v, j) => Math.abs(v - (i === j ? 1 : 0)) <= tolerance));
  }

  state(id: 'box' | 'ball'): BodyState {
    const body = id === 'box' ? this.box : this.ball;
    return {
      id,
      position: Array.from(body.position.data),
      velocity: Array.from(body.linearVelocity.data),
      angularMomentum: Array.from(body.angularMomentumWorld.coeffs),
      angularVelocity: Array.from(body.angularVelocityWorld().coeffs),
      kineticEnergy: body.kineticEnergy()
    };
  }

  /** Σ m v over both bodies, four components. */
  totalMomentum(): number[] {
    const out = [0, 0, 0, 0];
    for (const body of [this.box, this.ball]) {
      for (let axis = 0; axis < 4; axis++) out[axis]! += body.mass * body.linearVelocity.data[axis]!;
    }
    return out;
  }

  /**
   * Σ (r ∧ m v) + L_spin over both bodies about the origin, six components
   * [xy, xz, xw, yz, yw, zw]. The orbital wedge is the library's; the spin is
   * each body's authoritative world momentum.
   */
  totalAngularMomentum(): number[] {
    const out = new BivectorN(4);
    for (const body of [this.box, this.ball]) {
      const orbital = wedgeVectors(body.position.clone(), body.linearVelocity.clone().multiplyScalar(body.mass));
      for (let k = 0; k < 6; k++) {
        out.coeffs[k]! += orbital.coeffs[k]! + body.angularMomentumWorld.coeffs[k]!;
      }
    }
    return Array.from(out.coeffs);
  }

  kineticEnergy(): number {
    return this.box.kineticEnergy() + this.ball.kineticEnergy();
  }
}

/**
 * Reads one step's pipeline results into a report. The geometry is taken from
 * the FIRST substep in which the solver applied an impulse — that is where the
 * contact was — and otherwise from the final substep; after a bounce the pair
 * separates within the same step and the broadphase may already have dropped
 * it, which is why the final result alone lost the contact normal (found
 * while gating). The ball is ordered A and the box B, by collider id.
 */
export function reportFromSubsteps(substeps: readonly ContactPipelineResult4[], final: ContactPipelineResult4): ContactReport {
  let responded = false;
  let impulse = 0;
  let initialNormalSpeed: number | null = null;
  let finalNormalSpeed: number | null = null;
  let source: ContactPipelineResult4 = final;
  for (const result of substeps) {
    for (const point of result.response.points) {
      if (point.accumulatedImpulse > 0) {
        if (!responded) {
          source = result;
          initialNormalSpeed = point.initialNormalSpeed;
          finalNormalSpeed = point.finalNormalSpeed;
        }
        responded = true;
        impulse += point.accumulatedImpulse;
      }
    }
  }
  const pair: ContactPipelinePair4 | undefined = source.pairs[0];
  if (!pair) return { ...NONE, responded, impulse, initialNormalSpeed, finalNormalSpeed };
  const ballIsA = pair.colliderA.id === BALL.id;
  const narrowphase = pair.narrowphase as { kind: string; distance?: number; query?: unknown; algorithm?: string };
  if (narrowphase.kind === 'unsupported') {
    return { ...NONE, state: 'unsupported', responded, impulse, initialNormalSpeed, finalNormalSpeed };
  }
  if (narrowphase.kind === 'deep-manifold' && narrowphase.query && typeof narrowphase.query === 'object') {
    const q = narrowphase.query as {
      status: ContactState; signedDistance: number; penetrationDepth: number;
      normal: VecN | null; pointA: VecN | null; pointB: VecN | null;
    };
    // The query's normal points from ordered B toward ordered A; report it box → ball.
    const normal = q.normal ? Array.from(q.normal.data).map((v) => (ballIsA ? v : -v)) : null;
    return {
      state: q.status,
      gap: q.signedDistance,
      normal,
      pointOnBall: (ballIsA ? q.pointA : q.pointB) ? Array.from((ballIsA ? q.pointA : q.pointB)!.data) : null,
      pointOnBox: (ballIsA ? q.pointB : q.pointA) ? Array.from((ballIsA ? q.pointB : q.pointA)!.data) : null,
      penetrationDepth: q.penetrationDepth,
      responded, impulse, initialNormalSpeed, finalNormalSpeed
    };
  }
  // 'distance', 'shallow-contact' or 'penetration': the pair is apart or only measured.
  return {
    ...NONE,
    state: 'separated',
    gap: typeof narrowphase.distance === 'number' ? narrowphase.distance : null,
    responded, impulse, initialNormalSpeed, finalNormalSpeed
  };
}
