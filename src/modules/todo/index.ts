import './todo.css';
import type { DashboardModule, ModuleContext, Priority, TodoState } from '../../core/types';
import { h, animateOut, clamp } from '../../core/dom';
import {
  addTodo,
  clearTodos,
  loadTodos,
  removeTodo,
  reorderTodo,
  saveTodos,
  toggleTodo,
  updateTodo,
  POS_STEP,
  type TodoPatch,
} from './store';
import {
  trelloCreate,
  trelloDelete,
  trelloListsForBoard,
  trelloPull,
  trelloSetDone,
  trelloSetPos,
  weekdayListId,
  type TrelloConfig,
} from './trello';

let ctx: ModuleContext;
let host: HTMLElement;
let state: TodoState = { items: [] };
let dateEl: HTMLElement;
let expandedId: string | null = null;
let dateTick: ReturnType<typeof setInterval> | undefined;
let syncStatus: 'off' | 'synced' | 'offline' = 'off';
// Row to play the shine sweep on (the item just checked off), consumed once per rebuild.
let justCompletedId: string | null = null;
// Last-known "every item done" state — celebration fires only on the rising edge.
let allDone = false;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Weekday list resolved from the board name-match; refreshed each sync.
// Used by the synchronous callers (submit/toggle/remove) so they hit today's list.
let weekdayList: string | null = null;
// The board's open lists (both modes; empty if no board configured). Refreshed
// each sync. Powers the manual ‹ › navigation in non-weekday mode.
let boardLists: { id: string; name: string }[] = [];
// Cursor into boardLists for manual navigation, and the board it's valid for
// (so switching boards re-homes the cursor instead of keeping a stale index).
let listCursor = 0;
let cursorBoardId: string | null = null;

// Item currently being dragged (HTML5 DnD), cleared on drop/dragend.
let dragId: string | null = null;

// The list all card ops target: today's weekday list when auto-mode resolved
// one, else the fixed list ID. Empty string when neither is available.
function effectiveListId(): string {
  const t = ctx?.settings.todo;
  if (t?.trelloAutoWeekday) return weekdayList ?? t?.trelloListId ?? '';
  // Manual mode: the arrow-navigated board list wins over the fixed list ID.
  if (boardLists.length) return boardLists[listCursor]?.id ?? t?.trelloListId ?? '';
  return t?.trelloListId ?? '';
}

// Non-null only when Trello is enabled, creds are present, AND a target list
// resolves (fixed ID, or a weekday match found on the board).
function trelloCfg(): TrelloConfig | null {
  const t = ctx?.settings.todo;
  if (!t?.trelloEnabled || !t.trelloKey || !t.trelloToken) return null;
  const listId = effectiveListId();
  if (!listId) return null;
  return { key: t.trelloKey, token: t.trelloToken, listId };
}

// Fetch the board's open lists into boardLists (empty on no board / failure).
// Feeds both the weekday match and the manual ‹ › navigation.
async function resolveBoardLists(): Promise<void> {
  const t = ctx?.settings.todo;
  if (!t?.trelloEnabled || !t.trelloKey || !t.trelloToken || !t.trelloBoardId) {
    boardLists = [];
    return;
  }
  boardLists = (await trelloListsForBoard(t.trelloKey, t.trelloToken, t.trelloBoardId)) ?? [];
}

// Keep the manual cursor sane: re-home it onto the configured list when the
// board changes, and always clamp it inside the current list count.
function syncCursorToBoard(): void {
  const t = ctx?.settings.todo;
  const bid = t?.trelloBoardId ?? '';
  if (cursorBoardId !== bid) {
    cursorBoardId = bid;
    // Restore the last-shown list across sessions (syncedListId persists), then
    // fall back to the configured start list, then the first list.
    let idx = boardLists.findIndex((l) => l.id === state.syncedListId);
    if (idx < 0) idx = boardLists.findIndex((l) => l.id === t?.trelloListId);
    listCursor = idx >= 0 ? idx : 0;
  }
  listCursor = clamp(listCursor, 0, Math.max(0, boardLists.length - 1));
}

// When auto-weekday is on, match today's weekday against the board's list names.
// Sets weekdayList (null if no board/match). No-op when auto-mode is off.
function resolveWeekdayList(): void {
  const t = ctx?.settings.todo;
  if (!t?.trelloEnabled || !t.trelloAutoWeekday) {
    weekdayList = null;
    return;
  }
  weekdayList = boardLists.length ? weekdayListId(boardLists) : null;
}

