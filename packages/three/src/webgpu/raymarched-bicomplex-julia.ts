import { dot, float, max, mix, smoothstep, vec3 } from 'three/tsl';
import {
  BicomplexJuliaField,
  type BicomplexJuliaEvaluation,
  type HyperplaneSlice4
} from '@holotope/core';
import { getFractalPalette, type FractalPaletteId } from '../fractal-palette.js';
import { BicomplexJuliaNode4 } from './bicomplex-julia-node.js';
import type { RaymarchedFieldStyle3D } from './implicit-field-node4.js';
import {
  RaymarchedField3D,
  type RaymarchedField3DOptions
} from './raymarched-field.js';

export interface RaymarchedBicomplexJulia3DOptions
  extends Omit<RaymarchedField3DOptions, 'style'> {
  /** Presentation-only color palette. Default `classic` preserves the original rendering. */
  palette?: FractalPaletteId;
}

function bicomplexJuliaStyle(paletteId: FractalPaletteId): RaymarchedFieldStyle3D {
  const colors = getFractalPalette(paletteId);
  return {
    shade({ record, normal, rayDirection, stepFraction, iterationLimit }) {
      const factorMix = smoothstep(-0.78, 0.78, record.z);
      const factorPalette = mix(
        vec3(...colors.productFirst),
        vec3(...colors.productSecond),
        factorMix
      );
      const dwell = smoothstep(0.08, 0.92, record.y.div(iterationLimit));
      const palette = mix(
        factorPalette.mul(0.58),
        factorPalette.add(vec3(0.24, 0.12, 0.2)),
        dwell
      );
      const diffuse = max(dot(normal, vec3(0.52, 0.74, 0.42).normalize()), 0);
      const viewFacing = max(dot(normal, rayDirection.negate()), 0);
      const rim = float(1).sub(viewFacing).pow(2.2);
      const traceOcclusion = float(1).sub(stepFraction.mul(0.4));
      const seam = float(1).sub(record.z.abs()).mul(0.22);
      return palette
        .mul(float(0.16).add(diffuse.mul(0.84)))
        .mul(traceOcclusion)
        .add(vec3(...colors.productRim).mul(rim))
        .add(vec3(...colors.seam).mul(seam));
    }
  };
}

/** Bicomplex product specialization of the generic R4 field ray marcher. */
export class RaymarchedBicomplexJulia3D extends RaymarchedField3D<
  BicomplexJuliaEvaluation,
  BicomplexJuliaField
> {
  readonly palette: FractalPaletteId;

  constructor(
    field: BicomplexJuliaField,
    slice: HyperplaneSlice4,
    options: RaymarchedBicomplexJulia3DOptions = {}
  ) {
    const { palette = 'classic', ...renderOptions } = options;
    super(new BicomplexJuliaNode4(field), slice, {
      ...renderOptions,
      maxSteps: renderOptions.maxSteps ?? 144,
      style: bicomplexJuliaStyle(palette)
    });
    this.palette = palette;
  }
}
