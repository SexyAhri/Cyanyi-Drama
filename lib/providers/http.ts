export type ProviderFetchOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxBackoffMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (delayMs: number) => Promise<void>;
  now?: () => number;
};

export async function fetchWithProviderRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: ProviderFetchOptions = {},
) {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 1_000);
  const maxBackoffMs = Math.max(baseDelayMs, options.maxBackoffMs ?? 30_000);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl(input, init);
    if (response.status !== 429 || attempt >= maxAttempts) return response;

    const retryAfterMs = parseRetryAfterMs(
      response.headers.get("retry-after"),
      now(),
    );
    const backoffMs = Math.min(
      maxBackoffMs,
      baseDelayMs * 2 ** Math.max(0, attempt - 1),
    );
    const delayMs = Math.max(retryAfterMs ?? 0, backoffMs);
    await response.arrayBuffer().catch(() => undefined);
    if (options.sleep) await options.sleep(delayMs);
    else await abortableSleep(delayMs, init?.signal);
  }

  throw new Error("PROVIDER_RETRY_EXHAUSTED");
}

export function parseRetryAfterMs(value: string | null, now = Date.now()) {
  const normalized = value?.trim();
  if (!normalized) return null;
  const seconds = Number(normalized);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.ceil(seconds * 1_000);
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : null;
}

function abortableSleep(delayMs: number, signal?: AbortSignal | null) {
  if (signal?.aborted)
    return Promise.reject(
      signal.reason ?? new DOMException("Aborted", "AbortError"),
    );
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
