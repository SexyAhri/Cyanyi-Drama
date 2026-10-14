export type WorkflowScheduleStep = {
  stepKey: string;
  stepIndex: number;
  stepType?: string;
  status: string;
  dependsOn: unknown;
};

export type WorkflowDependencyBlocker = {
  stepKey: string;
  waitingOn: Array<{ stepKey: string; status: string }>;
};

export async function runWorkflowStepWave<T extends WorkflowScheduleStep, R>(
  steps: T[],
  concurrency: number,
  execute: (step: T) => Promise<R>,
) {
  const schedule = scheduleRunnableWorkflowSteps(steps, concurrency);
  const results = await Promise.allSettled(schedule.runnable.map(execute));
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) throw failed.reason;
  return {
    ...schedule,
    results: results.map((result) => (result as PromiseFulfilledResult<R>).value),
  };
}

export function scheduleRunnableWorkflowSteps<T extends WorkflowScheduleStep>(
  steps: T[],
  concurrency: number,
) {
  const ordered = [...steps].sort((left, right) => left.stepIndex - right.stepIndex);
  const byKey = new Map(ordered.map((step) => [step.stepKey, step]));
  const pending = ordered.filter((step) => ["pending", "ready"].includes(step.status));
  const ready = pending.filter((step) =>
    dependenciesOf(step).every((dependency) => byKey.get(dependency)?.status === "succeeded"),
  );
  const blocked: WorkflowDependencyBlocker[] = pending.flatMap((step) => {
    const waitingOn = dependenciesOf(step).flatMap((stepKey) => {
      const dependency = byKey.get(stepKey);
      return dependency?.status === "succeeded"
        ? []
        : [{ stepKey, status: dependency?.status ?? "missing" }];
    });
    return waitingOn.length ? [{ stepKey: step.stepKey, waitingOn }] : [];
  });

  return {
    runnable: ready.slice(0, Math.max(1, Math.min(8, Math.floor(concurrency) || 1))),
    blocked,
    pendingCount: pending.length,
  };
}

/** Resolve every pending step made unreachable by a failed prerequisite, including transitive dependents. */
export function resolveFailedDependencyBlockers<T extends WorkflowScheduleStep>(steps: T[]) {
  const ordered = [...steps].sort((left, right) => left.stepIndex - right.stepIndex);
  const statuses = new Map(ordered.map((step) => [step.stepKey, step.status]));
  const blockers = new Map<string, WorkflowDependencyBlocker>();
  let changed = true;

  while (changed) {
    changed = false;
    for (const step of ordered) {
      if (!['pending', 'ready'].includes(statuses.get(step.stepKey) ?? step.status)) continue;
      const waitingOn = dependenciesOf(step).flatMap((stepKey) => {
        const status = statuses.get(stepKey);
        return status === 'failed' || status === 'blocked'
          ? [{ stepKey, status }]
          : [];
      });
      if (!waitingOn.length) continue;
      statuses.set(step.stepKey, 'blocked');
      blockers.set(step.stepKey, { stepKey: step.stepKey, waitingOn });
      changed = true;
    }
  }

  return [...blockers.values()];
}

function dependenciesOf(step: WorkflowScheduleStep) {
  return Array.isArray(step.dependsOn)
    ? step.dependsOn.filter((dependency): dependency is string => typeof dependency === "string")
    : [];
}
