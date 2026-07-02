import './pins.css';
import type {
  DashboardModule,
  ModuleContext,
  Pin,
  PinBoard,
  PinRotation,
  SettingsField,
} from '../../core/types';
import { h } from '../../core/dom';

const DAY = 86_400_000;
const MAX_TILES = 60; // cap distinct images laid out (no repetition beyond this)
const GAP = 8; // px between tiles; matches CSS

let ctx: ModuleContext;
let host: HTMLElement;
let boardTimer: ReturnType<typeof setInterval> | undefined;
let onKey: ((e: KeyboardEvent) => void) | undefined;
let onResize: (() => void) | undefined;
let resizeRaf = 0;
let unsub: (() => void) | undefined;
let manualBoard = false;
let renderToken = 0; // guards against stale async renders

function localDayNumber(): number {
  const offset = new Date().getTimezoneOffset() * 60_000;
  return Math.floor((Date.now() - offset) / DAY);
}

function autoIndex(rotation: PinRotation, interval: number | undefined, len: number, cursor: number): number {
  if (len <= 0) return 0;
  if (rotation === 'daily') return localDayNumber() % len;
  if (rotation === 'interval') {
    const m = interval && interval > 0 ? interval : 60;
    return Math.floor(Date.now() / (m * 60_000)) % len;
  }
  return ((cursor % len) + len) % len;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

function clearTimers(): void {
  if (boardTimer) clearInterval(boardTimer);
  boardTimer = undefined;
}

interface Loaded {
  pin: Pin;
  aspect: number; // w / h
}

// Preload so we know each image's aspect ratio; skip images that fail.
function preload(pool: Pin[]): Promise<Loaded[]> {
  return Promise.all(
    pool.map(
      (pin) =>
        new Promise<Loaded | null>((res) => {
          const img = new Image();
          img.onload = () => res({ pin, aspect: img.naturalWidth / img.naturalHeight || 1 });
          img.onerror = () => res(null);
          img.src = pin.imageUrl;
        }),
    ),
  ).then((a) => a.filter((x): x is Loaded => x !== null));
}

interface Row {
  items: Loaded[];
  h: number;
}

// Fit all images into W×H, filling both. Pick a row count R so rows come out
// roughly square, partition images into R balanced rows (by aspect sum), size
// each row to width W, then scale heights so they fill H exactly. Fewer images
// → fewer rows → bigger tiles; object-fit:cover absorbs the aspect mismatch.
function layout(imgs: Loaded[], W: number, H: number): Row[] {
  const totalAspect = imgs.reduce((s, im) => s + im.aspect, 0) || 1;
  let R = Math.round(Math.sqrt((H * totalAspect) / W));
  R = Math.max(1, Math.min(R, imgs.length));

  // Bucket by cumulative aspect so each row gets a near-equal aspect sum → even
  // heights (no runt last row).
  const target = totalAspect / R;
  const buckets: Loaded[][] = Array.from({ length: R }, () => []);
  let cum = 0;
  for (const im of imgs) {
    const ri = Math.min(R - 1, Math.floor(cum / target));
    buckets[ri].push(im);
    cum += im.aspect;
  }
  const groups = buckets.filter((g) => g.length > 0);

  const rows: Row[] = groups.map((items) => {
    const s = items.reduce((a, x) => a + x.aspect, 0) || 1;
    return { items, h: (W - GAP * (items.length - 1)) / s };
  });

  const gaps = GAP * Math.max(0, rows.length - 1);
  const sumH = rows.reduce((s, r) => s + r.h, 0) || 1;
  const factor = (H - gaps) / sumH;
  for (const r of rows) r.h *= factor;
  return rows;
}

function tile(l: Loaded): HTMLElement {
  const img = h('img', { class: 'pin-img', alt: '' }) as HTMLImageElement;
  img.src = l.pin.imageUrl; // cached from preload → instant
  const el = h(
    'a',
    { class: 'pin-item', href: l.pin.linkUrl || l.pin.imageUrl, target: '_blank', rel: 'noopener noreferrer' },
    img,
  );
  el.style.flex = `${l.aspect} 1 0`; // width proportional to aspect; row flexes to fill W
  return el;
}

function buildWallDom(loaded: Loaded[]): HTMLElement {
  const wall = h('div', { class: 'pins-wall' });
  const W = window.innerWidth - GAP * 2;
  const Hh = window.innerHeight - GAP * 2;
  const rows = layout(loaded, W, Hh);
  for (const r of rows) {
    const rowEl = h('div', { class: 'pins-row' });
    rowEl.style.height = `${r.h}px`;
    for (const it of r.items) rowEl.appendChild(tile(it));
    wall.appendChild(rowEl);
  }
  return wall;
}

async function render(): Promise<void> {
  clearTimers();
  const p = ctx.settings.pins;
  const totalPins = p.boards.reduce((n, b) => n + b.pins.length, 0);
  if (!p.enabled || totalPins === 0) {
    host.replaceChildren();
    return;
  }

  let pool: Pin[];
  let activeBoard: PinBoard | null = null;
  if (p.mode === 'all') {
    pool = p.boards.flatMap((b) => b.pins);
  } else {
    if (!manualBoard && p.boardRotation !== 'off' && p.boards.length > 1) {
      const curIdx = Math.max(0, p.boards.findIndex((b) => b.id === p.activeBoardId));
      const idx = autoIndex(p.boardRotation, p.boardIntervalMinutes, p.boards.length, curIdx);
      const target = p.boards[idx];
      if (target && target.id !== p.activeBoardId) {
        ctx.saveSettings({ pins: { activeBoardId: target.id } }); // re-renders via settings-changed
        return;
      }
    }
    activeBoard = p.boards.find((b) => b.id === p.activeBoardId) ?? p.boards[0];
    pool = activeBoard.pins;
  }
  if (pool.length === 0) {
    host.replaceChildren();
    return;
  }

  const token = ++renderToken;
  const loaded = await preload(pool.slice(0, MAX_TILES));
  if (token !== renderToken) return; // superseded
  if (!loaded.length) {
    host.replaceChildren();
    return;
  }

  const children: HTMLElement[] = [buildWallDom(loaded)];
  if (p.mode === 'board' && p.boards.length > 1 && activeBoard) {
    children.push(
      h(
        'div',
        { class: 'pins-pill' },
        h('button', { class: 'pins-navbtn', title: 'Previous board ([)', onClick: () => switchBoard(-1) }, '‹'),
        h('span', { class: 'pins-board-name' }, activeBoard.name || 'Board'),
        h('button', { class: 'pins-navbtn', title: 'Next board (])', onClick: () => switchBoard(1) }, '›'),
      ),
    );
  }
  host.replaceChildren(...children);

  if (p.mode === 'board' && p.boardRotation === 'interval' && p.boards.length > 1) {
    const m = p.boardIntervalMinutes && p.boardIntervalMinutes > 0 ? p.boardIntervalMinutes : 60;
    boardTimer = setInterval(() => {
      manualBoard = false;
      render();
    }, m * 60_000);
  }
}

function switchBoard(dir: number): void {
  const p = ctx.settings.pins;
  if (p.mode !== 'board' || p.boards.length < 2) return;
  const curIdx = Math.max(0, p.boards.findIndex((b) => b.id === p.activeBoardId));
  const next = ((curIdx + dir) % p.boards.length + p.boards.length) % p.boards.length;
  manualBoard = true;
  ctx.saveSettings({ pins: { activeBoardId: p.boards[next].id } });
}

// ---- settings schema ----
function parsePins(raw: string): Pin[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((imageUrl) => ({ imageUrl }));
}
function formatPins(val: unknown): string {
  return ((val as Pin[]) ?? []).map((p) => p.imageUrl).join('\n');
}

const ROTATION_OPTS = [
  { value: 'off', label: 'Off' },
  { value: 'daily', label: 'Daily' },
  { value: 'interval', label: 'Every N minutes' },
];

const schema: SettingsField[] = [
  { key: 'pins.enabled', label: 'Show pins wall', type: 'toggle' },
  {
    key: 'pins.mode',
    label: 'Fill with',
    type: 'select',
    options: [
      { value: 'board', label: 'One board' },
      { value: 'all', label: 'All boards pooled' },
    ],
  },
  {
    key: 'pins.boards',
    label: 'Boards',
    type: 'list',
    newItem: () => ({ id: crypto.randomUUID(), name: '', pins: [], rotation: 'off', index: 0 }),
    itemFields: [
      { key: 'name', label: 'Name', type: 'text', placeholder: 'hopecore' },
      { key: 'pins', label: 'Image URLs (one per line)', type: 'textarea', parse: parsePins, format: formatPins },
    ],
  },
  {
    key: 'pins.boardRotation',
    label: 'Auto-switch board',
    type: 'select',
    options: ROTATION_OPTS,
    showIf: (s) => s.pins.mode === 'board',
  },
  {
    key: 'pins.boardIntervalMinutes',
    label: 'Board interval (min)',
    type: 'number',
    min: 1,
    showIf: (s) => s.pins.mode === 'board' && s.pins.boardRotation === 'interval',
  },
];

export const pins: DashboardModule = {
  id: 'pins',
  slot: 'background',
  order: 1, // above wallpaper (0), below the floating content
  settingsSchema: schema,

  init(c) {
    ctx = c;
    onKey = (e) => {
      if (isTyping(e.target)) return;
      if (ctx.settings.pins.mode !== 'board') return;
      if (e.key === '[') switchBoard(-1);
      else if (e.key === ']') switchBoard(1);
    };
    window.addEventListener('keydown', onKey);
    onResize = () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        if (host) render();
      });
    };
    window.addEventListener('resize', onResize);
    unsub = c.bus.on('settings-changed', () => {
      if (host) render();
    });
  },

  render(el) {
    host = el;
    render();
  },

  destroy() {
    clearTimers();
    if (onKey) window.removeEventListener('keydown', onKey);
    if (onResize) window.removeEventListener('resize', onResize);
    if (unsub) unsub();
  },
};
