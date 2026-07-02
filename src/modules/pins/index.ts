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

let ctx: ModuleContext;
let host: HTMLElement;
let pinTimer: ReturnType<typeof setInterval> | undefined;
let boardTimer: ReturnType<typeof setInterval> | undefined;
let onKey: ((e: KeyboardEvent) => void) | undefined;
let unsub: (() => void) | undefined;
// Manual overrides beat auto-rotation until the next auto tick clears them.
let manualPin = false;
let manualBoard = false;

function localDayNumber(): number {
  const offset = new Date().getTimezoneOffset() * 60_000;
  return Math.floor((Date.now() - offset) / DAY);
}

// Auto index for a rotation/interval pair. 'off' → keep the manual cursor.
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

function persistBoards(boards: PinBoard[]): void {
  ctx.saveSettings({ pins: { boards } });
}

function clearTimers(): void {
  if (pinTimer) clearInterval(pinTimer);
  if (boardTimer) clearInterval(boardTimer);
  pinTimer = undefined;
  boardTimer = undefined;
}

function render(): void {
  clearTimers();
  const p = ctx.settings.pins;
  const totalPins = p.boards.reduce((n, b) => n + b.pins.length, 0);
  if (!p.enabled || totalPins === 0) {
    host.replaceChildren();
    return;
  }

  // ---- resolve pool + cursor + rotation for the current mode ----
  let pool: Pin[];
  let cursor: number;
  let rotation: PinRotation;
  let interval: number | undefined;
  let setCursor: (i: number) => void;
  let activeBoard: PinBoard | null = null;

  if (p.mode === 'all') {
    pool = p.boards.flatMap((b) => b.pins);
    cursor = p.allIndex;
    rotation = p.allRotation;
    interval = p.allIntervalMinutes;
    setCursor = (i) => ctx.saveSettings({ pins: { allIndex: i } });
  } else {
    activeBoard = p.boards.find((b) => b.id === p.activeBoardId) ?? p.boards[0];
    pool = activeBoard.pins;
    cursor = activeBoard.index;
    rotation = activeBoard.rotation;
    interval = activeBoard.intervalMinutes;
    setCursor = (i) => {
      const boards = p.boards.map((b) => (b.id === activeBoard!.id ? { ...b, index: i } : b));
      persistBoards(boards);
    };
  }

  if (pool.length === 0) {
    host.replaceChildren();
    return;
  }

  // Manual cursor wins until an auto tick resets it.
  const index = manualPin ? ((cursor % pool.length) + pool.length) % pool.length
    : autoIndex(rotation, interval, pool.length, cursor);

  // ---- build card ----
  const card = h('div', { class: 'card pins' });

  // Board switcher (board mode, >1 board)
  if (p.mode === 'board' && p.boards.length > 1 && activeBoard) {
    const label = h('span', { class: 'pins-board-name' }, activeBoard.name || 'Board');
    const head = h(
      'div',
      { class: 'pins-head' },
      h('button', { class: 'pins-navbtn', title: 'Previous board', onClick: () => switchBoard(-1) }, '‹'),
      label,
      h('button', { class: 'pins-navbtn', title: 'Next board', onClick: () => switchBoard(1) }, '›'),
    );
    card.appendChild(head);
  }

  const media = h('div', { class: 'pins-media' });
  card.appendChild(media);

  // Pin-by-pin arrows (pool > 1)
  if (pool.length > 1) {
    media.appendChild(
      h('button', { class: 'pins-arrow left', title: 'Previous pin', onClick: () => flipPin(-1, pool.length, setCursor, cursor, index) }, '‹'),
    );
    media.appendChild(
      h('button', { class: 'pins-arrow right', title: 'Next pin', onClick: () => flipPin(1, pool.length, setCursor, cursor, index) }, '›'),
    );
  }

  host.replaceChildren(card);
  mountImage(media, pool, index, card);

  // ---- schedule auto ticks ----
  if (rotation === 'interval') {
    const m = interval && interval > 0 ? interval : 60;
    pinTimer = setInterval(() => {
      manualPin = false;
      render();
    }, m * 60_000);
  }
  if (p.mode === 'board' && p.boardRotation === 'interval' && p.boards.length > 1) {
    const m = p.boardIntervalMinutes && p.boardIntervalMinutes > 0 ? p.boardIntervalMinutes : 60;
    boardTimer = setInterval(() => {
      manualBoard = false;
      applyAutoBoard();
    }, m * 60_000);
  }

  // Auto board rotation (daily/interval) picks the active board unless the user just switched.
  if (p.mode === 'board' && !manualBoard && p.boardRotation !== 'off' && p.boards.length > 1) {
    applyAutoBoard();
  }
}

