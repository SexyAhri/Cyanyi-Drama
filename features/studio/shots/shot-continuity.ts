import type { ProjectMediaAsset, StudioStoryboardPanel } from "../types";

export const continuityStateFields = [
  { key: "screenDirection", zh: "站位 / 方向", en: "Position / direction" },
  { key: "body", zh: "身体姿态", en: "Body" },
  { key: "hands", zh: "手部动作", en: "Hands" },
  { key: "gaze", zh: "视线", en: "Gaze" },
  { key: "props", zh: "道具状态", en: "Props" },
] as const;

export function continuityStateText(
  state: Record<string, unknown> | undefined,
  key: string,
) {
  const value = state?.[key];
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value))
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .join("；");
  return "";
}

/** Contact sheets show only the persisted adopted image, never an unadopted newer candidate. */
export function buildShotContinuityFrames(
  panels: StudioStoryboardPanel[],
  assets: ProjectMediaAsset[],
) {
  const ordered = [...panels].sort((a, b) => a.panelIndex - b.panelIndex);
  const zeroBasedScenes = ordered.some((panel) => panel.sceneNumber === 0);
  const byId = new Map(
    assets
      .filter(
        (asset) =>
          asset.kind === "image" &&
          asset.taskStatus === "succeeded" &&
          asset.url,
      )
      .map((asset) => [asset.id, asset]),
  );
  return ordered.map((panel, index) => ({
    panel,
    sceneNumber:
      panel.sceneNumber == null
        ? undefined
        : panel.sceneNumber + (zeroBasedScenes ? 1 : 0),
    image: panel.imageAssetId ? byId.get(panel.imageAssetId) : undefined,
    previous: ordered[index - 1],
    next: ordered[index + 1],
    missingState: !continuityStateFields.some(
      (field) =>
        continuityStateText(panel.startState, field.key) ||
        continuityStateText(panel.endState, field.key),
    ),
  }));
}
