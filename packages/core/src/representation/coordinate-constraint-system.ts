import {
  solveLinearCoordinateConstraintsN,
  type LinearCoordinateConstraintBlockDiagnosticN,
  type LinearCoordinateConstraintBlockN,
  type LinearCoordinateConstraintFitN,
  type LinearCoordinateConstraintOptions
} from './coordinate-constraints.js';

export interface NamedLinearCoordinateConstraintBlockInputN
  extends LinearCoordinateConstraintBlockN {
  /** Stable machine identity, independent of the optional human label. */
  readonly key: string;
}

export interface NamedLinearCoordinateConstraintBlockN {
  readonly key: string;
  readonly coefficients: readonly number[];
  readonly targets: readonly number[];
  readonly rowCount: number;
  readonly weight: number;
  readonly scale: number;
  readonly label?: string;
}

/** Immutable ordered snapshot of named linear coordinate constraints. */
export interface LinearCoordinateConstraintSystemN {
  readonly kind: 'linear-coordinate-constraint-system';
  readonly coordinateDim: number;
  readonly blocks: readonly NamedLinearCoordinateConstraintBlockN[];
}

export interface NamedLinearCoordinateConstraintBlockDiagnosticN
  extends LinearCoordinateConstraintBlockDiagnosticN {
  readonly key: string;
}

export interface LinearCoordinateConstraintSystemFitN
  extends LinearCoordinateConstraintFitN {
  readonly blockKeys: readonly string[];
  readonly blocks: readonly NamedLinearCoordinateConstraintBlockDiagnosticN[];
}

/** Create an owned immutable snapshot, rejecting duplicate block keys. */
export function createLinearCoordinateConstraintSystemN(
  coordinateDim: number,
  blocks: readonly NamedLinearCoordinateConstraintBlockInputN[] = []
): LinearCoordinateConstraintSystemN {
  validateCoordinateDim(coordinateDim, 'createLinearCoordinateConstraintSystemN');
  const keys = new Set<string>();
  const snapshots = blocks.map((block, index) => {
    const snapshot = snapshotBlock(
      block.key,
      block,
      coordinateDim,
      `createLinearCoordinateConstraintSystemN: block ${index}`
    );
    if (keys.has(snapshot.key)) {
      throw new Error(
        `createLinearCoordinateConstraintSystemN: duplicate block key "${snapshot.key}"`
      );
    }
    keys.add(snapshot.key);
    return snapshot;
  });
  return freezeSystem(coordinateDim, snapshots);
}

/**
 * Return a new snapshot with `key` inserted or replaced.
 *
 * Replacement retains the existing position. A new key appends, so solving
 * and diagnostics have deterministic order independent of object-map rules.
 */
export function withLinearCoordinateConstraintBlockN(
  system: LinearCoordinateConstraintSystemN,
  key: string,
  block: LinearCoordinateConstraintBlockN
): LinearCoordinateConstraintSystemN {
  requireSystem(system, 'withLinearCoordinateConstraintBlockN');
  const snapshot = snapshotBlock(
    key,
    block,
    system.coordinateDim,
    'withLinearCoordinateConstraintBlockN'
  );
  const index = system.blocks.findIndex((candidate) => candidate.key === key);
  const blocks = [...system.blocks];
  if (index === -1) blocks.push(snapshot);
  else blocks[index] = snapshot;
  return freezeSystem(system.coordinateDim, blocks);
}

/** Return a new snapshot without `key`; an absent key preserves identity. */
export function withoutLinearCoordinateConstraintBlockN(
  system: LinearCoordinateConstraintSystemN,
  key: string
): LinearCoordinateConstraintSystemN {
  requireSystem(system, 'withoutLinearCoordinateConstraintBlockN');
  validateKey(key, 'withoutLinearCoordinateConstraintBlockN');
  const index = system.blocks.findIndex((candidate) => candidate.key === key);
  if (index === -1) return system;
  return freezeSystem(
    system.coordinateDim,
    system.blocks.filter((_, blockIndex) => blockIndex !== index)
  );
}

