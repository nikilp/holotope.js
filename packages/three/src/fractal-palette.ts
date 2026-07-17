export type FractalPaletteId = 'classic' | 'ember' | 'porcelain' | 'spectral';

export type FractalRgb = readonly [number, number, number];

export interface FractalPaletteDefinition {
  readonly label: string;
  readonly surfaceLow: FractalRgb;
  readonly surfaceHigh: FractalRgb;
  readonly highlight: FractalRgb;
  readonly rim: FractalRgb;
  readonly productFirst: FractalRgb;
  readonly productSecond: FractalRgb;
  readonly productRim: FractalRgb;
  readonly seam: FractalRgb;
}

/**
 * Shared field palettes. `classic` reproduces the original quaternion and
 * bicomplex ray-march colors; the other entries change presentation only.
 */
export const FRACTAL_PALETTES: Readonly<Record<FractalPaletteId, FractalPaletteDefinition>> = {
  classic: {
    label: 'classic · blue / magenta',
    surfaceLow: [0.035, 0.24, 0.48],
    surfaceHigh: [0.98, 0.16, 0.57],
    highlight: [0.82, 0.72, 1],
    rim: [0.34, 0.12, 0.5],
    productFirst: [0.08, 0.78, 0.92],
    productSecond: [0.98, 0.18, 0.64],
    productRim: [0.28, 0.18, 0.48],
    seam: [0.2, 0.08, 0.24]
  },
  ember: {
    label: 'ember · copper / cream',
    surfaceLow: [0.12, 0.012, 0.018],
    surfaceHigh: [0.96, 0.24, 0.045],
    highlight: [1, 0.88, 0.58],
    rim: [0.62, 0.075, 0.018],
    productFirst: [0.96, 0.42, 0.055],
    productSecond: [1, 0.84, 0.42],
    productRim: [0.62, 0.075, 0.018],
    seam: [0.48, 0.035, 0.025]
  },
  porcelain: {
    label: 'porcelain · ink / ivory',
    surfaceLow: [0.025, 0.045, 0.065],
    surfaceHigh: [0.66, 0.35, 0.17],
    highlight: [0.98, 0.94, 0.84],
    rim: [0.38, 0.57, 0.7],
    productFirst: [0.24, 0.54, 0.66],
    productSecond: [0.91, 0.65, 0.36],
    productRim: [0.38, 0.57, 0.7],
    seam: [0.18, 0.12, 0.11]
  },
  spectral: {
    label: 'spectral · cyan / violet / gold',
    surfaceLow: [0.008, 0.18, 0.23],
    surfaceHigh: [0.57, 0.14, 0.88],
    highlight: [1, 0.84, 0.18],
    rim: [0.1, 0.72, 0.88],
    productFirst: [0.02, 0.82, 0.78],
    productSecond: [0.72, 0.18, 0.96],
    productRim: [0.1, 0.72, 0.88],
    seam: [0.92, 0.62, 0.08]
  }
};

export function getFractalPalette(id: FractalPaletteId): FractalPaletteDefinition {
  return FRACTAL_PALETTES[id];
}

/** Three-stop CPU sampler used by relief and diagnostic mesh products. */
export function sampleFractalPalette(id: FractalPaletteId, value: number): number {
  const palette = getFractalPalette(id);
  const t = Math.max(0, Math.min(1, value));
  const split = 0.72;
  const left = t <= split ? palette.surfaceLow : palette.surfaceHigh;
  const right = t <= split ? palette.surfaceHigh : palette.highlight;
  const local = t <= split ? t / split : (t - split) / (1 - split);
  const channel = (index: number): number =>
    Math.round((left[index]! + (right[index]! - left[index]!) * local) * 255);
  return (channel(0) << 16) | (channel(1) << 8) | channel(2);
}
