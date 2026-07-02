import type { Priority, Todo, TodoState } from '../../core/types';
import { storage } from '../../core/storage';

const KEY = 'todos';

export async function loadTodos(): Promise<TodoState> {
  return storage.get<TodoState>(KEY, { items: [] });
}

export async function saveTodos(state: TodoState): Promise<void> {
  await storage.set(KEY, state);
}

// Pure state transforms below — each returns a new TodoState.
export function clearTodos(): TodoState {
  return { items: [] };
}

export function addTodo(state: TodoState, text: string, priority: Priority): TodoState {
  const todo: Todo = {
    id: crypto.randomUUID(),
    text,
    done: false,
    priority,
    createdAt: Date.now(),
  };
  return { items: [...state.items, todo] };
}

export function toggleTodo(state: TodoState, id: string): TodoState {
  return { items: state.items.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) };
}

export function removeTodo(state: TodoState, id: string): TodoState {
  return { items: state.items.filter((t) => t.id !== id) };
}
