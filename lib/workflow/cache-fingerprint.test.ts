import { describe, expect, it } from "vitest";
import { workflowCacheFingerprint } from "./cache-fingerprint";

const base = {
  source: { sourceHash: "source-v1", text: "Original scene" },
  prompt: "Render exact prompt",
  promptVersion: "storyboard-v4",
  channelId: "channel-a",
  model: "model-a",
  agentConfiguration: { systemInstruction: "Keep continuity" },
  parameters: { temperature: 0.3, aspectRatio: "16:9" },
  references: [{ assetId: "asset-a", role: "character", url: "https://signed/one" }],
};

describe("workflow cache fingerprint", () => {
  it("canonicalizes object key order while preserving reference order", () => {
    expect(workflowCacheFingerprint(base)).toBe(workflowCacheFingerprint({
      ...base,
      source: { text: "Original scene", sourceHash: "source-v1" },
      agentConfiguration: { systemInstruction: "Keep continuity" },
      parameters: { aspectRatio: "16:9", temperature: 0.3 },
    }));
  });

  it.each([
    { source: { sourceHash: "source-v2", text: "Original scene" } },
    { prompt: "Updated prompt" },
    { promptVersion: "storyboard-v5" },
    { channelId: "channel-b" },
    { model: "model-b" },
    { agentConfiguration: { systemInstruction: "New instructions" } },
    { parameters: { temperature: 0.7, aspectRatio: "16:9" } },
    { references: [{ assetId: "asset-b", role: "character", url: "https://signed/two" }] },
  ])("invalidates when a model-affecting input changes: %j", (patch) => {
    expect(workflowCacheFingerprint(base)).not.toBe(workflowCacheFingerprint({ ...base, ...patch }));
  });

  it("hashes signed reference URLs instead of storing them in the canonical key input", () => {
    const first = workflowCacheFingerprint(base);
    const second = workflowCacheFingerprint({ ...base, references: [{ ...base.references[0], url: "https://signed/two" }] });
    expect(second).not.toBe(first);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});
