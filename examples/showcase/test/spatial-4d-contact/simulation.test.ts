import { describe, expect, it } from 'vitest';
import { BivectorN } from '@holotope/core';
import {
  BALL, BOX, ContactSimulation, DEFAULT_SETTINGS, PRESETS, RESTITUTION,
  type Preset, type SimulationSettings, type StepRecord
} from '../../src/spatial-4d-contact/simulation.js';

/**
 * The physics gate: the released pipeline, driven by the shipped simulation
 * module, against predictions written independently from the authored masses,
 * sizes and velocities. Nothing here reads a formula out of the library; the
 * library's own numbers (velocities, momenta, impulses, contact points) are
 * compared with closed forms computed in this file.
 */

const preset = (id: Preset['id']): Preset => PRESETS.find((p) => p.id === id)!;

function run(p: Preset, seconds: number, settings: SimulationSettings = DEFAULT_SETTINGS) {
  const sim = new ContactSimulation(p, settings);
  const records: StepRecord[] = [];
  while (sim.time < seconds - 1e-12) records.push(sim.step());
  return { sim, records, impacts: records.filter((r) => r.contact.responded) };
}

const dot = (a: readonly number[], b: readonly number[]): number => a.reduce((s, v, i) => s + v * b[i]!, 0);
const m1 = BALL.mass;
const m2 = BOX.mass;
const e = RESTITUTION;
const launchSpeed = 2;

describe('1. both bodies respond', () => {
  it('the box and the ball are dynamic participants, and both change velocity at the impact', () => {
    const { sim, impacts } = run(preset('central'), 1.0);
    expect(sim.boxCollider.participant).toBe(sim.box);
    expect(sim.ballCollider.participant).toBe(sim.ball);
    expect(sim.box.invMass).toBeGreaterThan(0);
    expect(sim.ball.invMass).toBeGreaterThan(0);
    expect(impacts.length, 'the solver applied an impulse').toBeGreaterThan(0);
    expect(sim.state('box').velocity[3], 'the box moved along w').toBeLessThan(-1);
    expect(sim.state('ball').velocity[3], 'the ball came back along w').toBeGreaterThan(0.5);
  });

  it('the authored box is axis-aligned in world at launch, whatever frame the body keeps its inertia in', () => {
    // Found while gating: the library orders principal axes by ascending second
    // moment, so the body's frame is a permutation of x, y, z, w; a collider
    // hung on it with the identity local pose was a permuted box in world.
    const sim = new ContactSimulation(preset('central'));
    expect(sim.axisAlignedAtLaunch()).toBe(true);
    const axes = sim.boxCollider.shape.worldAxes().map((a) => Array.from(a.data).map((v) => Math.round(v * 1e12) / 1e12));
    expect(axes).toEqual([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]);
    expect(Array.from(sim.boxCollider.shape.halfExtents)).toEqual([...BOX.halfExtents]);
    // The query at launch: apart along w by exactly the authored gap.
    const q = sim.query();
    expect(q.state).toBe('separated');
    expect(q.gap).toBeCloseTo(preset('central').ballStart[3] - BALL.radius - BOX.halfExtents[3], 12);
    expect(q.normal![3]).toBeCloseTo(1, 12);
  });

  it('nothing moves before the impact except the launched ball, and nothing is reassigned after it', () => {
    const sim = new ContactSimulation(preset('central'));
    const before = sim.state('box');
    expect(before.velocity).toEqual([0, 0, 0, 0]);
    expect(before.angularMomentum).toEqual([0, 0, 0, 0, 0, 0]);
    // Up to the impact the ball's velocity is exactly its launch velocity: no force acts.
    let rec = sim.step();
    while (!rec.contact.responded) {
      expect(sim.state('ball').velocity).toEqual([...preset('central').ballVelocity]);
      expect(sim.state('box').velocity).toEqual([0, 0, 0, 0]);
      rec = sim.step();
    }
    // After it, velocities are constant again until the run ends: integration only.
    const after = { ball: sim.state('ball').velocity, box: sim.state('box').velocity };
    for (let k = 0; k < 60; k++) sim.step();
    expect(sim.state('ball').velocity).toEqual(after.ball);
    expect(sim.state('box').velocity).toEqual(after.box);
  });
});

