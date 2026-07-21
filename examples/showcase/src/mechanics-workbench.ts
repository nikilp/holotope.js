import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  CellComplex,
  CoordinateProjection,
  HyperplaneSlice4,
  PerspectiveProjection,
  createHypercube,
  resolveSourceCellIdN,
  tetrahedralizeCuboidCells,
  type Projection
} from '@holotope/core';
import {
  ProjectedEdges3D,
  ProjectedSurface3D,
  SlicedComplex3D
} from '@holotope/three';
import {
  XpbdWorldN,
  compileXpbdDistanceNetworkN,
  compileXpbdOrientedCuboidFamilyN,
  compileXpbdSimplexMeasureFamilyN,
  type XpbdConstraintResultN,
  type XpbdDistanceNetworkN,
  type XpbdOrientedCuboidFamilyN,
  type XpbdSimplexMeasureFamilyN,
  type XpbdWorldStepResultN
} from '@holotope/physics';
import { setupShowcaseUI } from './ui';

type SourceMode = 'r4' | 'r3';
type MaterialMode = 'interior' | 'boundary' | 'edge';

interface LabState {
  readonly mode: SourceMode;
  readonly source: CellComplex;
  readonly network: XpbdDistanceNetworkN;
  readonly measureFamily: XpbdSimplexMeasureFamilyN | null;
  readonly orientedFamily: XpbdOrientedCuboidFamilyN | null;
  readonly world: XpbdWorldN;
  readonly perspective: PerspectiveProjection;
  readonly coordinate: CoordinateProjection;
  readonly slice: HyperplaneSlice4;
  readonly perspectiveSurface: ProjectedSurface3D;
  readonly coordinateSurface: ProjectedSurface3D;
  readonly perspectiveEdges: ProjectedEdges3D;
  readonly coordinateEdges: ProjectedEdges3D;
  readonly section: SlicedComplex3D;
  readonly perspectivePins: Points;
  readonly coordinatePins: Points;
  readonly pinnedVertices: readonly number[];
  readonly positionsAreDisjoint: boolean;
  elapsed: number;
  lastStep: XpbdWorldStepResultN | null;
}

const FIXED_STEP = 1 / 120;
const MAX_CATCH_UP_STEPS = 8;
const VELOCITY_RETAIN = 0.9985;
const PERSPECTIVE_X = -4.25;
const COORDINATE_X = -0.25;
const SECTION_X = 3.75;

const container = document.getElementById('app')!;
const scene = new Scene();
scene.background = new Color(0x050710);
const camera = new PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 3.3, 16.6);
const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 10;
controls.maxDistance = 28;
controls.target.set(0, 0.15, 0);

scene.add(new AmbientLight(0x8fa7d6, 1.45));
const key = new DirectionalLight(0xffffff, 3.1);
key.position.set(5, 8, 7);
scene.add(key);
const rim = new DirectionalLight(0x63e3bd, 2.1);
rim.position.set(-6, -2, 3);
scene.add(rim);

const modeInput = document.getElementById('mode') as HTMLSelectElement;
const complianceInput = document.getElementById('compliance') as HTMLInputElement;
const materialModeInput = document.getElementById('materialMode') as HTMLSelectElement;
const measureComplianceInput = document.getElementById('measureCompliance') as HTMLInputElement;
const driveInput = document.getElementById('drive') as HTMLInputElement;
const sliceOffsetInput = document.getElementById('sliceOffset') as HTMLInputElement;
const edgeInput = document.getElementById('edge') as HTMLInputElement;
const pauseButton = document.getElementById('pause') as HTMLButtonElement;
const resetButton = document.getElementById('reset') as HTMLButtonElement;

const perspectiveSelection = selectedEdgeLine(PERSPECTIVE_X);
const coordinateSelection = selectedEdgeLine(COORDINATE_X);
const perspectiveSelectionPoints = selectedEdgePoints(
  perspectiveSelection.geometry,
  PERSPECTIVE_X
);
const coordinateSelectionPoints = selectedEdgePoints(
  coordinateSelection.geometry,
  COORDINATE_X
);
scene.add(
  perspectiveSelection,
  coordinateSelection,
  perspectiveSelectionPoints,
  coordinateSelectionPoints
);

