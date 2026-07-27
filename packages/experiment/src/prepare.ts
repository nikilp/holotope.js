import {
  canonicalizeExperimentJsonV0
} from './json.js';
import {
  validateExperimentDocumentV0,
  type ValidateExperimentDocumentV0Options
} from './validation.js';
import type {
  ExperimentDocumentV0,
  ExperimentFailure,
  ExperimentJsonValue,
  ExperimentResult,
  PreparedExperimentDocumentV0
} from './types.js';

/**
 * Validates, canonicalizes, hashes, copies, and deeply freezes a document.
 *
 * SHA-256 uses the standard Web Crypto API and is therefore asynchronous in
 * both browsers and Node. Validation remains an independent synchronous
 * operation.
 */
export async function prepareExperimentDocumentV0(
  value: unknown,
  options: ValidateExperimentDocumentV0Options = {}
): Promise<ExperimentResult<PreparedExperimentDocumentV0>> {
  const report = validateExperimentDocumentV0(value, options);
  if (!report.valid) {
    return {
      ok: false,
      failures: report.failures
    };
  }

  let canonicalJson: string;
  try {
    canonicalJson = canonicalizeExperimentJsonV0(
      value as ExperimentJsonValue
    );
  } catch (error) {
    return refused({
      code: 'canonicalization-failed',
      message: error instanceof Error ? error.message : String(error)
    });
  }

  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    return refused({
      code: 'crypto-unavailable',
      message:
        'prepareExperimentDocumentV0 requires the standard Web Crypto API'
    });
  }
  let digest: ArrayBuffer;
  try {
    digest = await subtle.digest(
      'SHA-256',
      new TextEncoder().encode(canonicalJson)
    );
  } catch (error) {
    return refused({
      code: 'canonicalization-failed',
      message: error instanceof Error ? error.message : String(error)
    });
  }

  const cloned = JSON.parse(canonicalJson) as ExperimentDocumentV0;
  deepFreeze(cloned);
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return {
    ok: true,
    value: Object.freeze({
      document: cloned,
      canonicalJson,
      documentHash: `sha256:${hash}`,
      compileOrder: Object.freeze([...report.compileOrder]),
      warnings: Object.freeze([...report.warnings])
    })
  };
}

function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return;
  }
  for (const component of Object.values(value)) deepFreeze(component);
  Object.freeze(value);
}

function refused(
  failure: ExperimentFailure
): ExperimentResult<never> {
  return {
    ok: false,
    failures: Object.freeze([Object.freeze(failure)])
  };
}
