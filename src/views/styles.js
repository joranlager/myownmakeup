// Style picker: presets, styles extracted from uploaded photos, editor, "match to my kit".
import { h, toast, filePicker } from '../ui.js';
import { state, allStyles, currentStyle, saveStyleId, upsertStyle, saveStyles, emit, personalStyle, faceCrop } from '../state.js';
import { LAYERS, cloneStyle, fullAmounts } from '../makeup.js';
import { detectFace } from '../vision.js';
import { extractStyle, toCanvas, matchProduct } from '../analysis.js';
import { thumb } from '../store.js';
import { MakeupRenderer } from '../renderer.js';

export function stylesView() {
  const grid = h('div', { class: 'style-grid' });
  const previewCanvas = h('canvas', { class: 'stage-canvas' });
  const previewNote = h('p', { class: 'muted small' });
  const editor = h('div', { class: 'editor' });
  const uploadBtn = h('button', { class: 'btn primary' }, '⬆  Upload a makeup look');
  const kitBtn = h('button', { class: 'btn ghost' }, 'Match colors to my kit');
  const root = h('section', { class: 'view' },
    h('h2', {}, 'Choose a style'),
    h('p', { class: 'muted' }, 'Pick a preset, or upload a photo of a finished makeup look on someone — we read its colors (lips, lids, blush, brows, liner) and turn it into a style you can follow.'),
    h('div', { class: 'row' }, uploadBtn, kitBtn),
    grid,
    h('div', { class: 'card' }, h('h3', {}, 'Preview'), h('div', { class: 'stage small-stage' }, previewCanvas), previewNote),
    h('details', { class: 'card' }, h('summary', {}, 'Customize this style'), editor),
  );
  let renderer;

  function swatchStrip(style) {
    return h('div', { class: 'strip' }, LAYERS.filter((l) => style.layers[l.key]?.amount > 0.05)
      .map((l) => h('span', { style: { background: style.layers[l.key].color }, title: l.label })));
  }

  const faceThumbs = new Map();
  /** Render a style on the user's scanned face as a small thumbnail (cached). */
  function faceThumb(style) {
    const cap = state.scan?.captures?.[0];
    if (!cap) return null;
    const key = style.id + JSON.stringify(style.layers);
    if (faceThumbs.get('cap') !== cap) { faceThumbs.clear(); faceThumbs.set('cap', cap); }
    if (!faceThumbs.has(key)) {
      try {
        renderer ||= new MakeupRenderer(previewCanvas);
        const ps = personalStyle(style);
        renderer.render2D(cap.image, cap.w, cap.h, cap.landmarks, ps, fullAmounts(ps), { mirror: true, crop: faceCrop(cap.landmarks, cap.w, cap.h, 0.12, 1) });
        const c = document.createElement('canvas');
        c.width = 240; c.height = 240;
        c.getContext('2d').drawImage(previewCanvas, 0, 0, 240, 240);
        faceThumbs.set(key, c.toDataURL('image/jpeg', 0.85));
      } catch { return null; }
    }
    return faceThumbs.get(key);
  }

  function renderGrid() {
    grid.replaceChildren(...allStyles().map((s) => {
      const ft = s.thumb ? null : faceThumb(s);
      const card = h('button', { class: 'style-card' + (s.id === state.styleId ? ' selected' : '') },
        s.thumb ? h('img', { src: s.thumb, alt: '' }) : ft ? h('img', { src: ft, alt: '' }) : h('div', { class: 'ph' }, '💄'),
        h('div', { class: 'style-name' }, s.name),
        swatchStrip(s),
      );
      card.addEventListener('click', () => { state.styleId = s.id; saveStyleId(); emit('style'); refresh(); });
      return card;
    }));
  }

  function renderPreview() {
    const style = currentStyle();
    const cap = state.scan?.captures?.[0];
    try {
      renderer ||= new MakeupRenderer(previewCanvas);
      if (cap) {
        const ps = personalStyle(style);
        renderer.render2D(cap.image, cap.w, cap.h, cap.landmarks, ps, fullAmounts(ps), { mirror: true, crop: faceCrop(cap.landmarks, cap.w, cap.h) });
        previewNote.textContent = 'Shown on your scanned face.';
      } else {
        previewNote.textContent = 'Scan your face to preview styles on yourself.';
        const ctx = previewCanvas.getContext('webgl2');
        ctx?.clearColor(0.1, 0.08, 0.12, 1); ctx?.clear(ctx.COLOR_BUFFER_BIT);
      }
    } catch (e) { previewNote.textContent = e.message; }
  }

  function editable() {
    let style = currentStyle();
    if (style.builtin) {
      style = cloneStyle(style);
      style.id = 'custom-' + Date.now().toString(36);
      style.name += ' (mine)';
      style.builtin = false;
      upsertStyle(style);
      state.styleId = style.id; saveStyleId();
      renderGrid();
    }
    return state.customStyles.find((s) => s.id === style.id);
  }

  function renderEditor() {
    const style = currentStyle();
    const rows = LAYERS.map((l) => {
      const v = style.layers[l.key];
      const col = h('input', { type: 'color', value: v.color });
      const amt = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: v.amount });
      const upd = () => {
        const s = editable();
        if (s.layers[l.key].color !== col.value) s.layers[l.key].custom = true;
        s.layers[l.key].color = col.value;
        s.layers[l.key].amount = +amt.value;
        saveStyles(); emit('style');
        renderPreview();
      };
      col.addEventListener('change', upd);
      amt.addEventListener('change', upd);
      amt.addEventListener('input', () => {
        const s = currentStyle();
        if (!s.builtin) { s.layers[l.key].amount = +amt.value; renderPreview(); }
      });
      return h('div', { class: 'edit-row' }, h('span', {}, l.label), col, amt);
    });
    const name = h('input', { class: 'name', value: style.name });
    name.addEventListener('change', () => { const s = editable(); s.name = name.value; saveStyles(); renderGrid(); });
    const del = !style.builtin ? h('button', {
      class: 'btn tiny ghost danger',
      onclick: () => {
        state.customStyles = state.customStyles.filter((s) => s.id !== style.id);
        state.styleId = allStyles()[0].id; saveStyles(); saveStyleId(); emit('style'); refresh();
      },
    }, 'Delete style') : null;
    editor.replaceChildren(h('div', { class: 'edit-row' }, h('span', {}, 'Name'), name), ...rows, del || '');
  }

  function refresh() { renderGrid(); renderPreview(); renderEditor(); }

  uploadBtn.addEventListener('click', async () => {
    const file = await filePicker();
    if (!file) return;
    uploadBtn.disabled = true; uploadBtn.textContent = 'Reading the look…';
    try {
      const bmp = await createImageBitmap(file);
      const { canvas, ctx, w, h: hh } = toCanvas(bmp, 1280);
      const lm = await detectFace(canvas);
      if (!lm) throw new Error('No face found in that image.');
      const style = extractStyle(ctx, w, hh, lm, file.name.replace(/\.[^.]+$/, '').slice(0, 28) || 'Uploaded look');
      style.thumb = thumb(canvas, 320);
      upsertStyle(style);
      state.styleId = style.id; saveStyleId(); emit('style');
      refresh();
      toast('Style created from your photo');
    } catch (e) { toast(e.message); }
    uploadBtn.disabled = false; uploadBtn.textContent = '⬆  Upload a makeup look';
  });

  kitBtn.addEventListener('click', () => {
    if (!state.kit.length) return toast('Add products in the Kit tab first.');
    const s = editable();
    let n = 0;
    for (const l of LAYERS) {
      if (!(s.layers[l.key].amount > 0.02)) continue;
      const m = matchProduct(state.kit, l.key, s.layers[l.key].color);
      if (m) { s.layers[l.key].color = m.color; n++; }
    }
    saveStyles(); emit('style'); refresh();
    toast(n ? `Matched ${n} steps to your products` : 'No matching products in your kit');
  });

  return { el: root, show: refresh, hide() {} };
}
