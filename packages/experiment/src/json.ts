import type {
  ExperimentFailure,
  ExperimentJsonValue,
  ExperimentResult,
  ExperimentValidationLimitsV0
} from './types.js';

/** Conservative default budgets for untrusted raw experiment JSON. */
export const DEFAULT_EXPERIMENT_VALIDATION_LIMITS_V0:
Readonly<ExperimentValidationLimitsV0> = Object.freeze({
  maxInputBytes: 4 * 1024 * 1024,
  maxDepth: 64,
  maxEntries: 100_000,
  maxStringLength: 1_000_000
});

/**
 * Parses bounded JSON while retaining evidence native `JSON.parse()` loses.
 *
 * Duplicate object keys are compared after JSON escape decoding, so `"a"`
 * and `"\u0061"` are the same key. The function executes no reviver and
 * rejects prototype-sensitive keys before returning a value.
  *
 * @example
 * Duplicate keys are the reason to parse rather than accept an object: by the
 * time `JSON.parse` has run, the loser is gone and no later check can see it.
 * ```ts
 * const parsed = parseExperimentJsonV0('{"a": 1, "a": 2}');
 * parsed.ok; // false
 * if (!parsed.ok) {
 *   parsed.failures[0]?.code; // 'duplicate-key'
 * }
 * ```
 *
 * @example
 * Budgets bound the work before any structure is built, which is what makes
 * the intake safe for text that crossed a trust boundary:
 * ```ts
 * const parsed = parseExperimentJsonV0('[[[[[[1]]]]]]', { maxDepth: 3 });
 * parsed.ok; // false
 * if (!parsed.ok) {
 *   parsed.failures[0]?.code; // 'resource-limit'
 * }
 * ```
 */
export function parseExperimentJsonV0(
  source: string,
  limits: Partial<ExperimentValidationLimitsV0> = {}
): ExperimentResult<unknown> {
  if (typeof source !== 'string') {
    return refused(failure(
      'invalid-type',
      'parseExperimentJsonV0: source must be a string'
    ));
  }
  const effective = validationLimitsV0(limits);
  const byteLength = new TextEncoder().encode(source).length;
  if (byteLength > effective.maxInputBytes) {
    return refused(failure(
      'resource-limit',
      `experiment JSON uses ${byteLength} bytes; limit is ${effective.maxInputBytes}`,
      '',
      { received: byteLength, limit: effective.maxInputBytes }
    ));
  }
  const scanner = new JsonEvidenceScanner(source, effective);
  const scanned = scanner.scan();
  if (!scanned.ok) return scanned;
  try {
    return { ok: true, value: JSON.parse(source) as unknown };
  } catch (error) {
    return refused(failure(
      'malformed-json',
      error instanceof Error ? error.message : String(error),
      '',
      { offset: scanner.offset }
    ));
  }
}

/**
 * Produces RFC-8785-compatible canonical JSON for an admitted JSON value.
 *
 * Object keys use ECMAScript's UTF-16 lexical order and numbers use
 * ECMAScript serialization. Non-finite numbers, sparse arrays, `undefined`,
 * non-plain objects, and prototype-sensitive keys are refused rather than
 * silently changed.
 */
export function canonicalizeExperimentJsonV0(
  value: ExperimentJsonValue
): string {
  return canonicalize(value, '');
}

/** Resolves authored validation budgets without mutating caller input. */
export function validationLimitsV0(
  partial: Partial<ExperimentValidationLimitsV0> = {}
): ExperimentValidationLimitsV0 {
  const resolved = {
    ...DEFAULT_EXPERIMENT_VALIDATION_LIMITS_V0,
    ...partial
  };
  for (const key of Object.keys(resolved) as
    (keyof ExperimentValidationLimitsV0)[]) {
    const value = resolved[key];
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(
        `validationLimitsV0: ${key} must be a positive safe integer`
      );
    }
  }
  return resolved;
}

