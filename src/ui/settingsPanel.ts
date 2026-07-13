import './settingsPanel.css';
import { modules } from '../modules';
import { getByPath, setByPath } from '../core/settings';
import { h } from '../core/dom';
import { fileToDataUrl } from '../modules/wallpaper/image';
import type { DeepPartial, ModuleContext, Pin, Settings, SettingsField } from '../core/types';

const PIN_EDGE = 1200; // downscale dropped/pasted images to bound storage

// Pull image URLs out of pasted/dropped text (one per line or whitespace).
function parseUrls(text: string): string[] {
  return text
    .split(/[\s\n]+/)
    .map((s) => s.trim())
    .filter((s) => /^(https?:|data:image\/)/i.test(s));
}

async function filesToPins(files: FileList | File[] | null | undefined): Promise<Pin[]> {
  const out: Pin[] = [];
  for (const f of Array.from(files ?? [])) {
    if (!f.type.startsWith('image/')) continue;
    try {
      out.push({ imageUrl: await fileToDataUrl(f, PIN_EDGE) });
    } catch {
      /* skip a file that's too big or unreadable */
    }
  }
  return out;
}

// Visual board editor: thumbnail grid (× to remove), drop image files, paste an
// image or URL, or add URLs by hand. Writes the whole Pin[] back via onChange.
function pinEditor(value: Pin[], onChange: (pins: Pin[]) => void): HTMLElement {
  const pins = value ?? [];
  let dragFrom = -1; // thumbnail drag-to-reorder source index
  const grid = h(
    'div',
    { class: 'pin-edit-grid' },
    ...pins.map((p, i) => {
      const thumb = h(
        'div',
        { class: 'pin-edit-thumb', title: 'Drag to reorder' },
        h('img', { src: p.imageUrl, alt: '', loading: 'lazy' }),
        h(
          'button',
          { class: 'pin-edit-del', title: 'Remove', onClick: () => onChange(pins.filter((_, j) => j !== i)) },
          '×',
        ),
      );
      thumb.draggable = true;
      thumb.addEventListener('dragstart', () => {
        dragFrom = i;
      });
      thumb.addEventListener('dragover', (e) => e.preventDefault());
      thumb.addEventListener('drop', (e) => {
        e.preventDefault();
        if (dragFrom < 0 || dragFrom === i) return;
        const next = pins.slice();
        const [moved] = next.splice(dragFrom, 1);
        next.splice(i, 0, moved);
        onChange(next);
      });
      return thumb;
    }),
    pins.length ? null : h('span', { class: 'pin-edit-empty' }, 'No pins yet'),
  );

  const urls = h('textarea', {
    class: 'pin-edit-urls',
    rows: 3,
    placeholder:
      'Paste image URLs (one per line), or drop / paste an image anywhere in this box.\n\nOr right-click any image on the web → “Add image to pins board”.',
  }) as HTMLTextAreaElement;
  const addBtn = h(
    'button',
    {
      class: 'primary',
      onClick: () => {
        const found = parseUrls(urls.value);
        if (found.length) onChange([...pins, ...found.map((u) => ({ imageUrl: u }))]);
      },
    },
    'Add URLs',
  );

  const box = h(
    'div',
    { class: 'pin-edit' },
    grid,
    h('div', { class: 'pin-edit-row' }, urls, addBtn),
    h(
      'p',
      { class: 'pin-edit-hint' },
      'Tip: browsing the web, right-click any image and choose “Add image to pins board” to save it straight here.',
    ),
  );

  box.addEventListener('dragover', (e) => {
    e.preventDefault();
    box.classList.add('drag');
  });
  box.addEventListener('dragleave', () => box.classList.remove('drag'));
  box.addEventListener('drop', async (e) => {
    e.preventDefault();
    box.classList.remove('drag');
    const dropped = await filesToPins(e.dataTransfer?.files);
    const dragged = parseUrls(e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text') || '');
    const added = [...dragged.map((u) => ({ imageUrl: u })), ...dropped];
    if (added.length) onChange([...pins, ...added]);
  });
  urls.addEventListener('paste', async (e) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const files = items.filter((it) => it.kind === 'file').map((it) => it.getAsFile());
    const fromFiles = await filesToPins(files.filter((f): f is File => !!f));
    if (fromFiles.length) {
      e.preventDefault(); // consumed the image; don't also drop a blob URL into the box
      onChange([...pins, ...fromFiles]);
    }
  });

  return box;
}

