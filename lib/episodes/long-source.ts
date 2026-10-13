import { createHash } from "node:crypto";

export const SOURCE_CHUNK_CHARS = 12_000;
export type SourceChunk = { index: number; start: number; end: number; text: string };

export function sourceAnalysisConcurrency(value = process.env.SOURCE_ANALYSIS_CONCURRENCY) {
  const parsed = Number(value ?? 6);
  return Number.isFinite(parsed) ? Math.min(8, Math.max(1, Math.floor(parsed))) : 6;
}

/** Exact, ordered coverage. Prefer paragraph boundaries without dropping whitespace. */
export function chunkSource(source: string, limit = SOURCE_CHUNK_CHARS): SourceChunk[] {
  const chunks: SourceChunk[] = [];
  let start = 0;
  while (start < source.length) {
    let end = Math.min(start + limit, source.length);
    if (end < source.length) {
      const boundary = source.lastIndexOf("\n", end - 1);
      if (boundary >= start + Math.floor(limit / 2)) end = boundary + 1;
    }
    chunks.push({ index: chunks.length, start, end, text: source.slice(start, end) });
    start = end;
  }
  return chunks;
}

export function sourceFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Keep input order, stop scheduling on failure, and drain requests already in flight. */
export async function mapSourceTasks<T, R>(
  items: readonly T[], concurrency: number, work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  let failed = false;
  const limit = Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 1;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed && cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await work(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  });
  const settled = await Promise.allSettled(workers);
  const failure = settled.find(result => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return results;
}

export type SourceTaskHooks = {
  reusePreviousResults?: boolean;
  assertActive: () => Promise<void>;
  loadArtifact: (type: string, id: string) => Promise<unknown | null>;
  persistArtifact: (type: string, id: string, payload: unknown) => Promise<void>;
  reportProgress?: (message: string) => Promise<void>;
};
