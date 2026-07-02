import type { BusEvent, EventBus } from './types';

// Map-of-Sets pub/sub. on() returns an unsubscribe function.
type Cb = (payload?: unknown) => void;

const listeners = new Map<BusEvent, Set<Cb>>();

export const bus: EventBus = {
  on(event, cb) {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  },
  emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const cb of set) cb(payload);
  },
};
