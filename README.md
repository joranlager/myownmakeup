# My Own Makeup

A single-page web app that coaches you through a makeup look using your camera, your face and your own products. Everything runs in the browser on your device. Nothing is uploaded.

## Features

- **Face scan.** A guided capture from 4 angles (front, both sides, chin up). It gives live feedback on distance, centering, lighting and head pose, and captures automatically when you hold still. The scan becomes a textured **WebGL 3D face**: each triangle is textured from the angle that sees it best, and you can drag to rotate it.
- **Depth sensor (LiDAR/ToF).** Where the browser exposes hardware depth through the WebXR Depth Sensing API (for example Chrome on ARCore phones), an optional depth scan replaces the estimated face depth. iOS Safari does not expose LiDAR to web pages, so there the app uses MediaPipe's estimated 3D landmarks.
- **Makeup kit.** Photograph your products. An on-device image classifier plus color analysis guesses the type (lipstick, eyeshadow palette, blush, foundation, mascara, …) and the shades. Tap the photo to pick an exact shade, and correct the type if it's wrong.
- **Styles.** Six presets, or upload a photo of a finished makeup look. The app reads the lip, lid, crease, blush, brow and liner colors from the photo and turns them into a style. You can customize each layer, or snap the colors to the closest products in your kit. Foundation and concealer are matched to your own skin tone automatically.
- **Step-by-step guide.** A slider scrubs back and forth through the steps. Each layer fades in and is rendered in real time on your 3D face, or on your live camera image ("Live mirror"). Every step comes with instructions and a tip, and tells you which of your products to use.
- **Check & score.** Photograph your finished makeup. Each face region is compared (CIEDE2000) with the chosen style rendered on your own bare scan. You get an overall similarity score, a score per region, a left/right symmetry score and concrete tips. Past results are kept in a history.

## Tech

- Vite with plain ES modules, WebGL2 shaders (`src/renderer.js`)
- MediaPipe Tasks Vision: Face Landmarker (478 points) and an EfficientNet-Lite image classifier. The WASM runtime is served by the app itself. The models are fetched from Google's model storage on first use.
- IndexedDB for local persistence

## Develop

```bash
npm install
npm run dev
```

The camera needs `https://` or `localhost`. To test on a phone, use the deployed GitHub Pages URL.

## Deploy (GitHub Pages, every branch)

`.github/workflows/deploy.yml` builds on every push to any branch and publishes to the `gh-pages` branch:

| Branch | URL |
|---|---|
| `main` (default) | `https://<owner>.github.io/<repo>/` |
| any other branch | `https://<owner>.github.io/<repo>/branches/<branch-slug>/` |

When a branch is deleted, its published copy is removed too. The workflow tries to enable Pages automatically. If that fails, go to **Settings → Pages → Build and deployment → Deploy from a branch** and choose `gh-pages` / `(root)`.
