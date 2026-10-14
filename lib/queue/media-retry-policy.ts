import { classifyProviderFailure, shouldRetryProviderFailure } from "@/lib/providers/failure-classification";

export function preventNonRetryableMediaRetry(
  job: { attemptsMade: number; opts: { attempts?: number } },
  error: unknown,
) {
  const message = error instanceof Error ? error.message : String(error);
  const category = classifyProviderFailure(message);
  if (category && !shouldRetryProviderFailure(category))
    job.opts.attempts = job.attemptsMade + 1;
  return category;
}

export function isMediaFailureRetryable(message: string, attemptsMade: number, maxAttempts: number) {
  if (attemptsMade >= maxAttempts) return false;
  const category = classifyProviderFailure(message);
  return !category || shouldRetryProviderFailure(category);
}
