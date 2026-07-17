import { cos, dot, float, fwidth, max, mix, smoothstep, vec3 } from 'three/tsl';
import {
  QuaternionJuliaField,
  type HyperplaneSlice4,
  type QuaternionJuliaEvaluation
} from '@holotope/core';
import { getFractalPalette, type FractalPaletteId } from '../fractal-palette.js';
import type { RaymarchedFieldStyle3D } from './implicit-field-node4.js';
import { QuaternionJuliaNode4 } from './quaternion-julia-node.js';
import {
  RaymarchedField3D,
  type RaymarchedField3DOptions
} from './raymarched-field.js';

export interface RaymarchedQuaternionJulia3DOptions
  extends Omit<RaymarchedField3DOptions, 'style'> {
  /** Presentation-only color palette. Default `classic` preserves the original rendering. */
  palette?: FractalPaletteId;
}

function quaternionJuliaStyle(paletteId: FractalPaletteId): RaymarchedFieldStyle3D {
  const colors = getFractalPalette(paletteId);
  return {
    shade({ record, normal, rayDirection, stepFraction, iterationLimit }) {
      // Fade procedural orbit bands once a pixel spans much of their period.
      // Ordinary MSAA cannot filter detail generated in the fragment graph.
      const bandPhase = record.z.mul(22);
      const bandFootprint = fwidth(bandPhase);
      const bandContrast = float(0.12).mul(
        float(1).sub(smoothstep(0.18, 1.25, bandFootprint))
      );
      const phase = record.y.div(iterationLimit);
      const palette = mix(
        vec3(...colors.surfaceLow),
        vec3(...colors.surfaceHigh),
        smoothstep(0.08, 0.9, phase)
      );
      const bands = float(1).sub(bandContrast).add(cos(bandPhase).mul(bandContrast));
      const diffuse = max(dot(normal, vec3(0.55, 0.72, 0.42).normalize()), 0);
      const viewFacing = max(dot(normal, rayDirection.negate()), 0);
      const rim = float(1).sub(viewFacing).pow(2.4);
      const traceOcclusion = float(1).sub(stepFraction.mul(0.38));
      return palette
        .mul(float(0.16).add(diffuse.mul(0.84)))
        .mul(bands)
        .mul(traceOcclusion)
        .add(vec3(...colors.rim).mul(rim));
    }
  };
}

/**
 * Quaternion Julia specialization of `RaymarchedField3D`. Field evaluation,
 * ray transport, and presentation are separate objects; this class preserves
 * the original concise API and classic default appearance.
 */
export class RaymarchedQuaternionJulia3D extends RaymarchedField3D<
  QuaternionJuliaEvaluation,
  QuaternionJuliaField
> {
  readonly palette: FractalPaletteId;

  constructor(
    field: QuaternionJuliaField,
    slice: HyperplaneSlice4,
    options: RaymarchedQuaternionJulia3DOptions = {}
  ) {
    const { palette = 'classic', ...renderOptions } = options;
    super(new QuaternionJuliaNode4(field), slice, {
      ...renderOptions,
      maxSteps: renderOptions.maxSteps ?? 112,
      style: quaternionJuliaStyle(palette)
    });
    this.palette = palette;
  }
}
