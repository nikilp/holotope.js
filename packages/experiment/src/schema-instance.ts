/**
 * Validates a JSON value against one declared `ExperimentJsonSchemaV0`.
 *
 * The document schema subset is deliberately small and closed: no `$ref`, no
 * remote references, no dynamic composition. That is what makes this checker
 * total and deterministic — it can refuse without fetching anything and
 * without unbounded recursion through indirection.
 *
 * Failures are pointer-addressed relative to the validated value, so a caller
 * can say which argument was wrong rather than that some argument was.
 */
import type {
  ExperimentFailure,
  ExperimentJsonSchemaV0,
  ExperimentJsonValue,
  ExperimentResult
} from './types.js';

/**
 * Checks one value against one schema.
 *
 * @param value - The instance to validate.
 * @param schema - A declared schema from the closed document subset.
 * @param pointer - JSON Pointer prefix for reported failures.
 * @returns The value on success, or every failure found.
 *
 * @example
 * ```ts
 * const schema = {
 *   type: 'object',
 *   properties: { steps: { type: 'integer', minimum: 1 } },
 *   required: ['steps'],
 *   additionalProperties: false
 * } as const;
 *
 * validateExperimentJsonAgainstSchemaV0({ steps: 4 }, schema).ok; // true
 * validateExperimentJsonAgainstSchemaV0({ steps: 0 }, schema).ok; // false
 * ```
 */
export function validateExperimentJsonAgainstSchemaV0(
  value: ExperimentJsonValue,
  schema: ExperimentJsonSchemaV0,
  pointer = ''
): ExperimentResult<ExperimentJsonValue> {
  const failures: ExperimentFailure[] = [];
  check(value, schema, pointer, failures);
  return failures.length === 0
    ? { ok: true, value }
    : { ok: false, failures: Object.freeze(failures) };
}

function check(
  value: ExperimentJsonValue,
  schema: ExperimentJsonSchemaV0,
  pointer: string,
  failures: ExperimentFailure[]
): void {
  if (!matchesType(value, schema.type)) {
    failures.push(fail(
      'invalid-type',
      `expected ${schema.type}`,
      pointer,
      { expected: schema.type, received: describe(value) }
    ));
    // Every further rule assumes the type held, so stop here rather than
    // reporting consequences of a mismatch already reported.
    return;
  }

  if (schema.enum !== undefined) {
    const admitted = schema.enum.some((option) => Object.is(option, value));
    if (!admitted) {
      failures.push(fail(
        'invalid-value',
        'value is not one of the admitted options',
        pointer,
        { received: describe(value) }
      ));
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      failures.push(fail(
        'out-of-range', `value is below the minimum ${schema.minimum}`, pointer,
        { value, minimum: schema.minimum }
      ));
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      failures.push(fail(
        'out-of-range', `value is above the maximum ${schema.maximum}`, pointer,
        { value, maximum: schema.maximum }
      ));
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      failures.push(fail(
        'invalid-value',
        `expected at least ${schema.minItems} items`, pointer,
        { length: value.length, minItems: schema.minItems }
      ));
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      failures.push(fail(
        'invalid-value',
        `expected at most ${schema.maxItems} items`, pointer,
        { length: value.length, maxItems: schema.maxItems }
      ));
    }
    if (schema.items !== undefined) {
      for (let index = 0; index < value.length; index++) {
        check(value[index]!, schema.items, `${pointer}/${index}`, failures);
      }
    }
  }

  if (isPlainObject(value)) {
    for (const name of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, name)) {
        failures.push(fail(
          'missing-field', `required property ${JSON.stringify(name)} is absent`,
          `${pointer}/${escapePointer(name)}`, { property: name }
        ));
      }
    }
    const properties = schema.properties ?? {};
    for (const [name, child] of Object.entries(value)) {
      const declared = properties[name];
      if (declared === undefined) {
        if (schema.additionalProperties === false) {
          failures.push(fail(
            'unknown-field',
            `property ${JSON.stringify(name)} is not declared`,
            `${pointer}/${escapePointer(name)}`, { property: name }
          ));
        }
        continue;
      }
      check(child, declared, `${pointer}/${escapePointer(name)}`, failures);
    }
  }
}

function matchesType(
  value: ExperimentJsonValue,
  type: ExperimentJsonSchemaV0['type']
): boolean {
  switch (type) {
    // JSON has one number type; `integer` is a constraint on it, and a
    // non-finite value is not representable in JSON at all.
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isPlainObject(value);
  }
}

const isPlainObject = (
  value: ExperimentJsonValue
): value is { readonly [key: string]: ExperimentJsonValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const describe = (value: ExperimentJsonValue): string =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

const escapePointer = (value: string): string =>
  value.replace(/~/g, '~0').replace(/\//g, '~1');

function fail(
  code: ExperimentFailure['code'],
  message: string,
  pointer: string,
  detail?: ExperimentFailure['detail']
): ExperimentFailure {
  return Object.freeze({
    code,
    message,
    pointer,
    ...(detail === undefined ? {} : { detail: Object.freeze({ ...detail }) })
  });
}
