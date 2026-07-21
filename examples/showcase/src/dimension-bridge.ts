import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SphereGeometry,
  Triangle,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  BivectorN,
  CoordinateProjection,
  HyperplaneSlice4,
  PerspectiveProjection,
  Rotor4,
  TransformN,
  VecN,
  affineSectionMapRecipe4,
  affineSliceChartMapRecipe4,
  createRepresentationLineageN,
  createSourceCellIdN,
  createSourceCellReferenceN,
  createSourceEdgeCoordinateN,
  createHypercube,
  evaluateRepresentationLineagePointN,
  evaluateProjectionFibre,
  evaluateSourceEdgeCoordinateN,
  inspectSourceCellReferenceN,
  projectPointToSourceEdgeN,
  projectionMapRecipeN,
  resolveSourceCellIdN,
  tetrahedralizeCuboidCells,
  type RepresentationHitN,
  type RepresentationLineageN,
  type SourceCellIdN,
  type SourceCellReferenceN,
  type SourceEdgeCoordinateN
} from '@holotope/core';
import {
  ProjectedEdges3D,
  ProjectedSurface3D,
  SlicedComplex3D,
  representationHitFromProjectedSurface,
  representationHitFromSlicedComplex
} from '@holotope/three';
import {
  PhysicsWorld4,
  RigidBody4,
  massPropertiesFromCellComplex4,
  rebasePositionsToPrincipalFrame4
} from '@holotope/physics';
import { setupShowcaseUI } from './ui';

const container = document.getElementById('app')!;
const scene = new Scene();
scene.background = new Color(0x050710);

const camera = new PerspectiveCamera(41, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 3.1, 18.5);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 10;
controls.maxDistance = 30;
controls.target.set(0, 0.1, 0);

scene.add(new AmbientLight(0x91a9db, 1.35));
const keyLight = new DirectionalLight(0xffffff, 3.3);
keyLight.position.set(4, 7, 8);
scene.add(keyLight);
const rimLight = new DirectionalLight(0x65e5c0, 2.1);
rimLight.position.set(-6, -2, 3);
scene.add(rimLight);

// The source remains a topology-first R4 complex. Anisotropy makes hidden-axis
// motion visually distinguishable and gives the rigid body non-isotropic inertia.
const complex = tetrahedralizeCuboidCells(createHypercube({ dim: 4, size: 2 }));
const groupOrdinals = new Map<string, number>();
for (const group of complex.groups) {
  const family = `${group.dim}:${group.kind}:${group.verticesPerCell}`;
  const ordinal = groupOrdinals.get(family) ?? 0;
  groupOrdinals.set(family, ordinal + 1);
  group.key = `bridge-source:${family}:${ordinal}`;
}
const sideScales = [1.35, 0.92, 0.66, 0.43];
for (let vertex = 0; vertex < complex.vertexCount; vertex++) {
  for (let axis = 0; axis < 4; axis++) {
    complex.positions[vertex * 4 + axis]! *= sideScales[axis]!;
  }
}
const massProperties = massPropertiesFromCellComplex4(complex);
complex.positions = rebasePositionsToPrincipalFrame4(complex.positions, massProperties);

const perspective = new PerspectiveProjection({ fromDim: 4, viewDistance: 5.4 });
const perspectiveSurface = new ProjectedSurface3D(complex, perspective, {
  material: new MeshStandardMaterial({
    color: 0x529df4,
    emissive: 0x071b3a,
    roughness: 0.48,
    metalness: 0.08,
    side: DoubleSide,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    flatShading: true
  })
});
const perspectiveEdges = new ProjectedEdges3D(complex, perspective, {
  material: new LineBasicMaterial({ color: 0xb8ddff, transparent: true, opacity: 0.92 })
});
const perspectiveGroup = new Group();
perspectiveGroup.add(perspectiveSurface.object, perspectiveEdges.object);
perspectiveGroup.rotation.set(-0.1, 0.2, -0.03);
scene.add(perspectiveGroup);

