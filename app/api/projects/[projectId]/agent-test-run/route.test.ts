import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  ensure: vi.fn(),
  recordCost: vi.fn(),
}));

vi.mock("@/lib/studio/agent-runtime", () => ({
  previewStudioAgent: mocks.preview,
  StudioAgentError: class StudioAgentError extends Error {
    status = 400;
  },
}));
vi.mock("@/lib/server/auth", () => ({
  ensureAnonymousUser: mocks.ensure,
  attachSessionCookie: (response: Response) => response,
}));
vi.mock("@/lib/studio/agent-test-cost", () => ({
  summarizeAgentTestRunCost: mocks.recordCost,
}));

import { POST } from "./route";
import { StructuredOutputError } from "@/lib/llm/structured-output";

describe("Agent test-run failed structured response", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensure.mockResolvedValue({ user: { id: "user-1" }, sessionId: null });
    mocks.recordCost.mockReturnValue({ estimated: false, reason: "price_unavailable" });
  });

  it("returns safe failure trace and reads already settled receipts", async () => {
    const error = new StructuredOutputError(
      "STRUCTURED_JSON_INVALID",
      ["invalid JSON"],
      "private unstructured model output",
    );
    error.executionTrace = {
      promptId: "studio_workflow_agent",
      agentId: "studio_workflow_coordinator",
      promptVersion: 2,
      promptVersionHash: "prompt-hash",
      model: "text-model",
      channelId: "channel-1",
      structuredOutputMode: "json_object",
      correctionAttempts: 1,
      tokenUsage: { inputTokens: 30, outputTokens: 8, totalTokens: 38 },
      outputHash: "output-hash",
      configurationSources: [{ scopeKey: "test-draft", version: 0 }],
    };
    mocks.preview.mockRejectedValue(error);

    const response = await POST(
      new Request("http://localhost/api/projects/project-1/agent-test-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "Answer briefly", context: { stageId: "writing" } }),
      }),
      { params: Promise.resolve({ projectId: "project-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.testRunFailure).toMatchObject({
      trace: {
        model: "text-model",
        channelId: "channel-1",
        tokenUsage: { inputTokens: 30, outputTokens: 8, totalTokens: 38 },
        correctionAttempts: 1,
        outputHash: "output-hash",
      },
      validation: { passed: false, schema: "studioWorkflowAgentSchema", code: "STRUCTURED_JSON_INVALID" },
      costEstimate: { estimated: false, reason: "price_unavailable" },
    });
    expect(JSON.stringify(body)).not.toContain("private unstructured model output");
    expect(mocks.recordCost).toHaveBeenCalledWith(undefined);
  });
});