const crossingMarker = new Mesh(
  new SphereGeometry(0.105, 18, 12),
  new MeshBasicMaterial({ color: 0xdcff74, depthTest: false })
);
crossingMarker.renderOrder = 20;
crossingMarker.visible = false;
scene.add(crossingMarker);

let state: LabState | null = null;
let paused = false;
let accumulator = 0;
let previousTime = performance.now();

function createSource(mode: SourceMode): CellComplex {
  let source: CellComplex;
  if (mode === 'r4') {
    source = createHypercube({ dim: 4, size: 2, maxCellDimension: 4 });
    const scales = [1.18, 1.38, 0.94, 0.82];
    for (let vertex = 0; vertex < source.vertexCount; vertex++) {
      for (let axis = 0; axis < 4; axis++) {
        source.positions[vertex * 4 + axis]! *= scales[axis]!;
      }
    }
    source.cellsOfDim(4)[0]!.key = 'material-4-cells';
  } else {
    const cube = createHypercube({ dim: 3, size: 2 });
    const positions = new Float64Array(cube.vertexCount * 4);
    for (let vertex = 0; vertex < cube.vertexCount; vertex++) {
      positions[vertex * 4] = cube.positions[vertex * 3]! * 1.18;
      positions[vertex * 4 + 1] = cube.positions[vertex * 3 + 1]! * 1.38;
      positions[vertex * 4 + 2] = cube.positions[vertex * 3 + 2]! * 0.94;
      positions[vertex * 4 + 3] = 0;
    }
    source = new CellComplex(4, positions, cube.groups.map((group) => ({
      dim: group.dim,
      verticesPerCell: group.verticesPerCell,
      kind: group.kind,
      indices: group.indices.slice(),
      ...(group.key === undefined ? {} : { key: group.key })
    })));
  }
  source.cellsOfDim(1)[0]!.key = 'elastic-edges';
  const tetrahedralized = tetrahedralizeCuboidCells(source);
  tetrahedralized.cellsOfDim(3).find((group) => group.kind === 'simplex')!.key =
    'material-tetrahedra';
  return tetrahedralized;
}

