/**
 * The headless conformance checks, run inside the isolated consumer.
 *
 * Each one composes published packages the way an outside caller would, and
 * throws on the first violated claim. The verifier runs this file with `node`
 * after a strict typecheck; a thrown error is the failure signal.
 */
import { LineBasicMaterial, PerspectiveCamera, Raycaster, Vector2, type Intersection } from 'three';
import {
  BivectorN,
  CellComplex,
  PerspectiveProjection,
  Rotor4,
  TransformN,
  cellComplexBoundsAlongAxisN,
  createHypercube,
  createHyperrectangle,
  cuboidCellFacetN,
  describeRepresentationHitN,
  rotorIdentityResidual,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import {
  ProjectedEdges3D,
  representationHitFromProjectedSurface,
  representationHitFromSlicedComplex
} from '@holotope/three';
import {
  PhysicsWorld4,
  RigidBody4,
  massPropertiesFromCellComplex4
} from '@holotope/physics';
import {
  compileExperimentDocumentV0,
  coreExperimentCompilerV0,
  prepareExperimentDocumentV0,
  type ExperimentDocumentV0,
  type ExperimentProbeSourceCellStatusV0
} from '@holotope/experiment';
import {
  physicsExperimentCompilerV0,
  type ExperimentRigidModel4RuntimeV0
} from '@holotope/experiment-physics';
import { buildScenario, buildSection, buildSurface, cellCountOf, requireGroup } from './scenario.js';

/** An assertion function, so a checked `result.ok` narrows the union after it. */
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`packed consumer: ${message}`);
}

/** The eight oriented facets of a hypercube, in emission order. */
const EXPECTED_FACETS = '3:- 3:+ 2:- 2:+ 1:- 1:+ 0:- 0:+';

function facetNames(complex: CellComplex): string {
  const cuboids = requireGroup(
    complex.cellsOfDim(3).find((group) => group.kind === 'cuboid'),
    'cuboid 3-cells'
  );
  const names: string[] = [];
  for (let cell = 0; cell < cellCountOf(cuboids); cell += 1) {
    const facet = cuboidCellFacetN(complex, cuboids, cell);
    if (facet === null) throw new Error(`packed consumer: cell ${cell} lies on no facet`);
    names.push(`${facet.axis}:${facet.sign > 0 ? '+' : '-'}`);
  }
  return names.join(' ');
}

/**
 * 1. Package and geometry composition.
 *
 * A sentinel for the installed artifact as much as for the geometry:
 * `cuboidCellFacetN` landed after v0.0.8, so resolving an older published
 * package fails here rather than passing quietly.
 */
export function geometryComposition(): void {
  const complex = createHypercube({ dim: 4, size: 3, maxCellDimension: 3 });
  assert(facetNames(complex) === EXPECTED_FACETS, `size-3 facets were ${facetNames(complex)}`);
  const bounds = cellComplexBoundsAlongAxisN(complex, 3);
  assert(bounds.min === -1.5 && bounds.max === 1.5, `w bounds were [${bounds.min}, ${bounds.max}]`);

  const relative = Rotor4.fromPlane(0, 3, 0.7);
  const [major, minor] = Rotor4.principalAnglesBetween(Rotor4.identity(), relative);
  assert(Math.abs(major - 0.7) < 1e-12 && minor < 1e-12, `principal angles were [${major}, ${minor}]`);

  // Translated clear of the origin, every coordinate shares one sign, so a
  // recipe reading `Math.sign` would name the same facet eight times.
  const moved = new CellComplex(
    complex.ambientDim,
    complex.positions.map((value) => value + 10),
    [...complex.groups]
  );
  assert(facetNames(moved) === EXPECTED_FACETS, `translated facets were ${facetNames(moved)}`);
}

interface PositionAttribute {
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
}

/** Casts a deterministic ray at the centroid of the first emitted triangle. */
function rayAtFirstTriangle(geometry: {
  getAttribute(name: string): PositionAttribute;
}): Raycaster {
  const position = geometry.getAttribute('position');
  const x = (position.getX(0) + position.getX(1) + position.getX(2)) / 3;
  const y = (position.getY(0) + position.getY(1) + position.getY(2)) / 3;
  const z = (position.getZ(0) + position.getZ(1) + position.getZ(2)) / 3;
  const camera = new PerspectiveCamera(60, 1, 0.01, 1000);
  camera.position.set(x, y, z + 20);
  camera.lookAt(x, y, z);
  camera.updateMatrixWorld(true);
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2(0, 0), camera);
  return raycaster;
}

