// Minimal IndexedDB key/value store (everything stays on the device).
const DB = 'myownmakeup', STORE = 'kv';
let dbP;
function db() {
  return (dbP ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
function tx(mode, fn) {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
  }));
}
export const get = (k) => tx('readonly', (s) => s.get(k));
export const set = (k, v) => tx('readwrite', (s) => s.put(v, k));
export const del = (k) => tx('readwrite', (s) => s.delete(k));

export function canvasToBlob(canvas, type = 'image/jpeg', q = 0.9) {
  return new Promise((res) => canvas.toBlob(res, type, q));
}

export function blobToImage(blob) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = URL.createObjectURL(blob);
  });
}

export function fileToImage(file) { return blobToImage(file); }

export function thumb(src, size = 240) {
  const sw = src.videoWidth || src.naturalWidth || src.width, sh = src.videoHeight || src.naturalHeight || src.height;
  const s = size / Math.max(sw, sh);
  const c = document.createElement('canvas');
  c.width = Math.round(sw * s); c.height = Math.round(sh * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}
