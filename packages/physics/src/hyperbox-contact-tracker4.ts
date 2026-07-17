import type {
  HyperboxContactPatch4,
  HyperboxContactVertex4
} from './hyperbox-contact4.js';

export interface HyperboxContactTrackerOptions4 {
  /** Track the bounded solver subset (default) or every geometric vertex. */
  pointSource?: 'solver' | 'vertices';
}

export interface HyperboxTrackedContactPoint4 {
  readonly id: string;
  /** Number of consecutive tracker updates in which this identity was present. */
  readonly age: number;
  readonly isNew: boolean;
  readonly vertex: HyperboxContactVertex4;
}

export interface HyperboxContactTrackingResult4 {
  readonly points: readonly HyperboxTrackedContactPoint4[];
  /** Identities present in the previous update but absent from this one. */
  readonly retiredIds: readonly string[];
}

/**
 * Minimal temporal cache for box contact identities.
 *
 * Identity comes from local feature pairs rather than world coordinates, so
 * coherent motion can move a point without invalidating a future accumulated
 * impulse. The tracker deliberately does not guess proximity matches across a
 * topological feature change; such points retire and re-enter as new.
 */
export class HyperboxContactTracker4 {
  readonly pointSource: 'solver' | 'vertices';
  private ages = new Map<string, number>();

  constructor(options: HyperboxContactTrackerOptions4 = {}) {
    this.pointSource = options.pointSource ?? 'solver';
    if (this.pointSource !== 'solver' && this.pointSource !== 'vertices') {
      throw new Error('HyperboxContactTracker4: pointSource must be solver or vertices');
    }
  }

  update(patch: HyperboxContactPatch4 | null): HyperboxContactTrackingResult4 {
    const vertices = patch
      ? this.pointSource === 'solver'
        ? patch.solverPoints
        : patch.vertices
      : [];
    const nextAges = new Map<string, number>();
    const points = vertices.map((vertex): HyperboxTrackedContactPoint4 => {
      if (nextAges.has(vertex.id)) {
        throw new Error(`HyperboxContactTracker4: duplicate contact identity ${vertex.id}`);
      }
      const previousAge = this.ages.get(vertex.id);
      const age = (previousAge ?? 0) + 1;
      nextAges.set(vertex.id, age);
      return {
        id: vertex.id,
        age,
        isNew: previousAge === undefined,
        vertex
      };
    });
    const retiredIds = Array.from(this.ages.keys())
      .filter((id) => !nextAges.has(id))
      .sort();
    this.ages = nextAges;
    return { points, retiredIds };
  }

  reset(): void {
    this.ages.clear();
  }
}
