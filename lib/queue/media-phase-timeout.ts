import type { MediaTaskExecutionPhase } from "@/lib/media/task-contract";

const DEFAULT_TIMEOUTS: Partial<Record<MediaTaskExecutionPhase, number>> = {
  queued: 15 * 60_000,
  waiting_quota: 5 * 60_000,
  connecting: 60_000,
  request_sent: 20 * 60_000,
  submitted: 20 * 60_000,
  generating: 20 * 60_000,
  downloading: 2 * 60_000,
  saving: 3 * 60_000,
};

export function mediaPhaseTimeoutMs(
  phase: MediaTaskExecutionPhase,
  env: Record<string, string | undefined> = process.env,
) {
  const key = `MEDIA_PHASE_TIMEOUT_${phase.toUpperCase()}_MS`;
  const configured = Number(env[key]);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_TIMEOUTS[phase] ?? 20 * 60_000;
}

export function expiredMediaQueuePhase(input: {
  executionPhase: string | null;
  createdAt: Date;
  updatedAt: Date;
  now?: Date;
  env?: Record<string, string | undefined>;
}) {
  const phase = input.executionPhase === "waiting_quota" ? "waiting_quota" : input.executionPhase === "queued" ? "queued" : null;
  if (!phase) return null;
  const since = phase === "waiting_quota" ? input.updatedAt : input.createdAt;
  return (input.now ?? new Date()).getTime() - since.getTime() >= mediaPhaseTimeoutMs(phase, input.env)
    ? phase
    : null;
}

export function createMediaPhaseDeadline(
  env: Record<string, string | undefined> = process.env,
  parentSignal?: AbortSignal,
) {
  const controller = new AbortController();
  let phase: MediaTaskExecutionPhase = "connecting";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectTimeout: ((error: Error) => void) | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  void timedOut.catch(() => undefined);
  const abort = (reason: Error) => {
    if (controller.signal.aborted) return;
    controller.abort(reason);
    rejectTimeout?.(reason);
  };
  const onParentAbort = () => abort(
    parentSignal?.reason instanceof Error
      ? parentSignal.reason
      : new Error("MEDIA_TASK_CANCEL_REQUESTED"),
  );
  if (parentSignal?.aborted) onParentAbort();
  else parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  const setPhase = (next: MediaTaskExecutionPhase) => {
    phase = next;
    if (timer) clearTimeout(timer);
    if (controller.signal.aborted) return;
    timer = setTimeout(() => {
      const failedPhase = phase;
      abort(new Error(`MEDIA_PHASE_TIMEOUT:${failedPhase}`));
    }, mediaPhaseTimeoutMs(phase, env));
    timer.unref?.();
  };

  return {
    signal: controller.signal,
    setPhase,
    abort,
    run<T>(operation: Promise<T>) {
      if (controller.signal.aborted)
        return Promise.reject(controller.signal.reason ?? new Error(`MEDIA_PHASE_TIMEOUT:${phase}`));
      return Promise.race([operation, timedOut]).catch((error: unknown) => {
        if (controller.signal.aborted && controller.signal.reason instanceof Error)
          throw controller.signal.reason;
        throw error;
      });
    },
    close() {
      if (timer) clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}
