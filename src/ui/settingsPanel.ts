import './settingsPanel.css';
import { modules } from '../modules';
import { getByPath, setByPath } from '../core/settings';
import { h } from '../core/dom';
import type { DeepPartial, ModuleContext, Settings, SettingsField } from '../core/types';

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

  const gear = h('button', { class: 'settings-gear', title: 'Settings', 'aria-label': 'Settings' }, '⚙');
  const backdrop = h('div', { class: 'settings-backdrop' });
  const body = h('div', { class: 'settings-body' });
  const panel = h(
    'div',
    { class: 'settings-panel' },
    h(
      'div',
      { class: 'settings-head' },
      h('span', { class: 'settings-title' }, 'Settings'),
      h('button', { class: 'settings-close', title: 'Close', onClick: close }, '✕'),
    ),
    body,
  );

  corner.appendChild(gear);
  document.body.append(backdrop, panel);

  function open(): void {
    render();
    backdrop.classList.add('open');
    panel.classList.add('open');
  }
  function close(): void {
    backdrop.classList.remove('open');
    panel.classList.remove('open');
  }

  gear.addEventListener('click', open);
  backdrop.addEventListener('click', close);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('open')) close();
  });
  ctx.bus.on('open-settings', open);

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
  function render(): void {
    body.replaceChildren();

    // Global fields first.
    const generalRows = [
      renderField({
        key: 'theme',
        label: 'Theme',
        type: 'select',
        options: [
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' },
        ],
      }),
    ].filter((el): el is HTMLElement => el !== null);
    body.appendChild(section('General', generalRows));

    // Per-module schemas.
    for (const mod of modules) {
      if (!mod.settingsSchema.length) continue;
      const rows = mod.settingsSchema
        .filter((f) => !f.showIf || f.showIf(ctx.settings))
        .map(renderField)
        .filter((el): el is HTMLElement => el !== null);
      if (rows.length) body.appendChild(section(prettify(mod.id), rows));
    }
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

    const rowsEl = arr.map((row, i) =>
      h(
        'div',
        { class: 'list-row' },
        ...itemFields.map((sf) =>
          fieldWrap(
            sf,
            controlFor(sf, row[sf.key], (v) => {
              const next = arr.slice();
              next[i] = { ...row, [sf.key]: v };
              saveArray(field.key, next);
            }),
            sf.type === 'toggle',
          ),
        ),
        h(
          'button',
          {
            class: 'list-remove',
            onClick: () => saveArray(field.key, arr.filter((_, j) => j !== i)),
          },
          'Remove',
        ),
      ),
    );

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
        f.type === 'number' ? (f.min ?? 0) : f.type === 'toggle' ? false : f.options ? f.options[0]?.value : '';
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
      case 'select':
        return h(
          'select',
          {
            value: String(value ?? ''),
            onChange: (e: Event) => onChange((e.target as HTMLSelectElement).value),
          },
          ...(field.options ?? []).map((o) =>
            h('option', { value: o.value, selected: String(value) === o.value }, o.label),
          ),
        );
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
