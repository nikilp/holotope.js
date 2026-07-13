/** A provenance-driven assignment of one parameter to each source object. */
export interface Decoration<Source, Parameter> {
  readonly id: string;
  parameter(source: Source): Parameter;
}

export interface Decorated<Source, Parameter> {
  readonly source: Source;
  readonly parameter: Parameter;
}

/** Evaluate a decoration while retaining the source provenance beside its parameter. */
export function applyDecoration<Source, Parameter>(
  decoration: Decoration<Source, Parameter>,
  sources: readonly Source[]
): readonly Decorated<Source, Parameter>[] {
  return sources.map((source) => ({ source, parameter: decoration.parameter(source) }));
}

export interface DecorationEquivarianceGenerator<Source, Parameter> {
  readonly id: string;
  actOnSource(source: Source): Source;
  actOnParameter(parameter: Parameter): Parameter;
}

export interface DecorationEquivarianceMismatch {
  readonly generator: string;
  readonly sourceIndex: number;
  readonly targetKey: string;
  readonly reason: 'missing-target' | 'parameter-mismatch';
}

export interface DecorationEquivarianceReport {
  readonly decoration: string;
  readonly generatorCount: number;
  readonly sourceCount: number;
  readonly checked: number;
  readonly matched: number;
  readonly mismatches: readonly DecorationEquivarianceMismatch[];
  readonly equivariant: boolean;
}

export interface DecorationEquivarianceOptions<Source, Parameter> {
  readonly sources: readonly Source[];
  readonly decoration: Decoration<Source, Parameter>;
  readonly generators: readonly DecorationEquivarianceGenerator<Source, Parameter>[];
  /** Exact stable key for the finite source orbit. */
  sourceKey(source: Source): string;
  /** Equality in the parameter representation; exact decorations should use exact equality. */
  parameterEquals(left: Parameter, right: Parameter): boolean;
}

/**
 * Check `c(g·x) = g~·c(x)` on a finite source orbit.
 *
 * The source key turns every generator action into an explicit permutation.
 * Missing images and parameter failures are reported separately so a clipped
 * sample cannot masquerade as a failed intertwining law.
 */
export function checkDecorationEquivariance<Source, Parameter>({
  sources,
  decoration,
  generators,
  sourceKey,
  parameterEquals
}: DecorationEquivarianceOptions<Source, Parameter>): DecorationEquivarianceReport {
  const sourceIndex = new Map<string, number>();
  for (let index = 0; index < sources.length; index++) {
    const key = sourceKey(sources[index]!);
    if (sourceIndex.has(key)) {
      throw new Error(`checkDecorationEquivariance: duplicate source key ${key}`);
    }
    sourceIndex.set(key, index);
  }
  const decorated = applyDecoration(decoration, sources);
  const mismatches: DecorationEquivarianceMismatch[] = [];
  let checked = 0;
  for (const generator of generators) {
    for (let index = 0; index < sources.length; index++) {
      checked++;
      const transformed = generator.actOnSource(sources[index]!);
      const targetKey = sourceKey(transformed);
      const target = sourceIndex.get(targetKey);
      if (target === undefined) {
        mismatches.push({
          generator: generator.id,
          sourceIndex: index,
          targetKey,
          reason: 'missing-target'
        });
        continue;
      }
      const expected = generator.actOnParameter(decorated[index]!.parameter);
      const actual = decorated[target]!.parameter;
      if (!parameterEquals(expected, actual)) {
        mismatches.push({
          generator: generator.id,
          sourceIndex: index,
          targetKey,
          reason: 'parameter-mismatch'
        });
      }
    }
  }
  return {
    decoration: decoration.id,
    generatorCount: generators.length,
    sourceCount: sources.length,
    checked,
    matched: checked - mismatches.length,
    mismatches,
    equivariant: mismatches.length === 0
  };
}
