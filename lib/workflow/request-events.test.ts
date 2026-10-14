import { describe, expect, it, vi } from "vitest";

import { recordWorkflowArtifactReuse, trackWorkflowRequest, type WorkflowRequestUpdate } from "./request-events";

describe("workflow subrequest tracking", () => {
  it("records an independent request id, frozen input and linked output artifact", async () => {
    const recordRequest = vi.fn(async (event: WorkflowRequestUpdate) => void event);
    const input = { sourceHash: "source-v4", chunk: "A scene with exact source text" };
    const result = await trackWorkflowRequest({
      recordRequest,
      request: {
        requestId: "request-chunk-1",
        requestType: "manuscript_chunk",
        targetType: "manuscript_chunk",
        targetId: "chunk-hash",
        inputHash: "chunk-hash",
        input,
      },
      execute: async () => ({ result: { notes: ["scene"] }, artifactRefs: ["manuscript.chunk:chunk-hash"] }),
    });

    expect(result).toEqual({ notes: ["scene"] });
    expect(recordRequest.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({ requestId: "request-chunk-1", status: "running", input }),
      expect.objectContaining({ requestId: "request-chunk-1", status: "succeeded", artifactRefs: ["manuscript.chunk:chunk-hash"] }),
    ]);
  });

  it("records failures with the same request id and propagates the error", async () => {
    const recordRequest = vi.fn(async (event: WorkflowRequestUpdate) => void event);
    await expect(trackWorkflowRequest({
      recordRequest,
      request: {
        requestId: "request-scene-2",
        requestType: "scene_split",
        targetType: "scene",
        targetId: "scene-2",
        inputHash: "scene-input",
      },
      execute: async () => { throw new Error("provider rejected input"); },
    })).rejects.toThrow("provider rejected input");
    expect(recordRequest.mock.calls.at(-1)?.[0]).toMatchObject({
      requestId: "request-scene-2",
      status: "failed",
      error: "provider rejected input",
    });
  });

  it("records a validated cache reuse with its input fingerprint, version and artifact reference", async () => {
    const recordRequest = vi.fn(async (event: WorkflowRequestUpdate) => void event);
    const input = { sourceHash: "source-v4", chunk: "exact source" };
    await recordWorkflowArtifactReuse({
      recordRequest,
      request: {
        requestId: "reuse-request-1",
        requestType: "manuscript_chunk",
        targetType: "manuscript_chunk",
        targetId: "chunk-hash",
        inputHash: "chunk-hash",
        input,
        cacheVersion: "workflow-cache-v2",
        promptVersion: "5",
        promptVersionHash: "prompt-hash",
      },
      artifactRefs: ["manuscript.chunk:chunk-hash"],
      reuseReason: "previous_validated_artifact",
    });

    expect(recordRequest).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "reuse-request-1",
      status: "succeeded",
      reused: true,
      reuseReason: "previous_validated_artifact",
      inputHash: "chunk-hash",
      input,
      cacheVersion: "workflow-cache-v2",
      promptVersion: "5",
      promptVersionHash: "prompt-hash",
      artifactRefs: ["manuscript.chunk:chunk-hash"],
    }));
  });
});