function rebuildState(): void {
  disposeState();
  const mode = modeInput.value as SourceMode;
  if (mode === 'r3' && materialModeInput.value === 'interior') {
    materialModeInput.value = 'boundary';
  }
  const source = createSource(mode);
  const edgeGroup = source.cellsOfDim(1)[0]!;
  const tetrahedronGroup = source.cellsOfDim(3).find(
    (group) => group.kind === 'simplex'
  )!;
  const materialMode = materialModeInput.value as MaterialMode;
  const compliance = 10 ** Number(complianceInput.value);
  const network = compileXpbdDistanceNetworkN({
    id: mode === 'r4' ? 'deforming-tesseract' : 'embedded-cube',
    source,
    edgeGroup,
    inverseMass: ({ sourcePosition }) => sourcePosition.data[1]! > 0 ? 0 : 1,
    compliance
  });
  const world = new XpbdWorldN({
    dimension: 4,
    gravity: [0, -2.35, 0, 0],
    solverIterations: 16
  });
  network.addToWorld(world);
  const measureFamily = materialMode === 'boundary'
    ? compileXpbdSimplexMeasureFamilyN({
        id: mode === 'r4' ? 'tesseract-measure' : 'cube-measure',
        source,
        simplexGroup: tetrahedronGroup,
        particles: network.particles,
        compliance: 10 ** Number(measureComplianceInput.value)
      })
    : null;
  measureFamily?.addToWorld(world);
  const orientedFamily = materialMode === 'interior' && mode === 'r4'
    ? compileXpbdOrientedCuboidFamilyN({
        id: 'tesseract-oriented-interior',
        source,
        cuboidGroup: source.cellsOfDim(4)[0]!,
        particles: network.particles,
        compliance: 10 ** Number(measureComplianceInput.value)
      })
    : null;
  orientedFamily?.addToWorld(world);
  const perspective = new PerspectiveProjection({ fromDim: 4, viewDistance: 5.8 });
  const coordinate = new CoordinateProjection({ fromDim: 4, axes: [0, 1, 3] });
  const slice = new HyperplaneSlice4({
    normal: [0, 0, 1, 1],
    offset: Number(sliceOffsetInput.value)
  });
  const perspectiveSurface = new ProjectedSurface3D(source, perspective, {
    material: new MeshStandardMaterial({
      color: 0x4c9de8,
      emissive: 0x071b33,
      roughness: 0.62,
      side: DoubleSide,
      flatShading: true,
      transparent: true,
      opacity: 0.2,
      depthWrite: false
    })
  });
  perspectiveSurface.object.position.x = PERSPECTIVE_X;
  const coordinateSurface = new ProjectedSurface3D(source, coordinate, {
    material: new MeshStandardMaterial({
      color: 0x50d5af,
      emissive: 0x06251f,
      roughness: 0.62,
      side: DoubleSide,
      flatShading: true,
      transparent: true,
      opacity: 0.18,
      depthWrite: false
    })
  });
  coordinateSurface.object.position.x = COORDINATE_X;
  const perspectiveEdges = new ProjectedEdges3D(source, perspective, {
    material: new LineBasicMaterial({
      color: 0x89bdf7,
      transparent: true,
      opacity: 0.9
    })
  });
  perspectiveEdges.object.position.x = PERSPECTIVE_X;
  const coordinateEdges = new ProjectedEdges3D(source, coordinate, {
    material: new LineBasicMaterial({
      color: 0x72e3c0,
      transparent: true,
      opacity: 0.88
    })
  });
  coordinateEdges.object.position.x = COORDINATE_X;
  const section = new SlicedComplex3D(source, slice, {
    material: new MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x2b1108,
      roughness: 0.58,
      side: DoubleSide,
      flatShading: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.91
    }),
    colorForTet: (tet) => [
      0xff8b61,
      0xffc36e,
      0xf17b9f,
      0xc192ff,
      0x69d9cf,
      0x9ad66d
    ][tet % 6]!
  });
  section.object.position.x = SECTION_X;
  const pinnedVertices = network.particles
    .map((particle, vertex) => particle.inverseMass === 0 ? vertex : -1)
    .filter((vertex) => vertex >= 0);
  const perspectivePins = pinCloud(pinnedVertices.length, PERSPECTIVE_X);
  const coordinatePins = pinCloud(pinnedVertices.length, COORDINATE_X);
  scene.add(
    perspectiveSurface.object,
    coordinateSurface.object,
    perspectiveEdges.object,
    coordinateEdges.object,
    section.object,
    perspectivePins,
    coordinatePins
  );
  state = {
    mode,
    source,
    network,
    measureFamily,
    orientedFamily,
    world,
    perspective,
    coordinate,
    slice,
    perspectiveSurface,
    coordinateSurface,
    perspectiveEdges,
    coordinateEdges,
    section,
    perspectivePins,
    coordinatePins,
    pinnedVertices,
    positionsAreDisjoint: network.particles.every(
      (particle) => particle.position.data.buffer !== source.positions.buffer
    ),
    elapsed: 0,
    lastStep: null
  };
  edgeInput.max = String(network.edges.length - 1);
  edgeInput.value = String(Math.min(Number(edgeInput.value), network.edges.length - 1));
  driveInput.disabled = mode === 'r3';
  document.getElementById('perspectiveLabel')!.textContent = mode === 'r4'
    ? 'R4 perspective · ambiguous shadow'
    : 'embedded R3 · R4 perspective specialization';
  document.getElementById('modeNote')!.textContent = mode === 'r4'
    ? 'R4 · 120 Hz · 16 XPBD iterations · demo velocity retain 0.9985/step'
    : 'R3 in R4 · hidden force disabled · exact w=0 audit';
  accumulator = 0;
  paused = false;
  pauseButton.textContent = 'pause';
  syncControlLabels();
  updateRepresentations();
}

