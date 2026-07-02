import './todo.css';
import type { DashboardModule, Priority, TodoState } from '../../core/types';
import { h } from '../../core/dom';
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

let host: HTMLElement;
let state: TodoState = { items: [] };
let dateEl: HTMLElement;
let expandedId: string | null = null;
let dateTick: ReturnType<typeof setInterval> | undefined;

const PRIO_RANK: Record<Priority, number> = { high: 0, med: 1, low: 2 };

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
  dateEl = h('div', { class: 'todo-date' }, dateLabel());
  const header = h('div', { class: 'todo-head' }, dateEl);
  if (state.items.length) {
    header.appendChild(
      h('button', { class: 'todo-clear', onClick: () => commit(clearTodos()) }, 'Clear'),
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
    h('option', { value: 'high' }, 'H'),
    h('option', { value: 'med', selected: true }, 'M'),
    h('option', { value: 'low' }, 'L'),
  );
  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    commit(addTodo(state, text, prio.value as Priority), true);
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
      onChange: () => commit(toggleTodo(state, t.id)),
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
      h('button', { class: 'todo-x', title: 'Remove', onClick: () => commit(removeTodo(state, t.id)) }, '×'),
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

  host.replaceChildren(h('div', { class: 'card todo' }, header, addRow, list));
}

export const todo: DashboardModule = {
  id: 'todo',
  slot: 'sidebar',
  order: 10,
  settingsSchema: [],

  async init() {
    state = await loadTodos();
    // Refresh the weekday/date label if the tab lives past midnight.
    dateTick = setInterval(() => {
      if (dateEl) dateEl.textContent = dateLabel();
    }, 60_000);
  },

  render(el) {
    host = el;
    rebuild();
  },

  destroy() {
    if (dateTick) clearInterval(dateTick);
  },
};
