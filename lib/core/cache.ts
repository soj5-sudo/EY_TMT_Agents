/**
 * In-memory TTL cache with single-flight and stale-on-error fallback.
 * Bounded by entry count; expired entries are retained as fallback material.
 */

interface Entry<T> {
  value: T;
  /** Epoch ms after which the entry is stale. */
  expiresAt: number;
  storedAt: number;
}

const MAX_ENTRIES = 400;

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Bounds the map by size. Expired entries are kept as fallback material, so
 * size is the only eviction trigger; without this the map would grow for the
 * life of the process.
 */
function evictIfNeeded(): void {
  if (store.size <= MAX_ENTRIES) return;
  // Drop the oldest quarter of the map. Map preserves insertion order.
  const dropCount = Math.ceil(MAX_ENTRIES / 4);
  let dropped = 0;
  for (const key of store.keys()) {
    store.delete(key);
    if (++dropped >= dropCount) break;
  }
}

/**
 * Returns a fresh entry, or null when the entry is absent or past its TTL.
 *
 * An expired entry is deliberately NOT deleted here. It is retained so that
 * `cached` can fall back to it when the upstream refresh fails: serving a
 * ten-minute-old quote labelled "cached" beats serving nothing. Eviction is
 * handled by `evictIfNeeded` on write, which bounds the map by size instead.
 */
export function cacheGet<T>(key: string): { value: T; storedAt: number } | null {
  const hit = store.get(key) as Entry<T> | undefined;
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) return null;
  return { value: hit.value, storedAt: hit.storedAt };
}

/**
 * Returns a stale entry even past its TTL. Used as the last rung of a
 * fallback chain: serving a ten-minute-old quote beats serving nothing,
 * so long as the UI labels it as cached.
 */
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

/**
 * Fetch through the cache, collapsing concurrent misses into one upstream
 * call. On upstream failure the stale entry is returned when one exists,
 * and the error is rethrown only when there is nothing at all to serve.
 */
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
      // A caller that joined an in-flight request gets the same stale-fallback
      // treatment as the caller that started it. Without this the second
      // concurrent caller sees a hard failure while the first sees cached data.
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