// Modules register a file handler for their type:'file' field (keyed by field.key).
const fileHandlers = new Map<string, (file: File) => void | Promise<void>>();
export function registerFileHandler(key: string, fn: (file: File) => void | Promise<void>): void {
  fileHandlers.set(key, fn);
}

function prettify(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ');
}

export function mountSettingsPanel(ctx: ModuleContext): void {
  const corner = document.querySelector<HTMLElement>('.slot-corner');
  if (!corner) return;

  let activeTab = ''; // which tab's section shows; render() defaults to the first tab
  const collapsedRows = new Set<string>(); // list rows folded shut (keyed by row id/index)

  const gear = h('button', { class: 'settings-gear', title: 'Settings', 'aria-label': 'Settings' }, '⚙');
  const backdrop = h('div', { class: 'settings-backdrop' });
  const body = h('div', { class: 'settings-body' });
  const tabsEl = h('div', { class: 'settings-tabs' });
  const themeBtn = h('button', {
    class: 'settings-theme',
    title: 'Toggle theme',
    'aria-label': 'Toggle theme',
    onClick: () => {
      const next = ctx.settings.theme === 'dark' ? 'light' : 'dark';
      ctx.saveSettings({ theme: next }).then(syncThemeBtn);
    },
  });
  const glassBtn = h('button', {
    class: 'settings-glass',
    title: 'Toggle liquid glass',
    'aria-label': 'Toggle liquid glass',
    onClick: () => {
      ctx.saveSettings({ ui: { glass: !ctx.settings.ui.glass } }).then(syncGlassBtn);
    },
  });
  // A diagonally rain-streaked glass pane, its bottom edge submerged below a
  // wavy water surface.
  glassBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="4.5" y="2" width="15" height="16" rx="1.5"/>
    <g stroke-width="1" opacity=".85">
      <!-- top-left pair (same angle); the second (right) streak is broken -->
      <line x1="6.6" y1="3.4" x2="7.88" y2="6.6"/>
      <line x1="8.3" y1="3.4" x2="8.9" y2="4.9"/>
      <line x1="9.1" y1="5.4" x2="9.58" y2="6.6"/>
      <!-- bottom-right pair; the first (higher) streak is broken -->
      <line x1="14.6" y1="8.8" x2="15.2" y2="10.3"/>
      <line x1="15.4" y1="10.8" x2="15.88" y2="12"/>
      <line x1="16.3" y1="9" x2="17.58" y2="12.2"/>
    </g>
    <path d="M2 15q2-1.6 4 0t4 0 4 0 4 0 4 0"/>
  </svg>`;
  const panel = h(
    'div',
    { class: 'settings-panel' },
    h(
      'div',
      { class: 'settings-head' },
      h('span', { class: 'settings-title' }, 'Settings'),
      h('div', { class: 'settings-head-actions' }, glassBtn, themeBtn, h('button', { class: 'settings-close', title: 'Close', onClick: close }, '✕')),
    ),
    tabsEl,
    body,
  );

  corner.appendChild(gear);
  // Live inside the zoom root so the drawer scales with the rest of the
  // dashboard (matching --z) instead of floating full-size over a zoomed page.
  (document.querySelector('.zoom-root') ?? document.body).append(backdrop, panel);

  function syncThemeBtn(): void {
    const dark = ctx.settings.theme === 'dark';
    themeBtn.textContent = dark ? '☾' : '☀';
    themeBtn.title = dark ? 'Switch to light' : 'Switch to dark';
  }

  function syncGlassBtn(): void {
    const on = ctx.settings.ui.glass;
    glassBtn.classList.toggle('active', on);
    glassBtn.title = on ? 'Liquid glass: on' : 'Liquid glass: off';
  }

  function open(tab?: string): void {
    // A module can request its own tab (e.g. life clock's "Set birthday").
    if (tab && tabList().some((t) => t.id === tab)) activeTab = tab;
    render();
    backdrop.classList.add('open');
    panel.classList.add('open');
  }
  function close(): void {
    backdrop.classList.remove('open');
    panel.classList.remove('open');
  }

  gear.addEventListener('click', () => open());
  backdrop.addEventListener('click', close);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('open')) close();
  });
  ctx.bus.on('open-settings', (payload) => open(typeof payload === 'string' ? payload : undefined));

  // ---- persistence ----
  // rerender=false keeps the focused input alive (scalar text/date/number edits);
  // structural changes (list rows, toggles/selects that drive showIf) rebuild.
  function save(key: string, value: unknown, rerender = false): void {
    const patch = setByPath({} as Record<string, unknown>, key, value) as DeepPartial<Settings>;
    const p = ctx.saveSettings(patch);
    if (rerender) p.then(render);
  }
  function saveArray(key: string, arr: unknown[]): void {
    save(key, arr, true);
  }

  // ---- rendering ----
  // One tab per settings group; body shows only the active tab's section.
  interface Tab {
    id: string;
    label: string;
  }

  function tabList(): Tab[] {
    const tabs: Tab[] = [];
    for (const mod of modules) {
      if (mod.settingsSchema.length) tabs.push({ id: mod.id, label: prettify(mod.id) });
    }
    return tabs;
  }

  function render(): void {
    syncThemeBtn();
    syncGlassBtn();

    const tabs = tabList();
    if (tabs.length && !tabs.some((t) => t.id === activeTab)) activeTab = tabs[0].id;

    tabsEl.replaceChildren(
      ...tabs.map((t) =>
        h(
          'button',
          {
            class: 'settings-tab' + (t.id === activeTab ? ' active' : ''),
            onClick: () => {
              activeTab = t.id;
              render();
            },
          },
          t.label,
        ),
      ),
    );

    body.replaceChildren();
    const mod = modules.find((m) => m.id === activeTab);
    if (!mod) return;
    const rows = mod.settingsSchema
      .filter((f) => !f.showIf || f.showIf(ctx.settings))
      .map(renderField)
      .filter((el): el is HTMLElement => el !== null);
    body.appendChild(section(prettify(mod.id), rows));
  }

  function section(title: string, rows: HTMLElement[]): HTMLElement {
    return h('section', { class: 'settings-section' }, h('h3', {}, title), ...rows);
  }

  function renderField(field: SettingsField): HTMLElement | null {
    if (field.showIf && !field.showIf(ctx.settings)) return null;

    // Array-membership toggle: key "base:member" toggles member in array at base.
    if (field.type === 'toggle' && field.key.includes(':')) {
      const [base, member] = field.key.split(':');
      const arr = (getByPath(ctx.settings, base) as string[]) ?? [];
      const checked = arr.includes(member);
      return fieldWrap(
        field,
        h('input', {
          type: 'checkbox',
          checked,
          onChange: (e: Event) => {
            const on = (e.target as HTMLInputElement).checked;
            const next = on ? [...arr, member] : arr.filter((x) => x !== member);
            save(base, next, true);
          },
        }),
        true,
      );
    }

    if (field.type === 'list') return renderList(field);

    if (field.type === 'file') {
      const err = h('p', { class: 'field-error' });
      const input = h('input', {
        type: 'file',
        accept: 'image/*',
        onChange: (e: Event) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          const handler = fileHandlers.get(field.key);
          err.textContent = '';
          if (file && handler) {
            Promise.resolve(handler(file)).catch((er) => {
              err.textContent = er?.message ?? 'Upload failed.';
            });
          }
        },
      });
      const wrap = fieldWrap(field, input);
      wrap.appendChild(err);
      return wrap;
    }

    const cur = getByPath(ctx.settings, field.key);
    // Toggles/selects can drive showIf on sibling fields → rebuild; scalar edits keep focus.
    const rerender = field.type === 'toggle' || field.type === 'select';
    const control = controlFor(field, cur, (v) => save(field.key, v, rerender));
    return fieldWrap(field, control, field.type === 'toggle');
  }

  function renderList(field: SettingsField): HTMLElement {
    const arr = ((getByPath(ctx.settings, field.key) as Record<string, unknown>[]) ?? []).slice();
    const itemFields = field.itemFields ?? [];
    // Title shown on a collapsed row: the first text field's value (e.g. a board's name).
    const titleKey = itemFields.find((f) => f.type === 'text')?.key;

    const rowsEl = arr.map((row, i) => {
      const rid = String(row.id ?? `${field.key}:${i}`);
      const folded = collapsedRows.has(rid);
      const title =
        (titleKey ? String(row[titleKey] ?? '').trim() : '') || `${field.itemLabel ?? field.label} ${i + 1}`;

      const fields = itemFields.map((sf) =>
        fieldWrap(
          sf,
          controlFor(sf, row[sf.key], (v) => {
            const next = arr.slice();
            next[i] = { ...row, [sf.key]: v };
            saveArray(field.key, next);
          }),
          sf.type === 'toggle',
        ),
      );

      const head = h(
        'div',
        { class: 'list-row-head' },
        h(
          'button',
          {
            class: 'list-row-toggle',
            'aria-expanded': String(!folded),
            onClick: () => {
              if (folded) collapsedRows.delete(rid);
              else collapsedRows.add(rid);
              render();
            },
          },
          h('span', { class: 'list-caret' + (folded ? ' folded' : '') }, '▾'),
          h('span', { class: 'list-row-title' }, title),
        ),
        h(
          'button',
          {
            class: 'list-remove',
            onClick: () => {
              collapsedRows.delete(rid);
              saveArray(field.key, arr.filter((_, j) => j !== i));
            },
          },
          'Remove',
        ),
      );

      return h(
        'div',
        { class: 'list-row' + (folded ? ' collapsed' : '') },
        head,
        folded ? null : h('div', { class: 'list-row-body' }, ...fields),
      );
    });

    const addBtn = h(
      'button',
      {
        class: 'list-add',
        onClick: () => {
          const row = field.newItem ? field.newItem() : defaultRow(itemFields);
          saveArray(field.key, [...arr, row]);
        },
      },
      '+ Add',
    );

    return h(
      'div',
      { class: 'settings-list' },
      h('label', { class: 'field-label' }, field.label),
      field.help ? h('p', { class: 'field-help' }, field.help) : null,
      ...rowsEl,
      addBtn,
    );
  }

  function defaultRow(itemFields: SettingsField[]): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    for (const f of itemFields) {
      row[f.key] =
        f.type === 'number'
          ? (f.min ?? 0)
          : f.type === 'toggle'
            ? false
            : Array.isArray(f.options)
              ? f.options[0]?.value
              : '';
    }
    return row;
  }

  // Builds one input bound to `value`, calling onChange with the parsed value.
  function controlFor(
    field: SettingsField,
    value: unknown,
    onChange: (v: unknown) => void,
  ): HTMLElement {
    switch (field.type) {
      case 'pins':
        return pinEditor((value as Pin[]) ?? [], (next) => onChange(next));
      case 'toggle':
        return h('input', {
          type: 'checkbox',
          checked: Boolean(value),
          onChange: (e: Event) => onChange((e.target as HTMLInputElement).checked),
        });
      case 'number':
        return h('input', {
          type: 'number',
          value: value ?? '',
          min: field.min,
          max: field.max,
          step: field.step,
          placeholder: field.placeholder,
          onChange: (e: Event) => onChange(Number((e.target as HTMLInputElement).value)),
        });
      case 'range': {
        const bubble = h('span', { class: 'range-value' }, String(value ?? field.min ?? 0));
        const slider = h('input', {
          type: 'range',
          value: value ?? field.min ?? 0,
          min: field.min,
          max: field.max,
          step: field.step,
          // live-update the bubble while dragging; commit on change
          onInput: (e: Event) => {
            bubble.textContent = (e.target as HTMLInputElement).value;
          },
          onChange: (e: Event) => onChange(Number((e.target as HTMLInputElement).value)),
        });
        return h('div', { class: 'range-field' }, slider, bubble);
      }
      case 'select': {
        const opts = typeof field.options === 'function' ? field.options(ctx.settings) : field.options ?? [];
        return h(
          'select',
          {
            value: String(value ?? ''),
            onChange: (e: Event) => {
              const raw = (e.target as HTMLSelectElement).value;
              onChange(field.numeric ? Number(raw) : raw);
            },
          },
          ...opts.map((o) =>
            h('option', { value: o.value, selected: String(value) === o.value }, o.label),
          ),
        );
      }
      case 'textarea':
        return h('textarea', {
          rows: 4,
          placeholder: field.placeholder,
          value: field.format ? field.format(value) : String(value ?? ''),
          onChange: (e: Event) => {
            const raw = (e.target as HTMLTextAreaElement).value;
            onChange(field.parse ? field.parse(raw) : raw);
          },
        });
      case 'color':
        return h('input', {
          type: 'color',
          value: String(value ?? '#000000'),
          onChange: (e: Event) => onChange((e.target as HTMLInputElement).value),
        });
      case 'date':
      case 'text':
      default:
        return h('input', {
          type: field.type === 'date' ? 'date' : 'text',
          value: value ?? '',
          placeholder: field.placeholder,
          onChange: (e: Event) => {
            const raw = (e.target as HTMLInputElement).value;
            onChange(field.parse ? field.parse(raw) : raw);
          },
        });
    }
  }

  function fieldWrap(field: SettingsField, control: HTMLElement, inline = false): HTMLElement {
    return h(
      'div',
      { class: inline ? 'field field-inline' : 'field' },
      h('label', { class: 'field-label' }, field.label),
      control,
      field.help ? h('p', { class: 'field-help' }, field.help) : null,
    );
  }
}