/**
 * 2. Section and projection claims, through a real Three.js `Raycaster`.
 *
 * The intersection is produced by Three and handed to the adapter unchanged.
 * Manufacturing an intersection literal would test the adapter's tolerance for
 * a shape this consumer invented rather than the one Three actually returns.
 */
export function representationClaims(): void {
  const scenario = buildScenario(2);

  const edges = new ProjectedEdges3D(
    scenario.complex,
    new PerspectiveProjection({ fromDim: 4, viewDistance: 4 }),
    { color: 0x1e293b }
  );
  assert(
    (edges.object.material as LineBasicMaterial).color.getHex() === 0x1e293b,
    'ProjectedEdges3D ignored its explicit color'
  );
  let rejectedUnknownOption = false;
  try {
    new ProjectedEdges3D(
      scenario.complex,
      new PerspectiveProjection({ fromDim: 4, viewDistance: 4 }),
      { linewidth: 2 } as never
    );
  } catch (error) {
    rejectedUnknownOption = error instanceof Error && /linewidth/.test(error.message);
  }
  assert(rejectedUnknownOption, 'ProjectedEdges3D accepted an unknown linewidth option');

  const section = buildSection(scenario);
  section.object.updateMatrixWorld(true);
  const sectionHits: Intersection[] = rayAtFirstTriangle(section.geometry).intersectObject(
    section.object,
    false
  );
  assert(sectionHits.length > 0, 'the section ray met no triangle');
  const sectionReport = describeRepresentationHitN(
    representationHitFromSlicedComplex(section, sectionHits[0]!)
  );
  assert(
    sectionReport.ambient.claim === 'unique',
    `section claim was ${sectionReport.ambient.claim}`
  );
  assert(
    sectionReport.source.kind === 'cell',
    `section source kind was ${sectionReport.source.kind}`
  );

  const surface = buildSurface(scenario);
  surface.object.updateMatrixWorld(true);
  const surfaceHits: Intersection[] = rayAtFirstTriangle(surface.geometry).intersectObject(
    surface.object,
    false
  );
  assert(surfaceHits.length > 0, 'the projection ray met no triangle');
  const surfaceReport = describeRepresentationHitN(
    representationHitFromProjectedSurface(surface, surfaceHits[0]!)
  );
  const projected = surfaceReport.ambient;
  assert(
    projected.claim === 'on-selected-primitive',
    `projection claim was ${projected.claim}`
  );
  assert(
    projected.ambiguity === 'projection-overlap',
    `the projection claim reported ambiguity ${projected.ambiguity}`
  );

  section.dispose();
  surface.dispose();
  edges.dispose();
}

/** Euclidean norm over a bivector's plane coefficients. */
const bivectorNorm = (bivector: BivectorN): number =>
  Math.hypot(...Array.from(bivector.coeffs));

/**
 * 4. Physics package composition.
 *
 * An installation smoke test over an existing golden path: mass properties
 * from the same source, a nonzero angular state, and a deterministic interval.
 */
export function physicsComposition(): void {
  const boundary = tetrahedralizeCuboidCells(
    createHypercube({ dim: 4, size: 1, maxCellDimension: 3 })
  );
  const properties = massPropertiesFromCellComplex4(boundary);
  const body = RigidBody4.fromMassProperties(properties);
  const spin = BivectorN.fromPlanes(4, [
    { i: 0, j: 3, angle: 0.7 },
    { i: 1, j: 2, angle: -0.2 }
  ]);
  body.setAngularVelocityWorld(spin);

  // Torque-free and gravity-free, so the angular state is conserved.
  const world = new PhysicsWorld4({ gravity: [0, 0, 0, 0] });
  world.addBody(body);
  const before = body.rotation.clone();
  for (let step = 0; step < 120; step += 1) world.step(1 / 120);

  assert(
    rotorIdentityResidual(before) !== rotorIdentityResidual(body.rotation),
    'the orientation did not change over 120 steps'
  );
  const pose = new TransformN(4, body.rotation, body.position);
  assert(
    Array.from(pose.position.data).every((value) => Number.isFinite(value)),
    'reported position is not finite'
  );
  // Spin(4): the rotor's matrix stays orthogonal, so its round trip through
  // SO(4) and back is identity to numerical tolerance.
  const matrix = body.rotation.toMatrix().data;
  assert(
    Array.from(matrix).every((value) => Number.isFinite(value)),
    'the orientation matrix is not finite'
  );
  assert(
    Math.abs(bivectorNorm(body.angularVelocityWorld()) - bivectorNorm(spin)) < 1e-6,
    'angular velocity magnitude drifted under a torque-free interval'
  );
}

