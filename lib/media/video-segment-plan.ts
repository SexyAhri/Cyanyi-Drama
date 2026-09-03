import type {
  ChannelProtocol,
  ModelCapabilities,
} from "@/lib/agent/provider-types";
import { inferModelCapabilities } from "@/lib/agent/provider-types";

export type VideoModelLimits = {
  maxDurationSeconds: number;
  maxReferenceImages: number;
};

export type VideoSegmentPlan = {
  action: string;
  durationSeconds: number;
  endSeconds: number;
  index: number;
  prompt: string;
  startSeconds: number;
};

export function resolveVideoModelLimits(input: {
  capabilities?: unknown;
  model: string;
  protocol: ChannelProtocol;
}): VideoModelLimits {
  const inferred = inferModelCapabilities(input.model, input.protocol);
  const declared = capabilityRecord(input.capabilities);
  return {
    maxDurationSeconds: positiveInteger(
      declared?.maxDurationSeconds,
      inferred.maxDurationSeconds ?? 10,
    ),
    maxReferenceImages: nonNegativeInteger(
      declared?.maxReferenceImages,
      inferred.maxReferenceImages ??
        (inferred.supportsReferenceImages ? 1 : 0),
    ),
  };
}

export function planVideoSegments(input: {
  action?: string | null;
  durationSeconds?: number | null;
  maxDurationSeconds: number;
  prompt: string;
}): VideoSegmentPlan[] {
  const totalDuration = normalizedDuration(input.durationSeconds);
  const maximum = Math.max(1, Math.floor(input.maxDurationSeconds));
  const segmentCount = Math.max(1, Math.ceil(totalDuration / maximum));
  const durations = balancedDurations(totalDuration, segmentCount);
  const actions = splitAction(input.action ?? "", segmentCount);
  let cursor = 0;

  return durations.map((durationSeconds, index) => {
    const startSeconds = cursor;
    const endSeconds = startSeconds + durationSeconds;
    cursor = endSeconds;
    return {
      action: actions[index] ?? input.action?.trim() ?? "",
      durationSeconds,
      endSeconds,
      index,
      prompt:
        segmentCount === 1
          ? input.prompt.trim()
          : segmentPrompt({
              action: actions[index] ?? "",
              basePrompt: input.prompt,
              count: segmentCount,
              endSeconds,
              index,
              startSeconds,
            }),
      startSeconds,
    };
  });
}

function normalizedDuration(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return 5;
  return Math.max(1, Math.round(value));
}

function balancedDurations(total: number, count: number) {
  const base = Math.floor(total / count);
  const remainder = total % count;
  return Array.from(
    { length: count },
    (_, index) => base + (index < remainder ? 1 : 0),
  );
}

function splitAction(value: string, count: number) {
  const normalized = value.trim();
  if (count === 1) return [normalized];
  const units = actionUnits(normalized);
  if (!units.length) return Array.from({ length: count }, () => "");
  const result: string[] = [];
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    const remainingSegments = count - index;
    const remainingUnits = units.length - cursor;
    const take = Math.max(1, Math.ceil(remainingUnits / remainingSegments));
    result.push(units.slice(cursor, cursor + take).join(""));
    cursor += take;
  }
  while (result.length < count) result.push("");
  return result;
}

function actionUnits(value: string) {
  if (!value) return [];
  const sentences = value.match(/[^。！？!?；;\n]+[。！？!?；;]?/gu) ?? [];
  if (sentences.length > 1)
    return sentences.map((item) => item.trim()).filter(Boolean);
  return (value.match(/[^，,、]+[，,、]?/gu) ?? [value])
    .map((item) => item.trim())
    .filter(Boolean);
}

function segmentPrompt(input: {
  action: string;
  basePrompt: string;
  count: number;
  endSeconds: number;
  index: number;
  startSeconds: number;
}) {
  const actionLine = input.action
    ? `本片段可见动作：${input.action}`
    : "本片段动作：延续场次既定画面状态和运镜，不新增剧情。";
  const basePrompt = replaceVisibleAction(input.basePrompt.trim(), actionLine);
  return [
    basePrompt,
    `生成范围：本场次第 ${input.index + 1}/${input.count} 段，对应 ${formatSecond(input.startSeconds)}-${formatSecond(input.endSeconds)} 秒。`,
    basePrompt.includes(actionLine) ? "" : actionLine,
    "只生成当前片段，不提前表现后续动作，不重复前段动作；人物、场景、道具、画风、时段、光线和运镜必须承接同一场次。",
  ]
    .filter(Boolean)
    .join("\n");
}

function replaceVisibleAction(prompt: string, replacement: string) {
  const pattern =
    /^(?:唯一向前动作|本片段可见动作|可见画面与动作|可见动作|Only forward action|Visible action)\s*[：:].*$/imu;
  return pattern.test(prompt) ? prompt.replace(pattern, replacement) : prompt;
}

function formatSecond(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function capabilityRecord(value: unknown): Partial<ModelCapabilities> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Partial<ModelCapabilities>;
}

function positiveInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}
