// Small DOM helpers, camera management and shared face-guidance logic.
import { headPose } from './vision.js';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}

export function toast(msg, ms = 2600) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

export function filePicker({ accept = 'image/*', capture } = {}) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, ...(capture ? { capture } : {}) });
    inp.addEventListener('change', () => resolve(inp.files?.[0] || null));
    inp.click();
  });
}

// ---------- camera ----------
let stream = null;
export async function startCamera(video, facingMode = 'user') {
  stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera not available (the page must be served over HTTPS).');
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false,
  });
  video.srcObject = stream;
  video.muted = true; video.playsInline = true;
  await video.play();
  await new Promise((r) => (video.videoWidth ? r() : video.addEventListener('loadedmetadata', r, { once: true })));
  return stream;
}
export function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

/** Grab the current video frame as a canvas (un-mirrored). */
export function grabFrame(video) {
  const c = document.createElement('canvas');
  c.width = video.videoWidth; c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  return c;
}

// ---------- guidance ----------
let lumCanvas;
export function faceBrightness(video, lm) {
  lumCanvas ||= Object.assign(document.createElement('canvas'), { width: 32, height: 32 });
  const ctx = lumCanvas.getContext('2d', { willReadFrequently: true });
  const vw = video.videoWidth, vh = video.videoHeight;
  const x = lm[234].x * vw, x2 = lm[454].x * vw, y = lm[10].y * vh, y2 = lm[152].y * vh;
  ctx.drawImage(video, x, y, Math.max(1, x2 - x), Math.max(1, y2 - y), 0, 0, 32, 32);
  const d = ctx.getImageData(0, 0, 32, 32).data;
  let s = 0, left = 0, right = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    s += l;
    if ((i / 4) % 32 < 16) left += l; else right += l;
  }
  const n = d.length / 4;
  return { mean: s / n, balance: (left - right) / (s || 1) };
}

/**
 * Evaluate framing/lighting for a pose target.
 * target: {id, test(pose, ref) -> bool, prompt}
 */
export function evaluateFrame(lm, video, target, ref, brightness) {
  const pose = headPose(lm);
  const issues = [];
  if (pose.width < 0.25) issues.push('Move closer to the camera');
  else if (pose.width > 0.62) issues.push('Move a little further away');
  if (Math.abs(pose.cx - 0.5) > 0.14 || Math.abs(pose.cy - 0.5) > 0.17) issues.push('Center your face in the oval');
  if (brightness) {
    if (brightness.mean < 70) issues.push('It is too dark — face a window or a lamp');
    else if (brightness.mean > 215) issues.push('Too bright — avoid direct light on the face');
    else if (Math.abs(brightness.balance) > 0.25) issues.push('Lighting is uneven — face the light source directly');
  }
  if (Math.abs(pose.roll) > 0.14 && target.id !== 'sideA' && target.id !== 'sideB') issues.push('Keep your head level');
  const poseOk = target.test(pose, ref);
  return { pose, issues, poseOk, ok: !issues.length && poseOk };
}

export const POSE_TARGETS = [
  { id: 'front', label: 'Front', prompt: 'Look straight at the camera', arrow: '●', test: (p) => Math.abs(p.yaw) < 0.07 },
  { id: 'sideA', label: 'Side 1', prompt: 'Slowly turn your head to one side', arrow: '↔', test: (p) => Math.abs(p.yaw) > 0.17 && Math.abs(p.yaw) < 0.42 },
  { id: 'sideB', label: 'Side 2', prompt: 'Now turn to the other side', arrow: '↔', test: (p, ref) => Math.abs(p.yaw) > 0.17 && Math.abs(p.yaw) < 0.42 && Math.sign(p.yaw) !== ref.sideSign },
  { id: 'up', label: 'Chin up', prompt: 'Look forward and tilt your chin up slightly', arrow: '↑', test: (p, ref) => Math.abs(p.yaw) < 0.1 && p.pitch < ref.frontPitch - 0.06 },
];

/** Draw mirrored video + oval guide + progress onto a 2D canvas. */
export function drawGuide(ctx, video, { lm, ok, progress = 0, message = '', sub = '' }) {
  const W = ctx.canvas.width = video.videoWidth, H = ctx.canvas.height = video.videoHeight;
  ctx.save();
  ctx.translate(W, 0); ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, W, H);
  if (lm) {
    ctx.fillStyle = ok ? 'rgba(120,255,180,.7)' : 'rgba(255,255,255,.45)';
    for (let i = 0; i < 468; i += 6) ctx.fillRect(lm[i].x * W - 1.5, lm[i].y * H - 1.5, 3, 3);
  }
  ctx.restore();
  const rx = W * 0.2, ry = H * 0.36;
  ctx.save();
  ctx.fillStyle = 'rgba(15,10,20,.45)';
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.ellipse(W / 2, H / 2, rx, ry, 0, 0, Math.PI * 2, true); ctx.fill('evenodd');
  ctx.lineWidth = Math.max(4, W / 160);
  ctx.strokeStyle = 'rgba(255,255,255,.35)';
  ctx.beginPath(); ctx.ellipse(W / 2, H / 2, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  if (progress > 0) {
    ctx.strokeStyle = ok ? '#7dffb4' : '#ffc46b';
    ctx.beginPath(); ctx.ellipse(W / 2, H / 2, rx, ry, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress); ctx.stroke();
  }
  ctx.restore();
}
