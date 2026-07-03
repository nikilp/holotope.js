import { Rotor4 } from '@holotope/core';

export interface DragRotation4DOptions {
  /** Plane driven by horizontal pointer movement. Default [0, 3] (xw). */
  horizontalPlane?: [number, number];
  /** Plane driven by vertical pointer movement. Default [1, 3] (yw). */
  verticalPlane?: [number, number];
  /** Radians per pixel of pointer movement. Default 0.008. */
  speed?: number;
  /** Modifier key that activates the 4D drag. Default 'alt'. */
  modifier?: 'alt' | 'shift' | 'ctrl' | 'none';
}

/**
 * Pointer controls for rotating an object in 4D planes the 3D camera
 * cannot reach: dragging (with a modifier key held, by default Alt)
 * accumulates a `Rotor4`, horizontal movement rotating in one plane and
 * vertical movement in another.
 *
 * This intentionally complements — rather than replaces — a 3D orbit
 * control on the same canvas: plain drags orbit the 3D view, modified
 * drags rotate through the hidden dimension. While a 4D drag is active,
 * `active` is true; use it to disable the 3D controls for that gesture.
 *
 * The pointer→rotor mapping lives in `applyDrag`, which is pure and
 * testable; `attach` wires it to DOM pointer events.
 */
export class DragRotation4D {
  /** Accumulated user rotation. Compose with your per-frame transform. */
  rotor = Rotor4.identity();
  /** True while a modified drag gesture is in progress. */
  active = false;

  readonly horizontalPlane: [number, number];
  readonly verticalPlane: [number, number];
  speed: number;
  modifier: 'alt' | 'shift' | 'ctrl' | 'none';

  private element: HTMLElement | null = null;
  private pointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private readonly onPointerDown = (e: PointerEvent) => this.handleDown(e);
  private readonly onPointerMove = (e: PointerEvent) => this.handleMove(e);
  private readonly onPointerUp = (e: PointerEvent) => this.handleUp(e);

  constructor(options: DragRotation4DOptions = {}) {
    this.horizontalPlane = options.horizontalPlane ?? [0, 3];
    this.verticalPlane = options.verticalPlane ?? [1, 3];
    this.speed = options.speed ?? 0.008;
    this.modifier = options.modifier ?? 'alt';
  }

  /** Applies a drag delta in pixels, premultiplying onto the rotor. */
  applyDrag(dxPixels: number, dyPixels: number): void {
    const [hi, hj] = this.horizontalPlane;
    const [vi, vj] = this.verticalPlane;
    this.rotor = Rotor4.fromPlanes([
      { i: hi, j: hj, angle: dxPixels * this.speed },
      { i: vi, j: vj, angle: dyPixels * this.speed }
    ])
      .multiply(this.rotor)
      .normalize();
  }

  reset(): void {
    this.rotor = Rotor4.identity();
  }

  attach(element: HTMLElement): this {
    this.detach();
    this.element = element;
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointercancel', this.onPointerUp);
    return this;
  }

  detach(): void {
    if (!this.element) return;
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointercancel', this.onPointerUp);
    this.element = null;
    this.active = false;
    this.pointerId = null;
  }

  dispose(): void {
    this.detach();
  }

  private modifierHeld(e: PointerEvent): boolean {
    switch (this.modifier) {
      case 'alt':
        return e.altKey;
      case 'shift':
        return e.shiftKey;
      case 'ctrl':
        return e.ctrlKey;
      case 'none':
        return true;
    }
  }

  private handleDown(e: PointerEvent): void {
    if (!e.isPrimary || !this.modifierHeld(e)) return;
    this.active = true;
    this.pointerId = e.pointerId;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.element?.setPointerCapture(e.pointerId);
  }

  private handleMove(e: PointerEvent): void {
    if (!this.active || e.pointerId !== this.pointerId) return;
    this.applyDrag(e.clientX - this.lastX, e.clientY - this.lastY);
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  }

  private handleUp(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.active = false;
    this.pointerId = null;
    this.element?.releasePointerCapture(e.pointerId);
  }
}