describe('2. central impact against the independent prediction', () => {
  // One-dimensional elastic collision along w: ball m1 = 1 at v1 = −2, box m2 = 2 at rest, e = 1.
  //   v1' = ((m1 − e m2) v1 + (1 + e) m2 v2) / (m1 + m2) = +2/3
  //   v2' = ((1 + e) m1 v1 + (m2 − e m1) v2) / (m1 + m2) = −4/3
  const v1 = -launchSpeed;
  const ballAfter = ((m1 - e * m2) * v1) / (m1 + m2);
  const boxAfter = ((1 + e) * m1 * v1) / (m1 + m2);

  it('velocities, all four momentum components, restitution, and no spin on either body', () => {
    const { sim, impacts } = run(preset('central'), 1.0);
    expect(impacts, 'one responding step').toHaveLength(1);
    const ball = sim.state('ball');
    const box = sim.state('box');
    expect(ball.velocity[3]).toBeCloseTo(ballAfter, 9);
    expect(box.velocity[3]).toBeCloseTo(boxAfter, 9);
    for (const axis of [0, 1, 2]) {
      expect(Math.abs(ball.velocity[axis]!), `ball axis ${axis}`).toBeLessThan(1e-12);
      expect(Math.abs(box.velocity[axis]!), `box axis ${axis}`).toBeLessThan(1e-12);
    }
    const momentum = sim.totalMomentum();
    const expected = [0, 0, 0, m1 * v1];
    for (let axis = 0; axis < 4; axis++) expect(momentum[axis], `momentum ${axis}`).toBeCloseTo(expected[axis]!, 12);
    // Restitution between the centres (central: the contact point moves with the centres along the normal).
    const closingBefore = -v1;
    const separatingAfter = ball.velocity[3]! - box.velocity[3]!;
    expect(separatingAfter / closingBefore).toBeCloseTo(e, 9);
    for (const c of box.angularMomentum) expect(Math.abs(c)).toBeLessThan(1e-12);
    for (const c of ball.angularMomentum) expect(Math.abs(c)).toBeLessThan(1e-12);
    // Kinetic energy is conserved at e = 1.
    expect(sim.kineticEnergy()).toBeCloseTo(0.5 * m1 * v1 * v1, 9);
  });

  it('the impact acts along w, at the centre of the box’s +w face', () => {
    const { impacts } = run(preset('central'), 1.0);
    const c = impacts[0]!.contact;
    expect(c.normal).not.toBeNull();
    expect(c.normal![3]).toBeCloseTo(1, 12);
    for (const axis of [0, 1, 2]) expect(Math.abs(c.normal![axis]!)).toBeLessThan(1e-12);
    expect(c.pointOnBox![3]).toBeCloseTo(BOX.halfExtents[3], 6);
    for (const axis of [0, 1, 2]) expect(Math.abs(c.pointOnBox![axis]!)).toBeLessThan(1e-9);
    expect(c.state === 'overlapping' || c.state === 'touching').toBe(true);
  });
});

