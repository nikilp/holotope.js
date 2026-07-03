/**
 * A dense N-dimensional vector backed by a Float64Array.
 *
 * CPU-side math in Holotope uses Float64 as the source of truth; conversion
 * to Float32 happens only at the rendering boundary (see the projection
 * module and renderer adapters).
 *
 * Mutating methods operate in place and return `this`, mirroring three.js
 * ergonomics. Use `clone()` when a copy is needed.
 */
export class VecN {
  readonly data: Float64Array;

  constructor(dim: number);
  constructor(values: ArrayLike<number>);
  constructor(arg: number | ArrayLike<number>) {
    this.data = typeof arg === 'number' ? new Float64Array(arg) : Float64Array.from(arg);
  }

  get dim(): number {
    return this.data.length;
  }

  static zero(dim: number): VecN {
    return new VecN(dim);
  }

  /** The i-th standard basis vector of R^dim. */
  static basis(dim: number, i: number): VecN {
    const v = new VecN(dim);
    v.data[i] = 1;
    return v;
  }

  clone(): VecN {
    return new VecN(this.data);
  }

  copy(v: VecN): this {
    assertSameDim(this.dim, v.dim);
    this.data.set(v.data);
    return this;
  }

  add(v: VecN): this {
    assertSameDim(this.dim, v.dim);
    for (let i = 0; i < this.data.length; i++) this.data[i]! += v.data[i]!;
    return this;
  }

  sub(v: VecN): this {
    assertSameDim(this.dim, v.dim);
    for (let i = 0; i < this.data.length; i++) this.data[i]! -= v.data[i]!;
    return this;
  }

  multiplyScalar(s: number): this {
    for (let i = 0; i < this.data.length; i++) this.data[i]! *= s;
    return this;
  }

  dot(v: VecN): number {
    assertSameDim(this.dim, v.dim);
    let acc = 0;
    for (let i = 0; i < this.data.length; i++) acc += this.data[i]! * v.data[i]!;
    return acc;
  }

  lengthSq(): number {
    return this.dot(this);
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  distanceTo(v: VecN): number {
    assertSameDim(this.dim, v.dim);
    let acc = 0;
    for (let i = 0; i < this.data.length; i++) {
      const d = this.data[i]! - v.data[i]!;
      acc += d * d;
    }
    return Math.sqrt(acc);
  }

  normalize(): this {
    const len = this.length();
    if (len === 0) throw new Error('VecN: cannot normalize a zero vector');
    return this.multiplyScalar(1 / len);
  }

  equalsApprox(v: VecN, epsilon = 1e-12): boolean {
    if (this.dim !== v.dim) return false;
    for (let i = 0; i < this.data.length; i++) {
      if (Math.abs(this.data[i]! - v.data[i]!) > epsilon) return false;
    }
    return true;
  }

  toArray(): number[] {
    return Array.from(this.data);
  }
}

export function assertSameDim(a: number, b: number): void {
  if (a !== b) {
    throw new Error(`Holotope: dimension mismatch (${a} vs ${b})`);
  }
}
