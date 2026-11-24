// Color helpers: hex/rgb/lab conversion, CIEDE2000, k-means dominant colors.

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
}

export const hexToVec3 = (hex) => hexToRgb(hex).map((v) => v / 255);

const toLin = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const fromLin = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

export function rgbToLab([r, g, b]) {
  const R = toLin(r), G = toLin(g), B = toLin(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export function labToRgb([L, a, b]) {
  let y = (L + 16) / 116, x = a / 500 + y, z = y - b / 200;
  const f = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  x = f(x) * 0.95047; y = f(y); z = f(z) * 1.08883;
  const R = x * 3.2406 + y * -1.5372 + z * -0.4986;
  const G = x * -0.9689 + y * 1.8758 + z * 0.0415;
  const B = x * 0.0557 + y * -0.204 + z * 1.057;
  return [fromLin(R), fromLin(G), fromLin(B)].map((v) => clamp(v, 0, 255));
}

export const hexToLab = (hex) => rgbToLab(hexToRgb(hex));
export const labToHex = (lab) => rgbToHex(labToRgb(lab));

/** CIEDE2000 color difference. kL > 1 makes the metric more tolerant of lightness (lighting) changes. */
export function deltaE2000(l1, l2, kL = 1) {
  const [L1, a1, b1] = l1, [L2, a2, b2] = l2;
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (b, a) => { if (b === 0 && a === 0) return 0; const v = Math.atan2(b, a) * deg; return v < 0 ? v + 360 : v; };
  const h1p = h(b1, a1p), h2p = h(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp += h1p + h2p < 360 ? 360 : -360;
    hbp /= 2;
  }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) +
    0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / (kL * Sl)) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

export const chroma = ([, a, b]) => Math.hypot(a, b);
export const hueDeg = ([, a, b]) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;

/** k-means on an array of [r,g,b]; returns clusters sorted by size: {rgb, lab, share}. */
export function kmeans(pixels, k = 4, iters = 12) {
  if (!pixels.length) return [];
  const pts = pixels.map(rgbToLab);
  let cents = [];
  // k-means++ style seeding (deterministic: farthest point)
  cents.push(pts[Math.floor(pts.length / 2)]);
  while (cents.length < k) {
    let best = null, bd = -1;
    for (let i = 0; i < pts.length; i += 3) {
      const d = Math.min(...cents.map((c) => dist2(c, pts[i])));
      if (d > bd) { bd = d; best = pts[i]; }
    }
    cents.push(best);
  }
  let assign = new Int32Array(pts.length);
  for (let it = 0; it < iters; it++) {
    const sums = cents.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < cents.length; c++) { const d = dist2(cents[c], pts[i]); if (d < bd) { bd = d; bi = c; } }
      assign[i] = bi;
      const s = sums[bi]; s[0] += pts[i][0]; s[1] += pts[i][1]; s[2] += pts[i][2]; s[3]++;
    }
    cents = sums.map((s, i) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : cents[i]));
  }
  const counts = new Array(cents.length).fill(0);
  for (const a of assign) counts[a]++;
  return cents
    .map((lab, i) => ({ lab, rgb: labToRgb(lab), hex: labToHex(lab), share: counts[i] / pts.length }))
    .filter((c) => c.share > 0)
    .sort((a, b) => b.share - a.share);
}

function dist2(a, b) { return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2; }

/** Robust (trimmed) mean of Lab samples, discarding brightest/darkest tails (glare, shadows). */
export function robustLab(labs, trim = 0.15) {
  if (!labs.length) return null;
  const sorted = [...labs].sort((a, b) => a[0] - b[0]);
  const lo = Math.floor(sorted.length * trim), hi = Math.max(lo + 1, Math.ceil(sorted.length * (1 - trim)));
  const part = sorted.slice(lo, hi);
  const m = [0, 0, 0];
  for (const p of part) { m[0] += p[0]; m[1] += p[1]; m[2] += p[2]; }
  return m.map((v) => v / part.length);
}

/** Describe the color difference from actual to target in plain words. */
export function describeShift(target, actual) {
  const notes = [];
  const dL = actual[0] - target[0];
  if (dL > 6) notes.push('lighter than the target — build up a bit more product');
  else if (dL < -6) notes.push('darker/heavier than the target — blend out or use a lighter touch');
  const dC = chroma(actual) - chroma(target);
  if (dC < -6) notes.push('less vivid — add more pigment');
  else if (dC > 6) notes.push('more saturated than the target — soften it');
  if (chroma(target) > 8 && chroma(actual) > 8) {
    let dh = hueDeg(actual) - hueDeg(target);
    if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
    if (dh > 12) notes.push('the shade leans warmer/more orange than the target');
    else if (dh < -12) notes.push('the shade leans cooler/more pink than the target');
  }
  return notes;
}
