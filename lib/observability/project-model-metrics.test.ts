import { describe, expect, it } from "vitest";
import { summarizeProjectModelMetrics } from "./project-model-metrics";

describe("project model statistics", () => {
  it("uses the actual billed model/channel and includes direct conversations without double counting workflow attempts", () => {
    const rows = summarizeProjectModelMetrics({ tasks: [],
      attempts: [{ id: "a", provider: "original", modelKey: "original", status: "succeeded", errorCode: null, startedAt: null, finishedAt: null }],
      cacheEvents: [], channelNames: new Map([["actual", "实际渠道"]]),
      costs: [
        { sourceId: "a", sourceType: "workflow_step_attempt", model: "fallback", metadata: JSON.stringify({ channelId: "actual" }), cost: { toString: () => "0.2" } },
        { sourceId: "request", sourceType: "model_request", model: "chat", metadata: JSON.stringify({ channelId: "actual" }), cost: { toString: () => "0.1" } },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual(expect.objectContaining({ executionKind: "workflow", model: "fallback", channel: "实际渠道", attempts: 1, recordedCost: "0.2" }));
    expect(rows).toContainEqual(expect.objectContaining({ executionKind: "conversation", model: "chat", attempts: 1, recordedCost: "0.1" }));
  });
  it("groups success, duration, rate limits and recorded media credits by channel/model", () => {
    const rows = summarizeProjectModelMetrics({
      tasks: [
        { id: "m1", channelId: "channel-1", provider: "openai", model: "video-a", status: "succeeded", error: null, startedAt: new Date(1000), completedAt: new Date(5000) },
        { id: "m2", channelId: "channel-1", provider: "openai", model: "video-a", status: "failed", error: { code: "PROVIDER_RATE_LIMIT", message: "429" }, startedAt: new Date(1000), completedAt: new Date(3000) },
        { id: "m3", channelId: "channel-1", provider: "openai", model: "video-a", status: "canceled", error: null, startedAt: new Date(1000), completedAt: new Date(2000) },
      ],
      attempts: [],
      cacheEvents: [],
      costs: [{ sourceId: "m1", cost: { toString: () => "1.25" } }],
      channelNames: new Map([["channel-1", "Studio Channel"]]),
    });

    expect(rows).toEqual([{
      executionKind: "media",
      channelId: "channel-1",
      channel: "Studio Channel",
      model: "video-a",
      attempts: 3,
      succeeded: 1,
      failed: 1,
      canceled: 1,
      successRate: 0.5,
      rateLimited: 1,
      durationSamples: 3,
      averageDurationMs: 2333,
      recordedCost: "1.25",
      cachedRequestsReused: 0,
      estimatedCreditSavings: null,
    }]);
  });

  it("counts only unique verified cache-reuse requests and does not invent savings", () => {
    const rows = summarizeProjectModelMetrics({
      tasks: [],
      attempts: [{ id: "attempt-1", provider: "channel-text", modelKey: "text-a", status: "succeeded", errorCode: null, startedAt: new Date(1000), finishedAt: new Date(3000) }],
      cacheEvents: [
        { payload: { requestId: "request-1", provider: "channel-text", model: "text-a", reused: true } },
        { payload: { requestId: "request-1", provider: "channel-text", model: "text-a", reused: true } },
      ],
      costs: [{ sourceId: "attempt-1", sourceType: "workflow_step_attempt", cost: { toString: () => "0.08" } }],
      channelNames: new Map([["channel-text", "Text Channel"]]),
    });

    expect(rows[0]).toMatchObject({
      executionKind: "workflow",
      channel: "Text Channel",
      attempts: 1,
      succeeded: 1,
      successRate: 1,
      cachedRequestsReused: 1,
      recordedCost: "0.08",
      estimatedCreditSavings: null,
    });
  });

  it("classifies provider error codes and keeps cancelled requests outside the success-rate denominator", () => {
    const rows = summarizeProjectModelMetrics({
      tasks: [
        { id: "m1", channelId: null, provider: "openai", model: "image-a", status: "failed", error: { code: "PROVIDER_RATE_LIMIT" }, startedAt: null, completedAt: null },
        { id: "m2", channelId: null, provider: "openai", model: "image-a", status: "canceled", error: null, startedAt: null, completedAt: null },
      ],
      attempts: [], cacheEvents: [], costs: [], channelNames: new Map(),
    });
    expect(rows[0]).toMatchObject({ attempts: 2, failed: 1, canceled: 1, successRate: 0, rateLimited: 1, durationSamples: 0, averageDurationMs: null });
  });
});
