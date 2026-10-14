const resumableProtocols = new Set([
  "volcengine-ark",
  "openai-compatible",
  "autodl-comfyui",
]);

const resumablePhases = new Set([
  "submitted",
  "generating",
  "downloading",
  "saving",
]);

export function canResumeMediaProviderTask(input: {
  providerTaskId?: string | null;
  executionPhase: string;
  protocol: string;
}) {
  return Boolean(
    input.providerTaskId &&
      resumablePhases.has(input.executionPhase) &&
      resumableProtocols.has(input.protocol),
  );
}

export function mediaTaskRecoveryMode(input: {
  hasProviderOutput: boolean;
  providerTaskId?: string | null;
  executionPhase: string;
  protocol: string;
}): "save_output" | "resume_provider" | "submit" {
  if (input.hasProviderOutput) return "save_output";
  return canResumeMediaProviderTask(input) ? "resume_provider" : "submit";
}

export function mediaFailureStage(input: {
  executionPhase?: string | null;
  hasProviderOutput: boolean;
}): "generation" | "result_storage" {
  return input.hasProviderOutput || ["downloading", "saving"].includes(input.executionPhase ?? "")
    ? "result_storage"
    : "generation";
}
import type { MediaAsset, MediaTaskKind } from "@/lib/media/task-contract";


export function restoreCheckpointedMediaOutput(
  value: unknown,
  kind: MediaTaskKind,
): MediaAsset[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const output = value.filter((item): item is MediaAsset => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const asset = item as Record<string, unknown>;
    return asset.kind === kind && typeof asset.id === "string" && typeof asset.url === "string";
  });
  return output.length === value.length ? output : null;
}
