import { Group } from 'three';
import {
  OFFSET_LIMIT, REFERENCE_STATE, TURN_LIMIT, applyTo, createSlice, distanceFromPivot, observerNote,
  setOffset, setTheta, type TurnState
} from '../spatial-4d-turn/turn-state.js';
import { createViewport } from '../spatial-4d-turn/view.js';
import { GUIDE, actionLabel, type GuideStage } from './guide.js';
import {
  BALL, BOX, ContactSimulation, DEFAULT_SETTINGS, PRESETS, impactStepOf,
  type ContactReport, type Preset, type PresetId
} from './simulation.js';
import { RotationStudy, STUDY_PLANES, studyLandmarks, type StudyMode, type StudyRate } from './study.js';
import { SceneViews, inCut } from './views.js';

/**
 * The page: one collision simulation, three views of it, a separate
 * prescribed rotation study, and a guided sequence beside the free controls.
 *
 * Three kinds of control, and they never cross:
 * - TIME controls step, replay or relaunch the simulation (Play, Step, Step −1,
 *   Jump, Reset, presets). Every jump is a deterministic replay from launch.
 * - VIEW controls move the observer only (the knife, the projection toggle,
 *   the camera). They never touch a body, and never reset the clock.
 * - The STUDY is a separate scene with its own angle and clock; opening or
 *   closing it leaves the collision where it was.
 * The wiring test pins that this file never writes a body's velocity,
 * momentum, position or impulse — motion comes from `ContactSimulation.step()`
 * and from nothing else here.
 */

const deg = (radians: number): number => (radians * 180) / Math.PI;
const rad = (degrees: number): number => (degrees * Math.PI) / 180;
const fmt4 = (v: readonly number[], digits = 2): string => `(${v.map((c) => c.toFixed(digits)).join(', ')})`;