function disposeState(): void {
  if (state === null) return;
  scene.remove(
    state.perspectiveSurface.object,
    state.coordinateSurface.object,
    state.perspectiveEdges.object,
    state.coordinateEdges.object,
    state.section.object,
    state.perspectivePins,
    state.coordinatePins
  );
  state.perspectiveSurface.dispose();
  state.coordinateSurface.dispose();
  state.perspectiveEdges.dispose();
  state.coordinateEdges.dispose();
  state.section.dispose();
  disposePoints(state.perspectivePins);
  disposePoints(state.coordinatePins);
  state = null;
}

function stepSimulation(): void {
  if (state === null) return;
  const hiddenDrive = state.mode === 'r4' ? Number(driveInput.value) : 0;
  for (const particle of state.network.particles) {
    if (particle.inverseMass === 0 || hiddenDrive === 0) continue;
    const phase = 2.15 * state.elapsed + 0.65 * particle.position.data[2]!;
    const handedness = particle.position.data[0]! >= 0 ? 1 : -1;
    particle.applyForce([0, 0, 0, hiddenDrive * handedness * Math.sin(phase)]);
  }
  state.lastStep = state.world.step(FIXED_STEP);
  for (const particle of state.network.particles) {
    if (particle.inverseMass > 0) particle.velocity.multiplyScalar(VELOCITY_RETAIN);
  }
  state.elapsed += FIXED_STEP;
}

function updateRepresentations(): void {
  if (state === null) return;
  state.network.writeSourcePositions();
  state.perspectiveSurface.update();
  state.coordinateSurface.update();
  state.perspectiveEdges.update();
  state.coordinateEdges.update();
  state.section.update();
  updatePins(state.perspectivePins, state.pinnedVertices, state.perspective);
  updatePins(state.coordinatePins, state.pinnedVertices, state.coordinate);
  updateSelectedEdge();
  updateEvidence();
}

function updateSelectedEdge(): void {
  if (state === null) return;
  const edge = state.network.edges[Number(edgeInput.value)]!;
  const [from, to] = edge.sourceVertexIndices;
  const pointA = sourcePoint(from);
  const pointB = sourcePoint(to);
  updateLine(perspectiveSelection, state.perspective.projectPoint(pointA), state.perspective.projectPoint(pointB));
  updateLine(coordinateSelection, state.coordinate.projectPoint(pointA), state.coordinate.projectPoint(pointB));

  const signedA = signedDistance(pointA);
  const signedB = signedDistance(pointB);
  const epsilon = 1e-12;
  crossingMarker.visible = false;
  if (Math.abs(signedA) <= epsilon && Math.abs(signedB) <= epsilon) return;
  if (signedA * signedB > 0) return;
  const denominator = signedA - signedB;
  if (Math.abs(denominator) <= epsilon) return;
  const t = signedA / denominator;
  const ambient = new Float64Array(4);
  for (let axis = 0; axis < 4; axis++) {
    ambient[axis] = pointA[axis]! + t * (pointB[axis]! - pointA[axis]!);
  }
  const chart = sectionChart(ambient);
  crossingMarker.position.set(chart[0] + SECTION_X, chart[1], chart[2]);
  crossingMarker.visible = true;
}

