import { VecN } from '@holotope/core';
import type { ContactPipelineResult4 } from '@holotope/physics';
import { describe, expect, it } from 'vitest';
import { BALL, BOX, reportFromSubsteps } from '../../src/spatial-4d-contact/simulation.js';

/**
 * REPORT-HANDLING tests, not physics. `reportFromSubsteps` reads one step's
 * pipeline results into the page's report; the presets exercise exactly one
 * responding substep with one contact point, so the summation over substeps
 * and the choice of the first responding substep were unobservable there
 * (found in review). These fixtures are hand-built result shapes
 * with the fields the reader consumes; they hold the reader's contract, and
 * say nothing about what the solver produces.
 */

interface PointSpec { J: number; v0?: number; v1?: number }
interface PairSpec {
  a?: 'ball' | 'box';
  kind?: 'deep-manifold' | 'distance' | 'unsupported';
  status?: 'separated' | 'touching' | 'overlapping';
  gap?: number;
  depth?: number;
  normal?: number[] | null;
  pointA?: number[] | null;
  pointB?: number[] | null;
  distance?: number;
}

function substep(points: PointSpec[], pair: PairSpec | null): ContactPipelineResult4 {
  const pairs = pair === null ? [] : [{
    colliderA: { id: pair.a === 'box' ? BOX.id : BALL.id },
    colliderB: { id: pair.a === 'box' ? BALL.id : BOX.id },
    narrowphase: pair.kind === 'distance'
      ? { kind: 'distance', distance: pair.distance ?? 0.1 }
      : pair.kind === 'unsupported'
        ? { kind: 'unsupported' }
        : {
          kind: 'deep-manifold',
          algorithm: 'glome-hyperbox4',
          query: {
            status: pair.status ?? 'touching',
            signedDistance: pair.gap ?? 0,
            penetrationDepth: pair.depth ?? 0,
            normal: pair.normal === null ? null : new VecN(pair.normal ?? [0, 0, 0, 1]),
            pointA: pair.pointA === null ? null : new VecN(pair.pointA ?? [0, 0, 0, 1]),
            pointB: pair.pointB === null ? null : new VecN(pair.pointB ?? [0, 0, 0, 1])
          }
        }
  }];
  return {
    pairs,
    response: { points: points.map((p) => ({ accumulatedImpulse: p.J, initialNormalSpeed: p.v0 ?? -2, finalNormalSpeed: p.v1 ?? 2 })) }
  } as unknown as ContactPipelineResult4;
}

const touching = (pointB: number[], extra: Partial<PairSpec> = {}): PairSpec => ({ status: 'touching', pointB, pointA: pointB, ...extra });

describe('impulse aggregation', () => {
  it('sums the impulse over every responding substep, rather than keeping the first or the last', () => {
    const s1 = substep([{ J: 1.5 }], touching([0, 0, 0, 1]));
    const s2 = substep([{ J: 0.5 }], touching([0, 0, 0, 1]));
    const report = reportFromSubsteps([s1, s2], s2);
    expect(report.responded).toBe(true);
    expect(report.impulse).toBe(2.0);
  });

  it('sums over several contact points within one substep', () => {
    const s = substep([{ J: 0.7 }, { J: 0.3 }, { J: 0 }], touching([0, 0, 0, 1]));
    expect(reportFromSubsteps([s], s).impulse).toBeCloseTo(1.0, 15);
  });

  it('a point with zero accumulated impulse does not count as a response', () => {
    const s = substep([{ J: 0 }], { kind: 'distance', distance: 0.05 });
    const report = reportFromSubsteps([s], s);
    expect(report.responded).toBe(false);
    expect(report.impulse).toBe(0);
    expect(report.initialNormalSpeed).toBeNull();
  });
});

describe('which substep supplies the geometry', () => {
  it('the FIRST responding substep, not the last: its point, normal, and normal speeds', () => {
    const quiet = substep([], { kind: 'distance', distance: 0.02 });
    const first = substep([{ J: 1, v0: -2, v1: 2 }], touching([0.8, 0, 0, 1], { normal: [0, 0, 0, 1] }));
    const later = substep([{ J: 0.25, v0: -0.5, v1: 0.5 }], touching([0.9, 0.1, 0, 1.05], { normal: [0.1, 0, 0, 0.995] }));
    const report = reportFromSubsteps([quiet, first, later], later);
    expect(report.pointOnBox).toEqual([0.8, 0, 0, 1]);
    expect(report.normal).toEqual([0, 0, 0, 1]);
    expect(report.initialNormalSpeed).toBe(-2);
    expect(report.finalNormalSpeed).toBe(2);
    expect(report.impulse).toBe(1.25);
  });

  it('a trailing substep whose pair the broadphase dropped does not erase the contact geometry', () => {
    // The documented library contract: after a bounce the pair separates within
    // the same step and the final result can carry no pair at all.
    const first = substep([{ J: 8 / 3 }], touching([0, 0, 0, 1]));
    const dropped = substep([], null);
    const report = reportFromSubsteps([first, dropped], dropped);
    expect(report.responded).toBe(true);
    expect(report.state).toBe('touching');
    expect(report.pointOnBox).toEqual([0, 0, 0, 1]);
    expect(report.normal).toEqual([0, 0, 0, 1]);
    expect(report.impulse).toBeCloseTo(8 / 3, 15);
  });

  it('with no response anywhere, the final substep supplies the geometry', () => {
    const early = substep([], { kind: 'distance', distance: 0.4 });
    const final = substep([], { kind: 'distance', distance: 0.2 });
    const report = reportFromSubsteps([early, final], final);
    expect(report.responded).toBe(false);
    expect(report.state).toBe('separated');
    expect(report.gap).toBe(0.2);
    expect(report.normal).toBeNull();
  });

  it('with no response and no pair at all, the report is empty', () => {
    const none = substep([], null);
    const report = reportFromSubsteps([none], none);
    expect(report.state).toBe('none');
    expect(report.gap).toBeNull();
    expect(report.responded).toBe(false);
  });
});

describe('orientation and status pass-through', () => {
  it('reports the normal box → ball whichever collider the pipeline ordered as A', () => {
    const ballFirst = substep([{ J: 1 }], touching([0, 0, 0, 1], { a: 'ball', normal: [0, 0, 0, 1] }));
    const boxFirst = substep([{ J: 1 }], touching([0, 0, 0, 1], { a: 'box', normal: [0, 0, 0, -1], pointA: [0, 0, 0, 1], pointB: [0, 0, 0, 1.0] }));
    // Negating a zero yields −0; compare values, not signs of zero.
    const values = (v: readonly number[] | null): number[] => (v ?? []).map((c) => (c === 0 ? 0 : c));
    expect(values(reportFromSubsteps([ballFirst], ballFirst).normal)).toEqual([0, 0, 0, 1]);
    expect(values(reportFromSubsteps([boxFirst], boxFirst).normal)).toEqual([0, 0, 0, 1]);
  });

  it('carries the query’s own status, gap and depth, and labels an unsupported pair as such', () => {
    const overlapping = substep([{ J: 1 }], { status: 'overlapping', gap: -0.01, depth: 0.01 });
    const r = reportFromSubsteps([overlapping], overlapping);
    expect(r.state).toBe('overlapping');
    expect(r.gap).toBe(-0.01);
    expect(r.penetrationDepth).toBe(0.01);
    const unsupported = substep([], { kind: 'unsupported' });
    expect(reportFromSubsteps([unsupported], unsupported).state).toBe('unsupported');
  });
});