function canonicalize(value: ExperimentJsonValue, pointer: string): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(
        `canonicalizeExperimentJsonV0: non-finite number at ${pointer || '/'}`
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (Object.getOwnPropertySymbols(value).length > 0 ||
      Object.keys(value).some((key) =>
        !isCanonicalArrayIndex(key, value.length)
      )) {
      throw new Error(
        `canonicalizeExperimentJsonV0: non-JSON array properties at ${pointer || '/'}`
      );
    }
    const parts: string[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(
        value,
        String(index)
      );
      if (descriptor === undefined) {
        throw new Error(
          `canonicalizeExperimentJsonV0: sparse array at ${pointer || '/'}`
        );
      }
      if (descriptor.get !== undefined || descriptor.set !== undefined) {
        throw new Error(
          `canonicalizeExperimentJsonV0: accessor at ${pointer}/${index}`
        );
      }
      parts.push(canonicalize(
        descriptor.value as ExperimentJsonValue,
        `${pointer}/${index}`
      ));
    }
    return `[${parts.join(',')}]`;
  }
  if (!isPlainObject(value)) {
    throw new Error(
      `canonicalizeExperimentJsonV0: non-plain object at ${pointer || '/'}`
    );
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(
      `canonicalizeExperimentJsonV0: symbol key at ${pointer || '/'}`
    );
  }
  const parts: string[] = [];
  for (const key of Object.keys(value).sort()) {
    requireSafeKey(key, pointer);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined) {
      throw new Error(
        `canonicalizeExperimentJsonV0: accessor at ${childPointer(pointer, key)}`
      );
    }
    const component = descriptor.value as ExperimentJsonValue | undefined;
    if (component === undefined) {
      throw new Error(
        `canonicalizeExperimentJsonV0: undefined at ${childPointer(pointer, key)}`
      );
    }
    parts.push(
      `${JSON.stringify(key)}:${canonicalize(
        component,
        childPointer(pointer, key)
      )}`
    );
  }
  return `{${parts.join(',')}}`;
}

class JsonEvidenceScanner {
  private index = 0;
  private entries = 0;

  constructor(
    private readonly source: string,
    private readonly limits: ExperimentValidationLimitsV0
  ) {}

  get offset(): number {
    return this.index;
  }

  scan(): ExperimentResult<true> {
    try {
      this.skipWhitespace();
      this.scanValue('', 0);
      this.skipWhitespace();
      if (this.index !== this.source.length) {
        this.fail('unexpected trailing content', '');
      }
      return { ok: true, value: true };
    } catch (error) {
      if (error instanceof ScanFailure) {
        return refused(error.evidence);
      }
      throw error;
    }
  }

  private scanValue(pointer: string, depth: number): void {
    if (depth > this.limits.maxDepth) {
      this.resourceFailure(
        `JSON nesting exceeds ${this.limits.maxDepth}`,
        pointer,
        this.limits.maxDepth
      );
    }
    this.skipWhitespace();
    const next = this.source[this.index];
    if (next === '{') {
      this.scanObject(pointer, depth);
      return;
    }
    if (next === '[') {
      this.scanArray(pointer, depth);
      return;
    }
    if (next === '"') {
      this.scanString(pointer);
      return;
    }
    if (next === 't') {
      this.scanLiteral('true', pointer);
      return;
    }
    if (next === 'f') {
      this.scanLiteral('false', pointer);
      return;
    }
    if (next === 'n') {
      this.scanLiteral('null', pointer);
      return;
    }
    if (next === '-' || (next !== undefined && next >= '0' && next <= '9')) {
      this.scanNumber(pointer);
      return;
    }
    this.fail('expected a JSON value', pointer);
  }

  private scanObject(pointer: string, depth: number): void {
    this.index++;
    this.skipWhitespace();
    const keys = new Set<string>();
    if (this.source[this.index] === '}') {
      this.index++;
      return;
    }
    while (true) {
      if (this.source[this.index] !== '"') {
        this.fail('expected an object key', pointer);
      }
      const key = this.scanString(pointer, false);
      const keyPointer = childPointer(pointer, key);
      if (key.length > this.limits.maxStringLength) {
        this.resourceFailure(
          `string length exceeds ${this.limits.maxStringLength}`,
          keyPointer,
          this.limits.maxStringLength
        );
      }
      if (keys.has(key)) {
        throw new ScanFailure(failure(
          'duplicate-key',
          `duplicate object key ${JSON.stringify(key)}`,
          keyPointer,
          { offset: this.index }
        ));
      }
      keys.add(key);
      if (isUnsafeKey(key)) {
        throw new ScanFailure(failure(
          'unsafe-key',
          `prototype-sensitive key ${JSON.stringify(key)} is not admitted`,
          keyPointer,
          { offset: this.index }
        ));
      }
      this.countEntry(keyPointer);
      this.skipWhitespace();
      if (this.source[this.index] !== ':') {
        this.fail('expected ":" after object key', keyPointer);
      }
      this.index++;
      this.scanValue(keyPointer, depth + 1);
      this.skipWhitespace();
      const separator = this.source[this.index];
      if (separator === '}') {
        this.index++;
        return;
      }
      if (separator !== ',') {
        this.fail('expected "," or "}" in object', pointer);
      }
      this.index++;
      this.skipWhitespace();
    }
  }

