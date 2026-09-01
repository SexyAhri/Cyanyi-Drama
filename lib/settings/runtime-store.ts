import { randomUUID } from "node:crypto";
import type { UserRuntimeSettings } from "@prisma/client";

import { prisma } from "@/lib/server/prisma";
import {
  DEFAULT_RUNTIME_SETTINGS,
  runtimeSettingsSchema,
  type RuntimeSettings,
} from "./runtime-contract";

export async function loadUserRuntimeSettings(
  userId: string,
): Promise<RuntimeSettings> {
  const row = await prisma.userRuntimeSettings.findUnique({
    where: { userId },
  });
  return row ? toRuntimeSettings(row) : DEFAULT_RUNTIME_SETTINGS;
}

export async function saveUserRuntimeSettings(
  userId: string,
  settings: RuntimeSettings,
) {
  const parsed = runtimeSettingsSchema.parse(settings);
  const data = {
    ...parsed,
    structuredTransportMaxAttempts: 1,
    workflowStepMaxAttempts: 1,
  };
  const row = await prisma.userRuntimeSettings.upsert({
    where: { userId },
    create: { id: randomUUID(), userId, ...data },
    update: data,
  });
  return toRuntimeSettings(row);
}

function toRuntimeSettings(row: UserRuntimeSettings) {
  return runtimeSettingsSchema.parse({
    structuredRequestTimeoutSeconds: row.structuredRequestTimeoutSeconds,
    structuredOutputStreaming: row.structuredOutputStreaming,
    structuredTransportMaxAttempts: 1,
    workflowStepMaxAttempts: 1,
    workflowConcurrency: row.workflowConcurrency,
    screenplayClipMaxChars: row.screenplayClipMaxChars,
    imageGenerationRatio: row.imageGenerationRatio,
    imageGenerationResolution: row.imageGenerationResolution,
    imageGenerationCount: row.imageGenerationCount,
    imageGenerationQuality: row.imageGenerationQuality,
    videoGenerationRatio: row.videoGenerationRatio,
    videoGenerationResolution: row.videoGenerationResolution,
    videoGenerationDuration: row.videoGenerationDuration,
  });
}
