import './lifeclock.css';
import type { DashboardModule, ModuleContext, SettingsField } from '../../core/types';
import { h, clamp } from '../../core/dom';
import { VIEW_ORDER } from './math';
import { renderView } from './views';

let ctx: ModuleContext;
let stage: HTMLElement;
let track: HTMLElement;
let zoombar: HTMLElement;
let paneEls: HTMLElement[] = [];
let viewEls: HTMLElement[] = [];
let activeIndex = 0;
let tick: ReturnType<typeof setInterval> | undefined;
let moveT: ReturnType<typeof setTimeout> | undefined;
let onKey: ((e: KeyboardEvent) => void) | undefined;
let onResize: (() => void) | undefined;
let unsub: (() => void) | undefined;
let wheelLock = 0;

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

function renderPanes(): void {
  const now = new Date();
  VIEW_ORDER.forEach((v, i) => renderView(v, viewEls[i], ctx.settings, now));
  placeZoombar();
}

// Slide the track so the active pane sits at the stage's vertical center,
// and dock the ±controls inside the active pane's box.
function applyTransform(): void {
  const pane = paneEls[activeIndex];
  // Size the stage to the active pane so no view is ever clipped; neighbors
  // still slide in/out of these bounds (overflow:hidden hides them at rest).
  // Align the active pane's top to the stage top (stage == pane height, so this
  // fills it exactly). Use the pane's own height, not stage.clientHeight, which
  // reports the mid-animation value while the stage height transitions.
  stage.style.height = `${pane.offsetHeight}px`;
  track.style.transform = `translateY(${-pane.offsetTop}px)`;
  paneEls.forEach((p, i) => p.classList.toggle('active', i === activeIndex));
  placeZoombar();
}

function placeZoombar(): void {
  const inner = paneEls[activeIndex]?.firstElementChild;
  if (inner && zoombar.parentElement !== inner) inner.appendChild(zoombar);
}

function goTo(i: number): void {
  const n = clamp(i, 0, VIEW_ORDER.length - 1);
  if (n === activeIndex) return;
  activeIndex = n;
  stage.classList.add('moving'); // neighbors peek only while sliding
  applyTransform();
  clearTimeout(moveT);
  moveT = setTimeout(() => stage.classList.remove('moving'), 220);
}

// dir > 0 = zoom out (toward life); dir < 0 = zoom in (toward day).
function step(dir: number): void {
  goTo(activeIndex + dir);
}

const schema: SettingsField[] = [
  { key: 'lifeclock.birthday', label: 'Birthday', type: 'date' },
  { key: 'lifeclock.lifeExpectancyYears', label: 'Life expectancy (years)', type: 'number', min: 1, max: 120 },
  {
    key: 'lifeclock.defaultView',
    label: 'Default view',
    type: 'select',
    options: VIEW_ORDER.map((v) => ({ value: v, label: cap(v) })),
  },
];

export const lifeclock: DashboardModule = {
  id: 'lifeclock',
  slot: 'main',
  order: 10,
  settingsSchema: schema,

  init(c) {
    ctx = c;
    activeIndex = Math.max(0, VIEW_ORDER.indexOf(c.settings.lifeclock.defaultView));

    onKey = (e) => {
      if (isTyping(e.target)) return;
      if (e.key === 'ArrowUp' || e.key === '+' || e.key === '=') {
        step(-1);
        e.preventDefault();
      } else if (e.key === 'ArrowDown' || e.key === '-' || e.key === '_') {
        step(1);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);

    unsub = c.bus.on('settings-changed', () => {
      if (viewEls.length) {
        renderPanes();
        applyTransform(); // pane heights may change (e.g. birthday set)
      }
    });

    tick = setInterval(() => {
      if (viewEls.length) renderPanes();
    }, 30_000);
  },

  render(el) {
    paneEls = [];
    viewEls = [];
    track = h('div', { class: 'lc-track' });

    VIEW_ORDER.forEach(() => {
      const view = h('div', { class: 'lc-view' });
      const inner = h('div', { class: 'lc-pane-inner' }, view);
      const pane = h('div', { class: 'lc-pane' }, inner);
      viewEls.push(view);
      paneEls.push(pane);
      track.appendChild(pane);
    });

    const zoomOut = h('button', { class: 'lc-zoom', title: 'Zoom out', onClick: () => step(1) }, '−');
    const zoomIn = h('button', { class: 'lc-zoom', title: 'Zoom in', onClick: () => step(-1) }, '+');
    zoombar = h('div', { class: 'lc-zoombar' }, zoomOut, zoomIn);

    stage = h('div', { class: 'lc-stage' }, track);
    el.appendChild(h('div', { class: 'lc-root' }, stage));

    // discrete "picker" wheel: one view per gesture
    stage.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const t = Date.now();
        if (t - wheelLock < 400) return;
        wheelLock = t;
        step(e.deltaY < 0 ? -1 : 1);
      },
      { passive: false },
    );

    onResize = () => applyTransform();
    window.addEventListener('resize', onResize);

    renderPanes();
    // Position on the default view without the slide animation, then enable it.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        applyTransform();
        if (!reduced) track.classList.add('animated');
      }),
    );
  },

  destroy() {
    if (tick) clearInterval(tick);
    if (moveT) clearTimeout(moveT);
    if (onKey) window.removeEventListener('keydown', onKey);
    if (onResize) window.removeEventListener('resize', onResize);
    if (unsub) unsub();
  },
};
