import './lifeclock.css';
import type { DashboardModule, LifeView, ModuleContext, SettingsField } from '../../core/types';
import { h, clamp } from '../../core/dom';
import { VIEW_ORDER } from './math';
import { renderView } from './views';

let ctx: ModuleContext;
let currentView: LifeView;
let viewEl: HTMLElement;
let crumbsEl: HTMLElement;
let tick: ReturnType<typeof setInterval> | undefined;
let onKey: ((e: KeyboardEvent) => void) | undefined;
let unsub: (() => void) | undefined;
let wheelLast = 0;

const CROSSFADE_MS = 180;

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

function renderCurrent(fade: boolean): void {
  const doRender = () => renderView(currentView, viewEl, ctx.settings, new Date());
  if (fade) {
    viewEl.classList.add('leaving');
    setTimeout(() => {
      doRender();
      viewEl.classList.remove('leaving');
      buildCrumbs();
    }, CROSSFADE_MS);
  } else {
    doRender();
    buildCrumbs();
  }
}

function buildCrumbs(): void {
  crumbsEl.replaceChildren();
  VIEW_ORDER.forEach((v, i) => {
    if (i) crumbsEl.appendChild(h('span', { class: 'lc-sep' }, '·'));
    crumbsEl.appendChild(
      h('span', { class: `lc-crumb${v === currentView ? ' active' : ''}`, onClick: () => setView(v) }, v),
    );
  });
}

function setView(v: LifeView): void {
  if (v === currentView) {
    renderCurrent(false);
    return;
  }
  currentView = v;
  renderCurrent(true);
}

// dir > 0 = zoom out (toward life); dir < 0 = zoom in (toward day).
function zoom(dir: number): void {
  const i = VIEW_ORDER.indexOf(currentView);
  const n = clamp(i + dir, 0, VIEW_ORDER.length - 1);
  if (n !== i) setView(VIEW_ORDER[n]);
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
    currentView = c.settings.lifeclock.defaultView;

    onKey = (e) => {
      if (isTyping(e.target)) return;
      if (e.key === 'ArrowUp' || e.key === '+' || e.key === '=') {
        zoom(-1);
        e.preventDefault();
      } else if (e.key === 'ArrowDown' || e.key === '-' || e.key === '_') {
        zoom(1);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);

    unsub = c.bus.on('settings-changed', () => {
      if (viewEl) renderCurrent(false);
    });

    tick = setInterval(() => {
      if (viewEl) renderCurrent(false);
    }, 30_000);
  },

  render(el) {
    viewEl = h('div', { class: 'lc-view' });
    crumbsEl = h('div', { class: 'lc-crumbs' });
    const zoomOut = h('button', { class: 'lc-zoom', title: 'Zoom out', onClick: () => zoom(1) }, '−');
    const zoomIn = h('button', { class: 'lc-zoom', title: 'Zoom in', onClick: () => zoom(-1) }, '+');

    const header = h(
      'div',
      { class: 'lc-header' },
      crumbsEl,
      h('div', { class: 'lc-zoombar' }, zoomOut, zoomIn),
    );

    const card = h('div', { class: 'card lifeclock' }, header, viewEl);
    card.addEventListener(
      'wheel',
      (e) => {
        const t = Date.now();
        if (t - wheelLast < 250) {
          e.preventDefault();
          return;
        }
        wheelLast = t;
        zoom(e.deltaY < 0 ? -1 : 1);
        e.preventDefault();
      },
      { passive: false },
    );

    el.appendChild(card);
    renderCurrent(false);
  },

  destroy() {
    if (tick) clearInterval(tick);
    if (onKey) window.removeEventListener('keydown', onKey);
    if (unsub) unsub();
  },
};
