import {
  compileAssetVisualProfile,
  type AssetVisualProfile,
} from "./visual-profile";
import { getProjectArtStyleDirective } from "@/lib/projects/art-style";
export function buildAssetGenerationPrompt(input: {
  artStyle?: string;
  kind: "character" | "location" | "prop";
  name: string;
  description?: string | null;
  visualDescription?: string | null;
  visualProfile?: AssetVisualProfile;
  details?: Record<string, unknown>;
}) {
  const kindLabel =
    input.kind === "character"
      ? "角色"
      : input.kind === "location"
        ? "场景"
        : "道具";
  const lines = input.artStyle
    ? [
        getProjectArtStyleDirective(input.artStyle, "zh"),
        `${kindLabel}名称：${input.name.trim()}`,
      ]
    : [`${kindLabel}名称：${input.name.trim()}`];
  const profile = compileAssetVisualProfile(input.visualProfile);
  if (profile) lines.push("已锁定视觉设定：", profile);
  if (!input.visualProfile && input.visualDescription?.trim())
    lines.push(`视觉设定：${input.visualDescription.trim()}`);
  if (input.description?.trim())
    lines.push(`${kindLabel}描述：${input.description.trim()}`);
  const details = formatPromptDetails(input.details);
  if (details.length) lines.push("详细设定：", ...details);
  return lines.join("\n");
}

function formatPromptDetails(value?: Record<string, unknown>) {
  if (!value) return [];
  return Object.entries(value).flatMap(([key, item]) =>
    formatPromptValue(key, item),
  );
}

function formatPromptValue(key: string, value: unknown): string[] {
  if (typeof value === "string")
    return value.trim() ? [`${key}：${value.trim()}`] : [];
  if (typeof value === "number" || typeof value === "boolean")
    return [`${key}：${String(value)}`];
  if (Array.isArray(value)) {
    const scalarValues = value
      .filter(
        (item): item is string | number | boolean =>
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean",
      )
      .map((item) => String(item).trim())
      .filter(Boolean);
    const nestedValues = value.flatMap((item, index) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? formatPromptValue(`${key}.${index + 1}`, item)
        : [],
    );
    return [
      ...(scalarValues.length ? [`${key}：${scalarValues.join("；")}`] : []),
      ...nestedValues,
    ];
  }
  if (value && typeof value === "object")
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([nestedKey, nestedValue]) =>
        formatPromptValue(`${key}.${nestedKey}`, nestedValue),
    );
  return [];
}
