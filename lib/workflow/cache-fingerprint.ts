import { createHash } from "node:crypto";

type CacheReference = {
  assetId?: unknown;
  storageKey?: unknown;
  url?: unknown;
  contentHash?: unknown;
  mimeType?: unknown;
  role?: unknown;
};

export function workflowCacheFingerprint(input: {
  source: unknown;
  prompt: unknown;
  promptVersion: string;
  channelId: string;
  model: string;
  agentConfiguration?: unknown;
  parameters?: unknown;
  references?: CacheReference[];
}) {
  const value = {
    format: "workflow-cache-v2",
    source: input.source,
    prompt: input.prompt,
    promptVersion: input.promptVersion,
    channelId: input.channelId,
    model: input.model,
    agentConfiguration: input.agentConfiguration ?? null,
    parameters: input.parameters ?? null,
    references: (input.references ?? []).map(referenceIdentity),
  };
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function referenceIdentity(reference: CacheReference) {
  const url = typeof reference.url === "string" ? reference.url : "";
  return {
    assetId: reference.assetId ?? null,
    storageKey: reference.storageKey ?? null,
    urlHash: url ? createHash("sha256").update(url).digest("hex") : null,
    contentHash: reference.contentHash ?? null,
    mimeType: reference.mimeType ?? null,
    role: reference.role ?? null,
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortObjectKeys(value));
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortObjectKeys(item)]),
  );
}
