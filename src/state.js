// App state persisted in IndexedDB.
import * as store from './store.js';
import { PRESETS, cloneStyle } from './makeup.js';

const listeners = new Set();
export const state = {
  kit: [], // {id, type, colors:[hex], name, thumb}
  customStyles: [],
  styleId: PRESETS[0].id,
  scan: null, // {captures:[{image, w, h, landmarks, pose}], depth}
  history: [], // check results
};

export const onChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const emit = (what) => listeners.forEach((fn) => fn(what));

export const allStyles = () => [...state.customStyles, ...PRESETS];
export const currentStyle = () => allStyles().find((s) => s.id === state.styleId) || PRESETS[0];

export async function load() {
  const [kit, styles, styleId, history, scan] = await Promise.all([
    store.get('kit'), store.get('styles'), store.get('styleId'), store.get('history'), store.get('scan'),
  ]).catch(() => []);
  state.kit = kit || [];
  state.customStyles = styles || [];
  state.styleId = styleId || PRESETS[0].id;
  state.history = history || [];
  if (scan?.captures?.length) {
    try {
      const captures = await Promise.all(scan.captures.map(async (c) => ({ ...c, image: await store.blobToImage(c.blob) })));
      state.scan = { captures, depth: scan.depth || null };
    } catch (e) { console.warn('could not restore scan', e); }
  }
}

export const saveKit = () => store.set('kit', state.kit);
export const saveStyles = () => store.set('styles', state.customStyles);
export const saveStyleId = () => store.set('styleId', state.styleId);
export const saveHistory = () => store.set('history', state.history.slice(-30));

export async function saveScan() {
  if (!state.scan) return store.del('scan');
  const captures = await Promise.all(state.scan.captures.map(async (c) => {
    const canvas = document.createElement('canvas');
    canvas.width = c.w; canvas.height = c.h;
    canvas.getContext('2d').drawImage(c.image, 0, 0, c.w, c.h);
    return { blob: await store.canvasToBlob(canvas), w: c.w, h: c.h, landmarks: c.landmarks, pose: c.pose };
  }));
  return store.set('scan', { captures, depth: state.scan.depth });
}

export function upsertStyle(style) {
  const s = cloneStyle(style);
  const i = state.customStyles.findIndex((x) => x.id === s.id);
  if (i >= 0) state.customStyles[i] = s; else state.customStyles.unshift(s);
  saveStyles();
  emit('styles');
  return s;
}

// ---------- personalization ----------
import { measureRegions, toCanvas } from './analysis.js';
import { labToHex } from './color.js';

let skinCache = { cap: null, lab: null };
/** Measured skin color (Lab) of the user's front scan. */
export function scanSkin() {
  const cap = state.scan?.captures?.[0];
  if (!cap) return null;
  if (skinCache.cap !== cap) {
    const { ctx, w, h } = toCanvas(cap.image, 800);
    skinCache = { cap, lab: measureRegions(ctx, w, h, cap.landmarks).skin.mean };
  }
  return skinCache.lab;
}

/** Style adapted to the user: foundation/concealer follow the user's own skin tone unless customized. */
export function personalStyle(style = currentStyle()) {
  const skin = scanSkin();
  if (!skin) return style;
  const s = cloneStyle(style);
  if (!s.layers.foundation.custom) s.layers.foundation.color = labToHex(skin);
  if (!s.layers.concealer.custom) s.layers.concealer.color = labToHex([skin[0] + 7, skin[1] * 0.9, skin[2] * 1.05]);
  return s;
}

/** Square-ish crop around the face (normalized [u, v, du, dv]) for previews. */
export function faceCrop(lm, w, h, pad = 0.45, aspect = 3 / 4) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of lm) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const cx = ((x0 + x1) / 2) * w, cy = ((y0 + y1) / 2) * h;
  let ch = (y1 - y0) * h * (1 + pad * 2), cw = ch * aspect;
  if (cw < (x1 - x0) * w * (1 + pad * 2)) { cw = (x1 - x0) * w * (1 + pad * 2); ch = cw / aspect; }
  cw = Math.min(cw, w); ch = Math.min(ch, h);
  const u = Math.min(Math.max(0, cx - cw / 2), w - cw), v = Math.min(Math.max(0, cy - ch / 2), h - ch);
  return [u / w, v / h, cw / w, ch / h];
}
