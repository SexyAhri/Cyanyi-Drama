import { createHash } from "node:crypto";

export const SOURCE_CHUNK_CHARS = 12_000;
export type SourceChunk = { index: number; start: number; end: number; text: string };

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

export type SourceTaskHooks = {
  assertActive: () => Promise<void>;
  loadArtifact: (type: string, id: string) => Promise<unknown | null>;
  persistArtifact: (type: string, id: string, payload: unknown) => Promise<void>;
  reportProgress?: (message: string) => Promise<void>;
};
