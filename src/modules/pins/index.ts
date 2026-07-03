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

// ---- drag-to-rearrange state (always on: grab a pin and drag) ----
let currentLoaded: Loaded[] = []; // live order shown in the wall
let editableBoardId: string | null = null; // board whose pins the order writes back to
let suppressClick = false; // a drag moved a pin → swallow the trailing click
let draggingIdx = -1;
let ghost: HTMLElement | null = null;
let dragOffX = 0;
let dragOffY = 0;
let dragMoved = false;
let rebuildRaf = 0;

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

const TARGET_COL = 250; // preferred column width; column count derives from viewport

function tile(l: Loaded, idx: number): HTMLElement {
  const img = h('img', { class: 'pin-img', alt: '' }) as HTMLImageElement;
  img.src = l.pin.imageUrl; // cached from preload → instant
  const el = h(
    'a',
    { class: 'pin-item', href: l.pin.linkUrl || l.pin.imageUrl, target: '_blank', rel: 'noopener noreferrer' },
    img,
  ) as HTMLAnchorElement;
  el.dataset.index = String(idx);
  el.draggable = false; // no native anchor/image drag ghost (we roll our own)
  img.draggable = false;
  if (idx === draggingIdx) el.classList.add('pin-dragging');
  el.addEventListener('pointerdown', (e) => startDrag(e as PointerEvent, idx));
  // A drag that actually moved a pin suppresses the trailing click so it
  // rearranges instead of opening its link; a click without a move navigates.
  el.addEventListener('click', (e) => {
    if (suppressClick) {
      e.preventDefault();
      suppressClick = false;
    }
  });
  return el;
}

// Pinterest-style column masonry: fixed-width columns, each pin at its natural
// aspect, dropped into the shortest column so the wall staggers freely with no
// visible row grid. Columns fill the viewport; the tallest ones spill off the
// bottom (clipped) — pin/board rotation cycles what's visible.
function buildWallDom(loaded: Loaded[]): HTMLElement {
  const wall = h('div', { class: 'pins-wall' });

  const avail = window.innerWidth - GAP * 2;
  const cols = Math.max(1, Math.round(avail / TARGET_COL));
  const colW = (avail - GAP * (cols - 1)) / cols;
  const colH = new Array(cols).fill(0); // running height of each column

  loaded.forEach((l, idx) => {
    let c = 0; // shortest column
    for (let i = 1; i < cols; i++) if (colH[i] < colH[c]) c = i;
    const tileH = colW / l.aspect;
    const el = tile(l, idx);
    el.style.position = 'absolute';
    el.style.left = `${GAP + c * (colW + GAP)}px`;
    el.style.top = `${GAP + colH[c]}px`;
    el.style.width = `${colW}px`;
    el.style.height = `${tileH}px`;
    wall.appendChild(el);
    colH[c] += tileH + GAP;
  });

  return wall;
}

// Re-justify the wall in place from the current live order (no reload/preload).
function rebuildWall(): void {
  const old = host.querySelector('.pins-wall');
  if (old) old.replaceWith(buildWallDom(currentLoaded));
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

  currentLoaded = loaded;
  // Rearranging writes a flat order back to one board. Board mode → active board;
  // all-pins mode persists only when it collapses to a single board (else the
  // drag still re-justifies the wall live, but there's no single board to save to).
  editableBoardId =
    p.mode === 'board' ? (activeBoard ? activeBoard.id : null) : p.boards.length === 1 ? p.boards[0].id : null;

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

// ---- drag pins to rearrange, wall re-justifies live ----
function moveItem<T>(arr: T[], from: number, to: number): void {
  const [x] = arr.splice(from, 1);
  arr.splice(to, 0, x);
}

// Index of the tile under (x,y), else the nearest tile's index (so dragging
// into a gap or past the edge still targets the closest slot); -1 if no tiles.
function tileIndexAt(x: number, y: number): number {
  const tiles = host.querySelectorAll<HTMLElement>('.pin-item');
  let nearest = -1;
  let best = Infinity;
  for (const t of tiles) {
    const r = t.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return Number(t.dataset.index);
    const dx = x - (r.left + r.width / 2);
    const dy = y - (r.top + r.height / 2);
    const d = dx * dx + dy * dy;
    if (d < best) {
      best = d;
      nearest = Number(t.dataset.index);
    }
  }
  return nearest;
}

function positionGhost(x: number, y: number): void {
  if (!ghost) return;
  ghost.style.left = `${x - dragOffX}px`;
  ghost.style.top = `${y - dragOffY}px`;
}

// Grab immediately on press (same feel as the old edit mode). The ghost/dim
// appear at once; if the pointer never moves a pin, endDrag leaves the order
// untouched and the trailing click opens the pin's link.
function startDrag(e: PointerEvent, idx: number): void {
  if (e.button !== 0) return;
  e.preventDefault();
  draggingIdx = idx;
  dragMoved = false;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dragOffX = e.clientX - rect.left;
  dragOffY = e.clientY - rect.top;

  const gi = h('img', { alt: '' }) as HTMLImageElement;
  gi.draggable = false;
  gi.src = currentLoaded[idx].pin.imageUrl;
  ghost = h('div', { class: 'pin-ghost' }, gi);
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  positionGhost(e.clientX, e.clientY);
  document.body.appendChild(ghost);

  rebuildWall(); // mark the source tile as dragging (dimmed placeholder)
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', endDrag, { once: true });
}

function onDragMove(e: PointerEvent): void {
  if (draggingIdx < 0) return;
  positionGhost(e.clientX, e.clientY);
  if (rebuildRaf) return; // coalesce hit-testing to one per frame
  rebuildRaf = requestAnimationFrame(() => {
    rebuildRaf = 0;
    // The floating content layer sits above the wall, so hit-test the tile rects
    // directly rather than via elementFromPoint.
    const ti = tileIndexAt(e.clientX, e.clientY);
    if (ti < 0 || ti === draggingIdx) return;
    moveItem(currentLoaded, draggingIdx, ti);
    draggingIdx = ti;
    dragMoved = true;
    rebuildWall(); // re-justify with the new order
  });
}

function endDrag(): void {
  window.removeEventListener('pointermove', onDragMove);
  if (rebuildRaf) {
    cancelAnimationFrame(rebuildRaf);
    rebuildRaf = 0;
  }
  if (ghost) {
    ghost.remove();
    ghost = null;
  }
  const moved = dragMoved;
  draggingIdx = -1;
  dragMoved = false;
  rebuildWall(); // clear dragging class
  if (moved) {
    suppressClick = true; // a real rearrange → swallow the trailing click
    persistOrder();
    // Clear next tick so a drag that emits no click never poisons a later one.
    setTimeout(() => {
      suppressClick = false;
    }, 0);
  }
}

// Write the live order back to the editable board, preserving any pins that
// weren't laid out (failed to load, or beyond MAX_TILES) at the tail.
function persistOrder(): void {
  const p = ctx.settings.pins;
  const board = p.boards.find((b) => b.id === editableBoardId);
  if (!board) return;
  const ordered = currentLoaded.map((l) => l.pin);
  const shown = new Set(ordered);
  const rest = board.pins.filter((pin) => !shown.has(pin));
  const newPins = [...ordered, ...rest];
  const newBoards = p.boards.map((b) => (b.id === board.id ? { ...b, pins: newPins } : b));
  ctx.saveSettings({ pins: { boards: newBoards } });
}

// ---- settings schema ----
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
      { key: 'pins', label: 'Pins', type: 'pins' },
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
