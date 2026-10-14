import type { ProductionCopy } from "./copy";

export function fieldLabel(
  field: string,
  copy: ProductionCopy,
  agentNames: Record<string, string> = {},
) {
  const keys: Record<string, keyof ProductionCopy> = {
    requestTimeoutSeconds: "timeout",
    transportAttempts: "attempts",
    maxCorrections: "corrections",
    channelId: "model",
    disabledOperations: "tools",
  };
  const parts = field.split(".");
  const key = parts.at(-1)!;
  const label = copy[keys[key] ?? (key as keyof ProductionCopy)] ?? key;
  const group =
    parts[0] === "agents"
      ? copy.agents
      : parts[0] === "sound"
        ? copy.sound
        : copy.workflow;
  return (
    group +
    (parts[0] === "agents" ? " · " + (agentNames[parts[1]] ?? parts[1]) : "") +
    " · " +
    label
  );
}

export function displayValue(
  field: string,
  value: unknown,
  copy: ProductionCopy,
): string {
  if (value === undefined) return copy.inherited;
  if (typeof value === "boolean") return value ? copy.enabled : copy.disabled;
  const labels: Record<string, Record<string, string>> = {
    "sound.mode": { native: copy.native, post: copy.post, silent: copy.silent },
    "sound.music": {
      off: copy.off,
      designed: copy.designed,
      post: copy.musicPost,
    },
    "sound.subtitles": {
      post: copy.subtitlesPost,
      model: copy.subtitlesModel,
      off: copy.subtitlesOff,
    },
    "workflow.retryMode": {
      continue: copy.retryContinue,
      restart: copy.retryRestart,
    },
  };
  if (typeof value === "string") return labels[field]?.[value] ?? value;
  return JSON.stringify(value);
}