describe('3. angular response in the off-centre impact', () => {
  it('total angular momentum — orbital plus spin, six components — is conserved, and the box spins in x–w', () => {
    const sim = new ContactSimulation(preset('off-centre'));
    const L0 = sim.totalAngularMomentum();
    const P0 = sim.totalMomentum();
    const K0 = sim.kineticEnergy();
    while (sim.time < 1.0 - 1e-12) sim.step();
    const L1 = sim.totalAngularMomentum();
    for (let k = 0; k < 6; k++) expect(L1[k], `L component ${k}`).toBeCloseTo(L0[k]!, 9);
    const P1 = sim.totalMomentum();
    for (let k = 0; k < 4; k++) expect(P1[k], `P component ${k}`).toBeCloseTo(P0[k]!, 12);
    expect(sim.kineticEnergy()).toBeCloseTo(K0, 9);
    const box = sim.state('box');
    // Plane order [xy, xz, xw, yz, yw, zw]: the x–w plane is index 2, a plane containing w.
    expect(Math.abs(box.angularMomentum[2]!), 'box spin in x–w').toBeGreaterThan(1);
    for (const k of [0, 1, 3, 4, 5]) expect(Math.abs(box.angularMomentum[k]!), `box plane ${k}`).toBeLessThan(1e-12);
    for (const c of sim.state('ball').angularMomentum) expect(Math.abs(c), 'the ball takes no spin').toBeLessThan(1e-12);
    expect(sim.impacts).toBe(1);
  });

  it('matches the independent point-impulse prediction, including the box’s plane inertia', () => {
    const x0 = preset('off-centre').ballStart[0];
    const [hx, , , hw] = BOX.halfExtents;
    // Uniform box: plane inertia I_ij = (m/3)(h_i² + h_j²).
    const Ixw = (m2 / 3) * (hx * hx + hw * hw);
    const { sim, impacts } = run(preset('off-centre'), 1.0);
    // The body's own frame is the principal frame, a permutation of the axes for
    // this box, so its diagonal is not indexed by world planes. The world
    // operator is: the x–w unit bivector maps to 1/I_xw in the x–w slot.
    const unitXW = new BivectorN(4, [0, 0, 1, 0, 0, 0]);
    const worldInverse = new ContactSimulation(preset('off-centre')).box.inverseInertiaWorld(unitXW);
    expect(1 / worldInverse.coeffs[2]!, 'the library’s world x–w inertia is the closed form').toBeCloseTo(Ixw, 9);
    for (const k of [0, 1, 3, 4, 5]) expect(Math.abs(worldInverse.coeffs[k]!), `x–w is a principal plane in world (${k})`).toBeLessThan(1e-12);
    // Point impulse J along w at lever (x0, 0, 0, hw): the box responds with 1/m2 + x0²/I_xw.
    const K = 1 / m1 + 1 / m2 + (x0 * x0) / Ixw;
    const J = ((1 + e) * launchSpeed) / K;
    expect(impacts).toHaveLength(1);
    expect(impacts[0]!.contact.impulse).toBeCloseTo(J, 6);
    expect(sim.state('ball').velocity[3]).toBeCloseTo(-launchSpeed + J / m1, 6);
    expect(sim.state('box').velocity[3]).toBeCloseTo(-J / m2, 6);
    expect(Math.abs(sim.state('box').angularMomentum[2]!)).toBeCloseTo(x0 * J, 6);
  });
});

describe('4. contact restitution at the contact point', () => {
  // Tolerance record (it replaces an earlier stated cause). The ratio
  // measured from body states is 1 to machine precision: there is no ~1e−3
  // residual and no "rotation between the solve and the read-back" to
  // explain, and the earlier toBeCloseTo(e, 3) admitted an error of 5e−4 that
  // the data never showed.
  //
  // What is ENFORCED is nine places (±5e−10): six orders of headroom over
  // anything observed, and still a failure on any regression at the 1e−9
  // scale. The observed residual itself is an OBSERVATION about the builds it
  // was measured on, not a portability guarantee, so it is recorded in
  // docs/learn/spatial-sections-and-contact.md rather than
  // asserted here. An earlier ≤ 5e−16 expectation was removed: at
  // about 0.3 ulp of margin it would fail on a libm or FMA that lands at 3
  // ulp, with no physical regression, and it added nothing over nine places.
  const RESTITUTION_PLACES = 9;

  for (const [name, settings] of [
    ['the page’s step, dt 1/120 with 2 substeps', DEFAULT_SETTINGS],
    ['a fine step, dt 1/1200 with 1 substep', { dt: 1 / 1200, substeps: 1, solver: DEFAULT_SETTINGS.solver }]
  ] as const satisfies readonly (readonly [string, SimulationSettings])[]) it(`the relative normal speed at the contact point reverses by e, measured from body states — ${name}`, () => {
    const sim = new ContactSimulation(preset('off-centre'), settings);
    let closing: number | null = null;
    let separating: number | null = null;
    let solverRatio: number | null = null;
    while (sim.time < 1.0 && separating === null) {
      const ballBefore = [...sim.state('ball').velocity];
      const boxBefore = [...sim.state('box').velocity];
      const rec = sim.step();
      if (rec.contact.responded) {
        const n = rec.contact.normal!;
        const point = rec.contact.pointOnBox!;
        // Before: the box is at rest, so its point velocity is zero; the ball moves at its launch velocity.
        closing = -(dot(ballBefore, n) - dot(boxBefore, n));
        // After: the library's point velocities on both bodies, at the recorded contact point.
        const ballPoint = Array.from(sim.ball.velocityAtWorldPoint(point).data);
        const boxPoint = Array.from(sim.box.velocityAtWorldPoint(point).data);
        separating = dot(ballPoint, n) - dot(boxPoint, n);
        solverRatio = rec.contact.finalNormalSpeed! / rec.contact.initialNormalSpeed!;
      }
    }
    expect(closing).toBeCloseTo(launchSpeed, 9);
    expect(separating! / closing!, 'contact-point restitution from body states').toBeCloseTo(e, RESTITUTION_PLACES);
    expect(solverRatio, 'the solver’s own before/after speeds').toBeCloseTo(-e, RESTITUTION_PLACES);
  });
});

