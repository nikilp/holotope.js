import { describe, expect, it } from 'vitest';
import {
  validateExperimentJsonAgainstSchemaV0,
  type ExperimentJsonSchemaV0
} from '../src/index.js';

const schema = (s: unknown): ExperimentJsonSchemaV0 => s as ExperimentJsonSchemaV0;

describe('declared-schema instance validation', () => {
  it('checks each type the subset admits', () => {
    const cases: [unknown, string, boolean][] = [
      [1, 'number', true], [Number.NaN, 'number', false],
      [1, 'integer', true], [1.5, 'integer', false],
      ['a', 'string', true], [1, 'string', false],
      [true, 'boolean', true], [0, 'boolean', false],
      [[], 'array', true], [{}, 'array', false],
      [{}, 'object', true], [[], 'object', false],
      [null, 'object', false]
    ];
    for (const [value, type, expected] of cases) {
      const result = validateExperimentJsonAgainstSchemaV0(
        value as never, schema({ type })
      );
      expect(result.ok, `${JSON.stringify(value)} as ${type}`).toBe(expected);
    }
  });

  it('enforces bounds, enums, and item counts', () => {
    const bounded = schema({ type: 'number', minimum: 1, maximum: 5 });
    expect(validateExperimentJsonAgainstSchemaV0(3, bounded).ok).toBe(true);
    expect(validateExperimentJsonAgainstSchemaV0(0, bounded)).toMatchObject({
      ok: false, failures: [{ code: 'out-of-range' }]
    });
    expect(validateExperimentJsonAgainstSchemaV0(6, bounded)).toMatchObject({
      ok: false, failures: [{ code: 'out-of-range' }]
    });

    const choice = schema({ type: 'string', enum: ['a', 'b'] });
    expect(validateExperimentJsonAgainstSchemaV0('a', choice).ok).toBe(true);
    expect(validateExperimentJsonAgainstSchemaV0('c', choice)).toMatchObject({
      ok: false, failures: [{ code: 'invalid-value' }]
    });

    const triple = schema({
      type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3
    });
    expect(validateExperimentJsonAgainstSchemaV0([1, 2, 3], triple).ok).toBe(true);
    expect(validateExperimentJsonAgainstSchemaV0([1, 2], triple).ok).toBe(false);
    expect(validateExperimentJsonAgainstSchemaV0([1, 2, 3, 4], triple).ok).toBe(false);
  });

  it('addresses failures by pointer into the value', () => {
    const s = schema({
      type: 'object',
      properties: {
        point: { type: 'array', items: { type: 'number' }, minItems: 3 },
        steps: { type: 'integer', minimum: 1 }
      },
      required: ['point', 'steps'],
      additionalProperties: false
    });

    const nested = validateExperimentJsonAgainstSchemaV0(
      { point: [0, 'x', 0], steps: 2 }, s, '/arguments'
    );
    expect(nested).toMatchObject({
      ok: false,
      failures: [{ code: 'invalid-type', pointer: '/arguments/point/1' }]
    });

    const missing = validateExperimentJsonAgainstSchemaV0(
      { point: [0, 0, 0] }, s, '/arguments'
    );
    expect(missing).toMatchObject({
      ok: false,
      failures: [{ code: 'missing-field', pointer: '/arguments/steps' }]
    });

    const extra = validateExperimentJsonAgainstSchemaV0(
      { point: [0, 0, 0], steps: 1, nope: 1 }, s, '/arguments'
    );
    expect(extra).toMatchObject({
      ok: false,
      failures: [{ code: 'unknown-field', pointer: '/arguments/nope' }]
    });
  });

  it('reports every failure rather than only the first', () => {
    const s = schema({
      type: 'object',
      properties: { a: { type: 'integer' }, b: { type: 'integer' } },
      required: ['a', 'b']
    });
    const result = validateExperimentJsonAgainstSchemaV0({ a: 'x', b: 'y' }, s);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures).toHaveLength(2);
  });

  it('escapes pointer segments that contain / or ~', () => {
    const s = schema({
      type: 'object',
      properties: { 'a/b': { type: 'integer' } },
      required: ['a/b']
    });
    expect(validateExperimentJsonAgainstSchemaV0({}, s)).toMatchObject({
      ok: false, failures: [{ pointer: '/a~1b' }]
    });
  });
});
