import {
  ammannBeenkerInflate,
  ammannBeenkerPatch,
  type AmmannBeenkerCoefficients,
  type AmmannBeenkerPatch,
  type AmmannBeenkerPhasonOffset
} from '@holotope/core';
import { setupShowcaseUI } from './ui';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const context = canvas.getContext('2d')!;
const SILVER = 1 + Math.SQRT2;
const AXIS_RADIUS = SILVER / 2;

let physicalRadius = 8;
let showEdges = true;
let showInflation = true;
let patch: AmmannBeenkerPatch;
let phason = 'canonical';

const exact = (a: bigint, b = 0n) => ({ a, b });
const PHASON_PRESETS: Record<string, AmmannBeenkerPhasonOffset> = {
  canonical: [exact(0n), exact(0n)],
  east: [exact(1n), exact(0n)],
  north: [exact(0n), exact(1n)],
  diagonal: [exact(1n), exact(1n)],
  skew: [exact(1n), exact(-1n)]
};

const coefficientKey = (coefficients: readonly bigint[]): string => coefficients.join(',');

function drawCircle(x: number, y: number, radius: number, fill: string): void {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = fill;
  context.fill();
}

function pointColor(internalX: number, internalY: number, alpha = 0.9): string {
  const angle = (Math.atan2(internalY, internalX) / (2 * Math.PI) + 1) % 1;
  const hue = Math.round(185 + angle * 130);
  return `hsla(${hue}, 88%, 68%, ${alpha})`;
}

function rebuild(): void {
  const coefficientRadius = Math.max(6, Math.ceil(physicalRadius / 1.5) + 2);
  patch = ammannBeenkerPatch({
    coefficientRadius,
    physicalRadius,
    phasonOffsetQuarters: PHASON_PRESETS[phason]!
  });
  draw();
}

