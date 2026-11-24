// Makeup region shapes built from MediaPipe Face Mesh landmarks (478 points).
// "right"/"left" are the subject's own sides.

export const IDX = {
  oval: [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109],
  lipsOuter: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146],
  lipsInner: [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95],
  rightEye: [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7],
  leftEye: [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249],
  // upper / lower lids ordered inner -> outer corner
  rightUpper: [133, 173, 157, 158, 159, 160, 161, 246, 33],
  rightLower: [133, 155, 154, 153, 145, 144, 163, 7, 33],
  leftUpper: [362, 398, 384, 385, 386, 387, 388, 466, 263],
  leftLower: [362, 382, 381, 380, 374, 373, 390, 249, 263],
  rightBrow: [46, 53, 52, 65, 55, 107, 66, 105, 63, 70],
  leftBrow: [276, 283, 282, 295, 285, 336, 296, 334, 293, 300],
  // cheek / sampling anchors
  rightCheek: 50, leftCheek: 280, rightEar: 234, leftEar: 454,
  rightCheekbone: 117, leftCheekbone: 346, rightMouth: 61, leftMouth: 291,
  forehead: 151, chin: 152, top: 10, noseBridge: 6, noseTip: 4,
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, s) => [a[0] * s, a[1] * s];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function ellipse(c, axis, ra, rb, n = 28) {
  const ax = norm(axis), perp = [-ax[1], ax[0]];
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push(add(c, add(mul(ax, Math.cos(t) * ra), mul(perp, Math.sin(t) * rb))));
  }
  return pts;
}

/** Face geometry in pixel space. */
export function faceFrame(lm, w, h) {
  const P = (i) => [lm[i].x * w, lm[i].y * h];
  const up = norm(sub(P(IDX.top), P(IDX.chin)));
  const faceW = len(sub(P(IDX.leftEar), P(IDX.rightEar)));
  return { P, up, down: mul(up, -1), faceW };
}

function eyeShapes(F, upperIdx, lowerIdx) {
  const { P, up } = F;
  const U = upperIdx.map(P), Lo = lowerIdx.map(P);
  const inner = U[0], outer = U[U.length - 1];
  const eyeW = len(sub(outer, inner));
  const outward = norm(sub(outer, inner));
  return { U, Lo, inner, outer, eyeW, outward, up };
}

function band(U, offsetFn) {
  // polygon = U (inner->outer) + offset points reversed
  const top = U.map((p, i) => add(p, offsetFn(i / (U.length - 1), p)));
  return [...U, ...top.reverse()];
}

/**
 * Build shapes for a layer: returns { polys: [{outer, holes}], blur } in pixel units.
 */