/** Return the immutable named block, or `undefined` when it is absent. */
export function getLinearCoordinateConstraintBlockN(
  system: LinearCoordinateConstraintSystemN,
  key: string
): NamedLinearCoordinateConstraintBlockN | undefined {
  requireSystem(system, 'getLinearCoordinateConstraintBlockN');
  validateKey(key, 'getLinearCoordinateConstraintBlockN');
  return system.blocks.find((candidate) => candidate.key === key);
}

/** Return an empty snapshot; an already empty system preserves identity. */
export function clearLinearCoordinateConstraintSystemN(
  system: LinearCoordinateConstraintSystemN
): LinearCoordinateConstraintSystemN {
  requireSystem(system, 'clearLinearCoordinateConstraintSystemN');
  return system.blocks.length === 0
    ? system
    : freezeSystem(system.coordinateDim, []);
}

/** Solve a named snapshot through the deterministic Stage C5 golden path. */
export function solveLinearCoordinateConstraintSystemN(
  system: LinearCoordinateConstraintSystemN,
  options: LinearCoordinateConstraintOptions = {}
): LinearCoordinateConstraintSystemFitN {
  requireSystem(system, 'solveLinearCoordinateConstraintSystemN');
  const fit = solveLinearCoordinateConstraintsN(
    system.coordinateDim,
    system.blocks,
    options
  );
  const blocks = fit.blocks.map((diagnostic, index) => Object.freeze({
    key: system.blocks[index]!.key,
    ...diagnostic
  }));
  return {
    ...fit,
    blockKeys: Object.freeze(system.blocks.map((block) => block.key)),
    blocks: Object.freeze(blocks)
  };
}

function freezeSystem(
  coordinateDim: number,
  blocks: readonly NamedLinearCoordinateConstraintBlockN[]
): LinearCoordinateConstraintSystemN {
  return Object.freeze({
    kind: 'linear-coordinate-constraint-system' as const,
    coordinateDim,
    blocks: Object.freeze([...blocks])
  });
}

function snapshotBlock(
  key: string,
  block: LinearCoordinateConstraintBlockN,
  coordinateDim: number,
  caller: string
): NamedLinearCoordinateConstraintBlockN {
  validateKey(key, caller);
  if (!Number.isSafeInteger(block.rowCount) || block.rowCount < 1) {
    throw new Error(`${caller}: rowCount must be a positive safe integer`);
  }
  const coefficients = finiteSnapshot(
    block.coefficients,
    block.rowCount * coordinateDim,
    `${caller}: coefficients`
  );
  const targets = finiteSnapshot(
    block.targets,
    block.rowCount,
    `${caller}: targets`
  );
  const weight = positiveFinite(block.weight ?? 1, `${caller}: weight`);
  const scale = positiveFinite(block.scale ?? 1, `${caller}: scale`);
  return Object.freeze({
    key,
    coefficients,
    targets,
    rowCount: block.rowCount,
    weight,
    scale,
    ...(block.label === undefined ? {} : { label: block.label })
  });
}

function requireSystem(
  system: LinearCoordinateConstraintSystemN,
  caller: string
): void {
  if (system.kind !== 'linear-coordinate-constraint-system') {
    throw new Error(`${caller}: expected a linear coordinate constraint system`);
  }
  validateCoordinateDim(system.coordinateDim, caller);
}

function validateCoordinateDim(coordinateDim: number, caller: string): void {
  if (!Number.isSafeInteger(coordinateDim) || coordinateDim < 1) {
    throw new Error(`${caller}: coordinateDim must be a positive safe integer`);
  }
}

function validateKey(key: string, caller: string): void {
  if (typeof key !== 'string' || key.length === 0 || key.trim() !== key) {
    throw new Error(`${caller}: key must be a non-empty trimmed string`);
  }
}

function finiteSnapshot(
  values: ArrayLike<number>,
  expectedLength: number,
  caller: string
): readonly number[] {
  if (values.length !== expectedLength) {
    throw new Error(`${caller} must contain ${expectedLength} values`);
  }
  const snapshot = new Array<number>(expectedLength);
  for (let index = 0; index < expectedLength; index++) {
    const value = values[index]!;
    if (!Number.isFinite(value)) throw new Error(`${caller} must be finite`);
    snapshot[index] = value;
  }
  return Object.freeze(snapshot);
}

function positiveFinite(value: number, caller: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${caller} must be finite and positive`);
  }
  return value;
}
