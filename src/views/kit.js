// Makeup kit: photograph your products, auto-detect type & shades, edit, eyedrop colors.
import { h, toast, filePicker } from '../ui.js';
import { state, saveKit, emit } from '../state.js';
import { detectProduct, toCanvas } from '../analysis.js';
import { KIT_TYPES } from '../makeup.js';
import { rgbToHex } from '../color.js';
import { thumb } from '../store.js';

export function kitView() {
  const list = h('div', { class: 'kit-list' });
  const addBtn = h('button', { class: 'btn primary' }, '📷  Add a product');
  const root = h('section', { class: 'view' },
    h('h2', {}, 'Your makeup kit'),
    h('p', { class: 'muted' }, 'Take a photo of each product on a plain background. We detect the type and shade — tap the photo to pick an exact color, and correct the type if needed. The guide then tells you which of your products to use.'),
    h('div', { class: 'row' }, addBtn),
    list,
  );

  addBtn.addEventListener('click', async () => {
    const file = await filePicker({ capture: 'environment' });
    if (!file) return;
    addBtn.disabled = true; addBtn.textContent = 'Detecting…';
    try {
      const bmp = await createImageBitmap(file);
      const { canvas } = toCanvas(bmp, 640);
      const det = await detectProduct(canvas);
      const item = {
        id: 'p' + Date.now().toString(36),
        name: niceName(det.type),
        type: det.type,
        colors: det.colors,
        confidence: det.confidence,
        alternatives: det.alternatives,
        labels: det.labels,
        thumb: thumb(canvas, 480),
      };
      state.kit.unshift(item);
      await saveKit(); emit('kit');
      render();
      toast(`Detected: ${item.name} (${Math.round(det.confidence * 100)}% sure)`);
    } catch (e) { console.error(e); toast('Could not analyze that photo: ' + e.message); }
    addBtn.disabled = false; addBtn.textContent = '📷  Add a product';
  });

  function render() {
    list.replaceChildren();
    if (!state.kit.length) list.append(h('p', { class: 'empty' }, 'No products yet. Add your lipsticks, palettes, blush, foundation…'));
    for (const item of state.kit) list.append(card(item));
  }

  function card(item) {
    const img = h('img', { src: item.thumb, alt: item.name, title: 'Tap to pick a color from the photo' });
    const swatches = h('div', { class: 'swatches' });
    const save = () => { saveKit(); emit('kit'); };
    const drawSwatches = () => {
      swatches.replaceChildren(
        ...item.colors.map((c, i) => {
          const inp = h('input', { type: 'color', value: c, title: 'Change shade' });
          inp.addEventListener('input', () => { item.colors[i] = inp.value; save(); });
          const rm = h('button', { class: 'x', title: 'Remove shade', onclick: () => { item.colors.splice(i, 1); drawSwatches(); save(); } }, '×');
          return h('span', { class: 'swatch-edit' }, inp, rm);
        }),
        h('button', { class: 'btn tiny ghost', onclick: () => { item.colors.push('#c08080'); drawSwatches(); save(); } }, '+ shade'),
      );
    };
    drawSwatches();
    img.addEventListener('click', (e) => {
      const r = img.getBoundingClientRect();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const x = ((e.clientX - r.left) / r.width) * c.width, y = ((e.clientY - r.top) / r.height) * c.height;
      const d = ctx.getImageData(Math.max(0, x - 2), Math.max(0, y - 2), 5, 5).data;
      const avg = [0, 1, 2].map((k) => { let s = 0; for (let i = k; i < d.length; i += 4) s += d[i]; return s / (d.length / 4); });
      item.colors.push(rgbToHex(avg));
      drawSwatches(); save();
      toast('Shade added from photo');
    });
    const typeSel = h('select', {}, KIT_TYPES.map((t) => h('option', { value: t, selected: t === item.type }, niceName(t))));
    typeSel.addEventListener('change', () => { item.type = typeSel.value; save(); });
    const name = h('input', { class: 'name', value: item.name });
    name.addEventListener('change', () => { item.name = name.value; save(); });
    const del = h('button', { class: 'btn tiny ghost danger' }, 'Remove');
    del.addEventListener('click', () => { state.kit = state.kit.filter((x) => x !== item); save(); render(); });
    const hint = item.labels?.length ? `Seen as: ${item.labels.slice(0, 3).map((l) => l.name).join(', ')}` : '';
    return h('div', { class: 'card kit-card' },
      img,
      h('div', { class: 'kit-body' },
        name,
        h('label', { class: 'small muted' }, 'Type ', typeSel,
          item.confidence != null ? h('span', { class: 'conf' }, ` ${Math.round(item.confidence * 100)}%`) : null),
        swatches,
        h('div', { class: 'small muted' }, hint),
        del,
      ),
    );
  }

  return { el: root, show: render, hide() {} };
}

export const niceName = (t) => ({
  foundation: 'Foundation', concealer: 'Concealer', powder: 'Powder', contour: 'Contour', bronzer: 'Bronzer',
  blush: 'Blush', highlighter: 'Highlighter', brow: 'Brow pencil/gel', eyeshadow: 'Eyeshadow palette',
  eyeliner: 'Eyeliner', mascara: 'Mascara', lipstick: 'Lipstick', lipgloss: 'Lip gloss', tool: 'Brush / tool', other: 'Other',
}[t] || t);
