// Key–value storage on the device (spec §10 "Lưu ván", §13): the game saves through `KeyValueStore`, so tests inject an
// in-memory store. Blocked or full storage (private mode, sandboxed frames) behaves as empty and never throws: the game
// still plays, it just cannot resume after a reload.

export interface KeyValueStore {
  get(key: string): string | null;
  /** `null` removes the key. */
  set(key: string, value: string | null): void;
}

type LocalStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** A store on `localStorage` (or what `source` returns), every access wrapped so it never throws. */
export function webStore(source: () => LocalStorageLike = () => globalThis.localStorage): KeyValueStore {
  return {
    get(key) {
      try { return source().getItem(key); } catch { return null; }
    },
    set(key, value) {
      try {
        const ls = source();
        if (value === null) ls.removeItem(key); else ls.setItem(key, value);
      } catch { /* private mode, quota, blocked */ }
    },
  };
}

/** An in-memory store, for tests and as a stand-in. */
export function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const m = new Map(Object.entries(initial));
  return {
    get: key => m.get(key) ?? null,
    set: (key, value) => { if (value === null) m.delete(key); else m.set(key, value); },
  };
}

/** The device's storage. */
export const storage: KeyValueStore = webStore();
