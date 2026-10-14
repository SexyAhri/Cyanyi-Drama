import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  ConfigurationScope,
  ProductionConfigurationSnapshot,
} from "./contract";
import { AgentConfigurationError } from "./agents";
import {
  assertConfigurationScope,
  resolveProductionConfiguration,
  ConfigurationError,
} from "./store";

export const productionRequestOptionsSchema = z.object({
  productionOverride: z.never().optional(),
  previewRequestHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  previewConfigurationHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export function productionRequestErrorStatus(error: unknown) {
  return error instanceof ConfigurationError
    ? error.status
    : error instanceof z.ZodError || error instanceof AgentConfigurationError
      ? 400
      : undefined;
}

export function mediaRequestPreviewFingerprint(
  inputs: Array<{
    model: string;
    channelId?: string;
    request: Record<string, unknown>;
  }>,
) {
  const reference = (value: unknown) =>
    Array.isArray(value)
      ? value.map((item) => ({
          key: item.storageKey ?? item.url,
          role: item.role,
        }))
      : [];
  const stable = inputs.map((input) => ({
    model: input.model,
    channelId: input.channelId,
    configuration: input.request.productionConfiguration,
    prompt: input.request.prompt,
    ratio: input.request.ratio,
    resolution: input.request.resolution,
    duration: input.request.duration,
    videoMode: input.request.videoMode,
    audioMode: input.request.audioMode,
    referenceImages: reference(input.request.referenceImages),
    referenceAudios: reference(input.request.referenceAudios),
  }));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}
export function assertPreviewRequest(actual: string, expected?: string) {
  if (expected && actual !== expected)
    throw new ConfigurationError(
      "提示词、参数或参考素材已变化，请重新预览后提交",
      409,
    );
}

/** New requests use retained published settings only; snapshots remain server-owned. */
export async function resolveProductionRequestConfiguration(
  userId: string,
  scope: ConfigurationScope,
) {
  await assertConfigurationScope(userId, scope);
  return resolveProductionConfiguration(userId, scope);
}

export function productionConfigurationFingerprint(
  snapshot: ProductionConfigurationSnapshot,
) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export function assertPreviewConfiguration(
  snapshot: ProductionConfigurationSnapshot,
  expected?: unknown,
) {
  if (expected === undefined) return;
  if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected))
    throw new ConfigurationError("配置预览标识无效", 400);
  if (expected !== productionConfigurationFingerprint(snapshot))
    throw new ConfigurationError("发布配置已变化，请重新预览后提交", 409);
}
