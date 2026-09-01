import { jsonrepair } from "jsonrepair";

import type { AssetVisualProfileSpec } from "./visual-profile";

const VISUAL_DESIGN_LABELS = {
  visualIdentity: ["视觉身份", "visual identity"],
  shapeAndStructure: [
    "形体与结构",
    "形体与空间结构",
    "空间结构",
    "空间拓扑与尺度",
    "父级与子区域关系",
    "前、中、后景组织",
    "前中后景组织",
    "外形与结构",
    "轮廓与结构",
    "结构与比例",
    "shape and structure",
    "spatial structure",
    "spatial topology and scale",
  ],
  surfaceAndStyling: ["造型与材质", "表面与造型", "surface and styling"],
  colorPalette: ["色彩方案", "color palette"],
  lightingAndPresentation: [
    "参考图呈现",
    "主要实际光源",
    "光线与展示",
    "灯光与展示",
    "lighting and presentation",
    "practical lighting",
  ],
  signatureDetails: ["识别细节", "signature details"],
  consistencyRules: [
    "一致性规则",
    "永久身份与本集状态分离",
    "永久设计与可变状态分离",
    "consistency rules",
    "permanent identity and episode states",
  ],
  negativePrompt: ["排除项", "负面提示词", "negative prompt"],
  inferenceNotes: ["推断记录", "推断说明", "inference notes"],
} as const;

type VisualDesignField = keyof typeof VISUAL_DESIGN_LABELS;

export function parseAssetVisualDesignText(value: string) {
  const normalized = value.trim();
  const record =
    parseVisualDesignJson(normalized) ?? parseVisualDesignSections(normalized);
  const spec = normalizeAssetVisualProfileSpec(record);
  if (!hasVisualProfileContent(spec)) spec.visualIdentity = normalized;
  return spec;
}

export function normalizeAssetVisualProfileSpec(
  value: unknown,
): AssetVisualProfileSpec {
  const record = isRecord(value) ? value : {};
  return {
    visualIdentity: textValue(record.visualIdentity),
    shapeAndStructure: textValue(record.shapeAndStructure),
    surfaceAndStyling: textValue(record.surfaceAndStyling),
    colorPalette: textValue(record.colorPalette),
    lightingAndPresentation: textValue(record.lightingAndPresentation),
    signatureDetails: listValue(record.signatureDetails),
    consistencyRules: listValue(record.consistencyRules),
    negativePrompt: textValue(record.negativePrompt),
    inferenceNotes: listValue(record.inferenceNotes),
  };
}

function parseVisualDesignJson(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(jsonrepair(value.slice(start, end + 1)));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseVisualDesignSections(value: string) {
  const aliases = Object.entries(VISUAL_DESIGN_LABELS).flatMap(
    ([field, labels]) =>
      labels.map((label) => ({
        field: field as VisualDesignField,
        label,
      })),
  );
  const sections: Partial<Record<VisualDesignField, string[]>> = {};
  let current: VisualDesignField | null = null;
  for (const line of value.split(/\r?\n/u)) {
    const heading = /^\s*#{1,6}\s+/u.test(line);
    const normalizedLine = line
      .replace(/^\s*#{1,6}\s*/u, "")
      .replace(/^\*\*([^*]+[：:])\*\*\s*/u, "$1")
      .replace(/^\*\*([^*]+)\*\*(\s*[：:].*)$/u, "$1$2")
      .replace(/^\*\*(.*?)\*\*\s*$/u, "$1")
      .trim();
    const match = aliases.find(({ label }) => {
      const escaped = escapeRegExp(label);
      return (
        new RegExp(`^${escaped}\\s*[：:]`, "iu").test(normalizedLine) ||
        (heading && new RegExp(`^${escaped}\\s*$`, "iu").test(normalizedLine))
      );
    });
    if (match) {
      current = match.field;
      const content = normalizedLine.replace(
        new RegExp(`^${escapeRegExp(match.label)}\\s*(?:[：:]\\s*)?`, "iu"),
        "",
      );
      const existing = sections[current] ?? [];
      const isCanonicalLabel =
        match.label.localeCompare(
          VISUAL_DESIGN_LABELS[current][0],
          undefined,
          { sensitivity: "accent" },
        ) === 0;
      sections[current] = [
        ...existing,
        ...(existing.length > 0 || !isCanonicalLabel
          ? [`${match.label}：`]
          : []),
        ...(content ? [content] : []),
      ];
      continue;
    }
    if (current && line.trim()) sections[current]?.push(line.trim());
  }
  return Object.fromEntries(
    Object.entries(sections).map(([key, lines]) => [key, lines.join("\n")]),
  );
}

function hasVisualProfileContent(spec: AssetVisualProfileSpec) {
  return Object.values(spec).some((item) =>
    Array.isArray(item) ? item.length > 0 : Boolean(item.trim()),
  );
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function listValue(value: unknown) {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
  return items.flatMap((item) =>
    typeof item === "string"
      ? item
          .split(/\r?\n|；/u)
          .map((entry) =>
            entry.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/u, "").trim(),
          )
          .filter(Boolean)
      : [],
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
