import type { Priority, Todo } from '../../core/types';

// Offline-first Trello client. Every call has a 2 s timeout and returns
// null / swallows on ANY failure — callers treat that as "offline, stay local".
export interface TrelloConfig {
  key: string;
  token: string;
  listId: string;
}

const BASE = 'https://api.trello.com/1';
const TIMEOUT = 2000;

function auth(cfg: TrelloConfig): string {
  return `key=${encodeURIComponent(cfg.key)}&token=${encodeURIComponent(cfg.token)}`;
}

interface TrelloLabel {
  name?: string;
}
interface TrelloCard {
  id: string;
  name: string;
  desc?: string;
  shortUrl?: string;
  labels?: TrelloLabel[];
}

function priorityFromLabels(labels: TrelloLabel[] | undefined): Priority {
  for (const l of labels ?? []) {
    const n = (l.name ?? '').toLowerCase();
    if (n.includes('high')) return 'high';
    if (n.includes('low')) return 'low';
  }
  return 'med';
}

// Pull open cards from the configured list → Todo[]. null on any failure.
export async function trelloPull(cfg: TrelloConfig): Promise<Todo[] | null> {
  try {
    const res = await fetch(`${BASE}/lists/${cfg.listId}/cards?filter=open&${auth(cfg)}`, {
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return null;
    const cards = (await res.json()) as TrelloCard[];
    return cards.map((c) => ({
      id: crypto.randomUUID(),
      text: c.name,
      done: false,
      priority: priorityFromLabels(c.labels),
      createdAt: Date.now(),
      desc: c.desc || undefined,
      link: c.shortUrl || undefined,
      trelloCardId: c.id,
    }));
  } catch {
    return null;
  }
}

// Create a card, returning its id. null on any failure.
export async function trelloCreate(cfg: TrelloConfig, todo: Todo): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/cards?${auth(cfg)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idList: cfg.listId, name: todo.text, desc: todo.desc ?? '' }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return null;
    const card = (await res.json()) as { id: string };
    return card.id ?? null;
  } catch {
    return null;
  }
}

// Archive (check off) a card. Failures are swallowed.
export async function trelloClose(cfg: TrelloConfig, cardId: string): Promise<void> {
  try {
    await fetch(`${BASE}/cards/${cardId}?closed=true&${auth(cfg)}`, {
      method: 'PUT',
      signal: AbortSignal.timeout(TIMEOUT),
    });
  } catch {
    /* offline: local copy already updated */
  }
}

// Delete a card. Failures are swallowed.
export async function trelloDelete(cfg: TrelloConfig, cardId: string): Promise<void> {
  try {
    await fetch(`${BASE}/cards/${cardId}?${auth(cfg)}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(TIMEOUT),
    });
  } catch {
    /* offline: local copy already removed */
  }
}
