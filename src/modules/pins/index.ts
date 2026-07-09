import './pins.css';
import type {
  DashboardModule,
  ModuleContext,
  Pin,
  PinBoard,
  PinRotation,
  PinScreenRotation,
  SettingsField,
} from '../../core/types';
import { h } from '../../core/dom';

const DAY = 86_400_000;
const MAX_TILES = 60; // cap distinct images laid out (no repetition beyond this)
const GAP = 8; // px between tiles; matches CSS

let ctx: ModuleContext;
let host: HTMLElement;
let boardTimer: ReturnType<typeof setInterval> | undefined;
let screenTimer: ReturnType<typeof setInterval> | undefined;
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

// ---- panorama scroll state ----
let scrollCols: Loaded[][] = []; // pool packed into vertical columns
let panoramaMode = false; // wall is currently the sliding strip
let panoramaAnim: Animation | undefined; // the drift animation (paused while dragging)

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
  if (screenTimer) clearInterval(screenTimer);
  screenTimer = undefined;
}

// How many tiles fit before the masonry runs past the viewport bottom — the
// "page" size the screen rotation advances by. Uses the same packing math as
// buildWallDom, no DOM measuring.
function pageCapacity(loaded: Loaded[]): number {
  const viewH = window.innerHeight;
  const avail = window.innerWidth - GAP * 2;
  const cols = Math.max(1, Math.round(avail / TARGET_COL));
  const colW = (avail - GAP * (cols - 1)) / cols;
  const colH = new Array(cols).fill(0);
  let count = 0;
  for (const l of loaded) {
    let c = 0;
    for (let i = 1; i < cols; i++) if (colH[i] < colH[c]) c = i;
    if (GAP + colH[c] < viewH) count++; // tile's top edge is on-screen
    colH[c] += colW / l.aspect + GAP;
  }
  return Math.max(1, count);
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

function tile(l: Loaded, idx: number, drag = true): HTMLElement {
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
  if (!drag) return el; // scroll/panorama tiles are plain links (no rearrange)
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

// ---- panorama: pack the pool into vertical columns, show a strip that slides
// one column left at a time ----

// Column width chosen so an integer number of columns fills the viewport exactly
// (no black gutter on the right), matching the masonry wall's sizing.
function colMetrics(): { cols: number; colW: number; step: number } {
  const avail = window.innerWidth - GAP * 2;
  const cols = Math.max(1, Math.round(avail / TARGET_COL));
  const colW = (avail - GAP * (cols - 1)) / cols;
  return { cols, colW, step: colW + GAP };
}

function buildColumns(loaded: Loaded[], colW: number): Loaded[][] {
  const viewH = window.innerHeight;
  const cols: Loaded[][] = [];
  let cur: Loaded[] = [];
  let curH = GAP;
  for (const l of loaded) {
    cur.push(l);
    curH += colW / l.aspect + GAP;
    // Fill each column past the bottom edge (the last tile clips) so there's no
    // black gap under a short column.
    if (curH >= viewH) {
      cols.push(cur);
      cur = [];
      curH = GAP;
    }
  }
  if (cur.length) cols.push(cur);
  return cols;
}

function columnDom(col: Loaded[], leftPx: number, colW: number, startIdx: number): HTMLElement {
  const el = h('div', { class: 'pins-col' });
  el.style.left = `${leftPx}px`;
  el.style.width = `${colW}px`;
  let top = GAP;
  col.forEach((l, j) => {
    // Flat index into currentLoaded so drag-to-reorder maps back to the pool.
    const t = tile(l, startIdx + j, true);
    const hgt = colW / l.aspect;
    Object.assign(t.style, { position: 'absolute', left: '0', top: `${top}px`, width: `${colW}px`, height: `${hgt}px` });
    el.appendChild(t);
    top += hgt + GAP;
  });
  return el;
}

// The strip holds every column once, plus a copy of the leading columns at the
// end so a constant leftward drift wraps seamlessly (translate by one full set
// width lands exactly on the copy).
function buildStrip(): HTMLElement {
  const strip = h('div', { class: 'pins-strip' });
  const { cols, colW, step } = colMetrics();
  const n = scrollCols.length;
  const starts: number[] = []; // flat pool index each column begins at
  let acc = 0;
  for (const col of scrollCols) {
    starts.push(acc);
    acc += col.length;
  }
  const total = n + Math.min(cols + 1, n); // duplicate the leading columns
  for (let k = 0; k < total; k++) {
    const idx = k % n;
    strip.appendChild(columnDom(scrollCols[idx], k * step, colW, starts[idx]));
  }
  return strip;
}

// Constant, very slow leftward drift; loops forever with no visible seam. The
// phase is tied to wall-clock time (currentTime = now mod loop), so reopening
// the tab resumes where the drift would be — it never resets to the start.
function startPanorama(strip: HTMLElement, secondsPerColumn: number): Animation {
  const { step } = colMetrics();
  const setWidth = scrollCols.length * step;
  const duration = scrollCols.length * secondsPerColumn * 1000;
  const anim = strip.animate(
    [{ transform: 'translateX(0)' }, { transform: `translateX(${-setWidth}px)` }],
    { duration, iterations: Infinity, easing: 'linear' },
  );
  anim.currentTime = Date.now() % duration;
  return anim;
}

// Re-justify the wall in place from the current live order (no reload/preload).
function rebuildWall(): void {
  const old = host.querySelector('.pins-wall');
  if (old) old.replaceWith(buildWallDom(currentLoaded));
}

// Re-pack the panorama columns from the current order, swapping children into
// the EXISTING strip so its (paused) drift animation and transform survive.
// Used during a drag so the layout previews the drop live and dims the source.
function rebuildStripLive(): void {
  const strip = host.querySelector('.pins-strip');
  if (!strip) return;
  const { colW } = colMetrics();
  scrollCols = buildColumns(currentLoaded, colW);
  strip.replaceChildren(...buildStrip().children);
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

  const sr = p.screenRotation ?? 'off';

  // Panorama scroll: pack into columns and slide one column at a time. Pins stay
  // draggable — the drift pauses while dragging (see startDrag/endDrag).
  if (sr === 'scroll') {
    const { cols, colW } = colMetrics();
    scrollCols = buildColumns(loaded, colW);
    if (scrollCols.length > cols) {
      panoramaMode = true;
      currentLoaded = loaded; // flat pool; tile data-index maps into this
      editableBoardId =
        p.mode === 'board' ? (activeBoard ? activeBoard.id : null) : p.boards.length === 1 ? p.boards[0].id : null;
      const strip = buildStrip();
      const kids: HTMLElement[] = [strip];
      if (p.mode === 'board' && p.boards.length > 1 && activeBoard) kids.push(boardSwitcher(activeBoard));
      host.replaceChildren(...kids);
      const secs = p.screenScrollSeconds && p.screenScrollSeconds > 0 ? p.screenScrollSeconds : 20;
      panoramaAnim = startPanorama(strip, secs);
      return;
    }
    // pool fits on one screen → fall through to the static wall
  }
  panoramaMode = false;
  panoramaAnim = undefined;

  // Screen rotation: when the pool overflows the viewport, advance a whole
  // "page" of pins each cycle so every pin gets screen time over time.
  const shown = screenRotate(loaded, sr, p.screenIntervalMinutes);

  currentLoaded = shown;
  // Rearranging writes a flat order back to one board. Board mode → active board;
  // all-pins mode persists only when it collapses to a single board (else the
  // drag still re-justifies the wall live, but there's no single board to save to).
  editableBoardId =
    p.mode === 'board' ? (activeBoard ? activeBoard.id : null) : p.boards.length === 1 ? p.boards[0].id : null;

  const children: HTMLElement[] = [buildWallDom(shown)];
  if (p.mode === 'board' && p.boards.length > 1 && activeBoard) {
    children.push(boardSwitcher(activeBoard));
  }
  host.replaceChildren(...children);

  if (p.mode === 'board' && p.boardRotation === 'interval' && p.boards.length > 1) {
    const m = p.boardIntervalMinutes && p.boardIntervalMinutes > 0 ? p.boardIntervalMinutes : 60;
    boardTimer = setInterval(() => {
      manualBoard = false;
      render();
    }, m * 60_000);
  }

  // Advance the on-screen page live while the tab stays open.
  if ((p.screenRotation ?? 'off') === 'interval' && loaded.length > pageCapacity(loaded)) {
    const m = p.screenIntervalMinutes && p.screenIntervalMinutes > 0 ? p.screenIntervalMinutes : 60;
    screenTimer = setInterval(render, m * 60_000);
  }
}

// Rotate the loaded pool by whole pages so a different screenful shows each
// cycle. 'off' or a pool that already fits → returned unchanged.
function screenRotate(loaded: Loaded[], rotation: PinScreenRotation, intervalMin: number | undefined): Loaded[] {
  if (rotation === 'off' || rotation === 'scroll') return loaded;
  const page = pageCapacity(loaded);
  if (loaded.length <= page) return loaded;
  const pages = Math.ceil(loaded.length / page);
  const cycle =
    rotation === 'daily'
      ? localDayNumber()
      : Math.floor(Date.now() / ((intervalMin && intervalMin > 0 ? intervalMin : 60) * 60_000));
  const offset = ((cycle % pages) + pages) % pages * page;
  return [...loaded.slice(offset), ...loaded.slice(0, offset)];
}

// Collapsible board switcher (top-right): a side pull-tab (matching the todo
// handle) that reveals the prev/name/next pill.
function toggleBoards(): void {
  ctx.saveSettings({ ui: { pinsBoardsOpen: !ctx.settings.ui.pinsBoardsOpen } });
}

function boardSwitcher(activeBoard: PinBoard): HTMLElement {
  const open = ctx.settings.ui.pinsBoardsOpen;
  const tab = h(
    'button',
    {
      class: 'pins-tab',
      title: open ? 'Hide boards' : 'Switch board',
      'aria-label': open ? 'Hide boards' : 'Switch board',
      onClick: toggleBoards,
    },
    open ? '›' : '‹',
  );
  const kids: HTMLElement[] = [];
  if (open) {
    kids.push(
      h(
        'div',
        { class: 'pins-pill' },
        h('button', { class: 'pins-navbtn', title: 'Previous board ([)', onClick: () => switchBoard(-1) }, '‹'),
        h('span', { class: 'pins-board-name' }, activeBoard.name || 'Board'),
        h('button', { class: 'pins-navbtn', title: 'Next board (])', onClick: () => switchBoard(1) }, '›'),
      ),
    );
  }
  kids.push(tab);
  return h('div', { class: 'pins-boards' }, ...kids);
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

// Start dragging tile `idx` from screen point (cx, cy). Works even when the pin
// is under the clock/todo/quote overlays — the ghost + placeholder appear at
// once and onDragMove hit-tests tile rects directly.
function beginDragAt(idx: number, cx: number, cy: number): void {
  if (idx < 0 || !currentLoaded[idx]) return;
  draggingIdx = idx;
  dragMoved = false;
  const el = host.querySelector<HTMLElement>(`.pin-item[data-index="${idx}"]`);
  const rect = el?.getBoundingClientRect();
  const w = rect ? rect.width : 200;
  const ht = rect ? rect.height : 200;
  dragOffX = rect ? cx - rect.left : w / 2;
  dragOffY = rect ? cy - rect.top : ht / 2;

  const gi = h('img', { alt: '' }) as HTMLImageElement;
  gi.draggable = false;
  gi.src = currentLoaded[idx].pin.imageUrl;
  ghost = h('div', { class: 'pin-ghost' }, gi);
  ghost.style.width = `${w}px`;
  ghost.style.height = `${ht}px`;
  positionGhost(cx, cy);
  document.body.appendChild(ghost);

  // Mark the source tile as dragging (dimmed placeholder).
  if (panoramaMode) rebuildStripLive();
  else rebuildWall();
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', endDrag, { once: true });
}

// Direct press on a pin → grab immediately.
function startDrag(e: PointerEvent, idx: number): void {
  if (e.button !== 0) return;
  e.preventDefault();
  if (panoramaMode) panoramaAnim?.pause(); // freeze the drift while rearranging
  beginDragAt(idx, e.clientX, e.clientY);
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
    // Re-justify live so the drop position previews as you move.
    if (panoramaMode) rebuildStripLive();
    else rebuildWall();
  });
}

function endDrag(): void {
  window.removeEventListener('pointermove', onDragMove);
  if (ghost) {
    ghost.remove();
    ghost = null;
  }

  if (rebuildRaf) {
    cancelAnimationFrame(rebuildRaf);
    rebuildRaf = 0;
  }

  // Panorama: order was re-packed live during the drag. Persist if it changed
  // (re-render restarts the drift); otherwise resume the paused drift.
  if (panoramaMode) {
    const moved = dragMoved;
    draggingIdx = -1;
    dragMoved = false;
    if (moved) persistOrder();
    else panoramaAnim?.play();
    return;
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
  {
    key: 'pins.screenRotation',
    label: 'Rotate pins on screen',
    type: 'select',
    options: [...ROTATION_OPTS, { value: 'scroll', label: 'Panorama scroll' }],
    help: 'When a board (or the pooled set) has more pins than fit on screen, cycle through them. Panorama scroll slides one column at a time.',
  },
  {
    key: 'pins.screenIntervalMinutes',
    label: 'Screen rotation interval',
    type: 'select',
    numeric: true, // fractional minutes: 0.25 = 15s, 0.5 = 30s
    options: [
      { value: '0.25', label: '15 seconds' },
      { value: '0.5', label: '30 seconds' },
      { value: '1', label: '1 minute' },
      { value: '2', label: '2 minutes' },
      { value: '5', label: '5 minutes' },
      { value: '10', label: '10 minutes' },
      { value: '15', label: '15 minutes' },
      { value: '30', label: '30 minutes' },
      { value: '60', label: '1 hour' },
    ],
    showIf: (s) => s.pins.screenRotation === 'interval',
  },
  {
    key: 'pins.screenScrollSeconds',
    label: 'Scroll speed (seconds per column)',
    type: 'number',
    min: 1,
    showIf: (s) => s.pins.screenRotation === 'scroll',
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
