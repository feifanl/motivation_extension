import type { Quote } from '../../core/types';

// ZenQuotes "quote of the day" — same all day, so the daily-deterministic
// guarantee holds with no local date math. null on ANY failure → caller uses
// the bundled fallback. Needs the https://zenquotes.io/* host permission.
export async function quoteToday(): Promise<Quote | null> {
  try {
    const res = await fetch('https://zenquotes.io/api/today', {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ q?: string; a?: string }>;
    const first = data?.[0];
    if (!first?.q) return null;
    return { text: first.q, author: first.a ?? 'Unknown' };
  } catch {
    return null;
  }
}
