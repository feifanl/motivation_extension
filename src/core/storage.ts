import type { TypedStorage } from './types';

// Thin promise wrapper over chrome.storage.local. When chrome.storage is
// absent (running `vite dev` in a plain browser tab), falls back to
// localStorage + JSON so `npm run dev` works outside the extension.

const hasChrome = typeof chrome !== 'undefined' && !!chrome.storage?.local;
const LS_PREFIX = 'ls-newtab:';

const chromeStorage: TypedStorage = {
  get<T>(key: string, fallback: T): Promise<T> {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (obj) => {
        const v = obj[key];
        resolve(v === undefined ? fallback : (v as T));
      });
    });
  },
  set<T>(key: string, value: T): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => resolve());
    });
  },
  remove(key: string): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.remove(key, () => resolve());
    });
  },
};

const localStorageFallback: TypedStorage = {
  async get<T>(key: string, fallback: T): Promise<T> {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
  async set<T>(key: string, value: T): Promise<void> {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  },
  async remove(key: string): Promise<void> {
    localStorage.removeItem(LS_PREFIX + key);
  },
};

export const storage: TypedStorage = hasChrome ? chromeStorage : localStorageFallback;
