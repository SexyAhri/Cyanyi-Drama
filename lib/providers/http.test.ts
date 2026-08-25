import { describe, expect, it, vi } from "vitest";

import { fetchWithProviderRetry, parseRetryAfterMs } from "./http";

describe("provider http retry", () => {
  it("parses Retry-After seconds and HTTP dates", () => {
    expect(parseRetryAfterMs("2.5", 0)).toBe(2_500);
    expect(parseRetryAfterMs("Thu, 01 Jan 1970 00:00:05 GMT", 1_000)).toBe(
      4_000,
    );
    expect(parseRetryAfterMs("invalid", 0)).toBeNull();
  });

  it("uses Retry-After as the minimum cooldown", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "Retry-After": "4" } }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const sleep = vi.fn(async () => undefined);

    const response = await fetchWithProviderRetry("https://provider.test", {}, {
      fetchImpl,
      sleep,
      baseDelayMs: 100,
    });

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(4_000);
  });
});
