import { ObjectN, Rotor4, TransformN, VecN } from '@holotope/core';
import { RigidBody4 } from './rigid-body4.js';

/**
 * Interpolates a simulated 4D rigid-body pose onto an ObjectN scene node.
 *
 * The binding stores two simulation snapshots. Call `capture()` after every
 * fixed physics step, then call `apply(alpha)` before the scene's single
 * `updateWorld()` traversal. `alpha=0` selects the previous snapshot and
 * `alpha=1` the current one.
 *
 * Body poses are world-space. If the target node is parented, `apply()`
 * converts the interpolated pose through the parent's current world transform
 * so hierarchy composition reconstructs the body pose exactly.
 */
export class RigidBodyObject4Binding {
  readonly body: RigidBody4;
  readonly object: ObjectN;

  private previousPosition: VecN;
  private currentPosition: VecN;
  private previousRotation: Rotor4;
  private currentRotation: Rotor4;

  constructor(body: RigidBody4, object: ObjectN) {
    if (object.dim !== 4) {
      throw new Error(
        `RigidBodyObject4Binding: target ObjectN must be 4D, got dim=${object.dim}`
      );
    }
    this.body = body;
    this.object = object;
    this.previousPosition = body.position.clone();
    this.currentPosition = body.position.clone();
    this.previousRotation = body.rotation.clone();
    this.currentRotation = body.rotation.clone();
  }

  /** Records the body's current pose as the next fixed-step snapshot. */
  capture(): this {
    this.previousPosition = this.currentPosition;
    this.previousRotation = this.currentRotation;
    this.currentPosition = this.body.position.clone();
    this.currentRotation = this.body.rotation.clone();
    return this;
  }

  /**
   * Discards interpolation history after a teleport/reset and records the
   * current body pose in both snapshots.
   */
  snap(): this {
    this.previousPosition = this.body.position.clone();
    this.currentPosition = this.body.position.clone();
    this.previousRotation = this.body.rotation.clone();
    this.currentRotation = this.body.rotation.clone();
    return this;
  }

  /** Returns the interpolated body pose in world coordinates. */
  poseAt(alpha = 1): TransformN {
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
      throw new Error('RigidBodyObject4Binding.poseAt: alpha must be finite and in [0, 1]');
    }
    const position = new VecN(4);
    for (let axis = 0; axis < 4; axis++) {
      const previous = this.previousPosition.data[axis]!;
      position.data[axis] = previous +
        (this.currentPosition.data[axis]! - previous) * alpha;
    }
    return new TransformN(
      4,
      Rotor4.slerp(this.previousRotation, this.currentRotation, alpha),
      position
    );
  }

  /**
   * Writes the interpolated pose to `object.local`. The caller remains
   * responsible for the usual once-per-frame root `updateWorld()` traversal.
   */
  apply(alpha = 1): this {
    const worldPose = this.poseAt(alpha);
    this.object.local = this.object.parent
      ? this.object.parent.world.inverse().compose(worldPose)
      : worldPose;
    return this;
  }
}