const coordinateProjection = new CoordinateProjection({ fromDim: 4, axes: [0, 1, 3] });
const coordinateSurface = new ProjectedSurface3D(complex, coordinateProjection, {
  material: new MeshStandardMaterial({
    color: 0x52d5b0,
    emissive: 0x062a25,
    roughness: 0.5,
    metalness: 0.06,
    side: DoubleSide,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    flatShading: true
  })
});
const coordinateEdges = new ProjectedEdges3D(complex, coordinateProjection, {
  material: new LineBasicMaterial({ color: 0xb9ffe8, transparent: true, opacity: 0.9 })
});
const coordinateGroup = new Group();
coordinateGroup.add(coordinateSurface.object, coordinateEdges.object);
coordinateGroup.rotation.set(-0.08, -0.18, 0.025);
scene.add(coordinateGroup);

const slice = HyperplaneSlice4.axisAligned(3, 0.12);
const perspectivePointLineage = createRepresentationLineageN(4, [
  projectionMapRecipeN(perspective)
]);
const coordinatePointLineage = createRepresentationLineageN(4, [
  projectionMapRecipeN(coordinateProjection)
]);
const section = new SlicedComplex3D(complex, slice, {
  material: new MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x28100a,
    roughness: 0.52,
    side: DoubleSide,
    flatShading: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.92
  }),
  colorForTet: (tet) => [
    0xff875f,
    0xffbd62,
    0xe979a6,
    0xb28cff,
    0x68d8ce,
    0x94d66f
  ][Math.floor(tet / 6) % 6]!
});
const sectionGroup = new Group();
sectionGroup.add(section.object);
sectionGroup.rotation.set(-0.08, 0.2, -0.02);
scene.add(sectionGroup);

const body = new RigidBody4({
  mass: massProperties.mass,
  inertiaDiagonal: massProperties.inertiaDiagonal,
  gravityScale: 0
});
const world = new PhysicsWorld4({ gravity: [0, 0, 0, 0] }).addBody(body);

const perspectiveMarker = createMarker(0xdfff74);
const coordinateMarker = createMarker(0xdfff74);
const sectionMarker = createMarker(0xdfff74);
perspectiveSurface.object.add(perspectiveMarker);
coordinateSurface.object.add(coordinateMarker);
section.object.add(sectionMarker);

const perspectiveHighlight = createTriangleHighlight(0xeaff91);
const coordinateHighlight = createTriangleHighlight(0xeaff91);
const sectionHighlight = createTriangleHighlight(0xffffff);
perspectiveSurface.object.add(perspectiveHighlight);
coordinateSurface.object.add(coordinateHighlight);
section.object.add(sectionHighlight);

const connectorPositions = new Float32Array(9);
const connectorGeometry = new BufferGeometry();
connectorGeometry.setAttribute('position', new BufferAttribute(connectorPositions, 3));
const connector = new Line(
  connectorGeometry,
  new LineDashedMaterial({
    color: 0xdfff74,
    dashSize: 0.13,
    gapSize: 0.09,
    transparent: true,
    opacity: 0.62,
    depthTest: false
  })
);
connector.renderOrder = 18;
connector.visible = false;
scene.add(connector);

type ViewKind = 'perspective' | 'coordinate' | 'section';

interface BridgeSelection {
  sourcePointLocal: VecN;
  readonly sourceReference: SourceCellReferenceN;
  readonly sourceId: SourceCellIdN;
  readonly hit: RepresentationHitN;
  readonly origin: ViewKind;
  readonly faceIndex: number;
  activeFaceIndex: number;
  edgeCoordinate?: SourceEdgeCoordinateN;
  edgeBindDistance?: number;
}

let selection: BridgeSelection | null = null;
let paused = false;
let accumulator = 0;
let previousTime = performance.now();
let initialEnergy = 1;
let initialMomentum = new Float64Array(6);