// Step the manual cursor to the prev/next board list; the resulting list switch
// rewrites the sidebar (see syncFromTrello). No-op at the ends / with no board.
function navList(dir: -1 | 1): void {
  if (!boardLists.length) return;
  const next = clamp(listCursor + dir, 0, boardLists.length - 1);
  if (next === listCursor) return;
  listCursor = next;
  syncFromTrello();
}

// Pull server cards, merge in unseen ones, push local-only ones up. Never
// blocks first paint (called post-render) and never throws.
async function syncFromTrello(): Promise<void> {
  await resolveBoardLists(); // board's lists first — feeds weekday + manual nav
  syncCursorToBoard(); // position the manual cursor for this board
  resolveWeekdayList(); // pick today's list before building the config
  const cfg = trelloCfg();
  if (!cfg) {
    syncStatus = 'off';
    return;
  }
  const targetList = cfg.listId;
  // Moving to a different list — a new weekday in auto mode, or an arrow press in
  // manual mode — rewrites the sidebar to mirror that list instead of appending.
  const isSwitch = state.syncedListId != null && state.syncedListId !== targetList;
  const cards = await trelloPull(cfg);
  if (cards === null) {
    syncStatus = 'offline';
    rebuild();
    return;
  }
  if (isSwitch) {
    state.items = cards;
    state.syncedListId = targetList;
    await saveTodos(state);
    syncStatus = 'synced';
    rebuild();
    return;
  }
  const known = new Set(state.items.filter((i) => i.trelloCardId).map((i) => i.trelloCardId));
  // Trello per-card done + pos — source of truth for checked state and order.
  const doneByCard = new Map(cards.map((c) => [c.trelloCardId, c.done]));
  const posByCard = new Map(cards.map((c) => [c.trelloCardId, c.pos]));
  let changed = false;
  for (const card of cards) {
    if (!known.has(card.trelloCardId)) {
      state.items.push(card);
      changed = true;
    }
  }
  // Reflect Trello check/uncheck and reordering onto already-known items.
  for (const item of state.items) {
    if (item.trelloCardId && doneByCard.has(item.trelloCardId)) {
      const remote = doneByCard.get(item.trelloCardId)!;
      if (item.done !== remote) {
        item.done = remote;
        changed = true;
      }
      const remotePos = posByCard.get(item.trelloCardId)!;
      if (item.pos !== remotePos) {
        item.pos = remotePos;
        changed = true;
      }
    }
  }
  for (const item of state.items) {
    if (!item.trelloCardId) {
      const id = await trelloCreate(cfg, item);
      if (id) {
        item.trelloCardId = id;
        changed = true;
      }
    }
  }
  // Record the list these items now mirror, so the next switch is detected.
  if (state.syncedListId !== targetList) {
    state.syncedListId = targetList;
    changed = true;
  }
  if (changed) await saveTodos(state);
  syncStatus = 'synced';
  rebuild();
}

// Prepend https:// when the user omits a scheme so the href resolves off-site.
function normalizeLink(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
}

