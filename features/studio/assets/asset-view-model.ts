import type { ProjectAssetCatalog, ProjectMediaAsset } from "../types";
import type { MediaTask } from "@/lib/media/task-contract";
import {
  parseAssetVisualProfile,
  type AssetVisualProfile,
} from "@/lib/assets/visual-profile";
import { buildAssetGenerationPrompt } from "@/lib/assets/generation-prompt";

export type StudioAssetKind = "character" | "location" | "prop";

export type StudioAssetCandidate = {
  id: string;
  assetId: string | null;
  createdAt: string;
  description: string | null;
  selected: boolean;
  url: string | null;
};

export type StudioAssetEntity = {
  id: string;
  description: string | null;
  generationPrompt: string;
  kind: StudioAssetKind;
  name: string;
  visualProfile?: AssetVisualProfile;
  candidates: StudioAssetCandidate[];
};

export function buildStudioAssetEntities(
  catalog: ProjectAssetCatalog,
  kind: StudioAssetKind,
  artStyle?: string,
  tasks: MediaTask[] = [],
): StudioAssetEntity[] {
  const assetsById = new Map(catalog.assets.map((asset) => [asset.id, asset]));
  const placeholderTargetIds = new Set(
    tasks
      .filter(
        (task) =>
          task.kind === "image" &&
          ["queued", "running", "failed", "canceled"].includes(task.status) &&
          task.targetId,
      )
      .map((task) => task.targetId as string),
  );
  if (kind === "character") {
    return catalog.characters.map((character) => {
      const visualProfile = parseAssetVisualProfile(character.visualProfile);
      const appearanceDescription = preferredDescription(character.appearances);
      return {
        id: character.id,
        description: character.introduction,
        generationPrompt: buildAssetGenerationPrompt({
          kind,
          name: character.name,
          description: character.introduction,
          visualDescription: appearanceDescription,
          visualProfile,
          details: character.profile,
          artStyle,
        }),
        kind,
        name: character.name,
        visualProfile,
        candidates: character.appearances.flatMap((appearance) => {
          const asset = appearance.imageAssetId
            ? assetsById.get(appearance.imageAssetId)
            : undefined;
          return asset || placeholderTargetIds.has(appearance.id)
            ? [
                toCandidate({
                  id: appearance.id,
                  asset,
                  assetId: asset ? appearance.imageAssetId : null,
                  createdAt: appearance.createdAt,
                  description: appearance.description,
                  selected: Boolean(asset && appearance.selected),
                }),
              ]
            : [];
        }),
      };
    });
  }
  if (kind === "location") {
    return catalog.locations.map((location) => {
      const visualProfile = parseAssetVisualProfile(location.visualProfile);
      const images = location.images.map((image) => ({
        ...image,
        selected: image.selected || location.selectedImageId === image.id,
      }));
      return {
        id: location.id,
        description: location.summary,
        generationPrompt: buildAssetGenerationPrompt({
          kind,
          name: location.name,
          description: location.summary,
          visualDescription: preferredDescription(images),
          visualProfile,
          artStyle,
        }),
        kind,
        name: location.name,
        visualProfile,
        candidates: images.flatMap((image) => {
          const asset = image.imageAssetId
            ? assetsById.get(image.imageAssetId)
            : undefined;
          return asset || placeholderTargetIds.has(image.id)
            ? [
                toCandidate({
                  id: image.id,
                  asset,
                  assetId: asset ? image.imageAssetId : null,
                  createdAt: image.createdAt,
                  description: image.description,
                  selected: Boolean(asset && image.selected),
                }),
              ]
            : [];
        }),
      };
    });
  }
  return catalog.props.map((prop) => {
    const visualProfile = parseAssetVisualProfile(prop.visualProfile);
    return {
      id: prop.id,
      description: prop.summary,
      generationPrompt: buildAssetGenerationPrompt({
        kind,
        name: prop.name,
        description: prop.summary,
        visualProfile,
        details: prop.metadata,
        artStyle,
      }),
      kind,
      name: prop.name,
      visualProfile,
      candidates: catalog.assets
        .filter((asset) =>
          asset.references.some(
            (reference) =>
              reference.entityType === "prop" && reference.entityId === prop.id,
          ),
        )
        .map((asset) => ({
          id: asset.id,
          assetId: asset.id,
          createdAt: asset.createdAt,
          description: null,
          selected: asset.references.some(
            (reference) =>
              reference.entityType === "prop" &&
              reference.entityId === prop.id &&
              reference.role === "selected",
          ),
          url: asset.url,
        })),
    };
  });
}

export function getProjectSourceAssets(
  catalog: ProjectAssetCatalog,
  projectId: string,
) {
  return catalog.assets.filter((asset) =>
    asset.references.some(
      (reference) =>
        reference.entityType === "project" && reference.entityId === projectId,
    ),
  );
}

function toCandidate(input: {
  id: string;
  asset?: ProjectMediaAsset;
  assetId: string | null;
  createdAt: string;
  description: string | null;
  selected: boolean;
}): StudioAssetCandidate {
  return {
    id: input.id,
    assetId: input.assetId,
    createdAt: input.asset?.createdAt ?? input.createdAt,
    description: input.description,
    selected: input.selected,
    url: input.asset?.url ?? null,
  };
}

function preferredDescription(
  items: Array<{ description: string | null; selected: boolean }>,
) {
  return (
    items.find((item) => item.selected && item.description?.trim())
      ?.description ??
    items.find((item) => item.description?.trim())?.description
  );
}