const speedInput = document.getElementById('speed') as HTMLInputElement;
const sliceOffsetInput = document.getElementById('sliceOffset') as HTMLInputElement;
const followInput = document.getElementById('followSelection') as HTMLInputElement;
const pauseButton = document.getElementById('pause') as HTMLButtonElement;
const guidedTraceButton = document.getElementById('guidedTrace') as HTMLButtonElement;
const bindEdgeButton = document.getElementById('bindEdge') as HTMLButtonElement;
const edgeParameterInput = document.getElementById('edgeParameter') as HTMLInputElement;

function createMarker(color: number): Mesh {
  const marker = new Mesh(
    new SphereGeometry(0.12, 20, 14),
    new MeshBasicMaterial({ color, depthTest: false })
  );
  marker.renderOrder = 20;
  marker.visible = false;
  return marker;
}

function createTriangleHighlight(color: number): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  const highlight = new Mesh(
    geometry,
    new MeshBasicMaterial({
      color,
      side: DoubleSide,
      transparent: true,
      opacity: 0.8,
      depthTest: false
    })
  );
  highlight.renderOrder = 19;
  highlight.frustumCulled = false;
  highlight.visible = false;
  return highlight;
}

function showTriangle(highlight: Mesh, source: BufferGeometry, faceIndex: number): void {
  const sourcePositions = source.getAttribute('position');
  const target = highlight.geometry.getAttribute('position') as BufferAttribute;
  for (let corner = 0; corner < 3; corner++) {
    const vertex = faceIndex * 3 + corner;
    target.setXYZ(
      corner,
      sourcePositions.getX(vertex),
      sourcePositions.getY(vertex),
      sourcePositions.getZ(vertex)
    );
  }
  target.needsUpdate = true;
  highlight.visible = true;
}

function bodyTransform(): TransformN {
  return new TransformN(4, body.rotation, body.position);
}

function setPaused(value: boolean): void {
  paused = value;
  pauseButton.textContent = paused ? 'resume simulation' : 'pause simulation';
  updateJourney();
}

function resetBody(): void {
  body.position.data.fill(0);
  body.rotation = Rotor4.identity();
  body.linearVelocity.data.fill(0);
  body.angularMomentumWorld.coeffs.fill(0);
  body.clearAccumulators();
  body.setAngularVelocityWorld(
    new BivectorN(4, [0.16, 0.82, -0.24, 0.38, -0.61, 0.21])
  );
  initialEnergy = body.rotationalKineticEnergy();
  initialMomentum = Float64Array.from(body.angularMomentumWorld.coeffs);
  accumulator = 0;
  selection = null;
  for (const marker of [perspectiveMarker, coordinateMarker, sectionMarker]) {
    marker.visible = false;
  }
  for (const highlight of [perspectiveHighlight, coordinateHighlight, sectionHighlight]) {
    highlight.visible = false;
  }
  connector.visible = false;
  followInput.checked = true;
  slice.offset = 0.12;
  syncSliceOffset();
  setPaused(false);
  setTracePlaceholder();
  syncEdgeEditor();
}

function setTracePlaceholder(): void {
  document.getElementById('traceTitle')!.textContent = 'Select any representation';
  document.getElementById('traceSummary')!.textContent =
    'A selection will pause the body and retain one material point in body-local R4.';
  document.getElementById('traceSource')!.textContent =
    'The visible triangle remains linked to explicit source topology.';
  document.getElementById('traceLineage')!.textContent =
    'waiting for representation lineage';
  document.getElementById('tracePolicy')!.textContent =
    'policy: the exact section follows the selected material point';
  document.getElementById('traceResidual')!.textContent =
    'live map and conservation evidence will appear here';
  updateJourney();
}

