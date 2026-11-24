// WebGL2 makeup renderer: rasterizes landmark-driven makeup masks, blurs them and composites
// them over a photo/video frame; can also render a textured 3D face mesh from multi-angle scans.
import earcut from 'earcut';
import { LAYERS } from './makeup.js';
import { layerShapes } from './shapes.js';
import { hexToVec3 } from './color.js';
import { triangles, holeFillTriangles } from './mesh.js';

const VS_QUAD = `#version 300 es
in vec2 aPos; uniform float uFlipY; uniform float uMirror; uniform vec4 uCrop; out vec2 vUv;
void main(){
  vUv = aPos*0.5+0.5;
  if(uFlipY>0.5) vUv.y = 1.0 - vUv.y;
  if(uMirror>0.5) vUv.x = 1.0 - vUv.x;
  vUv = uCrop.xy + vUv*uCrop.zw;
  gl_Position = vec4(aPos,0.,1.);
}`;
const FS_COPY = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uTex; out vec4 o;
void main(){ o = vec4(texture(uTex,vUv).rgb,1.); }`;
const VS_POLY = `#version 300 es
in vec2 aPos; uniform vec2 uSize;
void main(){ gl_Position = vec4(aPos/uSize*2.0-1.0,0.,1.); }`;
const FS_POLY = `#version 300 es
precision mediump float; out vec4 o; void main(){ o = vec4(1.); }`;
const FS_BLUR = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uTex; uniform vec2 uStep; out vec4 o;
void main(){
  float s = 0.0, wsum = 0.0;
  for(int i=-7;i<=7;i++){ float w = exp(-float(i*i)/18.0); s += texture(uTex, vUv+uStep*float(i)).r*w; wsum += w; }
  o = vec4(s/wsum,0.,0.,1.);
}`;
const FS_COMP = `#version 300 es
precision highp float; in vec2 vUv;
uniform sampler2D uBase; uniform sampler2D uMask; uniform vec3 uColor; uniform float uAmount;
uniform int uMode; uniform float uGloss; uniform vec2 uTexel; out vec4 o;
float lum(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
vec3 softLight(vec3 b, vec3 s){ return mix(2.0*b*s + b*b*(1.0-2.0*s), sqrt(b)*(2.0*s-1.0) + 2.0*b*(1.0-s), step(0.5,s)); }
void main(){
  vec3 b = texture(uBase,vUv).rgb;
  float m = clamp(texture(uMask,vUv).r,0.,1.) * uAmount;
  vec3 r = b;
  float L = lum(b);
  if(uMode==0){
    vec3 bl = vec3(0.);
    for(int i=0;i<8;i++){ float a = float(i)*0.785398; bl += texture(uBase, vUv + vec2(cos(a),sin(a))*uTexel*4.0).rgb; }
    bl /= 8.0;
    vec3 smooth_ = mix(b, bl, 0.55);
    vec3 t = mix(softLight(smooth_, uColor), uColor*(0.7+0.6*L), 0.35);
    r = mix(b, t, m*0.9);
  } else if(uMode==1){
    vec3 t = uColor * (1.0 + (L-0.55)*1.1);
    r = mix(b, t, m);
    r += m * uGloss * pow(L, 3.0) * 0.9;
  } else if(uMode==2){
    vec3 glow = 1.0-(1.0-b)*(1.0-uColor*0.3);
    r = mix(b, glow + b*uColor*0.12*L, m*0.8);
  } else {
    r = mix(b, b*uColor*1.15 + uColor*0.15, m);
  }
  o = vec4(clamp(r,0.,1.),1.);
}`;
const VS_MESH = `#version 300 es
in vec3 aPos; in vec2 aUv; uniform mat4 uMVP; uniform mat4 uModel; out vec2 vUv; out vec3 vW;
void main(){ vUv = aUv; vW = (uModel*vec4(aPos,1.)).xyz; gl_Position = uMVP*vec4(aPos,1.); }`;
const FS_MESH = `#version 300 es
precision highp float; in vec2 vUv; in vec3 vW; uniform sampler2D uTex; out vec4 o;
void main(){
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  float d = abs(dot(n, normalize(vec3(0.3,0.4,1.0))));
  vec3 c = texture(uTex, vUv).rgb;
  o = vec4(c*(0.78+0.3*d),1.);
}`;

