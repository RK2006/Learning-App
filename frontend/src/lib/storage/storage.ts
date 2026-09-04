/**
 * Safe localStorage.
 *
 * The critical detail: the `window.localStorage` PROPERTY ACCESS ITSELF is
 * inside the try. With site data blocked, reading the property throws
 * SecurityError before any method is ever called -- a wrapper that only guards
 * `.getItem()` still takes down the app at import time.
 *
 * When storage is unavailable we fall back to an in-memory Map so the app stays
 * completely functional for the session; the user just loses persistence, and
 * is told so once.
 */

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; key(i: number): string | null; readonly length: number };

function probe(): Store | null {
  try {
    const ls = window.localStorage;
    const probeKey = '__learnable_probe__';
    ls.setItem(probeKey, '1');
    ls.removeItem(probeKey);
    return ls;
  } catch {
    return null;
  }
}

function memoryStore(): Store {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    key: (i) => Array.from(m.keys())[i] ?? null,
    get length() {
      return m.size;
    },
  };
}

const real = probe();
const backing: Store = real ?? memoryStore();

export const storage = {
  /** False when we are running on the in-memory fallback. */
  available: real !== null,

  get(key: string): string | null {
    try {
      return backing.getItem(key);
    } catch {
      return null;
    }
  },

  /** Returns false on quota or security failure -- never throws. Safari private
   *  mode historically reported a zero quota and threw on every setItem. */
  set(key: string, value: string): boolean {
    try {
      backing.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },

  remove(key: string): void {
    try {
      backing.removeItem(key);
    } catch {
      /* nothing useful to do */
    }
  },

  /** All keys under a prefix. Snapshot first: removing during iteration
   *  reindexes the store. */
  keys(prefix: string): string[] {
    const out: string[] = [];
    try {
      for (let i = 0; i < backing.length; i++) {
        const k = backing.key(i);
        if (k && k.startsWith(prefix)) out.push(k);
      }
    } catch {
      /* ignore */
    }
    return out;
  },

  removeByPrefix(prefix: string, keep?: (key: string) => boolean): void {
    for (const k of this.keys(prefix)) {
      if (keep?.(k)) continue;
      this.remove(k);
    }
  },
};
