import './todo.css';
import type { DashboardModule, Priority, TodoState } from '../../core/types';
import { h } from '../../core/dom';
import { addTodo, clearTodos, loadTodos, removeTodo, saveTodos, toggleTodo } from './store';

let host: HTMLElement;
let state: TodoState = { items: [] };
let dateEl: HTMLElement;
let dateTick: ReturnType<typeof setInterval> | undefined;

const PRIO_RANK: Record<Priority, number> = { high: 0, med: 1, low: 2 };

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
    const check = h('input', {
      class: 'todo-check',
      type: 'checkbox',
      checked: t.done,
      onChange: () => commit(toggleTodo(state, t.id)),
    });
    const row = h(
      'div',
      { class: 'todo-item' },
      check,
      h('span', { class: `todo-text${t.done ? ' done' : ''}` }, t.text),
      h('span', { class: `todo-dot ${t.priority}`, title: t.priority }),
      h('button', { class: 'todo-x', title: 'Remove', onClick: () => commit(removeTodo(state, t.id)) }, '×'),
    );
    list.appendChild(row);
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