export function layerShapes(key, lm, w, h, layer = {}) {
  const F = faceFrame(lm, w, h);
  const { P, up, down, faceW } = F;
  const eyes = [eyeShapes(F, IDX.rightUpper, IDX.rightLower), eyeShapes(F, IDX.leftUpper, IDX.leftLower)];
  const poly = (outer, holes = []) => ({ outer, holes });
  switch (key) {
    case 'foundation':
      return {
        polys: [poly(IDX.oval.map(P), [IDX.rightEye.map(P), IDX.leftEye.map(P), IDX.lipsOuter.map(P)])],
        blur: faceW * 0.035,
      };
    case 'concealer':
      return {
        polys: eyes.map((e) => {
          const mid = lerp(e.inner, e.outer, 0.4);
          const apex = add(mid, mul(down, e.eyeW * 0.95));
          const lower = e.Lo.map((p) => add(p, mul(down, e.eyeW * 0.06)));
          return poly([...lower, apex]);
        }),
        blur: faceW * 0.04,
      };
    case 'contour': {
      const sides = [[IDX.rightEar, IDX.rightMouth], [IDX.leftEar, IDX.leftMouth]];
      return {
        polys: sides.map(([ear, mouth]) => {
          const a = P(ear), b = P(mouth);
          const c = add(lerp(a, b, 0.3), mul(down, faceW * 0.02));
          return poly(ellipse(c, sub(b, a), faceW * 0.15, faceW * 0.04));
        }),
        blur: faceW * 0.05,
      };
    }
    case 'blush': {
      const sides = [[IDX.rightCheek, IDX.rightEar], [IDX.leftCheek, IDX.leftEar]];
      return {
        polys: sides.map(([cheek, ear]) => {
          const c0 = P(cheek), e = P(ear);
          const axis = add(norm(sub(e, c0)), mul(up, 0.45));
          return poly(ellipse(lerp(c0, e, 0.12), axis, faceW * 0.12, faceW * 0.07));
        }),
        blur: faceW * 0.07,
      };
    }
    case 'highlighter': {
      const sides = [[IDX.rightCheekbone, IDX.rightEar], [IDX.leftCheekbone, IDX.leftEar]];
      const polys = sides.map(([cb, ear]) => {
        const c0 = P(cb), e = P(ear);
        return poly(ellipse(lerp(c0, e, 0.3), add(sub(e, c0), mul(up, faceW * 0.2)), faceW * 0.08, faceW * 0.022));
      });
      const nb = P(IDX.noseBridge), nt = P(IDX.noseTip);
      polys.push(poly(ellipse(lerp(nb, nt, 0.45), sub(nt, nb), len(sub(nt, nb)) * 0.5, faceW * 0.012)));
      return { polys, blur: faceW * 0.03 };
    }
    case 'brows':
      return { polys: [poly(IDX.rightBrow.map(P)), poly(IDX.leftBrow.map(P))], blur: faceW * 0.006 };
    case 'eyeshadow':
      return {
        polys: eyes.map((e) => {
          const ext = add(e.outer, add(mul(e.outward, e.eyeW * 0.15), mul(up, e.eyeW * 0.2)));
          const top = e.U.map((p, i) => add(p, mul(up, e.eyeW * (0.26 + 0.16 * (i / (e.U.length - 1))))));
          return poly([...e.U, ext, ...top.reverse()]);
        }),
        blur: faceW * 0.018,
      };
    case 'crease':
      return {
        polys: eyes.map((e) => {
          const c = add(lerp(e.inner, e.outer, 0.78), add(mul(up, e.eyeW * 0.3), mul(e.outward, e.eyeW * 0.06)));
          return poly(ellipse(c, add(e.outward, mul(up, 0.7)), e.eyeW * 0.36, e.eyeW * 0.15));
        }),
        blur: faceW * 0.025,
      };
    case 'eyeliner': {
      const wing = layer.wing ?? 0;
      return {
        polys: eyes.map((e) => {
          const base = e.U.map((p) => add(p, mul(down, e.eyeW * 0.01)));
          const top = base.map((p, i) => add(p, mul(up, e.eyeW * (0.025 + 0.06 * (i / (base.length - 1)) ** 1.5))));
          const tip = add(e.outer, mul(add(mul(e.outward, 0.32), mul(up, 0.17)), e.eyeW * Math.max(0.05, wing)));
          return poly([...base, tip, ...top.reverse()]);
        }),
        blur: faceW * 0.004,
      };
    }
    case 'mascara':
      return {
        polys: eyes.flatMap((e) => [
          poly(band(e.U, (t) => mul(up, e.eyeW * (0.04 + 0.08 * t)))),
          poly(band(e.Lo, (t) => mul(down, e.eyeW * (0.01 + 0.035 * t)))),
        ]),
        blur: faceW * 0.008,
      };
    case 'lips':
      return { polys: [poly(IDX.lipsOuter.map(P), [IDX.lipsInner.map(P)])], blur: faceW * 0.005 };
    default:
      return { polys: [], blur: 0 };
  }
}

/** Sampling regions (for analysis/scoring): name -> list of polys per side. */
export function sampleRegions(lm, w, h) {
  const F = faceFrame(lm, w, h);
  const { P, up, faceW } = F;
  const eyes = [eyeShapes(F, IDX.rightUpper, IDX.rightLower), eyeShapes(F, IDX.leftUpper, IDX.leftLower)];
  const lid = (e) => {
    const top = e.U.map((p, i) => add(p, mul(up, e.eyeW * (0.1 + 0.12 * (i / (e.U.length - 1))))));
    const lifted = e.U.map((p) => add(p, mul(up, e.eyeW * 0.05)));
    return [...lifted, ...top.reverse()];
  };
  const cheek = (c, ear) => ellipse(lerp(P(c), P(ear), 0.12), sub(P(ear), P(c)), faceW * 0.06, faceW * 0.04, 16);
  const fh = P(IDX.forehead);
  return {
    // several skin patches (forehead, both upper cheeks beside the nose, chin); hair/blush may cover some
    skin: [
      [ellipse(add(fh, mul(up, -faceW * 0.04)), [1, 0], faceW * 0.1, faceW * 0.04, 16)],
      [ellipse(P(101), [1, 0], faceW * 0.04, faceW * 0.03, 12)],
      [ellipse(P(330), [1, 0], faceW * 0.04, faceW * 0.03, 12)],
      [ellipse(lerp(P(17), P(IDX.chin), 0.55), [1, 0], faceW * 0.06, faceW * 0.025, 12)],
    ],
    lips: [[IDX.lipsOuter.map(P), IDX.lipsInner.map(P)]],
    lid: [[lid(eyes[0])], [lid(eyes[1])]],
    cheek: [[cheek(IDX.rightCheek, IDX.rightEar)], [cheek(IDX.leftCheek, IDX.leftEar)]],
    brows: [[IDX.rightBrow.map(P)], [IDX.leftBrow.map(P)]],
    liner: [[band(eyes[0].U, () => mul(up, eyes[0].eyeW * 0.05))], [band(eyes[1].U, () => mul(up, eyes[1].eyeW * 0.05))]],
    undereye: [[layerShapes('concealer', lm, w, h).polys[0].outer], [layerShapes('concealer', lm, w, h).polys[1].outer]],
  };
}
