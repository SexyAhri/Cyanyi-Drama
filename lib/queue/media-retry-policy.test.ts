import { describe, expect, it } from "vitest";
import { isMediaFailureRetryable, preventNonRetryableMediaRetry } from "./media-retry-policy";

describe("media task automatic retry policy", () => {
  it("limits authentication, quota and parameter failures to the current attempt", () => {
    const job = { attemptsMade: 1, opts: { attempts: 5 } };
    preventNonRetryableMediaRetry(job, new Error("STRUCTURED_PROVIDER_FAILED:401:unauthorized"));
    expect(job.opts.attempts).toBe(2);
    expect(isMediaFailureRetryable("STRUCTURED_PROVIDER_FAILED:401:unauthorized", 1, 3)).toBe(false);
    expect(isMediaFailureRetryable("STRUCTURED_PROVIDER_FAILED:402:insufficient quota", 1, 3)).toBe(false);
    expect(isMediaFailureRetryable("STRUCTURED_PROVIDER_FAILED:400:invalid parameter", 1, 3)).toBe(false);
  });

  it("retains bounded retries for transient failures and never retries exhausted attempts", () => {
    const job = { attemptsMade: 1, opts: { attempts: 5 } };
    preventNonRetryableMediaRetry(job, new Error("STRUCTURED_PROVIDER_FAILED:429:rate limit"));
    expect(job.opts.attempts).toBe(5);
    expect(isMediaFailureRetryable("STRUCTURED_PROVIDER_FAILED:429:rate limit", 1, 3)).toBe(true);
    expect(isMediaFailureRetryable("STRUCTURED_PROVIDER_TIMEOUT:stage=request", 3, 3)).toBe(false);
  });
});
