import { Rotor4Track, TransformN, VecN } from '@holotope/core';
import { KinematicBody4 } from './kinematic-body4.js';
import { rigidTrajectoryFromTransforms4 } from './rigid-trajectory4.js';

/** Authored R4 translation sampled on the physics clock. */
export type PositionSampler4 = (
  time: number
) => VecN | ArrayLike<number>;

export interface KinematicTrackDriver4Options {
  readonly positionAt: PositionSampler4;
  readonly rotationTrack: Rotor4Track;
  /** Physical duration and animation-clock spacing of every segment. */
  readonly fixedStep: number;
  /** Animation-clock time at the first segment boundary. Defaults to zero. */
  readonly startTime?: number;
}

/**
 * Converts authored position and SO(4) tracks into fixed physical trajectory
 * segments without coupling animation sampling to a renderer or CCD event loop.
 *
 * Every accepted clock boundary is sampled once. The cached end pose of one
 * segment becomes the start pose of the next, while `KinematicBody4` supplies
 * the immutable suffix plans consumed by continuous collision detection.
 */
export class KinematicTrackDriver4 {
  readonly body: KinematicBody4;
  readonly fixedStep: number;
  private readonly positionAt: PositionSampler4;
  private readonly rotationTrack: Rotor4Track;
  private boundaryPose: TransformN;
  private startClock: number;
  private endClock: number;
  private index = 0;

  constructor(options: KinematicTrackDriver4Options) {
    this.fixedStep = positiveFinite(options.fixedStep, 'fixedStep');
    this.positionAt = options.positionAt;
    this.rotationTrack = options.rotationTrack;
    this.startClock = finiteTime(options.startTime ?? 0, 'startTime');
    this.endClock = finiteTime(
      this.startClock + this.fixedStep,
      'first segment end time'
    );

    const start = this.samplePose(this.startClock);
    const end = this.samplePose(this.endClock);
    this.body = KinematicBody4.fromTransforms(start, end, this.fixedStep);
    this.boundaryPose = end.clone();
  }

  get segmentIndex(): number {
    return this.index;
  }

  get segmentStartTime(): number {
    return this.startClock;
  }

  get segmentEndTime(): number {
    return this.endClock;
  }

  /**
   * Installs the next fixed-clock segment after the current one is exhausted.
   * Sampling and trajectory construction complete before any public state is
   * changed, so malformed authored data cannot partially advance the driver.
   */
  advanceSegment(): this {
    const tolerance = 1e-12 * Math.max(1, this.fixedStep);
    if (this.body.remainingTime > tolerance) {
      throw new Error(
        'KinematicTrackDriver4.advanceSegment: current segment is not exhausted'
      );
    }

    const nextEndClock = finiteTime(
      this.endClock + this.fixedStep,
      'next segment end time'
    );
    const nextBoundaryPose = this.samplePose(nextEndClock);
    const nextTrajectory = rigidTrajectoryFromTransforms4(
      this.boundaryPose,
      nextBoundaryPose
    );

    this.body.setTrajectory(nextTrajectory, this.fixedStep);
    this.startClock = this.endClock;
    this.endClock = nextEndClock;
    this.boundaryPose = nextBoundaryPose.clone();
    this.index++;
    return this;
  }

  private samplePose(time: number): TransformN {
    const sampledPosition = this.positionAt(time);
    const position = sampledPosition instanceof VecN
      ? sampledPosition.clone()
      : new VecN(sampledPosition);
    if (
      position.dim !== 4 ||
      Array.from(position.data).some((coordinate) => !Number.isFinite(coordinate))
    ) {
      throw new Error(
        'KinematicTrackDriver4: positionAt must return four finite coordinates'
      );
    }
    return new TransformN(4, this.rotationTrack.sample(time), position);
  }
}

function positiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`KinematicTrackDriver4: ${name} must be finite and positive`);
  }
  return value;
}

function finiteTime(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`KinematicTrackDriver4: ${name} must be finite`);
  }
  return value;
}
