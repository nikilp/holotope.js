import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canonicalizeExperimentJsonV0,
  parseExperimentJsonV0,
  prepareExperimentDocumentV0,
  validateExperimentDocumentV0,
  type ExperimentDocumentV0
} from '../src/index.js';

function bridgeDocument(): ExperimentDocumentV0 {
  return {
    schema: 'holotope.experiment/0',
    title: 'Tesseract dimension bridge',
    ambientDim: 4,
    sources: {
      tesseract: {
        kind: 'core.source.hypercube',
        dim: 4,
        size: 2,
        tetrahedralize: true
      }
    },
    models: {
      tumble: {
        kind: 'physics.model.rigid4',
        source: 'tesseract',
        gravity: [0, 0, 0, 0],
        initialAngularMomentum: [0, 0, 0.9, 0, 0, 0.35],
        fixedStep: 1 / 120,
        substeps: 2
      }
    },
    representations: {
      perspective: {
        kind: 'core.representation.perspective',
        source: 'tesseract',
        fromDim: 4,
        viewDistance: 5.4,
        epsilon: 1e-6,
        transform: { fromModel: 'tumble' },
        product: 'both'
      },
      section: {
        kind: 'core.representation.section4',
        source: 'tesseract',
        normal: [0, 0, 0, 1],
        offset: 0.12,
        frame: 'canonical',
        transform: { fromModel: 'tumble' }
      }
    },
    parameters: [
      {
        id: 'sliceOffset',
        label: 'Section offset along w',
        value: {
          type: 'number',
          default: 0.12,
          min: -1,
          max: 1,
          step: 0.005
        },
        dimension: 'length',
        frame: { space: 'ambient', dim: 4 },
        unit: 'source-units',
        target: {
          kind: 'representation-field',
          ref: 'section',
          field: 'offset'
        }
      }
    ],
    actions: [
      {
        id: 'advance',
        title: 'Advance the tumble',
        description: 'Advance by a bounded whole number of fixed steps.',
        inputSchema: {
          type: 'object',
          properties: {
            steps: {
              type: 'integer',
              minimum: 1,
              maximum: 600
            }
          },
          required: ['steps'],
          additionalProperties: false
        },
        outputSchema: {
          type: 'object',
          properties: {
            step: { type: 'integer' }
          },
          required: ['step'],
          additionalProperties: false
        },
        readOnly: false,
        destructive: false,
        idempotent: false,
        deterministic: true,
        supportsPreview: false,
        budget: {
          maxSteps: 600,
          maxMillis: 250
        }
      },
      {
        id: 'probe',
        title: 'Probe a represented point',
        description: 'Return source evidence without inventing an inverse.',
        inputSchema: {
          type: 'object',
          properties: {
            representation: {
              type: 'string',
              enum: ['perspective', 'section']
            },
            point: {
              type: 'array',
              items: { type: 'number' },
              minItems: 3,
              maxItems: 3
            }
          },
          required: ['representation', 'point'],
          additionalProperties: false
        },
        outputSchema: {
          type: 'object',
          properties: {
            ambientPointStatus: {
              type: 'string',
              enum: ['exact', 'approximate', 'unavailable']
            }
          },
          required: ['ambientPointStatus']
        },
        readOnly: true,
        destructive: false,
        idempotent: true,
        deterministic: true,
        supportsPreview: false,
        budget: { maxMillis: 20 }
      }
    ],
    observations: [
      {
        id: 'angularMomentum',
        title: 'World angular momentum',
        outputSchema: {
          type: 'array',
          items: { type: 'number' },
          minItems: 6,
          maxItems: 6
        },
        dimension: 'angular-momentum',
        frame: { space: 'ambient', dim: 4 },
        unit: 'source-units^2/s',
        replayTolerance: 0,
        source: {
          kind: 'model-invariant',
          ref: 'tumble',
          quantity: 'angular-momentum'
        }
      },
      {
        id: 'sectionTriangles',
        title: 'Section triangle count',
        outputSchema: { type: 'integer' },
        dimension: 'dimensionless',
        frame: { space: 'representation', dim: 3 },
        unit: 'count',
        replayTolerance: 0,
        source: {
          kind: 'representation-count',
          ref: 'section',
          quantity: 'triangles'
        }
      },
      {
        id: 'perspectiveLineage',
        title: 'Perspective lineage',
        outputSchema: { type: 'object' },
        dimension: 'dimensionless',
        frame: { space: 'representation', dim: 3 },
        unit: 'none',
        replayTolerance: 0,
        source: {
          kind: 'lineage',
          ref: 'perspective'
        }
      }
    ],
    presentation: {
      panes: [
        {
          kind: 'three.pane.representation',
          id: 'leftPane',
          representation: 'perspective',
          title: 'Perspective R4 to R3',
          column: 0,
          palette: 'source-cell'
        },
        {
          kind: 'three.pane.representation',
          id: 'rightPane',
          representation: 'section',
          title: 'Exact section',
          column: 1,
          palette: 'source-cell'
        }
      ]
    },
    backends: [
      { backend: 'cpu', required: true },
      { backend: 'webgpu', required: false }
    ]
  };
}

