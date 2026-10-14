import { describe, expect, it } from "vitest";
import { classifyProviderFailure, mediaPhaseTimeoutGuidance, providerFailureGuidance, shouldRetryProviderFailure } from "./failure-classification";

describe("provider failure classification", () => {
  it.each([
    ["STRUCTURED_PROVIDER_FAILED:401:unauthorized", "authentication"],
    ["STRUCTURED_PROVIDER_FAILED:402:payment required", "quota"],
    ["insufficient_quota: balance insufficient", "quota"],
    ["STRUCTURED_PROVIDER_FAILED:429:rate limit", "rate_limit"],
    ["STRUCTURED_PROVIDER_FAILED:400:invalid parameter", "invalid_parameters"],
    ["PRODUCTION_FALLBACK_INCOMPATIBLE:REFERENCE_IMAGES", "invalid_parameters"],
    ["content_policy_violation: safety refusal", "content_rejected"],
    ["STRUCTURED_SCHEMA_INVALID:reply", "output_validation"],
    ["STRUCTURED_PROVIDER_TIMEOUT:stage=response_body", "timeout"],
    ["STRUCTURED_PROVIDER_TRANSPORT_FAILED:reason=terminated", "network"],
    ["STRUCTURED_PROVIDER_FAILED:503:unavailable", "provider_unavailable"],
  ] as const)("classifies %s", (message, expected) => {
    expect(classifyProviderFailure(message)).toBe(expected);
  });

  it("provides localized recovery guidance and leaves unknown errors intact", () => {
    const category = classifyProviderFailure("STRUCTURED_PROVIDER_FAILED:429:too many requests");
    expect(category).toBe("rate_limit");
    expect(providerFailureGuidance(category!, "zh-CN")).toContain("等待限流窗口");
    expect(providerFailureGuidance(category!, "en")).toContain("wait for the limit window");
    expect(classifyProviderFailure("business rule failed")).toBeNull();
  });

  it("retries only transient provider failures automatically", () => {
    expect(shouldRetryProviderFailure("rate_limit")).toBe(true);
    expect(shouldRetryProviderFailure("network")).toBe(true);
    expect(shouldRetryProviderFailure("provider_unavailable")).toBe(true);
    expect(shouldRetryProviderFailure("timeout")).toBe(true);
    expect(shouldRetryProviderFailure("authentication")).toBe(false);
    expect(shouldRetryProviderFailure("invalid_parameters")).toBe(false);
    expect(shouldRetryProviderFailure("quota")).toBe(false);
    expect(shouldRetryProviderFailure("content_rejected")).toBe(false);
    expect(shouldRetryProviderFailure("output_validation")).toBe(false);
  });

  it("explains which media execution phase timed out", () => {
    expect(mediaPhaseTimeoutGuidance("MEDIA_PHASE_TIMEOUT:downloading", "zh-CN")).toContain("下载阶段超时");
    expect(mediaPhaseTimeoutGuidance("MEDIA_PHASE_TIMEOUT:waiting_quota", "zh-CN")).toContain("模型请求名额等待");
    expect(mediaPhaseTimeoutGuidance("MEDIA_PHASE_TIMEOUT:saving", "en")).toContain("result save phase timed out");
    expect(mediaPhaseTimeoutGuidance("MEDIA_PHASE_TIMEOUT:unknown", "en")).toBeNull();
  });
});
