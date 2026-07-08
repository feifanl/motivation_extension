import './todo.css';
import type { DashboardModule, ModuleContext, Priority, TodoState } from '../../core/types';
import { h, animateOut } from '../../core/dom';
import {
  addTodo,
  clearTodos,
  loadTodos,
  removeTodo,
  saveTodos,
  toggleTodo,
  updateTodo,
  type TodoPatch,
} from './store';
import {
  trelloClose,
  trelloCreate,
  trelloDelete,
  trelloListsForBoard,
  trelloPull,
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
// Weekday list resolved from the board name-match; refreshed each sync.
// Used by the synchronous callers (submit/toggle/remove) so they hit today's list.
let weekdayList: string | null = null;

const PRIO_RANK: Record<Priority, number> = { high: 0, med: 1, low: 2 };

// The list all card ops target: today's weekday list when auto-mode resolved
// one, else the fixed list ID. Empty string when neither is available.
function effectiveListId(): string {
  const t = ctx?.settings.todo;
  if (t?.trelloAutoWeekday && weekdayList) return weekdayList;
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

// When auto-weekday is on, scan the board and match today's weekday to a list
// name. Sets weekdayList (null if no board/match). No-op when auto-mode is off.
async function resolveWeekdayList(): Promise<void> {
  const t = ctx?.settings.todo;
  if (!t?.trelloEnabled || !t.trelloAutoWeekday || !t.trelloKey || !t.trelloToken || !t.trelloBoardId) {
    weekdayList = null;
    return;
  }
  const lists = await trelloListsForBoard(t.trelloKey, t.trelloToken, t.trelloBoardId);
  weekdayList = lists ? weekdayListId(lists) : null;
}

// Pull server cards, merge in unseen ones, push local-only ones up. Never
// blocks first paint (called post-render) and never throws.
async function syncFromTrello(): Promise<void> {
  await resolveWeekdayList(); // pick today's list before building the config
  const cfg = trelloCfg();
  if (!cfg) {
    syncStatus = 'off';
    return;
  }
  const cards = await trelloPull(cfg);
  if (cards === null) {
    syncStatus = 'offline';
    rebuild();
    return;
  }
  const known = new Set(state.items.filter((i) => i.trelloCardId).map((i) => i.trelloCardId));
  let changed = false;
  for (const card of cards) {
    if (!known.has(card.trelloCardId)) {
      state.items.push(card);
      changed = true;
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

function sortedItems(): TodoState['items'] {
  return [...state.items].sort(
    (a, b) => PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || a.createdAt - b.createdAt,
  );
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

  const input = h('input', {
    class: 'todo-input',
    type: 'text',
    placeholder: 'Add a task…',
    maxlength: 200,
  });
  const prio = h(
    'select',
    { class: 'todo-prio-select' },
    h('option', { value: 'high' }, 'H'),
    h('option', { value: 'med', selected: true }, 'M'),
    h('option', { value: 'low' }, 'L'),
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
        commit(toggleTodo(state, t.id)).then(() => {
          const cfg = trelloCfg();
          const cur = state.items.find((i) => i.id === t.id);
          if (cfg && cur?.done && cur.trelloCardId) trelloClose(cfg, cur.trelloCardId);
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
    const row = h(
      'div',
      { class: `todo-item${expanded ? ' expanded' : ''}` },
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

  const cardEl = h('div', { class: 'card todo' }, header, addRow, list);
  if (animateShow) {
    cardEl.classList.add('ui-enter');
    animateShow = false;
  }
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
      showIf: (s) => s.todo.trelloEnabled && s.todo.trelloAutoWeekday,
      help: "Open the board, add .json to its URL — the top-level 'id' is the board ID.",
    },
    {
      key: 'todo.trelloListId',
      label: 'Trello list ID',
      type: 'text',
      placeholder: 'list id',
      showIf: (s) => s.todo.trelloEnabled && !s.todo.trelloAutoWeekday,
      help: "Open the list's 'Copy link' — the list ID is the last path segment. Used as a fallback when no weekday list matches.",
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
