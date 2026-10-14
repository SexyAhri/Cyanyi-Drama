import { compactMediaTaskOutput, compactMediaTaskRequest } from "./public-media";
import type { MediaAsset } from "./task-contract";

export function hasPersistedProviderOutput(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const providerOutput = (payload as Record<string, unknown>).providerOutput;
  return Array.isArray(providerOutput) && providerOutput.length > 0;
}

export function mergePersistedMediaTaskPayload(input: {
  currentPayload?: unknown;
  request: Record<string, unknown>;
  output?: MediaAsset[];
}) {
  const saved = input.currentPayload && typeof input.currentPayload === "object" && !Array.isArray(input.currentPayload)
    ? input.currentPayload as Record<string, unknown>
    : {};
  return {
    ...saved,
    request: compactMediaTaskRequest(input.request),
    output: input.output ? compactMediaTaskOutput(input.output) : null,
  };
}