function draw(): void {
  const dpr = Math.min(devicePixelRatio, 2);
  const width = innerWidth;
  const height = innerHeight;
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = '#080910';
  context.fillRect(0, 0, width, height);

  const centerY = Math.max(300, height * 0.54);
  const physicalCenterX = width * 0.31;
  const internalCenterX = width * 0.76;
  const physicalScale = Math.min(width * 0.235, height * 0.36) / physicalRadius;
  const internalScale = Math.min(width * 0.16, height * 0.28) / AXIS_RADIUS;
  const physicalPoint = (x: number, y: number): [number, number] => [
    physicalCenterX + x * physicalScale,
    centerY - y * physicalScale
  ];
  const internalPoint = (x: number, y: number): [number, number] => [
    internalCenterX + x * internalScale,
    centerY - y * internalScale
  ];

  // Unit-edge regular octagon: vertices alternate (silver/2, 1/2).
  const windowVertices: Array<[number, number]> = [
    [AXIS_RADIUS, 0.5],
    [0.5, AXIS_RADIUS],
    [-0.5, AXIS_RADIUS],
    [-AXIS_RADIUS, 0.5],
    [-AXIS_RADIUS, -0.5],
    [-0.5, -AXIS_RADIUS],
    [0.5, -AXIS_RADIUS],
    [AXIS_RADIUS, -0.5]
  ];
  context.beginPath();
  windowVertices.forEach(([x, y], i) => {
    const [sx, sy] = internalPoint(x, y);
    if (i === 0) context.moveTo(sx, sy);
    else context.lineTo(sx, sy);
  });
  context.closePath();
  context.fillStyle = 'rgba(99, 230, 255, 0.07)';
  context.fill();
  context.strokeStyle = 'rgba(99, 230, 255, 0.7)';
  context.lineWidth = 1.5;
  context.stroke();

  if (showEdges) {
    context.strokeStyle = 'rgba(108, 132, 177, 0.3)';
    context.lineWidth = 0.8;
    for (let e = 0; e < patch.edges.length; e += 2) {
      const left = patch.points[patch.edges[e]!]!.parallel;
      const right = patch.points[patch.edges[e + 1]!]!.parallel;
      const [x0, y0] = physicalPoint(left[0]!, left[1]!);
      const [x1, y1] = physicalPoint(right[0]!, right[1]!);
      context.beginPath();
      context.moveTo(x0, y0);
      context.lineTo(x1, y1);
      context.stroke();
    }
  }

  for (const point of patch.points) {
    const [px, py] = physicalPoint(point.parallel[0]!, point.parallel[1]!);
    const [ix, iy] = internalPoint(point.perpendicular[0]!, point.perpendicular[1]!);
    const color = pointColor(point.perpendicular[0]!, point.perpendicular[1]!);
    drawCircle(px, py, 2.15, color);
    drawCircle(ix, iy, 1.75, color);
  }

  let inflationCount = 0;
  if (showInflation) {
    const index = new Map(patch.points.map((point) => [coefficientKey(point.coefficients), point]));
    context.strokeStyle = '#ffbd66';
    context.lineWidth = 1.4;
    for (const point of patch.points) {
      const inflated = ammannBeenkerInflate(
        point.coefficients as AmmannBeenkerCoefficients
      );
      const image = index.get(coefficientKey(inflated));
      if (!image) continue;
      inflationCount++;
      for (const [x, y] of [
        physicalPoint(image.parallel[0]!, image.parallel[1]!),
        internalPoint(image.perpendicular[0]!, image.perpendicular[1]!)
      ]) {
        context.beginPath();
        context.arc(x, y, 4.2, 0, Math.PI * 2);
        context.stroke();
      }
    }
  }

  context.font = '13px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.fillStyle = '#d7e3ff';
  context.textAlign = 'center';
  context.fillText('physical space — Ammann–Beenker patch', physicalCenterX, centerY + height * 0.405);
  context.fillText('internal space — exact octagonal window', internalCenterX, centerY + height * 0.405);
  context.fillStyle = '#7fd4ff';
  context.fillText('8-fold star map  ζ₈ ↦ ζ₈³', internalCenterX, centerY + height * 0.405 + 20);
  context.textAlign = 'left';

  document.getElementById('stats')!.textContent =
    `${patch.points.length} vertices · ${patch.edges.length / 2} visible edges · ${patch.boundaryCount} boundary hits`;
  document.getElementById('inflationCount')!.textContent = showInflation
    ? `${inflationCount} visible vertices in the silver-mean image`
    : phason === 'canonical'
      ? 'inflation image hidden'
      : 'inflation belongs to the canonical phason preset';
}

const radiusInput = document.getElementById('radius') as HTMLInputElement;
const radiusValue = document.getElementById('radiusValue')!;
radiusInput.addEventListener('input', () => {
  physicalRadius = Number(radiusInput.value);
  radiusValue.textContent = physicalRadius.toFixed(1);
  rebuild();
});
physicalRadius = Number(radiusInput.value);
radiusValue.textContent = physicalRadius.toFixed(1);

const edgesInput = document.getElementById('edges') as HTMLInputElement;
edgesInput.addEventListener('change', () => {
  showEdges = edgesInput.checked;
  draw();
});
showEdges = edgesInput.checked;

const inflationInput = document.getElementById('inflation') as HTMLInputElement;
inflationInput.addEventListener('change', () => {
  showInflation = inflationInput.checked;
  draw();
});
showInflation = inflationInput.checked;

const phasonInput = document.getElementById('phason') as HTMLSelectElement;
phasonInput.addEventListener('change', () => {
  phason = phasonInput.value;
  const canonical = phason === 'canonical';
  inflationInput.disabled = !canonical;
  if (!canonical) {
    inflationInput.checked = false;
    showInflation = false;
  }
  rebuild();
});
phason = phasonInput.value;

setupShowcaseUI();
window.addEventListener('resize', draw);
rebuild();