function updateEvidence(): void {
  if (state === null) return;
  const edgeIndex = Number(edgeInput.value);
  const edge = state.network.edges[edgeIndex]!;
  const [from, to] = edge.sourceVertexIndices;
  const particleA = state.network.particles[from]!;
  const particleB = state.network.particles[to]!;
  const length = particleA.position.distanceTo(particleB.position);
  const strain = length / edge.restLength - 1;
  const result = selectedConstraintResult(edge.constraint.id);
  const idStatus = resolveSourceCellIdN(state.source, edge.sourceId);

  document.getElementById('evidenceTitle')!.textContent =
    `${state.mode === 'r4' ? 'Full R4 network' : 'Embedded R3 control'} · selected physical edge ${edgeIndex} of ${state.network.edges.length}`;
  document.getElementById('edgeIdentity')!.textContent =
    `source id ${edge.sourceId.groupKeyKind}:${edge.sourceId.groupKey}/${edge.sourceId.cellIndex} · vertices [${from}, ${to}] · ${idStatus.kind}`;
  document.getElementById('edgeDynamics')!.textContent = result === undefined
    ? `length ${length.toFixed(6)} · rest ${edge.restLength.toFixed(6)} · strain ${(100 * strain).toFixed(3)}% · awaiting first fixed step`
    : `length ${length.toFixed(6)} · strain ${(100 * strain).toFixed(3)}% · λ ${scientific(result.totalMultiplier)} · force ${scientific(result.signedForce)} · residual ${scientific(result.compliantResidual)}`;

  const materialEvidence = document.getElementById('materialEvidence')!;
  if (state.measureFamily === null && state.orientedFamily === null) {
    materialEvidence.textContent =
      `edges only · ${state.network.constraints.length} active constraints · no local material coordinate`;
  } else if (state.measureFamily !== null) {
    let maxMeasureStrain = 0;
    let maxMeasureResidual = 0;
    let resolvedCells = 0;
    const latestResults = latestConstraintResults();
    for (const cell of state.measureFamily.cells) {
      const evaluated = cell.constraint.evaluate();
      const restMeasure = Math.sqrt(cell.restSquaredMeasure);
      maxMeasureStrain = Math.max(
        maxMeasureStrain,
        Math.abs(evaluated.measure / restMeasure - 1)
      );
      const cellResult = latestResults.find(
        (candidate) => candidate.id === cell.constraint.id
      );
      if (cellResult !== undefined) {
        maxMeasureResidual = Math.max(
          maxMeasureResidual,
          Math.abs(cellResult.compliantResidual)
        );
      }
      if (resolveSourceCellIdN(state.source, cell.sourceId).kind === 'resolved') {
        resolvedCells++;
      }
    }
    const sharedParticles = state.measureFamily.constraints.every(
      (constraint) => constraint.points.every((particle) =>
        state!.network.particles.some((candidate) => candidate === particle)
      )
    );
    materialEvidence.textContent =
      `unsigned boundary · ${resolvedCells}/${state.measureFamily.cells.length} tetra ids · ${sharedParticles ? 'shared particles' : 'FOREIGN'} · max strain ${(100 * maxMeasureStrain).toFixed(3)}% · residual ${scientific(maxMeasureResidual)}`;
  } else {
    const family = state.orientedFamily!;
    let maxSignedStrain = 0;
    let maxMeasureResidual = 0;
    let invertedElements = 0;
    let resolvedElements = 0;
    const resolvedParents = new Set<string>();
    const latestResults = latestConstraintResults();
    for (const cell of family.cells) {
      const evaluated = cell.constraint.evaluate();
      const ratio = evaluated.orientedMeasure / cell.restOrientedMeasure;
      maxSignedStrain = Math.max(maxSignedStrain, Math.abs(ratio - 1));
      if (ratio <= 0) invertedElements++;
      const cellResult = latestResults.find(
        (candidate) => candidate.id === cell.constraint.id
      );
      if (cellResult !== undefined) {
        maxMeasureResidual = Math.max(
          maxMeasureResidual,
          Math.abs(cellResult.compliantResidual)
        );
      }
      if (resolveSourceCellIdN(state.source, cell.sourceId).kind === 'resolved') {
        resolvedElements++;
        resolvedParents.add(
          `${cell.sourceId.groupKeyKind}:${cell.sourceId.groupKey}/${cell.sourceCellIndex}`
        );
      }
    }
    const sharedParticles = family.constraints.every(
      (constraint) => constraint.points.every((particle) =>
        state!.network.particles.some((candidate) => candidate === particle)
      )
    );
    materialEvidence.textContent =
      `signed R4 interior · ${resolvedElements}/${family.cells.length} simplices · ${resolvedParents.size} parent · ${sharedParticles ? 'shared particles' : 'FOREIGN'} · inverted ${invertedElements} · strain ${(100 * maxSignedStrain).toFixed(3)}% · residual ${scientific(maxMeasureResidual)}`;
  }

  const pointA = sourcePoint(from);
  const pointB = sourcePoint(to);
  const signedA = signedDistance(pointA);
  const signedB = signedDistance(pointB);
  const epsilon = 1e-12;
  let sectionText: string;
  if (Math.abs(signedA) <= epsilon && Math.abs(signedB) <= epsilon) {
    sectionText = `section: whole edge lies in the affine plane · no unique crossing · ${state.section.triangleCount} rendered triangles`;
  } else if (signedA * signedB <= 0) {
    const t = signedA / (signedA - signedB);
    sectionText = `section: exact edge crossing at t=${t.toFixed(6)} · endpoint distances [${signedA.toFixed(4)}, ${signedB.toFixed(4)}] · marker shown`;
  } else {
    sectionText = `section: no incidence · endpoint distances [${signedA.toFixed(4)}, ${signedB.toFixed(4)}] · ${state.section.triangleCount} rendered triangles`;
  }
  document.getElementById('sectionEvidence')!.textContent = sectionText;

  let writeAgreement = 0;
  let hiddenDrift = 0;
  for (let vertex = 0; vertex < state.network.particles.length; vertex++) {
    const particle = state.network.particles[vertex]!;
    for (let axis = 0; axis < 4; axis++) {
      writeAgreement = Math.max(
        writeAgreement,
        Math.abs(state.source.positions[vertex * 4 + axis]! - particle.position.data[axis]!)
      );
    }
    hiddenDrift = Math.max(hiddenDrift, Math.abs(particle.position.data[3]!));
  }
  const residual = state.lastStep?.maxAbsCompliantResidual ?? 0;
  document.getElementById('stateEvidence')!.textContent =
    `copied buffers ${state.positionsAreDisjoint ? 'disjoint' : 'ALIASED'} · explicit write max Δ ${scientific(writeAgreement)} · max |w| ${scientific(hiddenDrift)}${state.mode === 'r3' && hiddenDrift === 0 ? ' exact-zero' : ''} · mixed-coordinate max residual ${scientific(residual)}`;
}

