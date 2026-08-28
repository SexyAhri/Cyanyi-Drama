import { z } from "zod";

export const runtimeSettingsSchema = z
  .object({
    structuredRequestTimeoutSeconds: z.number().int().min(10).max(3_600),
    structuredOutputStreaming: z.boolean(),
    structuredTransportMaxAttempts: z.number().int().min(1).max(10),
    workflowStepMaxAttempts: z.number().int().min(1).max(10),
    workflowConcurrency: z.number().int().min(1).max(8),
    screenplayClipMaxChars: z.number().int().min(400).max(4_000),
  })
  .strict();

export type RuntimeSettings = z.infer<typeof runtimeSettingsSchema>;

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  structuredRequestTimeoutSeconds: 600,
  structuredOutputStreaming: true,
  structuredTransportMaxAttempts: 3,
  workflowStepMaxAttempts: 3,
  workflowConcurrency: 2,
  screenplayClipMaxChars: 1_600,
};

export function structuredRequestOptions(settings: RuntimeSettings) {
  return {
    timeoutMs: settings.structuredRequestTimeoutSeconds * 1_000,
    stream: settings.structuredOutputStreaming,
    maxTransportAttempts: settings.structuredTransportMaxAttempts,
  };
}
