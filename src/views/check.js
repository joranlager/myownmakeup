// Check: photograph the finished makeup, compare with the chosen style rendered on your bare scan.
import { h, toast, startCamera, stopCamera, grabFrame, faceBrightness, evaluateFrame, POSE_TARGETS, drawGuide, filePicker } from '../ui.js';
import { videoLandmarker, detectFace } from '../vision.js';
import { state, personalStyle, saveHistory, faceCrop } from '../state.js';
import { MakeupRenderer } from '../renderer.js';
import { fullAmounts } from '../makeup.js';
import { toCanvas, scoreMakeup } from '../analysis.js';

export function checkView() {
  const video = h('video', { playsinline: true, muted: true, class: 'hidden-video' });
  const guide = h('canvas', { class: 'stage-canvas' });
  const msg = h('div', { class: 'guide-msg' }, '');
  const stage = h('div', { class: 'stage' }, guide, h('div', { class: 'overlay-top' }, msg));
  const startBtn = h('button', { class: 'btn primary' }, '📸  Take my photo');
  const uploadBtn = h('button', { class: 'btn ghost' }, 'Upload a photo');
  const results = h('div', { class: 'results' });
  const history = h('div', { class: 'history' });
  const offscreen = h('canvas');
  const root = h('section', { class: 'view' },
    h('h2', {}, 'Check my makeup'),
    h('p', { class: 'muted' }, 'Done? Take a front photo in the same light as your scan. We compare each area with the chosen style rendered on your own face and give you a score and tips.'),
    stage, video,
    h('div', { class: 'row' }, startBtn, uploadBtn),
    results,
    h('h3', {}, 'History'), history,
  );
  let running = false, raf = 0, renderer;

  async function run() {
    if (!state.scan?.captures?.length) return toast('Scan your bare face first (Scan tab) so we have something to compare with.');
    stage.style.display = '';
    results.replaceChildren();
    msg.textContent = 'Starting camera…';
    let lmk;
    try { [lmk] = await Promise.all([videoLandmarker(), startCamera(video, 'user')]); } catch (e) { msg.textContent = e.message; startBtn.textContent = '📸  Take my photo'; return; }
    running = true;
    const target = POSE_TARGETS[0];
    let hold = 0, n = 0, bright = null, busy = false;
    const loop = async () => {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      if (busy || video.readyState < 2) return;
      const lm = lmk.detectForVideo(video, performance.now()).faceLandmarks?.[0];
      if (!lm) { drawGuide(guide.getContext('2d'), video, {}); msg.textContent = 'Looking for your face…'; hold = 0; return; }
      if (n++ % 8 === 0) bright = faceBrightness(video, lm);
      const ev = evaluateFrame(lm, video, target, {}, bright);
      msg.textContent = ev.issues[0] || (ev.poseOk ? 'Hold still…' : target.prompt);
      const now = performance.now();
      if (ev.ok) hold ||= now; else hold = 0;
      const progress = hold ? Math.min(1, (now - hold) / 900) : 0;
      drawGuide(guide.getContext('2d'), video, { lm, ok: ev.ok, progress });
      if (progress >= 1) {
        busy = true;
        const frame = grabFrame(video);
        stop();
        await analyze(frame);
      }
    };
    loop();
  }

  function stop() { running = false; cancelAnimationFrame(raf); stopCamera(); startBtn.textContent = '📸  Take my photo'; }

  async function analyze(img) {
    stage.style.display = 'none';
    results.replaceChildren(h('p', { class: 'muted' }, 'Analyzing…'));
    const style = personalStyle();
    const actual = toCanvas(img, 1280);
    const alm = await detectFace(actual.canvas);
    if (!alm) { results.replaceChildren(h('p', {}, 'No face found — try again with your face centered and well lit.')); return; }
    const front = state.scan.captures[0];
    renderer ||= new MakeupRenderer(offscreen);
    renderer.render2D(front.image, front.w, front.h, front.landmarks, style, fullAmounts(style));
    const target = toCanvas(offscreen, 1280);
    const bare = toCanvas(front.image, 1280);
    const s = scoreMakeup({ ...target, landmarks: front.landmarks }, { ...actual, landmarks: alm }, style, { ...bare, landmarks: front.landmarks });
    const entry = { date: new Date().toISOString(), style: style.name, overall: s.overall, results: s.results, photo: faceThumb(actual, alm), target: faceThumb(target, front.landmarks) };
    state.history.push(entry);
    saveHistory();
    showResult(entry);
    renderHistory();
  }

  function faceThumb({ canvas, w, h: hh }, lm, size = 320) {
    const [u, v, du, dv] = faceCrop(lm, w, hh, 0.12, 1);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d').drawImage(canvas, u * w, v * hh, du * w, dv * hh, 0, 0, size, size);
    return c.toDataURL('image/jpeg', 0.85);
  }

  function mirrorImg(src) { return h('img', { src, class: 'mirror' }); }

  function showResult(e) {
    const grade = e.overall >= 85 ? 'Stunning match! 🌟' : e.overall >= 70 ? 'Great job — very close!' : e.overall >= 50 ? 'Good start — a few tweaks to go.' : 'Keep practicing — follow the tips below.';
    results.replaceChildren(
      h('div', { class: 'card score-card' },
        h('div', { class: 'score-ring', style: { '--p': e.overall } }, h('span', {}, e.overall)),
        h('div', {}, h('h3', {}, grade), h('p', { class: 'muted small' }, `Similarity to “${e.style}”`)),
      ),
      h('div', { class: 'compare' },
        h('figure', {}, mirrorImg(e.target), h('figcaption', {}, 'Target')),
        h('figure', {}, mirrorImg(e.photo), h('figcaption', {}, 'You'))),
      ...e.results.map((r) => h('div', { class: 'card region' },
        h('div', { class: 'row spread' }, h('b', {}, r.label), h('span', { class: 'score' }, r.score)),
        h('div', { class: 'bar' }, h('i', { style: { width: r.score + '%' } })),
        h('div', { class: 'row small' },
          h('span', { class: 'dot', style: { background: r.target } }), 'target ',
          h('span', { class: 'dot', style: { background: r.actual } }), 'yours',
          r.symmetry != null ? h('span', { class: 'muted' }, ` · symmetry ${r.symmetry}`) : ''),
        r.advice.length ? h('ul', { class: 'small' }, r.advice.map((a) => h('li', {}, a[0].toUpperCase() + a.slice(1)))) : h('p', { class: 'small good' }, 'Spot on ✓'),
      )),
      h('p', { class: 'muted small' }, 'Scores compare colors region by region (CIEDE2000) and are tolerant to small lighting changes; use similar light to your scan for best results.'),
    );
  }

  function renderHistory() {
    history.replaceChildren(...(state.history.length ? [...state.history].reverse().slice(0, 12).map((e) =>
      h('button', { class: 'hist', onclick: () => showResult(e) }, mirrorImg(e.photo),
        h('div', {}, h('b', {}, e.overall), h('div', { class: 'small muted' }, e.style), h('div', { class: 'small muted' }, new Date(e.date).toLocaleDateString()))))
      : [h('p', { class: 'empty' }, 'No checks yet.')]));
  }

  startBtn.addEventListener('click', () => (running ? stop() : (run(), (startBtn.textContent = 'Cancel'))));
  uploadBtn.addEventListener('click', async () => {
    if (!state.scan?.captures?.length) return toast('Scan your bare face first.');
    const f = await filePicker({ capture: 'user' });
    if (f) analyze(await createImageBitmap(f));
  });

  stage.style.display = 'none';
  return { el: root, show: renderHistory, hide: stop };
}