function selectedConstraintResult(id: string): XpbdConstraintResultN | undefined {
  return latestConstraintResults().find((result) => result.id === id);
}

function latestConstraintResults(): readonly XpbdConstraintResultN[] {
  if (state?.lastStep === null || state?.lastStep === undefined) return [];
  const substep = state.lastStep.constraintSolves[state.lastStep.constraintSolves.length - 1];
  return substep?.solve.constraints ?? [];
}

function sourcePoint(vertex: number): Float64Array {
  if (state === null) throw new Error('mechanics workbench: state is unavailable');
  return state.source.positions.subarray(vertex * 4, vertex * 4 + 4);
}

function signedDistance(point: ArrayLike<number>): number {
  if (state === null) throw new Error('mechanics workbench: state is unavailable');
  return state.slice.signedDistance(point[0]!, point[1]!, point[2]!, point[3]!);
}

function sectionChart(point: ArrayLike<number>): [number, number, number] {
  if (state === null) throw new Error('mechanics workbench: state is unavailable');
  const origin = state.slice.normal.data;
  const chart: [number, number, number] = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    let coordinate = 0;
    for (let component = 0; component < 4; component++) {
      coordinate += state.slice.basis[axis]![component]! * (
        point[component]! - origin[component]! * state.slice.offset
      );
    }
    chart[axis] = coordinate;
  }
  return chart;
}

function selectedEdgeLine(offsetX: number): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
  const line = new LineSegments(
    geometry,
    new LineBasicMaterial({
      color: 0xdcff74,
      transparent: true,
      opacity: 1,
      depthTest: false
    })
  );
  line.position.x = offsetX;
  line.renderOrder = 19;
  line.frustumCulled = false;
  return line;
}

function selectedEdgePoints(geometry: BufferGeometry, offsetX: number): Points {
  const points = new Points(
    geometry,
    new PointsMaterial({
      color: 0xdcff74,
      size: 0.2,
      sizeAttenuation: true,
      depthTest: false
    })
  );
  points.position.x = offsetX;
  points.renderOrder = 20;
  points.frustumCulled = false;
  return points;
}

