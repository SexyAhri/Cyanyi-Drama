import { afterEach, describe, expect, it, vi } from "vitest";
import { createMediaPhaseDeadline, expiredMediaQueuePhase, mediaPhaseTimeoutMs } from "./media-phase-timeout";

afterEach(() => vi.useRealTimers());

describe("media phase deadlines", () => {
  it("uses per-phase defaults and validated environment overrides", () => {
    expect(mediaPhaseTimeoutMs("connecting", {})).toBe(60_000);
    expect(mediaPhaseTimeoutMs("generating", { MEDIA_PHASE_TIMEOUT_GENERATING_MS: "1234" })).toBe(1234);
    expect(mediaPhaseTimeoutMs("saving", { MEDIA_PHASE_TIMEOUT_SAVING_MS: "0" })).toBe(180_000);
  });

  it("times out queue and quota waits against their own phase start time", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    const createdAt = new Date(now.getTime() - 20);
    const quotaStartedAt = new Date(now.getTime() - 20);
    expect(expiredMediaQueuePhase({ executionPhase: "queued", createdAt, updatedAt: now, now, env: { MEDIA_PHASE_TIMEOUT_QUEUED_MS: "10" } })).toBe("queued");
    expect(expiredMediaQueuePhase({ executionPhase: "waiting_quota", createdAt: now, updatedAt: quotaStartedAt, now, env: { MEDIA_PHASE_TIMEOUT_WAITING_QUOTA_MS: "10" } })).toBe("waiting_quota");
    expect(expiredMediaQueuePhase({ executionPhase: "waiting_quota", createdAt: now, updatedAt: now, now, env: { MEDIA_PHASE_TIMEOUT_WAITING_QUOTA_MS: "10" } })).toBeNull();
  });

  it("resets the deadline at each phase transition and reports the timed out phase", async () => {
    vi.useFakeTimers();
    const deadline = createMediaPhaseDeadline({ MEDIA_PHASE_TIMEOUT_CONNECTING_MS: "10", MEDIA_PHASE_TIMEOUT_GENERATING_MS: "30" });
    deadline.setPhase("connecting");
    await vi.advanceTimersByTimeAsync(8);
    deadline.setPhase("generating");
    const work = deadline.run(new Promise<never>(() => undefined));
    const rejection = expect(work).rejects.toThrow("MEDIA_PHASE_TIMEOUT:generating");
    await vi.advanceTimersByTimeAsync(29);
    expect(deadline.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(deadline.signal.aborted).toBe(true);
    deadline.close();
  });

  it("propagates local task cancellation into the active request signal", async () => {
    const cancellation = new AbortController();
    const deadline = createMediaPhaseDeadline({}, cancellation.signal);
    const operation = new Promise<void>((_resolve, reject) => {
      deadline.signal.addEventListener("abort", () => reject(deadline.signal.reason), { once: true });
    });
    const result = deadline.run(operation);
    cancellation.abort(new Error("MEDIA_TASK_CANCEL_REQUESTED"));

    await expect(result).rejects.toMatchObject({ message: "MEDIA_TASK_CANCEL_REQUESTED" });
    expect(deadline.signal.aborted).toBe(true);
    deadline.close();
  });
});
