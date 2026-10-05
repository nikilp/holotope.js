import '../site/site.css';
import './hidden-direction.css';
import { Mesh, Raycaster, Vector2, Vector3, type Material, type MeshStandardMaterial, type Object3D } from 'three';
import { CHAPTERS, createExperience, type Action, type ChapterId } from './experience.js';
import { BUTTONS, INSTRUMENTS, chapterAction, keyAction, sliderKey, type CameraKey } from './bindings.js';
import { AT_ZERO, derivedReading, plainReading, signedReading } from './copy.js';
import { anaRegion, lineSegment, type Footprint } from './plane.js';
import { createStage } from './stage.js';

/**
 * The page: it renders the controller's view model and sends the controller
 * the actions in the binding table — nothing else. Every number and sentence
 * on screen comes from `view()`.
 */

const CHAPTER_IDS = CHAPTERS.map((c) => c.id);
const isChapter = (s: string): s is ChapterId => (CHAPTER_IDS as readonly string[]).includes(s);

/**
 * The gauge's half-range in model units, the same in both worlds: across a slice turned toward w the
 * turning world's ball reaches √(3.6² + 0.92²) + 0.72 ≈ 4.44, and the contact world's launch 3.2. The
 * struck box keeps going; past the range its bar shows an arrow.
 */
const GAUGE_RANGE = 4.6;
/** Where the map's turning handles sit along the line, as a fraction of the map's half-width. */
const KNOB_REACH = 0.93;
/** Where the ana arrow stands along the line, as a fraction of the map's half-width, clear of the bodies at the centre. */
const ARROW_AT = -0.66;