/** Centroid of the first triangle the equivalent section product emits. */
function firstEmittedSectionPoint(): readonly [number, number, number] {
  const section = buildSection(buildScenario(2));
  const position = section.geometry.getAttribute('position') as unknown as PositionAttribute;
  const point: [number, number, number] = [
    (position.getX(0) + position.getX(1) + position.getX(2)) / 3,
    (position.getY(0) + position.getY(1) + position.getY(2)) / 3,
    (position.getZ(0) + position.getZ(1) + position.getZ(2)) / 3
  ];
  section.dispose();
  return point;
}

/**
 * 5. The orthotope source, end to end from packed artifacts.
 *
 * Composes all four non-adapter packages: core constructs it, physics
 * integrates its mass, and the two experiment packages compile a document that
 * advances it. Its analytic mass is closed-form, so the assertion is against
 * arithmetic rather than against another call.
 */
export async function hyperrectangleComposition(): Promise<void> {
  const edges = [2, 3, 5, 7];
  const body = tetrahedralizeCuboidCells(
    createHyperrectangle({ dim: 4, edgeLengths: edges, maxCellDimension: 3 })
  );

  const properties = massPropertiesFromCellComplex4(body);
  const volume = edges.reduce((product, edge) => product * edge, 1);
  assert(
    Math.abs(properties.volume - volume) < 1e-6,
    `volume was ${properties.volume}, expected ${volume}`
  );
  // I_ij = m(a_i^2 + a_j^2)/12, so the six plane inertias are all different.
  const inertia = Array.from(properties.inertiaDiagonal);
  assert(inertia.length === 6, `expected six plane inertias, got ${inertia.length}`);
  assert(
    Math.max(...inertia) - Math.min(...inertia) > 1,
    'the packed body is isotropic, so it is not the orthotope'
  );

  const document = {
    schema: 'holotope.experiment/0',
    title: 'Packed orthotope',
    ambientDim: 4,
    sources: {
      body: {
        kind: 'core.source.hyperrectangle',
        dim: 4,
        edgeLengths: edges,
        tetrahedralize: true
      }
    },
    models: {
      tumble: {
        kind: 'physics.model.rigid4',
        source: 'body',
        initialAngularMomentum: [0.4, 0.15, 0, 0.9, -0.3, 0],
        fixedStep: 1 / 120,
        substeps: 2
      }
    },
    representations: {
      shadow: {
        kind: 'core.representation.perspective',
        source: 'body',
        fromDim: 4,
        viewDistance: 14,
        transform: { fromModel: 'tumble' },
        product: 'both'
      }
    }
  } satisfies ExperimentDocumentV0;
  const prepared = await prepareExperimentDocumentV0(document);
  assert(prepared.ok, `orthotope document did not prepare: ${describeFailures(prepared)}`);

  const compiled = compileExperimentDocumentV0(prepared.value, {
    compilers: [coreExperimentCompilerV0(), physicsExperimentCompilerV0()]
  });
  assert(compiled.ok, `orthotope document did not compile: ${describeFailures(compiled)}`);
  const compilation = compiled.value;

  const model = compilation.get('tumble');
  assert(model.ok && model.value.category === 'model', 'the rigid model did not compile');
  const runtime = model.value.runtime as ExperimentRigidModel4RuntimeV0;
  const before = Array.from(runtime.body.rotation.left);

  const advanced = compilation.advance(240);
  assert(advanced.ok, 'the orthotope model did not advance');
  assert(advanced.value.step === 240, `advanced ${advanced.value.step} steps`);

  const after = Array.from(runtime.body.rotation.left);
  assert(
    after.some((value, index) => value !== before[index]),
    'the orientation did not change over 240 steps'
  );
  assert(after.every((value) => Number.isFinite(value)), 'orientation is not finite');

  compilation.dispose();
}

