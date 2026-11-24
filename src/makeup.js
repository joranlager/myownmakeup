// Makeup model: layers (in application order), preset styles and step-by-step guide text.

// mode: 0 = skin (even/soft-light), 1 = tint, 2 = screen (glow), 3 = multiply (dark lines)
export const LAYERS = [
  { key: 'foundation', label: 'Foundation', mode: 0, kitTypes: ['foundation', 'powder'] },
  { key: 'concealer', label: 'Concealer', mode: 0, kitTypes: ['concealer', 'foundation'] },
  { key: 'contour', label: 'Contour', mode: 1, kitTypes: ['contour', 'bronzer', 'powder'] },
  { key: 'blush', label: 'Blush', mode: 1, kitTypes: ['blush'] },
  { key: 'highlighter', label: 'Highlighter', mode: 2, kitTypes: ['highlighter'] },
  { key: 'brows', label: 'Brows', mode: 3, kitTypes: ['brow', 'eyeliner'] },
  { key: 'eyeshadow', label: 'Eyeshadow (lid)', mode: 1, kitTypes: ['eyeshadow'] },
  { key: 'crease', label: 'Eyeshadow (crease)', mode: 1, kitTypes: ['eyeshadow'] },
  { key: 'eyeliner', label: 'Eyeliner', mode: 3, kitTypes: ['eyeliner'] },
  { key: 'mascara', label: 'Mascara', mode: 3, kitTypes: ['mascara'] },
  { key: 'lips', label: 'Lips', mode: 1, kitTypes: ['lipstick', 'lipgloss'] },
];
export const LAYER_BY_KEY = Object.fromEntries(LAYERS.map((l) => [l.key, l]));

export const KIT_TYPES = [
  'foundation', 'concealer', 'powder', 'contour', 'bronzer', 'blush', 'highlighter',
  'brow', 'eyeshadow', 'eyeliner', 'mascara', 'lipstick', 'lipgloss', 'tool', 'other',
];

const L = (color, amount, extra = {}) => ({ color, amount, ...extra });

export const PRESETS = [
  {
    id: 'natural-glow', name: 'Natural Glow', builtin: true,
    layers: {
      foundation: L('#d9a88a', 0.35), concealer: L('#e8c0a2', 0.35), contour: L('#8a5a44', 0),
      blush: L('#e0857a', 0.35), highlighter: L('#fff1dc', 0.35), brows: L('#5a3d2b', 0.35),
      eyeshadow: L('#c79a83', 0.35), crease: L('#9c6b55', 0.25), eyeliner: L('#2b1d17', 0, { wing: 0 }),
      mascara: L('#1a1414', 0.5), lips: L('#c9767a', 0.55, { gloss: 0.4 }),
    },
  },
  {
    id: 'classic-red', name: 'Classic Red Lip', builtin: true,
    layers: {
      foundation: L('#e0b096', 0.45), concealer: L('#ecc8ad', 0.4), contour: L('#8a5a44', 0.2),
      blush: L('#d77a6f', 0.2), highlighter: L('#fff3e2', 0.3), brows: L('#4a3122', 0.5),
      eyeshadow: L('#d8b49e', 0.25), crease: L('#9c6b55', 0.2), eyeliner: L('#111111', 0.85, { wing: 0.8 }),
      mascara: L('#0d0d0d', 0.75), lips: L('#b3122a', 0.92, { gloss: 0.15 }),
    },
  },
  {
    id: 'smoky-evening', name: 'Smoky Evening', builtin: true,
    layers: {
      foundation: L('#d9a88a', 0.45), concealer: L('#e8c0a2', 0.45), contour: L('#7a4c3a', 0.35),
      blush: L('#b8706a', 0.2), highlighter: L('#f5e6d8', 0.4), brows: L('#3b2a20', 0.55),
      eyeshadow: L('#4a4048', 0.75), crease: L('#2a2228', 0.6), eyeliner: L('#0b0b0b', 0.9, { wing: 0.4 }),
      mascara: L('#000000', 0.85), lips: L('#a8706c', 0.6, { gloss: 0.2 }),
    },
  },
  {
    id: 'soft-glam', name: 'Soft Glam', builtin: true,
    layers: {
      foundation: L('#dcab8d', 0.45), concealer: L('#efcdb2', 0.45), contour: L('#8a5a44', 0.35),
      blush: L('#d9807e', 0.4), highlighter: L('#fff0d6', 0.55), brows: L('#4a3122', 0.5),
      eyeshadow: L('#b97f66', 0.6), crease: L('#7d4a3a', 0.45), eyeliner: L('#2a1a14', 0.6, { wing: 0.5 }),
      mascara: L('#0d0d0d', 0.75), lips: L('#b86a6a', 0.75, { gloss: 0.5 }),
    },
  },
  {
    id: 'bold-berry', name: 'Bold Berry', builtin: true,
    layers: {
      foundation: L('#d9a88a', 0.4), concealer: L('#e8c0a2', 0.35), contour: L('#7a4c3a', 0.25),
      blush: L('#c25a7a', 0.4), highlighter: L('#fde8ee', 0.35), brows: L('#3b2a20', 0.5),
      eyeshadow: L('#7b3a5e', 0.55), crease: L('#4a1e3a', 0.4), eyeliner: L('#140a10', 0.7, { wing: 0.3 }),
      mascara: L('#000000', 0.7), lips: L('#6e1440', 0.9, { gloss: 0.25 }),
    },
  },
  {
    id: 'graphic-liner', name: 'Graphic Liner', builtin: true,
    layers: {
      foundation: L('#dcab8d', 0.35), concealer: L('#ecc8ad', 0.3), contour: L('#8a5a44', 0),
      blush: L('#e0857a', 0.2), highlighter: L('#fff1dc', 0.25), brows: L('#4a3122', 0.45),
      eyeshadow: L('#c9a28f', 0.15), crease: L('#9c6b55', 0), eyeliner: L('#000000', 1, { wing: 1 }),
      mascara: L('#000000', 0.7), lips: L('#c98a84', 0.5, { gloss: 0.3 }),
    },
  },
];