function selectHit(hit: RepresentationHitN, origin: ViewKind, faceIndex: number): void {
  if (hit.source.kind !== 'cell' || hit.ambientPoint === undefined) {
    document.getElementById('traceTitle')!.textContent = 'This observation has no stable ambient lift';
    document.getElementById('traceSummary')!.textContent =
      `${hit.ambientPointStatus} · source identity remains ${hit.source.kind === 'cell' ? 'available' : 'unavailable'}`;
    return;
  }

  selection = {
    sourcePointLocal: bodyTransform().inverse().applyToPoint(hit.ambientPoint),
    sourceReference: hit.source.reference,
    sourceId: hit.source.id ?? createSourceCellIdN(hit.source.reference),
    hit,
    origin,
    faceIndex,
    activeFaceIndex: faceIndex
  };
  setPaused(true);
  perspectiveHighlight.visible = false;
  coordinateHighlight.visible = false;
  sectionHighlight.visible = false;
  if (origin === 'perspective') {
    showTriangle(perspectiveHighlight, perspectiveSurface.geometry, faceIndex);
  } else if (origin === 'coordinate') {
    showTriangle(coordinateHighlight, coordinateSurface.geometry, faceIndex);
  } else {
    showTriangle(sectionHighlight, section.geometry, faceIndex);
  }
  describeSelection();
  syncEdgeEditor();
}

function describeSelection(): void {
  if (selection === null) return;
  const hit = selection.hit;
  const source = hit.source;
  if (source.kind !== 'cell') return;
  const originLabel: Record<ViewKind, string> = {
    perspective: 'Perspective observation traced to R4',
    coordinate: 'Coordinate-subspace observation traced to R4',
    section: 'Exact section observation traced to R4'
  };
  const referenceStatus = inspectSourceCellReferenceN(selection.sourceReference);
  const coordinate = selection.edgeCoordinate;
  const structuralId = coordinate === undefined
    ? selection.sourceId
    : createSourceCellIdN(coordinate.reference);
  const structuralStatus = resolveSourceCellIdN(complex, structuralId);

  document.getElementById('traceTitle')!.textContent = originLabel[selection.origin];
  document.getElementById('traceSummary')!.textContent =
    `${hit.ambientPointStatus} material point ${formatR4(selection.sourcePointLocal.data)} · global ambiguity ${hit.ambiguity}`;
  document.getElementById('traceSource')!.textContent = coordinate === undefined
    ? `${structuralId.groupKey}#${structuralId.cellIndex} · ${selection.sourceReference.cellKind} ${source.intrinsicDim}-cell · reference ${referenceStatus.kind}/${structuralStatus.kind}`
    : `${structuralId.groupKey}#${structuralId.cellIndex} · source edge [${coordinate.reference.vertexIndices.join(' → ')}] · t ${coordinate.parameter.toFixed(4)} · body-local R4 authority`;
  document.getElementById('traceLineage')!.textContent =
    `map lineage · ${hit.lineage.steps.map((step) => step.kind).join('  →  ')}`;
  document.getElementById('tracePolicy')!.textContent = coordinate === undefined
    ? `${followInput.checked ? 'active' : 'inactive'} policy · retain this material point and keep the section incident`
    : `source-edge authority active · section incidence ${followInput.checked ? 'active' : 'inactive'} · all markers are derived outputs`;
  updateJourney();
}

function candidateSourceEdges(): SourceCellReferenceN[] {
  if (selection === null) return [];
  const sourceVertices = new Set(selection.sourceReference.vertexIndices);
  const candidates: SourceCellReferenceN[] = [];
  for (const group of complex.cellsOfDim(1)) {
    if (group.verticesPerCell !== 2) continue;
    const count = group.indices.length / 2;
    for (let edge = 0; edge < count; edge++) {
      const from = group.indices[edge * 2]!;
      const to = group.indices[edge * 2 + 1]!;
      if (sourceVertices.has(from) && sourceVertices.has(to)) {
        candidates.push(createSourceCellReferenceN(complex, group, edge));
      }
    }
  }
  return candidates;
}