function clone(value: ExperimentDocumentV0): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

describe('@holotope/experiment document intake', () => {
  it('accepts the complete R4 bridge descriptor with a stable dependency order', () => {
    const report = validateExperimentDocumentV0(bridgeDocument());

    expect(report).toEqual({
      valid: true,
      failures: [],
      warnings: [],
      compileOrder: [
        'tesseract',
        'tumble',
        'perspective',
        'section',
        'leftPane',
        'rightPane'
      ]
    });
  });

  it('keeps compile order independent of record insertion order', () => {
    const original = bridgeDocument();
    const reversed = {
      ...original,
      sources: Object.fromEntries(
        Object.entries(original.sources).reverse()
      ),
      models: Object.fromEntries(
        Object.entries(original.models ?? {}).reverse()
      ),
      representations: Object.fromEntries(
        Object.entries(original.representations).reverse()
      ),
      presentation: {
        panes: [...(original.presentation?.panes ?? [])].reverse()
      }
    };

    expect(
      validateExperimentDocumentV0(reversed).compileOrder
    ).toEqual(
      validateExperimentDocumentV0(original).compileOrder
    );
  });

  it('detects escaped duplicate and prototype-sensitive keys before JSON.parse loses evidence', () => {
    const duplicate = parseExperimentJsonV0(
      '{"schema":"holotope.experiment/0","a":1,"\\u0061":2}'
    );
    expect(duplicate).toMatchObject({
      ok: false,
      failures: [
        {
          code: 'duplicate-key',
          pointer: '/a'
        }
      ]
    });

    const unsafe = parseExperimentJsonV0(
      '{"schema":"holotope.experiment/0","__proto__":{}}'
    );
    expect(unsafe).toMatchObject({
      ok: false,
      failures: [
        {
          code: 'unsafe-key',
          pointer: '/__proto__'
        }
      ]
    });
  });

  it('returns bounded malformed-json and raw-input refusals', () => {
    expect(parseExperimentJsonV0('{"a":[1,]}')).toMatchObject({
      ok: false,
      failures: [{ code: 'malformed-json' }]
    });
    expect(parseExperimentJsonV0(
      '{"a":{"b":{"c":1}}}',
      { maxDepth: 2 }
    )).toMatchObject({
      ok: false,
      failures: [{ code: 'resource-limit', pointer: '/a/b/c' }]
    });
    expect(parseExperimentJsonV0(
      '{"long":"abcdef"}',
      { maxStringLength: 3 }
    )).toMatchObject({
      ok: false,
      failures: [{ code: 'resource-limit', pointer: '/long' }]
    });
  });
});