function compile(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.bindAttribLocation(p, 1, 'aUv');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

export class MakeupRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: true, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 is not supported on this device/browser.');
    this.gl = gl;
    this.prog = {
      copy: compile(gl, VS_QUAD, FS_COPY),
      poly: compile(gl, VS_POLY, FS_POLY),
      blur: compile(gl, VS_QUAD, FS_BLUR),
      comp: compile(gl, VS_QUAD, FS_COMP),
      mesh: compile(gl, VS_MESH, FS_MESH),
    };
    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.polyVao = gl.createVertexArray();
    gl.bindVertexArray(this.polyVao);
    this.polyBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.polyBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.srcTex = this._tex();
    this.targets = {};
    this.mesh = null;
    this.rot = { yaw: 0, pitch: 0 };
  }

  _tex() {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  _target(name, w, h) {
    const gl = this.gl;
    let t = this.targets[name];
    if (t && t.w === w && t.h === h) return t;
    if (!t) t = this.targets[name] = { tex: this._tex(), fb: gl.createFramebuffer() };
    t.w = w; t.h = h;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    return t;
  }

  _bindTarget(t) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null);
    gl.viewport(0, 0, t ? t.w : this.canvas.width, t ? t.h : this.canvas.height);
  }

  _quad(prog, uniforms = {}, textures = []) {
    const gl = this.gl;
    gl.useProgram(prog.p);
    textures.forEach(([name, tex], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(prog.u[name], i);
    });
    gl.uniform1f(prog.u.uFlipY, uniforms.flipY ? 1 : 0);
    gl.uniform1f(prog.u.uMirror, uniforms.mirror ? 1 : 0);
    gl.uniform4fv(prog.u.uCrop, uniforms.crop || [0, 0, 1, 1]);
    for (const [k, v] of Object.entries(uniforms)) {
      const loc = prog.u[k];
      if (!loc || k === 'flipY' || k === 'mirror' || k === 'crop') continue;
      if (k === 'uMode') gl.uniform1i(loc, v);
      else if (typeof v === 'number') gl.uniform1f(loc, v);
      else if (v.length === 2) gl.uniform2fv(loc, v);
      else if (v.length === 3) gl.uniform3fv(loc, v);
    }
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  uploadSource(source, tex = this.srcTex) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  /**
   * Composite makeup over `source` into render target `outName` (returns that target).
   * landmarks: normalized face landmarks for the source (or null for no makeup).
   */
  composite(source, w, h, landmarks, style, amounts, outName = 'out', srcTex = null) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    if (!srcTex) { this.uploadSource(source); srcTex = this.srcTex; }
    let a = this._target(outName, w, h), b = this._target(outName + '_tmp', w, h);
    const mw = Math.max(64, Math.round(w / 2)), mh = Math.max(64, Math.round(h / 2));
    const mask = this._target('mask', mw, mh), mask2 = this._target('mask2', mw, mh);
    this._bindTarget(a);
    this._quad(this.prog.copy, {}, [['uTex', srcTex]]);
    if (landmarks && style) {
      for (const layer of LAYERS) {
        const amt = amounts[layer.key] || 0;
        if (amt <= 0.003) continue;
        const ldef = style.layers[layer.key] || {};
        const { polys, blur } = layerShapes(layer.key, landmarks, mw, mh, ldef);
        this._drawMask(mask, polys);
        const step = Math.max(0.5, blur / 7);
        this._bindTarget(mask2);
        this._quad(this.prog.blur, { uStep: [step / mw, 0] }, [['uTex', mask.tex]]);
        this._bindTarget(mask);
        this._quad(this.prog.blur, { uStep: [0, step / mh] }, [['uTex', mask2.tex]]);
        this._bindTarget(b);
        this._quad(this.prog.comp, {
          uColor: hexToVec3(ldef.color || '#000000'), uAmount: amt, uMode: layer.mode,
          uGloss: ldef.gloss || 0, uTexel: [1 / w, 1 / h],
        }, [['uBase', a.tex], ['uMask', mask.tex]]);
        [a, b] = [b, a];
      }
    }
    // keep the final result under the requested name
    if (a !== this.targets[outName]) {
      this.targets[outName + '_tmp'] = this.targets[outName];
      this.targets[outName] = a;
    }
    return a;
  }

  _drawMask(target, polys) {
    const gl = this.gl;
    this._bindTarget(target);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const verts = [];
    for (const { outer, holes } of polys) {
      const flat = [], holeIdx = [];
      outer.forEach((p) => flat.push(p[0], p[1]));
      for (const hole of holes || []) { holeIdx.push(flat.length / 2); hole.forEach((p) => flat.push(p[0], p[1])); }
      const tri = earcut(flat, holeIdx.length ? holeIdx : undefined);
      for (const i of tri) verts.push(flat[i * 2], flat[i * 2 + 1]);
    }
    if (!verts.length) return;
    gl.useProgram(this.prog.poly.p);
    gl.uniform2f(this.prog.poly.u.uSize, target.w, target.h);
    gl.bindVertexArray(this.polyVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.polyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, verts.length / 2);
  }

  /** Draw a target to the canvas. crop: [u, v, du, dv] sub-rectangle in normalized image coords. */
  present(target, { mirror = false, crop = null } = {}) {
    const gl = this.gl;
    const c = crop || [0, 0, 1, 1];
    const W = Math.round(target.w * c[2]), H = Math.round(target.h * c[3]);
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    this._bindTarget(null);
    this._quad(this.prog.copy, { flipY: true, mirror, crop: c }, [['uTex', target.tex]]);
  }

  /** Convenience: composite + present. */
  render2D(source, w, h, landmarks, style, amounts, opts = {}) {
    const t = this.composite(source, w, h, landmarks, style, amounts);
    this.present(t, opts);
    return t;
  }

  // ---------- 3D mesh ----------

  /**
   * Build a textured mesh from scan captures. captures: [{image, w, h, landmarks, pose}], first = front.
   * depth (optional): array of z values (in face-width units) per landmark from a depth sensor.
   */
  setScan(captures, depth = null) {
    const gl = this.gl;
    this.scan = captures.map((c, i) => {
      const tex = this._tex();
      this.uploadSource(c.image, tex);
      return { ...c, srcTex: tex, name: 'cap' + i };
    });
    const front = captures[0];
    const lm = front.landmarks;
    const W = front.w, H = front.h;
    const faceW = Math.hypot((lm[454].x - lm[234].x) * W, (lm[454].y - lm[234].y) * H);
    const pos = lm.map((p, i) => [
      ((p.x - 0.5) * W) / faceW,
      (-(p.y - 0.5) * H) / faceW,
      depth && depth[i] != null ? depth[i] : (-p.z * W) / faceW,
    ]);
    const c = pos.slice(0, 468).reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((v) => v / 468);
    for (const p of pos) { p[0] -= c[0]; p[1] -= c[1]; p[2] -= c[2]; }
    // choose for each triangle the capture that sees it most frontally
    const tris = [...triangles(), ...holeFillTriangles(lm)];
    const groups = this.scan.map(() => []);
    for (const t of tris) {
      let best = 0, bestScore = -Infinity;
      this.scan.forEach((cap, k) => {
        const L = cap.landmarks;
        const q = t.map((i) => [L[i].x * cap.w, L[i].y * cap.h, L[i].z * cap.w]);
        const u = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]];
        const v = [q[2][0] - q[0][0], q[2][1] - q[0][1], q[2][2] - q[0][2]];
        const nz = u[0] * v[1] - u[1] * v[0];
        const nl = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], nz) || 1;
        const score = Math.abs(nz) / nl + (k === 0 ? 0.08 : 0);
        if (score > bestScore) { bestScore = score; best = k; }
      });
      groups[best].push(t);
    }
    this.meshGroups = groups.map((g, k) => {
      const cap = this.scan[k];
      const data = [];
      for (const t of g) for (const i of t) data.push(...pos[i], cap.landmarks[i].x, cap.landmarks[i].y);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
      gl.bindVertexArray(null);
      return { vao, count: data.length / 5, k };
    });
  }

  /** Re-composite makeup on every scan capture (call when style/progress changes). */
  updateScanTextures(style, amounts) {
    if (!this.scan) return;
    const maxSide = 1024;
    for (const cap of this.scan) {
      const s = Math.min(1, maxSide / Math.max(cap.w, cap.h));
      cap.target = this.composite(null, Math.round(cap.w * s), Math.round(cap.h * s), cap.landmarks, style, amounts, cap.name, cap.srcTex);
    }
  }

  renderMesh() {
    const gl = this.gl;
    if (!this.meshGroups) return;
    const cw = this.canvas.clientWidth || 640, ch = this.canvas.clientHeight || 640;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(cw * dpr), H = Math.round(ch * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    this._bindTarget(null);
    gl.clearColor(0.12, 0.1, 0.13, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    const model = mat4mul(rotX(this.rot.pitch), rotY(this.rot.yaw));
    const view = translate(0, 0, -2.6);
    const proj = perspective(0.62, W / H, 0.1, 20);
    const mvp = mat4mul(proj, mat4mul(view, model));
    const pr = this.prog.mesh;
    gl.useProgram(pr.p);
    gl.uniformMatrix4fv(pr.u.uMVP, false, mvp);
    gl.uniformMatrix4fv(pr.u.uModel, false, model);
    for (const g of this.meshGroups) {
      const cap = this.scan[g.k];
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, cap.target ? cap.target.tex : cap.srcTex);
      gl.uniform1i(pr.u.uTex, 0);
      gl.bindVertexArray(g.vao);
      gl.drawArrays(gl.TRIANGLES, 0, g.count);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
  }
}

// ---- tiny column-major mat4 helpers ----
function mat4mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
function perspective(fovy, aspect, n, f) {
  const t = 1 / Math.tan(fovy / 2);
  return new Float32Array([t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]);
}
function translate(x, y, z) { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]); }
function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); }
function rotX(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); }
