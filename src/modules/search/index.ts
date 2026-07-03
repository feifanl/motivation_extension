import './search.css';
import type { DashboardModule, ModuleContext, SearchEngine, SettingsField } from '../../core/types';
import { h } from '../../core/dom';

const ENGINES: Record<SearchEngine, { label: string; url: string }> = {
  google: { label: 'Google', url: 'https://www.google.com/search?q=' },
  duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  brave: { label: 'Brave', url: 'https://search.brave.com/search?q=' },
  bing: { label: 'Bing', url: 'https://www.bing.com/search?q=' },
};

let ctx: ModuleContext;
let host: HTMLElement;
let unsub: (() => void) | undefined;

function submit(query: string): void {
  const q = query.trim();
  if (!q) return;
  const engine = ENGINES[ctx.settings.search.engine] ?? ENGINES.google;
  window.location.assign(engine.url + encodeURIComponent(q));
}

function render(): void {
  if (!ctx.settings.search.enabled) {
    host.replaceChildren();
    return;
  }
  const input = h('input', {
    class: 'search-input',
    type: 'text',
    placeholder: `Search ${ENGINES[ctx.settings.search.engine]?.label ?? 'the web'}…`,
    'aria-label': 'Search the web',
    autocomplete: 'off',
    spellcheck: 'false',
  }) as HTMLInputElement;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit(input.value);
  });
  host.replaceChildren(h('div', { class: 'search-bar' }, input));
  // Focus the bar so a fresh tab is type-ready; module keybinds already ignore
  // events while a text field is focused.
  requestAnimationFrame(() => input.focus());
}

const schema: SettingsField[] = [
  { key: 'search.enabled', label: 'Show search bar', type: 'toggle' },
  {
    key: 'search.engine',
    label: 'Search engine',
    type: 'select',
    options: (Object.keys(ENGINES) as SearchEngine[]).map((k) => ({ value: k, label: ENGINES[k].label })),
  },
];

export const search: DashboardModule = {
  id: 'search',
  slot: 'main',
  order: 5, // above the life clock (order 10)
  settingsSchema: schema,

  init(c) {
    ctx = c;
    unsub = c.bus.on('settings-changed', () => {
      if (host) render();
    });
  },

  render(el) {
    host = el;
    render();
  },

  destroy() {
    if (unsub) unsub();
  },
};