describe('5. contact is a four-coordinate fact', () => {
  const lateral = (w: number): Preset => ({
    id: 'central', name: 'lateral probe', summary: '',
    ballStart: [2.7, 0, 0, w], ballVelocity: [-launchSpeed, 0, 0, 0]
  });

  it('the same x, y, z path strikes the +x face at w = 0.3 and passes with no contact at w = 1.7', () => {
    // 2.2 s: enough for the miss to clear the box’s x extent (2.7 − 2.2·2 = −1.7 < −1.2).
    const hit = run(lateral(0.3), 2.2);
    expect(hit.impacts).toHaveLength(1);
    expect(hit.impacts[0]!.contact.normal![0]).toBeCloseTo(1, 12);
    expect(hit.sim.state('box').velocity[0]).toBeLessThan(-0.5);
    // The miss: a step report carries no gap once the broadphase drops a far
    // pair, so the true gap is read from the library query at every step.
    const miss = new ContactSimulation(lateral(1.7));
    let minGap = Number.POSITIVE_INFINITY;
    while (miss.time < 2.2 - 1e-12) {
      miss.step();
      minGap = Math.min(minGap, miss.query().gap ?? Number.POSITIVE_INFINITY);
    }
    expect(miss.impacts).toBe(0);
    expect(miss.state('box').velocity).toEqual([0, 0, 0, 0]);
    // The miss crossed the box's x–y–z footprint entirely, kept apart only by w.
    expect(miss.state('ball').position[0]).toBeLessThan(-BOX.halfExtents[0]);
    expect(minGap).toBeCloseTo(1.7 - BALL.radius - BOX.halfExtents[3], 6);
  });
});

describe('6. determinism', () => {
  it('two runs of the same preset are bitwise identical', () => {
    for (const p of PRESETS) {
      const a = run(p, 1.2);
      const b = run(p, 1.2);
      expect(a.sim.state('ball')).toEqual(b.sim.state('ball'));
      expect(a.sim.state('box')).toEqual(b.sim.state('box'));
      expect(a.records.map((r) => r.contact.impulse)).toEqual(b.records.map((r) => r.contact.impulse));
    }
  });
});

describe('7. numerical stability under tighter settings', () => {
  const variants: Record<string, SimulationSettings> = {
    default: DEFAULT_SETTINGS,
    'one substep': { ...DEFAULT_SETTINGS, substeps: 1 },
    'eight substeps': { ...DEFAULT_SETTINGS, substeps: 8 },
    'dt 1/480': { ...DEFAULT_SETTINGS, dt: 1 / 480 },
    'iterations 64': { ...DEFAULT_SETTINGS, solver: { ...DEFAULT_SETTINGS.solver, iterations: 64 } }
  };

  for (const p of PRESETS) {
    it(`${p.name}: velocities and spin agree across settings; penetration stays within one substep of travel`, () => {
      const reference = run(p, 1.0);
      for (const [name, settings] of Object.entries(variants)) {
        const trial = run(p, 1.0, settings);
        for (const id of ['ball', 'box'] as const) {
          const a = reference.sim.state(id);
          const b = trial.sim.state(id);
          for (let k = 0; k < 4; k++) expect(b.velocity[k], `${name} ${id} v${k}`).toBeCloseTo(a.velocity[k]!, 9);
          for (let k = 0; k < 6; k++) expect(b.angularMomentum[k], `${name} ${id} L${k}`).toBeCloseTo(a.angularMomentum[k]!, 9);
          // Positions differ only by where within a step the impact fell.
          for (let k = 0; k < 4; k++) expect(Math.abs(b.position[k]! - a.position[k]!), `${name} ${id} x${k}`).toBeLessThan(2 * launchSpeed * DEFAULT_SETTINGS.dt);
        }
        const states = new Set(trial.records.map((r) => r.contact.state));
        expect(states.has('unsupported'), `${name}: no unsupported state`).toBe(false);
        expect(states.has('ambiguous-interior'), `${name}: no ambiguous-interior state`).toBe(false);
        const impact = trial.impacts[0]!;
        expect(impact.contact.penetrationDepth, `${name}: penetration at detection`)
          .toBeLessThanOrEqual(launchSpeed * (settings.dt / settings.substeps) + 1e-9);
      }
    });
  }
});