function bindSelectionToNearestSourceEdge(): void {
  if (selection === null) return;
  let best: ReturnType<typeof projectPointToSourceEdgeN> | undefined;
  for (const reference of candidateSourceEdges()) {
    const candidate = projectPointToSourceEdgeN(reference, selection.sourcePointLocal.data);
    if (best === undefined || candidate.squaredDistance < best.squaredDistance) {
      best = candidate;
    }
  }
  if (best === undefined) return;
  selection.edgeCoordinate = best.coordinate;
  selection.edgeBindDistance = Math.sqrt(best.squaredDistance);
  selection.sourcePointLocal = best.point;
  setPaused(true);
  describeSelection();
  syncEdgeEditor();
}

function syncEdgeEditor(): void {
  const state = document.getElementById('edgeState')!;
  const value = document.getElementById('edgeParameterValue')!;
  if (selection === null) {
    bindEdgeButton.disabled = true;
    edgeParameterInput.disabled = true;
    edgeParameterInput.value = '0.5';
    value.textContent = '—';
    state.textContent = 'select a source-backed point first';
    return;
  }
  const candidates = candidateSourceEdges();
  bindEdgeButton.disabled = candidates.length === 0;
  if (selection.edgeCoordinate === undefined) {
    edgeParameterInput.disabled = true;
    value.textContent = '—';
    state.textContent = candidates.length === 0
      ? 'this source cell contains no explicit 1-cell'
      : `${candidates.length} candidate edge${candidates.length === 1 ? '' : 's'} · nearest is chosen in body-local R4`;
    return;
  }
  edgeParameterInput.disabled = false;
  edgeParameterInput.value = selection.edgeCoordinate.parameter.toFixed(4);
  value.textContent = selection.edgeCoordinate.parameter.toFixed(3);
  state.textContent =
    `edge [${selection.edgeCoordinate.reference.vertexIndices.join(' → ')}] · initial R4 snap ${selection.edgeBindDistance!.toExponential(2)}`;
}

function followSelection(transform: TransformN): boolean {
  if (selection === null || !followInput.checked) return false;
  const ambient = transform.applyToPoint(selection.sourcePointLocal);
  const normal = slice.normal.data;
  const nextOffset =
    normal[0]! * ambient.data[0]! +
    normal[1]! * ambient.data[1]! +
    normal[2]! * ambient.data[2]! +
    normal[3]! * ambient.data[3]!;
  const changed = Math.abs(nextOffset - slice.offset) > 1e-12;
  slice.offset = nextOffset;
  syncSliceOffset();
  return changed;
}

function updateSelection(transform: TransformN): void {
  if (selection === null) return;
  const ambient = transform.applyToPoint(selection.sourcePointLocal);
  const perspectiveEvaluation = updateMarkerFromLineage(
    perspectiveMarker,
    perspectivePointLineage,
    ambient
  );
  updateMarkerFromLineage(coordinateMarker, coordinatePointLineage, ambient);
  updateMarkerFromLineage(sectionMarker, currentSectionPointLineage(), ambient);

  const planeResidual = Math.abs(slice.signedDistance(
    ambient.data[0]!,
    ambient.data[1]!,
    ambient.data[2]!,
    ambient.data[3]!
  ));
  refreshSelectionHighlight();
  updateConnector();

  const homogeneous = perspective.projectHomogeneousPoint(ambient.data);
  const q = homogeneous.coordinates[3]!;
  const projected = perspectiveEvaluation.kind === 'exact'
    ? perspectiveEvaluation.point.data
    : perspective.projectPoint(ambient.data);
  const homogeneousPoint = homogeneous.coordinates.slice(0, 3).map((value) => value / q);
  const forwardResidual = Math.hypot(
    projected[0] - homogeneousPoint[0]!,
    projected[1] - homogeneousPoint[1]!,
    projected[2] - homogeneousPoint[2]!
  );
  const fibrePoint = evaluateProjectionFibre(
    perspective.inverseFibre(projected),
    [ambient.data[3]!]
  );
  const fibreResidual = fibrePoint.distanceTo(ambient);
  const energyDrift = (body.rotationalKineticEnergy() - initialEnergy) / initialEnergy;
  document.getElementById('traceResidual')!.textContent =
    `forward ${forwardResidual.toExponential(2)} · fibre ${fibreResidual.toExponential(2)} · section ${planeResidual.toExponential(2)} · energy drift ${energyDrift.toExponential(2)} · q ${q >= 0 ? '+' : ''}${q.toFixed(3)}`;
}

