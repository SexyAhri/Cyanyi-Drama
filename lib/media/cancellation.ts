export const MEDIA_TASK_CANCEL_REQUESTED = "MEDIA_TASK_CANCEL_REQUESTED";

export function mediaTaskCancellationPolicy(task: {
  status: string;
  executionPhase?: string;
  providerTaskId?: string | null;
}) {
  const phase = task.executionPhase ?? "queued";
  const mayHaveReachedProvider = Boolean(task.providerTaskId) || [
    "request_sent",
    "submitted",
    "generating",
    "downloading",
    "saving",
  ].includes(phase);

  if (!mayHaveReachedProvider) {
    return {
      provider: "not_submitted" as const,
      lateResult: "none" as const,
      providerMayStillCharge: false,
    };
  }

  return {
    provider: "cancellation_unsupported" as const,
    lateResult: "discard" as const,
    providerMayStillCharge: true,
  };
}

export function isMediaTaskCancellation(error: unknown) {
  return error instanceof Error && error.message === MEDIA_TASK_CANCEL_REQUESTED;
}
