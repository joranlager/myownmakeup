// Recover the face mesh triangles from MediaPipe's tessellation edge list (3-cliques of the edge graph).
import { FaceLandmarker } from '@mediapipe/tasks-vision';
import earcut from 'earcut';
import { IDX } from './shapes.js';

let cached = null;

export function triangles() {
  if (cached) return cached;
  const adj = new Map();
  const addEdge = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a).add(b);
  };
  for (const { start, end } of FaceLandmarker.FACE_LANDMARKS_TESSELATION) {
    addEdge(start, end); addEdge(end, start);
  }
  const tris = [];
  for (const [a, na] of adj) {
    for (const b of na) {
      if (b <= a) continue;
      for (const c of adj.get(b)) {
        if (c <= b || !na.has(c)) continue;
        tris.push([a, b, c]);
      }
    }
  }
  cached = tris;
  return tris;
}

/** Triangles that close the eye and mouth openings (the face mesh leaves them as holes). */
export function holeFillTriangles(landmarks) {
  const out = [];
  for (const loop of [IDX.rightEye, IDX.leftEye, IDX.lipsInner]) {
    const flat = loop.flatMap((i) => [landmarks[i].x, landmarks[i].y]);
    const tri = earcut(flat);
    for (let k = 0; k < tri.length; k += 3) out.push([loop[tri[k]], loop[tri[k + 1]], loop[tri[k + 2]]]);
  }
  return out;
}
