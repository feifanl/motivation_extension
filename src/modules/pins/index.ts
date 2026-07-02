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

// ---- editor (drag-to-rearrange) state ----
let editMode = false;
let currentLoaded: Loaded[] = []; // live order shown in the wall
let editableBoardId: string | null = null; // board whose pins the order writes back to
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

function tile(l: Loaded, idx: number): HTMLElement {
  const img = h('img', { class: 'pin-img', alt: '' }) as HTMLImageElement;
  img.src = l.pin.imageUrl; // cached from preload → instant
  const el = h(
    'a',
    { class: 'pin-item', href: l.pin.linkUrl || l.pin.imageUrl, target: '_blank', rel: 'noopener noreferrer' },
    img,
  ) as HTMLAnchorElement;
  el.dataset.index = String(idx);
  el.style.flex = `${l.aspect} 1 0`; // width proportional to aspect; row flexes to fill W
  if (editMode) {
    el.classList.add('pin-editable');
    if (idx === draggingIdx) el.classList.add('pin-dragging');
    el.addEventListener('pointerdown', (e) => startDrag(e as PointerEvent, idx));
    el.addEventListener('click', (e) => e.preventDefault()); // no navigation while editing
  }
  return el;
}

function buildWallDom(loaded: Loaded[]): HTMLElement {
  const wall = h('div', { class: 'pins-wall' });
  if (editMode) wall.classList.add('editing');
  const W = window.innerWidth - GAP * 2;
  const Hh = window.innerHeight - GAP * 2;
  const rows = layout(loaded, W, Hh);
  let idx = 0; // running index across rows == index into `loaded` (layout preserves order)
  for (const r of rows) {
    const rowEl = h('div', { class: 'pins-row' });
    rowEl.style.height = `${r.h}px`;
    for (const it of r.items) rowEl.appendChild(tile(it, idx++));
    wall.appendChild(rowEl);
  }
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
  // Editing writes a flat order back to one board. Board mode → active board;
  // all-pins mode is editable only when it collapses to a single board.
  editableBoardId =
    p.mode === 'board' ? (activeBoard ? activeBoard.id : null) : p.boards.length === 1 ? p.boards[0].id : null;
  if (!editableBoardId) editMode = false;

  const children: HTMLElement[] = [buildWallDom(loaded)];
  if (editableBoardId) children.push(editButton());
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

// ---- editor: drag pins to rearrange, wall re-justifies live ----
function editButton(): HTMLElement {
  return h(
    'button',
    {
      class: 'pins-edit-btn' + (editMode ? ' active' : ''),
      title: editMode ? 'Done rearranging' : 'Rearrange pins',
      onClick: toggleEdit,
    },
    editMode ? 'Done' : '✎',
  );
}

function toggleEdit(): void {
  editMode = !editMode && !!editableBoardId;
  rebuildWall();
  const btn = host.querySelector('.pins-edit-btn');
  if (btn) btn.replaceWith(editButton());
}

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

function startDrag(e: PointerEvent, idx: number): void {
  if (!editMode || e.button !== 0) return;
  e.preventDefault();
  draggingIdx = idx;
  dragMoved = false;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dragOffX = e.clientX - rect.left;
  dragOffY = e.clientY - rect.top;

  const gi = h('img', { alt: '' }) as HTMLImageElement;
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
  if (moved) persistOrder();
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
