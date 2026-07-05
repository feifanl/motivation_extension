// Single source of truth for types. No logic.

// ---------- Utility ----------
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// ---------- Storage ----------
export interface TypedStorage {
  get<T>(key: string, fallback: T): Promise<T>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

// ---------- Event bus ----------
export type BusEvent = 'settings-changed' | 'open-settings' | 'open-notes-board';

export interface EventBus {
  on(event: BusEvent, cb: (payload?: unknown) => void): () => void;
  emit(event: BusEvent, payload?: unknown): void;
}

// ---------- Module contract ----------
export type Slot = 'background' | 'main' | 'sidebar' | 'corner' | 'overlay';

export interface ModuleContext {
  settings: Settings; // live snapshot
  saveSettings(patch: DeepPartial<Settings>): Promise<void>;
  storage: TypedStorage; // from core/storage.ts
  bus: EventBus; // from core/events.ts
}

export interface SettingsField {
  key: string; // dot-path inside Settings, e.g. "lifeclock.birthday"
  label: string;
  type: 'text' | 'date' | 'number' | 'select' | 'toggle' | 'textarea' | 'file' | 'color' | 'list' | 'pins';
  options?: { value: string; label: string }[]; // for select
  min?: number;
  max?: number; // for number
  step?: number; // for number
  placeholder?: string;
  help?: string;
  itemFields?: SettingsField[]; // for 'list': schema of one row; value is an array of objects
  newItem?: () => Record<string, unknown>; // for 'list': factory for a new row (e.g. id/index defaults)
  parse?: (raw: string) => unknown; // textarea/text: string → stored value (e.g. lines → Pin[])
  format?: (val: unknown) => string; // textarea/text: stored value → string for display
  showIf?: (settings: Settings) => boolean; // hide field unless predicate holds
}

export interface DashboardModule {
  id: string; // unique, kebab-case
  slot: Slot;
  order: number; // mount order within slot (ascending)
  init(ctx: ModuleContext): void | Promise<void>; // MUST NOT await network
  render(el: HTMLElement): void; // synchronous DOM build
  destroy?(): void;
  settingsSchema: SettingsField[]; // [] if none
}

// ---------- Settings (single typed schema, root storage key "settings") ----------
export type LifeView = 'day' | 'week' | 'month' | 'year' | 'decade' | 'life';
export type SearchEngine = 'google' | 'duckduckgo' | 'brave' | 'bing';

export interface Settings {
  version: 1; // migration guard
  theme: 'dark' | 'light';
  lifeclock: {
    birthday: string | null; // "YYYY-MM-DD"
    lifeExpectancyYears: number; // default 80
    defaultView: LifeView; // default "month"
  };
  wallpaper: {
    mode: 'color' | 'url' | 'upload';
    color: string; // default "#0d1117"
    url: string; // remote image URL, mode "url"
    dim: number; // 0–0.8 overlay dim, default 0.35
  };
  todo: {
    trelloEnabled: boolean;
    trelloKey: string;
    trelloToken: string;
    trelloListId: string;
  };
  quote: {
    enabled: boolean;
    api: boolean; // fetch ZenQuotes online; false = bundled only
    categories: QuoteCategory[]; // filters the offline fallback pool; default all three
  };
  pins: {
    enabled: boolean;
    boards: PinBoard[]; // user-created, named boards (e.g. "hopecore", "grimy")
    mode: 'board' | 'all'; // 'board' = show one active board; 'all' = pool every pin across boards
    activeBoardId: string | null; // board mode: which board shows; null → boards[0]
    boardRotation: PinRotation; // board mode: auto-advance WHICH board is active ('off' = manual/keybind only)
    boardIntervalMinutes?: number; // used iff boardRotation === 'interval'
    allRotation: PinRotation; // all mode: how the pooled pins rotate
    allIntervalMinutes?: number; // used iff allRotation === 'interval'
    allIndex: number; // all mode: current pin in the pooled list (manual cursor)
    screenRotation: PinScreenRotation; // cycle which pins fill the wall when the pool overflows; 'scroll' = panorama
    screenIntervalMinutes?: number; // used iff screenRotation === 'interval'
    screenScrollSeconds?: number; // seconds between column slides, iff screenRotation === 'scroll'
  };
  notes: {
    enabled: boolean;
  };
  search: {
    enabled: boolean;
    engine: SearchEngine;
  };
  ui: {
    quoteOpen: boolean; // quote card pulled up from its bottom tab
    todoHidden: boolean; // todo sidebar collapsed to a handle
    clockMinimized: boolean; // life clock collapsed to a compact pill
    pinsBoardsOpen: boolean; // board switcher expanded from its top-right tab
    glass: boolean; // liquid-glass surfaces (false = flat opaque)
  };
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  theme: 'dark',
  lifeclock: { birthday: null, lifeExpectancyYears: 80, defaultView: 'month' },
  wallpaper: { mode: 'color', color: '#0d1117', url: '', dim: 0.35 },
  todo: { trelloEnabled: false, trelloKey: '', trelloToken: '', trelloListId: '' },
  quote: { enabled: true, api: true, categories: ['philosophy', 'self-help', 'morality'] },
  pins: {
    enabled: false,
    boards: [],
    mode: 'board',
    activeBoardId: null,
    boardRotation: 'off',
    allRotation: 'daily',
    allIndex: 0,
    screenRotation: 'off',
    screenScrollSeconds: 100,
  },
  notes: { enabled: true },
  search: { enabled: true, engine: 'google' },
  ui: { quoteOpen: false, todoHidden: false, clockMinimized: false, pinsBoardsOpen: false, glass: true },
};

// ---------- Todo (root storage key "todos") ----------
export type Priority = 'high' | 'med' | 'low';

export interface Todo {
  id: string; // crypto.randomUUID()
  text: string;
  done: boolean;
  priority: Priority; // default "med"
  createdAt: number; // epoch ms
  desc?: string; // free-text description (Trello-style)
  link?: string; // single URL, opened in a new tab
  trelloCardId?: string; // present iff synced
}

export interface TodoState {
  items: Todo[];
}

// ---------- Quote (bundled quotes.json entries) ----------
export type QuoteCategory = 'philosophy' | 'self-help' | 'morality';

export interface Quote {
  text: string;
  author: string;
  category?: QuoteCategory; // absent for API-sourced quotes (ZenQuotes has no category)
}

// ---------- Pins ----------
export interface Pin {
  imageUrl: string;
  linkUrl?: string; // open on click; defaults to imageUrl
}

export type PinRotation = 'off' | 'daily' | 'interval';
// Screen rotation adds a 'scroll' panorama mode (slide one column at a time).
export type PinScreenRotation = PinRotation | 'scroll';

export interface PinBoard {
  id: string; // crypto.randomUUID()
  name: string;
  pins: Pin[];
  rotation: PinRotation; // 'off' = static/manual only
  intervalMinutes?: number; // used iff rotation === 'interval' (e.g. 60, 240)
  index: number; // current pin shown (also the manual cursor)
}

// ---------- Notes (root storage key "notes") ----------
export type NoteColor = 'green' | 'yellow' | 'blue' | 'red' | 'gray';

export interface StickyNote {
  id: string;
  text: string; // ≤ 500 chars
  color: NoteColor;
  createdAt: number;
}
