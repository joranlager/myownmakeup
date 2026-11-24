// Copies MediaPipe's WASM runtime into public/ so the app serves it itself (no CDN needed).
import { cpSync, mkdirSync } from 'node:fs';
const src = new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url);
const dest = new URL('../public/mediapipe/wasm/', import.meta.url);
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log('Copied MediaPipe wasm to public/mediapipe/wasm');