function applyAutoBoard(): void {
  const p = ctx.settings.pins;
  const curIdx = Math.max(0, p.boards.findIndex((b) => b.id === p.activeBoardId));
  const idx = autoIndex(p.boardRotation, p.boardIntervalMinutes, p.boards.length, curIdx);
  const target = p.boards[idx];
  if (target && target.id !== p.activeBoardId) {
    manualPin = false; // reset pin cursor for the newly active board
    ctx.saveSettings({ pins: { activeBoardId: target.id } });
  }
}

function flipPin(
  dir: number,
  len: number,
  setCursor: (i: number) => void,
  cursor: number,
  shown: number,
): void {
  manualPin = true;
  const base = manualPin ? shown : cursor; // continue from what's on screen
  const next = ((base + dir) % len + len) % len;
  setCursor(next);
  render();
}

function switchBoard(dir: number): void {
  const p = ctx.settings.pins;
  if (p.boards.length < 2) return;
  const curIdx = Math.max(0, p.boards.findIndex((b) => b.id === p.activeBoardId));
  const next = ((curIdx + dir) % p.boards.length + p.boards.length) % p.boards.length;
  manualBoard = true;
  manualPin = false;
  ctx.saveSettings({ pins: { activeBoardId: p.boards[next].id } });
}

// Show pool[start]; on load error advance to the next pin, hiding the card if none load.
function mountImage(media: HTMLElement, pool: Pin[], start: number, card: HTMLElement): void {
  let tries = 0;
  const tryAt = (i: number): void => {
    if (tries++ >= pool.length) {
      card.remove();
      return;
    }
    const idx = ((i % pool.length) + pool.length) % pool.length;
    const pin = pool[idx];
    const img = new Image(); // eager: we probe load/error before inserting
    img.className = 'pins-img';
    img.onload = () => {
      const link = h('a', {
        class: 'pins-link',
        href: pin.linkUrl || pin.imageUrl,
        target: '_blank',
        rel: 'noopener noreferrer',
      });
      link.appendChild(img);
      media.insertBefore(link, media.firstChild);
    };
    img.onerror = () => tryAt(i + 1);
    img.src = pin.imageUrl;
  };
  tryAt(start);
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
  { key: 'pins.enabled', label: 'Show pins', type: 'toggle' },
  {
    key: 'pins.mode',
    label: 'Mode',
    type: 'select',
    options: [
      { value: 'board', label: 'One board' },
      { value: 'all', label: 'All pins pooled' },
    ],
  },
  {
    key: 'pins.boards',
    label: 'Boards',
    type: 'list',
    newItem: () => ({ id: crypto.randomUUID(), name: '', pins: [], rotation: 'off', index: 0 }),
    itemFields: [
      { key: 'name', label: 'Name', type: 'text', placeholder: 'hopecore' },
      { key: 'rotation', label: 'Pin rotation', type: 'select', options: ROTATION_OPTS },
      { key: 'intervalMinutes', label: 'Interval (min)', type: 'number', min: 1 },
      { key: 'pins', label: 'Image URLs (one per line)', type: 'textarea', parse: parsePins, format: formatPins },
    ],
  },
  {
    key: 'pins.boardRotation',
    label: 'Board rotation',
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
    key: 'pins.allRotation',
    label: 'Rotation',
    type: 'select',
    options: ROTATION_OPTS,
    showIf: (s) => s.pins.mode === 'all',
  },
  {
    key: 'pins.allIntervalMinutes',
    label: 'Interval (min)',
    type: 'number',
    min: 1,
    showIf: (s) => s.pins.mode === 'all' && s.pins.allRotation === 'interval',
  },
];

export const pins: DashboardModule = {
  id: 'pins',
  slot: 'sidebar',
  order: 20,
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
    if (unsub) unsub();
  },
};
