import { describe, expect, it } from 'vitest';
import {
  decodeFloat64BufferV0,
  encodeFloat64BufferV0
} from '../src/binary.js';

/** The oracle: what DataView actually writes, byte for byte. */
const referenceBytes = (values: readonly number[]): Uint8Array => {
  const bytes = new Uint8Array(values.length * 8);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat64(index * 8, value, true));
  return bytes;
};

const decodeToBytes = (encoded: string): Uint8Array => {
  const values = decodeFloat64BufferV0(encoded);
  return new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
};

describe('Float64 buffer codec', () => {
  it('agrees with DataView byte for byte', () => {
    const values = [0, -0, 1, -1, 0.1, 1e308, 5e-324, Math.PI];
    expect(Array.from(decodeToBytes(encodeFloat64BufferV0(values))))
      .toEqual(Array.from(referenceBytes(values)));
  });

  it('preserves what JSON text cannot', () => {
    // Each of these survives the codec and would not survive JSON numbers.
    const awkward = [
      -0,               // JSON.stringify(-0) === '0'
      5e-324,           // smallest denormal
      2.2250738585072011e-308,
      Number.MAX_VALUE,
      Number.MIN_VALUE,
      0.1 + 0.2         // exact double, not 0.3
    ];
    const restored = decodeFloat64BufferV0(encodeFloat64BufferV0(awkward));
    expect(restored.length).toBe(awkward.length);
    for (let index = 0; index < awkward.length; index++) {
      expect(Object.is(restored[index], awkward[index]!)).toBe(true);
    }
    expect(Object.is(restored[0], -0)).toBe(true);
    expect(JSON.parse(JSON.stringify(-0))).toBe(0); // the contrast
  });

  it('round-trips every length, including empty', () => {
    for (let count = 0; count <= 9; count++) {
      const values = Array.from({ length: count }, (_, index) => index + 0.5);
      const restored = decodeFloat64BufferV0(encodeFloat64BufferV0(values));
      expect(Array.from(restored)).toEqual(values);
    }
  });

  it('refuses text that is not a whole Float64 payload', () => {
    expect(() => decodeFloat64BufferV0('abc')).toThrow(/multiple of 4/);
    expect(() => decodeFloat64BufferV0('!!!!')).toThrow(/not base64/);
    // Four base64 characters decode to three bytes, which is not a double.
    expect(() => decodeFloat64BufferV0('AAAA')).toThrow(/whole Float64/);
  });
});
