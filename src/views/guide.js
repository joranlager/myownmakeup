// Step-by-step guide with a scrubbable slider and realtime 3D / live-mirror makeup rendering.
import { h, toast, startCamera, stopCamera } from '../ui.js';
import { state, personalStyle } from '../state.js';
import { buildSteps, amountsAt } from '../makeup.js';
import { MakeupRenderer } from '../renderer.js';
import { videoLandmarker } from '../vision.js';
import { matchProduct } from '../analysis.js';
import { attachOrbit } from './orbit.js';
import { niceName } from './kit.js';

export function guideView() {
  const canvas = h('canvas', { class: 'stage-canvas' });
  const video = h('video', { playsinline: true, muted: true, class: 'hidden-video' });
  const modeBtns = h('div', { class: 'seg' },
    h('button', { 'data-mode': '3d', class: 'on' }, '3D face'),
    h('button', { 'data-mode': 'live' }, 'Live mirror'));
  const slider = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: 0, class: 'step-slider', 'aria-label': 'Guide progress' });
  const ticks = h('div', { class: 'ticks' });
  const stepCard = h('div', { class: 'card step-card' });
  const prev = h('button', { class: 'btn ghost' }, '◀ Back');
  const play = h('button', { class: 'btn ghost' }, '▶ Play');
  const next = h('button', { class: 'btn primary' }, 'Next ▶');
  const note = h('div', { class: 'overlay-bottom muted small' });
  const stage = h('div', { class: 'stage' }, canvas, note);
  const root = h('section', { class: 'view' },
    h('div', { class: 'row spread' }, h('h2', {}, 'Step-by-step guide'), modeBtns),
    stage, video,
    h('div', { class: 'slider-wrap' }, slider, ticks),
    h('div', { class: 'row spread' }, prev, play, next),
    stepCard,
  );

  let renderer, steps = [], style, mode = '3d', stopOrbit, dirty = true, liveRaf = 0, playing = 0, visible = false;

  function setup() {
    style = personalStyle();
    steps = buildSteps(style);
    slider.max = steps.length;
    slider.value = Math.min(+slider.value, steps.length);
    ticks.replaceChildren(...steps.map((s, i) => h('button', {
      class: 'tick', style: { left: `${((i + 0.5) / steps.length) * 100}%` }, title: s.label,
      onclick: () => setT(i + 1),
    }, h('i', { style: { background: s.color } }))));
    try { renderer ||= new MakeupRenderer(canvas); } catch (e) { note.textContent = e.message; return; }
    dirty = true;
    startMode();
    updateCard();
  }

  function setT(t) { slider.value = t; dirty = true; updateCard(); }

  function updateCard() {
    const t = +slider.value;
    const i = Math.min(steps.length - 1, Math.max(0, Math.ceil(t) - 1));
    if (!steps.length) { stepCard.replaceChildren(h('p', {}, 'This style has no steps.')); return; }
    if (t <= 0) {
      stepCard.replaceChildren(
        h('h3', {}, `${style.name}: ${steps.length} steps`),
        h('p', {}, 'Move the slider or tap Next to see each step applied to your face. Start with clean, moisturized skin.'),
        h('ol', { class: 'small' }, steps.map((s) => h('li', {}, s.label))),
      );
      return;
    }
    const s = steps[i];
    const pct = Math.round(Math.min(1, t - i) * 100);
    const m = state.kit.length ? matchProduct(state.kit, s.key, s.color) : null;
    stepCard.replaceChildren(
      h('div', { class: 'row spread' }, h('span', { class: 'pill' }, `Step ${i + 1} / ${steps.length}`), h('span', { class: 'muted small' }, `${pct}% applied`)),
      h('h3', {}, s.title),
      h('div', { class: 'row' }, h('span', { class: 'dot', style: { background: s.color } }), h('b', {}, s.label)),
      h('p', {}, s.how),
      m ? h('p', { class: 'use' }, 'Use: ', h('b', {}, m.item.name), ' ', h('span', { class: 'dot', style: { background: m.color } }),
        m.d > 15 ? h('span', { class: 'muted small' }, ` (closest in your kit — ${niceName(m.item.type)})`) : '')
        : h('p', { class: 'muted small' }, 'Tip: add products in the Kit tab to see which of yours to use.'),
      h('p', { class: 'tip' }, '💡 ' + s.tip),
    );
  }

  function startMode() {
    stopModes();
    modeBtns.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    if (mode === '3d') {
      if (!state.scan?.captures?.length) {
        note.textContent = 'No face scan yet — showing live mirror. Scan your face for the 3D view.';
        mode = 'live';
        return startMode();
      }
      note.textContent = 'Drag to rotate';
      renderer.setScan(state.scan.captures, state.scan.depth);
      stopOrbit = attachOrbit(canvas, renderer, {
        onFrame: () => {
          if (!dirty) return;
          renderer.updateScanTextures(style, amountsAt(style, steps, +slider.value));
          dirty = false;
        },
      });
    } else {
      note.textContent = 'Starting camera…';
      Promise.all([videoLandmarker(), startCamera(video, 'user')]).then(([lmk]) => {
        if (mode !== 'live' || !visible) return stopCamera();
        note.textContent = '';
        const loop = () => {
          liveRaf = requestAnimationFrame(loop);
          if (video.readyState < 2) return;
          const lm = lmk.detectForVideo(video, performance.now()).faceLandmarks?.[0] || null;
          const w = video.videoWidth, hh = video.videoHeight;
          renderer.render2D(video, w, hh, lm, style, amountsAt(style, steps, +slider.value), { mirror: true });
        };
        loop();
      }).catch((e) => { note.textContent = 'Camera error: ' + e.message; });
    }
  }

  function stopModes() {
    stopOrbit?.(); stopOrbit = null;
    cancelAnimationFrame(liveRaf);
    stopCamera();
  }

  slider.addEventListener('input', () => { dirty = true; updateCard(); });
  modeBtns.addEventListener('click', (e) => {
    const m = e.target.dataset?.mode;
    if (m && m !== mode) { mode = m; startMode(); }
  });
  next.addEventListener('click', () => animateTo(Math.min(steps.length, Math.floor(+slider.value) + 1)));
  prev.addEventListener('click', () => animateTo(Math.max(0, Math.ceil(+slider.value) - 1)));
  play.addEventListener('click', () => {
    if (playing) { cancelAnimationFrame(playing); playing = 0; play.textContent = '▶ Play'; return; }
    if (+slider.value >= steps.length) slider.value = 0;
    play.textContent = '❚❚ Pause';
    const tick = () => {
      slider.value = Math.min(steps.length, +slider.value + 0.012);
      dirty = true; updateCard();
      if (+slider.value >= steps.length) { playing = 0; play.textContent = '▶ Play'; return; }
      playing = requestAnimationFrame(tick);
    };
    playing = requestAnimationFrame(tick);
  });

  function animateTo(target) {
    const from = +slider.value, t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 700);
      slider.value = from + (target - from) * (1 - (1 - k) ** 3);
      dirty = true; updateCard();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  return {
    el: root,
    show() { visible = true; if (!state.scan && mode === '3d') toast('Tip: scan your face first for a 3D preview'); setup(); },
    hide() { visible = false; stopModes(); if (playing) { cancelAnimationFrame(playing); playing = 0; play.textContent = '▶ Play'; } },
  };
}