interface ProbeOutput {
  readonly sourceCellStatus: ExperimentProbeSourceCellStatusV0;
  readonly sourceCell?: unknown;
  readonly sourceCellPrecision?: unknown;
  readonly ambientPoint?: unknown;
}

/**
 * Reads a probe result, checking rather than asserting its shape.
 *
 * `invoke` returns JSON, so a cast would let a probe that reported nothing
 * pass as one that reported a status. Validating here means the absence of
 * `sourceCellStatus` is itself a conformance failure.
 */
function readProbeOutput(output: unknown, label: string): ProbeOutput {
  assert(
    typeof output === 'object' && output !== null,
    `the ${label} probe returned ${typeof output}, not an object`
  );
  const record = output as Record<string, unknown>;
  assert(
    typeof record['sourceCellStatus'] === 'string',
    `the ${label} probe reported no sourceCellStatus`
  );
  return record as unknown as ProbeOutput;
}

/**
 * 3. Headless experiment probe.
 *
 * Prepares and compiles a v0 document with both public compilers, then probes
 * the section and the projection. The probe reports its reasoning as a status
 * whether or not it found a cell, so an absent `sourceCell` is never read as
 * the answer.
 */
export async function experimentProbe(): Promise<void> {
  const probeAction = {
    id: 'probe',
    title: 'Probe',
    description: 'Reports headless evidence for a chart point.',
    inputSchema: {
      type: 'object',
      properties: {
        representation: { type: 'string' },
        point: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }
      },
      required: ['representation', 'point'],
      additionalProperties: false
    },
    outputSchema: { type: 'object' },
    readOnly: true,
    destructive: false,
    idempotent: true,
    deterministic: true,
    supportsPreview: false,
    budget: { maxMillis: 50 },
    operation: { kind: 'probe' }
  } as const;

  const prepared = await prepareExperimentDocumentV0({
    schema: 'holotope.experiment/0',
    title: 'Packed consumer',
    ambientDim: 4,
    sources: {
      tesseract: {
        kind: 'core.source.hypercube',
        dim: 4,
        size: 2,
        tetrahedralize: true
      }
    },
    representations: {
      section: {
        kind: 'core.representation.section4',
        source: 'tesseract',
        normal: [0, 0, 0, 1],
        offset: 0,
        frame: 'canonical'
      },
      shadow: {
        kind: 'core.representation.perspective',
        source: 'tesseract',
        fromDim: 4,
        viewDistance: 4,
        product: 'both'
      }
    },
    actions: [probeAction]
  });
  assert(prepared.ok, `document did not prepare: ${describeFailures(prepared)}`);

  const compiled = compileExperimentDocumentV0(prepared.value, {
    compilers: [coreExperimentCompilerV0(), physicsExperimentCompilerV0()]
  });
  assert(compiled.ok, `document did not compile: ${describeFailures(compiled)}`);
  const compilation = compiled.value;

  // A point the section actually emitted, rather than a guessed coordinate:
  // the w = 0 cut of a solid tesseract is a solid cube, and its triangles are
  // that cube's boundary, so an interior point is on no emitted cell.
  const probePoint = firstEmittedSectionPoint();
  const inSection = compilation.invoke('probe', {
    representation: 'section',
    point: probePoint
  });
  const section = readProbeOutput(inSection.output, 'section');
  assert(
    section.sourceCellStatus === 'resolved',
    `section sourceCellStatus was ${section.sourceCellStatus}`
  );
  assert(section.sourceCell !== undefined, 'a resolved section probe named no source cell');
  assert(
    section.sourceCellPrecision === 'exact' || section.sourceCellPrecision === 'renderer',
    `section sourceCellPrecision was ${String(section.sourceCellPrecision)}`
  );

  const inProjection = compilation.invoke('probe', {
    representation: 'shadow',
    point: probePoint
  });
  const shadow = readProbeOutput(inProjection.output, 'projection');
  // A perspective projection is many-to-one, so it may not name one source
  // cell and a globally unique ambient point from a chart coordinate alone.
  assert(
    shadow.sourceCellStatus !== 'resolved' || shadow.ambientPoint === undefined,
    'a perspective probe manufactured a globally unique R4 point'
  );

  compilation.dispose();
}

const describeFailures = (result: { readonly ok: boolean }): string =>
  JSON.stringify('failures' in result ? result.failures : null);
