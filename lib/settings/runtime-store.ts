import { randomUUID } from "node:crypto";

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
  const data = runtimeSettingsSchema.parse(settings);
  const row = await prisma.userRuntimeSettings.upsert({
    where: { userId },
    create: { id: randomUUID(), userId, ...data },
    update: data,
  });
  return toRuntimeSettings(row);
}

function toRuntimeSettings(row: RuntimeSettings) {
  return runtimeSettingsSchema.parse({
    structuredRequestTimeoutSeconds: row.structuredRequestTimeoutSeconds,
    structuredOutputStreaming: row.structuredOutputStreaming,
    structuredTransportMaxAttempts: row.structuredTransportMaxAttempts,
    workflowStepMaxAttempts: row.workflowStepMaxAttempts,
    workflowConcurrency: row.workflowConcurrency,
    screenplayClipMaxChars: row.screenplayClipMaxChars,
  });
}
