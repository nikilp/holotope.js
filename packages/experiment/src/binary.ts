/**
 * Float64 buffers carried through JSON without passing through JSON numbers.
 *
 * A snapshot exists so a run can be reproduced bitwise, and JSON text cannot
 * carry that promise: `-0` serializes as `0`, denormals lose their exact bit
 * pattern, and the shortest round-trip representation of a double is only
 * guaranteed to survive `parse(stringify(x))` for values a parser already
 * agrees on. Encoding the raw little-endian bytes to base64 and referencing
 * them by index sidesteps the question entirely — the same split glTF uses
 * for vertex data, and for the same reason.
 */

const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Reverse table; -1 marks a byte that is not a base64 digit. */
const VALUES = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let index = 0; index < ALPHABET.length; index++) {
    table[ALPHABET.charCodeAt(index)] = index;
  }
  return table;
})();

/**
 * Encodes finite Float64 values as little-endian base64.
 *
 * Little-endian is stated rather than inherited: `DataView` is explicit about
 * byte order, so the encoding does not depend on the host's.
 *
 * @param values - Values to encode, in order.
 * @returns Base64 text of `values.length * 8` bytes.
 *
 * @example
 * Signed zero survives, which JSON cannot promise:
 * ```ts
 * const encoded = encodeFloat64BufferV0([-0]);
 * const [restored] = decodeFloat64BufferV0(encoded);
 * Object.is(restored, -0); // true
 * ```
 */
export function encodeFloat64BufferV0(values: ArrayLike<number>): string {
  const bytes = new Uint8Array(values.length * 8);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index++) {
    view.setFloat64(index * 8, values[index]!, true);
  }

  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!;
    const b = index + 1 < bytes.length ? bytes[index + 1]! : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2]! : 0;
    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 3) << 4) | (b >> 4)];
    out += index + 1 < bytes.length ? ALPHABET[((b & 15) << 2) | (c >> 6)] : '=';
    out += index + 2 < bytes.length ? ALPHABET[c & 63] : '=';
  }
  return out;
}

/**
 * Decodes little-endian base64 back into Float64 values.
 *
 * @param encoded - Base64 text whose byte length is a multiple of eight.
 * @returns The decoded values.
 * @throws When the text is not base64, or does not decode to whole doubles.
 */
export function decodeFloat64BufferV0(encoded: string): Float64Array {
  if (typeof encoded !== 'string') {
    throw new TypeError('decodeFloat64BufferV0: expected base64 text');
  }
  let length = encoded.length;
  if (length % 4 !== 0) {
    throw new Error('decodeFloat64BufferV0: base64 length must be a multiple of 4');
  }
  let padding = 0;
  if (length > 0 && encoded[length - 1] === '=') padding++;
  if (length > 1 && encoded[length - 2] === '=') padding++;

  const bytes = new Uint8Array((length / 4) * 3 - padding);
  let out = 0;
  for (let index = 0; index < length; index += 4) {
    const digits = [0, 0, 0, 0];
    for (let position = 0; position < 4; position++) {
      const character = encoded.charCodeAt(index + position);
      if (encoded[index + position] === '=') continue;
      const value = character < 128 ? VALUES[character]! : -1;
      if (value < 0) {
        throw new Error('decodeFloat64BufferV0: text is not base64');
      }
      digits[position] = value;
    }
    if (out < bytes.length) bytes[out++] = (digits[0]! << 2) | (digits[1]! >> 4);
    if (out < bytes.length) bytes[out++] = ((digits[1]! & 15) << 4) | (digits[2]! >> 2);
    if (out < bytes.length) bytes[out++] = ((digits[2]! & 3) << 6) | digits[3]!;
  }

  if (bytes.length % 8 !== 0) {
    throw new Error('decodeFloat64BufferV0: payload is not whole Float64 values');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = new Float64Array(bytes.length / 8);
  for (let index = 0; index < values.length; index++) {
    values[index] = view.getFloat64(index * 8, true);
  }
  return values;
}
