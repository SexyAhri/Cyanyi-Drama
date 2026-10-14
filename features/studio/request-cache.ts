// Per-tab cache: never stores credentials or shares data between signed-in users.
const entries = new Map<string, { value: unknown; updatedAt: number; freshUntil: number }>();
const pending = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();
let scope = "";
let generation = 0;
const MAX_ENTRIES = 120;
const MAX_AGE = 5 * 60_000;

function keyFor(url: string) {
  return url.replace(/([?&])touch=[01](&|$)/, (_, before: string, after: string) => after ? before : "");
}

export function setStudioCacheScope(userId: string) {
  if (typeof window === "undefined" || scope === userId) return;
  scope = userId;
  entries.clear();
  pending.clear();
  generation++;
}

export function peekStudioCache<T>(url: string): T | undefined {
  if (typeof window === "undefined") return;
  const entry = entries.get(keyFor(url));
  if (entry && Date.now() - entry.updatedAt < MAX_AGE) return entry.value as T;
}

export function writeStudioCache(url: string, value: unknown, ttl = 15_000) {
  if (typeof window === "undefined") return;
  const key = keyFor(url);
  entries.delete(key);
  entries.set(key, { value, updatedAt: Date.now(), freshUntil: Date.now() + ttl });
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
}

export function invalidateStudioCache(url?: string, remove = false) {
  if (typeof window === "undefined") return;
  const projectPrefix = url?.match(/^\/api\/projects\/([^/?]+)/)?.[0];
  for (const [key, entry] of entries) {
    if (projectPrefix && key !== projectPrefix && !key.startsWith(`${projectPrefix}/`) && !key.startsWith(`${projectPrefix}?`)) continue;
    if (remove) entries.delete(key);
    else entry.freshUntil = 0;
  }
  pending.clear();
  generation++;
  listeners.forEach(listener => listener());
}

export function subscribeStudioCache(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function studioCacheRevision() { return generation; }

export function cachedStudioRequest<T>(url: string, load: () => Promise<T>, signal?: AbortSignal | null, force = false): Promise<T> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  if (typeof window === "undefined") return load();
  const key = keyFor(url);
  const entry = entries.get(key);
  if (!force && entry && entry.freshUntil > Date.now()) return Promise.resolve(entry.value as T);
  let work = force ? undefined : pending.get(key) as Promise<T> | undefined;
  if (!work) {
    const capturedGeneration = generation;
    work = load().then(value => {
      if (capturedGeneration === generation && pending.get(key) === work) writeStudioCache(url, value);
      return value;
    }).finally(() => { if (pending.get(key) === work) pending.delete(key); });
    pending.set(key, work);
  }
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    work!.then(value => signal.aborted ? abort() : resolve(value), reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