export function createApp(root: HTMLElement): void {
  const stage = root.querySelector<HTMLElement>('#stage')!;
  const panel = root.querySelector<HTMLElement>('#panel')!;

  /* ---------------- the knife (presentation) ---------------- */
  const slice = createSlice();
  let knife: TurnState = REFERENCE_STATE;

  /* ---------------- the simulation (authoritative) ---------------- */
  let presetId: PresetId = 'central';
  let sim = new ContactSimulation(presetOf(presetId));
  let launchMomentum = sim.totalMomentum();
  let launchAngular = sim.totalAngularMomentum();
  let launchEnergy = sim.kineticEnergy();
  /** What the last TIME action was, for the readout. */
  let timeNote = 'Launch state.';
  const impactSteps = new Map<PresetId, number>();
  const impactStep = (id: PresetId): number => {
    let n = impactSteps.get(id);
    if (n === undefined) {
      n = impactStepOf(presetOf(id)) ?? 0;
      impactSteps.set(id, n);
    }
    return n;
  };

  /* ---------------- the views ---------------- */
  const viewport = createViewport(stage);
  const views = new SceneViews(slice);
  const collisionRoot = new Group();
  collisionRoot.name = 'collision-scene';
  collisionRoot.add(views.box.object, views.ball.object, views.context.object);
  viewport.add(collisionRoot);

  /* ---------------- the rotation study (separate scene) ---------------- */
  const study = new RotationStudy();
  study.views.object.visible = false;
  viewport.add(study.views.object);
  let scene: 'collision' | 'study' = 'collision';

  /* ---------------- controls ---------------- */
  const presetCentral = panel.querySelector<HTMLInputElement>('#preset-central')!;
  const presetOffCentre = panel.querySelector<HTMLInputElement>('#preset-off-centre')!;
  const presetNote = panel.querySelector<HTMLElement>('#preset-note')!;
  const playButton = panel.querySelector<HTMLButtonElement>('#play')!;
  const stepButton = panel.querySelector<HTMLButtonElement>('#step')!;
  const stepBackButton = panel.querySelector<HTMLButtonElement>('#step-back')!;
  const jumpButton = panel.querySelector<HTMLButtonElement>('#jump-touch')!;
  const resetButton = panel.querySelector<HTMLButtonElement>('#reset')!;
  const timeOut = panel.querySelector<HTMLElement>('#time')!;
  const timeNoteOut = panel.querySelector<HTMLElement>('#time-note')!;
  const turn = panel.querySelector<HTMLInputElement>('#turn')!;
  const offset = panel.querySelector<HTMLInputElement>('#offset')!;
  const turnValue = panel.querySelector<HTMLElement>('#turn-value')!;
  const offsetValue = panel.querySelector<HTMLElement>('#offset-value')!;
  const pivotNote = panel.querySelector<HTMLElement>('#pivot-note')!;
  const knifeNote = panel.querySelector<HTMLElement>('#knife-note')!;
  const contextToggle = panel.querySelector<HTMLInputElement>('#context')!;
  const contextNote = panel.querySelector<HTMLElement>('#context-note')!;
  const readout = panel.querySelector<HTMLElement>('#readout')!;
  const guidePrev = panel.querySelector<HTMLButtonElement>('#guide-prev')!;
  const guideNext = panel.querySelector<HTMLButtonElement>('#guide-next')!;
  const guideTitle = panel.querySelector<HTMLElement>('#guide-title')!;
  const guideText = panel.querySelector<HTMLElement>('#guide-text')!;
  const guideAsk = panel.querySelector<HTMLElement>('#guide-ask')!;
  const guideActions = panel.querySelector<HTMLElement>('#guide-actions')!;
  const studyToggle = panel.querySelector<HTMLInputElement>('#study')!;
  const studyControls = panel.querySelector<HTMLElement>('#study-controls')!;
  const studyOrdinary = panel.querySelector<HTMLInputElement>('#study-ordinary')!;
  const studyFourth = panel.querySelector<HTMLInputElement>('#study-fourth')!;
  const studyAngle = panel.querySelector<HTMLInputElement>('#study-angle')!;
  const studyAngleValue = panel.querySelector<HTMLElement>('#study-angle-value')!;
  const studyPlay = panel.querySelector<HTMLButtonElement>('#study-play')!;
  const studyRateSlow = panel.querySelector<HTMLInputElement>('#study-rate-slow')!;
  const studyRateNormal = panel.querySelector<HTMLInputElement>('#study-rate-normal')!;
  const studyReset = panel.querySelector<HTMLButtonElement>('#study-reset')!;
  const studyLandmarksBox = panel.querySelector<HTMLElement>('#study-landmarks')!;
  const studyNote = panel.querySelector<HTMLElement>('#study-note')!;
  const studyChange = panel.querySelector<HTMLElement>('#study-change')!;
  const studyReadout = panel.querySelector<HTMLElement>('#study-readout')!;

  turn.min = String(-deg(TURN_LIMIT));
  turn.max = String(deg(TURN_LIMIT));
  offset.min = String(-OFFSET_LIMIT);
  offset.max = String(OFFSET_LIMIT);
  studyAngle.min = '0';
  studyAngle.max = '360';

  let playing = false;
  const setPlaying = (on: boolean): void => {
    playing = on;
    playButton.textContent = on ? 'Pause' : 'Play';
    playButton.setAttribute('aria-pressed', String(on));
  };
  const pause = (): void => { setPlaying(false); refresh(); };

  /** Presentation only: both scenes' context layers, the checkbox, the note. */
  const setContext = (on: boolean): void => {
    views.context.setVisible(on);
    study.views.context.visible = on;
    contextToggle.checked = on;
    contextNote.hidden = !on;
    contextNote.textContent = scene === 'study'
      ? `Faint lines: the study box’s 32 edges at its current pose, projected into the fixed section’s chart — the projection of the edges, not the outline of the projected solid.`
      : views.context.describe();
  };

  /* ---------------- TIME actions ---------------- */
  /** One fixed step of the authoritative simulation, then the views follow. */
  function stepOnce(): void {
    sim.step();
    timeNote = `Stepped forward one fixed step to step ${sim.steps} (t = ${sim.time.toFixed(3)} s).`;
    refresh();
  }

  /** Replay from launch to a step count: deterministic stepping, never a posed body. */
  function jumpTo(steps: number, why: string): void {
    setPlaying(false);
    sim = ContactSimulation.atStep(presetOf(presetId), steps);
    timeNote = `${why} Replayed from launch for ${steps} fixed steps: t = ${sim.time.toFixed(3)} s.`;
    refresh();
  }

  function stepBack(): void {
    if (sim.steps === 0) { timeNote = 'At launch already; nothing to step back to.'; refresh(); return; }
    jumpTo(sim.steps - 1, 'Stepped back one step.');
  }

  function jumpToFirstTouch(): void {
    const n = impactStep(presetId);
    if (n === 0) { timeNote = 'No impact found for this preset.'; refresh(); return; }
    jumpTo(n - 1, 'Jumped to the first touch — the next step applies the impulse.');
  }

  function jumpToAfterImpact(): void {
    const n = impactStep(presetId);
    if (n === 0) { timeNote = 'No impact found for this preset.'; refresh(); return; }
    jumpTo(n, 'Jumped to just after the impact.');
  }

  /** Deterministic reset: a fresh simulation of the chosen preset; the knife and the camera stay where they are. */
  function reset(id: PresetId = presetId): void {
    setPlaying(false);
    presetId = id;
    sim = new ContactSimulation(presetOf(id));
    launchMomentum = sim.totalMomentum();
    launchAngular = sim.totalAngularMomentum();
    launchEnergy = sim.kineticEnergy();
    presetCentral.checked = id === 'central';
    presetOffCentre.checked = id === 'off-centre';
    presetNote.textContent = presetOf(id).summary;
    timeNote = `Clock reset: launch state of ${presetOf(id).name}.`;
    refresh();
  }

  /* ---------------- the STUDY scene ---------------- */
  const setStudy = (open: boolean): void => {
    scene = open ? 'study' : 'collision';
    if (open) setPlaying(false); else study.setPlaying(false);
    collisionRoot.visible = !open;
    study.views.object.visible = open;
    studyToggle.checked = open;
    studyControls.hidden = !open;
    turn.disabled = open;
    offset.disabled = open;
    knifeNote.textContent = open
      ? 'Section fixed at w = 0 while the study is open; the knife returns when you close it.'
      : 'The knife moves only the picture: the bodies never feel it. Dragging the view walks around the cut.';
    setContext(contextToggle.checked);
    refresh();
    refreshStudy();
  };
  const setStudyMode = (mode: StudyMode): void => {
    studyChange.textContent = study.setMode(mode);
    studyOrdinary.checked = mode === 'ordinary';
    studyFourth.checked = mode === 'fourth';
    refreshStudy();
  };
  const setStudyPlaying = (on: boolean): void => {
    study.setPlaying(on);
    studyPlay.textContent = on ? 'Pause' : 'Play';
    studyPlay.setAttribute('aria-pressed', String(on));
  };
  const setStudyRate = (rate: StudyRate): void => {
    study.setRate(rate);
    studyRateSlow.checked = rate === 'slow';
    studyRateNormal.checked = rate === 'normal';
  };
  for (const mark of studyLandmarks()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = mark.name;
    button.title = mark.note;
    button.addEventListener('click', () => { setStudyPlaying(false); study.setAngle(mark.angle); studyChange.textContent = mark.note; refreshStudy(); });
    studyLandmarksBox.append(button);
  }

  /* ---------------- the GUIDE ---------------- */
  let guideIndex = 0;
  const guideRun: Record<string, () => void> = {
    'preset-a': () => { setStudy(false); reset('central'); },
    'knife-90': () => { knife = setTheta(knife, rad(90)); refresh(); },
    play: () => setPlaying(true),
    'jump-touch': jumpToFirstTouch,
    'step-back': stepBack,
    step: () => { setPlaying(false); stepOnce(); },
    'offset-hint': () => offset.focus(),
    'context-on': () => setContext(true),
    'knife-0': () => { knife = setTheta(knife, 0); refresh(); },
    'replay-a': () => { setStudy(false); reset('central'); setPlaying(true); },
    'study-open': () => setStudy(true),
    'preset-b': () => { setStudy(false); reset('off-centre'); },
    'jump-after': jumpToAfterImpact
  };
  function renderGuide(): void {
    const stage: GuideStage = GUIDE[guideIndex]!;
    guideTitle.textContent = `${stage.title} (${guideIndex + 1} of ${GUIDE.length})`;
    guideText.textContent = stage.text;
    guideAsk.textContent = stage.ask;
    guideActions.replaceChildren();
    for (const action of stage.actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `guide-action ${action.kind}`;
      button.textContent = actionLabel(action);
      button.dataset.action = action.id;
      button.addEventListener('click', () => guideRun[action.id]?.());
      guideActions.append(button);
    }
    guidePrev.disabled = guideIndex === 0;
    guideNext.disabled = guideIndex === GUIDE.length - 1;
  }

  // Every control's listener lives HERE, in one block; the wiring test holds
  // the page to having each of them, and to none of them writing a body.
  presetCentral.addEventListener('change', () => { if (presetCentral.checked) reset('central'); });
  presetOffCentre.addEventListener('change', () => { if (presetOffCentre.checked) reset('off-centre'); });
  playButton.addEventListener('click', () => { if (playing) pause(); else setPlaying(true); });
  stepButton.addEventListener('click', () => { setPlaying(false); stepOnce(); });
  stepBackButton.addEventListener('click', () => { stepBack(); });
  jumpButton.addEventListener('click', () => { jumpToFirstTouch(); });
  resetButton.addEventListener('click', () => { reset(); });
  turn.addEventListener('input', () => { knife = setTheta(knife, rad(Number(turn.value))); refresh(); });
  offset.addEventListener('input', () => { knife = setOffset(knife, Number(offset.value)); refresh(); });
  contextToggle.addEventListener('change', () => { setContext(contextToggle.checked); });
  panel.querySelector<HTMLButtonElement>('#reset-view')!
    .addEventListener('click', () => { viewport.resetCamera(); });
  guidePrev.addEventListener('click', () => { guideIndex = Math.max(0, guideIndex - 1); renderGuide(); });
  guideNext.addEventListener('click', () => { guideIndex = Math.min(GUIDE.length - 1, guideIndex + 1); renderGuide(); });
  studyToggle.addEventListener('change', () => { setStudy(studyToggle.checked); });
  studyOrdinary.addEventListener('change', () => { if (studyOrdinary.checked) setStudyMode('ordinary'); });
  studyFourth.addEventListener('change', () => { if (studyFourth.checked) setStudyMode('fourth'); });
  studyAngle.addEventListener('input', () => { setStudyPlaying(false); study.setAngle(rad(Number(studyAngle.value))); refreshStudy(); });
  studyPlay.addEventListener('click', () => { setStudyPlaying(!study.playing); });
  studyRateSlow.addEventListener('change', () => { if (studyRateSlow.checked) setStudyRate('slow'); });
  studyRateNormal.addEventListener('change', () => { if (studyRateNormal.checked) setStudyRate('normal'); });
  studyReset.addEventListener('click', () => { setStudyPlaying(false); study.reset(); studyChange.textContent = 'Reset to the reference: object angle 0°, paused; the mode is kept.'; refreshStudy(); });

  /* ---------------- refresh: views and readouts from the one state ---------------- */
  function refresh(): void {
    applyTo(slice, knife);
    views.update(sim, sim.lastImpact);
    if (scene === 'collision') contextNote.textContent = views.context.describe();

    timeOut.textContent = `${sim.time.toFixed(3)} s · step ${sim.steps}`;
    timeNoteOut.textContent = timeNote;
    turn.value = String(deg(knife.theta));
    offset.value = String(knife.offset);
    turnValue.textContent = `${deg(knife.theta).toFixed(1)}°`;
    offsetValue.textContent = knife.offset.toFixed(2);
    const note = observerNote(distanceFromPivot(slice));
    pivotNote.textContent = note.sentence;
    pivotNote.className = note.side === 'on-section' ? 'pivot on' : 'pivot off';

    const box = sim.state('box');
    const ball = sim.state('ball');
    const query = sim.query();
    const momentum = sim.totalMomentum();
    const angular = sim.totalAngularMomentum();
    const dP = Math.hypot(...momentum.map((v, i) => v - launchMomentum[i]!));
    const dL = Math.hypot(...angular.map((v, i) => v - launchAngular[i]!));

    const boxSection = views.box.status === 'present'
      ? `in this section — ${views.box.primitiveCount} triangles`
      : views.box.status === 'tangent'
        ? `touching the section along its boundary — nothing drawn (${views.box.cornersOnPlane} corners on the knife)`
        : `absent from this section — nearest corner ${Math.abs(views.box.nearestCorner).toFixed(2)} away`;
    const ballSection = views.ball.status === 'present'
      ? `in this section — a ball of radius ${views.ball.sectionRadius.toFixed(2)}`
      : views.ball.status === 'tangent'
        ? 'touching the section at one point'
        : `hidden from this section — its centre is ${Math.abs(views.ball.signedDistance).toFixed(2)} from the knife, its radius ${BALL.radius}`;

    const last = sim.lastImpact;
    const contactState = describeContact(query, last, last?.pointOnBox ? slice.signedDistance(last.pointOnBox) : null);

    readout.innerHTML =
      `<h3>Bodies</h3>`
      + bodyRow(BOX.name, BOX.colour, views.box.status, box.position, box.velocity, boxSection,
        `spin (x–w) ${box.angularVelocity[2]!.toFixed(3)} rad/s · other planes ${maxAbs(box.angularVelocity, [2]).toExponential(1)}`)
      + bodyRow(BALL.name, BALL.colour, views.ball.status, ball.position, ball.velocity, ballSection,
        `spin ${maxAbs(ball.angularVelocity, []).toExponential(1)} rad/s`)
      + `<div class="contact ${contactState.className}"><span class="state">${contactState.title}</span>${contactState.detail}</div>`
      + `<div class="contact separated"><span class="state">Conservation since launch</span>`
      + `<small>total momentum ${fmt4(momentum, 3)} · drift ${dP.toExponential(1)}</small>`
      + `<small>total angular momentum [xy, xz, xw, yz, yw, zw] ${fmt4(angular, 3)} · drift ${dL.toExponential(1)}</small>`
      + `<small>kinetic energy ${sim.kineticEnergy().toFixed(4)} (launch ${launchEnergy.toFixed(4)}) · impacts ${sim.impacts}</small></div>`;
  }

  function refreshStudy(): void {
    studyAngle.value = String(study.angleDegrees());
    studyAngleValue.textContent = `${study.angleDegrees().toFixed(1)}°`;
    studyNote.textContent = study.describe();
    const vertices = study.views.sectionVertices();
    const extent = (axis: number): string => (vertices.length ? Math.max(...vertices.map((v) => Math.abs(v[axis]!))) : 0).toFixed(3);
    const faces = [...study.views.box.presentFaces].map((o) => study.views.box.faces[o]!.name).sort().join(' ');
    studyReadout.innerHTML =
      `<div class="row"><span>object angle · plane</span><code>${study.angleDegrees().toFixed(1)}° · ${STUDY_PLANES[study.mode].label}</code></div>`
      + `<div class="row"><span>section (fixed) </span><code>w = 0 · frame x, y, z</code></div>`
      + `<div class="row"><span>section half-extents x, y, z</span><code>${extent(0)}, ${extent(1)}, ${extent(2)}</code></div>`
      + `<div class="row"><span>faces bounding the section</span><code>${faces || '—'}</code></div>`
      + `<div class="row"><span>source box</span><code>rigid rotor, ${BOX.halfExtents.join(' × ')}, no translation</code></div>`;
    if (scene === 'study') setContextNoteForStudy();
  }
  function setContextNoteForStudy(): void {
    if (contextToggle.checked) {
      contextNote.textContent = 'Faint lines: the study box’s 32 edges at its current pose, projected into the fixed section’s chart '
        + '— the projection of the edges, not the outline of the projected solid. The solid cut always lies inside them.';
    }
  }

  function bodyRow(name: string, colour: string, status: string, position: readonly number[], velocity: readonly number[], section: string, spin: string): string {
    return `<div class="object ${status}"><span class="swatch" style="background:${colour}"></span><b>${name}</b>`
      + `<span class="status">${section}</span>`
      + `<small>position <code>${fmt4(position)}</code> · velocity <code>${fmt4(velocity)}</code></small>`
      + `<small>${spin}</small></div>`;
  }

  /* ---------------- start ---------------- */
  reset('central');
  setContext(false);
  setStudy(false);
  setStudyMode('ordinary');
  setStudyRate('slow');
  setStudyPlaying(false);
  renderGuide();

  // Fixed steps from wall-clock time for the collision, at most a handful per
  // frame; the study's angle advances from the same clock while it is open.
  let lastTick = performance.now();
  let accumulator = 0;
  const loop = (): void => {
    const now = performance.now();
    const elapsed = Math.min(0.1, (now - lastTick) / 1000);
    if (scene === 'study') {
      if (study.playing) { study.advance(elapsed); refreshStudy(); }
      accumulator = 0;
    } else if (playing) {
      accumulator += elapsed;
      let steps = 0;
      while (accumulator >= DEFAULT_SETTINGS.dt && steps < 8) {
        sim.step();
        accumulator -= DEFAULT_SETTINGS.dt;
        steps++;
      }
      if (steps > 0) { timeNote = 'Playing: fixed steps from the wall clock.'; refresh(); }
    } else {
      accumulator = 0;
    }
    lastTick = now;
    viewport.render();
    requestAnimationFrame(loop);
  };
  loop();
  window.addEventListener('resize', () => viewport.resize());

  // Named for the verification pass: one place to read the authoritative state
  // and the views of it, and to drive the same functions the controls call.
  Object.defineProperty(window, '__contact', {
    value: {
      preset: () => presetId,
      scene: () => scene,
      time: () => sim.time,
      steps: () => sim.steps,
      state: () => ({ box: sim.state('box'), ball: sim.state('ball') }),
      contact: () => sim.contact,
      lastContact: () => sim.lastImpact,
      query: () => sim.query(),
      momentum: () => sim.totalMomentum(),
      angularMomentum: () => sim.totalAngularMomentum(),
      energy: () => sim.kineticEnergy(),
      impacts: () => sim.impacts,
      timeNote: () => timeNote,
      step: () => { setPlaying(false); stepOnce(); },
      stepBack,
      jumpToFirstTouch,
      jumpToAfterImpact,
      impactStep: () => impactStep(presetId),
      play: () => setPlaying(true),
      pause,
      playing: () => playing,
      reset: (id?: PresetId) => reset(id),
      knife: () => ({ theta: knife.theta, offset: knife.offset, normal: Array.from(slice.normal.data), disabled: turn.disabled }),
      setTurn: (degrees: number) => { knife = setTheta(knife, rad(degrees)); refresh(); },
      setOffset: (value: number) => { knife = setOffset(knife, value); refresh(); },
      setContext,
      setStudy,
      study: () => ({
        open: scene === 'study',
        mode: study.mode,
        angleDeg: study.angleDegrees(),
        playing: study.playing,
        rate: study.rate,
        sliceNormal: Array.from(study.slice.normal.data),
        sliceBasis: study.slice.basis.map((b) => Array.from(b)),
        sectionStatus: study.views.box.status,
        sectionPrimitives: study.views.box.primitiveCount,
        faces: [...study.views.box.presentFaces].map((o) => study.views.box.faces[o]!.name).sort(),
        sectionVertices: study.views.sectionVertices().map((v) => v.map((c) => Number(c.toFixed(4)))),
        contextVertices: study.views.contextVertices().map((v) => v.map((c) => Number(c.toFixed(4)))),
        contextVisible: study.views.context.visible
      }),
      studySetMode: setStudyMode,
      studySetAngle: (degrees: number) => { setStudyPlaying(false); study.setAngle(rad(degrees)); refreshStudy(); },
      studyPlay: () => setStudyPlaying(true),
      studyPause: () => setStudyPlaying(false),
      studyReset: () => { setStudyPlaying(false); study.reset(); refreshStudy(); },
      guide: () => ({ index: guideIndex, stage: GUIDE[guideIndex]!.id, actions: GUIDE[guideIndex]!.actions.map((a) => a.id) }),
      guideGo: (index: number) => { guideIndex = Math.max(0, Math.min(GUIDE.length - 1, index)); renderGuide(); },
      guideRun: (id: string) => guideRun[id]?.(),
      views: () => ({
        box: { status: views.box.status, primitives: views.box.primitiveCount, faces: [...views.box.presentFaces].map((o) => views.box.faces[o]!.name).sort(), visible: views.box.object.visible },
        ball: { status: views.ball.status, primitives: views.ball.primitiveCount, signedDistance: views.ball.signedDistance, visible: views.ball.object.visible },
        context: {
          visible: views.context.visible,
          edges: views.context.edgeCount(),
          boxVertices: views.context.vertexPositions().map((v) => v.map((c) => Number(c.toFixed(4)))),
          ballCentre: views.context.ball.chartCentre().map((c) => Number(c.toFixed(4))),
          ballRadius: views.context.ball.radius,
          contactMarkerSignedDistance: views.context.contactSignedDistance,
          contactInCut: views.context.contactInCut()
        },
        collisionVisible: collisionRoot.visible
      }),
      camera: () => viewport.camera.position.toArray()
    },
    configurable: true
  });
}

