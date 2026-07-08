import './lifeclock.css';
import type { DashboardModule, ModuleContext, SettingsField } from '../../core/types';
import { h, clamp, animateOut } from '../../core/dom';
import { VIEW_ORDER } from './math';
import { renderView } from './views';

let ctx: ModuleContext;
let moduleHost: HTMLElement;
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
let lastWheelStep = 0; // time of the last wheel-driven view change (cooldown gate)
let lastMin = false;

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

// Small inline-SVG icon builder (crisp, no emoji).
function svgIcon(cls: string, inner: string): HTMLElement {
  const span = document.createElement('span');
  span.className = cls;
  span.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  return span;
}
// Minimize: a bar sitting low (window-minimize convention).
function minimizeIcon(): HTMLElement {
  return svgIcon('lc-icon', '<line x1="6" y1="17" x2="18" y2="17"/>');
}
// Magnifying glass with + / − inside for zoom in / out.
function zoomIcon(dir: 'in' | 'out'): HTMLElement {
  const plus = dir === 'in' ? '<line x1="10" y1="7.5" x2="10" y2="12.5"/>' : '';
  return svgIcon(
    'lc-icon',
    `<circle cx="10" cy="10" r="6.5"/><line x1="15" y1="15" x2="20.5" y2="20.5"/><line x1="7.5" y1="10" x2="12.5" y2="10"/>${plus}`,
  );
}

// Thin, elegant clock glyph (SVG, not an emoji).
function clockIcon(cls: string): HTMLElement {
  const span = document.createElement('span');
  span.className = cls;
  span.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/></svg>';
  return span;
}

// Minimized → a compact clock-icon button; else the full carousel.
function drawClock(): void {
  moduleHost.replaceChildren();
  if (ctx.settings.ui.clockMinimized) {
    moduleHost.appendChild(
      h(
        'button',
        {
          class: 'lc-pill ui-enter',
          title: 'Expand life clock',
          'aria-label': 'Expand life clock',
          onClick: () => ctx.saveSettings({ ui: { clockMinimized: false } }),
        },
        clockIcon('lc-pill-icon'),
      ),
    );
    return;
  }
  buildStage();
}

function buildStage(): void {
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

  const zoomOut = h('button', { class: 'lc-zoom', title: 'Zoom out', 'aria-label': 'Zoom out', onClick: () => step(1) }, zoomIcon('out'));
  const zoomIn = h('button', { class: 'lc-zoom', title: 'Zoom in', 'aria-label': 'Zoom in', onClick: () => step(-1) }, zoomIcon('in'));
  const minBtn = h(
    'button',
    { class: 'lc-zoom lc-min', title: 'Minimize', 'aria-label': 'Minimize', onClick: () => ctx.saveSettings({ ui: { clockMinimized: true } }) },
    minimizeIcon(),
  );
  zoombar = h('div', { class: 'lc-zoombar' }, minBtn, zoomOut, zoomIn);

  stage = h('div', { class: 'lc-stage' }, track);
  moduleHost.appendChild(h('div', { class: 'lc-root ui-enter' }, stage));

  // One view change per gesture, gated by a cooldown. Trackpads fire a dense
  // stream of small deltas (and momentum inertia after the finger lifts), so
  // magnitude-based accumulation over-shoots; a time gate steps at most once per
  // COOLDOWN regardless of how hard the swipe or how long the momentum tail.
  const COOLDOWN = 350; // ms between wheel-driven view changes
  const MIN_DELTA = 8; // ignore sub-notch jitter
  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (Math.abs(e.deltaY) < MIN_DELTA) return;
      const t = Date.now();
      if (t - lastWheelStep < COOLDOWN) return;
      lastWheelStep = t;
      step(e.deltaY < 0 ? -1 : 1);
    },
    { passive: false },
  );

  renderPanes();
  // Position on the default view without the slide animation, then enable it.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      applyTransform();
      if (!reduced) track.classList.add('animated');
    }),
  );
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

    lastMin = c.settings.ui.clockMinimized;
    unsub = c.bus.on('settings-changed', () => {
      if (c.settings.ui.clockMinimized !== lastMin) {
        lastMin = c.settings.ui.clockMinimized;
        const cur = moduleHost.querySelector<HTMLElement>('.lc-root, .lc-pill');
        if (cur) animateOut(cur, drawClock); // fade current out, then swap
        else drawClock();
        return;
      }
      if (!ctx.settings.ui.clockMinimized && viewEls.length) {
        renderPanes();
        applyTransform(); // pane heights may change (e.g. birthday set)
      }
    });

    tick = setInterval(() => {
      if (!ctx.settings.ui.clockMinimized && viewEls.length) renderPanes();
    }, 30_000);
  },

  render(el) {
    moduleHost = el;
    if (!onResize) {
      onResize = () => {
        if (!ctx.settings.ui.clockMinimized) applyTransform();
      };
      window.addEventListener('resize', onResize);
    }
    drawClock();
  },

  destroy() {
    if (tick) clearInterval(tick);
    if (moveT) clearTimeout(moveT);
    if (onKey) window.removeEventListener('keydown', onKey);
    if (onResize) window.removeEventListener('resize', onResize);
    if (unsub) unsub();
  },
};
