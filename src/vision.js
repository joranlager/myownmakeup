// MediaPipe loaders (face landmarks for video + still images, generic image classifier for products).
import { FaceLandmarker, FilesetResolver, ImageClassifier } from '@mediapipe/tasks-vision';

const WASM = new URL('mediapipe/wasm', new URL(import.meta.env.BASE_URL, location.href)).href.replace(/\/$/, '');
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const CLASSIFIER_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/int8/1/efficientnet_lite0.tflite';

let filesetP, videoLmP, imageLmP, classifierP;

const fileset = () => (filesetP ||= FilesetResolver.forVisionTasks(WASM));

async function withDelegate(create) {
  try { return await create('GPU'); } catch (e) { console.warn('GPU delegate failed, using CPU', e); return create('CPU'); }
}

export function videoLandmarker() {
  return (videoLmP ||= fileset().then((fs) => withDelegate((delegate) => FaceLandmarker.createFromOptions(fs, {
    baseOptions: { modelAssetPath: FACE_MODEL, delegate },
    runningMode: 'VIDEO', numFaces: 1,
    outputFacialTransformationMatrixes: true,
  }))));
}

export function imageLandmarker() {
  return (imageLmP ||= fileset().then((fs) => withDelegate((delegate) => FaceLandmarker.createFromOptions(fs, {
    baseOptions: { modelAssetPath: FACE_MODEL, delegate },
    runningMode: 'IMAGE', numFaces: 1,
  }))));
}

export function classifier() {
  return (classifierP ||= fileset().then((fs) => ImageClassifier.createFromOptions(fs, {
    baseOptions: { modelAssetPath: CLASSIFIER_MODEL },
    runningMode: 'IMAGE', maxResults: 10,
  })));
}

/** Detect face landmarks on a still image/canvas. Returns landmarks array or null. */
export async function detectFace(image) {
  const lm = await imageLandmarker();
  const res = lm.detect(image);
  return res.faceLandmarks?.[0] || null;
}

/** Head pose from landmarks: yaw (signed, ~ -1..1) and pitch ratio. */
export function headPose(lm) {
  const nose = lm[1], r = lm[234], l = lm[454];
  const midX = (r.x + l.x) / 2;
  const width = Math.abs(l.x - r.x) || 1e-3;
  const yaw = (nose.x - midX) / width; // + = subject turned to their left (in raw camera image)
  const eyeY = (lm[33].y + lm[263].y) / 2;
  const pitch = (nose.y - eyeY) / ((lm[152].y - eyeY) || 1e-3);
  const roll = Math.atan2(lm[263].y - lm[33].y, lm[263].x - lm[33].x);
  return { yaw, pitch, roll, width, cx: midX, cy: (lm[10].y + lm[152].y) / 2 };
}