function updateLine(
  line: LineSegments,
  from: readonly [number, number, number],
  to: readonly [number, number, number]
): void {
  const attribute = line.geometry.getAttribute('position') as BufferAttribute;
  attribute.setXYZ(0, from[0], from[1], from[2]);
  attribute.setXYZ(1, to[0], to[1], to[2]);
  attribute.needsUpdate = true;
}

function pinCloud(count: number, offsetX: number): Points {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
  const points = new Points(
    geometry,
    new PointsMaterial({
      color: 0xffdf74,
      size: 0.14,
      sizeAttenuation: true,
      depthTest: false
    })
  );
  points.position.x = offsetX;
  points.renderOrder = 18;
  points.frustumCulled = false;
  return points;
}

function updatePins(
  points: Points,
  vertices: readonly number[],
  projection: Projection
): void {
  const attribute = points.geometry.getAttribute('position') as BufferAttribute;
  for (let index = 0; index < vertices.length; index++) {
    const projected = projection.projectPoint(sourcePoint(vertices[index]!));
    attribute.setXYZ(index, projected[0], projected[1], projected[2]);
  }
  attribute.needsUpdate = true;
}

function disposePoints(points: Points): void {
  points.geometry.dispose();
  const material = points.material;
  if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
  else material.dispose();
}

function scientific(value: number): string {
  return value === 0 ? '0.000e+0' : value.toExponential(3);
}

function syncControlLabels(): void {
  const compliance = 10 ** Number(complianceInput.value);
  document.getElementById('complianceValue')!.textContent = compliance.toExponential(1);
  const materialMode = materialModeInput.value as MaterialMode;
  const interiorOption = materialModeInput.querySelector(
    'option[value="interior"]'
  ) as HTMLOptionElement;
  interiorOption.disabled = modeInput.value === 'r3';
  measureComplianceInput.disabled = materialMode === 'edge';
  document.getElementById('measureComplianceValue')!.textContent =
    materialMode !== 'edge'
      ? (10 ** Number(measureComplianceInput.value)).toExponential(1)
      : 'locked';
  document.getElementById('driveValue')!.textContent = state?.mode === 'r3'
    ? 'locked'
    : Number(driveInput.value).toFixed(1);
  document.getElementById('sliceOffsetValue')!.textContent =
    Number(sliceOffsetInput.value).toFixed(2);
  document.getElementById('edgeValue')!.textContent = edgeInput.value;
}

modeInput.addEventListener('change', rebuildState);
complianceInput.addEventListener('input', syncControlLabels);
complianceInput.addEventListener('change', rebuildState);
materialModeInput.addEventListener('change', rebuildState);
measureComplianceInput.addEventListener('input', syncControlLabels);
measureComplianceInput.addEventListener('change', rebuildState);
driveInput.addEventListener('input', syncControlLabels);
sliceOffsetInput.addEventListener('input', () => {
  if (state !== null) {
    state.slice.offset = Number(sliceOffsetInput.value);
    updateRepresentations();
  }
  syncControlLabels();
});
edgeInput.addEventListener('input', () => {
  syncControlLabels();
  updateSelectedEdge();
  updateEvidence();
});
pauseButton.addEventListener('click', () => {
  paused = !paused;
  pauseButton.textContent = paused ? 'resume' : 'pause';
});
resetButton.addEventListener('click', rebuildState);

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function animate(now: number): void {
  const frameDuration = Math.min((now - previousTime) / 1000, 0.05);
  previousTime = now;
  if (!paused) {
    accumulator += frameDuration;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < MAX_CATCH_UP_STEPS) {
      stepSimulation();
      accumulator -= FIXED_STEP;
      steps++;
    }
    if (steps === MAX_CATCH_UP_STEPS) accumulator = Math.min(accumulator, FIXED_STEP);
    if (steps > 0) updateRepresentations();
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

rebuildState();
setupShowcaseUI();
requestAnimationFrame(animate);