const highlightTriangle = new Triangle();
const highlightClosestPoint = new Vector3();
const highlightA = new Vector3();
const highlightB = new Vector3();
const highlightC = new Vector3();

function refreshSelectionHighlight(): void {
  if (selection === null) return;
  if (selection.origin === 'perspective') {
    showTriangle(perspectiveHighlight, perspectiveSurface.geometry, selection.activeFaceIndex);
    return;
  }
  if (selection.origin === 'coordinate') {
    showTriangle(coordinateHighlight, coordinateSurface.geometry, selection.activeFaceIndex);
    return;
  }
  const target = selection.sourceReference;
  const positions = section.geometry.getAttribute('position');
  let closestFace = -1;
  let closestDistanceSquared = Number.POSITIVE_INFINITY;
  for (let face = 0; face < section.triangleCount; face++) {
    const reference = section.sourceReferenceOfFace(face);
    if (reference.group !== target.group || reference.cellIndex !== target.cellIndex) continue;
    const base = face * 3;
    highlightA.fromBufferAttribute(positions, base);
    highlightB.fromBufferAttribute(positions, base + 1);
    highlightC.fromBufferAttribute(positions, base + 2);
    highlightTriangle.set(highlightA, highlightB, highlightC);
    highlightTriangle.closestPointToPoint(sectionMarker.position, highlightClosestPoint);
    const distanceSquared = highlightClosestPoint.distanceToSquared(sectionMarker.position);
    if (distanceSquared < closestDistanceSquared) {
      closestDistanceSquared = distanceSquared;
      closestFace = face;
    }
  }
  if (closestFace < 0) {
    sectionHighlight.visible = false;
    return;
  }
  selection.activeFaceIndex = closestFace;
  showTriangle(sectionHighlight, section.geometry, closestFace);
}

function currentSectionPointLineage(): RepresentationLineageN {
  return createRepresentationLineageN(4, [
    affineSectionMapRecipe4(slice),
    affineSliceChartMapRecipe4(slice)
  ]);
}

function updateMarkerFromLineage(
  marker: Mesh,
  lineage: RepresentationLineageN,
  ambientPoint: VecN
): ReturnType<typeof evaluateRepresentationLineagePointN> {
  const evaluation = evaluateRepresentationLineagePointN(lineage, ambientPoint);
  if (evaluation.kind === 'exact' && evaluation.point.dim === 3) {
    marker.position.set(
      evaluation.point.data[0]!,
      evaluation.point.data[1]!,
      evaluation.point.data[2]!
    );
    marker.visible = true;
  } else {
    marker.visible = false;
  }
  return evaluation;
}

