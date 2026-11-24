import './style.css';
import { h } from './ui.js';
import { state, load, onChange, currentStyle } from './state.js';
import { scanView } from './views/scan.js';
import { kitView } from './views/kit.js';
import { stylesView } from './views/styles.js';
import { guideView } from './views/guide.js';
import { checkView } from './views/check.js';
import { videoLandmarker } from './vision.js';

const app = document.getElementById('app');

function homeView() {
  const steps = h('ol', { class: 'flow' });
  const render = () => {
    const items = [
      ['scan', 'Scan your bare face', 'Guided capture from several angles builds a 3D model of your face.', !!state.scan],
      ['kit', 'Photograph your makeup', 'We detect lipsticks, palettes, blush, foundation… and their shades.', state.kit.length > 0, `${state.kit.length} products`],
      ['styles', 'Choose a style', 'Presets, or upload a photo of a finished look to copy.', true, currentStyle().name],
      ['guide', 'Follow the guide', 'Scrub the slider to see each step rendered on your face in real time.', false],
      ['check', 'Check & score', 'Photograph your result and get a similarity score with tips.', state.history.length > 0, state.history.length ? `best ${Math.max(...state.history.map((x) => x.overall))}` : ''],
    ];
    steps.replaceChildren(...items.map(([id, title, text, done, meta]) => h('li', { class: done ? 'done' : '' },
      h('button', { onclick: () => go(id) }, h('b', {}, title), h('span', { class: 'muted small' }, text), meta ? h('span', { class: 'pill' }, meta) : ''))));
  };
  const el = h('section', { class: 'view home' },
    h('div', { class: 'hero' }, h('h1', {}, 'My Own Makeup'), h('p', {}, 'Your personal makeup coach — using your camera, your face and your own products.')),
    steps,
    h('p', { class: 'muted small' }, '🔒 Photos and scans are processed on your device and stored only in this browser.'),
  );
  return { el, show: render, hide() {} };
}

const views = {
  home: homeView(), scan: scanView(), kit: kitView(), styles: stylesView(), guide: guideView(), check: checkView(),
};
const NAV = [['scan', '◎', 'Scan'], ['kit', '▦', 'Kit'], ['styles', '✦', 'Styles'], ['guide', '❯❯', 'Guide'], ['check', '★', 'Check']];

let current = null;
function go(id) {
  if (!views[id]) id = 'home';
  if (current === id) return;
  if (current) { views[current].hide(); views[current].el.classList.remove('active'); }
  current = id;
  views[id].el.classList.add('active');
  views[id].show();
  nav.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
  if (location.hash.slice(1) !== id) history.replaceState(null, '', '#' + id);
  window.scrollTo(0, 0);
}

const header = h('header', { class: 'topbar' }, h('button', { class: 'brand', onclick: () => go('home') }, '💄 My Own Makeup'), h('span', { class: 'style-badge' }));
const nav = h('nav', { class: 'tabbar' }, NAV.map(([id, icon, label]) => h('button', { 'data-id': id, onclick: () => go(id) }, h('span', { class: 'ico' }, icon), label)));
const main = h('main', {}, Object.values(views).map((v) => v.el));
app.replaceChildren(header, main, nav);

const badge = () => (header.querySelector('.style-badge').textContent = currentStyle().name);
onChange(() => { badge(); if (current === 'home') views.home.show(); });
window.addEventListener('hashchange', () => go(location.hash.slice(1)));

await load();
badge();
go(location.hash.slice(1) || 'home');
// warm up the face tracker in the background
videoLandmarker().catch((e) => console.warn('face tracker preload failed', e));
