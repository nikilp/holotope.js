import '../site/site.css';
import './flatland.css';
import {
  CHAPTERS, PREDICTIONS, POSES, chapterFromHash, createExperience, isRoute, poseReadout,
  type Action, type ChapterId, type Hand, type View
} from './journey.js';
import { BUTTONS, chapterAction, dialAngle, gaugeValue, keyAction, sliderKey, type CameraKey } from './bindings.js';
import { capitalise, castReadout, count, cutPhrase, dimensionsSentence, distance, honestNote, legend, poseLabel, signed } from './copy.js';
import { createPicture, modelToThree } from './picture.js';
import { createStage } from './stage.js';
import { RUNGS } from './world.js';

/**
 * The page: it renders the controller's view and sends the controller the
 * actions in the binding table, nothing else. Every number and sentence on
 * screen comes from `view()`; every shape in the picture from the library's
 * products, through `picture.ts`.
 */

/** How far, in CSS pixels, a click may land from a point and still pick it: wider on a touch screen. */
const PICK_RADIUS = { fine: 16, coarse: 26 } as const;
const SHADOW_COLOUR = '#b7c4ff';
const SLICE_COLOUR = '#f1dfae';

export function createApp(root: HTMLElement): void {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  // A chapter's hash, or one of the page's earlier ones, which is redirected to the chapter that carries its lesson.
  const start: ChapterId = isRoute(location.hash) ? chapterFromHash(location.hash) : chapterFromHash(root.dataset.start ?? '');
  if (isRoute(location.hash) && location.hash !== `#${start}`) history.replaceState(null, '', `#${start}`);

  const x = createExperience(start, { instantTurns: reducedMotion });
  const stageHost = root.querySelector<HTMLElement>('#om-stage')!;
  const stage = createStage(stageHost, reducedMotion);
  const picture = createPicture(x);
  stage.add(picture.root);
  stage.onResize((w, h) => picture.setResolution(w, h));

  const $ = <T extends HTMLElement>(id: string): T => root.querySelector<T>(`#${id}`)!;
  const el = {
    numeral: $('om-numeral'), title: $('om-title'), setup: $('om-setup'), invite: $('om-invite'), hint: $('om-hint'),
    pass: $<HTMLButtonElement>('om-pass'), guess: $('om-guess'), question: $('om-question'), choices: $('om-choices'),
    testRow: $('om-test-row'), test: $<HTMLButtonElement>('om-test'),
    reveal: $('om-reveal'), yours: $('om-yours'), revealText: $('om-reveal-text'),
    worlds: $('om-worlds'), status: $('om-status'), inspect: $('om-inspect'), next: $('om-next'),
    legend: $('om-legend'), dims: $('om-dims'), numbers: $('om-numbers'), lists: $('om-lists'), honest: $('om-honest'),
    labels: $('om-labels'), event: $('om-event'), empty: $('om-empty'), emptyHead: $('om-empty-head'), emptyActions: $('om-empty-actions'),
    camHint: $('om-cam-hint'), hide: $<HTMLButtonElement>('om-hide'), camera: root.querySelector<HTMLElement>('.om-camera')!,
    slideHead: $('om-slide-head'), gauge: $('om-gauge'), gaugeSvg: $('om-gauge-svg'), gaugeTop: $('om-gauge-top'), gaugeBottom: $('om-gauge-bottom'),
    slideRead: $('om-slide-read'), turnHead: $('om-turn-head'), dial: $('om-dial'), dialSvg: $('om-dial-svg'), turnRead: $('om-turn-read'),
    shadow: $<HTMLButtonElement>('om-shadow'), castRead: $('om-cast-read'), chapters: $('om-chapters')
  };

  let view: View = x.view();
  const context = () => ({ passing: view.passing, shadowOn: view.shadowOn, objectShown: view.objectShown });
  let dirty = true;
  const send = (action: Action | null): void => {
    if (action === null) return;
    x.dispatch(action);
    if (action.type === 'chapter') history.replaceState(null, '', `#${action.id}`);
    dirty = true;
    paint();
  };
  /** The camera's keys and buttons: the page's camera only. The controller hears only that you looked. */
  const moveCamera = (k: CameraKey): void => {
    if (k === 'camera') stage.recentre();
    else if (k === 'orbit-left') stage.orbit(Math.PI / 12);
    else if (k === 'orbit-right') stage.orbit(-Math.PI / 12);
    else if (k === 'zoom-in') stage.zoom(0.85);
    else stage.zoom(1 / 0.85);
    send({ type: 'look' });
  };

  /* ---------- buttons: exactly the binding table ---------- */
  for (const b of BUTTONS) {
    $(b.id).addEventListener('click', () => {
      if (b.kind === 'camera') { moveCamera('camera'); return; }
      send(b.act(context()));
    });
  }
  el.test.addEventListener('click', () => send(view.prediction?.test?.action ?? null));

  /* ---------- chapters ---------- */
  el.chapters.replaceChildren(...CHAPTERS.map((c) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'om-chapter';
    button.dataset.chapter = c.id;
    button.innerHTML = `<span class="om-chapter-numeral">${c.numeral}</span><span class="om-chapter-title">${c.title}</span>`;
    button.addEventListener('click', () => send(chapterAction(c.id)));
    return button;
  }));
  window.addEventListener('hashchange', () => {
    // Only a chapter's hash moves the journey; the skip link and other anchors are left to the browser.
    if (!isRoute(location.hash)) return;
    const id = chapterFromHash(location.hash);
    if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
    if (id !== view.chapter.id) send(chapterAction(id));
  });

  /* ---------- the gauge: drag the line to slide; it lands on a layer of corners when near one ---------- */
  const gaugeAt = (clientY: number): number => {
    const r = el.gaugeSvg.getBoundingClientRect();
    return gaugeValue((clientY - r.top) / Math.max(1, r.height), view.reach, r.height, view.layers);
  };
  drag(el.gauge, () => view.chapter.hands.includes('slide'), (e) => send({ type: 'slide-to', offset: gaugeAt(e.clientY) }));
  el.gauge.addEventListener('keydown', (e) => {
    const a = sliderKey('gauge', e.key, e.shiftKey);
    if (a) { e.preventDefault(); send(a); }
  });

  /* ---------- the dial: drag the knob to turn; it lands on a named pose when near one ---------- */
  const DIAL = { w: 150, h: 124, cx: 58, cy: 76, r: 54 } as const;
  const dialAt = (e: PointerEvent): number => {
    const r = el.dialSvg.getBoundingClientRect();
    const sx = r.width / DIAL.w;
    const sy = r.height / DIAL.h;
    return dialAngle(view.rung, (e.clientX - r.left) / sx - DIAL.cx, DIAL.cy - (e.clientY - r.top) / sy);
  };
  drag(el.dial, () => view.chapter.hands.includes('turn'), (e) => send({ type: 'tip-to', angle: dialAt(e) }));
  el.dial.addEventListener('keydown', (e) => {
    const a = sliderKey('dial', e.key, e.shiftKey);
    if (a) { e.preventDefault(); send(a); }
  });

  /* ---------- keys anywhere else ---------- */
  // A focused instrument takes its own keys first and marks them handled; every other key reaches these.
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (e.defaultPrevented) return;
    if (t && t.closest('input, textarea, select, [contenteditable]')) return;
    if (t && (e.key === ' ' || e.key === 'Enter') && t.closest('button, a, summary')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[1-6]$/.test(e.key)) { send(chapterAction(CHAPTERS[Number(e.key) - 1]!.id)); return; }
    const a = keyAction(e.key, e.shiftKey, context());
    if (a === null) return;
    e.preventDefault();
    if (typeof a === 'string') { moveCamera(a); return; }
    send(a);
  });

  /* ---------- picking in the picture: a corner of the cut, a point of the shadow, a corner of the cube ---------- */
  let press: { x: number; y: number } | null = null;
  stage.canvas.addEventListener('pointerdown', (e) => { press = { x: e.clientX, y: e.clientY }; });
  stage.canvas.addEventListener('pointerup', (e) => {
    if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) { press = null; return; }
    press = null;
    const r = stage.canvas.getBoundingClientRect();
    const radius = coarse || e.pointerType === 'touch' ? PICK_RADIUS.coarse : PICK_RADIUS.fine;
    let best: { d: number; action: Action } | null = null;
    for (const p of picture.pickables(view)) {
      const v = modelToThree(p.at).project(stage.camera);
      if (v.z > 1) continue;
      const d = Math.hypot(((v.x + 1) / 2) * r.width - (e.clientX - r.left), ((1 - v.y) / 2) * r.height - (e.clientY - r.top));
      // Within the radius, the first kind listed wins a near tie: the cut, then the shadow, then the cube.
      if (d <= radius && (best === null || d < best.d - 4)) best = { d, action: { type: 'inspect', target: p.target } };
    }
    send(best?.action ?? { type: 'inspect', target: null });
  });
  let cameraMoved = false;
  stage.onCameraMove(() => { cameraMoved = true; });
  // The controller says once per chapter that looking moved nothing; it changes no world either way.
  stage.onUserLook(() => send({ type: 'look' }));

  /* ---------- the loop: the slice and the turn move only while one is running ---------- */
  let last = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if ((view.passing || view.turning) && !document.hidden) { x.dispatch({ type: 'tick', dt }); dirty = true; }
    if (dirty) paint();
    else if (cameraMoved) paintLabels();
    cameraMoved = false;
    stage.render();
    requestAnimationFrame(frame);
  };

  /* ---------- painting the view ---------- */
  let shownEvent = 0;
  let shownChapter: string | null = null;
  let shownChoices = '';
  let shownWays = '';
  let shownLists = '';
  function paint(): void {
    dirty = false;
    view = x.view();
    picture.update(view);
    const w = view.words;
    root.dataset.chapter = view.chapter.id;
    root.dataset.rung = view.rung;
    root.dataset.meeting = view.meeting.kind;

    el.numeral.textContent = view.chapter.numeral === '∞' ? 'Free exploration' : `Chapter ${view.chapter.numeral}`;
    el.title.textContent = view.chapter.title;
    el.setup.textContent = view.setup;
    el.invite.textContent = view.invitation;
    el.hint.textContent = view.hint;
    el.pass.textContent = view.passing ? 'Stop' : 'Pass through';
    el.pass.setAttribute('aria-pressed', String(view.passing));
    el.pass.hidden = !view.chapter.hands.includes('slide');
    // While the note in the picture says what the slice meets, the card does not say it again.
    el.status.textContent = view.status;
    el.status.hidden = view.empty !== null;
    el.inspect.hidden = view.inspection === null;
    el.inspect.textContent = view.inspection?.text ?? '';
    el.next.hidden = !(view.chapter.id === 'up-shadow' || view.chapter.id === 'free');

    // The hands this chapter grants; the others' instruments are not shown.
    for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-hand]'))) {
      node.hidden = !view.chapter.hands.includes(node.dataset.hand as Hand);
    }
    el.worlds.hidden = view.chapter.id !== 'free';
    $('om-rung-plane').setAttribute('aria-pressed', String(view.rung === 'plane'));
    $('om-rung-space').setAttribute('aria-pressed', String(view.rung === 'space'));

    for (const button of Array.from(el.chapters.querySelectorAll<HTMLButtonElement>('.om-chapter'))) {
      const current = button.dataset.chapter === view.chapter.id;
      button.setAttribute('aria-current', current ? 'step' : 'false');
      if (current && shownChapter !== view.chapter.id) el.chapters.scrollLeft = Math.max(0, button.offsetLeft - el.chapters.offsetLeft - 12);
    }
    shownChapter = view.chapter.id;

    paintGuess();
    paintEvent();
    paintEmpty();
    paintCamera();
    // The panels that size the gauge's column are filled first; the gauge is drawn at the size it is left with.
    paintDial();
    paintCast();
    paintGauge();
    paintDetails();
    paintLabels();
  }

  function paintGuess(): void {
    const p = view.prediction;
    el.guess.hidden = p === null;
    if (!p) return;
    el.question.textContent = p.spec.question;
    const key = `${p.spec.id}`;
    if (key !== shownChoices) {
      shownChoices = key;
      el.choices.replaceChildren(...p.spec.choices.map((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'hz-btn om-choice';
        b.dataset.choice = c.id;
        b.textContent = c.label;
        b.addEventListener('click', () => send({ type: 'predict', choice: c.id }));
        return b;
      }));
    }
    for (const b of Array.from(el.choices.querySelectorAll<HTMLButtonElement>('button'))) b.setAttribute('aria-pressed', String(b.dataset.choice === p.choice));
    el.testRow.hidden = p.test === null;
    el.test.textContent = p.test?.label ?? '';
    el.reveal.hidden = !p.revealed;
    const chosen = PREDICTIONS[p.spec.id].choices.find((c) => c.id === p.choice);
    el.yours.hidden = !chosen;
    el.yours.textContent = chosen ? `You guessed: ${chosen.label.toLowerCase()}.` : '';
    el.revealText.textContent = p.reveal ?? '';
  }

  function paintEvent(): void {
    if (view.event && view.eventId !== shownEvent) {
      shownEvent = view.eventId;
      el.event.textContent = view.event.line;
      el.event.classList.remove('is-new');
      void el.event.offsetWidth;
      el.event.classList.add('is-new');
    }
    el.event.hidden = view.event === null;
  }

  /** A blank picture: say what the slice meets, that the object is still there, and offer the ways back. Rebuilt only when they change. */
  function paintEmpty(): void {
    const e = view.empty;
    el.empty.hidden = e === null;
    if (!e) { shownWays = ''; return; }
    el.emptyHead.textContent = e.headline;
    const ways = e.ways.map((w) => w.label).join('\n');
    if (ways === shownWays) return;
    shownWays = ways;
    el.emptyActions.replaceChildren(...e.ways.map((way, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = i === 0 ? 'hz-btn hz-btn--primary' : 'hz-btn';
      b.textContent = way.label;
      // Act on the way back as it stands now, not as it stood when the button was made.
      b.addEventListener('click', () => { const now = view.empty?.ways[i]; if (now && now.label === way.label) send(now.action); });
      return b;
    }));
  }

  function paintCamera(): void {
    el.camHint.textContent = `Drag to look: it never changes ${view.words.theObject}, the cut or the shadow`;
    el.hide.hidden = !view.canHideObject;
    el.hide.textContent = view.objectShown ? 'Hide the cube' : 'Show the cube';
    el.hide.setAttribute('aria-pressed', String(!view.objectShown));
  }

  /** The gauge: the object's reach along the missing direction, its layers of corners, and the slice. */
  function paintGauge(): void {
    const w = view.words;
    el.slideHead.textContent = `Slide ${w.slice}`;
    el.gaugeTop.textContent = `${w.plus} ↑`;
    el.gaugeBottom.textContent = `${w.minus} ↓`;
    const W = Math.max(40, el.gaugeSvg.clientWidth);
    const H = Math.max(80, el.gaugeSvg.clientHeight);
    const R = view.reach;
    const y = (h: number): number => ((R - Math.max(-R, Math.min(R, h))) / (2 * R)) * H;
    const [lo, hi] = view.extent;
    const narrow = W < 56;
    const cx = narrow ? W / 2 : W / 2 - 8;
    const barW = narrow ? 12 : 16;
    const ticks = view.layers.map((l) => {
      const d = l.height - view.offset;
      const cls = Math.abs(d) <= 1e-9 ? 'on' : d > 0 ? 'plus' : 'minus';
      const label = !narrow && l.corners.length > 1 ? `<text x="${cx + barW / 2 + 12}" y="${y(l.height) + 4}" class="count">×${l.corners.length}</text>` : '';
      return `<line x1="${cx - barW / 2 - 5}" x2="${cx + barW / 2 + 5}" y1="${y(l.height)}" y2="${y(l.height)}" class="layer ${cls}"/>${label}`;
    }).join('');
    const line = y(view.offset);
    el.gaugeSvg.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">`
      + `<rect x="2" y="0" width="${W - 4}" height="${H}" rx="8" class="reach"/>`
      + `<line x1="6" x2="${W - 6}" y1="${y(0)}" y2="${y(0)}" class="middle"/>`
      + `<rect x="${cx - barW / 2}" y="${y(hi)}" width="${barW}" height="${Math.max(2, y(lo) - y(hi))}" rx="${barW / 2.5}" class="extent"/>`
      + ticks
      + `<line x1="0" x2="${W}" y1="${line}" y2="${line}" class="slice-line"/>`
      + `<circle cx="${W - 8}" cy="${line}" r="6.5" class="slice-knob"/>`
      + '</svg>';
    el.gauge.setAttribute('aria-label', `${capitalise(w.slice)}, across ${w.missing}: drag the bright line, or use the arrow keys; Page Up and Page Down go to the next layer of corners`);
    el.gauge.setAttribute('aria-valuemin', String(-R));
    el.gauge.setAttribute('aria-valuemax', String(R));
    el.gauge.setAttribute('aria-valuenow', String(Number(view.offset.toFixed(3)) + 0));
    el.gauge.setAttribute('aria-valuetext', `${signed(view.offset)}: ${view.status}`);
    el.gauge.setAttribute('aria-disabled', String(!view.chapter.hands.includes('slide')));
    el.slideRead.innerHTML = `${w.slice} at <b class="hz-num">${signed(view.offset)}</b>; ${w.theObject} from <b class="hz-num">${signed(lo)}</b> to <b class="hz-num">${signed(hi)}</b>`;
  }

  /** The dial: a quarter turn, with the object drawn in the plane it turns in. */
  function paintDial(): void {
    const w = view.words;
    el.turnHead.textContent = `Turn ${w.theObject}`;
    for (const pose of POSES) {
      const b = $(`om-pose-${pose}`);
      b.textContent = poseLabel(view.rung, pose);
      b.setAttribute('aria-pressed', String(view.pose === pose));
    }
    const { cx, cy, r } = DIAL;
    const t = view.tip;
    const knob = [cx + r * Math.cos(t), cy - r * Math.sin(t)];
    const stopAngles = POSES.map((pose) => ({ pose, a: RUNGS[view.rung].stops[pose] }));
    // The object in the plane it turns in: its long axis is the diagonal the turn tips toward the missing direction.
    const half = view.rung === 'plane' ? Math.SQRT2 : Math.sqrt(3);
    const s = 15;
    const rot = (u: number, e: number): [number, number] => [cx + s * (u * Math.cos(t) - e * Math.sin(t)), cy - s * (u * Math.sin(t) + e * Math.cos(t))];
    const outline = [rot(-half, -1), rot(half, -1), rot(half, 1), rot(-half, 1)].map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
    const marks = (view.rung === 'plane' ? [-half, 0, half] : [-half, -half / 3, half / 3, half])
      .flatMap((u) => [-1, 1].map((e) => rot(u, e)))
      .map(([px, py]) => `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.2" class="corner"/>`).join('');
    const lowest = rot(-half, -1);
    el.dialSvg.innerHTML = `<svg viewBox="0 0 ${DIAL.w} ${DIAL.h}" width="100%" height="100%" aria-hidden="true">`
      + `<path d="M ${cx + r} ${cy} A ${r} ${r} 0 0 0 ${cx} ${cy - r}" class="track"/>`
      + stopAngles.map(({ pose, a }) => `<line x1="${cx + (r - 6) * Math.cos(a)}" y1="${cy - (r - 6) * Math.sin(a)}" x2="${cx + (r + 6) * Math.cos(a)}" y2="${cy - (r + 6) * Math.sin(a)}" class="stop${view.pose === pose ? ' is-on' : ''}"/>`).join('')
      + `<line x1="8" y1="${cy + 30}" x2="8" y2="${cy - 34}" class="axis" marker-end="url(#om-up)"/>`
      + `<text x="14" y="${cy - 26}" class="axis-label">${w.plus}</text>`
      + `<polygon points="${outline}" class="body"/>` + marks
      + `<circle cx="${lowest[0].toFixed(1)}" cy="${lowest[1].toFixed(1)}" r="3.4" class="lowest"/>`
      + `<line x1="${cx}" y1="${cy}" x2="${knob[0]}" y2="${knob[1]}" class="hand"/>`
      + `<circle cx="${knob[0]}" cy="${knob[1]}" r="8" class="knob"/>`
      + '<defs><marker id="om-up" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="arrow-head"/></marker></defs>'
      + '</svg>';
    const degrees = (t * 180) / Math.PI;
    el.dial.setAttribute('aria-label', `Turn ${w.theObject}: drag the knob, or use the arrow keys; Home and End go to the first and last named poses`);
    el.dial.setAttribute('aria-valuenow', degrees.toFixed(1));
    el.dial.setAttribute('aria-valuetext', `${poseReadout(view)}; every edge still ${view.edge.toFixed(2)} long`);
    el.turnRead.innerHTML = `${capitalise(poseReadout(view))}. Every edge is still <b class="hz-num">${view.edge.toFixed(2)}</b> long.`;
  }

  function paintCast(): void {
    el.shadow.textContent = view.shadowOn ? 'Hide the shadow' : 'Show the shadow';
    el.shadow.setAttribute('aria-pressed', String(view.shadowOn));
    el.castRead.textContent = castReadout(view.rung, view.shadowOn, view.corners.length, view.shadow.points.map((p) => p.corners.length), view.withhold);
  }

  function paintDetails(): void {
    const w = view.words;
    el.legend.innerHTML = legend(view.rung).map((item) => `<li><span class="hz-swatch${item.key === 'camera' ? ' om-swatch-camera' : ''}"`
      + `${item.key === 'camera' ? '' : ` style="background:${item.key === 'cut' ? SLICE_COLOUR : SHADOW_COLOUR}"`}></span><span><b>${item.name}</b>: ${item.text}</span></li>`).join('');
    el.dims.textContent = dimensionsSentence(view.rung, view.dimensions);
    const [lo, hi] = view.extent;
    const rows: [string, string][] = [
      [`${w.slice} at`, signed(view.offset)],
      [`${w.theObject} spans`, `${signed(lo)} … ${signed(hi)}`],
      ['layers of corners', view.layers.map((l) => `${signed(l.height)}${l.corners.length > 1 ? ` ×${l.corners.length}` : ''}`).join(', ')],
      ['turned', poseReadout(view)],
      ['the cut', view.cut.empty ? 'nothing' : `${cutPhrase(view.rung, view.cut)}; ${count(view.cut.corners.length, 'corner')}`],
      ['the shadow', view.withhold ? (view.shadowOn ? 'cast' : 'hidden') : `${count(view.shadow.points.length, 'point')} from ${count(view.corners.length, 'corner')}${view.shadowOn ? '' : ' (hidden)'}`],
      ['every edge', distance(view.edge)],
      // The library's own count of the cells it examined, so "nothing is drawn" is never a guess.
      ['cells examined', `${view.accounting.sourceCells}: ${view.accounting.sectionedCells} cut; ${view.accounting.suppressedOnPlaneCells} with no corner strictly ${w.minusSide}; `
        + `${view.accounting.cellsBelow} wholly ${w.minusSide}; ${view.accounting.collapsedSectionCells} collapsed to a point or a segment`],
      ['crossings found', `${view.accounting.crossingsFound}, welded into ${view.accounting.weldedVertices} points`]
    ];
    el.numbers.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><span class="hz-num">${v}</span></div>`).join('');
    el.honest.textContent = honestNote(view.rung);
    // The keyboard's way to pick: every corner of the cut, every point of the shadow, every corner of the cube.
    const groups: { title: string; items: { label: string; action: Action }[] }[] = [];
    if (!view.cut.empty) {
      groups.push({ title: 'Corners of the cut', items: view.cut.corners.map((c, index) => ({
        label: c.on.length === 1 ? `At corner ${view.corners[c.on[0]!]!.name}` : `On the edge ${view.corners[c.on[0]!]!.name}–${view.corners[c.on[1]!]!.name}`,
        action: { type: 'inspect', target: { kind: 'cut-corner', index } }
      })) });
    }
    if (view.shadowOn) {
      // While the question is open, the points are numbered, not named by what lands on them: picking one tells.
      groups.push({ title: 'Points of the shadow', items: view.shadow.points.map((p, index) => ({
        label: view.withhold ? `Point ${index + 1}` : p.corners.map((i) => view.corners[i]!.name).join(' and '),
        action: { type: 'inspect', target: { kind: 'shadow-point', index } }
      })) });
    }
    if (view.rung === 'plane' && view.objectShown) {
      groups.push({ title: 'Corners of the cube', items: view.corners.map((c, index) => ({ label: c.name, action: { type: 'inspect', target: { kind: 'corner', index } } })) });
    }
    const key = groups.map((g) => `${g.title}:${g.items.map((i) => i.label).join('|')}`).join('\n');
    if (key !== shownLists) {
      shownLists = key;
      el.lists.replaceChildren(...groups.map((g) => {
        const block = document.createElement('div');
        const head = document.createElement('p');
        head.className = 'hz-kicker';
        head.textContent = g.title;
        const list = document.createElement('ul');
        g.items.forEach((item) => {
          const li = document.createElement('li');
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'hz-chip om-pick';
          b.textContent = item.label;
          // A list is rebuilt whenever its labels change, so a button's action is the one its label names.
          b.addEventListener('click', () => send(item.action));
          li.append(b);
          list.append(li);
        });
        block.append(head, list);
        return block;
      }));
    }
    const target = view.inspection?.target;
    for (const b of Array.from(el.lists.querySelectorAll<HTMLButtonElement>('button.om-pick'))) b.removeAttribute('aria-pressed');
    if (target) {
      const title = target.kind === 'cut-corner' ? 'Corners of the cut' : target.kind === 'shadow-point' ? 'Points of the shadow' : 'Corners of the cube';
      const block = Array.from(el.lists.children).find((c) => c.querySelector('.hz-kicker')?.textContent === title);
      block?.querySelectorAll<HTMLButtonElement>('button.om-pick')[target.index]?.setAttribute('aria-pressed', 'true');
    }
  }

  /** Name tags in the picture: never over the event line, the note or the camera's controls, never off the picture. */
  function paintLabels(): void {
    const r = stage.canvas.getBoundingClientRect();
    const tags: string[] = [];
    for (const a of picture.anchors(view)) {
      const onScreen = a.at.map((p) => modelToThree(p).project(stage.camera)).filter((v) => v.z <= 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1);
      if (onScreen.length === 0) continue;
      const v = onScreen.reduce((p, q) => (a.placeOn === 'leftmost' ? (q.x < p.x ? q : p) : a.placeOn === 'lowest' ? (q.y < p.y ? q : p) : p));
      const left = ((v.x + 1) / 2) * r.width;
      const top = ((1 - v.y) / 2) * r.height;
      tags.push(`<span class="om-tag om-tag--${a.id}" style="left:${left.toFixed(1)}px;top:${top.toFixed(1)}px">${a.text}</span>`);
    }
    el.labels.innerHTML = tags.join('');
    const avoid = [el.event, el.empty, el.camera].filter((n) => !n.hidden).map((n) => n.getBoundingClientRect());
    const over = (t: DOMRect, o: DOMRect): boolean => t.right > o.left && t.left < o.right && t.bottom > o.top && t.top < o.bottom;
    for (const tag of Array.from(el.labels.querySelectorAll<HTMLElement>('.om-tag'))) {
      const at = tag.getBoundingClientRect();
      const inside = at.left >= r.left && at.right <= r.right && at.top >= r.top && at.bottom <= r.bottom;
      if (!inside || avoid.some((o) => over(at, o))) tag.hidden = true;
    }
  }

  /* ---------- verification probe: reads the same view; drives only through dispatch ---------- */
  Object.defineProperty(window, '__oneMore', {
    configurable: true,
    value: {
      view: () => x.view(),
      dispatch: (a: Action) => send(a),
      camera: () => ({ position: stage.camera.position.toArray(), fov: stage.camera.fov, aspect: stage.camera.aspect }),
      project: (p: readonly number[]) => {
        const r = stage.canvas.getBoundingClientRect();
        const v = modelToThree(p).project(stage.camera);
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, inFront: v.z <= 1 };
      },
      picture: picture.probe,
      worlds: x.worlds
    }
  });

  window.addEventListener('resize', () => { dirty = true; });
  // The gauge is drawn at its real pixel size: when its box changes, for any reason, it is drawn again.
  new ResizeObserver(() => { dirty = true; }).observe(el.gaugeSvg);
  el.event.addEventListener('animationend', () => paintLabels());
  paint();
  requestAnimationFrame(frame);
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
