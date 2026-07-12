import { TransformN } from '../math/transform.js';

/**
 * A node in an N-dimensional scene hierarchy.
 *
 * Each node carries a local rigid transform (rotation backend +
 * translation); world transforms compose down the tree by the rigid
 * group law
 *
 *   R_w = R_p · R_c,   t_w = R_p(t_c) + t_p,
 *
 * i.e. `parent.world.compose(child.local)`. On the Rotor4 backend the
 * rotation composition is a rotor product, so deep hierarchies stay on
 * the fast path and never touch dense matrices.
 *
 * There is deliberately no scale: a non-uniform scale in R⁴ breaks the
 * orthonormality every rotation backend and render product assumes
 * (and makes decomposition ill-posed). Rigid motions compose closed;
 * anything else belongs in geometry, not in the transform.
 *
 * `updateWorld()` recomputes the subtree's world transforms in one
 * traversal — call it once per frame on the root, as three.js does
 * with `updateMatrixWorld`. Render products then consume
 * `node.world` directly.
 */
export class ObjectN {
  readonly dim: number;
  /** Local transform, freely mutable between updates. */
  local: TransformN;
  /** World transform as of the last `updateWorld` traversal. */
  world: TransformN;
  parent: ObjectN | null = null;
  readonly children: ObjectN[] = [];

  constructor(dim: number, local?: TransformN) {
    this.dim = dim;
    this.local = local ?? TransformN.identity(dim);
    if (this.local.dim !== dim) {
      throw new Error(`ObjectN: transform dim ${this.local.dim} != node dim ${dim}`);
    }
    this.world = this.local.clone();
  }

  add(child: ObjectN): this {
    if (child.dim !== this.dim) {
      throw new Error(`ObjectN: cannot parent dim ${child.dim} under dim ${this.dim}`);
    }
    if (child === this) throw new Error('ObjectN: cannot parent a node to itself');
    child.parent?.remove(child);
    child.parent = this;
    this.children.push(child);
    return this;
  }

  remove(child: ObjectN): this {
    const i = this.children.indexOf(child);
    if (i !== -1) {
      this.children.splice(i, 1);
      child.parent = null;
    }
    return this;
  }

  /** Depth-first visit of this node and all descendants. */
  traverse(visit: (node: ObjectN) => void): void {
    visit(this);
    for (const child of this.children) child.traverse(visit);
  }

  /**
   * Recomputes world transforms for this subtree. When called on a
   * parented node, the parent's `world` is trusted as-is; roots compose
   * against identity.
   */
  updateWorld(): void {
    this.world = this.parent ? this.parent.world.compose(this.local) : this.local.clone();
    for (const child of this.children) child.updateWorld();
  }
}

/** A root node: the conventional entry point of a hierarchy. */
export class SceneN extends ObjectN {}
