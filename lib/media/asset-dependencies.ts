import type { Prisma } from "@prisma/client";

type AssetDependencyDatabase = Pick<
  Prisma.TransactionClient,
  "storyboardPanel" | "mediaAsset" | "editorProject"
>;

export type ChangedProjectAsset = {
  kind: "character" | "location" | "prop";
  name: string;
  fields: string[];
};

export function storyboardPanelUsesChangedAsset(
  panel: { charactersJson: string | null; locationName: string | null; propsJson: string | null },
  asset: ChangedProjectAsset,
) {
  if (asset.kind === "character") return parseNames(panel.charactersJson).includes(asset.name);
  if (asset.kind === "location") return panel.locationName === asset.name;
  return parseNames(panel.propsJson).includes(asset.name);
}

/** Mark only outputs attached to panels that name the edited asset. */
export async function markAssetDependentPanelsStale(
  db: AssetDependencyDatabase,
  input: { userId: string; projectId: string; assets: ChangedProjectAsset[] },
) {
  const changedAssets = input.assets.filter((asset) => asset.name.trim() && asset.fields.length);
  if (!changedAssets.length) return { panelIds: [], episodeIds: [] };
  const panels = await db.storyboardPanel.findMany({
    where: { storyboard: { projectId: input.projectId, project: { userId: input.userId } } },
    select: {
      id: true,
      storyboard: { select: { episodeId: true } },
      charactersJson: true,
      locationName: true,
      propsJson: true,
      imageAssetId: true,
      videoAssetId: true,
      lipSyncAssetId: true,
    },
  });
  const affected = panels.filter((panel) =>
    changedAssets.some((asset) => storyboardPanelUsesChangedAsset(panel, asset)),
  );
  if (!affected.length) return { panelIds: [], episodeIds: [] };
  const panelIds = affected.map((panel) => panel.id);
  const episodeIds = [...new Set(affected.map((panel) => panel.storyboard.episodeId))];
  await db.storyboardPanel.updateMany({
    where: { id: { in: panelIds } },
    data: { status: "stale" },
  });
  const mediaAssetIds = [...new Set(affected.flatMap((panel) =>
    [panel.imageAssetId, panel.videoAssetId, panel.lipSyncAssetId].filter((id): id is string => Boolean(id)),
  ))];
  if (mediaAssetIds.length) {
    const mediaAssets = await db.mediaAsset.findMany({
      where: { id: { in: mediaAssetIds }, task: { userId: input.userId } },
      select: { id: true, metadataJson: true },
    });
    for (const media of mediaAssets) {
      const relatedPanels = affected.filter((panel) =>
        [panel.imageAssetId, panel.videoAssetId, panel.lipSyncAssetId].includes(media.id),
      );
      const assetFields = changedAssets
        .filter((asset) => relatedPanels.some((panel) => storyboardPanelUsesChangedAsset(panel, asset)))
        .flatMap((asset) => asset.fields.map((field) => `asset.${asset.kind}.${asset.name}.${field}`));
      const metadata = parseRecord(media.metadataJson);
      const previousStale = parseRecord(
        typeof metadata.productionConfigurationStale === "string"
          ? metadata.productionConfigurationStale
          : JSON.stringify(metadata.productionConfigurationStale ?? {}),
      );
      const previousFields = Array.isArray(previousStale.fields)
        ? previousStale.fields.filter((field): field is string => typeof field === "string")
        : [];
      metadata.productionConfigurationStale = {
        ...previousStale,
        fields: [...new Set([...previousFields, ...assetFields])],
        reason: "referenced_asset_changed",
        updatedAt: new Date().toISOString(),
      };
      await db.mediaAsset.update({
        where: { id: media.id },
        data: { metadataJson: JSON.stringify(metadata) },
      });
    }
  }
  await db.editorProject.updateMany({
    where: { episodeId: { in: episodeIds } },
    data: { renderStatus: "stale" },
  });
  return { panelIds, episodeIds };
}

function parseNames(value: string | null) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseRecord(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
