import {
  Camera,
  RenderPipeline,
  type Renderer,
  type Scene,
  Vector2
} from 'three/webgpu';
import { texture } from 'three/tsl';
import {
  ssaaPass,
  type default as SSAAPassNode
} from 'three/addons/tsl/display/SSAAPassNode.js';

export interface RevisionSource {
  readonly revision: number;
}

export type SettledSupersamplingMode = 'direct' | 'supersampled' | 'cached';

export interface SettledSupersampling3DOptions {
  /** Number of samples is 2^sampleLevel. Default 2 (four samples). */
  sampleLevel?: number;
  /** Unchanged frames required before supersampling. Default 2. */
  settleFrames?: number;
  /** Absolute camera/signature tolerance. Default 1e-6. */
  settleEpsilon?: number;
  /** Optional Holotope products whose revisions invalidate the cached result. */
  revisionSources?: readonly RevisionSource[];
}

/** Renderer-independent stability state used by settled render pipelines. */
export class SettledSamplingState {
  readonly settleFrames: number;
  readonly epsilon: number;
  stableFrames = 0;
  settled = false;

  private previous: number[] | null = null;

  constructor(settleFrames = 2, epsilon = 0) {
    if (!Number.isSafeInteger(settleFrames) || settleFrames < 0) {
      throw new Error('SettledSamplingState: settleFrames must be a non-negative integer');
    }
    if (!Number.isFinite(epsilon) || epsilon < 0) {
      throw new Error('SettledSamplingState: epsilon must be finite and non-negative');
    }
    this.settleFrames = settleFrames;
    this.epsilon = epsilon;
  }

  /** Observe all state which affects a render. Returns whether it is settled. */
  observe(signature: ArrayLike<number>): boolean {
    const current = Array.from(signature);
    if (current.some((value) => !Number.isFinite(value))) {
      throw new Error('SettledSamplingState: signature values must be finite');
    }
    const unchanged =
      this.previous !== null &&
      this.previous.length === current.length &&
      this.previous.every(
        (value, index) => Math.abs(value - current[index]!) <= this.epsilon
      );
    if (unchanged) this.stableFrames++;
    else {
      this.previous = current;
      this.stableFrames = 0;
      this.settled = false;
    }
    if (this.stableFrames >= this.settleFrames) this.settled = true;
    return this.settled;
  }

  invalidate(): void {
    this.previous = null;
    this.stableFrames = 0;
    this.settled = false;
  }
}

/**
 * Renders moving state directly, then computes one native Three.js SSAA pass
 * after camera, viewport, and tracked product revisions settle. Later frames
 * replay the cached linear render target without re-running the expensive
 * multi-sample scene pass.
 *
 * Call `invalidate()` for application state not represented by the camera or
 * `revisionSources` (ordinary object animation, material changes, etc.).
 */
export class SettledSupersampling3D {
  readonly renderer: Renderer;
  readonly scene: Scene;
  readonly camera: Camera;
  readonly pass: SSAAPassNode;
  readonly sampleLevel: number;
  readonly sampleCount: number;
  readonly state: SettledSamplingState;
  readonly revisionSources: readonly RevisionSource[];

  private readonly supersampledPipeline: RenderPipeline;
  private readonly cachedPipeline: RenderPipeline;
  private readonly viewportSize = new Vector2();
  private cacheValid = false;
  private _mode: SettledSupersamplingMode = 'direct';

  constructor(
    renderer: Renderer,
    scene: Scene,
    camera: Camera,
    options: SettledSupersampling3DOptions = {}
  ) {
    const sampleLevel = options.sampleLevel ?? 2;
    if (!Number.isSafeInteger(sampleLevel) || sampleLevel < 0 || sampleLevel > 5) {
      throw new Error('SettledSupersampling3D: sampleLevel must be an integer in [0, 5]');
    }
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.sampleLevel = sampleLevel;
    this.sampleCount = 2 ** sampleLevel;
    this.state = new SettledSamplingState(
      options.settleFrames ?? 2,
      options.settleEpsilon ?? 1e-6
    );
    this.revisionSources = options.revisionSources ?? [];
    this.pass = ssaaPass(scene, camera);
    this.pass.sampleLevel = sampleLevel;
    this.supersampledPipeline = new RenderPipeline(renderer, this.pass);
    this.cachedPipeline = new RenderPipeline(renderer, texture(this.pass.renderTarget.texture));
  }

  get mode(): SettledSupersamplingMode {
    return this._mode;
  }

  private signature(): number[] {
    this.camera.updateMatrixWorld();
    this.renderer.getDrawingBufferSize(this.viewportSize);
    return [
      ...this.camera.matrixWorld.elements,
      ...this.camera.projectionMatrix.elements,
      this.viewportSize.x,
      this.viewportSize.y,
      ...this.revisionSources.map((source) => source.revision)
    ];
  }

  /**
   * Render one frame. The returned mode is useful for diagnostics and UI.
   */
  render(): SettledSupersamplingMode {
    if (!this.state.observe(this.signature())) {
      this.cacheValid = false;
      this._mode = 'direct';
      this.renderer.render(this.scene, this.camera);
      return this._mode;
    }
    if (!this.cacheValid) {
      this.supersampledPipeline.render();
      this.cacheValid = true;
      this._mode = 'supersampled';
      return this._mode;
    }
    this.cachedPipeline.render();
    this._mode = 'cached';
    return this._mode;
  }

  invalidate(): void {
    this.state.invalidate();
    this.cacheValid = false;
    this._mode = 'direct';
  }

  dispose(): void {
    this.pass.dispose();
    this.supersampledPipeline.dispose();
    this.cachedPipeline.dispose();
  }
}
