// Image analysis: region color sampling, style extraction from photos, product detection and scoring.
import { sampleRegions } from './shapes.js';
import { rgbToLab, labToHex, hexToLab, robustLab, deltaE2000, chroma, hueDeg, kmeans, describeShift, clamp } from './color.js';
import { cloneStyle, PRESETS, LAYERS } from './makeup.js';
import { classifier } from './vision.js';

/** Draw any image source onto a 2D canvas (optionally downscaled) and return {canvas, ctx, w, h}. */
export function toCanvas(src, maxSide = 1024) {
  const sw = src.videoWidth || src.naturalWidth || src.width;
  const sh = src.videoHeight || src.naturalHeight || src.height;
  const s = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.round(sw * s), h = Math.round(sh * s);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, w, h);
  return { canvas, ctx, w, h };
}

/** Collect Lab samples of pixels inside polygon (with holes) using an offscreen mask. */
function samplePoly(ctx, w, h, rings, stepPx = 2) {
  const xs = rings[0].map((p) => p[0]), ys = rings[0].map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(w, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(h, Math.ceil(Math.max(...ys)));
  const bw = x1 - x0, bh = y1 - y0;
  if (bw < 2 || bh < 2) return [];
  const m = document.createElement('canvas');
  m.width = bw; m.height = bh;
  const mc = m.getContext('2d', { willReadFrequently: true });
  mc.beginPath();
  for (const ring of rings) {
    ring.forEach((p, i) => (i ? mc.lineTo(p[0] - x0, p[1] - y0) : mc.moveTo(p[0] - x0, p[1] - y0)));
    mc.closePath();
  }
  mc.fillStyle = '#fff';
  mc.fill('evenodd');
  const mask = mc.getImageData(0, 0, bw, bh).data;
  const img = ctx.getImageData(x0, y0, bw, bh).data;
  const out = [];
  const step = Math.max(1, Math.round(stepPx));
  for (let y = 0; y < bh; y += step) for (let x = 0; x < bw; x += step) {
    const i = (y * bw + x) * 4;
    if (mask[i] > 128) out.push(rgbToLab([img[i], img[i + 1], img[i + 2]]));
  }
  return out;
}

/** Measure mean Lab per region (and per side) of a face image. */
export function measureRegions(ctx, w, h, landmarks) {
  const regions = sampleRegions(landmarks, w, h);
  const faceW = Math.hypot((landmarks[454].x - landmarks[234].x) * w, (landmarks[454].y - landmarks[234].y) * h);
  const step = Math.max(1, faceW / 120);
  const out = {};
  for (const [name, sides] of Object.entries(regions)) {
    const perSide = sides.map((rings) => robustLab(samplePoly(ctx, w, h, rings, step)));
    const all = perSide.filter(Boolean);
    let mean = all.length ? all.reduce((s, v) => s.map((x, i) => x + v[i] / all.length), [0, 0, 0]) : null;
    if (name === 'skin' && all.length > 2) {
      // median-lightness patch is robust against hair over the forehead or blush on the cheeks
      mean = [...all].sort((a, b) => a[0] - b[0])[Math.floor(all.length / 2)];
    }
    out[name] = {
      mean,
      sides: perSide,
    };
  }
  return out;
}

/** Push color `obs` away from `base` to estimate the product color applied at partial opacity. */
function extrapolate(base, obs, opacity) {
  return base.map((b, i) => b + (obs[i] - b) / opacity).map((v, i) => (i === 0 ? clamp(v, 5, 98) : clamp(v, -90, 90)));
}

/** Estimate a makeup style from a photo of a made-up face. */
export function extractStyle(ctx, w, h, landmarks, name = 'My look') {
  const r = measureRegions(ctx, w, h, landmarks);
  const style = cloneStyle(PRESETS[0]);
  style.id = 'custom-' + Date.now().toString(36);
  style.name = name;
  style.builtin = false;
  const skin = r.skin.mean || [65, 12, 18];
  // If left/right differ a lot, one side is probably covered by hair or in shadow: trust the side closer to skin.
  for (const k of ['lid', 'cheek', 'brows', 'liner']) {
    const [a, b] = r[k].sides;
    if (a && b && deltaE2000(a, b) > 15) r[k].mean = deltaE2000(a, skin) < deltaE2000(b, skin) ? a : b;
  }
  const set = (k, lab, amount, extra = {}) => { style.layers[k] = { ...style.layers[k], color: labToHex(lab), amount, ...extra }; };

  set('foundation', skin, 0.35);
  set('concealer', [skin[0] + 5, skin[1] - 1, skin[2]], 0.3);

  if (r.lips.mean) {
    const lips = r.lips.mean;
    const vivid = chroma(lips) > 22 || Math.abs(lips[0] - skin[0]) > 18;
    set('lips', lips, vivid ? 0.9 : 0.6, { gloss: 0.25 });
  }
  if (r.lid.mean) {
    const d = deltaE2000(skin, r.lid.mean);
    if (d > 5) {
      set('eyeshadow', extrapolate(skin, r.lid.mean, 0.65), clamp(0.35 + d / 40, 0.35, 0.85));
      set('crease', extrapolate(skin, r.lid.mean.map((v, i) => (i === 0 ? v - 8 : v)), 0.6), clamp(d / 50, 0.15, 0.6));
    } else {
      set('eyeshadow', r.lid.mean, 0.1); set('crease', r.lid.mean, 0);
    }
  }
  if (r.cheek.mean) {
    const dA = r.cheek.mean[1] - skin[1];
    if (dA > 2) set('blush', extrapolate(skin, r.cheek.mean, 0.4), clamp(0.2 + dA / 15, 0.2, 0.7));
    else style.layers.blush.amount = 0.1;
  }
  if (r.brows.mean) set('brows', r.brows.mean, clamp((skin[0] - r.brows.mean[0]) / 60, 0.25, 0.75));
  if (r.liner.mean && r.lid.mean) {
    const dark = r.lid.mean[0] - r.liner.mean[0];
    set('eyeliner', [Math.min(r.liner.mean[0], 20), r.liner.mean[1] * 0.3, r.liner.mean[2] * 0.3], clamp(dark / 30, 0, 1), { wing: dark > 18 ? 0.6 : 0 });
    style.layers.mascara.amount = clamp(0.4 + dark / 60, 0.4, 0.9);
  }
  style.layers.contour.amount = 0.15;
  style.layers.highlighter.amount = 0.25;
  return style;
}

// ---------------- product (kit) detection ----------------

const LABEL_HINTS = [
  [/lipstick|lip rouge/, 'lipstick', 0.9],
  [/face powder/, 'powder', 0.7],
  [/lotion|sunscreen|sunblock|perfume|essence|pill bottle|water bottle|beaker/, 'foundation', 0.45],
  [/ballpoint|fountain pen|pencil|marker|quill/, 'eyeliner', 0.5],
  [/paintbrush|broom|hair brush|toothbrush/, 'tool', 0.6],
  [/pencil box|crayon|palette/, 'eyeshadow', 0.5],
  [/compact|mirror|band aid|cassette|hard disc|iPod|remote control/, 'powder', 0.35],
  [/nail polish|lipstick/, 'lipstick', 0.35],
];

const isSkinTone = (lab) => {
  const h = hueDeg(lab), c = chroma(lab);
  return h > 25 && h < 80 && c > 8 && c < 42 && lab[0] > 25 && lab[0] < 88;
};

/** Detect product type + colors from an image of a makeup product. */
export async function detectProduct(img) {
  const { canvas, ctx, w, h } = toCanvas(img, 512);
  // dominant colors from the central area (products are usually centered)
  const x0 = Math.round(w * 0.2), y0 = Math.round(h * 0.2), bw = Math.round(w * 0.6), bh = Math.round(h * 0.6);
  const data = ctx.getImageData(x0, y0, bw, bh).data;
  const px = [];
  for (let i = 0; i < data.length; i += 4 * 7) px.push([data[i], data[i + 1], data[i + 2]]);
  const clusters = kmeans(px, 5);
  // background guess: dominant color along the image border
  const border = [];
  const bd = ctx.getImageData(0, 0, w, h).data;
  for (let x = 0; x < w; x += 6) for (const y of [0, h - 1]) { const i = (y * w + x) * 4; border.push(rgbToLab([bd[i], bd[i + 1], bd[i + 2]])); }
  const bg = robustLab(border, 0.2);
  const product = clusters.filter((c) => deltaE2000(c.lab, bg) > 10 && c.share > 0.04);
  const swatches = (product.length ? product : clusters).slice(0, 4);
  const vivid = [...swatches].sort((a, b) => chroma(b.lab) - chroma(a.lab));

  let labels = [];
  try {
    const cls = await classifier();
    labels = cls.classify(canvas).classifications[0].categories.map((c) => ({ name: c.categoryName, score: c.score }));
  } catch (e) { console.warn('classifier unavailable', e); }

  const votes = {};
  const vote = (t, s) => (votes[t] = (votes[t] || 0) + s);
  for (const l of labels) for (const [re, type, wgt] of LABEL_HINTS) if (re.test(l.name)) vote(type, l.score * wgt * 3);

  const main = vivid[0]?.lab || [50, 0, 0];
  // ImageNet has no mascara/eyeliner class: a "lipstick"-shaped object without a colorful bullet is likely a mascara tube
  if (votes.lipstick && chroma(main) < 15) {
    vote(main[0] < 40 ? 'mascara' : 'eyeliner', votes.lipstick * 0.9);
    votes.lipstick *= 0.3;
  }
  const distinct = swatches.filter((s) => s.share > 0.06);
  const spread = distinct.length > 1 ? Math.max(...distinct.map((a) => Math.max(...distinct.map((b) => deltaE2000(a.lab, b.lab))))) : 0;
  // color heuristics
  if (distinct.length >= 3 && spread > 25) vote('eyeshadow', votes.lipstick ? 0.25 : 0.45);
  if (votes.powder && distinct.length >= 3 && spread > 20) vote('eyeshadow', votes.powder);
  if (chroma(main) > 30 && (hueDeg(main) < 40 || hueDeg(main) > 320)) vote(main[0] < 45 ? 'lipstick' : 'blush', 0.35);
  if (isSkinTone(main)) vote(main[0] > 70 ? 'concealer' : 'foundation', 0.3);
  if (main[0] < 22 && chroma(main) < 12) { vote('mascara', 0.25); vote('eyeliner', 0.25); }
  if (main[0] > 82 && chroma(main) < 22 && chroma(main) > 4) vote('highlighter', 0.25);
  if (main[0] < 45 && hueDeg(main) > 30 && hueDeg(main) < 90 && chroma(main) < 30) vote('brow', 0.2), vote('bronzer', 0.15);
  if (votes.powder) { // refine powder by color
    if (chroma(main) > 25 && (hueDeg(main) < 45 || hueDeg(main) > 320)) vote('blush', votes.powder);
    else if (isSkinTone(main) && main[0] < 55) vote('bronzer', votes.powder * 0.6);
  }
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  const type = ranked[0]?.[0] || 'other';
  const total = ranked.reduce((s, r) => s + r[1], 0) || 1;
  return {
    type,
    confidence: ranked.length ? ranked[0][1] / total : 0,
    alternatives: ranked.slice(1, 4).map((r) => r[0]),
    colors: (type === 'eyeshadow' ? swatches : vivid).slice(0, type === 'eyeshadow' ? 4 : 2).map((s) => s.hex),
    labels: labels.slice(0, 5),
    votes,
  };
}

/** Pick the kit product closest to a target color for a layer. */
export function matchProduct(kit, layerKey, colorHex) {
  const layer = LAYERS.find((l) => l.key === layerKey);
  const target = hexToLab(colorHex);
  let best = null;
  for (const item of kit) {
    const typeRank = layer.kitTypes.indexOf(item.type);
    if (typeRank < 0) continue;
    for (const c of item.colors) {
      const d = deltaE2000(target, hexToLab(c)) + typeRank * 4;
      if (!best || d < best.d) best = { item, color: c, d };
    }
  }
  return best;
}

// ---------------- scoring ----------------

const REGION_FOR_LAYER = {
  lips: 'lips', eyeshadow: 'lid', crease: 'lid', blush: 'cheek', brows: 'brows', eyeliner: 'liner',
  mascara: 'liner', foundation: 'skin', concealer: 'undereye',
};
const REGION_LABEL = { lips: 'Lips', lid: 'Eyeshadow', cheek: 'Blush', brows: 'Brows', liner: 'Eyeliner & lashes', skin: 'Base / foundation', undereye: 'Under-eye' };

export const scoreFromDE = (d) => Math.round(100 / (1 + (d / 12) ** 1.5));

/**
 * Score how well `actual` reaches `target`, relative to how much change the makeup needed from `bare`.
 * Not applying anything scores low even when the intended change is subtle.
 */
export const scoreChange = (err, needed) => Math.round(100 / (1 + (err / (0.5 * needed + 2.5)) ** 2));

/**
 * Compare a target render (style applied to the user's bare scan) with a photo of the finished makeup.
 * target/actual/bare are {ctx, w, h, landmarks}. Lightness differences are down-weighted (kL=2) to tolerate lighting.
 */
export function scoreMakeup(target, actual, style, bare = null) {
  const T = measureRegions(target.ctx, target.w, target.h, target.landmarks);
  const A = measureRegions(actual.ctx, actual.w, actual.h, actual.landmarks);
  const B = bare ? measureRegions(bare.ctx, bare.w, bare.h, bare.landmarks) : null;
  // simple exposure normalization using the skin lightness
  const dLexp = T.skin.mean && A.skin.mean ? (T.skin.mean[0] - A.skin.mean[0]) * 0.7 : 0;
  const norm = (lab) => lab && [lab[0] + dLexp, lab[1], lab[2]];
  const weights = {};
  for (const [layer, region] of Object.entries(REGION_FOR_LAYER)) {
    weights[region] = (weights[region] || 0) + (style.layers[layer]?.amount || 0);
  }
  const results = [];
  for (const [region, wgt] of Object.entries(weights)) {
    if (wgt < 0.05 || !T[region].mean || !A[region].mean) continue;
    const t = T[region].mean, a = norm(A[region].mean);
    const d = deltaE2000(t, a, 2);
    const needed = B?.[region]?.mean ? deltaE2000(t, B[region].mean, 2) : 12;
    const sides = A[region].sides;
    let symmetry = null;
    if (sides.length === 2 && sides[0] && sides[1]) symmetry = scoreFromDE(deltaE2000(sides[0], sides[1], 2) * 1.5);
    const advice = describeShift(t, a);
    if (symmetry != null && symmetry < 70) advice.push('left and right sides differ — even them out');
    results.push({
      // regions where the makeup should visibly change something count more
      region, label: REGION_LABEL[region], weight: wgt * (needed + 2), deltaE: d, needed, score: scoreChange(d, needed), symmetry,
      target: labToHex(t), actual: labToHex(a), advice,
    });
  }
  const tw = results.reduce((s, r) => s + r.weight, 0) || 1;
  const overall = Math.round(results.reduce((s, r) => s + r.score * r.weight, 0) / tw);
  results.sort((a, b) => b.weight - a.weight);
  return { overall, results };
}
