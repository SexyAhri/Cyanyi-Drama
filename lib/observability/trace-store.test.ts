import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  tasks: vi.fn(),
  channels: vi.fn(),
  freezes: vi.fn(),
  costs: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    workflowRun: { findFirst: mocks.run },
    mediaTask: { findMany: mocks.tasks },
    channel: { findMany: mocks.channels },
    balanceFreeze: { findMany: mocks.freezes },
    usageCost: { findMany: mocks.costs },
  },
}));

import { getExecutionTrace } from "./trace-store";

describe("execution trace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.run.mockResolvedValue(null);
    mocks.tasks.mockResolvedValue([task()]);
    mocks.channels.mockResolvedValue([]);
    mocks.freezes.mockResolvedValue([
      { taskId: "task-1", requestId: "task-1:attempt:1", amount: { toString: () => "2.5" }, status: "released" },
      { taskId: "task-1", requestId: "task-1:attempt:2", amount: { toString: () => "2.5" }, status: "settled" },
    ]);
    mocks.costs.mockResolvedValue([
      { sourceId: "task-1", cost: { toString: () => "2.5" }, quantity: 1, unit: "task" },
    ]);
  });

  it("includes safe effective parameters, retries, errors, provider assets, and platform billing", async () => {
    const trace = await getExecutionTrace("user-1", "trace-1");
    expect(trace?.spans[0]).toMatchObject({
      kind: "media_task",
      status: "failed",
      attributes: {
        model: "video-model",
        retryCount: 2,
        failureStage: "result_storage",
        errorCode: "MEDIA_RESULT_DELIVERY_FAILED",
        effectiveParameters: { ratio: "16:9", resolution: "1080p", duration: "10s" },
        assetIds: ["asset-1"],
        creditHolds: [
          { requestId: "task-1:attempt:1", amount: "2.5", status: "released" },
          { requestId: "task-1:attempt:2", amount: "2.5", status: "settled" },
        ],
        settledCredits: [{ amount: "2.5", quantity: 1, unit: "task" }],
      },
    });
    expect(trace?.spans[0].attributes.effectiveParameters).not.toHaveProperty("prompt");
    expect(trace?.spans[0].attributes.effectiveParameters).not.toHaveProperty("referenceImages");
    expect(mocks.freezes).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "user-1", taskId: { in: ["task-1"] } }) }));
    expect(mocks.costs).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "user-1", sourceId: { in: ["task-1"] } }) }));
  });

  it("exposes only artifact type and reference from committed workflow events", async () => {
    const createdAt = new Date("2026-10-14T10:00:00.000Z");
    mocks.tasks.mockResolvedValue([]);
    mocks.run.mockResolvedValue({
      id: "run-1",
      traceId: "trace-1",
      spanId: "run-span",
      projectId: "project-1",
      episodeId: "episode-1",
      workflowType: "story-to-script",
      targetType: null,
      targetId: null,
      workflowVersion: 1,
      status: "succeeded",
      startedAt: createdAt,
      completedAt: createdAt,
      createdAt,
      error: null,
      steps: [],
      stepAttempts: [],
      artifacts: [],
      events: [{
        id: "event-1",
        stepId: null,
        type: "artifact_committed",
        status: "running",
        message: null,
        createdAt,
        payload: {
          artifactType: "screenplay.clip",
          refId: "clip-1",
          privateInput: "must not be exposed",
        },
      }],
    });

    const trace = await getExecutionTrace("user-1", "trace-1");

    expect(trace?.events).toEqual([{
      source: "workflow",
      id: "event-1",
      spanId: "run-span",
      type: "artifact_committed",
      status: "succeeded",
      artifactType: "screenplay.clip",
      artifactRefId: "clip-1",
      message: null,
      createdAt: createdAt.toISOString(),
    }]);
    expect(JSON.stringify(trace?.events)).not.toContain("must not be exposed");
  });

  it("adds an accessible channel label to prompt spans without changing the recorded channel id", async () => {
    const createdAt = new Date("2026-10-14T10:00:00.000Z");
    mocks.tasks.mockResolvedValue([]);
    mocks.channels.mockResolvedValue([{ id: "channel-1", name: "Text channel" }]);
    mocks.run.mockResolvedValue({
      id: "run-1", traceId: "trace-1", spanId: "run-span", projectId: "project-1",
      episodeId: null, workflowType: "story-to-script", targetType: null, targetId: null,
      workflowVersion: 1, status: "succeeded", startedAt: createdAt, completedAt: createdAt,
      createdAt, error: null, steps: [], stepAttempts: [], events: [],
      artifacts: [{
        id: "workflow-artifact-1", stepId: null, artifactType: "screenplay.clip",
        refId: "clip-1", createdAt,
        payload: { promptTraces: [{
          promptId: "production_script-generation",
          agentId: "production_script-generation",
          model: "text-model", channelId: "channel-1",
          promptVersion: 2,
          configurationSources: [{ scopeKey: "project:project-1", version: 3 }],
        }] },
      }],
    });

    const trace = await getExecutionTrace("user-1", "trace-1");
    const promptSpan = trace?.spans.find((span) => span.kind === "prompt");

    expect(promptSpan?.attributes).toMatchObject({
      agentId: "production_script-generation",
      model: "text-model",
      channelId: "channel-1",
      channelName: "Text channel",
      promptVersion: 2,
    });
  });
});

function task() {
  const startedAt = new Date("2026-10-14T10:00:00.000Z");
  const completedAt = new Date("2026-10-14T10:00:12.500Z");
  return {
    id: "task-1", traceId: "trace-1", spanId: "span-1", parentSpanId: null,
    workflowRunId: null, workflowStepId: null, projectId: "project-1", episodeId: "episode-1",
    provider: "provider-1", protocol: "openai-compatible", model: "video-model", status: "failed",
    startedAt, completedAt, createdAt: startedAt, executionPhase: "failed", progress: 0,
    providerTaskId: "provider-task-1", retryCount: 2, targetType: "storyboard_panel",
    kind: "video", payload: { request: {
      prompt: "private prompt", ratio: "16:9", resolution: "1080p", duration: "10s",
      referenceImages: [{ url: "https://private.test/signed" }],
    } },
    error: { code: "MEDIA_RESULT_DELIVERY_FAILED", message: "download failed", failureStage: "result_storage" },
    assets: [{ id: "asset-1" }], events: [],
  };
}
