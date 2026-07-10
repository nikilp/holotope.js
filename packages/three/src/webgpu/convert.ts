import { Matrix4, Vector4 } from 'three';
import { rotationMatrix, type HyperplaneSlice4, type TransformN } from '@holotope/core';

/**
 * Writes a 4D rigid transform into GPU-native types: the SO(4) rotation is
 * a linear map on R^4, so it fits a mat4 exactly (no homogeneous trick
 * needed — this is the happy coincidence of the n=4 case), and the
 * translation is a plain vec4.
 *
 * MatN stores row-major; `Matrix4.set` takes row-major arguments, so the
 * data passes through unchanged into three's column-major storage.
 */
export function transformToGpuUniforms(
  transform: TransformN,
  outRotation: Matrix4,
  outTranslation: Vector4
): void {
  if (transform.dim !== 4) {
    throw new Error(`transformToGpuUniforms: requires a 4D transform, got dim ${transform.dim}`);
  }
  const d = rotationMatrix(transform.rotation).data;
  outRotation.set(
    d[0]!, d[1]!, d[2]!, d[3]!,
    d[4]!, d[5]!, d[6]!, d[7]!,
    d[8]!, d[9]!, d[10]!, d[11]!,
    d[12]!, d[13]!, d[14]!, d[15]!
  );
  const t = transform.position.data;
  outTranslation.set(t[0]!, t[1]!, t[2]!, t[3]!);
}

/**
 * Writes a hyperplane's full orthonormal frame into one mat4: rows 0–2 are
 * the in-plane display basis, row 3 is the normal. `frame * p` then yields
 * the three slice-frame coordinates in xyz and the ⟨normal, p⟩ dot product
 * in w — one matrix multiply gives both the display position and the
 * signed distance (after subtracting the offset).
 */
export function sliceToGpuUniforms(slice: HyperplaneSlice4, outFrame: Matrix4): void {
  const [b0, b1, b2] = slice.basis;
  const n = slice.normal.data;
  outFrame.set(
    b0[0]!, b0[1]!, b0[2]!, b0[3]!,
    b1[0]!, b1[1]!, b1[2]!, b1[3]!,
    b2[0]!, b2[1]!, b2[2]!, b2[3]!,
    n[0]!, n[1]!, n[2]!, n[3]!
  );
}
