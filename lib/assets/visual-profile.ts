export type AssetVisualProfileSpec = {
  visualIdentity: string;
  shapeAndStructure: string;
  surfaceAndStyling: string;
  colorPalette: string;
  lightingAndPresentation: string;
  signatureDetails: string[];
  consistencyRules: string[];
  negativePrompt: string;
  inferenceNotes: string[];
};

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
  const spec = profile.spec;
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return;
  const item = spec as Record<string, unknown>;
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
  if (!signatureDetails.length || consistencyRules.length < 2) return;
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
    spec: {
      visualIdentity: item.visualIdentity as string,
      shapeAndStructure: item.shapeAndStructure as string,
      surfaceAndStyling: item.surfaceAndStyling as string,
      colorPalette: item.colorPalette as string,
      lightingAndPresentation: item.lightingAndPresentation as string,
      signatureDetails,
      consistencyRules,
      negativePrompt: item.negativePrompt as string,
      inferenceNotes,
    },
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
  ].join("\n");
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
