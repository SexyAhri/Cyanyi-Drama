import { describe, expect, it, vi } from "vitest";
import {
  providerCapacityKey,
  providerModelKey,
  resolveProviderCapacityPolicy,
  withProviderCapacity,
} from "./provider-capacity";

describe("per-channel/model provider capacity", () => {
  it("isolates counters by channel, model, provider, and protocol", () => {
    const base = { channelId: "channel-a", model: "model-a", providerKey: "provider-a", protocol: "ark" };
    expect(providerCapacityKey(base)).not.toBe(providerCapacityKey({ ...base, channelId: "channel-b" }));
    expect(providerCapacityKey(base)).not.toBe(providerCapacityKey({ ...base, model: "model-b" }));
    expect(providerCapacityKey(base)).not.toBe(providerCapacityKey({ ...base, protocol: "openai-compatible" }));
  });

  it("resolves bounded per-channel/model overrides and safe defaults", () => {
    const env = {
      MEDIA_PROVIDER_DEFAULT_CONCURRENCY: "3",
      MEDIA_PROVIDER_DEFAULT_REQUESTS_PER_MINUTE: "75",
      MEDIA_PROVIDER_LIMITS_JSON: JSON.stringify({
        "channel-a/model-a": { concurrency: 2, minConcurrency: 9, requestsPerMinute: 12 },
        "channel-a/model-b": { concurrency: 100, requestsPerMinute: 0 },
      }),
    };
    expect(resolveProviderCapacityPolicy({ channelId: "channel-a", model: "model-a", env }))
      .toEqual({ concurrency: 2, minimumConcurrency: 2, requestsPerMinute: 12 });
    expect(resolveProviderCapacityPolicy({ channelId: "channel-a", model: "model-b", env }))
      .toEqual({ concurrency: 32, minimumConcurrency: 1, requestsPerMinute: 75 });
    expect(resolveProviderCapacityPolicy({ channelId: "other", model: "model-a", env }))
      .toEqual({ concurrency: 3, minimumConcurrency: 1, requestsPerMinute: 75 });
    expect(providerModelKey("channel-a", "model-a")).toBe("channel-a/model-a");
  });

  it("acquires a distributed slot and releases it after the provider call", async () => {
    const evalScript = vi.fn().mockResolvedValue(1).mockResolvedValueOnce([1, 0]);
    const redis = { eval: evalScript } as never;
    const signal = await withProviderCapacity({
      channelId: "channel-a", model: "model-a", redis,
      env: { MEDIA_PROVIDER_DEFAULT_CONCURRENCY: "2", MEDIA_PROVIDER_DEFAULT_REQUESTS_PER_MINUTE: "10" },
    }, async (providerSignal) => {
      expect(providerSignal.aborted).toBe(false);
      return "provider-result";
    });

    expect(signal).toBe("provider-result");
    expect(evalScript).toHaveBeenCalledTimes(3);
    expect(evalScript.mock.calls[0][0]).toContain("ZADD");
    expect(evalScript.mock.calls[0][8]).toBe("10");
    expect(evalScript.mock.calls[0][11]).toBe("1");
    expect(evalScript.mock.calls[1][0]).toContain("current + 1");
    expect(evalScript.mock.calls[2][0]).toContain("ZREM");
  });

  it("does not consume a new-request rate token when resuming a persisted provider task", async () => {
    const evalScript = vi.fn().mockResolvedValue(1).mockResolvedValueOnce([1, 0]);
    await withProviderCapacity({ channelId: "channel-a", model: "model-a", countRequest: false, redis: { eval: evalScript } as never }, async () => true);
    expect(evalScript.mock.calls[0][11]).toBe("0");
  });

  it("cuts only this channel/model concurrency on a provider rate-limit response", async () => {
    const evalScript = vi.fn()
      .mockResolvedValueOnce([1, 0])
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    await expect(withProviderCapacity({
      channelId: "channel-a", model: "model-a", redis: { eval: evalScript } as never,
      env: {
        MEDIA_PROVIDER_DEFAULT_CONCURRENCY: "8",
        MEDIA_PROVIDER_MIN_CONCURRENCY: "2",
      },
    }, async () => { throw new Error("STRUCTURED_PROVIDER_FAILED:429:rate limit"); }))
      .rejects.toThrow("rate limit");
    const feedback = evalScript.mock.calls[1];
    expect(feedback[0]).toContain("math.floor(current / 2)");
    expect(feedback.slice(4, 7)).toEqual(["2", "8", "60000"]);
  });

  it("increases the effective concurrency by one only after cooldown and recovery delay", async () => {
    const evalScript = vi.fn().mockResolvedValueOnce([1, 0]).mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    await withProviderCapacity({
      channelId: "channel-a", model: "model-a", redis: { eval: evalScript } as never,
      env: { MEDIA_PROVIDER_DEFAULT_CONCURRENCY: "8", MEDIA_PROVIDER_MIN_CONCURRENCY: "2" },
    }, async () => true);
    const feedback = evalScript.mock.calls[1];
    expect(feedback[0]).toContain("now < cooldownUntil");
    expect(feedback[0]).toContain("current + 1");
    expect(feedback.slice(4, 8)).toEqual(["2", "8", "60000", "30000"]);
  });

  it("reports quota waiting and honors cancellation before a slot is acquired", async () => {
    const evalScript = vi.fn().mockResolvedValue([0, 500]);
    const controller = new AbortController();
    const onWaiting = vi.fn();
    const wait = vi.fn(async () => {
      controller.abort(new Error("cancelled"));
      throw controller.signal.reason;
    });
    const operation = vi.fn();

    await expect(withProviderCapacity({
      channelId: "channel-a", model: "model-a", redis: { eval: evalScript } as never,
      signal: controller.signal, onWaiting, wait,
    }, operation)).rejects.toThrow("cancelled");
    expect(onWaiting).toHaveBeenCalledTimes(1);
    expect(operation).not.toHaveBeenCalled();
  });
});