function presetOf(id: PresetId): Preset {
  return PRESETS.find((p) => p.id === id)!;
}

function maxAbs(values: readonly number[], skip: readonly number[]): number {
  return Math.max(0, ...values.filter((_v, i) => !skip.includes(i)).map(Math.abs));
}

/** The contact readout: the geometric relation now, and what the last impact did, labelled by the query's own status. */
function describeContact(query: ContactReport, last: ContactReport | null, lastPointSigned: number | null): { className: string; title: string; detail: string } {
  const normal = query.normal ? fmt4(query.normal, 2) : 'none';
  let title: string;
  let className: string;
  switch (query.state) {
    case 'separated':
      title = `Apart — gap ${query.gap!.toFixed(3)} along the contact normal ${normal}`;
      className = 'separated';
      break;
    case 'touching':
      title = 'Touching — gap 0 along the contact normal';
      className = 'touching';
      break;
    case 'overlapping':
      title = `Overlapping — depth ${query.penetrationDepth.toFixed(4)} along the contact normal ${normal}`;
      className = 'overlapping';
      break;
    case 'ambiguous-interior':
      title = 'Unsupported here: the ball’s centre is inside the box with tied exits, so the query has no normal';
      className = 'unsupported';
      break;
    default:
      title = `Contact state: ${query.state}`;
      className = 'unsupported';
  }
  const impact = last && last.pointOnBox && lastPointSigned !== null
    ? `<small>last impact: impulse ${last.impulse.toFixed(4)} along ${fmt4(last.normal ?? [0, 0, 0, 0], 2)} at `
      + `<code>${fmt4(last.pointOnBox)}</code>; that point’s signed distance from the current section is `
      + `${lastPointSigned.toFixed(2)} — ${inCut(lastPointSigned) ? 'it lies in this cut' : 'it is not in this cut'}.`
      + `${last.initialNormalSpeed !== null ? ` Closing speed ${(-last.initialNormalSpeed).toFixed(3)}, separating ${last.finalNormalSpeed!.toFixed(3)}.` : ''}</small>`
    : '<small>no impact yet</small>';
  return { className, title, detail: impact };
}