function updateConnector(): void {
  if (!perspectiveMarker.visible || !coordinateMarker.visible) {
    connector.visible = false;
    return;
  }
  perspectiveMarker.updateWorldMatrix(true, false);
  coordinateMarker.updateWorldMatrix(true, false);
  sectionMarker.updateWorldMatrix(true, false);
  const perspectivePoint = perspectiveMarker.getWorldPosition(new Vector3());
  const coordinatePoint = coordinateMarker.getWorldPosition(new Vector3());
  connectorPositions.set([
    perspectivePoint.x,
    perspectivePoint.y,
    perspectivePoint.z,
    coordinatePoint.x,
    coordinatePoint.y,
    coordinatePoint.z
  ]);
  let pointCount = 2;
  if (sectionMarker.visible) {
    const sectionPoint = sectionMarker.getWorldPosition(new Vector3());
    connectorPositions.set([sectionPoint.x, sectionPoint.y, sectionPoint.z], 6);
    pointCount = 3;
  }
  connectorGeometry.setDrawRange(0, pointCount);
  (connectorGeometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  connector.computeLineDistances();
  connector.visible = true;
}

function updatePhysicsDiagnostics(): void {
  let momentumDeltaSquared = 0;
  let momentumSquared = 0;
  for (let component = 0; component < 6; component++) {
    momentumDeltaSquared += (
      body.angularMomentumWorld.coeffs[component]! - initialMomentum[component]!
    ) ** 2;
    momentumSquared += initialMomentum[component]! ** 2;
  }
  const momentumResidual = Math.sqrt(momentumDeltaSquared / momentumSquared);
  const orthogonality = body.rotation.toMatrix().orthogonalityError();
  document.getElementById('modeState')!.textContent =
    `${paused ? 'paused for source inspection' : 'torque-free R4 body'} · |ΔL| ${momentumResidual.toExponential(1)} · RᵀR ${orthogonality.toExponential(1)}`;
}

function updateJourney(): void {
  const trace = document.getElementById('stageTrace')!;
  const constrain = document.getElementById('stageConstrain')!;
  const simulate = document.getElementById('stageSimulate')!;
  trace.className = selection === null ? 'active' : 'complete';
  constrain.className = selection === null
    ? ''
    : selection.edgeCoordinate === undefined
      ? 'active'
      : 'complete';
  simulate.className = selection?.edgeCoordinate === undefined ? '' : 'active';
}

function syncSliceOffset(): void {
  sliceOffsetInput.value = Math.max(
    Number(sliceOffsetInput.min),
    Math.min(Number(sliceOffsetInput.max), slice.offset)
  ).toFixed(3);
  document.getElementById('sliceOffsetValue')!.textContent = slice.offset.toFixed(3);
}

function formatR4(values: ArrayLike<number>): string {
  return `(${Array.from(values, (value) => value.toFixed(3)).join(', ')})`;
}

const raycaster = new Raycaster();
const pointer = new Vector2();
let pointerDownX = 0;
let pointerDownY = 0;

function loadGuidedTrace(): void {
  perspectiveSurface.object.updateWorldMatrix(true, false);
  camera.updateMatrixWorld(true);
  const projectedCenter = perspectiveGroup.position.clone().project(camera);
  const offsets = [
    [0, 0],
    [-0.06, 0],
    [0.06, 0],
    [0, -0.06],
    [0, 0.06]
  ] as const;
  for (const [dx, dy] of offsets) {
    raycaster.setFromCamera(
      pointer.set(projectedCenter.x + dx, projectedCenter.y + dy),
      camera
    );
    const intersection = raycaster.intersectObject(perspectiveSurface.object, false)
      .find((candidate) => candidate.faceIndex !== undefined);
    if (intersection === undefined) continue;
    selectHit(
      representationHitFromProjectedSurface(perspectiveSurface, {
        point: intersection.point,
        faceIndex: intersection.faceIndex!
      }),
      'perspective',
      intersection.faceIndex!
    );
    bindSelectionToNearestSourceEdge();
    return;
  }
  document.getElementById('traceTitle')!.textContent = 'Guided trace is temporarily out of view';
  document.getElementById('traceSummary')!.textContent =
    'Reset the camera or click any visible solid to create the same source-backed trace.';
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  pointerDownX = event.clientX;
  pointerDownY = event.clientY;
});

