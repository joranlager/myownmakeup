// Drag-to-rotate + gentle idle sway for the 3D face preview.
export function attachOrbit(canvas, renderer, { onFrame } = {}) {
  let dragging = false, lx = 0, ly = 0, idle = 0, raf = 0, alive = true;
  const down = (e) => { dragging = true; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture?.(e.pointerId); };
  const move = (e) => {
    if (!dragging) return;
    renderer.rot.yaw += (e.clientX - lx) * 0.01;
    renderer.rot.pitch = Math.max(-0.8, Math.min(0.8, renderer.rot.pitch + (e.clientY - ly) * 0.01));
    lx = e.clientX; ly = e.clientY; idle = performance.now();
  };
  const up = () => { dragging = false; idle = performance.now(); };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.style.touchAction = 'none';
  const tick = (t) => {
    if (!alive) return;
    raf = requestAnimationFrame(tick);
    if (!dragging && t - idle > 2500) renderer.rot.yaw += (Math.sin(t / 1800) * 0.5 - renderer.rot.yaw) * 0.02;
    onFrame?.();
    renderer.renderMesh();
  };
  raf = requestAnimationFrame(tick);
  return () => {
    alive = false; cancelAnimationFrame(raf);
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
  };
}
