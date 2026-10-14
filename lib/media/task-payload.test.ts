import { describe, expect, it } from "vitest";

import { hasPersistedProviderOutput, mergePersistedMediaTaskPayload } from "./task-payload";

describe("persisted media task payload", () => {
  it("reports whether an opaque provider result checkpoint exists without exposing its contents", () => {
    expect(hasPersistedProviderOutput({ providerOutput: [{ url: "https://provider.test/result" }] })).toBe(true);
    expect(hasPersistedProviderOutput({ providerOutput: [] })).toBe(false);
    expect(hasPersistedProviderOutput({ request: { prompt: "frozen" } })).toBe(false);
    expect(hasPersistedProviderOutput(null)).toBe(false);
  });

  it("preserves a provider result checkpoint while updating a retryable task", () => {
    const providerOutput = [{ id: "asset-1", kind: "video", url: "https://cdn.test/result.mp4" }];
    expect(mergePersistedMediaTaskPayload({
      currentPayload: { providerOutput, request: { old: true } },
      request: { prompt: "frozen prompt" },
    })).toEqual({
      providerOutput,
      request: { prompt: "frozen prompt" },
      output: null,
    });
  });

  it("keeps the public task output distinct from its private provider checkpoint", () => {
    expect(mergePersistedMediaTaskPayload({
      currentPayload: { providerOutput: [{ id: "asset-1", kind: "image", url: "https://provider.test/raw" }] },
      request: { prompt: "x" },
      output: [{ id: "asset-1", kind: "image", url: "stored:projects/p/media/image/a.png", storageKey: "projects/p/media/image/a.png" }],
    })).toMatchObject({
      providerOutput: [{ id: "asset-1", url: "https://provider.test/raw" }],
      output: [{ id: "asset-1", url: "/api/media/assets/asset-1/content" }],
    });
  });
});