renderer.domElement.addEventListener('pointerup', (event) => {
  if (Math.hypot(event.clientX - pointerDownX, event.clientY - pointerDownY) > 4) return;
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.set(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    -((event.clientY - bounds.top) / bounds.height) * 2 + 1
  );
  raycaster.setFromCamera(pointer, camera);
  const intersection = raycaster.intersectObjects([
    perspectiveSurface.object,
    coordinateSurface.object,
    section.object
  ], false).find((candidate) => candidate.faceIndex !== undefined);
  if (!intersection) return;
  const faceIndex = intersection.faceIndex!;
  if (intersection.object === perspectiveSurface.object) {
    selectHit(
      representationHitFromProjectedSurface(perspectiveSurface, {
        point: intersection.point,
        faceIndex
      }),
      'perspective',
      faceIndex
    );
  } else if (intersection.object === coordinateSurface.object) {
    selectHit(
      representationHitFromProjectedSurface(coordinateSurface, {
        point: intersection.point,
        faceIndex
      }),
      'coordinate',
      faceIndex
    );
  } else {
    selectHit(
      representationHitFromSlicedComplex(section, {
        point: intersection.point,
        faceIndex
      }),
      'section',
      faceIndex
    );
  }
});

pauseButton.addEventListener('click', () => setPaused(!paused));
guidedTraceButton.addEventListener('click', loadGuidedTrace);
document.getElementById('reset')!.addEventListener('click', resetBody);
bindEdgeButton.addEventListener('click', bindSelectionToNearestSourceEdge);

edgeParameterInput.addEventListener('input', () => {
  if (selection?.edgeCoordinate === undefined) return;
  selection.edgeCoordinate = createSourceEdgeCoordinateN(
    selection.edgeCoordinate.reference,
    Number(edgeParameterInput.value),
    { clamp: false }
  );
  selection.sourcePointLocal = evaluateSourceEdgeCoordinateN(selection.edgeCoordinate);
  syncEdgeEditor();
  describeSelection();
});

speedInput.addEventListener('input', () => {
  document.getElementById('speedValue')!.textContent = Number(speedInput.value).toFixed(2);
});

sliceOffsetInput.addEventListener('input', () => {
  followInput.checked = false;
  slice.offset = Number(sliceOffsetInput.value);
  sectionHighlight.visible = false;
  syncSliceOffset();
  if (selection !== null) describeSelection();
});

followInput.addEventListener('change', () => {
  if (selection !== null) describeSelection();
});

function layout(): void {
  const portrait = innerHeight > innerWidth;
  const scale = portrait ? 1.05 : 1.22;
  perspectiveGroup.scale.setScalar(scale);
  coordinateGroup.scale.setScalar(scale);
  sectionGroup.scale.setScalar(scale);
  if (portrait) {
    perspectiveGroup.position.set(0, 3.25, 0);
    coordinateGroup.position.set(0, 0, 0);
    sectionGroup.position.set(0, -3.25, 0);
    camera.position.set(0, 2.1, 20.5);
  } else {
    perspectiveGroup.position.set(-4.3, 0, 0);
    coordinateGroup.position.set(0, 0, 0);
    sectionGroup.position.set(4.3, 0, 0);
    camera.position.set(0, 3.1, 17.25);
  }
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  layout();
});

layout();
resetBody();
setupShowcaseUI();

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const frameDt = Math.min(0.05, Math.max(0, (now - previousTime) / 1000));
  previousTime = now;
  if (!paused) accumulator += frameDt * Number(speedInput.value);
  const fixedDt = 1 / 120;
  let steps = 0;
  while (accumulator >= fixedDt && steps < 10) {
    world.step(fixedDt);
    accumulator -= fixedDt;
    steps++;
  }
  if (steps === 10 && accumulator >= fixedDt) accumulator = fixedDt;

  const transform = bodyTransform();
  followSelection(transform);
  perspectiveSurface.update(transform);
  perspectiveEdges.update(transform);
  coordinateSurface.update(transform);
  coordinateEdges.update(transform);
  section.update(transform);
  updateSelection(transform);
  updatePhysicsDiagnostics();
  controls.update();
  renderer.render(scene, camera);
});
