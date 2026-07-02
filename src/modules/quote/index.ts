import './quote.css';
import type { DashboardModule, ModuleContext, Quote, QuoteCategory } from '../../core/types';
import { h, animateOut } from '../../core/dom';
import { quoteToday, quoteRandom } from './zenquotes';
import bundled from './quotes.json';

const QUOTES = bundled as Quote[];
const DAY = 86_400_000;

let ctx: ModuleContext;
let host: HTMLElement;
let current: Quote | null = null; // quote on screen
let nextBuf: Quote | null = null; // one quote prefetched so cycling is instant
let prefetching = false;
let todayQuote: Quote | null = null; // cached day quote → instant re-open
let todayTried = false; // day fetch attempted (null result = failed → fallback)
let animateNext = false; // play enter animation on the next card build (open, not cycle)

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
  if (animateNext) {
    card.classList.add('ui-enter');
    animateNext = false;
  }
  card.appendChild(
    h('button', { class: 'quote-next', title: 'New quote', 'aria-label': 'New quote', onClick: cycle }, '↻'),
  );
  card.appendChild(h('blockquote', { class: 'quote-text' }, `“${q.text}”`));
  const foot = h('div', { class: 'quote-foot' }, h('span', { class: 'quote-author' }, `— ${q.author}`));
  if (q.category) foot.appendChild(h('span', { class: 'quote-cat' }, q.category));
  card.appendChild(foot);
  paint(card);
}

// Bottom pull-tab: closed → tiny handle; open → chevron to hide.
function quoteTab(): HTMLElement {
  const open = ctx.settings.ui.quoteOpen;
  return h(
    'button',
    {
      class: 'quote-tab' + (open ? ' open' : ''),
      title: open ? 'Hide quote' : 'Show quote',
      'aria-label': open ? 'Hide quote' : 'Show quote',
      onClick: toggleOpen,
    },
    chevron(open ? 'down' : 'up'),
  );
}

// Inline-SVG chevron so the tab arrow is pixel-centered (glyph metrics aren't).
function chevron(dir: 'up' | 'down'): HTMLElement {
  const path = dir === 'up' ? 'M5 14l7-7 7 7' : 'M5 10l7 7 7-7';
  const span = document.createElement('span');
  span.className = 'quote-chevron';
  span.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
  return span;
}
function toggleOpen(): void {
  ctx.saveSettings({ ui: { quoteOpen: !ctx.settings.ui.quoteOpen } });
}
// Keep the tab present; `inner` is the card (or null when closed / empty).
function paint(inner: HTMLElement | null): void {
  const kids = inner ? [inner, quoteTab()] : [quoteTab()];
  host.replaceChildren(...kids);
}

// Bundled deterministic daily pick, filtered by the enabled categories.
function renderFallback(): void {
  const cats = ctx.settings.quote.categories;
  const pool = QUOTES.filter((q) => q.category && cats.includes(q.category as QuoteCategory));
  if (!pool.length) {
    paint(null); // nothing selected → tab only
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
    // Re-render only when quote visibility toggles (open/enabled), not on every
    // unrelated settings save.
    let lastSig = `${c.settings.quote.enabled}|${c.settings.ui.quoteOpen}`;
    let lastOpen = c.settings.ui.quoteOpen;
    c.bus.on('settings-changed', () => {
      const sig = `${c.settings.quote.enabled}|${c.settings.ui.quoteOpen}`;
      if (sig === lastSig || !host) return;
      lastSig = sig;
      const wasOpen = lastOpen;
      lastOpen = c.settings.ui.quoteOpen;
      if (wasOpen && !c.settings.ui.quoteOpen) {
        const card = host.querySelector<HTMLElement>('.quote.card');
        if (card) {
          animateOut(card, renderShell); // fade the card out, then show just the tab
          return;
        }
      }
      if (!wasOpen && c.settings.ui.quoteOpen) animateNext = true;
      renderShell();
    });
  },

  render(el) {
    host = el;
    warmToday(); // fetch the day quote up front so opening is instant
    renderShell();
  },
};

// Fetch (once) and cache the day quote in the background, even while closed, so
// re-opening the tab never waits on the network.
function warmToday(): void {
  if (todayTried || !ctx.settings.quote.enabled || !ctx.settings.quote.api) return;
  todayTried = true;
  quoteToday().then((q) => {
    todayQuote = q;
    if (host && ctx.settings.ui.quoteOpen) renderShell(); // fill skeleton if open
  });
  prefetch(); // warm the cycle buffer too
}

// Draws the dock: enabled? → tab (+ card when open). Uses the cached day quote.
function renderShell(): void {
  if (!ctx.settings.quote.enabled) {
    host.replaceChildren();
    return;
  }
  if (!ctx.settings.ui.quoteOpen) {
    paint(null); // tab only
    return;
  }
  if (ctx.settings.quote.api) {
    if (todayQuote) renderQuote(todayQuote); // cached → instant
    else if (todayTried) renderFallback(); // fetch already failed → bundled
    else {
      paint(skeleton()); // fetch still in flight; warmToday() will refill
      warmToday();
    }
  } else {
    renderFallback();
  }
}