describe('@holotope/experiment semantic validation', () => {
  it('reports stable pointers for structural, reference, dimension, and target failures', () => {
    const cases: {
      mutate(document: Record<string, unknown>): void;
      code: string;
      pointer: string;
    }[] = [
      {
        mutate: (document) => {
          document.schema = 'holotope.experiment/99';
        },
        code: 'schema-version-unsupported',
        pointer: '/schema'
      },
      {
        mutate: (document) => {
          document.extra = true;
        },
        code: 'unknown-field',
        pointer: '/extra'
      },
      {
        mutate: (document) => {
          const sources = document.sources as Record<string, unknown>;
          sources['bad/id'] = sources.tesseract;
          delete sources.tesseract;
        },
        code: 'invalid-id',
        pointer: '/sources/bad~1id'
      },
      {
        mutate: (document) => {
          const sources = document.sources as Record<string, unknown>;
          (sources.tesseract as Record<string, unknown>).kind =
            'core.source.unknown';
        },
        code: 'unknown-kind',
        pointer: '/sources/tesseract/kind'
      },
      {
        mutate: (document) => {
          const sources = document.sources as Record<string, unknown>;
          (sources.tesseract as Record<string, unknown>).kindVersion = 2;
        },
        code: 'kind-version-mismatch',
        pointer: '/sources/tesseract/kindVersion'
      },
      {
        mutate: (document) => {
          const representations =
            document.representations as Record<string, unknown>;
          (representations.section as Record<string, unknown>).source =
            'missing';
        },
        code: 'missing-reference',
        pointer: '/representations/section/source'
      },
      {
        mutate: (document) => {
          const representations =
            document.representations as Record<string, unknown>;
          (representations.perspective as Record<string, unknown>).fromDim = 3;
        },
        code: 'dimension-mismatch',
        pointer: '/representations/perspective/fromDim'
      },
      {
        mutate: (document) => {
          const parameters = document.parameters as
            Record<string, unknown>[];
          (parameters[0]!.frame as Record<string, unknown>).dim = 3;
        },
        code: 'frame-mismatch',
        pointer: '/parameters/0/frame'
      },
      {
        mutate: (document) => {
          const parameters = document.parameters as
            Record<string, unknown>[];
          parameters[0]!.dimension = 'angle';
        },
        code: 'unit-mismatch',
        pointer: '/parameters/0/dimension'
      },
      {
        mutate: (document) => {
          const representations =
            document.representations as Record<string, unknown>;
          (representations.section as Record<string, unknown>).normal =
            [0, 0, 1];
        },
        code: 'dimension-mismatch',
        pointer: '/representations/section/normal'
      },
      {
        mutate: (document) => {
          const actions = document.actions as Record<string, unknown>[];
          actions[0]!.id = 'tesseract';
        },
        code: 'invalid-id',
        pointer: '/actions/0/id'
      },
      {
        mutate: (document) => {
          const parameters = document.parameters as
            Record<string, unknown>[];
          (parameters[0]!.value as Record<string, unknown>).default = 2;
        },
        code: 'out-of-range',
        pointer: '/parameters/0/value/default'
      },
      {
        mutate: (document) => {
          const representations =
            document.representations as Record<string, unknown>;
          representations.coordinate = {
            kind: 'core.representation.coordinate',
            source: 'tesseract',
            fromDim: 4,
            retainedAxes: [0, 0, 2],
            product: 'both'
          };
        },
        code: 'invalid-value',
        pointer: '/representations/coordinate/retainedAxes'
      },
      {
        mutate: (document) => {
          const parameters = document.parameters as
            Record<string, unknown>[];
          delete parameters[0]!.unit;
        },
        code: 'missing-field',
        pointer: '/parameters/0/unit'
      },
      {
        mutate: (document) => {
          document.evidence = {};
        },
        code: 'unknown-field',
        pointer: '/evidence'
      }
    ];

    for (const expected of cases) {
      const document = clone(bridgeDocument());
      expected.mutate(document);
      const report = validateExperimentDocumentV0(document);
      expect(report.valid).toBe(false);
      expect(report.failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: expected.code,
            pointer: expected.pointer
          })
        ])
      );
    }
  });

  it('rejects non-finite values, cyclic objects, resource excess, and invalid schemas', () => {
    const nonFinite = clone(bridgeDocument());
    nonFinite.ambientDim = Number.POSITIVE_INFINITY;
    expect(
      validateExperimentDocumentV0(nonFinite).failures
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'non-finite-number',
        pointer: '/ambientDim'
      })
    ]));

    const cyclic = clone(bridgeDocument());
    cyclic.cycle = cyclic;
    expect(
      validateExperimentDocumentV0(cyclic).failures
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'invalid-value',
        pointer: '/cycle'
      })
    ]));

    const limited = validateExperimentDocumentV0(
      bridgeDocument(),
      { limits: { maxEntries: 4 } }
    );
    expect(limited.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'resource-limit' })
    ]));

    const remoteSchema = clone(bridgeDocument());
    const actions = remoteSchema.actions as Record<string, unknown>[];
    actions[0]!.inputSchema = {
      type: 'object',
      $ref: 'https://example.invalid/schema'
    };
    expect(
      validateExperimentDocumentV0(remoteSchema).failures
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'unknown-field',
        pointer: '/actions/0/inputSchema/$ref'
      })
    ]));
  });

  it('never executes accessors supplied through object-mode validation', () => {
    const document = clone(bridgeDocument());
    let reads = 0;
    Object.defineProperty(document, 'schema', {
      enumerable: true,
      get() {
        reads++;
        return 'holotope.experiment/0';
      }
    });

    const report = validateExperimentDocumentV0(document);

    expect(reads).toBe(0);
    expect(report).toMatchObject({
      valid: false,
      failures: [
        {
          code: 'invalid-type',
          pointer: '/schema'
        }
      ],
      compileOrder: []
    });
  });

  it('retains the continuous-frame replay limitation as a warning, not a refusal', () => {
    const document = clone(bridgeDocument());
    const representations =
      document.representations as Record<string, unknown>;
    (representations.section as Record<string, unknown>).frame = 'continuous';
    const report = validateExperimentDocumentV0(document);

    expect(report.valid).toBe(true);
    expect(report.warnings).toEqual([
      expect.objectContaining({
        code: 'replay-limited',
        pointer: '/representations/section/frame'
      })
    ]);
  });

  it('reports a descriptor dependency cycle even when it also crosses a category boundary', () => {
    const document = clone(bridgeDocument());
    const models = document.models as Record<string, unknown>;
    const representations =
      document.representations as Record<string, unknown>;
    (models.tumble as Record<string, unknown>).source = 'perspective';
    (representations.perspective as Record<string, unknown>).transform = {
      fromModel: 'tumble'
    };

    const report = validateExperimentDocumentV0(document);

    expect(report.valid).toBe(false);
    expect(report.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'dependency-cycle',
        detail: { nodes: 'perspective,tumble' }
      })
    ]));
    expect(report.compileOrder).toEqual([]);
  });

  it('accepts an R3 coordinate specialization without manufacturing R4 state', () => {
    const document: ExperimentDocumentV0 = {
      schema: 'holotope.experiment/0',
      title: 'R3 control',
      ambientDim: 3,
      sources: {
        cube: {
          kind: 'core.source.hypercube',
          dim: 3,
          size: 2
        }
      },
      representations: {
        xyz: {
          kind: 'core.representation.coordinate',
          source: 'cube',
          fromDim: 3,
          retainedAxes: [0, 1, 2],
          product: 'both'
        }
      },
      backends: [{ backend: 'cpu', required: true }]
    };

    expect(validateExperimentDocumentV0(document)).toEqual({
      valid: true,
      failures: [],
      warnings: [],
      compileOrder: ['cube', 'xyz']
    });
  });
});

