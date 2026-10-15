import { describe, expect, it } from "vitest";
import { formatUsageTime, recordedUsageTokens } from "./usage-records";

describe("provider usage log evidence", () => {
  it("preserves measured input totals, zero cache reads and separate cache writes", () => {
    expect(recordedUsageTokens(JSON.stringify({ actualUsage: { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 200, cacheWriteTokens: 50 } })))
      .toEqual({ input: 1000, output: 100, cacheRead: 200, cacheWrite: 50 });
    expect(recordedUsageTokens(JSON.stringify({ actualUsage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 } })))
      .toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: null });
  });
  it("never presents a reservation, missing cache count or malformed metadata as measured zeros", () => {
    for (const metadata of [null, "bad json", "null", JSON.stringify({ reservationUsage: { inputTokens: 1000 }, usage: { inputTokens: 1000 } })])
      expect(recordedUsageTokens(metadata)).toEqual({ input: null, output: null, cacheRead: null, cacheWrite: null });
    expect(recordedUsageTokens(JSON.stringify({ actualUsage: { inputTokens: 10, outputTokens: 3 } })))
      .toEqual({ input: 10, output: 3, cacheRead: null, cacheWrite: null });
    expect(recordedUsageTokens(JSON.stringify({ actualUsage: { inputTokens: -1, outputTokens: 0.1, cachedInputTokens: "0" } })))
      .toEqual({ input: null, output: null, cacheRead: null, cacheWrite: null });
  });
  it("rejects impossible cache subtotals", () => {
    expect(recordedUsageTokens(JSON.stringify({ actualUsage: { inputTokens: 10, outputTokens: 2, cachedInputTokens: 8, cacheWriteTokens: 4 } })))
      .toEqual({ input: 10, output: 2, cacheRead: null, cacheWrite: null });
  });
  it("shows a full local date and seconds, including midnight", () => {
    expect(formatUsageTime("2026-10-15T10:37:05.123Z", "zh-CN", "Asia/Shanghai")).toBe("2026/10/15 18:37:05");
    expect(formatUsageTime("2026-10-14T16:00:00Z", "zh-CN", "Asia/Shanghai")).toBe("2026/10/15 00:00:00");
    expect(formatUsageTime("bad")).toBe("—");
  });
});
