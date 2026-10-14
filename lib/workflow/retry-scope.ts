export type RetryScopeStep = {
  stepKey: string;
  stepIndex?: number;
  status?: string;
  dependsOn?: readonly string[];
};

/** Returns the selected step and every transitive dependent in workflow order. */
export function downstreamRetryStepKeys(
  steps: readonly RetryScopeStep[],
  stepKey: string,
) {
  const reset = new Set([stepKey]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of steps) {
      if (
        !reset.has(step.stepKey) &&
        step.dependsOn?.some((dependency) => reset.has(dependency))
      ) {
        reset.add(step.stepKey);
        changed = true;
      }
    }
  }
  return steps.filter((step) => reset.has(step.stepKey)).map((step) => step.stepKey);
}

/** Returns incomplete steps plus their downstream dependents; a completed run
 * with a failed finalization retries only the last step. */
export function workflowRetryStepKeys(steps: readonly RetryScopeStep[]) {
  const reset = new Set(
    steps.filter((step) => step.status !== "succeeded").map((step) => step.stepKey),
  );
  if (!reset.size && steps.length) {
    const last = [...steps].sort((left, right) =>
      (right.stepIndex ?? 0) - (left.stepIndex ?? 0),
    )[0];
    reset.add(last.stepKey);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of steps) {
      if (
        !reset.has(step.stepKey) &&
        step.dependsOn?.some((dependency) => reset.has(dependency))
      ) {
        reset.add(step.stepKey);
        changed = true;
      }
    }
  }
  return steps.filter((step) => reset.has(step.stepKey)).map((step) => step.stepKey);
}
