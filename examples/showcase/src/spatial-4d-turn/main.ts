import { Box3, Mesh, Raycaster, Vector2, Vector3, type Intersection, type Object3D } from 'three';
import { SCENE } from './scene.js';
import { ContextLayer } from './context.js';
import { EventScanner } from './events.js';
import { GRAZE_EPSILON, createProducts, grazeRadiusOf, type SectionProduct } from './section.js';
import {
  OFFSET_LIMIT, REFERENCE_STATE, TURN_LIMIT, applyTo, createSlice,
  distanceFromPivot, observerNote, reset, setOffset, setPhase, setTheta, type TurnState
} from './turn-state.js';

/** Seconds per revolution of the ball along its path when playing. */
const PATH_PERIOD_S = 12;
import { createViewport } from './view.js';

const deg = (radians: number): number => (radians * 180) / Math.PI;
const rad = (degrees: number): number => (degrees * Math.PI) / 180;

export function createApp(root: HTMLElement): void {
  const stage = root.querySelector<HTMLElement>('#stage')!;
  const panel = root.querySelector<HTMLElement>('#panel')!;

  const slice = createSlice();
  let state: TurnState = REFERENCE_STATE;

  const viewport = createViewport(stage);
  const products: SectionProduct[] = createProducts(SCENE, slice);
  for (const product of products) viewport.add(product.object);

  // Projection context — the whole objects projected into the same chart —
  // on its own root beside the products, never under one of them, so picking
  // (which walks the products' meshes) cannot see it. Off until asked for.
  const context = new ContextLayer(products, slice);
  viewport.add(context.object);

  /* ---------------- controls ---------------- */
  const turn = panel.querySelector<HTMLInputElement>('#turn')!;
  const offset = panel.querySelector<HTMLInputElement>('#offset')!;
  const turnValue = panel.querySelector<HTMLElement>('#turn-value')!;
  const offsetValue = panel.querySelector<HTMLElement>('#offset-value')!;
  const pivotNote = panel.querySelector<HTMLElement>('#pivot-note')!;
  const readout = panel.querySelector<HTMLElement>('#readout')!;
  const facesBox = panel.querySelector<HTMLElement>('#faces')!;
  const pickedBox = panel.querySelector<HTMLElement>('#picked')!;
  const turnMarks = panel.querySelector<HTMLElement>('#turn-marks')!;
  const phase = panel.querySelector<HTMLInputElement>('#phase')!;
  const phaseValue = panel.querySelector<HTMLElement>('#phase-value')!;
  const phaseMarks = panel.querySelector<HTMLElement>('#phase-marks')!;
  const playButton = panel.querySelector<HTMLButtonElement>('#play')!;
  const contextToggle = panel.querySelector<HTMLInputElement>('#context')!;
  const contextNote = panel.querySelector<HTMLElement>('#context-note')!;
  /**
   * Show or hide the projection context. Presentation only: one visibility
   * flag, the checkbox, and the note that says what the faint geometry is.
   * The model, the slice, the phase, the camera, the selection and every
   * classification are untouched, and the wiring test pins that.
   */
  const setContext = (on: boolean): void => {
    context.setVisible(on);
    contextToggle.checked = on;
    contextNote.hidden = !on;
    contextNote.textContent = context.describe();
  };
  let playing = false;
  const setPlaying = (on: boolean): void => {
    playing = on;
    playButton.textContent = on ? 'Pause' : 'Play';
    playButton.setAttribute('aria-pressed', String(on));
  };
  /**
   * The one way to stop, shared by the button and the verification probe: it
   * refreshes at the phase the ball actually stopped at, so the knife's marks —
   * throttled while playing — never stay behind the paused ball. Found in
   * review: the button toggled without refreshing while the probe refreshed.
   */
  const pause = (): void => { setPlaying(false); update(); };

  turn.min = String(-deg(TURN_LIMIT));
  turn.max = String(deg(TURN_LIMIT));
  offset.min = String(-OFFSET_LIMIT);
  offset.max = String(OFFSET_LIMIT);

  turn.addEventListener('input', () => { state = setTheta(state, rad(Number(turn.value))); update(); });

  // Annotate each slider with what happens along it, GIVEN where the other
  // slider is. The angles come from driving a private copy of the same products
  // across the slider's own grid, so they are found, not typed — and they are
  // found again whenever the other control moves, because the events along one
  // control depend on the value of the other.
  const scanner = new EventScanner(SCENE);
  const offsetMarks = panel.querySelector<HTMLElement>('#offset-marks')!;
  const THUMB = 16; // native thumb width, so a mark sits over the thumb's centre
  const fmt = (v: number, unit: string): string => `${Number(v.toFixed(2))}${unit}`;

  function renderMarks(
    host: HTMLElement, ev: ReturnType<EventScanner['turnEvents']>, unit: string, otherName: string
  ): void {
    const span = ev.max - ev.min;
    const at = (v: number): string =>
      `calc(${THUMB / 2}px + (100% - ${THUMB}px) * ${(v - ev.min) / span})`;
    const width = (a: number, b: number): string => `calc((100% - ${THUMB}px) * ${(b - a) / span})`;
    const parts: string[] = [];
    for (const w of ev.companionWindows) {
      parts.push(`<span class="mark-band" style="left:${at(w.enter)};width:${width(w.enter, w.exit)}" `
        + `title="companion in the cut from ${fmt(w.enter, unit)} to ${fmt(w.exit, unit)}"></span>`
        + `<span class="mark-label" style="left:${at((w.enter + w.exit) / 2)}">ball in cut</span>`);
    }
    // Where the block leaves the cut entirely, mark the edge of its window.
    for (const w of ev.blockWindows) {
      for (const edge of [w.enter, w.exit]) {
        if (edge > ev.min + ev.gridStep / 2 && edge < ev.max - ev.gridStep / 2) {
          parts.push(`<span class="mark-tick block" style="left:${at(edge)}" `
            + `title="block leaves the cut beyond ${fmt(edge, unit)}"></span>`
            + `<span class="mark-label below" style="left:${at(edge)}">block out</span>`);
        }
      }
    }
    // Face changes are deliberately NOT drawn on the sliders. Centred, they are
    // one clean flip at the diagonal and read well; off-centre the two ends of
    // an axis are reached at different angles and one flip becomes four partial
    // changes, and a mark that needs set-difference notation to read has stopped
    // helping. Which ends bound the block is said, live, in the block's own line.
    // The scanner still computes them, and the tests still hold the flip to the
    // diagonal, so the fact is kept even though the tick is not.
    // An empty row is a true statement too, and must not look like a broken one:
    // at this value of the other control, nothing along this slider changes
    // what is in the cut.
    if (parts.length === 0) {
      parts.push(`<span class="mark-label quiet" style="left:50%">nothing enters or leaves along `
        + `this slider at the current ${otherName}</span>`);
    }
    host.innerHTML = parts.join('');
    // Labels that would overlap are hidden, left to right; the tick stays and
    // its tooltip carries the full statement. Off-centre, several changes can
    // fall within a few pixels, and two legible labels beat four illegible ones.
    const placed: DOMRect[] = [];
    for (const label of Array.from(host.querySelectorAll<HTMLElement>('.mark-label'))
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)) {
      const r = label.getBoundingClientRect();
      const collides = placed.some((q) => r.left < q.right + 4 && q.left < r.right + 4
        && r.top < q.bottom && q.top < r.bottom);
      if (collides) label.classList.add('hidden-label'); else placed.push(r);
    }
    // Shown the way the readouts show them: offset to 0.01, angles to 0.1°.
    const atText = Object.entries(ev.at)
      .map(([k, v]) => `${k} ${k === 'offset' ? v.toFixed(2) : `${v.toFixed(1)}°`}`).join(', ');
    host.title = `Marks for the current ${otherName} (${atText}), found by scanning this slider’s `
      + 'grid with the same sections the view draws. Positions assume a 16px thumb and are '
      + 'approximate to a few pixels.';
  }

  let turnMarksAt: string | null = null;
  let offsetMarksAt: string | null = null;
  let phaseMarksAt: string | null = null;
  let lastKnifeRescan = 0;
  function refreshMarks(): void {
    const thetaDeg = Number(deg(state.theta).toFixed(1));
    // The phase the ball is actually at, never rounded: rounding it to the
    // slider's step answered a different question within a fraction of a degree
    // of an entry or exit (found in review). The readout shows the same value
    // to 0.1°, so the marks and the readout agree by construction.
    const phaseDeg = deg(state.phase);
    // The knife's two rows depend on the phase, which changes every frame while
    // playing; rescanning them is cheap but not free, so while playing they
    // follow at a few times a second, and `pause()` refreshes them at the exact
    // stopped phase.
    const now = performance.now();
    const knifeDue = !playing || now - lastKnifeRescan > 250;
    if (knifeDue) {
      const turnKey = `${state.offset}|${phaseDeg}`;
      if (turnMarksAt !== turnKey) {
        renderMarks(turnMarks, scanner.turnEvents(state.offset, phaseDeg, Number(turn.step) || 0.5), '°', 'offset and phase');
        turnMarksAt = turnKey;
      }
      const offsetKey = `${thetaDeg}|${phaseDeg}`;
      if (offsetMarksAt !== offsetKey) {
        renderMarks(offsetMarks, scanner.offsetEvents(thetaDeg, phaseDeg, Number(offset.step) || 0.01), '', 'turn and phase');
        offsetMarksAt = offsetKey;
      }
      lastKnifeRescan = now;
    }
    const phaseKey = `${thetaDeg}|${state.offset}`;
    if (phaseMarksAt !== phaseKey) {
      renderMarks(phaseMarks, scanner.phaseEvents(thetaDeg, state.offset, Number(phase.step) || 1), '°', 'turn and offset');
      phaseMarksAt = phaseKey;
    }
  }

  // Every control's listener lives HERE, in one block, and wiring.test.ts holds
  // main.ts to having each of them. Twice now a range replacement elsewhere in
  // this file swallowed this block, leaving sliders that moved and did nothing.
  offset.addEventListener('input', () => { state = setOffset(state, Number(offset.value)); update(); });
  phase.addEventListener('input', () => { state = setPhase(state, rad(Number(phase.value))); update(); });
  playButton.addEventListener('click', () => { if (playing) pause(); else setPlaying(true); });
  contextToggle.addEventListener('change', () => { setContext(contextToggle.checked); });
  panel.querySelector<HTMLButtonElement>('#reset-section')!
    .addEventListener('click', () => { setPlaying(false); state = reset(); update(); });
  // Separate button, separate concern: this moves the eye, never the section.
  panel.querySelector<HTMLButtonElement>('#reset-view')!
    .addEventListener('click', () => { viewport.resetCamera(); });

  /* ---------------- update ---------------- */
  function update(): void {
    applyTo(slice, state);
    for (const product of products) { product.setPhase(state.phase); product.update(slice); }
    // The context follows the knife and the path whether or not it is shown,
    // so switching it on shows the current state, never a stale one.
    context.update();
    phase.value = String(deg(state.phase));
    phaseValue.textContent = `${deg(state.phase).toFixed(1)}°`;

    turn.value = String(deg(state.theta));
    offset.value = String(state.offset);
    refreshMarks();
    turnValue.textContent = `${deg(state.theta).toFixed(1)}°`;
    offsetValue.textContent = state.offset.toFixed(2);

    // One tested function writes the note, and names the side from the sign
    // each time; the page never carries its own copy of the sentence.
    const fromPivot = distanceFromPivot(slice);
    const note = observerNote(fromPivot);
    pivotNote.textContent = note.sentence;
    pivotNote.className = note.side === 'on-section' ? 'pivot on' : 'pivot off';

    drawFaces();
    const n = slice.normal;
    readout.innerHTML =
      `<div class="row"><span>section normal</span><code>(${
        Array.from(n.data, (v) => v.toFixed(3)).join(', ')})</code></div>`
      + `<div class="row"><span>offset along it</span><code>${state.offset.toFixed(3)}</code></div>`
      + (() => {
        const mover = products.find((p) => p.position4() !== null);
        const pos = mover?.position4();
        return pos ? `<div class="row"><span>ball at (x, y, z, w)</span><code>(${
          pos.map((v) => v.toFixed(2)).join(', ')})</code></div>` : '';
      })()
      + products.map((p) => {
        // The library's own tangency comes first: it is exact, and the graze
        // band (a presentation flag) is true there too, so tested first it
        // would call an exact touch "just inside" (found in review).
        const label = p.status === 'tangent'
          ? (p.faces.length > 0 ? 'touching — along its boundary, nothing drawn' : 'touching — at one point')
          : p.grazing ? (p.status === 'outside' ? 'grazing — just outside' : 'grazing — just inside')
          : p.status === 'present' ? 'in section' : 'outside the section';
        const distance = '';
        const kind = p.surface === 'exact-section'
          ? 'exact section' : 'display tessellation of an exact ball';
        const why = `<small class="why">${p.explain()}</small>`;
        const graze = p.grazing && p.status !== 'tangent'
          ? ` <small class="graze">drawn hollow while the slice is within ${GRAZE_EPSILON} of the ball’s `
            + `edge. The size is exact — up to radius ${grazeRadiusOf(
              (SCENE.find((o) => o.id === p.id) as { radius: number }).radius).toFixed(2)} here; hollow only `
            + `means “at the border”. Just outside, the nearest touching point is shown instead.</small>`
          : '';
        return `<div class="object ${p.status}${p.grazing ? ' grazing' : ''}">`
          + `<span class="swatch" style="background:${p.colour}"></span>`
          + `<b>${p.name}</b> <span class="status">${label}</span>${distance}`
          + `<small class="kind">${kind}</small>${why}${graze}</div>`;
      }).join('');
  }

  /**
   * The block's eight faces, persistent, with which of them this section cuts.
   * Beneath them the count of cut vertices — the thing that is NOT persistent.
   */
  function drawFaces(): void {
    const block = products.find((p) => p.faces.length > 0);
    if (!block) { facesBox.hidden = true; return; }
    facesBox.hidden = false;
    facesBox.innerHTML = `<h3>${block.name}’s faces</h3>`
      + block.faces.map((f) => {
        const present = block.presentFaces.has(f.ordinal);
        return `<div class="face ${present ? 'present' : 'absent'}">`
          + `<span class="swatch" style="background:${f.colour}"></span>`
          + `<code>${f.name}</code><span>${present ? 'in this section' : 'not cut by this section'}</span></div>`;
      }).join('')
      + (block.cutVertexCount === 0
        ? '<p class="cut">No cut vertices: nothing is drawn at this section — the block’s own line says why.</p>'
        : `<p class="cut">${block.cutVertexCount} vertices in the cut through the triangulated block — most `
          + 'lie on triangulation diagonals rather than on the block’s own edges. They come and go with the '
          + 'section; the faces above do not.</p>');
  }

  /* ---------------- picking ---------------- */
  const raycaster = new Raycaster();
  const pointer = new Vector2();

  /**
   * The meshes actually on screen under a product: `visible` is checked on
   * every level, so a hidden body (the companion's ball while it grazes) can
   * neither catch a click nor pad a bound. Not left to the library's raycaster
   * or Box3, whose treatment of invisible children is not a contract here.
   */
  function visibleMeshes(root: Object3D): Mesh[] {
    const out: Mesh[] = [];
    const walk = (o: Object3D): void => {
      if (!o.visible) return;
      if (o instanceof Mesh) out.push(o);
      for (const child of o.children) walk(child);
    };
    walk(root);
    return out;
  }

  /** World-space bounds of what a product actually shows; null if nothing. */
  function visibleBounds(product: SectionProduct): Box3 | null {
    const box = new Box3();
    for (const mesh of visibleMeshes(product.object)) box.expandByObject(mesh);
    return box.isEmpty() ? null : box;
  }

  /** One raycast through the real objects; shared by the pointer and the probe. */
  function pickAt(ndcX: number, ndcY: number): { name: string; face: string | null } | null {
    pointer.set(ndcX, ndcY);
    raycaster.setFromCamera(pointer, viewport.camera);
    const visible = products.flatMap((p) => visibleMeshes(p.object));
    const hits: Intersection[] = raycaster.intersectObjects(visible, false);
    for (const hit of hits) {
      const product = products.find((p) => p.object === hit.object || p.object.getObjectById(hit.object.id));
      if (!product) continue;
      const result = product.pick({ faceIndex: hit.faceIndex ?? null, point: hit.point });
      if (result) return { name: result.name, face: result.face?.name ?? null };
    }
    return null;
  }

  function showPick(pick: { name: string; face: string | null } | null): void {
    pickedBox.innerHTML = pick === null
      ? '<h3>Picked</h3><p class="hint">Click a face to ask which source face it was cut from.</p>'
      : `<h3>Picked</h3><p>${pick.face
        ? `The <code>${pick.face}</code> face of <b>${pick.name}</b> — a 3-face of the block in R4, `
          + 'seen where this hyperplane cuts it.'
        : `<b>${pick.name}</b> — the ball’s section; it has no faces to name.`}</p>`;
  }
  showPick(null);

  // A press that does not travel is a pick; one that travels is the orbit's.
  let press: { x: number; y: number; id: number } | null = null;
  stage.addEventListener('pointerdown', (e) => { press = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
  stage.addEventListener('pointerup', (e) => {
    if (!press || press.id !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    press = null;
    if (moved > 4) return;
    const r = stage.getBoundingClientRect();
    showPick(pickAt(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)));
  });
  stage.addEventListener('pointercancel', () => { press = null; });

  update();
  setContext(false);

  // Playing advances the phase with wall-clock time; each frame is a fresh
  // exact section of the exact pose at that phase, and nothing between two
  // frames is ever interpolated.
  let lastTick = performance.now();
  const loop = (): void => {
    const now = performance.now();
    if (playing) {
      const dt = Math.min(0.1, (now - lastTick) / 1000);
      state = setPhase(state, state.phase + (dt * 2 * Math.PI) / PATH_PERIOD_S);
      update();
    }
    lastTick = now;
    viewport.render();
    requestAnimationFrame(loop);
  };
  loop();
  window.addEventListener('resize', () => viewport.resize());

  // Named for the verification pass: one place to read what is on screen,
  // reading the SAME products the viewport draws.
  Object.defineProperty(window, '__turn', {
    value: {
      state: () => state,
      slice: () => ({ normal: Array.from(slice.normal.data), offset: slice.offset }),
      pivotDistance: () => distanceFromPivot(slice),
      products: () => products.map((p) => ({
        id: p.id, status: p.status, surface: p.surface,
        primitiveCount: p.primitiveCount, signedDistance: p.signedDistance,
        boundary: p.boundary, visible: p.object.visible
      })),
      camera: () => viewport.camera.position.toArray(),
      bounds: (id: string) => {
        const product = products.find((p) => p.id === id);
        const box = product ? visibleBounds(product) : null;
        return box === null ? null : {
          min: box.min.toArray().map((v) => Number(v.toFixed(4))),
          max: box.max.toArray().map((v) => Number(v.toFixed(4))),
          size: box.getSize(new Vector3()).toArray().map((v) => Number(v.toFixed(4)))
        };
      },
      setTheta: (degrees: number) => {
        state = setTheta(state, rad(degrees)); update();
      },
      setOffset: (value: number) => { state = setOffset(state, value); update(); },
      reset: () => { setPlaying(false); state = reset(); update(); },
      setPhase: (degrees: number) => { state = setPhase(state, rad(degrees)); update(); },
      phase: () => deg(state.phase),
      play: () => setPlaying(true),
      pause,
      /** The projection context as drawn: its visibility, the block's projected vertices, the ball's projected centre and radius. */
      context: () => ({
        visible: context.visible,
        edgeCount: context.block?.edgeCount() ?? 0,
        blockVertices: context.block?.vertexPositions().map((v) => v.map((c) => Number(c.toFixed(4)))) ?? null,
        ballCentre: context.ball?.chartCentre().map((c) => Number(c.toFixed(4))) ?? null,
        ballRadius: context.ball?.radius ?? null
      }),
      setContext,
      playing: () => playing,
      position: () => products.find((p) => p.position4() !== null)?.position4() ?? null,
      faces: () => products.find((p) => p.faces.length > 0)?.faces.map((f) => f.name) ?? [],
      presentFaces: () => {
        const b = products.find((p) => p.faces.length > 0);
        return b ? [...b.presentFaces].map((o) => b.faces[o]!.name).sort() : [];
      },
      cutVertexCount: () => products.find((p) => p.faces.length > 0)?.cutVertexCount ?? 0,
      /** Where a product's bounds centre lands on screen, in NDC; null if unbounded. */
      project: (id: string) => {
        const product = products.find((p) => p.id === id);
        const box = product ? visibleBounds(product) : null;
        if (box === null) return null;
        const ndc = box.getCenter(new Vector3()).project(viewport.camera);
        return { x: Number(ndc.x.toFixed(3)), y: Number(ndc.y.toFixed(3)),
          inFrame: Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z < 1 };
      },
      pickAt
    },
    configurable: true
  });
}
