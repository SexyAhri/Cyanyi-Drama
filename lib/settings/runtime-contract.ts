import { z } from "zod";

export const runtimeSettingsSchema = z
  .object({
    structuredRequestTimeoutSeconds: z.number().int().min(10).max(3_600),
    structuredOutputStreaming: z.boolean(),
    structuredTransportMaxAttempts: z.number().int().min(1).max(10),
    workflowStepMaxAttempts: z.number().int().min(1).max(10),
    workflowConcurrency: z.number().int().min(1).max(8),
    screenplayClipMaxChars: z.number().int().min(400).max(4_000),
    imageGenerationRatio: z.enum([
      "1:1",
      "3:2",
      "2:3",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "21:9",
    ]),
    imageGenerationResolution: z.enum(["1k", "2k", "4k"]),
    imageGenerationCount: z.number().int().min(1).max(4),
    imageGenerationQuality: z.enum(["auto", "high"]),
    videoGenerationRatio: z.enum([
      "1:1",
      "3:2",
      "2:3",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "21:9",
    ]),
    videoGenerationResolution: z.enum(["720p", "1080p", "2k", "4k"]),
    videoGenerationDuration: z.enum(["5s", "10s"]),
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
  imageGenerationRatio: "1:1",
  imageGenerationResolution: "1k",
  imageGenerationCount: 1,
  imageGenerationQuality: "high",
  videoGenerationRatio: "16:9",
  videoGenerationResolution: "1080p",
  videoGenerationDuration: "10s",
};

export type MediaGenerationDefaults = Pick<
  RuntimeSettings,
  | "imageGenerationRatio"
  | "imageGenerationResolution"
  | "imageGenerationCount"
  | "imageGenerationQuality"
  | "videoGenerationRatio"
  | "videoGenerationResolution"
  | "videoGenerationDuration"
>;

export function structuredRequestOptions(settings: RuntimeSettings) {
  return {
    timeoutMs: settings.structuredRequestTimeoutSeconds * 1_000,
    stream: settings.structuredOutputStreaming,
    maxTransportAttempts: settings.structuredTransportMaxAttempts,
  };
}
