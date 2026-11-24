// Face scan: guided multi-angle capture, optional hardware depth, 3D preview.
import { h, toast, startCamera, stopCamera, grabFrame, faceBrightness, evaluateFrame, POSE_TARGETS, drawGuide, filePicker } from '../ui.js';
import { videoLandmarker, detectFace, headPose } from '../vision.js';
import { state, saveScan, emit } from '../state.js';
import { MakeupRenderer } from '../renderer.js';
import { depthSupport, depthScan, mergeDepth } from '../depth.js';
import { toCanvas } from '../analysis.js';
import { attachOrbit } from './orbit.js';

const plain = (lm) => lm.map((p) => ({ x: p.x, y: p.y, z: p.z }));

export function scanView() {
  const video = h('video', { playsinline: true, muted: true, class: 'hidden-video' });
  const guide = h('canvas', { class: 'stage-canvas mirror-none' });
  const msg = h('div', { class: 'guide-msg' }, 'Tap “Start scan” to begin');
  const sub = h('div', { class: 'guide-sub' }, '');
  const chips = h('div', { class: 'chips' }, POSE_TARGETS.map((t) => h('span', { class: 'chip', 'data-id': t.id }, t.label)));
  const preview = h('canvas', { class: 'stage-canvas' });
  const depthInfo = h('p', { class: 'muted small' }, 'Checking depth sensor support…');
  const depthBtn = h('button', { class: 'btn ghost', disabled: true }, 'Depth scan (LiDAR/ToF)');
  const startBtn = h('button', { class: 'btn primary' }, 'Start scan');
  const uploadBtn = h('button', { class: 'btn ghost' }, 'Use a photo instead');
  const stageLive = h('div', { class: 'stage' }, guide, h('div', { class: 'overlay-top' }, msg, sub), chips);
  const stagePreview = h('div', { class: 'stage' }, preview, h('div', { class: 'overlay-bottom muted small' }, 'Drag to rotate your 3D face'));
  const root = h('section', { class: 'view' },
    h('h2', {}, 'Scan your face'),
    h('p', { class: 'muted' }, 'Bare face, hair away from your forehead, good even light. We capture a few angles to build a 3D model of your face that the makeup is rendered on. Everything stays on your device.'),
    stageLive, stagePreview, video,
    h('div', { class: 'row' }, startBtn, uploadBtn),
    h('details', { class: 'card' }, h('summary', {}, 'Depth sensor (LiDAR)'), depthInfo, depthBtn),
  );

  let running = false, raf = 0, renderer = null, stopOrbit = null;

  function showPreview() {
    const has = !!state.scan?.captures?.length;
    stagePreview.style.display = has ? '' : 'none';
    if (!has) return;
    try {
      renderer ||= new MakeupRenderer(preview);
      renderer.setScan(state.scan.captures, state.scan.depth);
      renderer.updateScanTextures(null, {});
      stopOrbit?.();
      stopOrbit = attachOrbit(preview, renderer);
    } catch (e) { console.error(e); toast(e.message); }
  }

  async function run() {
    stagePreview.style.display = 'none';
    stageLive.style.display = '';
    msg.textContent = 'Loading face tracker…';
    let lmk;
    try {
      [lmk] = await Promise.all([videoLandmarker(), startCamera(video, 'user')]);
    } catch (e) { msg.textContent = 'Camera/tracker error'; sub.textContent = e.message; startBtn.textContent = 'Start scan'; return; }
    running = true;
    const captures = [];
    const ref = { sideSign: 0, frontPitch: 0.45 };
    let ti = 0, holdStart = 0, frameN = 0, bright = null, busy = false;
    chips.querySelectorAll('.chip').forEach((c) => c.classList.remove('done', 'active'));
    const loop = async () => {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      if (busy || video.readyState < 2) return;
      const target = POSE_TARGETS[ti];
      chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.id === target.id));
      const res = lmk.detectForVideo(video, performance.now());
      const lm = res.faceLandmarks?.[0];
      if (!lm) {
        drawGuide(guide.getContext('2d'), video, {});
        msg.textContent = 'Looking for your face…'; sub.textContent = target.prompt; holdStart = 0;
        return;
      }
      if (frameN++ % 8 === 0) bright = faceBrightness(video, lm);
      const ev = evaluateFrame(lm, video, target, ref, bright);
      msg.textContent = ev.issues[0] || (ev.poseOk ? 'Hold still…' : target.prompt);
      sub.textContent = `${target.arrow}  Step ${ti + 1} of ${POSE_TARGETS.length}: ${target.label}`;
      const now = performance.now();
      if (ev.ok) holdStart ||= now; else holdStart = 0;
      const progress = holdStart ? Math.min(1, (now - holdStart) / 800) : 0;
      drawGuide(guide.getContext('2d'), video, { lm, ok: ev.ok, progress });
      if (progress >= 1) {
        busy = true;
        const frame = grabFrame(video);
        const { canvas, w, h: hh } = toCanvas(frame, 1280);
        const still = await detectFace(canvas).catch(() => null);
        busy = false; holdStart = 0;
        if (!still) return;
        const pose = headPose(still);
        if (target.id === 'front') ref.frontPitch = pose.pitch;
        if (target.id === 'sideA') ref.sideSign = Math.sign(pose.yaw);
        captures.push({ image: canvas, w, h: hh, landmarks: plain(still), pose: { id: target.id, ...pose } });
        chips.querySelector(`[data-id="${target.id}"]`).classList.add('done');
        navigator.vibrate?.(40);
        ti++;
        if (ti >= POSE_TARGETS.length) {
          stop();
          state.scan = { captures, depth: null }; // a new scan invalidates old depth data
          startBtn.textContent = 'Scan again';
          await saveScan();
          emit('scan');
          toast('Scan complete! Your 3D face is ready.');
          stageLive.style.display = 'none';
          showPreview();
        }
      }
    };
    loop();
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    stopCamera();
  }

  startBtn.addEventListener('click', () => (running ? (stop(), (startBtn.textContent = 'Start scan')) : (run(), (startBtn.textContent = 'Stop'))));

  uploadBtn.addEventListener('click', async () => {
    const file = await filePicker({ capture: 'user' });
    if (!file) return;
    const img = await createImageBitmap(file);
    const { canvas, w, h: hh } = toCanvas(img, 1280);
    const lm = await detectFace(canvas);
    if (!lm) return toast('No face found in that photo.');
    state.scan = { captures: [{ image: canvas, w, h: hh, landmarks: plain(lm), pose: { id: 'front', ...headPose(lm) } }], depth: null };
    await saveScan(); emit('scan');
    toast('Photo loaded as your front scan.');
    stageLive.style.display = 'none';
    showPreview();
  });

  depthSupport().then((s) => {
    depthInfo.textContent = s.reason;
    depthBtn.disabled = !s.available;
  });
  depthBtn.addEventListener('click', async () => {
    if (!state.scan) return toast('Do the camera scan first, then add depth.');
    const overlay = h('div', { class: 'xr-overlay' }, h('p', { class: 'xr-status' }, 'Point the rear camera at the face…'), h('button', { class: 'btn', 'data-cancel': true }, 'Cancel'));
    document.body.append(overlay);
    try {
      const z = await depthScan(overlay, (t) => (overlay.querySelector('.xr-status').textContent = t));
      const front = state.scan.captures[0];
      const merged = mergeDepth(z, front.landmarks, front.w);
      if (!merged) throw new Error('Not enough depth samples on the face.');
      state.scan.depth = merged;
      await saveScan(); emit('scan');
      toast('Hardware depth applied to your 3D face.');
      showPreview();
    } catch (e) { toast('Depth scan: ' + e.message); }
    overlay.remove();
  });

  stageLive.style.display = 'none';
  return {
    el: root,
    show() { showPreview(); },
    hide() { stop(); stopOrbit?.(); stopOrbit = null; startBtn.textContent = 'Start scan'; },
  };
}
