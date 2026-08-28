import { describe, expect, it } from "vitest";

import {
  DEFAULT_RUNTIME_SETTINGS,
  runtimeSettingsSchema,
  structuredRequestOptions,
} from "./runtime-contract";

describe("runtime settings", () => {
  it("provides conservative defaults", () => {
    expect(DEFAULT_RUNTIME_SETTINGS).toEqual({
      structuredRequestTimeoutSeconds: 600,
      structuredOutputStreaming: true,
      structuredTransportMaxAttempts: 3,
      workflowStepMaxAttempts: 3,
      workflowConcurrency: 2,
      screenplayClipMaxChars: 1_600,
    });
  });

  it("rejects values outside the manually supported range", () => {
    expect(
      runtimeSettingsSchema.safeParse({
        ...DEFAULT_RUNTIME_SETTINGS,
        structuredRequestTimeoutSeconds: 9,
      }).success,
    ).toBe(false);
    expect(
      runtimeSettingsSchema.safeParse({
        ...DEFAULT_RUNTIME_SETTINGS,
        workflowConcurrency: 9,
      }).success,
    ).toBe(false);
    expect(
      runtimeSettingsSchema.safeParse({
        ...DEFAULT_RUNTIME_SETTINGS,
        screenplayClipMaxChars: 399,
      }).success,
    ).toBe(false);
  });

  it("maps persisted values to provider request options", () => {
    expect(
      structuredRequestOptions({
        ...DEFAULT_RUNTIME_SETTINGS,
        structuredRequestTimeoutSeconds: 45,
        structuredOutputStreaming: false,
        structuredTransportMaxAttempts: 6,
      }),
    ).toEqual({ timeoutMs: 45_000, stream: false, maxTransportAttempts: 6 });
  });
});