describe('@holotope/experiment canonical preparation', () => {
  it('canonicalizes using stable key ordering and ECMAScript number forms', () => {
    expect(canonicalizeExperimentJsonV0({
      numbers: [
        333333333.33333329,
        1e30,
        4.50,
        2e-3,
        1e-27,
        -0
      ],
      literals: [null, true, false],
      a: 'first'
    })).toBe(
      '{"a":"first","literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27,0]}'
    );
  });

  it('canonicalization refuses accessors without executing them', () => {
    let reads = 0;
    const value = Object.defineProperty({}, 'answer', {
      enumerable: true,
      get() {
        reads++;
        return 42;
      }
    });

    expect(() =>
      canonicalizeExperimentJsonV0(
        value as Record<string, number>
      )
    ).toThrow(/accessor/);
    expect(reads).toBe(0);
  });

  it('prepares a frozen copy and matches an independent SHA-256 oracle', async () => {
    const caller = bridgeDocument();
    const prepared = await prepareExperimentDocumentV0(caller);

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const independent = createHash('sha256')
      .update(prepared.value.canonicalJson, 'utf8')
      .digest('hex');
    expect(prepared.value.documentHash).toBe(`sha256:${independent}`);
    expect(Object.isFrozen(prepared.value.document)).toBe(true);
    expect(Object.isFrozen(prepared.value.document.sources)).toBe(true);
    expect(Object.isFrozen(
      prepared.value.document.sources.tesseract
    )).toBe(true);

    (caller.sources.tesseract as {
      size: number;
    }).size = 99;
    expect(prepared.value.document.sources.tesseract.size).toBe(2);
  });

  it('is invariant to key order and sensitive to retained values', async () => {
    const a = bridgeDocument();
    const b = JSON.parse(JSON.stringify(a)) as ExperimentDocumentV0;
    const reordered = {
      backends: b.backends,
      presentation: b.presentation,
      observations: b.observations,
      actions: b.actions,
      parameters: b.parameters,
      representations: b.representations,
      models: b.models,
      sources: b.sources,
      ambientDim: b.ambientDim,
      title: b.title,
      schema: b.schema
    } satisfies ExperimentDocumentV0;
    const changed = clone(a);
    changed.title = 'Changed';

    const pa = await prepareExperimentDocumentV0(a);
    const pb = await prepareExperimentDocumentV0(reordered);
    const pc = await prepareExperimentDocumentV0(changed);
    expect(pa.ok && pb.ok && pc.ok).toBe(true);
    if (!pa.ok || !pb.ok || !pc.ok) return;
    expect(pa.value.documentHash).toBe(pb.value.documentHash);
    expect(pa.value.documentHash).not.toBe(pc.value.documentHash);
  });
});