function dateLabel(): string {
  const now = new Date();
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const md = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${weekday} · ${md}`;
}

// Manual order (Trello-style): pos ascending, createdAt as a stable tiebreak.
function sortedItems(): TodoState['items'] {
  return [...state.items].sort((a, b) => a.pos - b.pos || a.createdAt - b.createdAt);
}

// Midpoint pos for an item dropped between `before` and `after` (either absent
// at the list ends). Mirrors Trello's fractional insert.
function posBetween(before?: TodoState['items'][number], after?: TodoState['items'][number]): number {
  if (before && after) return (before.pos + after.pos) / 2;
  if (after) return after.pos / 2; // dropped at the top
  if (before) return before.pos + POS_STEP; // dropped at the bottom
  return POS_STEP;
}

// Below the row's vertical midpoint → drop after it, else before.
function dropIsAfter(e: DragEvent, el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return e.clientY > r.top + r.height / 2;
}

// Strip the drop-position highlight from every row (drag ended / left).
function clearDropMarks(): void {
  host?.querySelectorAll('.todo-item').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
}

// Reorder dragId relative to targetId, persist, and push the new pos to Trello.
function dropOnItem(targetId: string, placeAfter: boolean): void {
  if (!dragId || dragId === targetId) return;
  const ordered = sortedItems().filter((i) => i.id !== dragId);
  let idx = ordered.findIndex((i) => i.id === targetId);
  if (idx < 0) return;
  if (placeAfter) idx += 1;
  const pos = posBetween(ordered[idx - 1], ordered[idx]);
  const moved = dragId;
  commit(reorderTodo(state, moved, pos)).then(() => {
    const cfg = trelloCfg();
    const cur = state.items.find((i) => i.id === moved);
    if (cfg && cur?.trelloCardId) trelloSetPos(cfg, cur.trelloCardId, pos);
  });
  dragId = null;
}

async function commit(next: TodoState, refocus = false): Promise<void> {
  state = next;
  await saveTodos(state);
  rebuild();
  if (refocus) host.querySelector<HTMLInputElement>('.todo-input')?.focus();
}

function update(id: string, patch: TodoPatch): void {
  commit(updateTodo(state, id, patch));
}

// Confetti burst + pill message over the card when every task is done.
function celebrate(card: HTMLElement): void {
  const overlay = h('div', { class: 'todo-celebrate' });
  overlay.appendChild(h('div', { class: 'msg' }, 'All done! 🎉'));
  const colors = ['#238636', '#2ea043', '#3fb950', '#d29922', '#58a6ff'];
  for (let i = 0; i < 16; i++) {
    overlay.appendChild(
      h('span', {
        class: 'todo-confetti',
        style: {
          left: `${Math.random() * 100}%`,
          background: colors[i % colors.length],
          animationDelay: `${Math.random() * 0.25}s`,
        },
      }),
    );
  }
  card.appendChild(overlay);
  setTimeout(() => overlay.remove(), 2000);
}

function rebuild(): void {
  // Collapsed → just a handle to bring the sidebar back.
  if (ctx.settings.ui.todoHidden) {
    host.replaceChildren(
      h(
        'button',
        { class: 'todo-handle ui-enter', title: 'Show tasks', 'aria-label': 'Show tasks', onClick: () => ctx.saveSettings({ ui: { todoHidden: false } }) },
        '›',
      ),
    );
    return;
  }

  dateEl = h('div', { class: 'todo-date' }, dateLabel());
  const left = h('div', { class: 'todo-head-left' }, dateEl);
  if (syncStatus !== 'off') {
    left.appendChild(
      h('span', {
        class: `todo-sync ${syncStatus}`,
        title: syncStatus === 'synced' ? 'Synced with Trello' : 'Trello offline — local only',
      }),
    );
  }
  const headActions = h('div', { class: 'todo-head-actions' });
  if (state.items.length) {
    headActions.appendChild(
      h('button', { class: 'todo-clear', onClick: () => commit(clearTodos()) }, 'Clear'),
    );
  }
  headActions.appendChild(
    h(
      'button',
      { class: 'todo-hide', title: 'Hide tasks', 'aria-label': 'Hide tasks', onClick: () => ctx.saveSettings({ ui: { todoHidden: true } }) },
      '‹',
    ),
  );
  const header = h('div', { class: 'todo-head' }, left, headActions);

  // Manual mode with a board: ‹ › to page through the board's lists.
  const t = ctx.settings.todo;
  let listNav: HTMLElement | null = null;
  if (t.trelloEnabled && !t.trelloAutoWeekday && boardLists.length > 0) {
    const idx = clamp(listCursor, 0, boardLists.length - 1);
    const cur = boardLists[idx];
    listNav = h(
      'div',
      { class: 'todo-listnav' },
      h(
        'button',
        { class: 'todo-nav', disabled: idx <= 0, title: 'Previous list', 'aria-label': 'Previous list', onClick: () => navList(-1) },
        '‹',
      ),
      h('span', { class: 'todo-listname', title: cur?.name ?? '' }, cur?.name ?? ''),
      h(
        'button',
        { class: 'todo-nav', disabled: idx >= boardLists.length - 1, title: 'Next list', 'aria-label': 'Next list', onClick: () => navList(1) },
        '›',
      ),
    );
  }

  const input = h('input', {
    class: 'todo-input',
    type: 'text',
    placeholder: 'Add a task…',
    maxlength: 200,
  });
  const prio = h(
    'select',
    { class: 'todo-prio-select' },
    h('option', { value: 'high' }, 'High'),
    h('option', { value: 'med', selected: true }, 'Med'),
    h('option', { value: 'low' }, 'Low'),
  );
  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    commit(addTodo(state, text, prio.value as Priority), true).then(() => {
      const cfg = trelloCfg();
      if (!cfg) return;
      const item = state.items[state.items.length - 1]; // addTodo appends
      trelloCreate(cfg, item).then((id) => {
        if (id) {
          item.trelloCardId = id;
          saveTodos(state);
        }
      });
    });
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  const addRow = h(
    'div',
    { class: 'todo-add' },
    input,
    prio,
    h('button', { class: 'primary', onClick: submit }, 'Add'),
  );

  const list = h('div', { class: 'todo-list' });
  for (const t of sortedItems()) {
    const expanded = expandedId === t.id;
    const check = h('input', {
      class: 'todo-check',
      type: 'checkbox',
      checked: t.done,
      onChange: () => {
        if (!t.done && !reducedMotion) justCompletedId = t.id; // becoming done → shine
        commit(toggleTodo(state, t.id)).then(() => {
          const cfg = trelloCfg();
          const cur = state.items.find((i) => i.id === t.id);
          if (cfg && cur?.trelloCardId) trelloSetDone(cfg, cur.trelloCardId, cur.done);
        });
      },
    });
    const toggleExpand = () => {
      expandedId = expanded ? null : t.id;
      rebuild();
    };
    const text = h('span', { class: `todo-text${t.done ? ' done' : ''}`, onClick: toggleExpand }, t.text);
    const meta = h('span', { class: 'todo-meta' });
    if (t.desc) meta.appendChild(h('span', { class: 'todo-badge', title: 'Has description' }, '≡'));
    if (t.link) {
      meta.appendChild(
        h(
          'a',
          {
            class: 'todo-badge todo-link',
            href: t.link,
            target: '_blank',
            rel: 'noopener noreferrer',
            title: t.link,
            onClick: (e: Event) => e.stopPropagation(),
          },
          '🔗',
        ),
      );
    }
    const shine = justCompletedId === t.id && t.done;
    const grip = h('span', { class: 'todo-grip', title: 'Drag to reorder', 'aria-hidden': 'true' }, '⠿');
    const row = h(
      'div',
      {
        class: `todo-item${expanded ? ' expanded' : ''}${shine ? ' todo-shine' : ''}`,
        draggable: 'true',
        onDragstart: (e: DragEvent) => {
          dragId = t.id;
          row.classList.add('dragging');
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', t.id);
          }
        },
        onDragend: () => {
          dragId = null;
          row.classList.remove('dragging');
          clearDropMarks();
        },
        onDragover: (e: DragEvent) => {
          if (!dragId || dragId === t.id) return;
          e.preventDefault();
          const after = dropIsAfter(e, row);
          row.classList.toggle('drop-after', after);
          row.classList.toggle('drop-before', !after);
        },
        onDragleave: () => row.classList.remove('drop-before', 'drop-after'),
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          const after = dropIsAfter(e, row);
          dropOnItem(t.id, after);
        },
      },
      grip,
      check,
      text,
      meta,
      h('span', { class: `todo-dot ${t.priority}`, title: t.priority }),
      h(
        'button',
        {
          class: 'todo-x',
          title: 'Remove',
          onClick: () => {
            const cfg = trelloCfg();
            const cardId = t.trelloCardId;
            commit(removeTodo(state, t.id));
            if (cfg && cardId) trelloDelete(cfg, cardId); // Clear stays local-only; single remove syncs
          },
        },
        '×',
      ),
    );
    list.appendChild(row);

    if (expanded) {
      const editText = h('input', {
        class: 'todo-edit-text',
        type: 'text',
        value: t.text,
        onChange: (e: Event) => {
          const v = (e.target as HTMLInputElement).value.trim();
          update(t.id, { text: v || t.text });
        },
      });
      const descBox = h('textarea', {
        class: 'todo-desc',
        rows: 3,
        placeholder: 'Description…',
        value: t.desc ?? '',
        onChange: (e: Event) => update(t.id, { desc: (e.target as HTMLTextAreaElement).value }),
      });
      const linkBox = h('input', {
        class: 'todo-link-input',
        type: 'text',
        placeholder: 'https://…',
        value: t.link ?? '',
        onChange: (e: Event) => update(t.id, { link: normalizeLink((e.target as HTMLInputElement).value) }),
      });
      const detail = h(
        'div',
        { class: 'todo-detail' },
        h('label', { class: 'todo-field-label' }, 'Title'),
        editText,
        h('label', { class: 'todo-field-label' }, 'Description'),
        descBox,
        h('label', { class: 'todo-field-label' }, 'Link'),
        linkBox,
      );
      if (t.link) {
        detail.appendChild(
          h('a', { class: 'todo-open', href: t.link, target: '_blank', rel: 'noopener noreferrer' }, 'Open link ↗'),
        );
      }
      list.appendChild(detail);
    }
  }

  const cardEl = h('div', { class: 'card todo' }, header, listNav, addRow, list);
  if (animateShow) {
    cardEl.classList.add('ui-enter');
    animateShow = false;
  }

  justCompletedId = null; // shine is one-shot; consume it after this build

  // Fire the celebration only when crossing into all-done (non-empty list).
  const everyDone = state.items.length > 0 && state.items.every((i) => i.done);
  if (everyDone && !allDone && !reducedMotion) celebrate(cardEl);
  allDone = everyDone;

  host.replaceChildren(cardEl);
}

let unsub: (() => void) | undefined;
let lastCfgSig = '';

// Signature over every Trello setting that affects which list we sync, so a
// change to creds, board, list, or mode retriggers a sync. (trelloCfg() can't
// be used here — it reads the async-resolved weekdayList, which lags settings.)
function trelloSig(): string {
  const t = ctx?.settings.todo;
  return JSON.stringify([
    t?.trelloEnabled,
    t?.trelloKey,
    t?.trelloToken,
    t?.trelloListId,
    t?.trelloBoardId,
    t?.trelloAutoWeekday,
  ]);
}
let lastHidden = false;
let animateShow = false; // play enter animation when the card returns from hidden

export const todo: DashboardModule = {
  id: 'todo',
  slot: 'sidebar',
  order: 10,
  settingsSchema: [
    { key: 'todo.trelloEnabled', label: 'Sync with Trello', type: 'toggle' },
    {
      key: 'todo.trelloKey',
      label: 'Trello API key',
      type: 'text',
      placeholder: 'key',
      showIf: (s) => s.todo.trelloEnabled,
      help: 'Generate a key + token at trello.com/power-ups/admin.',
    },
    { key: 'todo.trelloToken', label: 'Trello token', type: 'text', placeholder: 'token', showIf: (s) => s.todo.trelloEnabled },
    {
      key: 'todo.trelloAutoWeekday',
      label: 'Auto-pick list by weekday',
      type: 'toggle',
      showIf: (s) => s.todo.trelloEnabled,
      help: 'Match today\'s weekday (e.g. "Monday") against the board\'s list names.',
    },
    {
      key: 'todo.trelloBoardId',
      label: 'Trello board ID',
      type: 'text',
      placeholder: 'board id',
      showIf: (s) => s.todo.trelloEnabled,
      help: "Open the board, add .json to its URL — the top-level 'id' is the board ID. Powers weekday matching and the ‹ › list arrows.",
    },
    {
      key: 'todo.trelloListId',
      label: 'Trello list ID',
      type: 'text',
      placeholder: 'list id',
      showIf: (s) => s.todo.trelloEnabled && !s.todo.trelloAutoWeekday,
      help: "Starting list for the ‹ › arrows (and fallback when no weekday matches). Open the list's 'Copy link' — the ID is the last path segment.",
    },
  ],

  async init(c) {
    ctx = c;
    state = await loadTodos();
    // Refresh the weekday/date label if the tab lives past midnight, and re-sync
    // so auto-weekday follows the new day onto the next list.
    let lastWeekday = new Date().getDay();
    dateTick = setInterval(() => {
      if (dateEl) dateEl.textContent = dateLabel();
      const day = new Date().getDay();
      if (day !== lastWeekday) {
        lastWeekday = day;
        if (ctx.settings.todo.trelloAutoWeekday) syncFromTrello();
      }
    }, 60_000);
    lastHidden = c.settings.ui.todoHidden;
    // Re-sync when Trello config changes; rebuild when the hide toggle flips.
    unsub = c.bus.on('settings-changed', () => {
      if (c.settings.ui.todoHidden !== lastHidden) {
        const nowHidden = c.settings.ui.todoHidden;
        lastHidden = nowHidden;
        if (host) {
          const card = host.querySelector<HTMLElement>('.card.todo');
          if (nowHidden && card) animateOut(card, rebuild); // fade card, then show handle
          else {
            if (!nowHidden) animateShow = true; // returning → animate card in
            rebuild();
          }
        }
      }
      const sig = trelloSig();
      if (sig !== lastCfgSig) {
        lastCfgSig = sig;
        syncFromTrello();
      }
    });
  },

  render(el) {
    host = el;
    rebuild();
    // Pull from Trello after first paint (never blocks render; 2 s abort inside).
    lastCfgSig = trelloSig();
    setTimeout(() => syncFromTrello(), 0);
  },

  destroy() {
    if (dateTick) clearInterval(dateTick);
    if (unsub) unsub();
  },
};
