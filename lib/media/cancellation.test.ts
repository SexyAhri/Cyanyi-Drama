import { describe, expect, it } from "vitest";
import { isMediaTaskCancellation, mediaTaskCancellationPolicy, MEDIA_TASK_CANCEL_REQUESTED } from "./cancellation";

describe("media task cancellation policy", () => {
  it("reports queued work as locally cancelable before provider submission", () => {
    expect(mediaTaskCancellationPolicy({ status: "queued", executionPhase: "queued" })).toEqual({
      provider: "not_submitted",
      lateResult: "none",
      providerMayStillCharge: false,
    });
  });

  it.each([
    { executionPhase: "request_sent" },
    { executionPhase: "generating", providerTaskId: "provider-123" },
  ])("warns that provider work may continue and late output is discarded (%o)", (task) => {
    expect(mediaTaskCancellationPolicy({ status: "running", ...task })).toEqual({
      provider: "cancellation_unsupported",
      lateResult: "discard",
      providerMayStillCharge: true,
    });
  });

  it("recognizes cancellation as a control outcome, not a provider failure", () => {
    expect(isMediaTaskCancellation(new Error(MEDIA_TASK_CANCEL_REQUESTED))).toBe(true);
    expect(isMediaTaskCancellation(new Error("MEDIA_PHASE_TIMEOUT:generating"))).toBe(false);
  });
});
