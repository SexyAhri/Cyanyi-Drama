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

export type AssetVisualProfile = {
  version: 1;
  source: "model" | "manual";
  model?: string;
  updatedAt: string;
  spec: AssetVisualProfileSpec;
  projectArtStyle?: string;
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

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && Boolean(item.trim()),
      )
    : [];
}
