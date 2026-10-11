import { z } from "zod";

import { parseAssetVisualDesignText } from "./visual-design-parser";

const visualText = z.string().trim().min(1);

/** Complete contract shared by Director Assistant and episode continuation. */
export const AssetVisualProfileSpecSchema = z.object({
  visualIdentity: visualText,
  shapeAndStructure: visualText,
  surfaceAndStyling: visualText,
  colorPalette: visualText,
  lightingAndPresentation: visualText,
  signatureDetails: z.array(visualText).min(1),
  consistencyRules: z.array(visualText).min(1),
  negativePrompt: visualText,
  inferenceNotes: z.array(visualText).min(1),
});

export type AssetVisualProfileSpec = z.infer<
  typeof AssetVisualProfileSpecSchema
>;

export function isAssetVisualProfileComplete(profile: AssetVisualProfile | undefined) {
  return AssetVisualProfileSpecSchema.safeParse(profile?.spec).success;
}

export type AssetStoryWorldLock = {
  mode?: "source" | "premodern" | "contemporary" | "custom";
  setting:
    | "premodern_cultivation"
    | "premodern"
    | "contemporary"
    | "custom"
    | "unspecified";
  evidence: string[];
  customDirective?: string;
};

export type AssetVisualProfile = {
  version: 1;
  source: "model" | "manual";
  model?: string;
  updatedAt: string;
  spec: AssetVisualProfileSpec;
  projectArtStyle?: string;
  storyWorld?: AssetStoryWorldLock;
  promptTrace?: Record<string, unknown>;
};

export function parseAssetVisualProfile(
  value: unknown,
): AssetVisualProfile | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const profile = value as Record<string, unknown>;
  const specValue = profile.spec;
  if (!specValue || typeof specValue !== "object" || Array.isArray(specValue))
    return;
  const item = specValue as Record<string, unknown>;
  const textFields = [
    "visualIdentity",
    "shapeAndStructure",
    "surfaceAndStyling",
    "colorPalette",
    "lightingAndPresentation",
    "negativePrompt",
  ] as const;
  if (textFields.some((key) => typeof item[key] !== "string")) return;
  const signatureDetails = stringList(item.signatureDetails);
  const consistencyRules = stringList(item.consistencyRules);
  const inferenceNotes = stringList(item.inferenceNotes);
  const storyWorld = parseStoryWorldLock(profile.storyWorld);
  const parsedSpec = {
    visualIdentity: item.visualIdentity as string,
    shapeAndStructure: item.shapeAndStructure as string,
    surfaceAndStyling: item.surfaceAndStyling as string,
    colorPalette: item.colorPalette as string,
    lightingAndPresentation: item.lightingAndPresentation as string,
    signatureDetails,
    consistencyRules,
    negativePrompt: item.negativePrompt as string,
    inferenceNotes,
  };
  const rawOutput =
    profile.promptTrace &&
    typeof profile.promptTrace === "object" &&
    !Array.isArray(profile.promptTrace) &&
    typeof (profile.promptTrace as Record<string, unknown>).rawOutput === "string"
      ? ((profile.promptTrace as Record<string, unknown>).rawOutput as string)
      : "";
  const collapsedSource =
    rawOutput.trim() && parsedSpec.visualIdentity.trim() === rawOutput.trim()
      ? rawOutput
      : parsedSpec.visualIdentity;
  const recoveredSpec = parseAssetVisualDesignText(collapsedSource);
  const spec =
    isCollapsedLegacySpec(parsedSpec) && hasRecoveredSections(recoveredSpec)
      ? recoveredSpec
      : parsedSpec;
  return {
    version: 1,
    source: profile.source === "manual" ? "manual" : "model",
    ...(typeof profile.model === "string" ? { model: profile.model } : {}),
    updatedAt:
      typeof profile.updatedAt === "string"
        ? profile.updatedAt
        : new Date(0).toISOString(),
    ...(typeof profile.projectArtStyle === "string"
      ? { projectArtStyle: profile.projectArtStyle }
      : {}),
    ...(storyWorld ? { storyWorld } : {}),
    spec,
    ...(profile.promptTrace &&
    typeof profile.promptTrace === "object" &&
    !Array.isArray(profile.promptTrace)
      ? { promptTrace: profile.promptTrace as Record<string, unknown> }
      : {}),
  };
}

export function compileAssetVisualProfile(profile?: AssetVisualProfile) {
  if (!profile) return "";
  const { spec } = profile;
  return [
    ...(profile.storyWorld
      ? [`故事世界锁定：${storyWorldLabel(profile.storyWorld.setting)}`]
      : []),
    `视觉身份：${spec.visualIdentity}`,
    `形体与结构：${spec.shapeAndStructure}`,
    `造型与材质：${spec.surfaceAndStyling}`,
    `色彩方案：${spec.colorPalette}`,
    `参考图呈现：${spec.lightingAndPresentation}`,
    `识别细节：${spec.signatureDetails.join("；")}`,
    `一致性规则：${spec.consistencyRules.join("；")}`,
    `排除项：${spec.negativePrompt}`,
  ].filter((line) => !line.endsWith("：")).join("\n");
}

function isCollapsedLegacySpec(
  spec: AssetVisualProfileSpec,
) {
  return (
    spec.visualIdentity.trim().length > 0 &&
    !spec.shapeAndStructure &&
    !spec.surfaceAndStyling &&
    !spec.colorPalette &&
    !spec.lightingAndPresentation &&
    spec.signatureDetails.length === 0 &&
    spec.consistencyRules.length === 0 &&
    !spec.negativePrompt &&
    spec.inferenceNotes.length === 0
  );
}

function hasRecoveredSections(spec: AssetVisualProfileSpec) {
  return (
    Boolean(spec.shapeAndStructure) ||
    Boolean(spec.surfaceAndStyling) ||
    Boolean(spec.colorPalette) ||
    Boolean(spec.lightingAndPresentation) ||
    spec.signatureDetails.length > 0 ||
    spec.consistencyRules.length > 0 ||
    Boolean(spec.negativePrompt) ||
    spec.inferenceNotes.length > 0
  );
}

function parseStoryWorldLock(value: unknown): AssetStoryWorldLock | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const item = value as Record<string, unknown>;
  if (
    item.setting !== "premodern_cultivation" &&
    item.setting !== "premodern" &&
    item.setting !== "contemporary" &&
    item.setting !== "custom" &&
    item.setting !== "unspecified"
  )
    return;
  return {
    setting: item.setting,
    evidence: stringList(item.evidence),
    ...(item.mode === "source" ||
    item.mode === "premodern" ||
    item.mode === "contemporary" ||
    item.mode === "custom"
      ? { mode: item.mode }
      : {}),
    ...(typeof item.customDirective === "string" &&
    item.customDirective.trim()
      ? { customDirective: item.customDirective.trim() }
      : {}),
  };
}

function storyWorldLabel(setting: AssetStoryWorldLock["setting"]) {
  if (setting === "premodern_cultivation") return "古代东方修炼世界";
  if (setting === "premodern") return "前现代世界";
  if (setting === "contemporary") return "当代世界";
  if (setting === "custom") return "项目自定义改编世界";
  return "时代未确认，以剧情事实为准";
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && Boolean(item.trim()),
      )
    : [];
}
