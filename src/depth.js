// Optional hardware depth (LiDAR / ToF / ARCore depth) via the WebXR Depth Sensing API.
// Browsers only expose this in immersive AR sessions using the rear camera (e.g. Chrome on ARCore phones).
// iOS Safari does not expose LiDAR to web pages, so there we fall back to MediaPipe's estimated depth.
import { detectFace } from './vision.js';

export async function depthSupport() {
  if (!navigator.xr) return { available: false, reason: 'WebXR not available in this browser — using estimated 3D from the camera.' };
  try {
    const ok = await navigator.xr.isSessionSupported('immersive-ar');
    if (!ok) return { available: false, reason: 'AR sessions not supported — using estimated 3D from the camera.' };
    return { available: true, reason: 'This device may provide hardware depth (LiDAR/ToF) through WebXR. Uses the rear camera: ask a friend to scan you, or use a mirror.' };
  } catch {
    return { available: false, reason: 'Could not query WebXR support.' };
  }
}

/**
 * Run a short depth scan. Resolves with per-landmark depth in face-width units (z toward camera), or throws.
 * overlay: element shown as DOM overlay during the AR session (for instructions/cancel button).
 */
export async function depthScan(overlay, onStatus = () => {}, frames = 8) {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { xrCompatible: true });
  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['depth-sensing'],
    optionalFeatures: ['camera-access', 'dom-overlay'],
    depthSensing: { usagePreference: ['cpu-optimized'], dataFormatPreference: ['luminance-alpha', 'float32'] },
    domOverlay: overlay ? { root: overlay } : undefined,
  });
  try {
    session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
    const ref = await session.requestReferenceSpace('viewer');
    const binding = typeof XRWebGLBinding !== 'undefined' ? new XRWebGLBinding(session, gl) : null;
    const fb = gl.createFramebuffer();
    const sums = new Map();
    let got = 0, faceWm = 0;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for a face with depth data.')), 30000);
      overlay?.querySelector('[data-cancel]')?.addEventListener('click', () => { clearTimeout(timeout); reject(new Error('Cancelled')); });
      let busy = false;
      const onFrame = async (t, frame) => {
        if (got >= frames) { clearTimeout(timeout); resolve(); return; }
        session.requestAnimationFrame(onFrame);
        if (busy) return;
        const pose = frame.getViewerPose(ref);
        const view = pose?.views[0];
        if (!view) return;
        const depth = frame.getDepthInformation?.(view);
        if (!depth || !binding || !view.camera) { onStatus('Waiting for depth + camera data…'); return; }
        const camTex = binding.getCameraImage(view.camera);
        const w = view.camera.width, h = view.camera.height;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, camTex, 0);
        const px = new Uint8ClampedArray(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        gl.bindFramebuffer(gl.FRAMEBUFFER, session.renderState.baseLayer.framebuffer);
        // flip vertically into a 2D canvas for face detection
        const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
        const ctx = c2.getContext('2d');
        const id = new ImageData(px, w, h);
        const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
        tmp.getContext('2d').putImageData(id, 0, 0);
        ctx.translate(0, h); ctx.scale(1, -1); ctx.drawImage(tmp, 0, 0);
        busy = true;
        const lm = await detectFace(c2).catch(() => null);
        busy = false;
        if (!lm) { onStatus('Point the camera at the face…'); return; }
        const P = view.projectionMatrix;
        const to3D = (p, d) => [((p.x * 2 - 1) * d) / P[0], ((1 - p.y * 2) * d) / P[5], d];
        let ok = 0;
        lm.forEach((p, i) => {
          if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return;
          const d = depth.getDepthInMeters(p.x, p.y);
          if (!(d > 0.05 && d < 2)) return;
          const s = sums.get(i) || [0, 0]; s[0] += d; s[1]++; sums.set(i, s); ok++;
        });
        const dr = depth.getDepthInMeters(lm[234].x, lm[234].y), dl = depth.getDepthInMeters(lm[454].x, lm[454].y);
        if (dr > 0 && dl > 0) {
          const a = to3D(lm[234], dr), b = to3D(lm[454], dl);
          faceWm += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        }
        if (ok > 300) { got++; onStatus(`Capturing depth ${got}/${frames}…`); }
      };
      session.requestAnimationFrame(onFrame);
    });
    const faceW = faceWm / got || 0.14;
    const mean = [...sums.values()].reduce((s, v) => s + v[0] / v[1], 0) / sums.size;
    const z = new Array(478).fill(null);
    for (const [i, [s, n]] of sums) z[i] = (mean - s / n) / faceW;
    return z;
  } finally {
    await session.end().catch(() => {});
  }
}

/** Fill missing hardware depth values with (re-centered) MediaPipe estimates. */
export function mergeDepth(hwZ, landmarks, w) {
  if (!hwZ) return null;
  const faceW = Math.abs(landmarks[454].x - landmarks[234].x) * w || 1;
  const mp = landmarks.map((p) => (-p.z * w) / faceW);
  let off = 0, n = 0;
  hwZ.forEach((z, i) => { if (z != null) { off += z - mp[i]; n++; } });
  if (n < 200) return null;
  off /= n;
  return hwZ.map((z, i) => (z != null ? z : mp[i] + off));
}
