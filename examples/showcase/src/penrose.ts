import {
  penroseCartesian,
  penrosePatch,
  penroseVertexStarCensus,
  penroseWindowVertices,
  type PenrosePatch,
  type PenrosePhasonOffset,
  type PenroseWindowClass
} from '@holotope/core';
import { setupShowcaseUI } from './ui';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const context = canvas.getContext('2d')!;
const PHI = (1 + Math.sqrt(5)) / 2;

const exact = (a: bigint, b = 0n) => ({ a, b });
const PHASON_PRESETS: Record<string, PenrosePhasonOffset> = {
  regular: [exact(1n), exact(1n)],
  east: [exact(2n), exact(1n)],
  north: [exact(1n), exact(2n)],
  skew: [exact(-1n), exact(1n)],
  centered: [exact(0n), exact(0n)]
};
const CLASS_COLORS: Record<PenroseWindowClass, string> = {
  1: '#63e6ff',
  2: '#9f8cff',
  3: '#ff78c8',
  4: '#ffbd66'
};
const CLASS_LABELS: Record<PenroseWindowClass, string> = {
  1: 'class 1 · P',
  2: 'class 2 · −φP',
  3: 'class 3 · φP',
  4: 'class 4 · −P'
};

let physicalRadius = 9;
let showEdges = true;
let phason = 'regular';
let patch: PenrosePatch;

function cartesian(exactCoordinates: readonly { a: bigint; b: bigint }[], denominator = 1): [number, number] {
  const point = penroseCartesian(exactCoordinates);
  return [point[0]! / denominator, point[1]! / denominator];
}

function drawCircle(x: number, y: number, radius: number, fill: string): void {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = fill;
  context.fill();
}

function rebuild(): void {
  patch = penrosePatch({
    coefficientRadius: Math.ceil(physicalRadius),
    physicalRadius,
    phasonOffsetSevenths: PHASON_PRESETS[phason]!,
    boundaryPolicy: phason === 'centered' ? 'include' : 'error'
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

  const centerY = Math.max(300, height * 0.55);
  const physicalCenterX = width * 0.31;
  const physicalScale = Math.min(width * 0.255, height * 0.39) / physicalRadius;
  const physicalPoint = (x: number, y: number): [number, number] => [
    physicalCenterX + x * physicalScale,
    centerY - y * physicalScale
  ];

  const panelCenters: Record<PenroseWindowClass, [number, number]> = {
    1: [width * 0.68, centerY - height * 0.145],
    2: [width * 0.86, centerY - height * 0.145],
    3: [width * 0.68, centerY + height * 0.175],
    4: [width * 0.86, centerY + height * 0.175]
  };
  const internalScale = Math.min(width * 0.072, height * 0.115) / PHI;
  const internalPoint = (windowClass: PenroseWindowClass, x: number, y: number): [number, number] => {
    const center = panelCenters[windowClass];
    return [center[0] + x * internalScale, center[1] - y * internalScale];
  };

  for (const windowClass of [1, 2, 3, 4] as const) {
    const vertices = penroseWindowVertices(windowClass).map((vertex) => cartesian(vertex));
    context.beginPath();
    vertices.forEach(([x, y], index) => {
      const [sx, sy] = internalPoint(windowClass, x, y);
      if (index === 0) context.moveTo(sx, sy);
      else context.lineTo(sx, sy);
    });
    context.closePath();
    context.fillStyle = `${CLASS_COLORS[windowClass]}12`;
    context.fill();
    context.strokeStyle = `${CLASS_COLORS[windowClass]}b8`;
    context.lineWidth = 1.5;
    context.stroke();
  }

  if (showEdges) {
    context.strokeStyle = 'rgba(108, 132, 177, 0.34)';
    context.lineWidth = 0.85;
    for (let edge = 0; edge < patch.edgeDirections.length; edge++) {
      const left = cartesian(patch.points[patch.edges[edge * 2]!]!.parallelExact);
      const right = cartesian(patch.points[patch.edges[edge * 2 + 1]!]!.parallelExact);
      const [x0, y0] = physicalPoint(left[0], left[1]);
      const [x1, y1] = physicalPoint(right[0], right[1]);
      context.beginPath();
      context.moveTo(x0, y0);
      context.lineTo(x1, y1);
      context.stroke();
    }
  }

  for (const point of patch.points) {
    const physical = cartesian(point.parallelExact);
    const internal = cartesian(point.perpendicularExact, 7);
    const color = CLASS_COLORS[point.windowClass];
    const [px, py] = physicalPoint(physical[0], physical[1]);
    const [ix, iy] = internalPoint(point.windowClass, internal[0], internal[1]);
    drawCircle(px, py, 2.05, color);
    drawCircle(ix, iy, 1.55, color);
  }

  context.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.textAlign = 'center';
  for (const windowClass of [1, 2, 3, 4] as const) {
    const [x, y] = panelCenters[windowClass];
    context.fillStyle = CLASS_COLORS[windowClass];
    context.fillText(CLASS_LABELS[windowClass], x, y + height * 0.145);
  }
  context.font = '13px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.fillStyle = '#d7e3ff';
  context.fillText('physical plane — unit-edge Penrose rhombs', physicalCenterX, centerY + height * 0.42);
  context.fillText('internal plane × C₅ — four routed windows', width * 0.77, centerY + height * 0.42);
  context.textAlign = 'left';

  const census = penroseVertexStarCensus(patch, {
    interiorRadius: Math.max(1, physicalRadius - 1.25)
  });
  document.getElementById('stats')!.textContent =
    `${patch.points.length} vertices · ${patch.edges.length / 2} edges · ${census.size}/7 geometric vertex stars`;
  document.getElementById('boundary')!.textContent =
    patch.boundaryCount === 0
      ? 'regular exact cut · 0 boundary hits'
      : `singular centered cut · ${patch.boundaryCount} boundary hits included`;
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

const phasonInput = document.getElementById('phason') as HTMLSelectElement;
phasonInput.addEventListener('change', () => {
  phason = phasonInput.value;
  rebuild();
});
phason = phasonInput.value;

setupShowcaseUI();
window.addEventListener('resize', draw);
rebuild();
