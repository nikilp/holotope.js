import { describe, expect, it } from 'vitest';
import {
  FRACTAL_PALETTES,
  getFractalPalette,
  sampleFractalPalette
} from '../src/fractal-palette.js';

describe('fractal palettes', () => {
  it('pins the original ray-march colors as the classic default', () => {
    expect(getFractalPalette('classic')).toEqual({
      label: 'classic · blue / magenta',
      surfaceLow: [0.035, 0.24, 0.48],
      surfaceHigh: [0.98, 0.16, 0.57],
      highlight: [0.82, 0.72, 1],
      rim: [0.34, 0.12, 0.5],
      productFirst: [0.08, 0.78, 0.92],
      productSecond: [0.98, 0.18, 0.64],
      productRim: [0.28, 0.18, 0.48],
      seam: [0.2, 0.08, 0.24]
    });
  });

  it('keeps CPU samples inside packed RGB bounds for every palette', () => {
    for (const id of Object.keys(FRACTAL_PALETTES) as (keyof typeof FRACTAL_PALETTES)[]) {
      expect(sampleFractalPalette(id, -1)).toBeGreaterThanOrEqual(0);
      expect(sampleFractalPalette(id, 0.5)).toBeLessThanOrEqual(0xffffff);
      expect(sampleFractalPalette(id, 2)).toBeLessThanOrEqual(0xffffff);
    }
  });
});
