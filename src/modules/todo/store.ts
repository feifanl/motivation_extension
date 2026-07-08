import type { Priority, Todo, TodoState } from '../../core/types';
import { storage } from '../../core/storage';

const KEY = 'todos';

// Gap between adjacent positions. Reordering inserts at the midpoint of two
// neighbors, so a wide step leaves room for many inserts before floats collide.
export const POS_STEP = 65536;

export async function loadTodos(): Promise<TodoState> {
  const state = await storage.get<TodoState>(KEY, { items: [] });
  // Backfill pos for items saved before manual ordering existed — array order
  // becomes the initial sort. Persisted on the next save.
  let p = POS_STEP;
  for (const t of state.items) {
    if (typeof t.pos !== 'number') t.pos = p;
    p += POS_STEP;
  }
  return state;
}

export async function saveTodos(state: TodoState): Promise<void> {
  await storage.set(KEY, state);
}

// Pure state transforms below — each returns a new TodoState.
export function clearTodos(): TodoState {
  return { items: [] };
}

export function addTodo(state: TodoState, text: string, priority: Priority): TodoState {
  const maxPos = state.items.reduce((m, t) => Math.max(m, t.pos), 0);
  const todo: Todo = {
    id: crypto.randomUUID(),
    text,
    done: false,
    priority,
    createdAt: Date.now(),
    pos: maxPos + POS_STEP, // append to the bottom
  };
  return { ...state, items: [...state.items, todo] };
}

export function toggleTodo(state: TodoState, id: string): TodoState {
  return { ...state, items: state.items.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) };
}

// Reposition one item by overwriting its pos; caller computes the midpoint.
export function reorderTodo(state: TodoState, id: string, pos: number): TodoState {
  return { ...state, items: state.items.map((t) => (t.id === id ? { ...t, pos } : t)) };
}

export type TodoPatch = Partial<Pick<Todo, 'text' | 'desc' | 'link' | 'priority'>>;
export function updateTodo(state: TodoState, id: string, patch: TodoPatch): TodoState {
  return { ...state, items: state.items.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
}

export function removeTodo(state: TodoState, id: string): TodoState {
  return { ...state, items: state.items.filter((t) => t.id !== id) };
}
