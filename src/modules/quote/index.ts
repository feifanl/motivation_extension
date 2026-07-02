import './quote.css';
import type { DashboardModule, ModuleContext, Quote, QuoteCategory } from '../../core/types';
import { h } from '../../core/dom';
import { quoteToday } from './zenquotes';
import bundled from './quotes.json';

const QUOTES = bundled as Quote[];
const DAY = 86_400_000;

let ctx: ModuleContext;
let host: HTMLElement;

// Local-day index so the bundled pick is stable within the user's calendar day.
function localDayNumber(): number {
  const offset = new Date().getTimezoneOffset() * 60_000;
  return Math.floor((Date.now() - offset) / DAY);
}

function skeleton(): HTMLElement {
  return h(
    'div',
    { class: 'card quote' },
    h('div', { class: 'quote-skeleton' }, h('span', {}), h('span', {}), h('span', {})),
  );
}

function renderQuote(q: Quote, offline: boolean): void {
  const card = h('div', { class: 'card quote' });
  if (offline) {
    card.appendChild(h('span', { class: 'quote-sync', title: 'Offline — bundled quote' }));
  }
  card.appendChild(h('blockquote', { class: 'quote-text' }, `“${q.text}”`));
  const foot = h('div', { class: 'quote-foot' }, h('span', { class: 'quote-author' }, `— ${q.author}`));
  if (q.category) foot.appendChild(h('span', { class: 'quote-cat' }, q.category));
  card.appendChild(foot);
  host.replaceChildren(card);
}

// Bundled deterministic daily pick, filtered by the enabled categories.
function renderFallback(offline: boolean): void {
  const cats = ctx.settings.quote.categories;
  const pool = QUOTES.filter((q) => q.category && cats.includes(q.category as QuoteCategory));
  if (!pool.length) {
    host.replaceChildren(); // nothing selected → hide the card
    return;
  }
  renderQuote(pool[localDayNumber() % pool.length], offline);
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
    if (!ctx.settings.quote.enabled) return; // skip render entirely

    if (ctx.settings.quote.api) {
      host.replaceChildren(skeleton()); // never block paint
      quoteToday().then((q) => {
        if (q) renderQuote(q, false);
        else renderFallback(true); // API failed → bundled, offline dot
      });
    } else {
      renderFallback(false);
    }
  },
};
