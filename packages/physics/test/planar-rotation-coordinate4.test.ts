import { Rotor4, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  PlanarRotationCoordinate4,
  PlanarRotationJoint4,
  RigidBody4,
  planarRotationConstraintBlock4,
  planarRotationPhase4
} from '../src/index.js';

const e0 = VecN.basis(4, 0);
const e1 = VecN.basis(4, 1);
const e2 = VecN.basis(4, 2);
const e3 = VecN.basis(4, 3);

function body(options: {
  rotation?: Rotor4;
  angularMomentum?: ArrayLike<number>;
} = {}): RigidBody4 {
  return new RigidBody4({
    mass: 1,
    inertiaDiagonal: new Float64Array(6).fill(1),
    rotation: options.rotation,
    angularMomentumWorld: options.angularMomentum,
    gravityScale: 0
  });
}

function fixedCoordinate(value: RigidBody4): PlanarRotationCoordinate4 {
  return new PlanarRotationCoordinate4({
    joint: new PlanarRotationJoint4({
      id: 'phase',
      bodyA: value,
      localFixedFrameA: [e0, e1],
      worldFixedFrameB: [e0, e1]
    }),
    localPhaseDirectionA: e2,
    worldPhaseDirectionB: e2
  });
}

describe('R4 planar-rotation phase coordinate', () => {
  it('reports signed free-plane angle, generator, and angular speed', () => {
    const value = body({
      rotation: Rotor4.fromPlanes([{ i: 2, j: 3, angle: 0.73 }]),
      angularMomentum: [0, 0, 0, 0, 0, 0.42]
    });
    const evaluation = fixedCoordinate(value).evaluation();
    expect(evaluation.status).toBe('regular');
    if (evaluation.status !== 'regular') return;
    expect(evaluation.angle).toBeCloseTo(0.73, 13);
    expect(evaluation.wrappedAngle).toBeCloseTo(0.73, 13);
    expect(evaluation.generator.coeffs[5]).toBeCloseTo(1, 14);
    expect(evaluation.angularSpeed).toBeCloseTo(0.42, 14);

    value.rotation = Rotor4.fromPlanes([{ i: 2, j: 3, angle: -0.61 }]);
    const negative = fixedCoordinate(value).evaluation();
    expect(negative.status).toBe('regular');
    if (negative.status === 'regular') {
      expect(negative.angle).toBeCloseTo(-0.61, 13);
    }
  });

  it('unwraps continuously through both branch cuts over many turns', () => {
    const value = body();
    const coordinate = fixedCoordinate(value);
    for (let step = 0; step <= 40; step++) {
      const angle = step * Math.PI / 5;
      value.rotation = Rotor4.fromPlanes([{ i: 2, j: 3, angle }]);
      const evaluation = coordinate.evaluation();
      expect(evaluation.status).toBe('regular');
      if (evaluation.status === 'regular') {
        expect(evaluation.angle).toBeCloseTo(angle, 11);
        expect(evaluation.branch.unwrappedAngle).toBeCloseTo(angle, 11);
      }
    }
  });

  it('requires an explicit branch for an exactly half-turn sample', () => {
    const value = body();
    const coordinate = fixedCoordinate(value);
    expect(coordinate.evaluation().status).toBe('regular');
    value.rotation = Rotor4.fromPlanes([{ i: 2, j: 3, angle: Math.PI }]);
    const ambiguous = coordinate.evaluation();
    expect(ambiguous.status).toBe('unwrap-ambiguous');
    if (ambiguous.status !== 'unwrap-ambiguous') return;
    expect(ambiguous.negativeBranch.unwrappedAngle).toBeCloseTo(-Math.PI, 14);
    expect(ambiguous.positiveBranch.unwrappedAngle).toBeCloseTo(Math.PI, 14);

    const positive = coordinate.evaluation({ halfTurnDirection: 1 });
    expect(positive.status).toBe('regular');
    if (positive.status === 'regular') {
      expect(positive.angle).toBeCloseTo(Math.PI, 14);
    }

    coordinate.resetPhase({ wrappedAngle: 0, unwrappedAngle: 0 });
    const negative = coordinate.evaluation({ halfTurnDirection: -1 });
    expect(negative.status).toBe('regular');
    if (negative.status === 'regular') {
      expect(negative.angle).toBeCloseTo(-Math.PI, 14);
    }
  });

  it('is invariant under SO(2) changes of the transported complement basis', () => {
    const base = planarRotationConstraintBlock4({
      id: 'basis',
      participantA: null,
      participantB: null,
      fixedFrameA: [e0, e1],
      fixedFrameB: [e0, e1]
    });
    expect(base.status).toBe('regular');
    if (base.status !== 'regular') return;
    const angle = 0.47;
    const phaseA = new VecN([0, 0, Math.cos(angle), Math.sin(angle)]);
    const original = planarRotationPhase4({
      constraint: base,
      phaseDirectionA: phaseA,
      phaseDirectionB: e2
    });
    const basisAngle = 0.83;
    const rotatedBasis = [
      base.complementBasis[0].clone().multiplyScalar(Math.cos(basisAngle))
        .add(base.complementBasis[1].clone().multiplyScalar(Math.sin(basisAngle))),
      base.complementBasis[1].clone().multiplyScalar(Math.cos(basisAngle))
        .sub(base.complementBasis[0].clone().multiplyScalar(Math.sin(basisAngle)))
    ] as const;
    const changed = planarRotationConstraintBlock4({
      id: 'basis',
      participantA: null,
      participantB: null,
      fixedFrameA: [e0, e1],
      fixedFrameB: [e0, e1],
      previousComplementBasis: rotatedBasis
    });
    expect(changed.status).toBe('regular');
    if (changed.status !== 'regular') return;
    const transformed = planarRotationPhase4({
      constraint: changed,
      phaseDirectionA: phaseA,
      phaseDirectionB: e2
    });
    expect(original.status).toBe('regular');
    expect(transformed.status).toBe('regular');
    if (original.status === 'regular' && transformed.status === 'regular') {
      expect(transformed.angle).toBeCloseTo(original.angle, 13);
      expect(transformed.angularSpeed).toBeCloseTo(original.angularSpeed, 14);
    }
  });

  it('corrects reflected complement frames to the positive R4 orientation', () => {
    const evaluation = planarRotationConstraintBlock4({
      id: 'orientation',
      participantA: null,
      participantB: null,
      fixedFrameA: [e0, e1],
      fixedFrameB: [e0, e1],
      previousComplementBasis: [e2, e3.clone().multiplyScalar(-1)]
    });
    expect(evaluation.status).toBe('regular');
    if (evaluation.status !== 'regular') return;
    // The lexicographic 23 coefficient is positive exactly when
    // det[e0,e1,p0,p1] is positive for this aligned fixture.
    const phase = planarRotationPhase4({
      constraint: evaluation,
      phaseDirectionA: new VecN([0, 0, Math.cos(0.2), Math.sin(0.2)]),
      phaseDirectionB: e2
    });
    expect(phase.status).toBe('regular');
    if (phase.status === 'regular') {
      expect(phase.generator.coeffs[5]).toBeCloseTo(1, 14);
      expect(phase.angle).toBeCloseTo(0.2, 13);
    }
  });

  it('matches finite-difference phase rates for both participants', () => {
    const epsilon = 2e-7;
    const omegaA = 0.37;
    const omegaB = -0.22;
    const a = body({ angularMomentum: [0, 0, 0, 0, 0, omegaA] });
    const b = body({ angularMomentum: [0, 0, 0, 0, 0, omegaB] });
    const joint = new PlanarRotationJoint4({
      id: 'differential',
      bodyA: a,
      localFixedFrameA: [e0, e1],
      bodyB: b,
      localFixedFrameB: [e0, e1]
    });
    const coordinate = new PlanarRotationCoordinate4({
      joint,
      localPhaseDirectionA: e2,
      localPhaseDirectionB: e2
    });
    const initial = coordinate.evaluation();
    expect(initial.status).toBe('regular');
    if (initial.status !== 'regular') return;
    a.rotation = Rotor4.fromPlanes([{ i: 2, j: 3, angle: omegaA * epsilon }]);
    b.rotation = Rotor4.fromPlanes([{ i: 2, j: 3, angle: omegaB * epsilon }]);
    const next = coordinate.evaluation();
    expect(next.status).toBe('regular');
    if (next.status !== 'regular') return;
    expect((next.angle - initial.angle) / epsilon)
      .toBeCloseTo(initial.angularSpeed, 6);
    expect(initial.angularSpeed).toBeCloseTo(omegaA - omegaB, 14);
  });

  it('is invariant under a common full-SO(4) rotation and closes in R3', () => {
    const relativeAngle = -0.58;
    const common = Rotor4.fromPlanes([
      { i: 0, j: 2, angle: 0.31 },
      { i: 1, j: 3, angle: -0.44 },
      { i: 0, j: 1, angle: 0.19 }
    ]);
    const free = Rotor4.fromPlanes([{ i: 2, j: 3, angle: relativeAngle }]);
    const fixedFrame = [common.applyToPoint(e0), common.applyToPoint(e1)] as const;
    const constraint = planarRotationConstraintBlock4({
      id: 'common',
      participantA: null,
      participantB: null,
      fixedFrameA: fixedFrame,
      fixedFrameB: fixedFrame
    });
    expect(constraint.status).toBe('regular');
    if (constraint.status !== 'regular') return;
    const phase = planarRotationPhase4({
      constraint,
      phaseDirectionA: common.applyToPoint(free.applyToPoint(e2)),
      phaseDirectionB: common.applyToPoint(e2)
    });
    expect(phase.status).toBe('regular');
    if (phase.status === 'regular') {
      expect(phase.angle).toBeCloseTo(relativeAngle, 12);
    }

    const r3 = body({
      rotation: Rotor4.fromPlanes([{ i: 0, j: 1, angle: 0.64 }])
    });
    const embedded = new PlanarRotationCoordinate4({
      joint: new PlanarRotationJoint4({
        id: 'embedded-r3',
        bodyA: r3,
        localFixedFrameA: [e2, e3],
        worldFixedFrameB: [e2, e3]
      }),
      localPhaseDirectionA: e0,
      worldPhaseDirectionB: e0
    }).evaluation();
    expect(embedded.status).toBe('regular');
    if (embedded.status === 'regular') {
      expect(embedded.angle).toBeCloseTo(0.64, 13);
    }
  });

  it('exposes degeneracy and rejects malformed authored state', () => {
    const value = body();
    const coordinate = fixedCoordinate(value);
    const forced = planarRotationPhase4({
      constraint: (coordinate.joint.constraint() as Extract<
        ReturnType<PlanarRotationJoint4['constraint']>,
        { status: 'regular' }
      >),
      phaseDirectionA: e2,
      phaseDirectionB: e2,
      phaseTolerance: 2
    });
    expect(forced.status).toBe('phase-degenerate');

    expect(() => new PlanarRotationCoordinate4({
      joint: coordinate.joint,
      localPhaseDirectionA: e0,
      worldPhaseDirectionB: e2
    })).toThrow(/orthogonal/);
    expect(() => new PlanarRotationCoordinate4({
      joint: coordinate.joint,
      localPhaseDirectionA: e2,
      localPhaseDirectionB: e2
    } as never)).toThrow(/worldPhaseDirectionB/);
    const constraint = coordinate.joint.constraint();
    expect(constraint.status).toBe('regular');
    if (constraint.status !== 'regular') return;
    expect(() => planarRotationPhase4({
      constraint,
      phaseDirectionA: e2,
      phaseDirectionB: e2,
      previousBranch: { wrappedAngle: 0.2, unwrappedAngle: 8 }
    })).toThrow(/branch token/);
  });
});
