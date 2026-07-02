import { DEFAULT_SETTINGS, type Settings, type DeepPartial } from './types';
import { storage } from './storage';
import { bus } from './events';

const KEY = 'settings';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Recursively merge `patch` over `base`. Arrays and primitives replace;
// nested plain objects merge. Unknown keys in patch are ignored against base
// only for typing — at runtime we take base's shape and overlay patch values.
function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return (patch === undefined ? base : (patch as T));
  }
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(base)) {
    if (k in patch) {
      out[k] = deepMerge((base as Record<string, unknown>)[k], patch[k]);
    }
  }
  return out as T;
}

export async function loadSettings(): Promise<Settings> {
  const stored = await storage.get<unknown>(KEY, {});
  const merged = deepMerge(DEFAULT_SETTINGS, stored);
  merged.version = 1;
  return merged;
}

export async function saveSettings(patch: DeepPartial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const merged = deepMerge(current, patch);
  merged.version = 1;
  await storage.set(KEY, merged);
  bus.emit('settings-changed', merged);
  return merged;
}

export function getByPath(obj: unknown, dotPath: string): unknown {
  return dotPath.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part];
    return undefined;
  }, obj);
}

// Builds/mutates nested objects along dotPath and sets the leaf; returns obj.
// e.g. setByPath({}, 'a.b', 1) → { a: { b: 1 } }
export function setByPath<T extends Record<string, unknown>>(
  obj: T,
  dotPath: string,
  value: unknown,
): T {
  const parts = dotPath.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!isPlainObject(cur[p])) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}
