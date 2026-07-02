import './quote.css';
import type { DashboardModule, ModuleContext, Quote, QuoteCategory } from '../../core/types';
import { h } from '../../core/dom';
import { quoteToday, quoteRandom } from './zenquotes';
import bundled from './quotes.json';

const QUOTES = bundled as Quote[];
const DAY = 86_400_000;

let ctx: ModuleContext;
let host: HTMLElement;
let current: Quote | null = null; // quote on screen
let nextBuf: Quote | null = null; // one quote prefetched so cycling is instant
let prefetching = false;

// Local-day index so the bundled pick is stable within the user's calendar day.
function localDayNumber(): number {
  const offset = new Date().getTimezoneOffset() * 60_000;
  return Math.floor((Date.now() - offset) / DAY);
}

// Bundled pool filtered by the enabled categories; falls back to all quotes so
// cycling always has material even when no category is selected.
function bundledPool(): Quote[] {
  const cats = ctx.settings.quote.categories;
  const filtered = QUOTES.filter((q) => q.category && cats.includes(q.category as QuoteCategory));
  return filtered.length ? filtered : QUOTES;
}

function bundledRandom(): Quote {
  const pool = bundledPool();
  if (pool.length < 2) return pool[0];
  let q: Quote;
  do {
    q = pool[Math.floor(Math.random() * pool.length)];
  } while (q.text === current?.text); // avoid repeating the on-screen quote
  return q;
}

// A fresh quote for cycling: random online when enabled, else bundled random.
async function getNext(): Promise<Quote> {
  if (ctx.settings.quote.api) {
    const r = await quoteRandom();
    if (r && r.text !== current?.text) return r;
  }
  return bundledRandom();
}

// Keep one quote buffered so the next arrow-click is instant.
async function prefetch(): Promise<void> {
  if (nextBuf || prefetching) return;
  prefetching = true;
  try {
    nextBuf = await getNext();
  } finally {
    prefetching = false;
  }
}

function cycle(): void {
  if (nextBuf) {
    const q = nextBuf;
    nextBuf = null;
    renderQuote(q);
    prefetch(); // refill in the background
  } else {
    // buffer not ready yet (first cycle raced the prefetch) — fetch, then refill
    getNext().then((q) => {
      renderQuote(q);
      prefetch();
    });
  }
}

function skeleton(): HTMLElement {
  return h(
    'div',
    { class: 'card quote' },
    h('div', { class: 'quote-skeleton' }, h('span', {}), h('span', {}), h('span', {})),
  );
}

function renderQuote(q: Quote): void {
  current = q;
  const card = h('div', { class: 'card quote' });
  card.appendChild(
    h('button', { class: 'quote-next', title: 'New quote', 'aria-label': 'New quote', onClick: cycle }, '↻'),
  );
  card.appendChild(h('blockquote', { class: 'quote-text' }, `“${q.text}”`));
  const foot = h('div', { class: 'quote-foot' }, h('span', { class: 'quote-author' }, `— ${q.author}`));
  if (q.category) foot.appendChild(h('span', { class: 'quote-cat' }, q.category));
  card.appendChild(foot);
  host.replaceChildren(card);
}

// Bundled deterministic daily pick, filtered by the enabled categories.
function renderFallback(): void {
  const cats = ctx.settings.quote.categories;
  const pool = QUOTES.filter((q) => q.category && cats.includes(q.category as QuoteCategory));
  if (!pool.length) {
    host.replaceChildren(); // nothing selected → hide the card
    return;
  }
  renderQuote(pool[localDayNumber() % pool.length]);
}

export const quote: DashboardModule = {
  id: 'quote',
  slot: 'main',
  order: 20,
  settingsSchema: [
    { key: 'quote.enabled', label: 'Show quote', type: 'toggle' },
    { key: 'quote.api', label: 'Fetch daily quote online', type: 'toggle' },
    { key: 'quote.categories:philosophy', label: 'Philosophy (offline)', type: 'toggle' },
    { key: 'quote.categories:self-help', label: 'Self-help (offline)', type: 'toggle' },
    { key: 'quote.categories:morality', label: 'Morality (offline)', type: 'toggle' },
  ],

  init(c) {
    ctx = c;
  },

  render(el) {
    host = el;
    current = null;
    nextBuf = null;
    if (!ctx.settings.quote.enabled) return; // skip render entirely

    if (ctx.settings.quote.api) {
      host.replaceChildren(skeleton()); // never block paint
      quoteToday().then((q) => {
        if (q) renderQuote(q);
        else renderFallback(); // API failed → bundled daily pick
      });
    } else {
      renderFallback();
    }
    prefetch(); // warm the buffer so the first cycle is instant
  },
};
