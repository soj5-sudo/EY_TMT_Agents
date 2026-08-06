interface Entry<T> {
  value: T;
  expiresAt: number;
  storedAt: number;
}

const MAX_ENTRIES = 400;

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

function evictIfNeeded(): void {
  if (store.size <= MAX_ENTRIES) return;
  const dropCount = Math.ceil(MAX_ENTRIES / 4);
  let dropped = 0;
  for (const key of store.keys()) {
    store.delete(key);
    if (++dropped >= dropCount) break;
  }
}

export function cacheGet<T>(key: string): { value: T; storedAt: number } | null {
  const hit = store.get(key) as Entry<T> | undefined;
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) return null;
  return { value: hit.value, storedAt: hit.storedAt };
}

export function cacheGetStale<T>(
  key: string,
): { value: T; storedAt: number } | null {
  const hit = store.get(key) as Entry<T> | undefined;
  if (!hit) return null;
  return { value: hit.value, storedAt: hit.storedAt };
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs, storedAt: Date.now() });
  evictIfNeeded();
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  producer: () => Promise<T>,
): Promise<{ value: T; fresh: boolean; storedAt: number }> {
  const hit = cacheGet<T>(key);
  if (hit) return { value: hit.value, fresh: true, storedAt: hit.storedAt };

  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) {
    try {
      const value = await existing;
      const after = cacheGetStale<T>(key);
      return { value, fresh: true, storedAt: after?.storedAt ?? Date.now() };
    } catch (err) {
      const stale = cacheGetStale<T>(key);
      if (stale) {
        return { value: stale.value, fresh: false, storedAt: stale.storedAt };
      }
      throw err;
    }
  }

  const task = (async () => {
    const value = await producer();
    cacheSet(key, value, ttlMs);
    return value;
  })();

  inflight.set(key, task);
  try {
    const value = await task;
    return { value, fresh: true, storedAt: Date.now() };
  } catch (err) {
    const stale = cacheGetStale<T>(key);
    if (stale) return { value: stale.value, fresh: false, storedAt: stale.storedAt };
    throw err;
  } finally {
    inflight.delete(key);
  }
}

export function cacheStats(): { entries: number; inflight: number } {
  return { entries: store.size, inflight: inflight.size };
}

export function cacheClear(prefix?: string): number {
  if (!prefix) {
    const n = store.size;
    store.clear();
    return n;
  }
  let n = 0;
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      n++;
    }
  }
  return n;
}