export function cloneStyle(s) { return JSON.parse(JSON.stringify(s)); }

const STEP_TEXT = {
  foundation: {
    title: 'Even out your skin',
    how: 'Dot foundation on forehead, cheeks, nose and chin. Blend outward with a damp sponge or brush in light pressing motions until there are no edges at the jaw.',
    tip: 'Less is more — you can always build a second thin layer.',
  },
  concealer: {
    title: 'Brighten under the eyes',
    how: 'Draw a small inverted triangle under each eye. Tap it in with your ring finger or a small sponge, blending the edges into the foundation.',
    tip: 'Keep it a shade lighter than your foundation for a lifted look.',
  },
  contour: {
    title: 'Sculpt with contour',
    how: 'Find the hollow under your cheekbone (suck in your cheeks). Sweep contour from the top of the ear toward the corner of the mouth, stopping at the middle of the eye. Blend upward.',
    tip: 'Use a light hand and blend until no stripe is visible.',
  },
  blush: {
    title: 'Add blush',
    how: 'Smile and tap blush on the apples of the cheeks, then sweep it back and up toward the temples.',
    tip: 'Tap off excess product from the brush before applying.',
  },
  highlighter: {
    title: 'Highlight',
    how: 'Sweep highlighter along the top of the cheekbones and a thin line down the bridge of the nose.',
    tip: 'Place it where light naturally hits your face.',
  },
  brows: {
    title: 'Define your brows',
    how: 'Brush brows upward. Fill sparse areas with short, hair-like strokes, following the shape shown. Keep the inner start softer than the tail.',
    tip: 'Use a spoolie to soften harsh lines.',
  },
  eyeshadow: {
    title: 'Lid shadow',
    how: 'Pat the lid shade over the whole mobile lid, from lash line up to just under the crease, as shown on the model.',
    tip: 'Patting gives more pigment than swiping.',
  },
  crease: {
    title: 'Crease & depth',
    how: 'With a fluffy brush, apply the deeper shade to the outer corner and crease using small windshield-wiper motions. Blend the edge so it fades out.',
    tip: 'Keep the darkest point at the outer corner.',
  },
  eyeliner: {
    title: 'Line the eyes',
    how: 'Draw along the upper lash line from inner to outer corner, getting thicker toward the outside. For a wing, extend a line from the outer corner toward the tail of the brow.',
    tip: 'Rest your elbow on the table for a steady hand.',
  },
  mascara: {
    title: 'Mascara',
    how: 'Wiggle the wand at the base of the upper lashes and pull up to the tips. Lightly touch the lower lashes if you like.',
    tip: 'Two thin coats beat one thick coat.',
  },
  lips: {
    title: 'Lips',
    how: 'Line the outer edge of the lips, then fill in from the center outward. Blot with a tissue and apply a second layer for a long-lasting finish.',
    tip: 'Clean up edges with a bit of concealer on a small brush.',
  },
};

/** Ordered list of guide steps for a style (only layers that are actually used). */
export function buildSteps(style) {
  return LAYERS.filter((l) => (style.layers[l.key]?.amount || 0) > 0.02).map((l) => ({
    key: l.key,
    label: l.label,
    ...STEP_TEXT[l.key],
    color: style.layers[l.key].color,
  }));
}

/** Per-layer amounts for slider position t (0..steps.length); layer i fades in over [i, i+1]. */
export function amountsAt(style, steps, t) {
  const out = {};
  for (const l of LAYERS) out[l.key] = 0;
  steps.forEach((s, i) => {
    out[s.key] = (style.layers[s.key]?.amount || 0) * Math.min(1, Math.max(0, t - i));
  });
  return out;
}

export function fullAmounts(style) {
  const out = {};
  for (const l of LAYERS) out[l.key] = style.layers[l.key]?.amount || 0;
  return out;
}