  private scanArray(pointer: string, depth: number): void {
    this.index++;
    this.skipWhitespace();
    if (this.source[this.index] === ']') {
      this.index++;
      return;
    }
    let element = 0;
    while (true) {
      const elementPointer = `${pointer}/${element}`;
      this.countEntry(elementPointer);
      this.scanValue(elementPointer, depth + 1);
      element++;
      this.skipWhitespace();
      const separator = this.source[this.index];
      if (separator === ']') {
        this.index++;
        return;
      }
      if (separator !== ',') {
        this.fail('expected "," or "]" in array', pointer);
      }
      this.index++;
      this.skipWhitespace();
    }
  }

  private scanString(
    pointer: string,
    enforceLimit = true
  ): string {
    const start = this.index;
    this.index++;
    let escaped = false;
    while (this.index < this.source.length) {
      const code = this.source.charCodeAt(this.index);
      const character = this.source[this.index]!;
      if (!escaped && character === '"') {
        this.index++;
        const raw = this.source.slice(start, this.index);
        let decoded: string;
        try {
          decoded = JSON.parse(raw) as string;
        } catch (error) {
          this.fail(
            error instanceof Error ? error.message : 'invalid JSON string',
            pointer
          );
        }
        if (enforceLimit &&
          decoded.length > this.limits.maxStringLength) {
          this.resourceFailure(
            `string length exceeds ${this.limits.maxStringLength}`,
            pointer,
            this.limits.maxStringLength
          );
        }
        return decoded;
      }
      if (!escaped && code < 0x20) {
        this.fail('unescaped control character in string', pointer);
      }
      if (!escaped && character === '\\') {
        escaped = true;
      } else {
        escaped = false;
      }
      this.index++;
    }
    this.fail('unterminated JSON string', pointer);
  }

  private scanNumber(pointer: string): void {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/
      .exec(this.source.slice(this.index));
    if (match === null) this.fail('invalid JSON number', pointer);
    this.index += match[0].length;
    const next = this.source[this.index];
    if (next !== undefined &&
      !isWhitespace(next) &&
      next !== ',' &&
      next !== ']' &&
      next !== '}') {
      this.fail('invalid character after JSON number', pointer);
    }
  }

  private scanLiteral(literal: string, pointer: string): void {
    if (!this.source.startsWith(literal, this.index)) {
      this.fail(`expected ${literal}`, pointer);
    }
    this.index += literal.length;
  }

  private skipWhitespace(): void {
    while (isWhitespace(this.source[this.index])) this.index++;
  }

  private countEntry(pointer: string): void {
    this.entries++;
    if (this.entries > this.limits.maxEntries) {
      this.resourceFailure(
        `JSON entries exceed ${this.limits.maxEntries}`,
        pointer,
        this.limits.maxEntries
      );
    }
  }

  private resourceFailure(
    message: string,
    pointer: string,
    limit: number
  ): never {
    throw new ScanFailure(failure(
      'resource-limit',
      message,
      pointer,
      { offset: this.index, limit }
    ));
  }

  private fail(message: string, pointer: string): never {
    throw new ScanFailure(failure(
      'malformed-json',
      `${message} at character ${this.index}`,
      pointer,
      { offset: this.index }
    ));
  }
}

class ScanFailure extends Error {
  constructor(readonly evidence: ExperimentFailure) {
    super(evidence.message);
  }
}

function isWhitespace(value: string | undefined): boolean {
  return value === ' ' || value === '\n' ||
    value === '\r' || value === '\t';
}

function isPlainObject(
  value: unknown
): value is Record<string, ExperimentJsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isCanonicalArrayIndex(key: string, length: number): boolean {
  if (!/^(0|[1-9][0-9]*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}

function isUnsafeKey(key: string): boolean {
  return key === '__proto__' ||
    key === 'prototype' ||
    key === 'constructor';
}

function requireSafeKey(key: string, pointer: string): void {
  if (isUnsafeKey(key)) {
    throw new Error(
      `canonicalizeExperimentJsonV0: unsafe key at ${childPointer(pointer, key)}`
    );
  }
}

function childPointer(pointer: string, key: string): string {
  return `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function failure(
  code: ExperimentFailure['code'],
  message: string,
  pointer?: string,
  detail?: ExperimentFailure['detail']
): ExperimentFailure {
  return {
    code,
    message,
    ...(pointer !== undefined ? { pointer } : {}),
    ...(detail !== undefined ? { detail } : {})
  };
}

function refused(
  ...failures: ExperimentFailure[]
): ExperimentResult<never> {
  return {
    ok: false,
    failures: Object.freeze(failures)
  };
}