export function createApp(root: HTMLElement): void {
  const startAttr = root.dataset.start ?? 'arrival';
  const fromHash = location.hash.replace('#', '');
  const start: ChapterId = isChapter(fromHash) ? fromHash : isChapter(startAttr) ? startAttr : 'arrival';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const x = createExperience(start);
  const stageHost = root.querySelector<HTMLElement>('#hd-stage')!;
  const stage = createStage(stageHost, reducedMotion);
  for (const r of x.roots) stage.add(r);

  const $ = <T extends HTMLElement>(id: string): T => root.querySelector<T>(`#${id}`)!;
  const el = {
    numeral: $('hd-numeral'), title: $('hd-title'), invite: $('hd-invite'), hint: $('hd-hint'),
    setup: $('hd-setup'), clockName: $('hd-clock-name'), clock: $('hd-clock'), event: $('hd-event'),
    empty: $('hd-empty'), emptyHead: $('hd-empty-head'), emptyList: $('hd-empty-list'), emptyActions: $('hd-empty-actions'),
    labels: $('hd-labels'), chapters: $('hd-chapters'), bodies: $('hd-bodies'), pivot: $('hd-pivot'),
    shadowLegend: $('hd-shadow-legend'), gaugeLegend: $('hd-gauge-legend'), planeLegend: $('hd-plane-legend'),
    numbers: $('hd-numbers'), gauge: $('hd-gauge'), gaugeKeys: $('hd-gauge-keys'), gaugeSvg: $('hd-gauge-svg'), map: $('hd-map'), mapSvg: $('hd-map-svg'),
    mapNote: $('hd-map-note'), dialValue: $('hd-dial-value'), offsetValue: $('hd-offset-value'),
    studyAngle: $('hd-study-angle'), studySvg: $('hd-study-svg'), studyValue: $('hd-study-value'), face: $('hd-face'),
    camera: root.querySelector<HTMLElement>('.hd-camera')!
  };

  let view = x.view(stage.camera);
  const context = () => ({
    playing: view.clock.playing, shadowOn: view.shadow.on, studyPlaying: view.study !== null && view.clock.playing,
    facesCut: view.facesCut, face: view.face?.ordinal ?? null
  });
  const send = (action: Action | null): void => {
    if (action === null) return;
    x.dispatch(action);
    if (action.type === 'chapter') history.replaceState(null, '', `#${action.id}`);
    paint();
  };
  const recentre = (): void => { stage.recentre(); paint(); };
  /** The camera's keys: the page's camera only, never the model. */
  const moveCamera = (k: CameraKey): void => {
    if (k === 'camera') stage.recentre();
    else if (k === 'orbit-left') stage.orbit(Math.PI / 12);
    else if (k === 'orbit-right') stage.orbit(-Math.PI / 12);
    else if (k === 'zoom-in') stage.zoom(0.85);
    else stage.zoom(1 / 0.85);
    paint();
  };

  /* ---------- buttons: exactly the binding table ---------- */
  for (const b of BUTTONS) {
    $(b.id).addEventListener('click', () => {
      if (b.kind === 'camera') { recentre(); return; }
      send(b.act(context()));
    });
  }

  /* ---------- chapters ---------- */
  el.chapters.replaceChildren(...CHAPTERS.map((c) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hd-chapter';
    button.dataset.chapter = c.id;
    button.innerHTML = `<span class="hd-chapter-numeral">${c.numeral}</span><span class="hd-chapter-title">${c.title}</span>`;
    button.addEventListener('click', () => send(chapterAction(c.id)));
    return button;
  }));
  window.addEventListener('hashchange', () => {
    const id = location.hash.replace('#', '');
    if (isChapter(id) && id !== view.chapter.id) send(chapterAction(id));
  });

  /* ---------- the gauge: drag the line to slide your slice ---------- */
  const gaugeValueAt = (clientY: number): number => {
    const r = el.gaugeSvg.getBoundingClientRect();
    const t = (clientY - r.top) / r.height; // 0 at top (ana), 1 at bottom (kata)
    return GAUGE_RANGE - t * 2 * GAUGE_RANGE;
  };
  // A press on a bar singles its body out (the bars are redrawn every frame of a running clock, so the
  // press is read where it lands, at once); a press anywhere else starts a drag that slides the slice.
  el.gaugeSvg.addEventListener('pointerdown', (e) => {
    const bar = (e.target as Element | null)?.closest?.('g.bar') as SVGGElement | null;
    if (!bar) return;
    e.stopPropagation();
    e.preventDefault();
    const id = bar.dataset.body ?? null;
    send({ type: 'focus', body: view.bodies.find((b) => b.id === id)?.focused ? null : id });
  });
  drag(el.gauge, () => true, (e) => send(INSTRUMENTS.gauge.act(gaugeValueAt(e.clientY))));
  el.gauge.addEventListener('keydown', (e) => {
    const a = sliderKey('gauge', e.key, e.shiftKey);
    if (a) { e.preventDefault(); send(a); }
  });

  /* ---------- the hidden-plane map: its bright ends turn the slice, anywhere else slides it ---------- */
  const mapPoint = (e: PointerEvent): [number, number] => {
    const r = el.mapSvg.getBoundingClientRect();
    const E = view.plane.extent;
    return [((e.clientX - r.left) / r.width) * 2 * E - E, E - ((e.clientY - r.top) / r.height) * 2 * E];
  };
  const knobs = (): [number, number][] => {
    const line = view.plane.line;
    if (!line) return [];
    const reach = KNOB_REACH * view.plane.extent;
    const f = [line.offset * line.n[0], line.offset * line.n[1]];
    const d = [line.n[1], -line.n[0]];
    return [[f[0]! + reach * d[0]!, f[1]! + reach * d[1]!], [f[0]! - reach * d[0]!, f[1]! - reach * d[1]!]];
  };
  let mapMode: 'turn' | 'slide' = 'slide';
  const mapMove = (e: PointerEvent): void => {
    const line = view.plane.line;
    if (!line) return;
    const [px, pw] = mapPoint(e);
    if (mapMode === 'turn') {
      // The line through the handle you hold: either end gives the same slice, folded into the dial's ±90°.
      let a = Math.atan2(pw, px);
      if (a > Math.PI / 2) a -= Math.PI;
      if (a < -Math.PI / 2) a += Math.PI;
      send(INSTRUMENTS.turn.act((a * 180) / Math.PI));
    } else {
      // The offset under the pointer, through the slice's normal without its round-off: at a turn of exactly
      // 90° the normal's w component is 2.2·10⁻¹⁶ (2⁻⁵², from the library's rotor transport), which would leave a
      // pointer on the centre column a few 10⁻¹⁶ off the centre point. (+ 0 turns a −0 into 0.)
      const [nx, nw] = line.n.map((v) => (Math.abs(v) < AT_ZERO ? 0 : v));
      send(INSTRUMENTS.slide.act(nx! * px + nw! * pw + 0));
    }
  };
  drag(el.map, (e) => {
    if (!view.plane.movable || !view.plane.line) return false;
    const p = mapPoint(e);
    mapMode = knobs().some((k) => Math.hypot(k[0] - p[0], k[1] - p[1]) < 0.16 * view.plane.extent) ? 'turn' : 'slide';
    return true;
  }, mapMove);
  el.map.addEventListener('keydown', (e) => {
    if (!view.plane.movable) return;
    const a = sliderKey('map', e.key, e.shiftKey);
    if (a) { e.preventDefault(); send(a); }
  });

  /* ---------- the study's angle: a full turn ---------- */
  const studyAngleAt = (clientX: number, clientY: number): number => {
    const r = el.studySvg.getBoundingClientRect();
    const a = Math.atan2(clientX - (r.left + r.width / 2), (r.top + r.height / 2) - clientY);
    return ((a * 180) / Math.PI + 360) % 360;
  };
  drag(el.studyAngle, () => true, (e) => send(INSTRUMENTS.studyAngle.act(studyAngleAt(e.clientX, e.clientY))));
  el.studyAngle.addEventListener('keydown', (e) => {
    const a = sliderKey('studyAngle', e.key, e.shiftKey, view.study?.degrees ?? 0);
    if (a) { e.preventDefault(); send(a); }
  });

  /* ---------- keys anywhere else ---------- */
  // A focused instrument takes its own keys first and marks them handled; every other key, on an
  // instrument or anywhere else, reaches the page's shortcuts. Never both: an arrow acts once.
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (e.defaultPrevented) return;
    if (t && t.closest('input, textarea, select, [contenteditable]')) return;
    if (t && (e.key === ' ' || e.key === 'Enter') && t.closest('button, a, summary')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[1-6]$/.test(e.key)) { send(chapterAction(CHAPTER_IDS[Number(e.key) - 1]!)); return; }
    const a = keyAction(e.key, e.shiftKey, context());
    if (a === null) return;
    e.preventDefault();
    if (typeof a === 'string') { moveCamera(a); return; }
    send(a);
  });

  /* ---------- picking a face in the picture (the turning world's block) ---------- */
  const raycaster = new Raycaster();
  let press: { x: number; y: number } | null = null;
  stage.canvas.addEventListener('pointerdown', (e) => { press = { x: e.clientX, y: e.clientY }; });
  stage.canvas.addEventListener('pointerup', (e) => {
    if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) { press = null; return; }
    press = null;
    if (view.world !== 'turn') return;
    const r = stage.canvas.getBoundingClientRect();
    raycaster.setFromCamera(new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), stage.camera);
    const meshes: Object3D[] = [];
    x.block.object.traverse((o) => { if (o instanceof Mesh && o.visible) meshes.push(o); });
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (!hit) { send({ type: 'focus-face', ordinal: null }); return; }
    const picked = x.block.pick({ point: hit.point, faceIndex: hit.faceIndex ?? null });
    send({ type: 'focus-face', ordinal: picked?.face?.ordinal ?? null });
  });
  let cameraMoved = false;
  stage.onCameraMove(() => { cameraMoved = true; });

  /* ---------- the loop: clocks only tick while one is running ---------- */
  let last = performance.now();
  const frame = (now: number): void => {
    const dt = (now - last) / 1000;
    last = now;
    if (view.clock.playing && !document.hidden) x.dispatch({ type: 'tick', seconds: dt });
    stage.render();
    if (view.clock.playing || cameraMoved) { cameraMoved = false; paint(); }
    requestAnimationFrame(frame);
  };

  /* ---------- painting the view model ---------- */
  let shownEvent = 0;
  let shownChapter: string | null = null;
  let shownOffer: string | null = null;
  function paint(): void {
    view = x.view(stage.camera);
    const scene = view.studyOpen ? 'study' : view.world;
    root.dataset.world = scene;
    root.dataset.chapter = view.chapter.id;
    el.numeral.textContent = view.chapter.numeral === '∞' ? 'Free exploration' : `Chapter ${view.chapter.numeral}`;
    el.title.textContent = view.chapter.title;
    el.invite.textContent = view.chapter.invite;
    el.hint.textContent = view.hint;
    el.setup.textContent = view.chapter.setup;
    el.clockName.textContent = view.preset ? `${view.clock.name} · launch ${view.preset.name}` : view.clock.name;
    el.clock.textContent = view.clock.readout;
    if (view.eventId !== shownEvent && view.event) {
      shownEvent = view.eventId;
      el.event.textContent = view.event;
      el.event.classList.remove('is-new');
      void el.event.offsetWidth;
      el.event.classList.add('is-new');
    }
    el.event.hidden = view.event === null;

    for (const button of Array.from(el.chapters.querySelectorAll<HTMLButtonElement>('.hd-chapter'))) {
      const current = button.dataset.chapter === view.chapter.id;
      button.setAttribute('aria-current', current ? 'step' : 'false');
      // On a narrow rail, bring the current chapter into view — the rail only, never the page.
      if (current && shownChapter !== view.chapter.id) el.chapters.scrollLeft = Math.max(0, button.offsetLeft - el.chapters.offsetLeft - 12);
    }
    shownChapter = view.chapter.id;
    const pressed = (id: string, on: boolean): void => { $(id).setAttribute('aria-pressed', String(on)); };
    const play = $<HTMLButtonElement>('hd-play');
    play.textContent = view.clock.playing ? 'Pause' : view.clock.kind === 'physics' && view.impacts > 0 ? 'Continue' : 'Play';
    pressed('hd-play', view.clock.playing);
    pressed('hd-shadow', view.shadow.on);
    pressed('hd-study-xy', view.study?.mode === 'ordinary');
    pressed('hd-study-xw', view.study?.mode === 'fourth');
    pressed('hd-study-play', view.clock.kind === 'study' && view.clock.playing);
    $<HTMLButtonElement>('hd-study-play').textContent = view.clock.kind === 'study' && view.clock.playing ? 'Pause the turn' : 'Play the turn';
    pressed('hd-world-turn', view.world === 'turn');
    pressed('hd-world-contact', view.world === 'contact' && !view.studyOpen);
    pressed('hd-preset-a', view.preset?.id === 'central');
    pressed('hd-preset-b', view.preset?.id === 'off-centre');
    $<HTMLButtonElement>('hd-face-next').textContent = view.face ? 'Next face' : 'Follow a face';

    // Only the instruments of the scene in front are shown; free exploration adds the world switch.
    for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-for]'))) {
      const tokens = (node.dataset.for ?? '').split(/\s+/);
      node.hidden = !(tokens.includes(scene) || (view.chapter.id === 'free' && tokens.includes('free')));
    }

    el.pivot.textContent = view.cut.pivot;
    el.shadowLegend.textContent = view.shadow.legend;
    el.gaugeLegend.textContent = view.gauge;
    el.planeLegend.textContent = view.plane.legend;
    el.mapNote.textContent = view.plane.note;
    const turned = view.cut.degrees;
    const slid = view.cut.offset;
    // Readouts never print a signed zero; ARIA values stay plain numbers, with no negative zero.
    el.dialValue.textContent = `${signedReading(turned, 1)}°`;
    el.offsetValue.textContent = signedReading(slid, 2);
    el.map.setAttribute('aria-valuenow', plainReading(turned, 1));
    el.map.setAttribute('aria-valuetext', view.plane.movable
      ? `slice turned ${signedReading(turned, 1)} degrees in the x–w plane, slid ${signedReading(slid, 2)} along its normal`
      : 'slice fixed at w = 0 in this scene');
    el.map.setAttribute('aria-disabled', String(!view.plane.movable));
    el.gauge.setAttribute('aria-valuenow', plainReading(view.cut.offset, 2));
    el.gauge.setAttribute('aria-valuetext', `slice at ${signedReading(view.cut.offset, 2)} along its normal; `
      + view.bodies.map((b) => b.caption).join('; '));
    el.face.hidden = view.face === null;
    if (view.face) el.face.innerHTML = `<span class="hz-swatch" style="background:${view.face.colour}"></span><span>The ${view.face.name} face — solid where your slice cuts it, bright lines for all of it in the shadow.</span>`;

    // The keyboard's way to single a body out (the gauge's bars take a click): one toggle per body.
    // Rows are kept and updated in place, so a focused toggle survives the frames of a running clock.
    const rows = view.bodies.map((b) => {
      let li = el.bodies.querySelector<HTMLLIElement>(`li[data-body="${b.id}"]`);
      if (!li) {
        li = document.createElement('li');
        li.dataset.body = b.id;
        li.innerHTML = '<span class="hz-swatch"></span><span class="hd-caption"></span><span class="hz-chip hd-out">outside the camera’s view</span>'
          + '<button type="button" class="hz-chip hd-single"></button>';
        li.querySelector('button')!.addEventListener('click', () => {
          const now = view.bodies.find((v) => v.id === b.id);
          send({ type: 'focus', body: now?.focused ? null : b.id });
        });
      }
      (li.querySelector('.hz-swatch') as HTMLElement).style.background = b.colour;
      li.querySelector('.hd-caption')!.textContent = b.caption;
      (li.querySelector('.hd-out') as HTMLElement).hidden = b.frame !== 'out';
      const single = li.querySelector('button')!;
      single.textContent = b.focused ? 'Stop singling out' : 'Single out';
      single.setAttribute('aria-pressed', String(b.focused));
      single.setAttribute('aria-label', `${b.focused ? 'Stop singling out' : 'Single out'} the ${b.name.toLowerCase()}`);
      return li;
    });
    if (rows.some((li, i) => el.bodies.children[i] !== li) || el.bodies.children.length !== rows.length) el.bodies.replaceChildren(...rows);
    el.numbers.innerHTML = `<div><span>slice normal</span><span class="hz-num">(${view.cut.normal.map((v) => derivedReading(v, 3)).join(', ')})</span></div>`
      + `<div><span>offset along it</span><span class="hz-num">${signedReading(view.cut.offset, 3)}</span></div>`
      + view.bodies.map((b) => `<div><span>${b.name} across your slice</span><span class="hz-num">${derivedReading(b.low, 2)} … ${derivedReading(b.high, 2)}</span></div>`).join('');

    paintGauge();
    paintMap();
    paintStudy();
    paintLabels();
    paintEmpty();
    applyFocus();
  }

  /** The gauge, drawn at its real pixel size so the names stay legible. */
  function paintGauge(): void {
    if (view.studyOpen) return;
    const W = Math.max(40, el.gaugeSvg.clientWidth);
    const H = Math.max(80, el.gaugeSvg.clientHeight);
    const range = GAUGE_RANGE;
    const y = (h: number): number => ((range - Math.max(-range, Math.min(range, h))) / (2 * range)) * H;
    const n = view.bodies.length;
    const slot = (W - 16) / Math.max(1, n);
    const barW = Math.min(16, slot * 0.5);
    const bars = view.bodies.map((b, i) => {
      const cx = 8 + slot * (i + 0.5);
      const top = y(b.high);
      const bottom = y(b.low);
      const over = b.high > range ? '↑' : b.low < -range ? '↓' : '';
      return `<g class="bar${b.focused ? ' is-focus' : ''}" data-body="${b.id}" role="presentation">`
        + `<rect x="${cx - barW / 2}" y="${top}" width="${barW}" height="${Math.max(2, bottom - top)}" rx="${barW / 3}" fill="${b.colour}" opacity="${b.drawn > 0 ? 0.95 : 0.5}"/>`
        + (over ? `<text x="${cx}" y="${over === '↑' ? 12 : H - 4}" text-anchor="middle" class="over">${over}</text>` : '')
        + '</g>';
    }).join('');
    const line = y(view.cut.offset);
    const limitTop = y(view.cut.offsetLimit);
    const limitBottom = y(-view.cut.offsetLimit);
    el.gaugeKeys.innerHTML = view.bodies.map((b) => `<span><i class="hz-swatch" style="background:${b.colour}"></i>${b.name}</span>`).join('');
    el.gaugeSvg.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">`
      + `<rect x="3" y="${limitTop}" width="${W - 6}" height="${limitBottom - limitTop}" rx="8" class="reach"/>`
      + bars
      + `<line x1="0" x2="${W}" y1="${line}" y2="${line}" class="slice-line"/>`
      + `<circle cx="${W - 7}" cy="${line}" r="6" class="slice-knob"/>`
      + '</svg>';
  }

  /** The hidden plane: footprints, the line of your slice, the chord it cuts through each, and the ana side. */
  function paintMap(): void {
    const S = 240;
    const E = view.plane.extent;
    const sx = (v: number): number => ((v + E) / (2 * E)) * S;
    const sy = (w: number): number => ((E - w) / (2 * E)) * S;
    const pts = (p: readonly (readonly [number, number])[]): string => p.map((q) => `${sx(q[0]).toFixed(1)},${sy(q[1]).toFixed(1)}`).join(' ');
    const shape = (f: Footprint, colour: string, cls: string): string => f.kind === 'disc'
      ? `<circle cx="${sx(f.centre[0])}" cy="${sy(f.centre[1])}" r="${(f.radius / (2 * E)) * S}" fill="${colour}" stroke="${colour}" class="${cls}"/>`
      : `<polygon points="${pts(f.points)}" fill="${colour}" stroke="${colour}" class="${cls}"/>`;
    const line = view.plane.line;
    let parts = `<rect x="0" y="0" width="${S}" height="${S}" rx="14" class="map-bg"/>`
      + `<line x1="0" x2="${S}" y1="${sy(0)}" y2="${sy(0)}" class="axis"/><line y1="0" y2="${S}" x1="${sx(0)}" x2="${sx(0)}" class="axis"/>`
      + `<text x="${S - 8}" y="${sy(0) - 6}" text-anchor="end" class="axis-label">x</text>`
      + `<text x="${sx(0) + 7}" y="14" class="axis-label">w</text>`;
    if (line) {
      parts += `<polygon points="${pts(anaRegion(line, E))}" class="ana"/>`;
      if (view.plane.movable) {
        for (const c of [view.cut.offsetLimit, -view.cut.offsetLimit]) {
          const seg = lineSegment({ n: line.n, offset: c }, E);
          if (seg) parts += `<line x1="${sx(seg[0][0])}" y1="${sy(seg[0][1])}" x2="${sx(seg[1][0])}" y2="${sy(seg[1][1])}" class="reach"/>`;
        }
      }
    }
    for (const f of view.plane.footprints) parts += shape(f.footprint, f.colour, `foot${view.bodies.find((b) => b.id === f.id)?.focused ? ' is-focus' : ''}`);
    if (line) {
      const seg = lineSegment(line, E);
      if (seg) parts += `<line x1="${sx(seg[0][0])}" y1="${sy(seg[0][1])}" x2="${sx(seg[1][0])}" y2="${sy(seg[1][1])}" class="slice-line"/>`;
      for (const f of view.plane.footprints) {
        if (!f.chord) continue;
        const [a, b] = f.chord;
        parts += Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9
          ? `<circle cx="${sx(a[0])}" cy="${sy(a[1])}" r="3.5" fill="${f.colour}" class="chord-point"/>`
          : `<line x1="${sx(a[0])}" y1="${sy(a[1])}" x2="${sx(b[0])}" y2="${sy(b[1])}" stroke="${f.colour}" class="chord"/>`;
      }
      const at = ARROW_AT * E;
      const fx = line.offset * line.n[0] + at * line.n[1];
      const fw = line.offset * line.n[1] - at * line.n[0];
      const tip: [number, number] = [fx + 0.75 * line.n[0], fw + 0.75 * line.n[1]];
      parts += `<line x1="${sx(fx)}" y1="${sy(fw)}" x2="${sx(tip[0])}" y2="${sy(tip[1])}" class="ana-arrow" marker-end="url(#hd-arrow)"/>`
        + `<text x="${sx(fx + 1.25 * line.n[0])}" y="${sy(fw + 1.25 * line.n[1]) + 4}" text-anchor="middle" class="ana-label">ana</text>`;
      if (view.plane.movable) for (const k of knobs()) parts += `<circle cx="${sx(k[0])}" cy="${sy(k[1])}" r="8" class="knob"/>`;
    }
    parts += `<circle cx="${sx(0)}" cy="${sy(0)}" r="2.5" class="centre"/>`;
    el.mapSvg.innerHTML = `<svg viewBox="0 0 ${S} ${S}" width="100%" height="100%" aria-hidden="true">`
      + '<defs><marker id="hd-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="arrow-head"/></marker></defs>'
      + parts + '</svg>';
    el.map.classList.toggle('is-fixed', !view.plane.movable);
  }

  function paintStudy(): void {
    if (!view.study) return;
    const cx = 60; const cy = 60; const r = 46;
    const a = (view.study.degrees * Math.PI) / 180;
    el.studyValue.textContent = `${plainReading(view.study.degrees, 1)}°`;
    el.studyAngle.setAttribute('aria-valuenow', plainReading(view.study.degrees, 1));
    el.studyAngle.setAttribute('aria-valuetext', `box turned ${plainReading(view.study.degrees, 1)} degrees; ${view.study.description}`);
    el.studySvg.innerHTML = `<svg viewBox="0 0 120 120" width="100%" height="100%" aria-hidden="true">`
      + `<circle cx="${cx}" cy="${cy}" r="${r}" class="arc"/>`
      + `<line x1="${cx}" y1="${cy}" x2="${cx + r * Math.sin(a)}" y2="${cy - r * Math.cos(a)}" class="hand"/>`
      + `<circle cx="${cx + r * Math.sin(a)}" cy="${cy - r * Math.cos(a)}" r="7" class="knob"/>`
      + '</svg>';
  }

  /**
   * Name tags beside each drawn body, from its drawn bound; never on a body that is not drawn, and never
   * under the event line — a tag that would sit there moves below its body, or just below the line.
   */
  function paintLabels(): void {
    const r = stage.canvas.getBoundingClientRect();
    const tags: string[] = [];
    const roots = view.world === 'turn' ? x.worlds.turn.bodies() : view.studyOpen ? [] : x.worlds.contact.bodies();
    for (const b of roots) {
      if (b.drawnBound === null) continue;
      const [cx, cy, cz] = b.drawnBound.centre;
      const v = new Vector3(cx, cy + b.drawnBound.radius, cz).project(stage.camera);
      if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) continue;
      const [left, top] = clampTag(((v.x + 1) / 2) * r.width, ((1 - v.y) / 2) * r.height, 44, r);
      const u = new Vector3(cx, cy - b.drawnBound.radius, cz).project(stage.camera);
      const [, below] = clampTag(((u.x + 1) / 2) * r.width, ((1 - u.y) / 2) * r.height, 44, r);
      tags.push(`<span class="hd-tag" data-below="${below}" style="left:${left}px;top:${top}px;--c:${b.colour}">${b.name}</span>`);
    }
    // A marker is not a cut: it is tagged where it is drawn, for as long as it is drawn.
    for (const b of roots) {
      if (b.markerAt === null) continue;
      const v = new Vector3(b.markerAt[0], b.markerAt[1], b.markerAt[2]).project(stage.camera);
      if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) continue;
      const [left, top] = clampTag(((v.x + 1) / 2) * r.width, ((1 - v.y) / 2) * r.height, 120, r);
      const what = b.marker === 'touch' ? 'touching point' : 'nearest point — not a cut';
      tags.push(`<span class="hd-tag hd-tag--marker" style="left:${left}px;top:${top}px;--c:${b.colour}">${b.name} · ${what}</span>`);
    }
    el.labels.innerHTML = tags.join('');
    // No text over text: a tag under the event line (while one is shown) or under the camera's controls moves
    // to the first new place inside the picture that is clear of both — below its body, then the place nearest
    // what it was under: just below the line, or just above the controls.
    const line = el.event.hidden ? null : el.event.getBoundingClientRect();
    const controls = el.camera.getBoundingClientRect();
    const over = (t: DOMRect, o: DOMRect): boolean => t.right > o.left && t.left < o.right && t.bottom > o.top && t.top < o.bottom;
    const clear = (t: DOMRect): boolean => t.top >= r.top && t.bottom <= r.bottom && t.left >= r.left && t.right <= r.right
      && !over(t, controls) && !(line && over(t, line));
    for (const tag of Array.from(el.labels.querySelectorAll<HTMLElement>('.hd-tag'))) {
      const at = tag.getBoundingClientRect();
      const underLine = line !== null && over(at, line);
      if (!underLine && !over(at, controls)) continue;
      const original = tag.style.top;
      const belowLine: [string, string][] = line ? [['hd-tag--clear', `${line.bottom - r.top + 6}px`]] : [];
      const aboveControls: [string, string][] = [['hd-tag--above', `${controls.top - r.top - 6}px`]];
      const places: [string, string][] = [
        ...(tag.dataset.below !== undefined ? [['hd-tag--below', `${tag.dataset.below}px`] as [string, string]] : []),
        ...(underLine ? [...belowLine, ...aboveControls] : [...aboveControls, ...belowLine])
      ];
      let placed = false;
      for (const [cls, top] of places) {
        tag.classList.add(cls);
        tag.style.top = top;
        if (clear(tag.getBoundingClientRect())) { placed = true; break; }
        tag.classList.remove(cls);
      }
      if (!placed) tag.style.top = original;
    }
  }

  /**
   * Where the picture has room, the empty view covers neither the event line above it nor the camera's controls
   * below: when the card, centred, would reach either, it is centred in the space between them instead
   * (`--hd-top`, `--hd-bottom`). That space must still show the card's headline and every way back; when it does
   * not, the controls are kept clear before the line, and failing both the card is centred as before. Positions are
   * read from the layout, so the line's arrival transform does not move the card. A phone's picture has no such
   * room, and there the stylesheet lays the card over the whole picture, the line and the controls included.
   */
  function placeEmpty(): void {
    let top = 16;
    let bottom = 16;
    if (!el.empty.hidden) {
      const height = stageHost.clientHeight;
      const width = stageHost.clientWidth;
      const natural = el.empty.scrollHeight + 2;
      const left = (width - el.empty.offsetWidth) / 2;
      const right = (width + el.empty.offsetWidth) / 2;
      const across = (o: HTMLElement): boolean => o.offsetLeft < right && o.offsetLeft + o.offsetWidth > left;
      const line = !el.event.hidden && across(el.event) ? el.event.offsetTop + el.event.offsetHeight + 8 : null;
      const controls = el.camera.offsetParent !== null && across(el.camera) ? el.camera.offsetTop - 8 : null;
      // Where the card falls, centred between an inset at the top and one at the bottom.
      const at = (t: number, b: number): { top: number; bottom: number } => {
        const room = height - t - b;
        const h = Math.min(natural, room);
        return { top: t + (room - h) / 2, bottom: t + (room + h) / 2 };
      };
      // Clear of the line, then of the controls; the second shift can bring the line back into reach, so twice.
      let t = 16;
      let b = 16;
      for (let k = 0; k < 2; k++) {
        if (line !== null && t < line && at(t, b).top < line) t = line;
        if (controls !== null && b < height - controls && at(t, b).bottom > controls) b = height - controls;
      }
      // The headline and the ways back, with the card's padding and border.
      const needed = el.emptyActions.offsetTop + el.emptyActions.offsetHeight + parseFloat(getComputedStyle(el.empty).paddingBottom) + 2;
      if (height - t - b >= needed) { top = t; bottom = b; } else {
        // No room for both: the controls are kept clear if the card, centred above them, can still show its ways back.
        const clearOfControls = controls !== null && at(16, 16).bottom > controls ? height - controls : 16;
        if (height - 16 - clearOfControls >= needed) bottom = clearOfControls;
      }
    }
    el.empty.style.setProperty('--hd-top', `${Math.ceil(top)}px`);
    el.empty.style.setProperty('--hd-bottom', `${Math.ceil(bottom)}px`);
  }

  function paintEmpty(): void {
    const e = view.empty;
    el.empty.hidden = e === null;
    if (!e) { shownOffer = null; return; }
    el.emptyHead.textContent = e.headline;
    el.emptyList.innerHTML = e.reasons.map((r) => `<li><span class="hz-swatch" style="background:${r.colour}"></span><span>${r.line}</span></li>`).join('');
    // Rebuilt only when the offer changes, so a button stays put — and clickable — while a clock runs. The card is
    // placed once its content, the ways back included, is what it will show.
    const offer = e.recoveries.map((r) => r.label).join('\n');
    if (offer === shownOffer) { placeEmpty(); return; }
    shownOffer = offer;
    el.emptyActions.replaceChildren(...e.recoveries.map((rec, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hz-btn';
      button.textContent = rec.label;
      button.addEventListener('click', () => {
        // Act on the recovery as it stands now, not as it stood when the button was made.
        const now = view.empty?.recoveries[i];
        if (!now || now.label !== rec.label) return;
        if (now.frame) { stage.frame(now.frame.centre, now.frame.radius); paint(); } else send(now.action);
      });
      return button;
    }));
    placeEmpty();
  }

  /** The focused body glows in its slice and its shadow; the others step back. Presentation only. */
  function applyFocus(): void {
    const focused = view.bodies.find((b) => b.focused)?.id ?? null;
    const touch = (object: Object3D, on: boolean | null): void => {
      object.traverse((o) => {
        const m = (o as { material?: Material | Material[] }).material;
        if (!m || Array.isArray(m)) return;
        const std = m as MeshStandardMaterial;
        if ('emissive' in std && std.emissive) std.emissive.setRGB(on ? 0.16 : 0, on ? 0.14 : 0, on ? 0.09 : 0);
      });
    };
    for (const b of view.world === 'turn' ? x.worlds.turn.bodies() : x.worlds.contact.bodies()) {
      touch(b.object, focused === null ? null : focused === b.id);
    }
  }

  /* ---------- verification probe: reads the same view; drives only through dispatch ---------- */
  Object.defineProperty(window, '__hidden', {
    configurable: true,
    value: {
      view: () => x.view(stage.camera),
      dispatch: (a: Action) => send(a),
      camera: () => ({ position: stage.camera.position.toArray(), fov: stage.camera.fov, aspect: stage.camera.aspect }),
      faceShadow: () => ({ edges: x.faceShadow.sourceEdges().length, endpoints: x.faceShadow.drawnEndpoints() })
    }
  });

  window.addEventListener('resize', () => paint());
  // The event line arrives with a short slide; tags are placed again against where it settles.
  el.event.addEventListener('animationend', () => paintLabels());
  paint();
  requestAnimationFrame(frame);
}

/** Keep a centred tag of about `halfWidth` inside the picture, so a name is never clipped at its edge. */
function clampTag(left: number, top: number, halfWidth: number, r: DOMRect): [number, number] {
  return [Math.min(Math.max(left, halfWidth + 6), r.width - halfWidth - 6), Math.min(Math.max(top, 40), r.height - 12)];
}

/** Pointer drag on an instrument: pointer capture, so a drag that leaves the instrument keeps steering it. */
function drag(target: HTMLElement, onStart: (e: PointerEvent) => boolean, onMove: (e: PointerEvent) => void): void {
  let active = false;
  target.addEventListener('pointerdown', (e) => {
    if (!onStart(e)) return;
    active = true;
    target.setPointerCapture(e.pointerId);
    onMove(e);
    e.preventDefault();
  });
  target.addEventListener('pointermove', (e) => { if (active) onMove(e); });
  const end = (): void => { active = false; };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}
