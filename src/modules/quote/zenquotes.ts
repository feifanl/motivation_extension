import type { Quote } from '../../core/types';

// ZenQuotes "quote of the day" — same all day, so the daily-deterministic
// guarantee holds with no local date math. null on ANY failure → caller uses
// the bundled fallback. Needs the https://zenquotes.io/* host permission.
export async function quoteToday(): Promise<Quote | null> {
  return fetchOne('https://zenquotes.io/api/today');
}

// A fresh random quote — used when the user cycles. null on any failure →
// caller falls back to a bundled quote.
export async function quoteRandom(): Promise<Quote | null> {
  return fetchOne('https://zenquotes.io/api/random');
}

async function fetchOne(url: string): Promise<Quote | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ q?: string; a?: string }>;
    const first = data?.[0];
    if (!first?.q) return null;
    return { text: first.q, author: first.a ?? 'Unknown' };
  } catch {
    return null;
  }
}
